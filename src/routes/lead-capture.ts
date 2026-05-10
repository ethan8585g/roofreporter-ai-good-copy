import { Hono } from 'hono'
import type { Bindings } from '../types'
import { sendGmailEmail, notifySalesNewLead } from '../services/email'
import { sendMetaConversion } from './meta-connect'

export const leadCaptureRoutes = new Hono<{ Bindings: Bindings }>()

// conv-v5: hardened per V5 Section 7
// Per-isolate soft rate limiter: 20 submissions / 10 minutes per IP+endpoint.
// Intentionally in-memory only — a soft throttle, not a security control.
// Edge isolates get recycled, so an attacker determined to bypass this can, but
// it blocks the common "rapid-fire bot" case without needing migrations.
type RLEntry = { count: number; first: number }
const RL_WINDOW_MS = 10 * 60 * 1000
const RL_MAX = 20
const rateLimitMap: Map<string, RLEntry> = (globalThis as any).__rmLeadRL__ || new Map()
;(globalThis as any).__rmLeadRL__ = rateLimitMap

function getClientIP(c: any): string {
  try {
    return (
      c.req.header('cf-connecting-ip') ||
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      'unknown'
    )
  } catch { return 'unknown' }
}

/**
 * Returns true if the request should be throttled. Caller should respond 429.
 * Safe to call on every submission — self-prunes expired entries lazily.
 */
function rateLimited(c: any, endpoint: string): boolean {
  const ip = getClientIP(c)
  const key = `${ip}:${endpoint}`
  const now = Date.now()
  // Lazy prune: once every ~64 calls, drop anything expired.
  if ((rateLimitMap.size > 1024) && (Math.random() < 0.015)) {
    for (const [k, v] of rateLimitMap.entries()) {
      if (now - v.first > RL_WINDOW_MS) rateLimitMap.delete(k)
    }
  }
  const entry = rateLimitMap.get(key)
  if (!entry || (now - entry.first) > RL_WINDOW_MS) {
    rateLimitMap.set(key, { count: 1, first: now })
    return false
  }
  entry.count += 1
  if (entry.count > RL_MAX) {
    console.warn('[lead-capture:rate-limited]', { ip, endpoint, count: entry.count, windowStart: entry.first })
    return true
  }
  return false
}

/** Log UA + Referer (+ IP) on every submission. Low-signal but useful for abuse forensics. */
function logSubmission(c: any, endpoint: string, extra: Record<string, any> = {}) {
  try {
    const ua = c.req.header('user-agent') || ''
    const ref = c.req.header('referer') || c.req.header('referrer') || ''
    const ip = getClientIP(c)
    console.log('[lead-capture:submit]', { endpoint, ip, ua: ua.slice(0, 240), referer: ref.slice(0, 240), ...extra })
  } catch (e: any) { /* best-effort only */ }
}

export const VALID_LEAD_SOURCES = ['homepage_cta', 'demo_portal', 'condo_cheat_sheet', 'other'] as const
export type LeadSource = typeof VALID_LEAD_SOURCES[number]

export function validateLeadInput(body: any): { ok: boolean; error?: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid body' }
  const email = body.email
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: 'Valid email required' }
  }
  return { ok: true }
}

export function isValidLeadSource(s: any): s is LeadSource {
  return typeof s === 'string' && (VALID_LEAD_SOURCES as readonly string[]).includes(s)
}

let leadTableReady = false
async function ensureLeadTable(db: any) {
  if (leadTableReady) return
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS asset_report_leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        address TEXT,
        building_count INTEGER,
        name TEXT,
        company TEXT,
        source TEXT NOT NULL DEFAULT 'homepage_cta',
        tag TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `).run()
    try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_asset_leads_email ON asset_report_leads(email)').run() } catch(e) {}
    try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_asset_leads_source ON asset_report_leads(source)').run() } catch(e) {}
    try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_asset_leads_tag ON asset_report_leads(tag)').run() } catch(e) {}
    leadTableReady = true
  } catch (e) { leadTableReady = true }
}

let contactLeadTableReady = false
async function ensureContactLeadsTable(db: any) {
  if (contactLeadTableReady) return
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS contact_leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        company TEXT,
        employees TEXT,
        interest TEXT,
        message TEXT NOT NULL,
        utm_source TEXT,
        utm_medium TEXT,
        utm_campaign TEXT,
        utm_content TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `).run()
    try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_contact_leads_email ON contact_leads(email)').run() } catch(e) {}
    try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_contact_leads_created ON contact_leads(created_at)').run() } catch(e) {}
    contactLeadTableReady = true
  } catch (e) { contactLeadTableReady = true }
}

// Free Asset Report lead (homepage hero + demo portal)
leadCaptureRoutes.post('/asset-report/lead', async (c) => {
  // conv-v5: rate-limit + UA log
  if (rateLimited(c, 'asset-report')) return c.json({ error: 'Too many submissions. Please wait a few minutes and try again.' }, 429)
  const body = await c.req.json().catch((e) => { console.warn('[lead-capture] invalid JSON body:', (e && e.message) || e); return {} })
  logSubmission(c, 'asset-report', { email: body?.email, source: body?.source })
  // Honeypot: any value in `website` field → silent 200, no record, no email.
  if (body && typeof body.website === 'string' && body.website.trim()) {
    console.warn('[lead-capture:honeypot]', { endpoint: 'asset-report', ip: getClientIP(c) })
    return c.json({ success: true })
  }
  const v = validateLeadInput(body)
  if (!v.ok) return c.json({ error: v.error }, 400)
  await ensureLeadTable(c.env.DB)

  const source = isValidLeadSource(body.source) ? body.source : 'homepage_cta'
  // P1-33: strip CR/LF/HTML tags from address before storing + rendering in email.
  const rawAddress = body.address ? String(body.address).replace(/[\r\n\u0000-\u001F\u007F]/g, '').replace(/<[^>]*>/g, '').trim().slice(0, 300) : null
  const address = rawAddress
  const buildings = body.building_count ? parseInt(body.building_count, 10) : null

  // HTML-escaped copy for splicing into email HTML safely.
  const escapeHtml = (v: string | null) => v == null ? '' : String(v).replace(/[&<>"'`=\/]/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','`':'&#x60;','=':'&#x3D;','/':'&#x2F;'}[ch] || ch))
  const addressForHtml = escapeHtml(address)

  // Attribution fields (blog slug / UTM / referrer / landing page) — sent by blogLeadMagnetHTML submit JS
  const s100 = (v: any) => v ? String(v).trim().slice(0, 100) : null
  const s500 = (v: any) => v ? String(v).trim().slice(0, 500) : null
  const landingPage = s500(body.landing_page)
  const refUrl = s500(body.referrer)
  const utmSource = s100(body.utm_source)
  const utmMedium = s100(body.utm_medium)
  const utmCampaign = s100(body.utm_campaign)

  try {
    await c.env.DB.prepare(
      `INSERT INTO asset_report_leads (email, address, building_count, source, landing_page, referrer, utm_source, utm_medium, utm_campaign) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(String(body.email).toLowerCase().trim(), address, buildings, source, landingPage, refUrl, utmSource, utmMedium, utmCampaign).run()
  } catch (e: any) {
    if (/no such column/i.test(String(e?.message || ''))) {
      await c.env.DB.prepare(
        `INSERT INTO asset_report_leads (email, address, building_count, source) VALUES (?, ?, ?, ?)`
      ).bind(String(body.email).toLowerCase().trim(), address, buildings, source).run()
    } else { throw e }
  }

  // Mirror into unified `leads` table so super-admin leads inbox surfaces it.
  try {
    await c.env.DB.prepare(
      `INSERT INTO leads (name, email, address, source_page, message, utm_source, utm_medium, utm_campaign, referrer, landing_page) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      body.email ? String(body.email).split('@')[0].slice(0, 60) : 'Blog visitor',
      String(body.email).toLowerCase().trim(),
      address,
      `blog:${source}`,
      `Free sample/measurement report request from blog${address ? ` — ${address}` : ''}${buildings ? ` (${buildings} buildings)` : ''}`,
      utmSource, utmMedium, utmCampaign, refUrl, landingPage
    ).run()
  } catch (e: any) {
    try {
      await c.env.DB.prepare(
        `INSERT INTO leads (name, email, address, source_page, message) VALUES (?, ?, ?, ?, ?)`
      ).bind(
        body.email ? String(body.email).split('@')[0].slice(0, 60) : 'Blog visitor',
        String(body.email).toLowerCase().trim(),
        address,
        `blog:${source}`,
        `Free sample/measurement report request from blog${address ? ` — ${address}` : ''}${buildings ? ` (${buildings} buildings)` : ''}`,
      ).run()
    } catch (e2: any) { console.warn('[asset-report/lead] leads mirror insert skipped:', e2?.message) }
  }

  // Fire email with sample report link
  try {
    if (c.env.GCP_SERVICE_ACCOUNT_JSON) {
      const subject = `Your Sample Active Management Report: ${address || 'RoofManager'}`
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
          <h1 style="color:#0A0A0A;font-size:22px;margin:0 0 12px">Your Sample Asset Report</h1>
          <p style="color:#374151;line-height:1.6">Thanks for requesting a sample from RoofManager. This preview shows how a live portfolio looks inside our Active Management platform — work orders, maintenance schedules, and client portal views.</p>
          ${address ? `<p style="color:#6b7280;font-size:14px"><b>Property:</b> ${addressForHtml}${buildings ? ` &middot; <b>Buildings/Sections:</b> ${buildings}` : ''}</p>` : ''}
          <p style="margin:24px 0"><a href="https://www.roofmanager.ca/static/Sample-RoofManager-Report.pdf" style="background:#00FF88;color:#0A0A0A;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:800">Download Sample Report (PDF)</a></p>
          <p style="color:#6b7280;font-size:13px">Questions? Reply to this email or book a 15-minute walkthrough at <a href="https://calendar.app.google/KNLFST4CNxViPPN3A">calendar.app.google</a>.</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
          <p style="color:#9ca3af;font-size:12px">RoofManager &middot; Commercial Roof Asset Management &middot; Canada</p>
        </div>`
      await sendGmailEmail(c.env.GCP_SERVICE_ACCOUNT_JSON, String(body.email), subject, html, 'sales@roofmanager.ca').catch((e) => console.error('[gmail-send-failed asset-report]', { to: body.email, error: (e && e.message) || e }))
    } else {
      console.warn('[gmail-skip] GCP_SERVICE_ACCOUNT_JSON not set — skipping sample PDF email for', body.email)
    }
  } catch (e) { console.error('[asset-report email]', { to: body.email, error: (e as any).message }) }

  notifySalesNewLead(c.env, {
    source: `asset_report:${source}`,
    email: body.email,
    extra: { address, building_count: buildings }
  }).catch((e: any) => console.error('[asset-report/lead] email notification failed:', e?.message || e))

  // Fire server-side Meta CAPI Lead event (non-blocking).
  // Pass the browser's _fbp/_fbc cookies + IP/UA so Meta can match this
  // server event to the pixel-side fbq() call. This raises Event Match
  // Quality, which is what makes ROAS reporting accurate.
  const _cookieHeader = c.req.header('Cookie') || ''
  const _fbpMatch = _cookieHeader.match(/(?:^|;\s*)_fbp=([^;]+)/)
  const _fbcMatch = _cookieHeader.match(/(?:^|;\s*)_fbc=([^;]+)/)
  sendMetaConversion(c.env, {
    eventName: 'Lead',
    email: String(body.email).toLowerCase().trim(),
    sourcePage: `asset_report:${source}`,
    sourceUrl: c.req.header('Referer') || 'https://www.roofmanager.ca',
    customData: { content_name: 'asset_report', lead_type: 'sample_report' },
    clientIp: c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim(),
    clientUserAgent: c.req.header('User-Agent') || undefined,
    fbp: _fbpMatch ? decodeURIComponent(_fbpMatch[1]) : undefined,
    fbc: _fbcMatch ? decodeURIComponent(_fbcMatch[1]) : undefined,
  }).catch((e) => console.warn('[Meta CAPI asset-lead]', (e && e.message) || e))

  return c.json({ success: true })
})

// Contact Us lead — general sales/support inquiry form
leadCaptureRoutes.post('/contact/lead', async (c) => {
  let body: any = {}
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON body' }, 400) }

  // Required fields
  const name = body.name ? String(body.name).trim() : ''
  const email = body.email ? String(body.email).trim() : ''
  const message = body.message ? String(body.message).trim() : ''

  if (!name || name.length < 2 || name.length > 80) return c.json({ error: 'Name must be 2–80 characters' }, 400)
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: 'Valid email required' }, 400)
  if (!message || message.length < 10 || message.length > 2000) return c.json({ error: 'Message must be 10–2000 characters' }, 400)

  // Optional fields
  const phone = body.phone ? String(body.phone).trim().slice(0, 30) : null
  const company = body.company ? String(body.company).trim().slice(0, 200) : null
  const validEmployees = ['1-5', '6-25', '26-100', '100+']
  const employees = validEmployees.includes(body.employees) ? body.employees : null
  const validInterests = ['use', 'wholesale', 'integrate', 'press', 'other', 'measurements', 'crm', 'solar', 'pricing', 'api'] // conv-v5: widened for /contact select values
  const interest = validInterests.includes(body.interest) ? body.interest : null
  const utm_source = body.utm_source ? String(body.utm_source).slice(0, 100) : null
  const utm_medium = body.utm_medium ? String(body.utm_medium).slice(0, 100) : null
  const utm_campaign = body.utm_campaign ? String(body.utm_campaign).slice(0, 100) : null
  const utm_content = body.utm_content ? String(body.utm_content).slice(0, 100) : null

  await ensureContactLeadsTable(c.env.DB)

  try {
    await c.env.DB.prepare(`
      INSERT INTO contact_leads (name, email, phone, company, employees, interest, message, utm_source, utm_medium, utm_campaign, utm_content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(name, email.toLowerCase(), phone, company, employees, interest, message, utm_source, utm_medium, utm_campaign, utm_content).run()
  } catch (e: any) {
    console.error('[contact/lead insert]', e?.message)
    return c.json({ error: 'Failed to save lead' }, 500)
  }

  // Mirror into unified `leads` table so super-admin leads inbox surfaces it.
  try {
    await c.env.DB.prepare(
      `INSERT INTO leads (name, email, phone, company_name, source_page, message, utm_source) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(name, email.toLowerCase(), phone, company, utm_source || 'contact_form', message, utm_source).run()
  } catch (e: any) { console.warn('[contact/lead] leads mirror insert skipped:', e?.message) }

  notifySalesNewLead(c.env, {
    source: 'contact_form',
    name, email, phone, company,
    extra: { employees, interest, message, utm_source, utm_medium, utm_campaign }
  }).catch((e: any) => console.error('[contact/lead] email notification failed:', e?.message || e))

  return c.json({ success: true })
})

// Condo / Reserve Fund Cheat Sheet lead
leadCaptureRoutes.post('/condo-lead', async (c) => {
  const body = await c.req.json().catch((e) => { console.warn('[lead-capture] invalid JSON body:', (e && e.message) || e); return {} })
  const v = validateLeadInput(body)
  if (!v.ok) return c.json({ error: v.error }, 400)
  await ensureLeadTable(c.env.DB)

  const name = body.name ? String(body.name).trim().slice(0, 150) : null
  const company = body.company ? String(body.company).trim().slice(0, 200) : null

  await c.env.DB.prepare(
    `INSERT INTO asset_report_leads (email, name, company, source, tag) VALUES (?, ?, ?, 'condo_cheat_sheet', 'condo_board_interest')`
  ).bind(String(body.email).toLowerCase().trim(), name, company).run()

  // Mirror into unified `leads` table so super-admin leads inbox surfaces it.
  try {
    await c.env.DB.prepare(
      `INSERT INTO leads (name, email, company_name, source_page, message) VALUES (?, ?, ?, ?, ?)`
    ).bind(name, String(body.email).toLowerCase().trim(), company, 'condo_cheat_sheet', null).run()
  } catch (e: any) { console.warn('[condo-lead] leads mirror insert skipped:', e?.message) }

  try {
    if (c.env.GCP_SERVICE_ACCOUNT_JSON) {
      const subject = `Your 2026 Condo Reserve Fund Cheat Sheet`
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
          <h1 style="color:#0A0A0A;font-size:22px;margin:0 0 12px">Your Reserve Fund Cheat Sheet</h1>
          <p style="color:#374151;line-height:1.6">Thanks${name ? `, ${name}` : ''}! Here is the 2026 Condo Reserve Fund Cheat Sheet for Roofing — covering Bill 106 compliance, useful-life benchmarks, and capital-planning templates.</p>
          <p style="margin:24px 0"><a href="https://www.roofmanager.ca/static/RoofManager-Reserve-Fund-Cheat-Sheet.pdf" style="background:#00FF88;color:#0A0A0A;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:800">Download Cheat Sheet (PDF)</a></p>
          <p style="color:#6b7280;font-size:13px">We'll be in touch with more property-manager focused resources.</p>
        </div>`
      await sendGmailEmail(c.env.GCP_SERVICE_ACCOUNT_JSON, String(body.email), subject, html, 'sales@roofmanager.ca').catch((e) => console.error('[gmail-send-failed condo-lead]', { to: body.email, error: (e && e.message) || e }))
    } else {
      console.warn('[gmail-skip] GCP_SERVICE_ACCOUNT_JSON not set — skipping condo cheat sheet email for', body.email)
    }
  } catch (e) { console.error('[condo-lead email]', { to: body.email, error: (e as any).message }) }

  notifySalesNewLead(c.env, {
    source: 'condo_cheat_sheet',
    name, email: body.email, company
  }).catch((e: any) => console.error('[condo-lead] email notification failed:', e?.message || e))

  return c.json({ success: true, redirect: '/condo-reserve-fund-cheat-sheet/thank-you' })
})

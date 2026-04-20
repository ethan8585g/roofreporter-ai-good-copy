import { Hono } from 'hono'
import type { Bindings } from '../types'
import { sendGmailEmail, notifySalesNewLead } from '../services/email'

export const leadCaptureRoutes = new Hono<{ Bindings: Bindings }>()

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

// Free Asset Report lead (homepage hero + demo portal)
leadCaptureRoutes.post('/asset-report/lead', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const v = validateLeadInput(body)
  if (!v.ok) return c.json({ error: v.error }, 400)
  await ensureLeadTable(c.env.DB)

  const source = isValidLeadSource(body.source) ? body.source : 'homepage_cta'
  const address = body.address ? String(body.address).trim().slice(0, 300) : null
  const buildings = body.building_count ? parseInt(body.building_count, 10) : null

  await c.env.DB.prepare(
    `INSERT INTO asset_report_leads (email, address, building_count, source) VALUES (?, ?, ?, ?)`
  ).bind(String(body.email).toLowerCase().trim(), address, buildings, source).run()

  // Fire email with sample report link
  try {
    if (c.env.GCP_SERVICE_ACCOUNT_JSON) {
      const subject = `Your Sample Active Management Report: ${address || 'RoofManager'}`
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
          <h1 style="color:#0A0A0A;font-size:22px;margin:0 0 12px">Your Sample Asset Report</h1>
          <p style="color:#374151;line-height:1.6">Thanks for requesting a sample from RoofManager. This preview shows how a live portfolio looks inside our Active Management platform — work orders, maintenance schedules, and client portal views.</p>
          ${address ? `<p style="color:#6b7280;font-size:14px"><b>Property:</b> ${address}${buildings ? ` &middot; <b>Buildings/Sections:</b> ${buildings}` : ''}</p>` : ''}
          <p style="margin:24px 0"><a href="https://www.roofmanager.ca/static/Sample-RoofManager-Report.pdf" style="background:#00FF88;color:#0A0A0A;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:800">Download Sample Report (PDF)</a></p>
          <p style="color:#6b7280;font-size:13px">Questions? Reply to this email or book a 15-minute walkthrough at <a href="https://calendar.app.google/KNLFST4CNxViPPN3A">calendar.app.google</a>.</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
          <p style="color:#9ca3af;font-size:12px">RoofManager &middot; Commercial Roof Asset Management &middot; Canada</p>
        </div>`
      await sendGmailEmail(c.env.GCP_SERVICE_ACCOUNT_JSON, String(body.email), subject, html, 'sales@roofmanager.ca').catch((e) => console.warn("[silent-catch]", (e && e.message) || e))
    }
  } catch (e) { console.log('[asset-report email]', (e as any).message) }

  notifySalesNewLead(c.env, {
    source: `asset_report:${source}`,
    email: body.email,
    extra: { address, building_count: buildings }
  }).catch((e: any) => console.error('[asset-report/lead] email notification failed:', e?.message || e))

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
  const validInterests = ['measurements', 'crm', 'solar', 'pricing', 'api', 'other']
  const interest = validInterests.includes(body.interest) ? body.interest : null
  const utm_source = body.utm_source ? String(body.utm_source).slice(0, 100) : null
  const utm_medium = body.utm_medium ? String(body.utm_medium).slice(0, 100) : null
  const utm_campaign = body.utm_campaign ? String(body.utm_campaign).slice(0, 100) : null
  const utm_content = body.utm_content ? String(body.utm_content).slice(0, 100) : null

  try {
    await c.env.DB.prepare(`
      INSERT INTO contact_leads (name, email, phone, company, employees, interest, message, utm_source, utm_medium, utm_campaign, utm_content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(name, email.toLowerCase(), phone, company, employees, interest, message, utm_source, utm_medium, utm_campaign, utm_content).run()
  } catch (e: any) {
    console.error('[contact/lead insert]', e?.message)
    return c.json({ error: 'Failed to save lead' }, 500)
  }

  notifySalesNewLead(c.env, {
    source: 'contact_form',
    name, email, phone, company,
    extra: { employees, interest, message, utm_source, utm_medium, utm_campaign }
  }).catch((e: any) => console.error('[contact/lead] email notification failed:', e?.message || e))

  return c.json({ success: true })
})

// Condo / Reserve Fund Cheat Sheet lead
leadCaptureRoutes.post('/condo-lead', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const v = validateLeadInput(body)
  if (!v.ok) return c.json({ error: v.error }, 400)
  await ensureLeadTable(c.env.DB)

  const name = body.name ? String(body.name).trim().slice(0, 150) : null
  const company = body.company ? String(body.company).trim().slice(0, 200) : null

  await c.env.DB.prepare(
    `INSERT INTO asset_report_leads (email, name, company, source, tag) VALUES (?, ?, ?, 'condo_cheat_sheet', 'condo_board_interest')`
  ).bind(String(body.email).toLowerCase().trim(), name, company).run()

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
      await sendGmailEmail(c.env.GCP_SERVICE_ACCOUNT_JSON, String(body.email), subject, html, 'sales@roofmanager.ca').catch((e) => console.warn("[silent-catch]", (e && e.message) || e))
    }
  } catch (e) { console.log('[condo-lead email]', (e as any).message) }

  notifySalesNewLead(c.env, {
    source: 'condo_cheat_sheet',
    name, email: body.email, company
  }).catch((e: any) => console.error('[condo-lead] email notification failed:', e?.message || e))

  return c.json({ success: true, redirect: '/condo-reserve-fund-cheat-sheet/thank-you' })
})

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { resolveTeamOwner } from './team'
import { trackLeadCapture } from '../services/ga4-events'
import { sendGmailOAuth2, sendViaResend, sendGmailEmail } from '../services/email'
import { sendMetaConversion } from './meta-connect'

export const agentsRoutes = new Hono<{ Bindings: Bindings }>()

// ── Auth helper ──
async function getCustomer(c: any): Promise<{ id: number; email: string; ownerId: number } | null> {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const s = await c.env.DB.prepare(
    "SELECT cs.customer_id, cu.email FROM customer_sessions cs JOIN customers cu ON cu.id=cs.customer_id WHERE cs.session_token=? AND cs.expires_at>datetime('now')"
  ).bind(token).first<any>()
  if (!s) return null
  const t = await resolveTeamOwner(c.env.DB, s.customer_id)
  return { id: s.customer_id, email: s.email, ownerId: t.ownerId }
}

// ============================================================
// LEAD CAPTURE — Public endpoint, no auth
// ============================================================
agentsRoutes.post('/leads', async (c) => {
  try {
    const { name, company_name, phone, email, source_page, message, address, utm_source, website } = await c.req.json()
    // Honeypot anti-spam: if hidden "website" field is filled, silently accept but don't save
    if (website) return c.json({ success: true })
    if (!email) return c.json({ error: 'Email is required' }, 400)
    const emailClean = String(email).trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailClean)) return c.json({ error: 'Invalid email' }, 400)
    const cleanName = name ? String(name).trim().slice(0, 200) : 'Website Visitor'

    await c.env.DB.prepare(
      `INSERT INTO leads (name, company_name, phone, email, source_page, message, address, utm_source) VALUES (?,?,?,?,?,?,?,?)`
    ).bind(
      cleanName,
      company_name ? String(company_name).trim().slice(0, 200) : '',
      phone ? String(phone).trim().slice(0, 30) : '',
      emailClean,
      source_page || 'unknown',
      message ? String(message).trim().slice(0, 2000) : '',
      address ? String(address).trim().slice(0, 500) : '',
      utm_source ? String(utm_source).trim().slice(0, 100) : ''
    ).run()

    // Track lead capture in GA4
    trackLeadCapture(c.env, source_page || 'unknown', {
      lead_name: cleanName.substring(0, 50),
      lead_company: company_name ? String(company_name).trim().substring(0, 50) : '',
      lead_email_domain: emailClean.split('@')[1] || 'unknown'
    }).catch((e) => console.warn("[silent-catch]", (e && e.message) || e))

    // Fire server-side Meta Conversions API Lead event (non-blocking)
    sendMetaConversion(c.env, {
      eventName: 'Lead',
      email: emailClean,
      phone: phone ? String(phone).trim() : undefined,
      sourcePage: source_page || 'unknown',
      sourceUrl: `https://www.roofmanager.ca/${source_page || ''}`,
      customData: { content_name: source_page || 'website', lead_type: 'contact_form' },
    }).catch((e) => console.warn('[Meta CAPI lead]', (e && e.message) || e))

    // Email notification to sales@roofmanager.ca — 3-tier fallback
    const leadSubject = `🔔 New Lead: ${cleanName} — ${source_page || 'website'}`
    const leadHtml = `
<div style="max-width:600px;margin:0 auto;font-family:Inter,system-ui,sans-serif">
  <div style="background:#0f172a;padding:24px;border-radius:12px 12px 0 0">
    <h1 style="color:#38bdf8;font-size:18px;margin:0">🔔 New Lead from Roof Manager</h1>
    <p style="color:#94a3b8;font-size:13px;margin:4px 0 0">Source: ${source_page || 'website'}</p>
  </div>
  <div style="background:white;padding:24px;border:1px solid #e2e8f0;border-top:none">
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:100px"><strong>Name</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b">${cleanName}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;font-size:13px"><strong>Email</strong></td><td style="padding:8px 0;font-size:14px"><a href="mailto:${emailClean}" style="color:#0ea5e9">${emailClean}</a></td></tr>
      ${phone ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px"><strong>Phone</strong></td><td style="padding:8px 0;font-size:14px"><a href="tel:${String(phone).trim()}" style="color:#0ea5e9">${String(phone).trim()}</a></td></tr>` : ''}
      ${company_name ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px"><strong>Company</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b">${String(company_name).trim()}</td></tr>` : ''}
      ${address ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px"><strong>Address</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b">${String(address).trim()}</td></tr>` : ''}
      ${message ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;vertical-align:top"><strong>Message</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b">${String(message).trim()}</td></tr>` : ''}
      ${utm_source ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px"><strong>Source</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b">${String(utm_source).trim()}</td></tr>` : ''}
    </table>
  </div>
  <div style="background:#f8fafc;padding:16px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0;border-top:none;text-align:center">
    <a href="https://www.roofmanager.ca/super-admin" style="color:#0ea5e9;font-size:12px;font-weight:600">View in Super Admin Dashboard</a>
  </div>
</div>`

    // Strategy 1: Gmail OAuth2
    let emailSent = false
    const clientId = (c.env as any).GMAIL_CLIENT_ID
    let clientSecret = (c.env as any).GMAIL_CLIENT_SECRET || ''
    let refreshToken = (c.env as any).GMAIL_REFRESH_TOKEN || ''
    if (!refreshToken || !clientSecret) {
      try {
        const dbRefresh = await c.env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key = 'gmail_refresh_token' AND master_company_id = 1").first<any>()
        if (dbRefresh?.setting_value) refreshToken = dbRefresh.setting_value
        const dbSecret = await c.env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key = 'gmail_client_secret' AND master_company_id = 1").first<any>()
        if (dbSecret?.setting_value) clientSecret = dbSecret.setting_value
      } catch {}
    }
    if (clientId && clientSecret && refreshToken) {
      try {
        await sendGmailOAuth2(clientId, clientSecret, refreshToken, 'sales@roofmanager.ca', leadSubject, leadHtml, 'sales@roofmanager.ca')
        emailSent = true
        console.log('[Lead Email] sent via Gmail OAuth2')
      } catch (e: any) {
        console.error('[Lead Email] Gmail OAuth2 failed:', e?.message || e)
      }
    } else {
      console.warn('[Lead Email] Gmail OAuth2 credentials missing')
    }

    // Strategy 2: Resend API fallback
    if (!emailSent && (c.env as any).RESEND_API_KEY) {
      try {
        await sendViaResend((c.env as any).RESEND_API_KEY, 'sales@roofmanager.ca', leadSubject, leadHtml)
        emailSent = true
        console.log('[Lead Email] sent via Resend fallback')
      } catch (e: any) {
        console.error('[Lead Email] Resend fallback failed:', e?.message || e)
      }
    }

    // Strategy 3: GCP Service Account Gmail API fallback
    if (!emailSent && (c.env as any).GCP_SERVICE_ACCOUNT_JSON) {
      try {
        await sendGmailEmail((c.env as any).GCP_SERVICE_ACCOUNT_JSON, 'sales@roofmanager.ca', leadSubject, leadHtml, 'sales@roofmanager.ca')
        emailSent = true
        console.log('[Lead Email] sent via GCP Service Account')
      } catch (e: any) {
        console.error('[Lead Email] GCP Service Account failed:', e?.message || e)
      }
    }

    if (!emailSent) {
      console.error('[Lead Email] ALL methods failed — lead notification for', emailClean, 'was NOT delivered')
    }

    return c.json({ success: true, message: 'Thank you! We will be in touch shortly.' })
  } catch (e: any) {
    return c.json({ error: 'Failed to submit', details: e.message }, 500)
  }
})

// GET /leads — Admin only
agentsRoutes.get('/leads', async (c) => {
  const cust = await getCustomer(c)
  if (!cust) return c.json({ error: 'Auth required' }, 401)
  const page = parseInt(c.req.query('page') || '1')
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100)
  const offset = (page - 1) * limit
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM leads ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).bind(limit, offset).all<any>()
  const countRow = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM leads').first<any>()
  return c.json({ leads: results, total: countRow?.cnt || 0, page, limit })
})

// ============================================================
// AUTO-EMAIL PREFERENCE
// ============================================================
agentsRoutes.get('/auto-email', async (c) => {
  const cust = await getCustomer(c)
  if (!cust) return c.json({ error: 'Auth required' }, 401)
  const row = await c.env.DB.prepare('SELECT auto_email_reports FROM customers WHERE id=?').bind(cust.ownerId).first<any>()
  return c.json({ auto_email_reports: row?.auto_email_reports === 1 })
})

agentsRoutes.post('/auto-email', async (c) => {
  const cust = await getCustomer(c)
  if (!cust) return c.json({ error: 'Auth required' }, 401)
  const { enabled } = await c.req.json()
  await c.env.DB.prepare(
    "UPDATE customers SET auto_email_reports=?, updated_at=datetime('now') WHERE id=?"
  ).bind(enabled ? 1 : 0, cust.ownerId).run()
  return c.json({ success: true, auto_email_reports: !!enabled })
})

// ============================================================
// AGENT CONFIG — Serve config to LiveKit agents (public, keyed by customer_id)
// ============================================================
agentsRoutes.get('/agent-config/:customerId', async (c) => {
  const customerId = parseInt(c.req.param('customerId'))
  if (!customerId) return c.json({ error: 'Invalid customer ID' }, 400)
  try {
    const config = await c.env.DB.prepare(
      'SELECT * FROM secretary_config WHERE customer_id=?'
    ).bind(customerId).first<any>()
    if (!config) return c.json({ error: 'No config' }, 404)
    const dirs = await c.env.DB.prepare(
      'SELECT name, phone_or_action, special_notes FROM secretary_directories WHERE config_id=? ORDER BY sort_order'
    ).bind(config.id).all<any>()
    const customer = await c.env.DB.prepare('SELECT name, email, company_name FROM customers WHERE id=?').bind(customerId).first<any>()
    return c.json({
      customer_id: customerId,
      business_phone: config.business_phone || '',
      greeting_script: config.greeting_script || '',
      common_qa: config.common_qa || '',
      general_notes: config.general_notes || '',
      agent_name: config.agent_name || 'Sarah',
      directories: dirs.results || [],
      company_name: customer?.company_name || customer?.name || '',
    })
  } catch (e: any) { console.error('[AgentConfig]', e.message); return c.json({ error: 'Config not available' }, 500) }
})

// ============================================================
// REPORT DATA — Serve report data to Interactive Report Agent
// ============================================================
agentsRoutes.get('/report-data/:orderId', async (c) => {
  const orderId = c.req.param('orderId')
  try {
    const report = await c.env.DB.prepare(
      `SELECT r.api_response_raw, r.roof_segments, r.edge_measurements, r.material_estimate,
              r.gross_squares, r.total_area_sqft, r.waste_factor_pct, r.bundle_count,
              o.property_address, o.property_city, o.property_province
       FROM reports r JOIN orders o ON o.id=r.order_id WHERE r.order_id=?`
    ).bind(orderId).first<any>()
    if (!report) return c.json({ error: 'Report not found' }, 404)

    let parsed: any = {}
    try { parsed = typeof report.api_response_raw === 'string' ? JSON.parse(report.api_response_raw) : report.api_response_raw } catch {}

    return c.json({
      order_id: orderId,
      address: [report.property_address, report.property_city, report.property_province].filter(Boolean).join(', '),
      roof_area_sqft: report.total_area_sqft || parsed?.roof_area_sqft,
      gross_squares: report.gross_squares,
      waste_factor_pct: report.waste_factor_pct,
      bundle_count: report.bundle_count,
      segments: report.roof_segments ? JSON.parse(report.roof_segments) : parsed?.segments || [],
      edges: report.edge_measurements ? JSON.parse(report.edge_measurements) : {},
      materials: report.material_estimate ? JSON.parse(report.material_estimate) : parsed?.material_estimate || {},
      pitch: parsed?.roof_pitch || parsed?.roof_pitch_degrees,
      summary: parsed?.executive_summary || parsed?.summary || '',
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ============================================================
// SUPPLIER DIRECTORY — CRUD for procurement agent
// ============================================================
agentsRoutes.get('/suppliers', async (c) => {
  const cust = await getCustomer(c)
  if (!cust) return c.json({ error: 'Auth required' }, 401)
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM supplier_directory WHERE owner_id=? ORDER BY preferred DESC, name'
  ).bind(cust.ownerId).all<any>()
  return c.json({ suppliers: results })
})

agentsRoutes.post('/suppliers', async (c) => {
  const cust = await getCustomer(c)
  if (!cust) return c.json({ error: 'Auth required' }, 401)
  const { name, phone, email, address, city, province, supplier_type, preferred, notes } = await c.req.json()
  if (!name) return c.json({ error: 'Supplier name required' }, 400)
  const res = await c.env.DB.prepare(
    `INSERT INTO supplier_directory (owner_id, name, phone, email, address, city, province, supplier_type, preferred, notes) VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(cust.ownerId, name, phone||'', email||'', address||'', city||'', province||'', supplier_type||'general', preferred?1:0, notes||'').run()
  return c.json({ success: true, id: res.meta.last_row_id })
})

// ============================================================
// QA FOLLOW-UPS — Schedule + manage post-install calls
// ============================================================
agentsRoutes.get('/qa-followups', async (c) => {
  const cust = await getCustomer(c)
  if (!cust) return c.json({ error: 'Auth required' }, 401)
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM qa_followups WHERE owner_id=? ORDER BY scheduled_at DESC'
  ).bind(cust.ownerId).all<any>()
  return c.json({ followups: results })
})

agentsRoutes.post('/qa-followups', async (c) => {
  const cust = await getCustomer(c)
  if (!cust) return c.json({ error: 'Auth required' }, 401)
  const { job_id, crm_customer_id, homeowner_name, homeowner_phone, scheduled_at } = await c.req.json()
  if (!homeowner_phone) return c.json({ error: 'Phone required' }, 400)
  const res = await c.env.DB.prepare(
    `INSERT INTO qa_followups (owner_id, job_id, crm_customer_id, homeowner_name, homeowner_phone, scheduled_at) VALUES (?,?,?,?,?,?)`
  ).bind(cust.ownerId, job_id||null, crm_customer_id||null, homeowner_name||'', homeowner_phone, scheduled_at||null).run()
  return c.json({ success: true, id: res.meta.last_row_id })
})

// ============================================================
// AGENT INTERACTION LOG
// ============================================================
agentsRoutes.post('/interactions', async (c) => {
  const { agent_type, customer_id, reference_id, room_name, caller_phone, summary, transcript, outcome, duration_seconds, metadata } = await c.req.json()
  if (!agent_type) return c.json({ error: 'agent_type required' }, 400)
  await c.env.DB.prepare(
    `INSERT INTO agent_interactions (agent_type, customer_id, reference_id, room_name, caller_phone, summary, transcript, outcome, duration_seconds, metadata) VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(agent_type, customer_id||null, reference_id||'', room_name||'', caller_phone||'', summary||'', transcript||'', outcome||'completed', duration_seconds||0, metadata ? JSON.stringify(metadata) : '').run()
  return c.json({ success: true })
})

// ============================================================
// LIVEKIT TOKEN — Generate token for web voice widget
// ============================================================
agentsRoutes.post('/livekit-token', async (c) => {
  const apiKey = (c.env as any).LIVEKIT_API_KEY
  const apiSecret = (c.env as any).LIVEKIT_API_SECRET
  const livekitUrl = (c.env as any).LIVEKIT_URL
  if (!apiKey || !apiSecret) return c.json({ error: 'LiveKit not configured' }, 500)

  const { room_name, identity, metadata } = await c.req.json()
  if (!room_name || !identity) return c.json({ error: 'room_name and identity required' }, 400)

  // Build JWT token
  function b64url(data: any): string {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
    let binary = ''
    bytes.forEach((b: number) => binary += String.fromCharCode(b))
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({
    iss: apiKey, sub: identity, iat: now, exp: now + 3600, nbf: now,
    video: { room: room_name, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
    metadata: metadata || '',
  }))
  const sigInput = `${header}.${payload}`
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(sigInput))
  const token = `${header}.${payload}.${b64url(sig)}`

  return c.json({ token, url: livekitUrl, room: room_name, identity })
})

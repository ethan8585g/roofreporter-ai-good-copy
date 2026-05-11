/**
 * Super Admin — Leads Inbox API
 * Mounted at /api/admin/leads
 *
 *   GET    /              — list leads with filters + counts
 *   GET    /:id           — single lead (all columns)
 *   PATCH  /:id           — update status / priority / admin_notes
 *   POST   /:id/send-report — admin composes & sends a report email to the lead
 *   POST   /export        — CSV export of current filter set
 *
 * All endpoints require a valid admin session AND role === 'superadmin'.
 */
import { Hono } from 'hono'
import { validateAdminSession, requireSuperadmin } from './auth'
import { logEmailSend, markEmailFailed, buildTrackingPixel, wrapEmailLinks } from '../services/email-tracking'
import {
  sendGmailOAuth2, sendGmailOAuth2WithAttachment, sendViaResend, sendGmailEmail, buildEmailWrapper
} from '../services/email'

type Bindings = { DB: D1Database; [key: string]: any }
const superAdminLeads = new Hono<{ Bindings: Bindings }>()

const ALLOWED_STATUS = ['new', 'contacted', 'report_sent', 'converted', 'closed_lost']
const ALLOWED_PRIORITY = ['low', 'normal', 'high', 'urgent']
const ALLOWED_LEAD_TYPES = ['free_measurement_report', 'contact', 'demo', 'comparison', 'storm', 'hail', 'hurricane', 'other']
const ATTACHMENT_ALLOWED_HOSTS = [
  'storage.googleapis.com',
  'www.roofmanager.ca',
  'roofmanager.ca',
]
// also permit any *.r2.dev and the configured R2 bucket host via env
const ATTACHMENT_ALLOWED_SUFFIXES = ['.r2.dev', '.r2.cloudflarestorage.com']

// Auth middleware — superadmin only
superAdminLeads.use('/*', async (c, next) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin) return c.json({ error: 'Admin authentication required' }, 401)
  if (!requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  c.set('admin' as any, admin)
  return next()
})

// ── LIST ──
superAdminLeads.get('/', async (c) => {
  try {
    const status = (c.req.query('status') || '').trim()
    const leadType = (c.req.query('lead_type') || '').trim()
    const priority = (c.req.query('priority') || '').trim()
    const q = (c.req.query('q') || '').trim()
    const since = (c.req.query('since') || '').trim()
    const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50', 10) || 50, 1), 200)
    const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0)

    const where: string[] = ['1=1']
    const binds: any[] = []
    if (status && ALLOWED_STATUS.includes(status)) { where.push('status = ?'); binds.push(status) }
    if (leadType && ALLOWED_LEAD_TYPES.includes(leadType)) { where.push('lead_type = ?'); binds.push(leadType) }
    if (priority && ALLOWED_PRIORITY.includes(priority)) { where.push('priority = ?'); binds.push(priority) }
    if (q) {
      where.push('(LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(COALESCE(address,\'\')) LIKE ? OR LOWER(COALESCE(phone,\'\')) LIKE ?)')
      const pat = '%' + q.toLowerCase() + '%'
      binds.push(pat, pat, pat, pat)
    }
    if (since) { where.push('created_at > ?'); binds.push(since) }

    const whereSql = where.join(' AND ')
    // Phase 3 #12: status counts must respect the same filter as the list,
    // otherwise the tab badges report global totals while the table shows
    // search-filtered rows. Build a per-status counts WHERE that excludes
    // the status filter itself (we want every status bucket back, even when
    // the user is filtering for a specific one).
    const countsWhereParts = ['1=1']
    const countsBinds: any[] = []
    if (leadType && ALLOWED_LEAD_TYPES.includes(leadType)) { countsWhereParts.push('lead_type = ?'); countsBinds.push(leadType) }
    if (priority && ALLOWED_PRIORITY.includes(priority)) { countsWhereParts.push('priority = ?'); countsBinds.push(priority) }
    if (q) {
      countsWhereParts.push('(LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(COALESCE(address,\'\')) LIKE ? OR LOWER(COALESCE(phone,\'\')) LIKE ?)')
      const pat = '%' + q.toLowerCase() + '%'
      countsBinds.push(pat, pat, pat, pat)
    }
    if (since) { countsWhereParts.push('created_at > ?'); countsBinds.push(since) }
    const countsWhereSql = countsWhereParts.join(' AND ')
    const listStmt = c.env.DB.prepare(
      `SELECT * FROM leads WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset)
    const countStmt = c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM leads WHERE ${whereSql}`).bind(...binds)
    const countsStmt = c.env.DB.prepare(`SELECT status, COUNT(*) as cnt FROM leads WHERE ${countsWhereSql} GROUP BY status`).bind(...countsBinds)

    const [listRes, countRes, countsRes] = await c.env.DB.batch([listStmt, countStmt, countsStmt]) as any[]

    const leads = (listRes.results || []) as any[]
    const total = (countRes.results?.[0]?.cnt as number) || 0
    const counts: Record<string, number> = { new: 0, contacted: 0, report_sent: 0, converted: 0, closed_lost: 0 }
    for (const row of (countsRes.results || []) as any[]) {
      const s = String(row.status || '')
      if (s in counts) counts[s] = row.cnt as number
    }

    return c.json({ leads, total, counts })
  } catch (e: any) {
    console.error('[super-admin-leads] list error:', e?.message || e)
    return c.json({ error: e?.message || 'List failed' }, 500)
  }
})

// ── EXPORT CSV (POST because filter body may be large; also works with GET-like query) ──
superAdminLeads.post('/export', async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as any
    const status = (body.status || '').trim()
    const leadType = (body.lead_type || '').trim()
    const priority = (body.priority || '').trim()
    const q = (body.q || '').trim()

    const where: string[] = ['1=1']
    const binds: any[] = []
    if (status && ALLOWED_STATUS.includes(status)) { where.push('status = ?'); binds.push(status) }
    if (leadType && ALLOWED_LEAD_TYPES.includes(leadType)) { where.push('lead_type = ?'); binds.push(leadType) }
    if (priority && ALLOWED_PRIORITY.includes(priority)) { where.push('priority = ?'); binds.push(priority) }
    if (q) {
      where.push('(LOWER(name) LIKE ? OR LOWER(email) LIKE ? OR LOWER(COALESCE(address,\'\')) LIKE ?)')
      const pat = '%' + q.toLowerCase() + '%'
      binds.push(pat, pat, pat)
    }
    const { results } = await c.env.DB.prepare(
      `SELECT id, created_at, status, priority, lead_type, name, email, phone, company_name, address, source_page, utm_source, utm_medium, utm_campaign, report_sent_at FROM leads WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 10000`
    ).bind(...binds).all<any>()

    const cols = ['id', 'created_at', 'status', 'priority', 'lead_type', 'name', 'email', 'phone', 'company_name', 'address', 'source_page', 'utm_source', 'utm_medium', 'utm_campaign', 'report_sent_at']
    const esc = (v: any) => {
      if (v === null || v === undefined) return ''
      const s = String(v)
      if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
      return s
    }
    const lines = [cols.join(',')]
    for (const row of (results || [])) lines.push(cols.map((k) => esc((row as any)[k])).join(','))
    const csv = lines.join('\r\n')
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`
      }
    })
  } catch (e: any) {
    return c.json({ error: e?.message || 'Export failed' }, 500)
  }
})

// ── GET SINGLE ──
superAdminLeads.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (!id || id <= 0) return c.json({ error: 'Invalid id' }, 400)
  const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<any>()
  if (!lead) return c.json({ error: 'Not found' }, 404)
  return c.json({ lead })
})

// ── PATCH (status / priority / admin_notes) ──
superAdminLeads.patch('/:id', async (c) => {
  try {
    const id = parseInt(c.req.param('id'), 10)
    if (!id || id <= 0) return c.json({ error: 'Invalid id' }, 400)
    const body = await c.req.json()
    const sets: string[] = []
    const binds: any[] = []
    if (typeof body.status === 'string') {
      if (!ALLOWED_STATUS.includes(body.status)) return c.json({ error: 'Invalid status' }, 400)
      sets.push('status = ?'); binds.push(body.status)
    }
    if (typeof body.priority === 'string') {
      if (!ALLOWED_PRIORITY.includes(body.priority)) return c.json({ error: 'Invalid priority' }, 400)
      sets.push('priority = ?'); binds.push(body.priority)
    }
    if (typeof body.admin_notes === 'string') {
      sets.push('admin_notes = ?'); binds.push(body.admin_notes.slice(0, 10000))
    }
    if (sets.length === 0) return c.json({ error: 'No updatable fields provided' }, 400)
    sets.push(`updated_at = datetime('now')`)
    binds.push(id)
    await c.env.DB.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run()
    const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<any>()
    return c.json({ success: true, lead })
  } catch (e: any) {
    return c.json({ error: e?.message || 'Update failed' }, 500)
  }
})

function isAttachmentUrlAllowed(raw: string, extraHost?: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    if (ATTACHMENT_ALLOWED_HOSTS.includes(host)) return true
    if (ATTACHMENT_ALLOWED_SUFFIXES.some((s) => host.endsWith(s))) return true
    if (extraHost && host === extraHost.toLowerCase()) return true
    return false
  } catch { return false }
}

// ── SEND REPORT EMAIL ──
superAdminLeads.post('/:id/send-report', async (c) => {
  try {
    const admin = (c.get as any)('admin')
    const id = parseInt(c.req.param('id'), 10)
    if (!id || id <= 0) return c.json({ error: 'Invalid id' }, 400)
    const { subject, body_html, attachment_url } = await c.req.json()
    if (!subject || typeof subject !== 'string' || subject.length < 1 || subject.length > 200) {
      return c.json({ error: 'Subject must be 1–200 chars' }, 400)
    }
    if (!body_html || typeof body_html !== 'string' || body_html.length < 1 || body_html.length > 50000) {
      return c.json({ error: 'Body must be 1–50000 chars' }, 400)
    }
    let attachmentUrl: string | null = null
    if (attachment_url) {
      if (typeof attachment_url !== 'string' || !isAttachmentUrlAllowed(attachment_url, (c.env as any).R2_PUBLIC_HOST)) {
        return c.json({ error: 'Attachment URL must be HTTPS on an approved host (storage.googleapis.com, *.r2.dev, *.r2.cloudflarestorage.com, roofmanager.ca)' }, 400)
      }
      attachmentUrl = attachment_url
    }

    const lead = await c.env.DB.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first<any>()
    if (!lead) return c.json({ error: 'Lead not found' }, 404)
    if (!lead.email) return c.json({ error: 'Lead has no email' }, 400)

    const addressLabel = lead.address ? String(lead.address) : 'your property'
    const reportNum = `RM-${lead.id}`
    const baseWrappedHtml = buildEmailWrapper(body_html, addressLabel, reportNum, lead.email)
    // Tracking: super-admin manual lead send. customerId null since leads
    // aren't customers yet. kind tags it so Journey > Email Tracking groups
    // these distinctly from automated outreach.
    const adminLeadToken = await logEmailSend(c.env as any, { customerId: null, recipient: lead.email, kind: 'admin_lead_outreach', subject })
    const adminLeadPixel = buildTrackingPixel(adminLeadToken)
    const wrappedHtmlWithPixel = baseWrappedHtml.includes('</body>') ? baseWrappedHtml.replace('</body>', `${adminLeadPixel}</body>`) : baseWrappedHtml + adminLeadPixel
    const wrappedHtml = wrapEmailLinks(wrappedHtmlWithPixel, adminLeadToken)

    // Try to fetch and attach the PDF; if fetch fails, fall back to URL link in body.
    let attachmentBytes: Uint8Array | null = null
    let attachmentFilename = 'roof-measurement-report.pdf'
    let attachmentMime = 'application/pdf'
    if (attachmentUrl) {
      try {
        const resp = await fetch(attachmentUrl, { signal: AbortSignal.timeout(15000) })
        if (resp.ok) {
          const ab = await resp.arrayBuffer()
          attachmentBytes = new Uint8Array(ab)
          const ct = resp.headers.get('content-type') || ''
          if (ct) attachmentMime = ct.split(';')[0].trim()
          const urlPath = new URL(attachmentUrl).pathname
          const fn = urlPath.split('/').pop()
          if (fn) attachmentFilename = fn
        } else {
          console.warn('[send-report] attachment fetch non-ok:', resp.status)
        }
      } catch (e: any) {
        console.warn('[send-report] attachment fetch failed:', e?.message || e)
      }
    }

    const senderEmail = 'sales@roofmanager.ca'
    let sent = false
    let providerUsed = ''
    const cid = (c.env as any).GMAIL_CLIENT_ID
    let csec = (c.env as any).GMAIL_CLIENT_SECRET || ''
    let rtok = (c.env as any).GMAIL_REFRESH_TOKEN || ''
    if (!csec || !rtok) {
      try {
        const r = await c.env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_refresh_token' AND master_company_id=1").first<any>()
        if (r?.setting_value) rtok = r.setting_value
        const s = await c.env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_client_secret' AND master_company_id=1").first<any>()
        if (s?.setting_value) csec = s.setting_value
      } catch {}
    }

    // Primary: Gmail OAuth2 (with attachment if available, else plain)
    if (cid && csec && rtok) {
      try {
        if (attachmentBytes) {
          await sendGmailOAuth2WithAttachment(
            cid, csec, rtok, lead.email, subject, wrappedHtml,
            { filename: attachmentFilename, mimeType: attachmentMime, bytes: attachmentBytes },
            senderEmail, senderEmail
          )
        } else {
          await sendGmailOAuth2(cid, csec, rtok, lead.email, subject, wrappedHtml, senderEmail)
        }
        sent = true
        providerUsed = 'gmail_oauth2'
      } catch (e: any) {
        console.warn('[send-report] Gmail OAuth2 failed:', e?.message || e)
      }
    }

    // Fallback: Resend — no multipart attachments here; embed URL in body if attachment was requested.
    if (!sent && (c.env as any).RESEND_API_KEY) {
      try {
        const htmlWithLink = attachmentUrl
          ? wrappedHtml + `<p style="padding:16px 28px;font-size:13px;color:#374151">Your report PDF is available at: <a href="${attachmentUrl}">${attachmentUrl}</a></p>`
          : wrappedHtml
        await sendViaResend((c.env as any).RESEND_API_KEY, lead.email, subject, htmlWithLink, senderEmail)
        sent = true
        providerUsed = 'resend'
      } catch (e: any) {
        console.warn('[send-report] Resend fallback failed:', e?.message || e)
      }
    }

    // Last resort: GCP service-account Gmail
    if (!sent && (c.env as any).GCP_SERVICE_ACCOUNT_JSON) {
      try {
        await sendGmailEmail((c.env as any).GCP_SERVICE_ACCOUNT_JSON, lead.email, subject, wrappedHtml, senderEmail)
        sent = true
        providerUsed = 'gcp_sa'
      } catch (e: any) {
        console.warn('[send-report] GCP SA failed:', e?.message || e)
      }
    }

    if (!sent) {
      await markEmailFailed(c.env as any, adminLeadToken, 'all transports failed')
      return c.json({ error: 'All email providers failed' }, 500)
    }

    const sentAt = new Date().toISOString()
    const noteAppend = `\n[${sentAt}] Report sent by admin ${admin?.email || admin?.id || 'unknown'} — subject: "${subject.slice(0, 120)}" (via ${providerUsed})`
    await c.env.DB.prepare(
      `UPDATE leads
         SET status = 'report_sent',
             report_sent_at = ?,
             report_sent_by = ?,
             admin_notes = COALESCE(admin_notes, '') || ?,
             updated_at = datetime('now')
       WHERE id = ?`
    ).bind(sentAt, admin?.id || null, noteAppend, id).run()

    return c.json({ success: true, sent_at: sentAt, provider: providerUsed })
  } catch (e: any) {
    console.error('[super-admin-leads] send-report error:', e?.message || e)
    return c.json({ error: e?.message || 'Send failed' }, 500)
  }
})

export { superAdminLeads }

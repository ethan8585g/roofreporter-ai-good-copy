// ============================================================
// Super Admin — Email Tracker
// Mounted at /super-admin/email-tracker (HTML) and
// /api/super-admin/email-tracker/* (JSON). Superadmin only.
//
// Unified dashboard for every email the platform sends or receives:
//   - email_sends rows (welcome, nurture, cart-recovery, lead alerts,
//     health alerts, admin-composer messages, manual Gmail mirror)
//   - email_deliveries rows (report + invoice deliveries with Resend
//     webhook reconciliation)
//   - leads rows (website-form lead submissions = inbound surface)
//   - resend_webhook_events rows (bounces, complaints, opens, clicks)
//
// Actions: view body, re-send a failed row, mark recipient as
// suppressed, compose a new email from sales@/support@ with optional
// PDF attachments.
// ============================================================

import { Hono } from 'hono'
import { validateAdminSession, requireSuperadmin } from './auth'
import { logAndSendEmail, resendEmail } from '../services/email-wrapper'
import { renderCustomerReportPdf } from '../services/email'

type Bindings = { DB: D1Database; [k: string]: any }

export const superAdminEmailTracker = new Hono<{ Bindings: Bindings }>()

// ── Session gate (superadmin only) ───────────────────────────
superAdminEmailTracker.use('*', async (c, next) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) {
    if (c.req.path.includes('/api/')) return c.json({ error: 'superadmin required' }, 403)
    return c.redirect('/login?next=' + encodeURIComponent(c.req.path), 302)
  }
  ;(c as any).set('admin', admin)
  await next()
})

// ── JSON: stats for the header bar ───────────────────────────
superAdminEmailTracker.get('/api/super-admin/email-tracker/stats', async (c) => {
  const today = await c.env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN status='suppressed' THEN 1 ELSE 0 END) AS suppressed,
      SUM(CASE WHEN status='deduped' THEN 1 ELSE 0 END) AS deduped,
      SUM(CASE WHEN open_count > 0 THEN 1 ELSE 0 END) AS opened,
      SUM(open_count) AS open_events,
      SUM(click_count) AS click_events
    FROM email_sends
    WHERE sent_at >= datetime('now','-1 day')
  `).first<any>()

  const sevenDay = await c.env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
      SUM(open_count) AS open_events,
      SUM(click_count) AS click_events
    FROM email_sends
    WHERE sent_at >= datetime('now','-7 days')
  `).first<any>()

  const byCategory = await c.env.DB.prepare(`
    SELECT COALESCE(category,'(none)') AS category, COUNT(*) AS n
    FROM email_sends
    WHERE sent_at >= datetime('now','-1 day')
    GROUP BY category
    ORDER BY n DESC
  `).all<any>()

  const leadsToday = await c.env.DB.prepare(`
    SELECT COUNT(*) AS n FROM leads WHERE created_at >= datetime('now','-1 day')
  `).first<any>()

  const suppressionsActive = await c.env.DB.prepare(`
    SELECT COUNT(*) AS n FROM email_suppressions WHERE released_at IS NULL
  `).first<any>()

  return c.json({
    today: today || {},
    seven_day: sevenDay || {},
    by_category_today: byCategory?.results || [],
    leads_today: Number(leadsToday?.n || 0),
    suppressions_active: Number(suppressionsActive?.n || 0),
  })
})

// ── JSON: unified feed (email_sends ∪ email_deliveries) ──────
superAdminEmailTracker.get('/api/super-admin/email-tracker/feed', async (c) => {
  const url = new URL(c.req.url)
  const category = url.searchParams.get('category') || ''
  const status = url.searchParams.get('status') || ''
  const recipient = url.searchParams.get('recipient') || ''
  const kind = url.searchParams.get('kind') || ''
  const since = url.searchParams.get('since') || '' // ISO datetime
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 500)

  const wheres: string[] = []
  const binds: any[] = []
  if (category) { wheres.push('category = ?'); binds.push(category) }
  if (status) { wheres.push('status = ?'); binds.push(status) }
  if (recipient) { wheres.push('LOWER(recipient) LIKE ?'); binds.push('%' + recipient.toLowerCase() + '%') }
  if (kind) { wheres.push('kind = ?'); binds.push(kind) }
  if (since) { wheres.push('sent_at >= ?'); binds.push(since) }
  const whereSql = wheres.length ? 'WHERE ' + wheres.join(' AND ') : ''

  const sends = await c.env.DB.prepare(`
    SELECT
      'email_sends' AS src,
      id, recipient, kind, subject, category, status,
      from_addr, customer_id, order_id, retry_of_id,
      open_count, last_opened_at,
      click_count, last_clicked_at, last_clicked_url,
      send_error, provider_message_id, source, sent_at
    FROM email_sends
    ${whereSql}
    ORDER BY sent_at DESC
    LIMIT ?
  `).bind(...binds, limit).all<any>()

  // Also pull email_deliveries (reports/invoices that bypass email_sends).
  // Map to a common shape; we deliberately don't dedupe — they're different
  // tables tracking different things, and showing both is informative.
  const deliveries = await c.env.DB.prepare(`
    SELECT
      'email_deliveries' AS src,
      id, recipient, 'report_or_invoice' AS kind, subject,
      'customer' AS category, status,
      sender_email AS from_addr, NULL AS customer_id, order_id, NULL AS retry_of_id,
      0 AS open_count, NULL AS last_opened_at,
      0 AS click_count, NULL AS last_clicked_at, NULL AS last_clicked_url,
      error_message AS send_error, provider_message_id, 'platform' AS source,
      COALESCE(created_at, datetime('now')) AS sent_at
    FROM email_deliveries
    WHERE created_at >= datetime('now','-30 days')
    ORDER BY created_at DESC
    LIMIT 200
  `).all<any>()

  // Merge + sort
  const merged = [...(sends.results || []), ...(deliveries.results || [])]
    .sort((a: any, b: any) => String(b.sent_at).localeCompare(String(a.sent_at)))
    .slice(0, limit)

  return c.json({ rows: merged })
})

// ── JSON: inbound leads (website forms etc.) ─────────────────
superAdminEmailTracker.get('/api/super-admin/email-tracker/leads-inbound', async (c) => {
  const url = new URL(c.req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200)
  const rows = await c.env.DB.prepare(`
    SELECT id, name, email, phone, company_name, source_page, message, status, created_at
    FROM leads
    ORDER BY created_at DESC
    LIMIT ?
  `).bind(limit).all<any>()
  return c.json({ rows: rows.results || [] })
})

// ── JSON: webhook events (Resend bounces/complaints/etc.) ────
superAdminEmailTracker.get('/api/super-admin/email-tracker/webhook-events', async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT id, event_type, provider_message_id, recipient, payload, received_at
    FROM resend_webhook_events
    ORDER BY received_at DESC
    LIMIT 100
  `).all<any>()
  return c.json({ rows: rows.results || [] })
})

// ── JSON: full row + body for the detail modal ───────────────
superAdminEmailTracker.get('/api/super-admin/email-tracker/email/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (!id) return c.json({ error: 'invalid id' }, 400)
  const row = await c.env.DB.prepare(`
    SELECT * FROM email_sends WHERE id = ?
  `).bind(id).first<any>()
  if (!row) return c.json({ error: 'not found' }, 404)

  // Pull related rows: retries of this email + the original it retried (if any)
  const retries = await c.env.DB.prepare(`
    SELECT id, status, sent_at, send_error FROM email_sends WHERE retry_of_id = ? ORDER BY sent_at DESC
  `).bind(id).all<any>()

  let parent: any = null
  if (row.retry_of_id) {
    parent = await c.env.DB.prepare(
      `SELECT id, status, sent_at, subject FROM email_sends WHERE id = ?`
    ).bind(row.retry_of_id).first<any>()
  }

  return c.json({ row, retries: retries.results || [], parent })
})

// ── POST: resend a row ───────────────────────────────────────
superAdminEmailTracker.post('/api/super-admin/email-tracker/email/:id/resend', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (!id) return c.json({ error: 'invalid id' }, 400)
  const result = await resendEmail(c.env, id, { adminId: ((c as any).get('admin') as any)?.id || null })
  return c.json(result, result.ok ? 200 : 500)
})

// ── POST: compose + send a new email ─────────────────────────
superAdminEmailTracker.post('/api/super-admin/email-tracker/compose', async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    to?: string
    from?: string
    subject?: string
    html?: string
    customer_id?: number
    order_id?: number
    attach_report_pdf_for_order?: number  // pull customer-report PDF from this order_id
  }
  if (!body.to || !body.subject || !body.html) {
    return c.json({ error: 'to, subject, html required' }, 400)
  }

  const attachments: Array<{ filename: string; mimeType: string; bytes: Uint8Array }> = []
  if (body.attach_report_pdf_for_order) {
    try {
      const pdf = await renderCustomerReportPdf(c.env, body.attach_report_pdf_for_order)
      if (pdf) {
        attachments.push({
          filename: `Roof-Report-${body.attach_report_pdf_for_order}.pdf`,
          mimeType: 'application/pdf',
          bytes: pdf,
        })
      }
    } catch (e: any) {
      console.warn('[email-tracker compose] PDF attach failed:', e?.message || e)
    }
  }

  const result = await logAndSendEmail({
    env: c.env,
    to: body.to,
    from: body.from || 'sales@roofmanager.ca',
    subject: body.subject,
    html: body.html,
    kind: 'manual_compose',
    category: 'manual',
    customerId: body.customer_id || null,
    orderId: body.order_id || null,
    attachments: attachments.length ? attachments : undefined,
    skipDedup: true,
    source: 'composer',
  })
  return c.json(result, result.ok ? 200 : 500)
})

// ── JSON: suppressions list ──────────────────────────────────
superAdminEmailTracker.get('/api/super-admin/email-tracker/suppressions', async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT id, email, reason, notes, suppressed_at, suppressed_by_admin_id, released_at
    FROM email_suppressions
    ORDER BY suppressed_at DESC
    LIMIT 500
  `).all<any>()
  return c.json({ rows: rows.results || [] })
})

superAdminEmailTracker.post('/api/super-admin/email-tracker/suppressions', async (c) => {
  const admin = (c as any).get('admin') as any
  const body = await c.req.json().catch(() => ({})) as { email?: string; reason?: string; notes?: string }
  if (!body.email || !/.+@.+\..+/.test(body.email)) return c.json({ error: 'invalid email' }, 400)
  const email = body.email.trim().toLowerCase()
  const reason = (body.reason || 'manual').slice(0, 50)
  const notes = (body.notes || '').slice(0, 500) || null
  try {
    await c.env.DB.prepare(
      `INSERT INTO email_suppressions (email, reason, notes, suppressed_by_admin_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         reason = excluded.reason,
         notes = COALESCE(excluded.notes, email_suppressions.notes),
         released_at = NULL,
         suppressed_at = datetime('now'),
         suppressed_by_admin_id = excluded.suppressed_by_admin_id`
    ).bind(email, reason, notes, admin?.id || null).run()
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ error: e?.message || 'insert failed' }, 500)
  }
})

superAdminEmailTracker.delete('/api/super-admin/email-tracker/suppressions/:id', async (c) => {
  const admin = (c as any).get('admin') as any
  const id = parseInt(c.req.param('id'), 10)
  if (!id) return c.json({ error: 'invalid id' }, 400)
  await c.env.DB.prepare(
    `UPDATE email_suppressions
     SET released_at = datetime('now'), released_by_admin_id = ?
     WHERE id = ? AND released_at IS NULL`
  ).bind(admin?.id || null, id).run()
  return c.json({ ok: true })
})

// ── HTML: dashboard ──────────────────────────────────────────
superAdminEmailTracker.get('/super-admin/email-tracker', async (c) => {
  return c.html(renderDashboardHtml())
})

function renderDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Email Tracker — Roof Manager</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    --bg: #0a0a0a;
    --bg-card: #111111;
    --bg-elevated: #1a1a1a;
    --border: #262626;
    --text: #e5e5e5;
    --text-muted: #9CA3AF;
    --text-dim: #6B7280;
    --accent: #00CC6A;
    --warn: #F59E0B;
    --danger: #EF4444;
    --info: #3B82F6;
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,'Inter',Segoe UI,sans-serif; font-size:14px; }
  header { background:var(--bg-card); border-bottom:1px solid var(--border); padding:16px 24px; display:flex; align-items:center; justify-content:space-between; }
  header h1 { font-size:18px; margin:0; font-weight:700; }
  header .actions { display:flex; gap:8px; }
  .btn { background:var(--accent); color:#0a0a0a; border:none; padding:8px 14px; border-radius:8px; font-weight:600; font-size:13px; cursor:pointer; }
  .btn:hover { opacity:0.9; }
  .btn-secondary { background:var(--bg-elevated); color:var(--text); border:1px solid var(--border); }
  .btn-danger { background:var(--danger); color:#fff; }
  .container { padding:24px; max-width:1600px; margin:0 auto; }
  .stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(160px,1fr)); gap:12px; margin-bottom:24px; }
  .stat { background:var(--bg-card); border:1px solid var(--border); border-radius:10px; padding:14px 16px; }
  .stat-label { font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px; }
  .stat-value { font-size:22px; font-weight:700; }
  .stat-sub { font-size:11px; color:var(--text-dim); margin-top:2px; }
  .tabs { display:flex; gap:4px; border-bottom:1px solid var(--border); margin-bottom:16px; overflow-x:auto; }
  .tab { padding:10px 16px; background:transparent; color:var(--text-muted); border:none; border-bottom:2px solid transparent; font-size:13px; cursor:pointer; white-space:nowrap; }
  .tab.active { color:var(--accent); border-bottom-color:var(--accent); }
  .tab:hover:not(.active) { color:var(--text); }
  .filters { display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; }
  .filters input, .filters select { background:var(--bg-card); color:var(--text); border:1px solid var(--border); border-radius:6px; padding:6px 10px; font-size:13px; }
  .filters input { width:200px; }
  table { width:100%; border-collapse:collapse; background:var(--bg-card); border:1px solid var(--border); border-radius:10px; overflow:hidden; }
  thead { background:var(--bg-elevated); }
  th { text-align:left; padding:10px 12px; font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; font-weight:600; border-bottom:1px solid var(--border); }
  td { padding:10px 12px; border-bottom:1px solid var(--border); font-size:13px; vertical-align:top; }
  tr:hover td { background:var(--bg-elevated); cursor:pointer; }
  tr:last-child td { border-bottom:none; }
  .badge { display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:600; text-transform:uppercase; }
  .badge-sent { background:#064E3B; color:#34D399; }
  .badge-failed { background:#7F1D1D; color:#FCA5A5; }
  .badge-suppressed { background:#374151; color:#9CA3AF; }
  .badge-deduped { background:#1E3A8A; color:#93C5FD; }
  .badge-pending { background:#78350F; color:#FCD34D; }
  .badge-customer { background:#0c4a6e; color:#7DD3FC; }
  .badge-internal { background:#3F1366; color:#C4B5FD; }
  .badge-cart { background:#7C2D12; color:#FDBA74; }
  .badge-alert { background:#7F1D1D; color:#FCA5A5; }
  .badge-lead { background:#064E3B; color:#34D399; }
  .badge-manual { background:#1E293B; color:#94A3B8; }
  .mono { font-family:'SF Mono','Menlo','Monaco',monospace; font-size:12px; }
  .truncate { max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,0.7); display:none; align-items:center; justify-content:center; z-index:100; padding:24px; }
  .modal-overlay.show { display:flex; }
  .modal { background:var(--bg-card); border:1px solid var(--border); border-radius:12px; max-width:900px; width:100%; max-height:90vh; overflow:auto; }
  .modal-header { padding:18px 24px; border-bottom:1px solid var(--border); display:flex; align-items:center; justify-content:space-between; }
  .modal-body { padding:24px; }
  .modal-body label { display:block; font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px; margin:12px 0 4px; }
  .modal-body input, .modal-body textarea, .modal-body select { width:100%; background:var(--bg-elevated); color:var(--text); border:1px solid var(--border); border-radius:6px; padding:8px 10px; font-size:13px; font-family:inherit; }
  .modal-body textarea { min-height:200px; font-family:'SF Mono','Menlo',monospace; font-size:12px; }
  .modal-actions { padding:16px 24px; border-top:1px solid var(--border); display:flex; gap:8px; justify-content:flex-end; }
  .meta-grid { display:grid; grid-template-columns:140px 1fr; gap:8px 16px; font-size:13px; margin-bottom:16px; }
  .meta-grid label { color:var(--text-muted); font-size:11px; text-transform:uppercase; letter-spacing:0.5px; padding-top:2px; }
  .body-frame { background:#fff; border-radius:8px; padding:0; overflow:hidden; }
  .body-frame iframe { width:100%; min-height:400px; border:none; }
  .empty { text-align:center; padding:60px 20px; color:var(--text-muted); }
  .opens-cell { font-size:12px; }
  .opens-cell strong { color:var(--accent); font-size:14px; }
</style>
</head>
<body>
<header>
  <h1>📧 Email Tracker</h1>
  <div class="actions">
    <button class="btn" id="composeBtn">✉ New Email</button>
    <button class="btn btn-secondary" id="refreshBtn">↻ Refresh</button>
    <a href="/super-admin" class="btn btn-secondary" style="text-decoration:none">← Super Admin</a>
  </div>
</header>

<div class="container">
  <!-- Header stats -->
  <div class="stats" id="statsRow">
    <div class="stat"><div class="stat-label">Sent today</div><div class="stat-value" id="statSent">—</div><div class="stat-sub" id="statSentSub"></div></div>
    <div class="stat"><div class="stat-label">Opens (24h)</div><div class="stat-value" id="statOpens">—</div><div class="stat-sub" id="statOpensSub"></div></div>
    <div class="stat"><div class="stat-label">Clicks (24h)</div><div class="stat-value" id="statClicks">—</div></div>
    <div class="stat"><div class="stat-label">Failed (24h)</div><div class="stat-value" id="statFailed">—</div></div>
    <div class="stat"><div class="stat-label">Inbound leads (24h)</div><div class="stat-value" id="statLeads">—</div></div>
    <div class="stat"><div class="stat-label">Suppressed</div><div class="stat-value" id="statSuppressed">—</div></div>
  </div>

  <!-- Tabs -->
  <div class="tabs" id="tabs">
    <button class="tab active" data-tab="all">All</button>
    <button class="tab" data-tab="customer">Customer-facing</button>
    <button class="tab" data-tab="alert">Internal alerts</button>
    <button class="tab" data-tab="cart">Cart recovery</button>
    <button class="tab" data-tab="lead">Lead notifications</button>
    <button class="tab" data-tab="leads-inbound">Inbound leads</button>
    <button class="tab" data-tab="webhooks">Webhooks</button>
    <button class="tab" data-tab="suppressions">Suppressions</button>
  </div>

  <!-- Filters -->
  <div class="filters" id="filters">
    <input type="text" id="filterRecipient" placeholder="Search recipient...">
    <select id="filterStatus">
      <option value="">All status</option>
      <option value="sent">Sent</option>
      <option value="failed">Failed</option>
      <option value="suppressed">Suppressed</option>
      <option value="deduped">Deduped</option>
      <option value="pending">Pending</option>
    </select>
    <select id="filterKind">
      <option value="">All kinds</option>
    </select>
  </div>

  <!-- Table mount -->
  <div id="tableMount">
    <div class="empty">Loading…</div>
  </div>
</div>

<!-- Detail modal -->
<div class="modal-overlay" id="detailModal">
  <div class="modal">
    <div class="modal-header">
      <h2 id="detailTitle" style="margin:0;font-size:16px;font-weight:700">Email Details</h2>
      <button class="btn btn-secondary" onclick="closeModal('detailModal')">✕</button>
    </div>
    <div class="modal-body" id="detailBody">Loading…</div>
    <div class="modal-actions" id="detailActions"></div>
  </div>
</div>

<!-- Composer modal -->
<div class="modal-overlay" id="composeModal">
  <div class="modal">
    <div class="modal-header">
      <h2 style="margin:0;font-size:16px;font-weight:700">New Email</h2>
      <button class="btn btn-secondary" onclick="closeModal('composeModal')">✕</button>
    </div>
    <div class="modal-body">
      <label>From</label>
      <select id="composeFrom">
        <option value="sales@roofmanager.ca">sales@roofmanager.ca</option>
        <option value="support@roofmanager.ca">support@roofmanager.ca</option>
      </select>
      <label>To</label>
      <input type="email" id="composeTo" placeholder="customer@example.com">
      <label>Subject</label>
      <input type="text" id="composeSubject">
      <label>Body (HTML)</label>
      <textarea id="composeBody" placeholder="&lt;p&gt;Hi,&lt;/p&gt;&#10;&#10;&lt;p&gt;Please find your report attached.&lt;/p&gt;&#10;&#10;&lt;p&gt;— The Roof Manager team&lt;/p&gt;"></textarea>
      <label>Attach customer-report PDF for order # (optional)</label>
      <input type="number" id="composeAttachOrder" placeholder="e.g. 1234">
      <p style="font-size:11px;color:var(--text-dim);margin:12px 0 0">Sent through the tracking wrapper — recipient opens + clicks will be counted on this row.</p>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal('composeModal')">Cancel</button>
      <button class="btn" id="composeSendBtn">Send</button>
    </div>
  </div>
</div>

<!-- Suppress modal -->
<div class="modal-overlay" id="suppressModal">
  <div class="modal" style="max-width:480px">
    <div class="modal-header">
      <h2 style="margin:0;font-size:16px;font-weight:700">Suppress Recipient</h2>
      <button class="btn btn-secondary" onclick="closeModal('suppressModal')">✕</button>
    </div>
    <div class="modal-body">
      <label>Email</label>
      <input type="email" id="suppressEmail">
      <label>Reason</label>
      <select id="suppressReason">
        <option value="manual">Manual</option>
        <option value="hard_bounce">Hard bounce</option>
        <option value="complaint">Complaint</option>
        <option value="invalid">Invalid address</option>
        <option value="unsubscribe">Unsubscribe</option>
      </select>
      <label>Notes (optional)</label>
      <textarea id="suppressNotes" style="min-height:60px"></textarea>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal('suppressModal')">Cancel</button>
      <button class="btn btn-danger" id="suppressConfirmBtn">Suppress</button>
    </div>
  </div>
</div>

<script>
let currentTab = 'all'
const tableMount = document.getElementById('tableMount')
const filterRecipient = document.getElementById('filterRecipient')
const filterStatus = document.getElementById('filterStatus')
const filterKind = document.getElementById('filterKind')

function fmtDate(s) {
  if (!s) return '—'
  try {
    const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z')
    const now = new Date()
    const diff = (now - d) / 1000
    if (diff < 60) return Math.floor(diff) + 's ago'
    if (diff < 3600) return Math.floor(diff/60) + 'm ago'
    if (diff < 86400) return Math.floor(diff/3600) + 'h ago'
    return d.toLocaleString()
  } catch { return s }
}

function fmtAbsolute(s) {
  if (!s) return ''
  try {
    const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z')
    return d.toLocaleString()
  } catch { return s }
}

function escapeHtml(s) {
  if (s === null || s === undefined) return ''
  return String(s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]))
}

async function loadStats() {
  try {
    const r = await fetch('/api/super-admin/email-tracker/stats').then(r => r.json())
    document.getElementById('statSent').textContent = r.today?.sent || 0
    document.getElementById('statSentSub').textContent = (r.today?.total || 0) + ' total'
    document.getElementById('statOpens').textContent = r.today?.opened || 0
    document.getElementById('statOpensSub').textContent = (r.today?.open_events || 0) + ' open events'
    document.getElementById('statClicks').textContent = r.today?.click_events || 0
    document.getElementById('statFailed').textContent = r.today?.failed || 0
    document.getElementById('statLeads').textContent = r.leads_today || 0
    document.getElementById('statSuppressed').textContent = r.suppressions_active || 0
  } catch (e) {
    console.error('Stats load failed:', e)
  }
}

async function loadFeed() {
  const params = new URLSearchParams()
  if (currentTab !== 'all' && currentTab !== 'leads-inbound' && currentTab !== 'webhooks' && currentTab !== 'suppressions') {
    params.set('category', currentTab)
  }
  if (filterStatus.value) params.set('status', filterStatus.value)
  if (filterRecipient.value) params.set('recipient', filterRecipient.value)
  if (filterKind.value) params.set('kind', filterKind.value)
  params.set('limit', '200')

  tableMount.innerHTML = '<div class="empty">Loading…</div>'

  if (currentTab === 'leads-inbound') return loadInboundLeads()
  if (currentTab === 'webhooks') return loadWebhooks()
  if (currentTab === 'suppressions') return loadSuppressions()

  try {
    const r = await fetch('/api/super-admin/email-tracker/feed?' + params.toString()).then(r => r.json())
    renderFeed(r.rows || [])
  } catch (e) {
    tableMount.innerHTML = '<div class="empty">Error loading feed: ' + escapeHtml(e.message) + '</div>'
  }
}

function renderFeed(rows) {
  if (!rows.length) { tableMount.innerHTML = '<div class="empty">No emails match these filters.</div>'; return }
  const kinds = new Set()
  rows.forEach(r => { if (r.kind) kinds.add(r.kind) })
  // Refresh kind dropdown
  const currentKind = filterKind.value
  filterKind.innerHTML = '<option value="">All kinds</option>' + Array.from(kinds).sort().map(k => '<option value="' + escapeHtml(k) + '"' + (k === currentKind ? ' selected' : '') + '>' + escapeHtml(k) + '</option>').join('')

  let html = '<table><thead><tr>' +
    '<th>When</th><th>Category</th><th>Kind</th><th>From → To</th><th>Subject</th><th>Status</th><th>Opens</th><th>Clicks</th>' +
    '</tr></thead><tbody>'
  for (const row of rows) {
    const status = row.status || 'sent'
    const cat = row.category || '(none)'
    const opens = row.open_count > 0
      ? '<span class="opens-cell"><strong>' + row.open_count + '</strong>×<br><span style="color:var(--text-dim)">' + escapeHtml(fmtDate(row.last_opened_at)) + '</span></span>'
      : '<span style="color:var(--text-dim)">—</span>'
    const clicks = row.click_count > 0
      ? '<span class="opens-cell"><strong>' + row.click_count + '</strong>×<br><span style="color:var(--text-dim)">' + escapeHtml(fmtDate(row.last_clicked_at)) + '</span></span>'
      : '<span style="color:var(--text-dim)">—</span>'
    const trAttr = row.src === 'email_sends' ? ' onclick="openDetail(' + row.id + ')"' : ''
    html += '<tr' + trAttr + '>'
      + '<td title="' + escapeHtml(fmtAbsolute(row.sent_at)) + '">' + escapeHtml(fmtDate(row.sent_at)) + '</td>'
      + '<td><span class="badge badge-' + escapeHtml(cat) + '">' + escapeHtml(cat) + '</span></td>'
      + '<td class="mono">' + escapeHtml(row.kind || '') + '</td>'
      + '<td><div style="font-size:12px;color:var(--text-muted)">' + escapeHtml(row.from_addr || '?') + '</div>'
      + '<div>' + escapeHtml(row.recipient || '') + '</div></td>'
      + '<td class="truncate" title="' + escapeHtml(row.subject || '') + '">' + escapeHtml(row.subject || '') + '</td>'
      + '<td><span class="badge badge-' + escapeHtml(status) + '">' + escapeHtml(status) + '</span>'
      + (row.send_error ? '<div style="font-size:10px;color:var(--danger);margin-top:4px" class="truncate" title="' + escapeHtml(row.send_error) + '">' + escapeHtml(row.send_error) + '</div>' : '')
      + '</td>'
      + '<td>' + opens + '</td>'
      + '<td>' + clicks + '</td>'
      + '</tr>'
  }
  html += '</tbody></table>'
  tableMount.innerHTML = html
}

async function loadInboundLeads() {
  try {
    const r = await fetch('/api/super-admin/email-tracker/leads-inbound?limit=100').then(r => r.json())
    if (!r.rows?.length) { tableMount.innerHTML = '<div class="empty">No inbound leads.</div>'; return }
    let html = '<table><thead><tr><th>When</th><th>Source</th><th>Name</th><th>Email</th><th>Phone</th><th>Company</th><th>Message</th><th>Status</th></tr></thead><tbody>'
    for (const row of r.rows) {
      html += '<tr>'
        + '<td title="' + escapeHtml(fmtAbsolute(row.created_at)) + '">' + escapeHtml(fmtDate(row.created_at)) + '</td>'
        + '<td class="mono">' + escapeHtml(row.source_page || '') + '</td>'
        + '<td>' + escapeHtml(row.name || '') + '</td>'
        + '<td>' + escapeHtml(row.email || '') + '</td>'
        + '<td>' + escapeHtml(row.phone || '') + '</td>'
        + '<td>' + escapeHtml(row.company_name || '') + '</td>'
        + '<td class="truncate" title="' + escapeHtml(row.message || '') + '">' + escapeHtml(row.message || '') + '</td>'
        + '<td><span class="badge badge-' + escapeHtml(row.status || 'new') + '">' + escapeHtml(row.status || 'new') + '</span></td>'
        + '</tr>'
    }
    html += '</tbody></table>'
    tableMount.innerHTML = html
  } catch (e) {
    tableMount.innerHTML = '<div class="empty">Error: ' + escapeHtml(e.message) + '</div>'
  }
}

async function loadWebhooks() {
  try {
    const r = await fetch('/api/super-admin/email-tracker/webhook-events').then(r => r.json())
    if (!r.rows?.length) { tableMount.innerHTML = '<div class="empty">No webhook events.</div>'; return }
    let html = '<table><thead><tr><th>When</th><th>Event</th><th>Recipient</th><th>Provider Msg ID</th><th>Payload</th></tr></thead><tbody>'
    for (const row of r.rows) {
      html += '<tr>'
        + '<td title="' + escapeHtml(fmtAbsolute(row.received_at)) + '">' + escapeHtml(fmtDate(row.received_at)) + '</td>'
        + '<td><span class="badge badge-' + (row.event_type?.includes('bounce') ? 'failed' : 'customer') + '">' + escapeHtml(row.event_type || '') + '</span></td>'
        + '<td>' + escapeHtml(row.recipient || '') + '</td>'
        + '<td class="mono">' + escapeHtml(row.provider_message_id || '') + '</td>'
        + '<td class="truncate mono" title="' + escapeHtml(row.payload || '') + '">' + escapeHtml((row.payload || '').slice(0, 80)) + '</td>'
        + '</tr>'
    }
    html += '</tbody></table>'
    tableMount.innerHTML = html
  } catch (e) {
    tableMount.innerHTML = '<div class="empty">Error: ' + escapeHtml(e.message) + '</div>'
  }
}

async function loadSuppressions() {
  try {
    const r = await fetch('/api/super-admin/email-tracker/suppressions').then(r => r.json())
    if (!r.rows?.length) { tableMount.innerHTML = '<div class="empty">No suppressed recipients.</div>'; return }
    let html = '<table><thead><tr><th>Email</th><th>Reason</th><th>Notes</th><th>Suppressed</th><th>Status</th><th></th></tr></thead><tbody>'
    for (const row of r.rows) {
      const isActive = !row.released_at
      html += '<tr>'
        + '<td>' + escapeHtml(row.email) + '</td>'
        + '<td><span class="badge badge-' + (isActive ? 'failed' : 'deduped') + '">' + escapeHtml(row.reason) + '</span></td>'
        + '<td>' + escapeHtml(row.notes || '') + '</td>'
        + '<td title="' + escapeHtml(fmtAbsolute(row.suppressed_at)) + '">' + escapeHtml(fmtDate(row.suppressed_at)) + '</td>'
        + '<td>' + (isActive ? '<span class="badge badge-failed">active</span>' : '<span class="badge badge-deduped">released</span>') + '</td>'
        + '<td>' + (isActive ? '<button class="btn btn-secondary" onclick="releaseSuppression(' + row.id + ')">Release</button>' : '') + '</td>'
        + '</tr>'
    }
    html += '</tbody></table>'
    tableMount.innerHTML = html
  } catch (e) {
    tableMount.innerHTML = '<div class="empty">Error: ' + escapeHtml(e.message) + '</div>'
  }
}

async function openDetail(id) {
  document.getElementById('detailModal').classList.add('show')
  document.getElementById('detailBody').innerHTML = 'Loading…'
  document.getElementById('detailActions').innerHTML = ''
  try {
    const r = await fetch('/api/super-admin/email-tracker/email/' + id).then(r => r.json())
    if (!r.row) throw new Error(r.error || 'not found')
    const row = r.row
    document.getElementById('detailTitle').textContent = row.subject || '(no subject)'
    let bodyHtml = '<div class="meta-grid">'
      + '<label>From</label><div>' + escapeHtml(row.from_addr || '(default)') + '</div>'
      + '<label>To</label><div>' + escapeHtml(row.recipient) + '</div>'
      + '<label>Category</label><div><span class="badge badge-' + escapeHtml(row.category || 'manual') + '">' + escapeHtml(row.category || '(none)') + '</span></div>'
      + '<label>Kind</label><div class="mono">' + escapeHtml(row.kind) + '</div>'
      + '<label>Status</label><div><span class="badge badge-' + escapeHtml(row.status || 'sent') + '">' + escapeHtml(row.status || 'sent') + '</span></div>'
      + '<label>Sent at</label><div>' + escapeHtml(fmtAbsolute(row.sent_at)) + '</div>'
      + '<label>Opens</label><div>' + (row.open_count || 0) + '× — last ' + escapeHtml(fmtAbsolute(row.last_opened_at)) + '</div>'
      + '<label>Clicks</label><div>' + (row.click_count || 0) + '× — last ' + escapeHtml(fmtAbsolute(row.last_clicked_at)) + (row.last_clicked_url ? '<br><span class="mono" style="font-size:11px;color:var(--text-muted)">' + escapeHtml(row.last_clicked_url) + '</span>' : '') + '</div>'
      + '<label>Provider</label><div class="mono">' + escapeHtml(row.provider_message_id || '—') + '</div>'
      + (row.send_error ? '<label>Error</label><div style="color:var(--danger)" class="mono">' + escapeHtml(row.send_error) + '</div>' : '')
      + (row.order_id ? '<label>Order</label><div><a href="/api/reports/' + row.order_id + '/html" target="_blank" style="color:var(--accent)">#' + row.order_id + '</a></div>' : '')
      + (r.parent ? '<label>Retry of</label><div><a href="#" onclick="openDetail(' + r.parent.id + ');return false" style="color:var(--accent)">#' + r.parent.id + ' (' + escapeHtml(r.parent.status) + ')</a></div>' : '')
      + '</div>'
    if (row.body_html) {
      bodyHtml += '<label style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin:16px 0 8px;display:block">Body</label>'
      bodyHtml += '<div class="body-frame"><iframe srcdoc="' + escapeHtml(row.body_html) + '" sandbox=""></iframe></div>'
    } else {
      bodyHtml += '<p style="color:var(--text-muted);font-size:13px;margin:16px 0 0">Body not stored. (Likely a report email — regenerate from order ' + (row.order_id || '?') + '.)</p>'
    }
    document.getElementById('detailBody').innerHTML = bodyHtml

    const actions = []
    if (row.status === 'failed') {
      actions.push('<button class="btn" onclick="resendRow(' + row.id + ')">Resend</button>')
    } else if (row.body_html) {
      actions.push('<button class="btn btn-secondary" onclick="resendRow(' + row.id + ')">Resend</button>')
    }
    actions.push('<button class="btn btn-danger" onclick="openSuppress(\\'' + escapeHtml(row.recipient).replace(/'/g, "\\\\'") + '\\')">Suppress ' + escapeHtml(row.recipient) + '</button>')
    document.getElementById('detailActions').innerHTML = actions.join('')
  } catch (e) {
    document.getElementById('detailBody').innerHTML = '<div class="empty">Error: ' + escapeHtml(e.message) + '</div>'
  }
}

async function resendRow(id) {
  if (!confirm('Resend this email?')) return
  try {
    const r = await fetch('/api/super-admin/email-tracker/email/' + id + '/resend', { method: 'POST' }).then(r => r.json())
    if (r.ok) {
      alert('Sent. New email_sends.id=' + r.emailSendId)
      closeModal('detailModal')
      loadFeed(); loadStats()
    } else {
      alert('Failed: ' + (r.error || 'unknown'))
    }
  } catch (e) { alert('Error: ' + e.message) }
}

function openSuppress(email) {
  closeModal('detailModal')
  document.getElementById('suppressEmail').value = email
  document.getElementById('suppressNotes').value = ''
  document.getElementById('suppressModal').classList.add('show')
}

document.getElementById('suppressConfirmBtn').onclick = async () => {
  const email = document.getElementById('suppressEmail').value.trim()
  const reason = document.getElementById('suppressReason').value
  const notes = document.getElementById('suppressNotes').value
  if (!email) { alert('Email required'); return }
  const r = await fetch('/api/super-admin/email-tracker/suppressions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, reason, notes })
  }).then(r => r.json())
  if (r.ok) { closeModal('suppressModal'); loadFeed(); loadStats() }
  else { alert('Failed: ' + (r.error || 'unknown')) }
}

async function releaseSuppression(id) {
  if (!confirm('Release this suppression? Future emails to this recipient will go through.')) return
  await fetch('/api/super-admin/email-tracker/suppressions/' + id, { method: 'DELETE' })
  loadFeed(); loadStats()
}

document.getElementById('composeBtn').onclick = () => {
  document.getElementById('composeTo').value = ''
  document.getElementById('composeSubject').value = ''
  document.getElementById('composeBody').value = ''
  document.getElementById('composeAttachOrder').value = ''
  document.getElementById('composeModal').classList.add('show')
}

document.getElementById('composeSendBtn').onclick = async () => {
  const to = document.getElementById('composeTo').value.trim()
  const from = document.getElementById('composeFrom').value
  const subject = document.getElementById('composeSubject').value.trim()
  const html = document.getElementById('composeBody').value.trim()
  const attachOrder = parseInt(document.getElementById('composeAttachOrder').value, 10) || null
  if (!to || !subject || !html) { alert('To, subject, and body required'); return }
  const btn = document.getElementById('composeSendBtn')
  btn.disabled = true; btn.textContent = 'Sending…'
  try {
    const r = await fetch('/api/super-admin/email-tracker/compose', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, from, subject, html, attach_report_pdf_for_order: attachOrder })
    }).then(r => r.json())
    if (r.ok) {
      closeModal('composeModal')
      loadFeed(); loadStats()
    } else { alert('Failed: ' + (r.error || 'unknown')) }
  } catch (e) { alert('Error: ' + e.message) }
  finally { btn.disabled = false; btn.textContent = 'Send' }
}

function closeModal(id) { document.getElementById(id).classList.remove('show') }

document.querySelectorAll('.tab').forEach(t => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'))
    t.classList.add('active')
    currentTab = t.dataset.tab
    loadFeed()
  }
})

filterRecipient.oninput = debounce(loadFeed, 300)
filterStatus.onchange = loadFeed
filterKind.onchange = loadFeed
document.getElementById('refreshBtn').onclick = () => { loadFeed(); loadStats() }

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms) } }

loadStats()
loadFeed()
setInterval(loadStats, 30000)
</script>
</body>
</html>`
}

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
import {
  listDefinitions,
  loadDefinition,
  createCustomSequence,
  archiveCustomSequence,
  enrollRecipient,
  pauseEnrollment,
  resumeEnrollment,
  cancelEnrollment,
  skipToNextStep,
  sendCurrentStepNow,
  testSendStep,
  type SequenceStepCustom,
} from '../services/sequence-engine'

type Bindings = { DB: D1Database; [k: string]: any }

export const superAdminEmailTracker = new Hono<{ Bindings: Bindings }>()

// ── Session gate (superadmin only) ───────────────────────────
// This router is mounted at app.route('/', ...) so use('*') would intercept
// EVERY request site-wide — including /login itself — and redirect
// unauthenticated visitors into an infinite /login?next=/login loop.
// Scope the gate to only the paths this router actually owns. Other paths
// (/, /login, /customer/*, /api/customer/*) fall straight through.
superAdminEmailTracker.use('*', async (c, next) => {
  const path = c.req.path
  const ownsThisPath = path === '/super-admin/email-tracker'
    || path.startsWith('/super-admin/email-tracker/')
    || path.startsWith('/api/super-admin/email-tracker/')
  if (!ownsThisPath) {
    await next()
    return
  }
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) {
    if (path.includes('/api/')) return c.json({ error: 'superadmin required' }, 403)
    return c.redirect('/login?next=' + encodeURIComponent(path), 302)
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

// ── JSON: sequence definitions (catalog) ─────────────────────
superAdminEmailTracker.get('/api/super-admin/email-tracker/sequences', async (c) => {
  const url = new URL(c.req.url)
  const includeArchived = url.searchParams.get('archived') === '1'
  const defs = await listDefinitions(c.env, includeArchived)
  // Also attach a per-sequence enrollment-count rollup
  const counts = await c.env.DB.prepare(`
    SELECT sequence_type, status, COUNT(*) AS n
    FROM sequence_enrollments
    GROUP BY sequence_type, status
  `).all<{ sequence_type: string; status: string; n: number }>()
  const countMap: Record<string, Record<string, number>> = {}
  for (const r of counts.results || []) {
    if (!countMap[r.sequence_type]) countMap[r.sequence_type] = {}
    countMap[r.sequence_type][r.status] = r.n
  }
  return c.json({
    definitions: defs.map(d => ({ ...d, enrollment_counts: countMap[d.sequence_type] || {} })),
  })
})

// ── GET one definition (for editor) ──────────────────────────
superAdminEmailTracker.get('/api/super-admin/email-tracker/sequences/:type', async (c) => {
  const def = await loadDefinition(c.env, c.req.param('type'))
  if (!def) return c.json({ error: 'not found' }, 404)
  return c.json({ definition: def })
})

// ── POST: create/update custom sequence ──────────────────────
superAdminEmailTracker.post('/api/super-admin/email-tracker/sequences', async (c) => {
  const admin = (c as any).get('admin') as any
  const body = await c.req.json().catch(() => ({})) as {
    sequence_type?: string
    name?: string
    description?: string
    steps?: SequenceStepCustom[]
    default_category?: string
    default_from?: string
  }
  if (!body.sequence_type || !body.name || !body.steps?.length) {
    return c.json({ error: 'sequence_type, name, and steps required' }, 400)
  }
  const result = await createCustomSequence(c.env, {
    sequenceType: body.sequence_type,
    name: body.name,
    description: body.description,
    steps: body.steps,
    defaultCategory: (body.default_category as any) || 'customer',
    defaultFrom: body.default_from,
    adminId: admin?.id || null,
  })
  return c.json(result, result.ok ? 200 : 400)
})

// ── DELETE: archive custom sequence ──────────────────────────
superAdminEmailTracker.delete('/api/super-admin/email-tracker/sequences/:type', async (c) => {
  const result = await archiveCustomSequence(c.env, c.req.param('type'))
  return c.json(result)
})

// ── POST: test-send a single step ────────────────────────────
superAdminEmailTracker.post('/api/super-admin/email-tracker/sequences/:type/test-send', async (c) => {
  const body = await c.req.json().catch(() => ({})) as {
    step_index?: number
    to_email?: string
    test_customer_id?: number
  }
  if (!body.to_email) return c.json({ error: 'to_email required' }, 400)
  const result = await testSendStep(c.env, {
    sequenceType: c.req.param('type'),
    stepIndex: body.step_index || 0,
    toEmail: body.to_email,
    testCustomerId: body.test_customer_id || null,
  })
  return c.json(result, result.ok ? 200 : 500)
})

// ── JSON: enrollments list ───────────────────────────────────
superAdminEmailTracker.get('/api/super-admin/email-tracker/enrollments', async (c) => {
  const url = new URL(c.req.url)
  const wheres: string[] = []
  const binds: any[] = []
  const t = url.searchParams.get('sequence_type'); if (t) { wheres.push('sequence_type = ?'); binds.push(t) }
  const s = url.searchParams.get('status'); if (s) { wheres.push('status = ?'); binds.push(s) }
  const r = url.searchParams.get('recipient'); if (r) { wheres.push('LOWER(recipient_email) LIKE ?'); binds.push('%' + r.toLowerCase() + '%') }
  const whereSql = wheres.length ? 'WHERE ' + wheres.join(' AND ') : ''
  const rows = await c.env.DB.prepare(`
    SELECT id, sequence_type, customer_id, recipient_email, status, current_step,
           enrolled_at, next_send_at, last_step_sent_at, last_email_send_id,
           completed_at, cancelled_at, enrolled_by_admin_id, notes
    FROM sequence_enrollments
    ${whereSql}
    ORDER BY
      CASE status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 WHEN 'failed' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END,
      next_send_at ASC, enrolled_at DESC
    LIMIT 500
  `).bind(...binds).all<any>()
  return c.json({ rows: rows.results || [] })
})

// ── POST: enroll a recipient ─────────────────────────────────
superAdminEmailTracker.post('/api/super-admin/email-tracker/enrollments', async (c) => {
  const admin = (c as any).get('admin') as any
  const body = await c.req.json().catch(() => ({})) as {
    sequence_type?: string
    recipient_email?: string
    customer_id?: number
    start_at_step?: number
    delay_seconds?: number
    notes?: string
    metadata?: Record<string, any>
  }
  if (!body.sequence_type || !body.recipient_email) {
    return c.json({ error: 'sequence_type and recipient_email required' }, 400)
  }
  const result = await enrollRecipient(c.env, body.sequence_type, body.recipient_email, {
    customerId: body.customer_id || null,
    startAtStep: body.start_at_step,
    delaySeconds: body.delay_seconds,
    enrolledByAdminId: admin?.id || null,
    notes: body.notes,
    metadata: body.metadata,
  })
  return c.json(result, result.ok ? 200 : 400)
})

// ── Per-enrollment actions ───────────────────────────────────
superAdminEmailTracker.post('/api/super-admin/email-tracker/enrollments/:id/pause', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  return c.json(await pauseEnrollment(c.env, id))
})
superAdminEmailTracker.post('/api/super-admin/email-tracker/enrollments/:id/resume', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  return c.json(await resumeEnrollment(c.env, id))
})
superAdminEmailTracker.post('/api/super-admin/email-tracker/enrollments/:id/cancel', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  return c.json(await cancelEnrollment(c.env, id))
})
superAdminEmailTracker.post('/api/super-admin/email-tracker/enrollments/:id/skip', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  return c.json(await skipToNextStep(c.env, id))
})
superAdminEmailTracker.post('/api/super-admin/email-tracker/enrollments/:id/send-now', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  return c.json(await sendCurrentStepNow(c.env, id))
})

// ── GET one enrollment detail (history of sends) ─────────────
superAdminEmailTracker.get('/api/super-admin/email-tracker/enrollments/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (!id) return c.json({ error: 'invalid id' }, 400)
  const row = await c.env.DB.prepare(`SELECT * FROM sequence_enrollments WHERE id = ?`).bind(id).first<any>()
  if (!row) return c.json({ error: 'not found' }, 404)
  // All email_sends rows produced by this enrollment (best-effort match by recipient + time window + kind)
  // We don't have a direct enrollment_id FK on email_sends so we match by recipient + sequence-type prefix in kind.
  const sends = await c.env.DB.prepare(`
    SELECT id, kind, subject, status, sent_at, open_count, click_count, last_opened_at, last_clicked_at
    FROM email_sends
    WHERE recipient = ? AND created_at >= ? AND kind LIKE ?
    ORDER BY sent_at ASC
  `).bind(row.recipient_email, row.enrolled_at, `%${row.sequence_type.replace(/_/g, '%')}%`).all<any>()
  return c.json({ row, sends: sends.results || [] })
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
    <button class="tab" data-tab="sequences">Sequences</button>
    <button class="tab" data-tab="enrollments">Enrollments</button>
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

<!-- Enroll modal -->
<div class="modal-overlay" id="enrollModal">
  <div class="modal">
    <div class="modal-header">
      <h2 style="margin:0;font-size:16px;font-weight:700">Enroll Recipient in Sequence</h2>
      <button class="btn btn-secondary" onclick="closeModal('enrollModal')">✕</button>
    </div>
    <div class="modal-body">
      <label>Sequence</label>
      <select id="enrollSequenceType"></select>
      <label>Recipient email</label>
      <input type="email" id="enrollRecipient" placeholder="customer@example.com">
      <label>Customer ID (optional — enables {{first_name}} etc.)</label>
      <input type="number" id="enrollCustomerId">
      <label>Start at step (default 0)</label>
      <input type="number" id="enrollStartStep" min="0" value="0">
      <label>Send first step in (seconds, 0 = next cron tick)</label>
      <input type="number" id="enrollDelay" min="0" value="0">
      <label>Notes (optional)</label>
      <textarea id="enrollNotes" style="min-height:60px"></textarea>
      <p style="font-size:11px;color:var(--text-dim);margin:12px 0 0">Each step fires via the tracking wrapper, so opens + clicks land on the recipient's email_sends row. Suppressed recipients are skipped automatically.</p>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal('enrollModal')">Cancel</button>
      <button class="btn" id="enrollConfirmBtn">Enroll</button>
    </div>
  </div>
</div>

<!-- Sequence Editor modal -->
<div class="modal-overlay" id="seqEditorModal">
  <div class="modal" style="max-width:1100px">
    <div class="modal-header">
      <h2 style="margin:0;font-size:16px;font-weight:700" id="seqEditorTitle">New Custom Sequence</h2>
      <button class="btn btn-secondary" onclick="closeModal('seqEditorModal')">✕</button>
    </div>
    <div class="modal-body">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <label>Sequence key (prefix custom_)</label>
          <input type="text" id="seqEditorKey" placeholder="custom_winter_promo">
        </div>
        <div>
          <label>Display name</label>
          <input type="text" id="seqEditorName" placeholder="Winter Promo Drip">
        </div>
        <div>
          <label>From address</label>
          <select id="seqEditorFrom">
            <option value="sales@roofmanager.ca">sales@roofmanager.ca</option>
            <option value="support@roofmanager.ca">support@roofmanager.ca</option>
          </select>
        </div>
        <div>
          <label>Default category</label>
          <select id="seqEditorCategory">
            <option value="customer">customer</option>
            <option value="lead">lead</option>
            <option value="alert">alert</option>
            <option value="cart">cart</option>
            <option value="manual">manual</option>
          </select>
        </div>
      </div>
      <label>Description</label>
      <input type="text" id="seqEditorDescription">
      <div style="margin:20px 0 8px;display:flex;align-items:center;justify-content:space-between">
        <label style="margin:0">Steps</label>
        <button class="btn btn-secondary" onclick="addStepRow()">+ Add step</button>
      </div>
      <div id="seqEditorSteps"></div>
      <details style="margin-top:16px">
        <summary style="cursor:pointer;font-size:12px;color:var(--text-muted)">Available template variables</summary>
        <div style="font-size:12px;color:var(--text-muted);padding:8px 0">
          <code>{{first_name}}</code> · <code>{{customer_name}}</code> · <code>{{email}}</code> · <code>{{company_name}}</code> · <code>{{customer_id}}</code> · plus any keys from the enrollment's metadata JSON (e.g. <code>{{package_name}}</code>).
        </div>
      </details>
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal('seqEditorModal')">Cancel</button>
      <button class="btn btn-secondary" id="seqEditorTestBtn">Test send step 0…</button>
      <button class="btn" id="seqEditorSaveBtn">Save</button>
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
  if (currentTab === 'sequences') return loadSequences()
  if (currentTab === 'enrollments') return loadEnrollments()
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

// ── Sequences tab ─────────────────────────────────────────────
async function loadSequences() {
  try {
    const r = await fetch('/api/super-admin/email-tracker/sequences').then(r => r.json())
    const defs = r.definitions || []
    if (!defs.length) { tableMount.innerHTML = '<div class="empty">No sequences defined.</div>'; return }
    let html = '<div style="margin-bottom:16px;display:flex;gap:8px;align-items:center">'
      + '<button class="btn" onclick="openSeqEditor()">+ New custom sequence</button>'
      + '<span style="color:var(--text-dim);font-size:12px">Built-in sequences auto-fire from cron; you can also manually enroll a recipient in any of them.</span>'
      + '</div>'
    html += '<table><thead><tr><th>Sequence</th><th>Kind</th><th>Steps</th><th>Active</th><th>Paused</th><th>Completed</th><th>Default From</th><th>Actions</th></tr></thead><tbody>'
    for (const d of defs) {
      const counts = d.enrollment_counts || {}
      html += '<tr>'
        + '<td><div style="font-weight:600">' + escapeHtml(d.name) + '</div>'
        + '<div class="mono" style="font-size:11px;color:var(--text-muted)">' + escapeHtml(d.sequence_type) + '</div>'
        + (d.description ? '<div style="font-size:12px;color:var(--text-muted);margin-top:4px">' + escapeHtml(d.description) + '</div>' : '')
        + '</td>'
        + '<td><span class="badge badge-' + (d.kind === 'builtin' ? 'customer' : 'manual') + '">' + escapeHtml(d.kind) + '</span></td>'
        + '<td>' + (d.steps?.length || 0) + '</td>'
        + '<td><strong>' + (counts.active || 0) + '</strong></td>'
        + '<td>' + (counts.paused || 0) + '</td>'
        + '<td>' + (counts.completed || 0) + '</td>'
        + '<td class="mono" style="font-size:11px">' + escapeHtml(d.default_from || '—') + '</td>'
        + '<td><button class="btn btn-secondary" onclick="openEnroll(\\'' + escapeHtml(d.sequence_type) + '\\')">Enroll…</button>'
        + (d.kind === 'custom' ? ' <button class="btn btn-secondary" onclick="editSequence(\\'' + escapeHtml(d.sequence_type) + '\\')">Edit</button> <button class="btn btn-danger" onclick="archiveSequence(\\'' + escapeHtml(d.sequence_type) + '\\')">Archive</button>' : '')
        + '</td>'
        + '</tr>'
    }
    html += '</tbody></table>'
    tableMount.innerHTML = html
  } catch (e) {
    tableMount.innerHTML = '<div class="empty">Error: ' + escapeHtml(e.message) + '</div>'
  }
}

async function loadEnrollments() {
  const params = new URLSearchParams()
  if (filterRecipient.value) params.set('recipient', filterRecipient.value)
  if (filterStatus.value) params.set('status', filterStatus.value)
  try {
    const r = await fetch('/api/super-admin/email-tracker/enrollments?' + params.toString()).then(r => r.json())
    const rows = r.rows || []
    if (!rows.length) { tableMount.innerHTML = '<div class="empty">No enrollments. <button class="btn" onclick="openEnroll()">Enroll someone…</button></div>'; return }
    let html = '<div style="margin-bottom:16px"><button class="btn" onclick="openEnroll()">+ Enroll recipient</button></div>'
    html += '<table><thead><tr><th>Recipient</th><th>Sequence</th><th>Step</th><th>Status</th><th>Next send</th><th>Last sent</th><th>Notes</th><th>Actions</th></tr></thead><tbody>'
    for (const row of rows) {
      const isActive = row.status === 'active'
      const isPaused = row.status === 'paused'
      const isDone = row.status === 'completed' || row.status === 'cancelled' || row.status === 'failed'
      html += '<tr>'
        + '<td>' + escapeHtml(row.recipient_email) + (row.customer_id ? '<div style="font-size:11px;color:var(--text-muted)">customer #' + row.customer_id + '</div>' : '') + '</td>'
        + '<td class="mono" style="font-size:12px">' + escapeHtml(row.sequence_type) + '</td>'
        + '<td>' + row.current_step + '</td>'
        + '<td><span class="badge badge-' + (isActive ? 'sent' : isPaused ? 'pending' : row.status === 'completed' ? 'deduped' : 'failed') + '">' + escapeHtml(row.status) + '</span></td>'
        + '<td>' + (row.next_send_at ? escapeHtml(fmtDate(row.next_send_at)) : '—') + '</td>'
        + '<td>' + (row.last_step_sent_at ? escapeHtml(fmtDate(row.last_step_sent_at)) : '—') + '</td>'
        + '<td class="truncate" style="max-width:160px" title="' + escapeHtml(row.notes || '') + '">' + escapeHtml(row.notes || '') + '</td>'
        + '<td style="white-space:nowrap">'
        + (isActive ? '<button class="btn btn-secondary" onclick="enrollAction(' + row.id + ',\\'pause\\')">Pause</button>' : '')
        + (isPaused ? '<button class="btn btn-secondary" onclick="enrollAction(' + row.id + ',\\'resume\\')">Resume</button>' : '')
        + (!isDone ? ' <button class="btn btn-secondary" onclick="enrollAction(' + row.id + ',\\'send-now\\')">Send now</button>' : '')
        + (!isDone ? ' <button class="btn btn-secondary" onclick="enrollAction(' + row.id + ',\\'skip\\')">Skip</button>' : '')
        + (!isDone ? ' <button class="btn btn-danger" onclick="enrollAction(' + row.id + ',\\'cancel\\')">Cancel</button>' : '')
        + '</td>'
        + '</tr>'
    }
    html += '</tbody></table>'
    tableMount.innerHTML = html
  } catch (e) {
    tableMount.innerHTML = '<div class="empty">Error: ' + escapeHtml(e.message) + '</div>'
  }
}

async function enrollAction(id, action) {
  if (action === 'cancel' && !confirm('Cancel this enrollment? No further steps will fire.')) return
  try {
    const r = await fetch('/api/super-admin/email-tracker/enrollments/' + id + '/' + action, { method: 'POST' }).then(r => r.json())
    if (action === 'send-now' && r.ok) alert('Sent. email_sends.id=' + r.emailSendId)
    if (!r.ok && r.error) alert('Failed: ' + r.error)
    loadEnrollments(); loadStats()
  } catch (e) { alert('Error: ' + e.message) }
}

async function openEnroll(presetSequenceType) {
  // Populate sequence picker
  try {
    const r = await fetch('/api/super-admin/email-tracker/sequences').then(r => r.json())
    const opts = (r.definitions || []).filter(d => d.enabled !== false).map(d => '<option value="' + escapeHtml(d.sequence_type) + '">' + escapeHtml(d.name) + ' (' + d.steps.length + ' steps)</option>').join('')
    document.getElementById('enrollSequenceType').innerHTML = opts
    if (presetSequenceType) document.getElementById('enrollSequenceType').value = presetSequenceType
  } catch {}
  document.getElementById('enrollRecipient').value = ''
  document.getElementById('enrollCustomerId').value = ''
  document.getElementById('enrollStartStep').value = '0'
  document.getElementById('enrollDelay').value = '0'
  document.getElementById('enrollNotes').value = ''
  document.getElementById('enrollModal').classList.add('show')
}

document.getElementById('enrollConfirmBtn').onclick = async () => {
  const sequence_type = document.getElementById('enrollSequenceType').value
  const recipient_email = document.getElementById('enrollRecipient').value.trim()
  const customer_id = parseInt(document.getElementById('enrollCustomerId').value, 10) || null
  const start_at_step = parseInt(document.getElementById('enrollStartStep').value, 10) || 0
  const delay_seconds = parseInt(document.getElementById('enrollDelay').value, 10) || 0
  const notes = document.getElementById('enrollNotes').value.trim() || null
  if (!sequence_type || !recipient_email) { alert('Sequence + recipient required'); return }
  const btn = document.getElementById('enrollConfirmBtn')
  btn.disabled = true; btn.textContent = 'Enrolling…'
  try {
    const r = await fetch('/api/super-admin/email-tracker/enrollments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sequence_type, recipient_email, customer_id, start_at_step, delay_seconds, notes })
    }).then(r => r.json())
    if (r.ok) {
      closeModal('enrollModal')
      currentTab = 'enrollments'
      document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === 'enrollments'))
      loadEnrollments(); loadStats()
    } else { alert('Failed: ' + (r.error || 'unknown')) }
  } catch (e) { alert('Error: ' + e.message) }
  finally { btn.disabled = false; btn.textContent = 'Enroll' }
}

// ── Sequence editor (custom only) ─────────────────────────────
let editorOriginalKey = null

function openSeqEditor() {
  editorOriginalKey = null
  document.getElementById('seqEditorTitle').textContent = 'New Custom Sequence'
  document.getElementById('seqEditorKey').value = 'custom_'
  document.getElementById('seqEditorKey').disabled = false
  document.getElementById('seqEditorName').value = ''
  document.getElementById('seqEditorDescription').value = ''
  document.getElementById('seqEditorFrom').value = 'sales@roofmanager.ca'
  document.getElementById('seqEditorCategory').value = 'customer'
  document.getElementById('seqEditorSteps').innerHTML = ''
  addStepRow()
  document.getElementById('seqEditorModal').classList.add('show')
}

async function editSequence(sequenceType) {
  try {
    const r = await fetch('/api/super-admin/email-tracker/sequences/' + encodeURIComponent(sequenceType)).then(r => r.json())
    if (!r.definition) throw new Error('not found')
    const d = r.definition
    editorOriginalKey = d.sequence_type
    document.getElementById('seqEditorTitle').textContent = 'Edit Sequence — ' + d.name
    document.getElementById('seqEditorKey').value = d.sequence_type
    document.getElementById('seqEditorKey').disabled = true  // keys are immutable
    document.getElementById('seqEditorName').value = d.name
    document.getElementById('seqEditorDescription').value = d.description || ''
    document.getElementById('seqEditorFrom').value = d.default_from || 'sales@roofmanager.ca'
    document.getElementById('seqEditorCategory').value = d.default_category || 'customer'
    document.getElementById('seqEditorSteps').innerHTML = ''
    for (const s of d.steps) addStepRow(s)
    document.getElementById('seqEditorModal').classList.add('show')
  } catch (e) { alert('Error: ' + e.message) }
}

function addStepRow(prefill) {
  const idx = document.querySelectorAll('#seqEditorSteps .step-row').length
  const row = document.createElement('div')
  row.className = 'step-row'
  row.style.cssText = 'background:var(--bg-elevated);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:10px'
  const delaySec = prefill?.delay_seconds ?? 0
  row.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
    + '<strong style="font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted)">Step ' + idx + '</strong>'
    + '<button class="btn btn-danger" style="padding:4px 10px;font-size:11px" onclick="this.closest(\\'.step-row\\').remove()">Remove</button>'
    + '</div>'
    + '<label>Label</label><input type="text" class="step-label" value="' + escapeHtml(prefill?.label || '') + '">'
    + '<label>Delay after previous step</label>'
    + '<div style="display:grid;grid-template-columns:1fr 120px;gap:8px">'
    +   '<input type="number" class="step-delay-value" min="0" value="' + (delaySec >= 86400 ? Math.round(delaySec/86400) : delaySec >= 3600 ? Math.round(delaySec/3600) : delaySec >= 60 ? Math.round(delaySec/60) : delaySec) + '">'
    +   '<select class="step-delay-unit">'
    +     '<option value="1"' + (delaySec < 60 ? ' selected' : '') + '>seconds</option>'
    +     '<option value="60"' + (delaySec >= 60 && delaySec < 3600 ? ' selected' : '') + '>minutes</option>'
    +     '<option value="3600"' + (delaySec >= 3600 && delaySec < 86400 ? ' selected' : '') + '>hours</option>'
    +     '<option value="86400"' + (delaySec >= 86400 ? ' selected' : '') + '>days</option>'
    +   '</select>'
    + '</div>'
    + '<label>Subject template</label><input type="text" class="step-subject" value="' + escapeHtml(prefill?.subject_template || '') + '" placeholder="Hi {{first_name}}, ...">'
    + '<label>Body HTML template</label><textarea class="step-body" placeholder="&lt;p&gt;Hi {{first_name}},&lt;/p&gt;...">' + escapeHtml(prefill?.body_html_template || '') + '</textarea>'
  document.getElementById('seqEditorSteps').appendChild(row)
}

function collectEditorPayload() {
  const sequence_type = document.getElementById('seqEditorKey').value.trim()
  const name = document.getElementById('seqEditorName').value.trim()
  const description = document.getElementById('seqEditorDescription').value.trim()
  const default_from = document.getElementById('seqEditorFrom').value
  const default_category = document.getElementById('seqEditorCategory').value
  const stepRows = document.querySelectorAll('#seqEditorSteps .step-row')
  const steps = []
  let idx = 0
  for (const r of stepRows) {
    const val = parseInt(r.querySelector('.step-delay-value').value, 10) || 0
    const unit = parseInt(r.querySelector('.step-delay-unit').value, 10) || 1
    steps.push({
      step_index: idx++,
      label: r.querySelector('.step-label').value.trim() || ('Step ' + idx),
      delay_seconds: val * unit,
      subject_template: r.querySelector('.step-subject').value,
      body_html_template: r.querySelector('.step-body').value,
    })
  }
  return { sequence_type, name, description, default_from, default_category, steps }
}

document.getElementById('seqEditorSaveBtn').onclick = async () => {
  const payload = collectEditorPayload()
  if (!payload.sequence_type || !payload.name || !payload.steps.length) { alert('Key, name, and at least one step required'); return }
  if (!payload.sequence_type.startsWith('custom_')) { alert('Key must start with custom_'); return }
  const btn = document.getElementById('seqEditorSaveBtn')
  btn.disabled = true; btn.textContent = 'Saving…'
  try {
    const r = await fetch('/api/super-admin/email-tracker/sequences', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(r => r.json())
    if (r.ok) { closeModal('seqEditorModal'); loadSequences() }
    else { alert('Failed: ' + (r.error || 'unknown')) }
  } catch (e) { alert('Error: ' + e.message) }
  finally { btn.disabled = false; btn.textContent = 'Save' }
}

document.getElementById('seqEditorTestBtn').onclick = async () => {
  const payload = collectEditorPayload()
  if (!payload.sequence_type || !payload.steps.length) { alert('Need key + steps to test'); return }
  const to = prompt('Test-send step 0 to:', 'christinegourley04@gmail.com')
  if (!to) return
  // First save (so the definition exists), then test-send
  try {
    await fetch('/api/super-admin/email-tracker/sequences', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const r = await fetch('/api/super-admin/email-tracker/sequences/' + encodeURIComponent(payload.sequence_type) + '/test-send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step_index: 0, to_email: to })
    }).then(r => r.json())
    if (r.ok) alert('Test sent to ' + to + ' (email_sends.id=' + r.emailSendId + ')')
    else alert('Failed: ' + (r.error || 'unknown'))
  } catch (e) { alert('Error: ' + e.message) }
}

async function archiveSequence(sequenceType) {
  if (!confirm('Archive ' + sequenceType + '? Cancels all active enrollments in this sequence.')) return
  await fetch('/api/super-admin/email-tracker/sequences/' + encodeURIComponent(sequenceType), { method: 'DELETE' })
  loadSequences()
}

loadStats()
loadFeed()
setInterval(loadStats, 30000)
</script>
</body>
</html>`
}

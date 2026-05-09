// ============================================================
// MARKETING BLAST — One-shot reengagement email to inactive signups.
// ============================================================
// Auth: bearer token matched against env.FUNNEL_MONITOR_TOKEN — same
// pattern as funnel-monitor / reports-monitor. Runs from outside a
// browser session, hence no admin cookie.
//
// Modes:
//   ?mode=preview         → returns recipient count + 10-row sample
//   ?mode=send            → fires Gmail OAuth2 send to all targets
//   ?test_to=<email>      → sends a single email to that address
//                           (uses 'never_ordered' copy, ignores cohort query)
//   ?dry_run=1 + send     → walks the full loop without firing Gmail
//   ?max=N                → caps recipients at N (default 200, hard cap 500)
//
// Cohorts (one query, two filters union'd):
//   - never_ordered: signed up ≥3 days ago, zero orders ever
//   - dormant:       last order ≥60 days ago
// Per-recipient copy varies by cohort.

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { sendGmailOAuth2 } from '../services/email'

export const marketingBlastRoutes = new Hono<{ Bindings: Bindings }>()

marketingBlastRoutes.post('/reengagement-blast', async (c) => {
  const env: any = c.env

  // --- Bearer token auth
  const expected = env.FUNNEL_MONITOR_TOKEN
  if (!expected) return c.json({ error: 'FUNNEL_MONITOR_TOKEN not configured' }, 503)
  const auth = c.req.header('Authorization') || ''
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (presented !== expected) return c.json({ error: 'Unauthorized' }, 401)

  const mode = (c.req.query('mode') || 'preview').toLowerCase()
  const dryRun = c.req.query('dry_run') === '1'
  const testTo = c.req.query('test_to') || ''
  const maxSend = Math.min(parseInt(c.req.query('max') || '200', 10) || 200, 500)

  // --- Resolve Gmail OAuth2 credentials (env, with D1 fallback for refresh_token)
  const clientId = env.GMAIL_CLIENT_ID || ''
  let clientSecret = env.GMAIL_CLIENT_SECRET || ''
  let refreshToken = env.GMAIL_REFRESH_TOKEN || ''
  if (!refreshToken) {
    try {
      const r = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_refresh_token' AND master_company_id=1").first<any>()
      if (r?.setting_value) refreshToken = r.setting_value
    } catch {}
  }
  if (!clientSecret) {
    try {
      const s = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_client_secret' AND master_company_id=1").first<any>()
      if (s?.setting_value) clientSecret = s.setting_value
    } catch {}
  }

  const subject = 'Quick hello from Roof Manager — 20% off this week'
  const senderEmail = env.GMAIL_SENDER_EMAIL || 'sales@roofmanager.ca'

  // --- Single test send: bypass cohort query, send one email and return
  if (testTo) {
    if (!clientId || !clientSecret || !refreshToken) {
      return c.json({ ok: false, error: 'Gmail OAuth2 credentials incomplete' }, 500)
    }
    const firstName = testTo.split('@')[0]
    const display = firstName.charAt(0).toUpperCase() + firstName.slice(1)
    const html = buildReengagementHtml(display, 'never_ordered', testTo)
    try {
      const r = await sendGmailOAuth2(clientId, clientSecret, refreshToken, testTo, subject, html, senderEmail)
      return c.json({ ok: true, mode: 'test_to', sent_to: testTo, message_id: r.id })
    } catch (e: any) {
      return c.json({ ok: false, mode: 'test_to', error: e?.message || String(e) }, 500)
    }
  }

  // --- Recipient query: never_ordered ∪ dormant_60d, is_active, has email.
  // Exclude internal team (@roofmanager.ca), test fixtures
  // (@roofmanager.test, '%@example.com'), and the superadmin's own
  // address — none of those should receive a marketing promo.
  const rows = await c.env.DB.prepare(`
    SELECT
      c.id,
      c.email,
      COALESCE(NULLIF(TRIM(c.name), ''), c.email) AS display_name,
      c.created_at,
      MAX(o.created_at) AS last_order_at,
      COUNT(o.id) AS total_orders
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    WHERE c.is_active = 1
      AND c.email IS NOT NULL
      AND TRIM(c.email) != ''
      AND LOWER(c.email) NOT LIKE '%@roofmanager.ca'
      AND LOWER(c.email) NOT LIKE '%@roofmanager.test'
      AND LOWER(c.email) NOT LIKE '%@example.com'
      AND LOWER(c.email) != 'christinegourley04@gmail.com'
      AND LOWER(c.email) != 'ethangourley@icloud.com'
      AND c.email LIKE '%_@_%._%'
    GROUP BY c.id
    HAVING (COUNT(o.id) = 0 AND c.created_at < datetime('now','-3 days'))
        OR MAX(o.created_at) < datetime('now','-60 days')
    ORDER BY c.created_at DESC
  `).all<any>()

  const recipients = (rows.results || []).map((r: any) => {
    const cohort = (r.total_orders === 0) ? 'never_ordered' : 'dormant'
    const firstName = (r.display_name || '').split(/[\s@]/)[0] || 'there'
    return {
      id: r.id,
      email: r.email,
      first_name: firstName.charAt(0).toUpperCase() + firstName.slice(1),
      cohort: cohort as 'never_ordered' | 'dormant',
      created_at: r.created_at,
      last_order_at: r.last_order_at,
      total_orders: r.total_orders,
    }
  })

  const counts = {
    total: recipients.length,
    never_ordered: recipients.filter(r => r.cohort === 'never_ordered').length,
    dormant: recipients.filter(r => r.cohort === 'dormant').length,
  }

  if (mode === 'preview') {
    return c.json({
      ok: true,
      mode: 'preview',
      counts,
      sample: recipients.slice(0, 10).map(r => ({
        email: r.email,
        first_name: r.first_name,
        cohort: r.cohort,
        total_orders: r.total_orders,
        created_at: r.created_at,
        last_order_at: r.last_order_at,
      })),
    })
  }

  if (mode !== 'send') {
    return c.json({ ok: false, error: 'mode must be preview, send, or pass test_to' }, 400)
  }

  if (!clientId || !clientSecret || !refreshToken) {
    return c.json({ ok: false, error: 'Gmail OAuth2 credentials incomplete' }, 500)
  }

  const targets = recipients.slice(0, maxSend)
  const sent: string[] = []
  const failed: { email: string, error: string }[] = []

  for (let i = 0; i < targets.length; i++) {
    const r = targets[i]
    const html = buildReengagementHtml(r.first_name, r.cohort, r.email)
    if (dryRun) {
      sent.push(r.email)
      continue
    }
    try {
      await sendGmailOAuth2(clientId, clientSecret, refreshToken, r.email, subject, html, senderEmail)
      sent.push(r.email)
    } catch (e: any) {
      failed.push({ email: r.email, error: e?.message || String(e) })
    }
    // Per-recipient throttle so we don't trip Gmail's send quotas on large
    // blasts. Skip the wait after the last send.
    if (i < targets.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }

  return c.json({
    ok: true,
    mode: 'send',
    dry_run: dryRun,
    counts,
    delivered: sent.length,
    failed_count: failed.length,
    failed_sample: failed.slice(0, 10),
  })
})

function buildReengagementHtml(firstName: string, cohort: 'never_ordered' | 'dormant', recipientEmail: string): string {
  const noticeLine = cohort === 'never_ordered'
    ? "Wanted to check in personally — I noticed you signed up but haven't pulled a report yet, and I'd love to get you set up."
    : "Wanted to check in personally — I noticed it's been a while since your last report, and I'd love to bring you back."

  const calendarUrl = 'https://calendar.app.google/D7geGYEwiGPaaWvH6'
  const phone = '780-983-3335'

  const priceRow = (label: string, regular: string, sale: string, perReport: string) => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #E5E7EB;font-size:14px;color:#1a1a2e;font-weight:600">${label}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #E5E7EB;font-size:13px;color:#9CA3AF;text-decoration:line-through;text-align:right">${regular}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #E5E7EB;font-size:15px;color:#1E3A5F;font-weight:800;text-align:right">${sale}</td>
      <td style="padding:10px 14px;border-bottom:1px solid #E5E7EB;font-size:12px;color:#6B7280;text-align:right">${perReport}</td>
    </tr>`

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px">

  <div style="background:#000;color:#fff;padding:20px 28px;border-radius:12px 12px 0 0;text-align:center">
    <img src="https://www.roofmanager.ca/static/logo.png?v=20260504" alt="Roof Manager" width="180" style="max-width:180px;height:auto;display:block;margin:0 auto"/>
    <div style="font-size:12px;color:#9CA3AF;margin-top:8px;letter-spacing:0.5px">A note from Ethan</div>
  </div>

  <div style="background:#fff;padding:28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <p style="font-size:15px;color:#1a1a2e;margin:0 0 12px">Hi ${escapeHtml(firstName)},</p>
    <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 16px">
      Ethan here from Roof Manager. ${noticeLine}
    </p>
    <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 8px">
      <strong>This week only — 20% off all report packages:</strong>
    </p>
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:8px 0 20px;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden">
      ${priceRow('10-Pack', '$80', '$64', '$6.40 / report')}
      ${priceRow('25-Pack', '$187.50', '$150', '$6.00 / report')}
      ${priceRow('50-Pack', '$347.50', '$278', '$5.56 / report')}
      ${priceRow('100-Pack', '$595', '$476', '$4.76 / report')}
    </table>
    <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 16px">
      Want a quick walkthrough first? Grab 15 minutes on my calendar — I'll show you exactly how to pull a measurement report and where roofers are saving the most time.
    </p>
    <div style="text-align:center;margin:20px 0 12px">
      <a href="${calendarUrl}" style="display:inline-block;background:#1E3A5F;color:#fff;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px;text-decoration:none">Book a Demo / Tutorial</a>
    </div>
    <p style="font-size:14px;color:#374151;line-height:1.6;margin:16px 0 0;text-align:center">
      Or text / call me direct: <a href="tel:+17809833335" style="color:#1E3A5F;font-weight:700;text-decoration:none">${phone}</a>
    </p>
    <p style="font-size:14px;color:#1a1a2e;margin:24px 0 0">— Ethan, Roof Manager</p>
  </div>

  <div style="text-align:center;padding:16px;color:#9CA3AF;font-size:11px;line-height:1.5">
    <p style="margin:0">Sent to ${escapeHtml(recipientEmail)} because you signed up at roofmanager.ca.</p>
    <p style="margin:4px 0 0">Reply with "stop" if you'd rather not hear from me.</p>
  </div>
</div>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return String(s || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[ch])
}

// ============================================================
// ADS SECRETS CHECKER — One-screen status of every ad/analytics
// env var the app reads. Mounts at GET /super-admin/ads-secrets-checker.
//
// Surfaces ✅/❌ for each var WITHOUT exposing the value. Helpful
// for confirming "did the secret actually save in Cloudflare" before
// running /ads-health which probes them indirectly.
//
// Auth: superadmin session (mirrors admin.ts pattern).
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { validateAdminSession, requireSuperadmin } from './auth'

export const adsSecretsRoutes = new Hono<{ Bindings: Bindings }>()

interface SecretEntry {
  name: string
  required_for: string
  set: boolean
  redacted: string  // length-only summary, e.g. "set (38 chars)"
}

function entry(env: Bindings, name: string, requiredFor: string): SecretEntry {
  const v = (env as any)[name]
  const isSet = !!(v && String(v).trim())
  return {
    name,
    required_for: requiredFor,
    set: isSet,
    redacted: isSet ? `set (${String(v).length} chars)` : 'NOT SET',
  }
}

adsSecretsRoutes.get('/api/super-admin/ads-secrets/status', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!requireSuperadmin(admin)) return c.json({ error: 'Superadmin access required' }, 403)
  const e = c.env as any
  const secrets: SecretEntry[] = [
    entry(e, 'GA4_MEASUREMENT_ID',     'GA4 client-side gtag.js (page_view, sign_up events)'),
    entry(e, 'GA4_API_SECRET',         'GA4 server-side Measurement Protocol (purchase events from webhooks)'),
    entry(e, 'GA4_PROPERTY_ID',        'GA4 Data API queries from /super-admin analytics'),
    entry(e, 'META_PIXEL_ID',          'Meta Pixel script in HTML (PageView, Lead, ViewContent)'),
    entry(e, 'META_CAPI_ACCESS_TOKEN', 'Meta Conversions API server-side fires (Lead, Purchase)'),
    entry(e, 'META_APP_ID',            'Meta OAuth long-lived token exchange in /super-admin/meta-connect'),
    entry(e, 'META_APP_SECRET',        'Meta OAuth long-lived token exchange'),
    entry(e, 'META_AD_ACCOUNT_ID',     'Meta campaign creation from /super-admin/meta-connect'),
    entry(e, 'GADS_LEAD_LABEL',        'Google Ads conversion fire on lead-form submissions'),
    entry(e, 'GADS_CONTACT_LABEL',     'Google Ads conversion fire on contact-form submissions'),
    entry(e, 'GADS_DEMO_LABEL',        'Google Ads conversion fire on demo bookings'),
    entry(e, 'GADS_PURCHASE_LABEL',    'Google Ads conversion fire on Square checkout success'),
    entry(e, 'GOOGLE_ADS_DEVELOPER_TOKEN', 'Server-side Google Ads Conversions API uploads (offline conversions)'),
  ]
  const total = secrets.length
  const setCount = secrets.filter(s => s.set).length
  const missing = secrets.filter(s => !s.set).map(s => s.name)
  return c.json({
    summary: { total, set: setCount, missing: total - setCount },
    secrets,
    missing_list: missing,
    checked_at: new Date().toISOString(),
  })
})

adsSecretsRoutes.get('/super-admin/ads-secrets-checker', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!requireSuperadmin(admin)) {
    return c.redirect('/admin/login?redirect=/super-admin/ads-secrets-checker')
  }
  return c.html(`<!doctype html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ads + Analytics Secrets Checker · Super Admin</title>
<link rel="stylesheet" href="/static/tailwind.css">
<style>
  body{background:#0b0f17;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:24px;min-height:100vh}
  .wrap{max-width:880px;margin:0 auto}
  h1{font-size:24px;font-weight:700;margin:0 0 6px}
  .sub{color:#94a3b8;font-size:14px;margin-bottom:18px}
  .summary{background:#111827;border:1px solid #1f2937;border-radius:10px;padding:16px;margin-bottom:18px;display:flex;gap:24px;align-items:center;flex-wrap:wrap}
  .stat{text-align:center}.stat .n{font-size:28px;font-weight:700}.stat .l{font-size:11px;color:#9ca3af;letter-spacing:1px;text-transform:uppercase}
  .ok{color:#16a34a}.bad{color:#dc2626}
  table{width:100%;border-collapse:collapse;background:#111827;border:1px solid #1f2937;border-radius:10px;overflow:hidden}
  th,td{padding:10px 14px;text-align:left;border-bottom:1px solid #1f2937;font-size:13px}
  th{background:#0f172a;font-size:11px;color:#9ca3af;letter-spacing:1px;text-transform:uppercase;font-weight:600}
  tr:last-child td{border-bottom:0}
  .name{font-family:'SFMono-Regular',Consolas,monospace;font-weight:600}
  .pill{display:inline-block;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;letter-spacing:.3px}
  .pill.set{background:#052e16;color:#86efac}
  .pill.unset{background:#450a0a;color:#fca5a5}
  .desc{color:#94a3b8;font-size:12px}
  .nav{margin-bottom:18px;font-size:12px}
  .nav a{color:#38bdf8;text-decoration:none}
  button{background:#1e40af;color:#fff;border:0;padding:8px 14px;border-radius:8px;font-weight:600;cursor:pointer;font-size:13px}
</style>
</head><body>
<div class="wrap">
  <div class="nav">← <a href="/super-admin/loop-tracker">Loop Tracker</a></div>
  <h1>Ads + Analytics Secrets Checker</h1>
  <div class="sub">Status of every Cloudflare Pages secret the ad-tracking stack reads. Values are NOT exposed — only "set / not set" + length. Refresh after you add a secret in the Cloudflare dashboard.</div>
  <div class="summary" id="summary">Loading…</div>
  <button onclick="load()" style="margin-bottom:14px">Refresh</button>
  <table id="tbl"><thead><tr><th>Secret</th><th>Status</th><th>What it powers</th></tr></thead>
    <tbody id="tbody"><tr><td colspan="3" style="color:#94a3b8;padding:18px">Loading…</td></tr></tbody>
  </table>
</div>
<script>
async function load() {
  const r = await fetch('/api/super-admin/ads-secrets/status', { credentials: 'include' });
  if (!r.ok) { document.getElementById('summary').textContent = 'Error: ' + r.status; return; }
  const d = await r.json();
  document.getElementById('summary').innerHTML =
    '<div class="stat"><div class="n">' + d.summary.set + '</div><div class="l">Set</div></div>' +
    '<div class="stat"><div class="n bad">' + d.summary.missing + '</div><div class="l">Missing</div></div>' +
    '<div class="stat"><div class="n">' + d.summary.total + '</div><div class="l">Total checked</div></div>' +
    '<div style="flex:1;text-align:right;color:#94a3b8;font-size:12px">Checked ' + new Date(d.checked_at).toLocaleString() + '</div>';
  document.getElementById('tbody').innerHTML = d.secrets.map(s =>
    '<tr><td class="name">' + s.name + '</td>'
    + '<td><span class="pill ' + (s.set ? 'set' : 'unset') + '">' + (s.set ? '✓ ' + s.redacted : '✗ NOT SET') + '</span></td>'
    + '<td class="desc">' + s.required_for + '</td></tr>'
  ).join('');
}
load();
</script>
</body></html>`)
})

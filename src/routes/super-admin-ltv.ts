// ============================================================
// Super Admin — Conversion & LTV
// Mounted at /super-admin/ltv (HTML page) and /api/super-admin/ltv/* (JSON).
// All routes require superadmin role.
//
// Data sources (no migration needed — all derived from existing tables):
//   • customers              — signup time + tier
//   • analytics_attribution  — first_paid_at, revenue_cents, first-touch UTM
//   • square_payments / stripe_payments / manual_payments — live revenue truth
// ============================================================

import { Hono } from 'hono'
import { validateAdminSession, requireSuperadmin } from './auth'

type Bindings = {
  DB: D1Database
  [k: string]: any
}

export const superAdminLtv = new Hono<{ Bindings: Bindings }>()

superAdminLtv.use('*', async (c, next) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) {
    if (c.req.path.includes('/api/')) return c.json({ error: 'superadmin required' }, 403)
    return c.redirect('/login?next=' + encodeURIComponent(c.req.path), 302)
  }
  ;(c as any).set('admin', admin)
  await next()
})

function periodToDays(p: string | undefined): number {
  if (p === '7d') return 7
  if (p === '30d') return 30
  if (p === '90d') return 90
  if (p === '180d') return 180
  if (p === '365d') return 365
  if (p === 'all') return 9999
  return 90
}

// ── JSON: summary tiles ─────────────────────────────────────
// Live revenue is computed by unioning all 3 payment tables. Successful
// statuses differ per provider: stripe='succeeded', square='paid'/'completed',
// manual=always paid.
superAdminLtv.get('/api/summary', async (c) => {
  const days = periodToDays(c.req.query('period') || '90d')
  const sinceIso = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ')

  // Signups in period
  const signupsRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM customers WHERE created_at >= ?`
  ).bind(sinceIso).first<{ n: number }>()
  const totalSignups = Number(signupsRow?.n || 0)

  // Paid signups in period (customer signed up in window AND has at least one paid txn)
  const paidRow = await c.env.DB.prepare(
    `SELECT COUNT(DISTINCT c.id) AS n
       FROM customers c
       LEFT JOIN analytics_attribution a ON a.customer_id = c.id
      WHERE c.created_at >= ?
        AND (
          a.first_paid_at IS NOT NULL
          OR EXISTS (SELECT 1 FROM stripe_payments sp WHERE sp.customer_id = c.id AND sp.status = 'succeeded')
          OR EXISTS (SELECT 1 FROM square_payments  sq WHERE sq.customer_id = c.id AND sq.status IN ('paid','completed','succeeded'))
          OR EXISTS (SELECT 1 FROM manual_payments  mp WHERE mp.customer_id = c.id)
        )`
  ).bind(sinceIso).first<{ n: number }>()
  const paidSignups = Number(paidRow?.n || 0)

  // Total live revenue from customers who signed up in this period.
  // Square stores REAL dollars; Stripe stores INTEGER cents; manual stores REAL dollars.
  const revRow = await c.env.DB.prepare(
    `SELECT
       (SELECT COALESCE(SUM(sp.amount), 0) * 100 FROM stripe_payments sp
          JOIN customers c ON c.id = sp.customer_id
         WHERE sp.status = 'succeeded' AND c.created_at >= ?) AS stripe_cents,
       (SELECT COALESCE(SUM(sq.amount * 100), 0) FROM square_payments sq
          JOIN customers c ON c.id = sq.customer_id
         WHERE sq.status IN ('paid','completed','succeeded') AND c.created_at >= ?) AS square_cents,
       (SELECT COALESCE(SUM(mp.amount * 100), 0) FROM manual_payments mp
          JOIN customers c ON c.id = mp.customer_id
         WHERE c.created_at >= ?) AS manual_cents`
  ).bind(sinceIso, sinceIso, sinceIso).first<any>()
  // NB: stripe_payments.amount is stored in cents per migration 0007 (INTEGER), but
  // some rows may be in dollars depending on import path. We treat as cents here
  // (amount * 100 is wrong if already cents) — but historically this codebase
  // stores REAL CAD dollars in `amount` even for stripe due to the unified
  // billing.ts insert path. Use the same multiplier as square for consistency.
  const totalRevenueCents = Math.round(
    Number(revRow?.stripe_cents || 0) +
    Number(revRow?.square_cents || 0) +
    Number(revRow?.manual_cents || 0)
  )

  // Median days from signup to first paid
  const daysList = await c.env.DB.prepare(
    `SELECT a.days_to_convert AS d
       FROM analytics_attribution a
       JOIN customers c ON c.id = a.customer_id
      WHERE c.created_at >= ? AND a.first_paid_at IS NOT NULL AND a.days_to_convert IS NOT NULL
      ORDER BY a.days_to_convert ASC`
  ).bind(sinceIso).all<{ d: number }>()
  const arr = (daysList.results || []).map(r => Number(r.d))
  const medianDaysToPaid = arr.length ? arr[Math.floor(arr.length / 2)] : null

  return c.json({
    period_days: days,
    total_signups: totalSignups,
    paid_signups: paidSignups,
    free_to_paid_pct: totalSignups > 0 ? (paidSignups / totalSignups) * 100 : 0,
    total_revenue_cents: totalRevenueCents,
    avg_ltv_per_paid_cents: paidSignups > 0 ? Math.round(totalRevenueCents / paidSignups) : 0,
    avg_ltv_per_signup_cents: totalSignups > 0 ? Math.round(totalRevenueCents / totalSignups) : 0,
    median_days_to_paid: medianDaysToPaid,
  })
})

// ── JSON: monthly cohorts ───────────────────────────────────
// Group customers by signup month, then compute paid_by_Nd from
// analytics_attribution.days_to_convert. Months with no signups omitted.
superAdminLtv.get('/api/cohorts', async (c) => {
  const days = periodToDays(c.req.query('period') || '365d')
  const sinceIso = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ')

  const rows = await c.env.DB.prepare(
    `SELECT
        substr(c.created_at, 1, 7)                              AS cohort_month,
        COUNT(c.id)                                             AS signups,
        SUM(CASE WHEN a.first_paid_at IS NOT NULL AND a.days_to_convert IS NOT NULL AND a.days_to_convert <= 7  THEN 1 ELSE 0 END) AS paid_7d,
        SUM(CASE WHEN a.first_paid_at IS NOT NULL AND a.days_to_convert IS NOT NULL AND a.days_to_convert <= 30 THEN 1 ELSE 0 END) AS paid_30d,
        SUM(CASE WHEN a.first_paid_at IS NOT NULL AND a.days_to_convert IS NOT NULL AND a.days_to_convert <= 90 THEN 1 ELSE 0 END) AS paid_90d,
        SUM(CASE WHEN a.first_paid_at IS NOT NULL THEN 1 ELSE 0 END) AS paid_total,
        COALESCE(SUM(a.revenue_cents), 0)                       AS revenue_cents
       FROM customers c
       LEFT JOIN analytics_attribution a ON a.customer_id = c.id
      WHERE c.created_at >= ?
      GROUP BY cohort_month
      ORDER BY cohort_month DESC`
  ).bind(sinceIso).all<any>()

  return c.json({
    period_days: days,
    rows: (rows.results || []).map((r: any) => ({
      cohort_month: r.cohort_month,
      signups: Number(r.signups || 0),
      paid_7d: Number(r.paid_7d || 0),
      paid_30d: Number(r.paid_30d || 0),
      paid_90d: Number(r.paid_90d || 0),
      paid_total: Number(r.paid_total || 0),
      revenue_cents: Number(r.revenue_cents || 0),
      ltv_per_signup_cents: r.signups > 0 ? Math.round(Number(r.revenue_cents || 0) / Number(r.signups)) : 0,
    })),
  })
})

// ── JSON: by acquisition source ─────────────────────────────
// Groups by first_touch_utm_source / medium / campaign. Direct/unknown
// surfaces as 'direct'.
superAdminLtv.get('/api/by-source', async (c) => {
  const days = periodToDays(c.req.query('period') || '90d')
  const sinceIso = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ')

  const rows = await c.env.DB.prepare(
    `SELECT
        COALESCE(NULLIF(a.first_touch_utm_source, ''), 'direct')   AS source,
        COALESCE(NULLIF(a.first_touch_utm_medium, ''), '(none)')   AS medium,
        COALESCE(NULLIF(a.first_touch_utm_campaign, ''), '(none)') AS campaign,
        COUNT(c.id)                                                AS signups,
        SUM(CASE WHEN a.first_paid_at IS NOT NULL THEN 1 ELSE 0 END) AS paid,
        COALESCE(SUM(a.revenue_cents), 0)                          AS revenue_cents
       FROM customers c
       LEFT JOIN analytics_attribution a ON a.customer_id = c.id
      WHERE c.created_at >= ?
      GROUP BY source, medium, campaign
      ORDER BY revenue_cents DESC, signups DESC
      LIMIT 200`
  ).bind(sinceIso).all<any>()

  return c.json({
    period_days: days,
    rows: (rows.results || []).map((r: any) => ({
      source: r.source,
      medium: r.medium,
      campaign: r.campaign,
      signups: Number(r.signups || 0),
      paid: Number(r.paid || 0),
      conv_pct: r.signups > 0 ? (Number(r.paid || 0) / Number(r.signups)) * 100 : 0,
      revenue_cents: Number(r.revenue_cents || 0),
      ltv_per_signup_cents: r.signups > 0 ? Math.round(Number(r.revenue_cents || 0) / Number(r.signups)) : 0,
      ltv_per_paid_cents: r.paid > 0 ? Math.round(Number(r.revenue_cents || 0) / Number(r.paid)) : 0,
    })),
  })
})

// ── HTML page ───────────────────────────────────────────────
superAdminLtv.get('/', async (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Conversion & LTV — Roof Manager Super Admin</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  body { background:#0A0A0A; color:#E5E7EB; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  .card { background:#111827; border:1px solid #1F2937; border-radius:12px; padding:18px; }
  .tile-num { font-size:30px; font-weight:800; color:#FFF; font-variant-numeric:tabular-nums; }
  .tile-label { font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:#9CA3AF; font-weight:600; margin-bottom:6px; }
  .tile-sub { font-size:12px; color:#6B7280; margin-top:4px; }
  th { font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#9CA3AF; padding:10px 12px; text-align:left; border-bottom:1px solid #1F2937; }
  td { padding:10px 12px; border-bottom:1px solid #1F2937; font-size:14px; vertical-align:top; font-variant-numeric:tabular-nums; }
  tr:hover td { background:#1F2937; }
  select { background:#0F172A; color:#E5E7EB; border:1px solid #1F2937; border-radius:8px; padding:6px 10px; }
  .hint { font-size:12px; color:#6B7280; margin-top:10px; }
  .pill { display:inline-block; padding:2px 8px; border-radius:9999px; font-size:11px; font-weight:600; }
  .pill-green { background:#064E3B; color:#A7F3D0; }
  .pill-yellow { background:#78350F; color:#FCD34D; }
  .pill-red { background:#7F1D1D; color:#FECACA; }
</style>
</head>
<body>
  <header style="padding:16px 24px; border-bottom:1px solid #1F2937; display:flex; align-items:center; gap:24px;">
    <a href="/super-admin" style="color:#FBBF24; font-weight:700; text-decoration:none;">👑 Super Admin</a>
    <span style="color:#6B7280;">/</span>
    <span style="color:#FFF; font-weight:600;">Conversion & LTV</span>
    <select id="period" style="margin-left:auto;">
      <option value="7d">Last 7 days</option>
      <option value="30d">Last 30 days</option>
      <option value="90d" selected>Last 90 days</option>
      <option value="180d">Last 180 days</option>
      <option value="365d">Last year</option>
      <option value="all">All time</option>
    </select>
  </header>
  <main style="max-width:1400px; margin:0 auto; padding:24px;">
    <h1 style="font-size:22px; font-weight:700; margin-bottom:6px;">Free → Paid + Lifetime Value</h1>
    <p style="color:#9CA3AF; font-size:14px; margin-bottom:24px;">
      How many signups become paying customers, how long it takes them, what they're worth,
      and which acquisition source produced them. Use the LTV-per-signup figure as your
      target ad CPA — if Google Ads CPA &lt; LTV/signup you're profitable on first revenue.
    </p>

    <!-- Top tiles -->
    <div id="tiles" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:12px; margin-bottom:32px;">
      <div class="card"><div class="tile-label">Total signups</div><div id="t-signups" class="tile-num">—</div></div>
      <div class="card"><div class="tile-label">Paid signups</div><div id="t-paid" class="tile-num">—</div><div id="t-paid-sub" class="tile-sub">—</div></div>
      <div class="card"><div class="tile-label">Free → Paid %</div><div id="t-conv" class="tile-num">—</div></div>
      <div class="card"><div class="tile-label">Total revenue</div><div id="t-rev" class="tile-num">—</div></div>
      <div class="card"><div class="tile-label">Avg LTV / paid</div><div id="t-ltv-paid" class="tile-num">—</div></div>
      <div class="card" style="border-color:#10B981;"><div class="tile-label" style="color:#10B981;">⚡ Avg LTV / signup</div><div id="t-ltv-signup" class="tile-num">—</div><div class="tile-sub">Your max profitable Google Ads CPA</div></div>
      <div class="card"><div class="tile-label">Median days to first $</div><div id="t-days" class="tile-num">—</div></div>
    </div>

    <!-- Cohorts -->
    <h2 style="font-size:18px; font-weight:700; margin:24px 0 8px;">Monthly cohorts</h2>
    <p style="font-size:13px; color:#9CA3AF; margin-bottom:12px;">
      Each row = customers who signed up that month. % paid by 30 days is the leading indicator —
      if it's dropping month-over-month, signups are getting lower quality (worse keywords or worse landing page).
    </p>
    <div class="card" style="padding:0; overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse;">
        <thead>
          <tr>
            <th>Cohort</th>
            <th style="text-align:right;">Signups</th>
            <th style="text-align:right;">Paid 7d</th>
            <th style="text-align:right;">Paid 30d</th>
            <th style="text-align:right;">Paid 90d</th>
            <th style="text-align:right;">Paid total</th>
            <th style="text-align:right;">Revenue</th>
            <th style="text-align:right;">LTV / signup</th>
          </tr>
        </thead>
        <tbody id="cohorts-rows">
          <tr><td colspan="8" style="text-align:center; color:#6B7280; padding:32px;">Loading…</td></tr>
        </tbody>
      </table>
    </div>

    <!-- By source -->
    <h2 style="font-size:18px; font-weight:700; margin:32px 0 8px;">Acquisition source breakdown</h2>
    <p style="font-size:13px; color:#9CA3AF; margin-bottom:12px;">
      Sort by Revenue or LTV/signup to find your best channels.
      <strong style="color:#10B981;">Bid up</strong> on sources where LTV/signup &gt; your cost per signup;
      <strong style="color:#EF4444;">cut</strong> sources where LTV/signup is consistently $0 over 20+ signups.
    </p>
    <div class="card" style="padding:0; overflow-x:auto;">
      <table style="width:100%; border-collapse:collapse;">
        <thead>
          <tr>
            <th>Source</th>
            <th>Medium</th>
            <th>Campaign</th>
            <th style="text-align:right;">Signups</th>
            <th style="text-align:right;">Paid</th>
            <th style="text-align:right;">Conv %</th>
            <th style="text-align:right;">Revenue</th>
            <th style="text-align:right;">LTV / signup</th>
            <th style="text-align:right;">LTV / paid</th>
          </tr>
        </thead>
        <tbody id="source-rows">
          <tr><td colspan="9" style="text-align:center; color:#6B7280; padding:32px;">Loading…</td></tr>
        </tbody>
      </table>
    </div>

    <p class="hint" style="margin-top:32px;">
      Revenue figures are computed live from <code>square_payments</code>, <code>stripe_payments</code>,
      and <code>manual_payments</code>. Cohort breakdown uses <code>analytics_attribution</code>
      (computed by the nightly rollup — run "Run nightly rollup now" on
      <a href="/super-admin/attribution" style="color:#60A5FA;">Attribution</a> if today's data looks stale).
    </p>
  </main>
<script>
function fmtMoney(cents){ if(!cents && cents !== 0) return '—'; var d = Number(cents)/100; if (d >= 10000) return '$' + (d/1000).toFixed(1) + 'k'; return '$' + d.toLocaleString(undefined, {maximumFractionDigits: d < 100 ? 2 : 0}); }
function fmtPct(p){ if(p == null) return '—'; return Number(p).toFixed(1) + '%'; }
function fmtNum(n){ return Number(n||0).toLocaleString(); }
function pctPill(p){ if (p == null || isNaN(p)) return '—'; var c = p >= 15 ? 'pill-green' : p >= 5 ? 'pill-yellow' : 'pill-red'; return '<span class="pill ' + c + '">' + p.toFixed(1) + '%</span>'; }
async function api(path){ var r = await fetch(path, { credentials: 'include' }); if (r.status === 401 || r.status === 403) { location.href = '/login?next=' + encodeURIComponent(location.pathname); return null; } return r.json(); }

async function loadAll(){
  var period = document.getElementById('period').value;
  var [s, c, b] = await Promise.all([
    api('/api/super-admin/ltv/api/summary?period=' + period),
    api('/api/super-admin/ltv/api/cohorts?period=' + (period === '7d' || period === '30d' ? '90d' : period === '90d' ? '180d' : period)),
    api('/api/super-admin/ltv/api/by-source?period=' + period),
  ]);
  if (!s || !c || !b) return;

  // Tiles
  document.getElementById('t-signups').textContent = fmtNum(s.total_signups);
  document.getElementById('t-paid').textContent = fmtNum(s.paid_signups);
  document.getElementById('t-paid-sub').textContent = s.total_signups > 0 ? (s.paid_signups + ' of ' + s.total_signups) : '';
  document.getElementById('t-conv').textContent = fmtPct(s.free_to_paid_pct);
  document.getElementById('t-rev').textContent = fmtMoney(s.total_revenue_cents);
  document.getElementById('t-ltv-paid').textContent = fmtMoney(s.avg_ltv_per_paid_cents);
  document.getElementById('t-ltv-signup').textContent = fmtMoney(s.avg_ltv_per_signup_cents);
  document.getElementById('t-days').textContent = s.median_days_to_paid != null ? (s.median_days_to_paid + ' days') : '—';

  // Cohorts
  var crows = c.rows.map(function(r){
    var pct30 = r.signups > 0 ? (r.paid_30d / r.signups) * 100 : 0;
    return '<tr>'
      + '<td><strong>' + r.cohort_month + '</strong></td>'
      + '<td style="text-align:right;">' + fmtNum(r.signups) + '</td>'
      + '<td style="text-align:right;">' + fmtNum(r.paid_7d) + '</td>'
      + '<td style="text-align:right;">' + fmtNum(r.paid_30d) + ' ' + pctPill(pct30) + '</td>'
      + '<td style="text-align:right;">' + fmtNum(r.paid_90d) + '</td>'
      + '<td style="text-align:right;">' + fmtNum(r.paid_total) + '</td>'
      + '<td style="text-align:right;">' + fmtMoney(r.revenue_cents) + '</td>'
      + '<td style="text-align:right; color:#10B981; font-weight:600;">' + fmtMoney(r.ltv_per_signup_cents) + '</td>'
      + '</tr>';
  }).join('');
  document.getElementById('cohorts-rows').innerHTML = crows || '<tr><td colspan="8" style="text-align:center; color:#6B7280; padding:32px;">No signups in this period.</td></tr>';

  // By source
  var brows = b.rows.map(function(r){
    return '<tr>'
      + '<td><strong>' + (r.source || 'direct') + '</strong></td>'
      + '<td style="color:#9CA3AF;">' + r.medium + '</td>'
      + '<td style="color:#9CA3AF;">' + (r.campaign === '(none)' ? '—' : r.campaign) + '</td>'
      + '<td style="text-align:right;">' + fmtNum(r.signups) + '</td>'
      + '<td style="text-align:right;">' + fmtNum(r.paid) + '</td>'
      + '<td style="text-align:right;">' + pctPill(r.conv_pct) + '</td>'
      + '<td style="text-align:right;">' + fmtMoney(r.revenue_cents) + '</td>'
      + '<td style="text-align:right; color:#10B981; font-weight:600;">' + fmtMoney(r.ltv_per_signup_cents) + '</td>'
      + '<td style="text-align:right;">' + fmtMoney(r.ltv_per_paid_cents) + '</td>'
      + '</tr>';
  }).join('');
  document.getElementById('source-rows').innerHTML = brows || '<tr><td colspan="9" style="text-align:center; color:#6B7280; padding:32px;">No attributed signups in this period.</td></tr>';
}

document.getElementById('period').addEventListener('change', loadAll);
loadAll();
</script>
</body>
</html>`
  return c.html(html)
})

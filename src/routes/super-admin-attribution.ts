// ============================================================
// Super Admin — Traffic & Content Attribution
// Mounted at /super-admin/attribution (HTML pages) and
// /api/super-admin/attribution/* (JSON for the dashboard widgets).
// All routes require superadmin role.
// ============================================================

import { Hono } from 'hono'
import { validateAdminSession, requireSuperadmin } from './auth'
import {
  getContentPerformance,
  getAttributionTotals,
  getTopAcquisitionSources,
  getJourneys,
  getFunnelCounts,
} from '../repositories/analytics-attribution'
import {
  rollupContentDaily,
  recomputeRecentAttribution,
  runNightlyAttributionRollup,
} from '../services/attribution'

type Bindings = {
  DB: D1Database
  [k: string]: any
}

export const superAdminAttribution = new Hono<{ Bindings: Bindings }>()

// All routes require superadmin
superAdminAttribution.use('*', async (c, next) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) {
    if (c.req.path.includes('/api/')) return c.json({ error: 'superadmin required' }, 403)
    return c.redirect('/login?next=' + encodeURIComponent(c.req.path), 302)
  }
  ;(c as any).set('admin', admin)
  await next()
})

function periodToDays(p: string | undefined): number {
  if (p === '24h') return 1
  if (p === '30d') return 30
  if (p === '90d') return 90
  if (p === '365d') return 365
  return 7
}

function sinceIso(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19)
}

function sinceDateYmd(days: number): string {
  const d = new Date(Date.now() - days * 86400000)
  return d.toISOString().slice(0, 10)
}

// ── JSON: overview ───────────────────────────────────────────
superAdminAttribution.get('/api/overview', async (c) => {
  const days = periodToDays(c.req.query('period') || '30d')
  const totals = await getAttributionTotals(c.env.DB, sinceIso(days))
  const firstTouch = await getTopAcquisitionSources(c.env.DB, sinceIso(days), 'first')
  const lastTouch = await getTopAcquisitionSources(c.env.DB, sinceIso(days), 'last')
  const funnel = await getFunnelCounts(c.env.DB, sinceIso(days))
  return c.json({ period_days: days, totals, first_touch: firstTouch, last_touch: lastTouch, funnel })
})

// ── JSON: content performance ────────────────────────────────
superAdminAttribution.get('/api/content', async (c) => {
  const days = periodToDays(c.req.query('period') || '30d')
  const pageType = c.req.query('page_type') || null
  const rows = await getContentPerformance(c.env.DB, {
    sinceDate: sinceDateYmd(days),
    pageType,
    limit: 500,
  })
  return c.json({ period_days: days, rows })
})

// ── JSON: journeys ───────────────────────────────────────────
superAdminAttribution.get('/api/journeys', async (c) => {
  const days = periodToDays(c.req.query('period') || '30d')
  const rows = await getJourneys(c.env.DB, sinceIso(days), 100)
  return c.json({ period_days: days, rows })
})

// ── JSON: trigger rollup manually ────────────────────────────
superAdminAttribution.post('/api/rollup/run', async (c) => {
  const date = c.req.query('date')
  if (date) {
    const r = await rollupContentDaily(c.env.DB, date)
    return c.json({ ok: true, ran: r })
  }
  const r = await runNightlyAttributionRollup(c.env.DB)
  return c.json({ ok: true, ran: r })
})

superAdminAttribution.post('/api/recompute', async (c) => {
  const hours = Number(c.req.query('hours') || 168)
  const r = await recomputeRecentAttribution(c.env.DB, hours)
  return c.json({ ok: true, ...r })
})

// ── CSV export of content performance ────────────────────────
superAdminAttribution.get('/api/content.csv', async (c) => {
  const days = periodToDays(c.req.query('period') || '30d')
  const pageType = c.req.query('page_type') || null
  const rows = await getContentPerformance(c.env.DB, {
    sinceDate: sinceDateYmd(days),
    pageType,
    limit: 500,
  })
  const header = [
    'path_template','page_type','content_slug',
    'pageviews','unique_visitors','sessions_started','bounces',
    'signups_first_touch','signups_any_touch',
    'orders_first_touch','orders_any_touch',
    'revenue_first_touch_cents','revenue_any_touch_cents',
    'avg_time_on_page','avg_scroll_depth'
  ]
  const csvLines = [header.join(',')]
  for (const r of rows as any[]) {
    csvLines.push(header.map(h => {
      const v = r[h]
      if (v == null) return ''
      const s = String(v).replace(/"/g, '""')
      return /[",\n]/.test(s) ? `"${s}"` : s
    }).join(','))
  }
  return new Response(csvLines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="content-attribution-${days}d.csv"`,
    },
  })
})

// ── HTML dashboard shell ─────────────────────────────────────
function shell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — Roof Manager Super Admin</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  body { background:#0A0A0A; color:#E5E7EB; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; }
  .card { background:#111827; border:1px solid #1F2937; border-radius:12px; }
  .pill { display:inline-block; padding:2px 10px; border-radius:9999px; font-size:11px; font-weight:600; }
  .pill-blog { background:#1E3A8A; color:#BFDBFE; }
  .pill-howto { background:#064E3B; color:#A7F3D0; }
  .pill-marketing { background:#7C2D12; color:#FED7AA; }
  .pill-app { background:#3F3F46; color:#E4E4E7; }
  .pill-other { background:#374151; color:#D1D5DB; }
  th { font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#9CA3AF; padding:10px 12px; text-align:left; border-bottom:1px solid #1F2937; cursor:pointer; }
  td { padding:10px 12px; border-bottom:1px solid #1F2937; font-size:14px; vertical-align:top; }
  tr:hover td { background:#1F2937; }
  a.tab { padding:8px 16px; border-radius:8px; color:#9CA3AF; text-decoration:none; font-weight:500; }
  a.tab.active { background:#1F2937; color:#FFF; }
  a.tab:hover { color:#FFF; }
  .num { font-variant-numeric:tabular-nums; }
  select, input { background:#0F172A; color:#E5E7EB; border:1px solid #1F2937; border-radius:8px; padding:6px 10px; }
  button { cursor:pointer; }
  .btn { background:#10B981; color:#0A0A0A; padding:8px 14px; border-radius:8px; font-weight:600; }
  .btn-secondary { background:#1F2937; color:#E5E7EB; padding:8px 14px; border-radius:8px; }
</style>
</head>
<body>
  <header style="padding:16px 24px; border-bottom:1px solid #1F2937; display:flex; align-items:center; gap:24px;">
    <a href="/super-admin" style="color:#FBBF24; font-weight:700; text-decoration:none;">👑 Super Admin</a>
    <span style="color:#6B7280;">/</span>
    <span style="color:#FFF; font-weight:600;">Attribution</span>
    <nav style="margin-left:auto; display:flex; gap:4px;">
      <a class="tab" href="/super-admin/attribution">Overview</a>
      <a class="tab" href="/super-admin/attribution/content">Content</a>
      <a class="tab" href="/super-admin/attribution/journeys">Journeys</a>
      <a class="tab" href="/super-admin/attribution/funnels">Funnels</a>
    </nav>
  </header>
  <main style="max-width:1400px; margin:0 auto; padding:24px;">${body}</main>
  <script>
    // shared helpers
    window.fmtMoney = function(cents){ if(!cents) return '$0'; return '$' + (cents/100).toLocaleString(undefined,{maximumFractionDigits:0}); };
    window.fmtPct = function(num,den){ if(!den) return '—'; return ((num/den)*100).toFixed(1) + '%'; };
    window.fmtNum = function(n){ return Number(n||0).toLocaleString(); };
    window.pillFor = function(t){
      var c = (t||'other').toLowerCase();
      var cls = 'pill-' + (['blog','howto','marketing','app'].indexOf(c)>=0 ? c : 'other');
      return '<span class="pill ' + cls + '">' + (t||'other') + '</span>';
    };
    // highlight active tab
    document.querySelectorAll('a.tab').forEach(function(a){
      if (a.getAttribute('href') === location.pathname) a.classList.add('active');
    });
    // redirect to login on 403
    window.api = async function(url){
      var r = await fetch(url, { credentials:'include' });
      if (r.status === 401 || r.status === 403) { location.href='/login?next='+encodeURIComponent(location.pathname); return null; }
      return r.json();
    };
  </script>
</body>
</html>`
}

// Overview page
superAdminAttribution.get('/', async (c) => {
  const html = shell('Attribution Overview', `
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:24px;">
      <h1 style="font-size:24px; font-weight:700;">Where customers come from</h1>
      <select id="period" style="margin-left:auto;">
        <option value="7d">Last 7 days</option>
        <option value="30d" selected>Last 30 days</option>
        <option value="90d">Last 90 days</option>
        <option value="365d">Last year</option>
      </select>
      <button class="btn-secondary" onclick="runRollup()">Run nightly rollup now</button>
    </div>

    <div id="kpis" style="display:grid; grid-template-columns:repeat(5,1fr); gap:16px; margin-bottom:24px;"></div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:24px;">
      <div class="card" style="padding:20px;">
        <h3 style="font-size:14px; color:#9CA3AF; margin-bottom:12px;">Funnel</h3>
        <div id="funnel"></div>
      </div>
      <div class="card" style="padding:20px;">
        <h3 style="font-size:14px; color:#9CA3AF; margin-bottom:12px;">First-touch sources (acquisition)</h3>
        <div id="firstSources"></div>
      </div>
    </div>

    <div class="card" style="padding:20px;">
      <h3 style="font-size:14px; color:#9CA3AF; margin-bottom:12px;">Last-touch sources (conversion)</h3>
      <div id="lastSources"></div>
    </div>

    <script>
      async function load() {
        var period = document.getElementById('period').value;
        var data = await window.api('/api/super-admin/attribution/api/overview?period=' + period);
        if (!data) return;
        var t = data.totals || {};
        document.getElementById('kpis').innerHTML = [
          kpi('Converted customers', fmtNum(t.converted_customers||0), '#60A5FA'),
          kpi('Paying customers', fmtNum(t.paying_customers||0), '#34D399'),
          kpi('Revenue attributed', fmtMoney(t.revenue_cents||0), '#FBBF24'),
          kpi('Avg days to convert', (Math.round((t.avg_days_to_convert||0)*10)/10).toString(), '#A78BFA'),
          kpi('Avg touches', (Math.round((t.avg_touches||0)*10)/10).toString(), '#F472B6')
        ].join('');
        var f = data.funnel || {};
        document.getElementById('funnel').innerHTML = funnelHtml(f);
        document.getElementById('firstSources').innerHTML = sourcesTable(data.first_touch || []);
        document.getElementById('lastSources').innerHTML = sourcesTable(data.last_touch || []);
      }
      function kpi(label, value, color) {
        return '<div class="card" style="padding:16px;">' +
          '<div style="font-size:12px; color:#9CA3AF; margin-bottom:6px;">' + label + '</div>' +
          '<div class="num" style="font-size:28px; font-weight:700; color:' + color + ';">' + value + '</div></div>';
      }
      function funnelHtml(f) {
        var steps = [
          ['Sessions', f.sessions||0],
          ['Reached pricing', f.reached_pricing||0],
          ['Reached order/preview', f.reached_order||0],
          ['Signed up', f.signups||0],
          ['Created order', f.orders||0],
          ['Paid', f.paid_orders||0],
        ];
        var top = steps[0][1] || 1;
        return '<table style="width:100%;">' + steps.map(function(s){
          var pct = Math.round((s[1]/top)*1000)/10;
          return '<tr><td style="border:none;width:60%;">' + s[0] + '</td>' +
                 '<td style="border:none;text-align:right;" class="num">' + fmtNum(s[1]) + ' (' + pct + '%)</td></tr>';
        }).join('') + '</table>';
      }
      function sourcesTable(rows) {
        if (!rows || rows.length === 0) return '<div style="color:#6B7280;">No data yet — rollup may not have run.</div>';
        return '<table style="width:100%;"><thead><tr>' +
          '<th>Source</th><th class="num">Customers</th><th class="num">Paying</th><th class="num">Revenue</th></tr></thead><tbody>' +
          rows.map(function(r){
            return '<tr><td>' + (r.source||'(direct)') + '</td>' +
              '<td class="num" style="text-align:right;">' + fmtNum(r.customers) + '</td>' +
              '<td class="num" style="text-align:right;">' + fmtNum(r.paying) + '</td>' +
              '<td class="num" style="text-align:right;">' + fmtMoney(r.revenue_cents) + '</td></tr>';
          }).join('') + '</tbody></table>';
      }
      async function runRollup() {
        var btn = event.target; btn.disabled = true; btn.textContent = 'Running…';
        try {
          var r = await fetch('/api/super-admin/attribution/api/rollup/run', { method:'POST', credentials:'include' });
          var d = await r.json();
          alert('Rollup complete: ' + JSON.stringify(d.ran));
          load();
        } catch(e) { alert('Failed: ' + e.message); }
        btn.disabled = false; btn.textContent = 'Run nightly rollup now';
      }
      document.getElementById('period').addEventListener('change', load);
      load();
    </script>
  `)
  return c.html(html)
})

// Content performance page
superAdminAttribution.get('/content', async (c) => {
  const html = shell('Content Performance', `
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:24px;">
      <h1 style="font-size:24px; font-weight:700;">Content performance</h1>
      <select id="period">
        <option value="7d">Last 7 days</option>
        <option value="30d" selected>Last 30 days</option>
        <option value="90d">Last 90 days</option>
        <option value="365d">Last year</option>
      </select>
      <select id="pageType">
        <option value="">All types</option>
        <option value="blog">Blog</option>
        <option value="howto">How-to</option>
        <option value="marketing">Marketing</option>
        <option value="app">App</option>
      </select>
      <a id="csv" class="btn-secondary" href="#" style="text-decoration:none; margin-left:auto;">Download CSV</a>
    </div>
    <div class="card" style="padding:0; overflow:auto;">
      <table style="width:100%;">
        <thead><tr id="theadRow">
          <th data-k="path_template">Path</th>
          <th data-k="page_type">Type</th>
          <th data-k="pageviews" class="num">Views</th>
          <th data-k="unique_visitors" class="num">Visitors</th>
          <th data-k="bounce_rate" class="num">Bounce%</th>
          <th data-k="avg_time_on_page" class="num">Avg time</th>
          <th data-k="signups_first_touch" class="num">Signups (1st)</th>
          <th data-k="signups_any_touch" class="num">Signups (any)</th>
          <th data-k="orders_any_touch" class="num">Orders</th>
          <th data-k="revenue_first_touch_cents" class="num">Rev (1st)</th>
          <th data-k="revenue_any_touch_cents" class="num">Rev (any)</th>
        </tr></thead>
        <tbody id="rows"><tr><td colspan="11" style="text-align:center; color:#6B7280; padding:32px;">Loading…</td></tr></tbody>
      </table>
    </div>
    <p style="color:#6B7280; font-size:12px; margin-top:12px;">
      <strong>1st</strong> = first-touch attribution (this page brought them in initially).
      <strong>any</strong> = any-touch (this page appeared anywhere in their journey).
    </p>
    <script>
      var state = { rows:[], sortKey:'revenue_any_touch_cents', sortDir:-1 };
      async function load() {
        var period = document.getElementById('period').value;
        var pt = document.getElementById('pageType').value;
        document.getElementById('csv').href = '/api/super-admin/attribution/api/content.csv?period=' + period + (pt?'&page_type='+pt:'');
        var data = await window.api('/api/super-admin/attribution/api/content?period=' + period + (pt?'&page_type='+pt:''));
        if (!data) return;
        state.rows = (data.rows || []).map(function(r){
          r.bounce_rate = r.sessions_started > 0 ? (r.bounces / r.sessions_started) * 100 : 0;
          return r;
        });
        render();
      }
      function render() {
        var rows = state.rows.slice().sort(function(a,b){
          var k = state.sortKey;
          var av = a[k], bv = b[k];
          if (typeof av === 'string') return state.sortDir * (av||'').localeCompare(bv||'');
          return state.sortDir * ((av||0) - (bv||0));
        });
        var html = rows.map(function(r){
          return '<tr>' +
            '<td><a href="' + r.path_template.replace(/:slug/g, r.content_slug || ':slug') + '" style="color:#60A5FA;" target="_blank">' + r.path_template + '</a>' +
              (r.content_slug ? '<div style="font-size:11px; color:#6B7280;">' + r.content_slug + '</div>' : '') + '</td>' +
            '<td>' + pillFor(r.page_type) + '</td>' +
            '<td class="num" style="text-align:right;">' + fmtNum(r.pageviews) + '</td>' +
            '<td class="num" style="text-align:right;">' + fmtNum(r.unique_visitors) + '</td>' +
            '<td class="num" style="text-align:right;">' + (r.sessions_started ? r.bounce_rate.toFixed(0)+'%' : '—') + '</td>' +
            '<td class="num" style="text-align:right;">' + (r.avg_time_on_page ? Math.round(r.avg_time_on_page)+'s' : '—') + '</td>' +
            '<td class="num" style="text-align:right; color:' + (r.signups_first_touch>0?'#34D399':'#6B7280') + ';">' + fmtNum(r.signups_first_touch) + '</td>' +
            '<td class="num" style="text-align:right;">' + fmtNum(r.signups_any_touch) + '</td>' +
            '<td class="num" style="text-align:right;">' + fmtNum(r.orders_any_touch) + '</td>' +
            '<td class="num" style="text-align:right; color:' + (r.revenue_first_touch_cents>0?'#FBBF24':'#6B7280') + ';">' + fmtMoney(r.revenue_first_touch_cents) + '</td>' +
            '<td class="num" style="text-align:right; color:' + (r.revenue_any_touch_cents>0?'#FBBF24':'#6B7280') + ';">' + fmtMoney(r.revenue_any_touch_cents) + '</td>' +
            '</tr>';
        }).join('');
        document.getElementById('rows').innerHTML = html || '<tr><td colspan="11" style="text-align:center; color:#6B7280; padding:32px;">No content data yet — run the nightly rollup or wait until tomorrow.</td></tr>';
      }
      document.getElementById('theadRow').addEventListener('click', function(e){
        var th = e.target.closest('th'); if (!th) return;
        var k = th.getAttribute('data-k'); if (!k) return;
        if (state.sortKey === k) state.sortDir *= -1; else { state.sortKey = k; state.sortDir = -1; }
        render();
      });
      document.getElementById('period').addEventListener('change', load);
      document.getElementById('pageType').addEventListener('change', load);
      load();
    </script>
  `)
  return c.html(html)
})

// Journeys page
superAdminAttribution.get('/journeys', async (c) => {
  const html = shell('Customer Journeys', `
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:24px;">
      <h1 style="font-size:24px; font-weight:700;">Customer journeys</h1>
      <select id="period" style="margin-left:auto;">
        <option value="7d">Last 7 days</option>
        <option value="30d" selected>Last 30 days</option>
        <option value="90d">Last 90 days</option>
        <option value="365d">Last year</option>
      </select>
    </div>
    <div class="card" style="padding:0; overflow:auto;">
      <table style="width:100%;">
        <thead><tr>
          <th>Customer</th><th>First touch</th><th>Last touch</th>
          <th class="num">Touches</th><th class="num">Sessions</th>
          <th class="num">Days</th><th class="num">Revenue</th>
          <th>Journey</th>
        </tr></thead>
        <tbody id="rows"><tr><td colspan="8" style="text-align:center; color:#6B7280; padding:32px;">Loading…</td></tr></tbody>
      </table>
    </div>
    <script>
      async function load() {
        var period = document.getElementById('period').value;
        var data = await window.api('/api/super-admin/attribution/api/journeys?period=' + period);
        if (!data) return;
        var rows = data.rows || [];
        var html = rows.map(function(r){
          var journey = []; try { journey = JSON.parse(r.journey_path_templates||'[]'); } catch(e){}
          var jHtml = journey.map(function(t){
            return '<span style="display:inline-block; background:#1F2937; padding:2px 8px; border-radius:6px; margin:2px; font-size:11px;">' + t + '</span>';
          }).join(' → ');
          return '<tr>' +
            '<td>#' + r.customer_id + '<div style="font-size:11px; color:#6B7280;">' + (r.converted_at||'') + '</div></td>' +
            '<td><div style="font-size:13px;">' + (r.first_touch_path_template||'(direct)') + '</div><div style="font-size:11px; color:#9CA3AF;">' + (r.first_touch_utm_source||'') + '</div></td>' +
            '<td><div style="font-size:13px;">' + (r.last_touch_path_template||'(direct)') + '</div><div style="font-size:11px; color:#9CA3AF;">' + (r.last_touch_utm_source||'') + '</div></td>' +
            '<td class="num" style="text-align:right;">' + fmtNum(r.touch_count) + '</td>' +
            '<td class="num" style="text-align:right;">' + fmtNum(r.session_count) + '</td>' +
            '<td class="num" style="text-align:right;">' + (r.days_to_convert!=null?r.days_to_convert:'—') + '</td>' +
            '<td class="num" style="text-align:right; color:' + (r.revenue_cents>0?'#FBBF24':'#6B7280') + ';">' + fmtMoney(r.revenue_cents) + '</td>' +
            '<td>' + (jHtml || '<span style="color:#6B7280;">no traffic linked</span>') + '</td>' +
            '</tr>';
        }).join('');
        document.getElementById('rows').innerHTML = html || '<tr><td colspan="8" style="text-align:center; color:#6B7280; padding:32px;">No converted customers in this window yet.</td></tr>';
      }
      document.getElementById('period').addEventListener('change', load);
      load();
    </script>
  `)
  return c.html(html)
})

// Funnels page (re-uses the funnel widget from overview but full-screen)
superAdminAttribution.get('/funnels', async (c) => {
  const html = shell('Funnels', `
    <div style="display:flex; align-items:center; gap:12px; margin-bottom:24px;">
      <h1 style="font-size:24px; font-weight:700;">Conversion funnel</h1>
      <select id="period" style="margin-left:auto;">
        <option value="7d">Last 7 days</option>
        <option value="30d" selected>Last 30 days</option>
        <option value="90d">Last 90 days</option>
      </select>
    </div>
    <div class="card" style="padding:24px;"><div id="funnel"></div></div>
    <script>
      async function load() {
        var period = document.getElementById('period').value;
        var data = await window.api('/api/super-admin/attribution/api/overview?period=' + period);
        if (!data) return;
        var f = data.funnel || {};
        var steps = [
          ['Sessions', f.sessions||0, '#60A5FA'],
          ['Reached pricing', f.reached_pricing||0, '#A78BFA'],
          ['Reached order/preview', f.reached_order||0, '#F472B6'],
          ['Signed up', f.signups||0, '#34D399'],
          ['Created order', f.orders||0, '#FBBF24'],
          ['Paid', f.paid_orders||0, '#10B981'],
        ];
        var top = steps[0][1] || 1;
        var prev = top;
        var html = steps.map(function(s,i){
          var pctTotal = Math.round((s[1]/top)*1000)/10;
          var pctPrev = i===0 ? 100 : (prev>0 ? Math.round((s[1]/prev)*1000)/10 : 0);
          var width = Math.max(8, (s[1]/top)*100);
          var html = '<div style="margin-bottom:14px;">' +
            '<div style="display:flex; justify-content:space-between; margin-bottom:4px;"><span style="color:#E5E7EB; font-weight:600;">' + s[0] + '</span>' +
            '<span class="num" style="color:#9CA3AF;">' + fmtNum(s[1]) + ' · ' + pctTotal + '% of top · ' + pctPrev + '% of prev</span></div>' +
            '<div style="background:#1F2937; height:24px; border-radius:6px; overflow:hidden;">' +
              '<div style="width:' + width + '%; background:' + s[2] + '; height:100%;"></div>' +
            '</div></div>';
          prev = s[1];
          return html;
        }).join('');
        document.getElementById('funnel').innerHTML = html;
      }
      document.getElementById('period').addEventListener('change', load);
      load();
    </script>
  `)
  return c.html(html)
})

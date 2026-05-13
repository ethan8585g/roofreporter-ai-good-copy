// ============================================================
// Super Admin — Customer Module Analytics
// Mounted at /super-admin/module-analytics (HTML page) and
// /api/super-admin/module-analytics/* (JSON). Superadmin only.
//
// Surfaces per-customer module-open counts (daily + lifetime) on top of
// the existing user activity pipeline (active_visits + user_module_visits
// + user_activity_daily — wired in migration 0194 + src/services/activity-tracker.ts).
//
// "Owner rollup": team members are aggregated under their owner customer
// row so the table shows one row per paying account. The owner ↔ member
// relationship lives in the `team_members` table (owner_id ↔
// member_customer_id) — there is no `customers.team_owner_id` column, so
// every owner-rollup query resolves it via OWNER_ID_EXPR below.
// ============================================================

import { Hono } from 'hono'
import { validateAdminSession, requireSuperadmin } from './auth'

type Bindings = {
  DB: D1Database
  [k: string]: any
}

// Resolves a customer.id (aliased `c`) to their account-owner id. Team
// members roll up to the team owner; standalone customers map to themselves.
const OWNER_ID_EXPR = `COALESCE(
  (SELECT tm.owner_id FROM team_members tm
   WHERE tm.member_customer_id = c.id AND tm.status = 'active' LIMIT 1),
  c.id
)`

export const superAdminModuleAnalytics = new Hono<{ Bindings: Bindings }>()

// All routes require superadmin
superAdminModuleAnalytics.use('*', async (c, next) => {
  const admin = await validateAdminSession(
    c.env.DB,
    c.req.header('Authorization'),
    c.req.header('Cookie'),
  )
  if (!admin || !requireSuperadmin(admin)) {
    if (c.req.path.includes('/api/')) return c.json({ error: 'superadmin required' }, 403)
    return c.redirect('/login?next=' + encodeURIComponent(c.req.path), 302)
  }
  ;(c as any).set('admin', admin)
  await next()
})

// ──────────────────────────────────────────────────────────────
// JSON: overall summary — KPI strip + module leaderboard
// ──────────────────────────────────────────────────────────────
superAdminModuleAnalytics.get('/api/summary', async (c) => {
  const DB = c.env.DB

  // Active right now (last 5 min)
  const activeNow = await DB.prepare(
    `SELECT COUNT(DISTINCT user_id) AS n
     FROM active_visits
     WHERE user_type = 'customer'
       AND last_seen_at > datetime('now','-5 minutes')`
  ).first<{ n: number }>()

  // Today's unique customers (rolled-up owner_id)
  const todayUnique = await DB.prepare(
    `SELECT COUNT(DISTINCT ${OWNER_ID_EXPR}) AS n
     FROM user_module_visits umv
     JOIN customers c ON c.id = umv.user_id
     WHERE umv.user_type = 'customer'
       AND date(umv.started_at) = date('now')`
  ).first<{ n: number }>()

  // Lifetime unique customers (owner rollup)
  const lifetimeUnique = await DB.prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT DISTINCT ${OWNER_ID_EXPR} AS owner_id
       FROM user_activity_daily uad
       JOIN customers c ON c.id = uad.user_id
       WHERE uad.user_type = 'customer'
       UNION
       SELECT DISTINCT ${OWNER_ID_EXPR} AS owner_id
       FROM user_module_visits umv
       JOIN customers c ON c.id = umv.user_id
       WHERE umv.user_type = 'customer'
     )`
  ).first<{ n: number }>()

  // Module leaderboard — today. Combines closed visits (user_module_visits)
  // with still-open ones (active_visits) so the dashboard isn't lagging the
  // 5-minute stale-close window.
  const todayModules = await DB.prepare(
    `WITH today AS (
       SELECT module, user_id, duration_seconds AS total_seconds
       FROM user_module_visits
       WHERE user_type = 'customer' AND date(started_at) = date('now')
       UNION ALL
       SELECT module, user_id,
              CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER) AS total_seconds
       FROM active_visits
       WHERE user_type = 'customer' AND date(started_at) = date('now')
     )
     SELECT today.module,
            COUNT(*) AS visits,
            COUNT(DISTINCT ${OWNER_ID_EXPR}) AS unique_customers,
            COALESCE(SUM(today.total_seconds), 0) AS total_seconds
     FROM today
     JOIN customers c ON c.id = today.user_id
     GROUP BY today.module
     ORDER BY visits DESC`
  ).all<any>()

  // Module leaderboard — lifetime. Rolled daily + today's closed + today's open.
  const lifetimeModules = await DB.prepare(
    `WITH combined AS (
       SELECT module, user_id, visit_count AS visits, total_seconds
       FROM user_activity_daily
       WHERE user_type = 'customer'
       UNION ALL
       SELECT module, user_id, 1 AS visits, duration_seconds AS total_seconds
       FROM user_module_visits
       WHERE user_type = 'customer' AND date(started_at) = date('now')
       UNION ALL
       SELECT module, user_id, 1 AS visits,
              CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER) AS total_seconds
       FROM active_visits
       WHERE user_type = 'customer' AND date(started_at) = date('now')
     )
     SELECT combined.module,
            SUM(combined.visits) AS visits,
            COUNT(DISTINCT ${OWNER_ID_EXPR}) AS unique_customers,
            SUM(combined.total_seconds) AS total_seconds
     FROM combined
     JOIN customers c ON c.id = combined.user_id
     GROUP BY combined.module
     ORDER BY visits DESC`
  ).all<any>()

  return c.json({
    kpis: {
      active_now: Number(activeNow?.n || 0),
      today_unique_customers: Number(todayUnique?.n || 0),
      lifetime_unique_customers: Number(lifetimeUnique?.n || 0),
      top_module_today: (todayModules?.results || [])[0]?.module || null,
      top_module_lifetime: (lifetimeModules?.results || [])[0]?.module || null,
    },
    today_modules: todayModules?.results || [],
    lifetime_modules: lifetimeModules?.results || [],
  })
})

// ──────────────────────────────────────────────────────────────
// JSON: per-customer table (rolled up to owner)
// Query: ?range=today|7d|lifetime  ?sort=visits|name  ?limit=200
// ──────────────────────────────────────────────────────────────
superAdminModuleAnalytics.get('/api/customers', async (c) => {
  const DB = c.env.DB
  const range = (c.req.query('range') || 'today').toLowerCase()
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 200), 1), 1000)

  // Today's open + closed visits — used by every range. Open visits are
  // currently-active users not yet flushed to user_module_visits.
  const todayBranch = `
    SELECT user_id, module, 1 AS visits,
           duration_seconds AS total_seconds, request_count
    FROM user_module_visits
    WHERE user_type = 'customer' AND date(started_at) = date('now')
    UNION ALL
    SELECT user_id, module, 1 AS visits,
           CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER) AS total_seconds,
           request_count
    FROM active_visits
    WHERE user_type = 'customer' AND date(started_at) = date('now')
  `

  let baseCte = ''
  if (range === 'today') {
    baseCte = `WITH base AS (${todayBranch})`
  } else if (range === '7d') {
    baseCte = `
      WITH base AS (
        SELECT user_id, module, visit_count AS visits,
               total_seconds, request_count
        FROM user_activity_daily
        WHERE user_type = 'customer'
          AND day >= date('now','-6 days')
        UNION ALL
        ${todayBranch}
      )
    `
  } else {
    // lifetime
    baseCte = `
      WITH base AS (
        SELECT user_id, module, visit_count AS visits,
               total_seconds, request_count
        FROM user_activity_daily
        WHERE user_type = 'customer'
        UNION ALL
        ${todayBranch}
      )
    `
  }

  // Aggregate to (owner_id, module) first, then pivot up to one row per owner.
  const sql = `
    ${baseCte},
    by_owner_module AS (
      SELECT ${OWNER_ID_EXPR} AS owner_id,
             base.module,
             SUM(base.visits) AS visits,
             SUM(base.total_seconds) AS total_seconds
      FROM base
      JOIN customers c ON c.id = base.user_id
      GROUP BY owner_id, base.module
    ),
    per_owner AS (
      SELECT owner_id,
             SUM(visits) AS total_visits,
             SUM(total_seconds) AS total_seconds,
             COUNT(DISTINCT module) AS modules_touched
      FROM by_owner_module
      GROUP BY owner_id
    )
    SELECT po.owner_id,
           o.email,
           o.name,
           o.company_name,
           po.total_visits,
           po.total_seconds,
           po.modules_touched,
           (SELECT json_group_object(module, visits)
              FROM by_owner_module bom
              WHERE bom.owner_id = po.owner_id) AS module_breakdown_json
    FROM per_owner po
    LEFT JOIN customers o ON o.id = po.owner_id
    ORDER BY po.total_visits DESC
    LIMIT ?
  `

  const rs = await DB.prepare(sql).bind(limit).all<any>()
  const rows = (rs?.results || []).map((r: any) => {
    let breakdown: Record<string, number> = {}
    try { breakdown = JSON.parse(r.module_breakdown_json || '{}') } catch {}
    return {
      owner_id: r.owner_id,
      email: r.email || '(deleted)',
      name: r.name || '',
      company_name: r.company_name || '',
      total_visits: Number(r.total_visits || 0),
      total_seconds: Number(r.total_seconds || 0),
      modules_touched: Number(r.modules_touched || 0),
      module_breakdown: breakdown,
    }
  })

  return c.json({ range, count: rows.length, rows })
})

// ──────────────────────────────────────────────────────────────
// JSON: single-customer drilldown (owner + their team members)
// Shows: per-module daily + lifetime, plus last-30-days timeline.
// ──────────────────────────────────────────────────────────────
superAdminModuleAnalytics.get('/api/customer/:id', async (c) => {
  const DB = c.env.DB
  const ownerId = Number(c.req.param('id'))
  if (!Number.isFinite(ownerId) || ownerId <= 0) {
    return c.json({ error: 'invalid customer id' }, 400)
  }

  // Owner + team members. Membership resolved via the team_members table
  // (no team_owner_id column on customers).
  const owner = await DB.prepare(
    `SELECT c.id, c.email, c.name, c.company_name,
            (SELECT tm.owner_id FROM team_members tm
             WHERE tm.member_customer_id = c.id AND tm.status = 'active'
             LIMIT 1) AS team_owner_id
     FROM customers c WHERE c.id = ?`
  ).bind(ownerId).first<any>()
  if (!owner) return c.json({ error: 'customer not found' }, 404)

  const members = await DB.prepare(
    `SELECT id, email, name FROM customers
     WHERE id = ?
        OR id IN (SELECT member_customer_id FROM team_members
                  WHERE owner_id = ? AND status = 'active'
                    AND member_customer_id IS NOT NULL)
     ORDER BY (id = ?) DESC, email`
  ).bind(ownerId, ownerId, ownerId).all<any>()
  const memberIds: number[] = (members?.results || []).map((m: any) => Number(m.id))

  if (memberIds.length === 0) {
    return c.json({ owner, members: [], modules: {}, timeline: [], totals: {} })
  }

  const placeholders = memberIds.map(() => '?').join(',')

  // Lifetime per-module: daily rollup + today's closed + today's open
  const lifetime = await DB.prepare(
    `WITH combined AS (
       SELECT module, visit_count AS visits, total_seconds
       FROM user_activity_daily
       WHERE user_type = 'customer' AND user_id IN (${placeholders})
       UNION ALL
       SELECT module, 1 AS visits, duration_seconds AS total_seconds
       FROM user_module_visits
       WHERE user_type = 'customer' AND user_id IN (${placeholders})
         AND date(started_at) = date('now')
       UNION ALL
       SELECT module, 1 AS visits,
              CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER) AS total_seconds
       FROM active_visits
       WHERE user_type = 'customer' AND user_id IN (${placeholders})
         AND date(started_at) = date('now')
     )
     SELECT module, SUM(visits) AS visits, SUM(total_seconds) AS total_seconds
     FROM combined GROUP BY module ORDER BY visits DESC`
  ).bind(...memberIds, ...memberIds, ...memberIds).all<any>()

  // Today per-module: closed + open
  const today = await DB.prepare(
    `WITH t AS (
       SELECT module, duration_seconds AS total_seconds
       FROM user_module_visits
       WHERE user_type = 'customer' AND user_id IN (${placeholders})
         AND date(started_at) = date('now')
       UNION ALL
       SELECT module,
              CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER) AS total_seconds
       FROM active_visits
       WHERE user_type = 'customer' AND user_id IN (${placeholders})
         AND date(started_at) = date('now')
     )
     SELECT module, COUNT(*) AS visits, COALESCE(SUM(total_seconds),0) AS total_seconds
     FROM t GROUP BY module ORDER BY visits DESC`
  ).bind(...memberIds, ...memberIds).all<any>()

  // 30-day timeline: rollups + today's closed + today's open
  const timeline = await DB.prepare(
    `WITH combined AS (
       SELECT day, module, visit_count AS visits
       FROM user_activity_daily
       WHERE user_type = 'customer' AND user_id IN (${placeholders})
         AND day >= date('now','-29 days')
       UNION ALL
       SELECT date('now') AS day, module, 1 AS visits
       FROM user_module_visits
       WHERE user_type = 'customer' AND user_id IN (${placeholders})
         AND date(started_at) = date('now')
       UNION ALL
       SELECT date('now') AS day, module, 1 AS visits
       FROM active_visits
       WHERE user_type = 'customer' AND user_id IN (${placeholders})
         AND date(started_at) = date('now')
     )
     SELECT day, module, SUM(visits) AS visits
     FROM combined GROUP BY day, module
     ORDER BY day DESC, visits DESC`
  ).bind(...memberIds, ...memberIds, ...memberIds).all<any>()

  // Per-member breakdown so we can show which seat is doing what
  const perMember = await DB.prepare(
    `WITH combined AS (
       SELECT user_id, module, visit_count AS visits, total_seconds
       FROM user_activity_daily
       WHERE user_type = 'customer' AND user_id IN (${placeholders})
       UNION ALL
       SELECT user_id, module, 1 AS visits, duration_seconds AS total_seconds
       FROM user_module_visits
       WHERE user_type = 'customer' AND user_id IN (${placeholders})
         AND date(started_at) = date('now')
       UNION ALL
       SELECT user_id, module, 1 AS visits,
              CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER) AS total_seconds
       FROM active_visits
       WHERE user_type = 'customer' AND user_id IN (${placeholders})
         AND date(started_at) = date('now')
     )
     SELECT user_id, module,
            SUM(visits) AS visits,
            SUM(total_seconds) AS total_seconds
     FROM combined
     GROUP BY user_id, module
     ORDER BY user_id, visits DESC`
  ).bind(...memberIds, ...memberIds, ...memberIds).all<any>()

  return c.json({
    owner,
    members: members?.results || [],
    lifetime_modules: lifetime?.results || [],
    today_modules: today?.results || [],
    timeline: timeline?.results || [],
    per_member: perMember?.results || [],
  })
})

// ──────────────────────────────────────────────────────────────
// HTML page
// ──────────────────────────────────────────────────────────────
superAdminModuleAnalytics.get('/', (c) => {
  return c.html(renderPage())
})

function renderPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Module Analytics · Super Admin</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<style>
  :root {
    --bg: #0B0F1A;
    --bg-card: #111827;
    --bg-card-hi: #1F2937;
    --bg-input: #0F172A;
    --border: #1F2937;
    --border-hi: #374151;
    --text: #E5E7EB;
    --text-dim: #9CA3AF;
    --text-mute: #6B7280;
    --accent: #00FF88;
    --accent-hi: #10B981;
    --pass: #10B981;
    --pass-bg: #064E3B;
    --pass-fg: #A7F3D0;
    --warn: #FBBF24;
    --warn-bg: #78350F;
    --warn-fg: #FDE68A;
    --info: #60A5FA;
    --info-bg: #1E3A8A;
    --info-fg: #BFDBFE;
  }
  * { box-sizing: border-box; }
  body { background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; margin:0; }
  a { color:var(--info); text-decoration:none; }
  a:hover { text-decoration:underline; }
  header.bar { padding:14px 24px; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:24px; background:var(--bg-card); position:sticky; top:0; z-index:10; }
  header.bar h1 { font-size:15px; font-weight:600; margin:0; color:var(--text); }
  header.bar .breadcrumb { color:var(--accent); font-weight:700; }
  main { max-width:1500px; margin:0 auto; padding:20px 24px 60px; }
  .card { background:var(--bg-card); border:1px solid var(--border); border-radius:12px; padding:18px; }
  .num { font-variant-numeric:tabular-nums; }

  .hero { display:grid; grid-template-columns:repeat(5,1fr); gap:12px; margin-bottom:20px; }
  .kpi { background:var(--bg-card); border:1px solid var(--border); border-radius:10px; padding:14px 16px; }
  .kpi .label { font-size:10px; text-transform:uppercase; letter-spacing:0.07em; color:var(--text-dim); margin-bottom:6px; }
  .kpi .v { font-size:28px; font-weight:700; line-height:1; color:var(--text); }
  .kpi.accent .v { color:var(--accent); }
  .kpi.info .v { color:var(--info); }
  .kpi.warn .v { color:var(--warn); }
  .kpi .sub { font-size:10px; color:var(--text-mute); margin-top:4px; text-transform:uppercase; letter-spacing:0.05em; }

  section { margin-bottom:28px; }
  section > h2 { font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-dim); margin:0 0 10px; display:flex; align-items:center; gap:10px; }
  section > h2 .count { background:var(--bg-card-hi); color:var(--text); padding:2px 8px; border-radius:9999px; font-size:10px; }

  table.data { width:100%; border-collapse:collapse; }
  table.data th { font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-dim); padding:9px 10px; text-align:left; border-bottom:1px solid var(--border); background:var(--bg-card); cursor:pointer; user-select:none; }
  table.data th:hover { color:var(--text); }
  table.data td { padding:9px 10px; border-bottom:1px solid var(--border); font-size:12.5px; vertical-align:middle; }
  table.data tr:hover td { background:var(--bg-card-hi); }
  table.data tr.row { cursor:pointer; }

  .pill { display:inline-block; padding:2px 9px; border-radius:9999px; font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; background:var(--bg-card-hi); color:var(--text); }
  .pill-measurement { background:#1E3A8A; color:#BFDBFE; }
  .pill-reports     { background:#064E3B; color:#A7F3D0; }
  .pill-crm         { background:#4C1D95; color:#DDD6FE; }
  .pill-invoicing   { background:#78350F; color:#FDE68A; }
  .pill-solar       { background:#7C2D12; color:#FED7AA; }
  .pill-secretary   { background:#831843; color:#FBCFE8; }
  .pill-marketing   { background:#365314; color:#D9F99D; }
  .pill-team        { background:#374151; color:#E5E7EB; }
  .pill-customer_portal { background:#1F2937; color:#9CA3AF; }
  .pill-home_designer   { background:#581C87; color:#E9D5FF; }
  .pill-other       { background:#1F2937; color:#6B7280; }

  .tab-row { display:flex; gap:6px; margin-bottom:14px; }
  .tab { padding:7px 14px; border-radius:8px; background:var(--bg-card); border:1px solid var(--border); color:var(--text-dim); font-size:11px; font-weight:600; cursor:pointer; }
  .tab.active { background:var(--accent); color:var(--bg); border-color:var(--accent); }

  .empty { color:var(--text-mute); text-align:center; padding:40px 20px; font-size:12px; }
  .err-banner { padding:10px 14px; background:#7F1D1D; color:#FECACA; border-radius:8px; font-size:12px; margin-bottom:14px; display:none; }
  .btn-secondary { background:var(--bg-card-hi); color:var(--text); padding:6px 12px; border-radius:8px; border:1px solid var(--border-hi); cursor:pointer; font-size:11px; font-weight:600; }
  .btn-secondary:hover { background:var(--border-hi); }

  /* Drill-down */
  .drilldown { background:var(--bg-input); border-top:1px solid var(--border); padding:14px 18px; }
  .drilldown .grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:12px; }
  .drilldown h3 { font-size:11px; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-dim); margin:0 0 8px; }
  .drilldown .mod-row { display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px dashed var(--border); font-size:12px; }
  .drilldown .mod-row:last-child { border-bottom:0; }

  /* 30d timeline heatmap */
  .heat-table { width:100%; border-collapse:separate; border-spacing:2px; font-size:10px; }
  .heat-table td { padding:0; }
  .heat-cell { width:14px; height:14px; border-radius:3px; background:var(--bg-card-hi); display:block; }
  .heat-cell[data-level="0"] { background:var(--bg-card-hi); }
  .heat-cell[data-level="1"] { background:#064E3B; }
  .heat-cell[data-level="2"] { background:#047857; }
  .heat-cell[data-level="3"] { background:#10B981; }
  .heat-cell[data-level="4"] { background:#34D399; }
  .heat-cell[data-level="5"] { background:#6EE7B7; }

  .filter-row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:12px; }
  .filter-row .spacer { flex:1; }
  .ts { color:var(--text-mute); font-size:11px; }
  input[type=text] { background:var(--bg-input); color:var(--text); border:1px solid var(--border); border-radius:8px; padding:6px 10px; font-size:12px; }
</style>
</head>
<body>
<header class="bar">
  <a href="/super-admin" class="breadcrumb"><i class="fas fa-crown"></i> Super Admin</a>
  <span style="color:var(--text-mute);">/</span>
  <h1><i class="fas fa-chart-line" style="color:var(--accent);margin-right:6px"></i>Module Analytics</h1>
  <span style="margin-left:auto; color:var(--text-mute); font-size:11px;" id="lastRefresh"></span>
  <button class="btn-secondary" onclick="loadAll()" title="Reload"><i class="fas fa-rotate"></i></button>
</header>
<main>
  <div class="err-banner" id="errBanner"></div>

  <!-- KPI strip -->
  <div class="hero" id="hero">
    <div class="kpi accent"><div class="label">Active right now</div><div class="v num" id="kpiActive">—</div><div class="sub">Last 5 min</div></div>
    <div class="kpi info"><div class="label">Customers today</div><div class="v num" id="kpiToday">—</div><div class="sub">Touched any module</div></div>
    <div class="kpi"><div class="label">Customers lifetime</div><div class="v num" id="kpiLifetime">—</div><div class="sub">Ever opened a module</div></div>
    <div class="kpi warn"><div class="label">Top module today</div><div class="v" id="kpiTopToday" style="font-size:18px;">—</div></div>
    <div class="kpi"><div class="label">Top module lifetime</div><div class="v" id="kpiTopLifetime" style="font-size:18px;">—</div></div>
  </div>

  <!-- Module leaderboard -->
  <section>
    <h2>Module leaderboard <span class="count" id="modCount">—</span></h2>
    <div class="card" style="padding:0;">
      <table class="data">
        <thead><tr>
          <th>Module</th>
          <th class="num">Opens today</th>
          <th class="num">Unique today</th>
          <th class="num">Opens lifetime</th>
          <th class="num">Unique lifetime</th>
          <th class="num">Time spent lifetime</th>
        </tr></thead>
        <tbody id="modBody"><tr><td colspan="6" class="empty">Loading…</td></tr></tbody>
      </table>
    </div>
  </section>

  <!-- Per-customer table -->
  <section>
    <h2>Customers <span class="count" id="custCount">—</span></h2>
    <div class="filter-row">
      <div class="tab-row" id="rangeTabs">
        <div class="tab active" data-range="today">Today</div>
        <div class="tab" data-range="7d">Last 7d</div>
        <div class="tab" data-range="lifetime">Lifetime</div>
      </div>
      <input type="text" id="searchBox" placeholder="Filter by email, name, company…" style="min-width:280px;">
      <span class="spacer"></span>
      <span class="ts" id="custLimitInfo">top 200 by opens</span>
    </div>
    <div class="card" style="padding:0;">
      <table class="data" id="custTable">
        <thead><tr>
          <th>Customer</th>
          <th class="num">Total opens</th>
          <th class="num">Modules used</th>
          <th class="num">Time spent</th>
          <th>Module breakdown</th>
        </tr></thead>
        <tbody id="custBody"><tr><td colspan="5" class="empty">Loading…</td></tr></tbody>
      </table>
    </div>
  </section>
</main>

<script>
const MODULE_ORDER = ['measurement','reports','crm','invoicing','solar','secretary','marketing','team','home_designer','customer_portal','other'];
const MODULE_LABELS = {
  measurement: 'Measurements', reports: 'Reports', crm: 'CRM', invoicing: 'Invoicing',
  solar: 'Solar', secretary: 'Receptionist', marketing: 'Marketing', team: 'Team',
  home_designer: 'AI Designer', customer_portal: 'Portal', other: 'Other',
};

let CURRENT_RANGE = 'today';
let LAST_ROWS = [];

async function getJson(url) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(url + ' → ' + r.status);
  return r.json();
}

function fmtSeconds(s) {
  s = Number(s || 0);
  if (s < 60) return s + 's';
  const m = Math.round(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h + 'h ' + mm + 'm';
}

function modPill(name, count) {
  const label = MODULE_LABELS[name] || name;
  return '<span class="pill pill-' + name + '" title="' + label + '">' + label + ' · ' + count + '</span>';
}

async function loadSummary() {
  const d = await getJson('/api/super-admin/module-analytics/api/summary');
  document.getElementById('kpiActive').textContent = d.kpis.active_now;
  document.getElementById('kpiToday').textContent = d.kpis.today_unique_customers;
  document.getElementById('kpiLifetime').textContent = d.kpis.lifetime_unique_customers;
  document.getElementById('kpiTopToday').textContent = MODULE_LABELS[d.kpis.top_module_today] || d.kpis.top_module_today || '—';
  document.getElementById('kpiTopLifetime').textContent = MODULE_LABELS[d.kpis.top_module_lifetime] || d.kpis.top_module_lifetime || '—';

  const tBy = {};
  (d.today_modules || []).forEach(r => tBy[r.module] = r);
  const lBy = {};
  (d.lifetime_modules || []).forEach(r => lBy[r.module] = r);

  const allModules = Array.from(new Set([
    ...Object.keys(tBy), ...Object.keys(lBy)
  ])).sort((a,b) => (lBy[b]?.visits||0) - (lBy[a]?.visits||0));

  document.getElementById('modCount').textContent = allModules.length;
  const body = document.getElementById('modBody');
  if (allModules.length === 0) {
    body.innerHTML = '<tr><td colspan="6" class="empty">No customer module activity yet.</td></tr>';
    return;
  }
  body.innerHTML = allModules.map(m => {
    const t = tBy[m] || {};
    const l = lBy[m] || {};
    const label = MODULE_LABELS[m] || m;
    return '<tr>' +
      '<td><span class="pill pill-' + m + '">' + label + '</span></td>' +
      '<td class="num">' + (t.visits || 0) + '</td>' +
      '<td class="num">' + (t.unique_customers || 0) + '</td>' +
      '<td class="num">' + (l.visits || 0) + '</td>' +
      '<td class="num">' + (l.unique_customers || 0) + '</td>' +
      '<td class="num">' + fmtSeconds(l.total_seconds) + '</td>' +
    '</tr>';
  }).join('');
}

async function loadCustomers() {
  const url = '/api/super-admin/module-analytics/api/customers?range=' + CURRENT_RANGE + '&limit=200';
  const d = await getJson(url);
  LAST_ROWS = d.rows || [];
  renderCustomers();
}

function renderCustomers() {
  const q = (document.getElementById('searchBox').value || '').toLowerCase().trim();
  const body = document.getElementById('custBody');
  const filtered = q ? LAST_ROWS.filter(r =>
    (r.email||'').toLowerCase().includes(q) ||
    (r.name||'').toLowerCase().includes(q) ||
    (r.company_name||'').toLowerCase().includes(q)
  ) : LAST_ROWS;

  document.getElementById('custCount').textContent = filtered.length;
  if (filtered.length === 0) {
    body.innerHTML = '<tr><td colspan="5" class="empty">No customer activity in this range.</td></tr>';
    return;
  }

  body.innerHTML = filtered.map(r => {
    const breakdown = r.module_breakdown || {};
    const pills = MODULE_ORDER
      .filter(m => breakdown[m] > 0)
      .map(m => modPill(m, breakdown[m]))
      .join(' ');
    const who = (r.name || r.company_name || r.email).replace(/</g,'&lt;');
    const sub = r.email && (r.name || r.company_name) ? '<div style="font-size:10px;color:var(--text-mute)">' + r.email + '</div>' : '';
    return '<tr class="row" data-owner-id="' + r.owner_id + '">' +
      '<td><div style="font-weight:600">' + who + '</div>' + sub + '</td>' +
      '<td class="num">' + r.total_visits + '</td>' +
      '<td class="num">' + r.modules_touched + '</td>' +
      '<td class="num">' + fmtSeconds(r.total_seconds) + '</td>' +
      '<td>' + (pills || '<span style="color:var(--text-mute)">—</span>') + '</td>' +
    '</tr>';
  }).join('');

  body.querySelectorAll('tr.row').forEach(tr => {
    tr.addEventListener('click', () => toggleDrilldown(tr));
  });
}

async function toggleDrilldown(tr) {
  const ownerId = tr.getAttribute('data-owner-id');
  const next = tr.nextElementSibling;
  if (next && next.classList.contains('dd-row')) {
    next.remove(); return;
  }
  const dd = document.createElement('tr');
  dd.className = 'dd-row';
  dd.innerHTML = '<td colspan="5" class="drilldown">Loading drilldown…</td>';
  tr.after(dd);
  try {
    const d = await getJson('/api/super-admin/module-analytics/api/customer/' + ownerId);
    dd.querySelector('td').innerHTML = renderDrilldown(d);
  } catch (e) {
    dd.querySelector('td').innerHTML = '<span style="color:var(--text-mute)">Drilldown failed: ' + (e.message||e) + '</span>';
  }
}

function renderDrilldown(d) {
  const owner = d.owner || {};
  const today = d.today_modules || [];
  const lifetime = d.lifetime_modules || [];
  const members = d.members || [];

  // Build a 30-day total-opens-per-day sparkline.
  const byDay = {};
  (d.timeline || []).forEach(t => {
    byDay[t.day] = (byDay[t.day] || 0) + Number(t.visits || 0);
  });
  const days = [];
  const today0 = new Date(); today0.setHours(0,0,0,0);
  for (let i = 29; i >= 0; i--) {
    const dt = new Date(today0.getTime() - i*86400000);
    const k = dt.toISOString().slice(0,10);
    days.push({ day: k, count: byDay[k] || 0 });
  }
  const maxCount = Math.max(1, ...days.map(d => d.count));
  const heatCells = days.map(d => {
    const lvl = d.count === 0 ? 0 : Math.min(5, Math.ceil((d.count / maxCount) * 5));
    return '<td><span class="heat-cell" data-level="' + lvl + '" title="' + d.day + ' · ' + d.count + ' opens"></span></td>';
  }).join('');

  const todayList = today.length ? today.map(r => (
    '<div class="mod-row"><span>' + (MODULE_LABELS[r.module]||r.module) + '</span><span class="num">' + r.visits + ' opens · ' + fmtSeconds(r.total_seconds) + '</span></div>'
  )).join('') : '<div style="color:var(--text-mute);font-size:11px;">No module opens today.</div>';

  const lifetimeList = lifetime.length ? lifetime.map(r => (
    '<div class="mod-row"><span>' + (MODULE_LABELS[r.module]||r.module) + '</span><span class="num">' + r.visits + ' opens · ' + fmtSeconds(r.total_seconds) + '</span></div>'
  )).join('') : '<div style="color:var(--text-mute);font-size:11px;">No lifetime activity.</div>';

  const memberBlock = members.length > 1 ? (
    '<h3 style="margin-top:14px;">Seats on this account (' + members.length + ')</h3>' +
    '<div style="font-size:11px;color:var(--text-dim);">' +
    members.map(m => (m.name || m.email) + (m.id === owner.id ? ' <span style="color:var(--accent);">(owner)</span>' : '')).join(' · ') +
    '</div>'
  ) : '';

  return (
    '<div class="grid">' +
      '<div><h3>Today</h3>' + todayList + '</div>' +
      '<div><h3>Lifetime</h3>' + lifetimeList + '</div>' +
    '</div>' +
    '<h3>Last 30 days · total opens per day</h3>' +
    '<table class="heat-table"><tr>' + heatCells + '</tr></table>' +
    '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-mute);margin-top:4px;"><span>30 days ago</span><span>today</span></div>' +
    memberBlock
  );
}

async function loadAll() {
  try {
    document.getElementById('errBanner').style.display = 'none';
    await Promise.all([loadSummary(), loadCustomers()]);
    document.getElementById('lastRefresh').textContent = 'Refreshed ' + new Date().toLocaleTimeString();
  } catch (e) {
    const b = document.getElementById('errBanner');
    b.textContent = 'Failed to load: ' + (e.message || e);
    b.style.display = 'block';
  }
}

document.getElementById('rangeTabs').addEventListener('click', e => {
  const t = e.target.closest('.tab'); if (!t) return;
  document.querySelectorAll('#rangeTabs .tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  CURRENT_RANGE = t.getAttribute('data-range');
  loadCustomers().catch(()=>{});
});
document.getElementById('searchBox').addEventListener('input', () => renderCustomers());

loadAll();
setInterval(loadAll, 60000);
</script>
</body>
</html>`
}

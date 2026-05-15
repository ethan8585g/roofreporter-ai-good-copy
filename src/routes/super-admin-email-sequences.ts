// ============================================================
// Super Admin — Email Sequences (live tracking dashboard)
// Mounted at /super-admin/email-sequences (HTML) and
// /api/super-admin/email-sequences/* (JSON). Superadmin only.
//
// Dedicated module for the email-sequence engine. Polls every
// 10s for live counts + per-step funnel + recent-fires feed.
// Re-uses the existing /api/super-admin/email-tracker/* write
// endpoints (enroll, pause, resume, cancel, skip, send-now,
// create/edit/archive custom sequence) so there's a single
// source of truth.
//
// Per-step engagement is computed by matching email_sends.kind:
//   - builtin signup_nurture_<stage>  →  'nurture_<stage>'
//   - builtin cart_recovery_<stage>   →  'cart_recovery_<stage>'
//   - builtin drip_<template>         →  'drip_<template>'
//   - custom                          →  '<sequence_type>_step<idx>'
// See src/services/sequence-engine.ts:382-403 for the source of
// truth on this mapping.
// ============================================================

import { Hono } from 'hono'
import { validateAdminSession, requireSuperadmin } from './auth'
import { listDefinitions, type SequenceDefinition, type SequenceStep } from '../services/sequence-engine'
import type { Bindings, AppEnv } from '../types'

export const superAdminEmailSequences = new Hono<AppEnv>()

// ── Session gate (superadmin only) ───────────────────────────
superAdminEmailSequences.use('*', async (c, next) => {
  const path = c.req.path
  const ownsThisPath = path === '/super-admin/email-sequences'
    || path.startsWith('/super-admin/email-sequences/')
    || path.startsWith('/api/super-admin/email-sequences/')
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

// Mirror sequence-engine.ts's kind derivation so the dashboard can
// join email_sends → step without round-tripping through the engine.
function deriveStepKind(def: SequenceDefinition, stepIndex: number): string | null {
  const step = def.steps[stepIndex]
  if (!step) return null
  if (def.kind === 'custom') return `${def.sequence_type}_step${stepIndex}`
  const handler = (step as any).handler || ''
  if (handler.startsWith('signup_nurture_')) {
    return 'nurture_' + handler.replace('signup_nurture_', '')
  }
  // cart_recovery_* and drip_* handlers produce kind == handler
  return handler || null
}

// ── JSON: combined live dashboard payload ────────────────────
superAdminEmailSequences.get('/api/super-admin/email-sequences/dashboard', async (c) => {
  const db = c.env.DB

  // 1) KPI tiles
  const activeRow = await db.prepare(
    `SELECT COUNT(*) AS n FROM sequence_enrollments WHERE status = 'active'`
  ).first<any>()

  const dueRow = await db.prepare(
    `SELECT COUNT(*) AS n FROM sequence_enrollments
     WHERE status = 'active' AND next_send_at IS NOT NULL
       AND next_send_at <= datetime('now', '+1 hour')`
  ).first<any>()

  const firedTodayRow = await db.prepare(
    `SELECT COUNT(*) AS n FROM sequence_enrollments
     WHERE last_step_sent_at IS NOT NULL
       AND last_step_sent_at > datetime('now', '-1 day')`
  ).first<any>()

  const opens7dRow = await db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN open_count > 0 THEN 1 ELSE 0 END) AS opened,
            COALESCE(SUM(open_count),0) AS open_events,
            COALESCE(SUM(click_count),0) AS click_events
     FROM email_sends es
     WHERE es.sent_at > datetime('now', '-7 days')
       AND EXISTS (
         SELECT 1 FROM sequence_enrollments se WHERE se.last_email_send_id = es.id
       )`
  ).first<any>()
  const total7d = Number(opens7dRow?.total || 0)
  const opened7d = Number(opens7dRow?.opened || 0)
  const openRate7d = total7d > 0 ? Math.round((opened7d / total7d) * 1000) / 10 : 0

  // 2) Definitions + per-sequence enrollment counts
  const defs = await listDefinitions(c.env, false)

  const countsRows = await db.prepare(
    `SELECT sequence_type, status, COUNT(*) AS n
     FROM sequence_enrollments GROUP BY sequence_type, status`
  ).all<any>()
  const counts: Record<string, Record<string, number>> = {}
  for (const r of countsRows.results || []) {
    if (!counts[r.sequence_type]) counts[r.sequence_type] = {}
    counts[r.sequence_type][r.status] = Number(r.n || 0)
  }

  // 3) Per-step engagement — gather every distinct kind we'll need,
  // run one grouped query against email_sends instead of N+1.
  const kindIndex: Array<{ sequence_type: string; step_index: number; kind: string }> = []
  for (const def of defs) {
    for (let i = 0; i < def.steps.length; i++) {
      const k = deriveStepKind(def, i)
      if (k) kindIndex.push({ sequence_type: def.sequence_type, step_index: i, kind: k })
    }
  }
  const stepStats: Record<string, { sent: number; sent_24h: number; opened: number; open_events: number; clicks: number }> = {}
  if (kindIndex.length > 0) {
    const placeholders = kindIndex.map(() => '?').join(',')
    const rows = await db.prepare(
      `SELECT kind,
              COUNT(*) AS sent,
              SUM(CASE WHEN sent_at > datetime('now','-1 day') THEN 1 ELSE 0 END) AS sent_24h,
              SUM(CASE WHEN open_count > 0 THEN 1 ELSE 0 END) AS opened,
              COALESCE(SUM(open_count),0) AS open_events,
              COALESCE(SUM(click_count),0) AS clicks
       FROM email_sends
       WHERE kind IN (${placeholders})
         AND sent_at > datetime('now','-90 days')
       GROUP BY kind`
    ).bind(...kindIndex.map(k => k.kind)).all<any>()
    for (const r of rows.results || []) {
      stepStats[r.kind] = {
        sent: Number(r.sent || 0),
        sent_24h: Number(r.sent_24h || 0),
        opened: Number(r.opened || 0),
        open_events: Number(r.open_events || 0),
        clicks: Number(r.clicks || 0),
      }
    }
  }

  // Pack per-sequence response
  const sequences = defs.map(def => {
    const c2 = counts[def.sequence_type] || {}
    const steps = def.steps.map((s: SequenceStep, i: number) => {
      const k = deriveStepKind(def, i)
      const stats = (k && stepStats[k]) || { sent: 0, sent_24h: 0, opened: 0, open_events: 0, clicks: 0 }
      return {
        step_index: i,
        label: (s as any).label || `Step ${i + 1}`,
        delay_seconds: (s as any).delay_seconds || 0,
        handler: (s as any).handler || null,
        kind: k,
        sent: stats.sent,
        sent_24h: stats.sent_24h,
        opened: stats.opened,
        open_events: stats.open_events,
        clicks: stats.clicks,
        open_rate: stats.sent > 0 ? Math.round((stats.opened / stats.sent) * 1000) / 10 : 0,
      }
    })
    return {
      sequence_type: def.sequence_type,
      name: def.name,
      description: def.description,
      kind: def.kind,
      enabled: def.enabled,
      default_category: def.default_category,
      default_from: def.default_from,
      steps,
      counts: {
        active: c2.active || 0,
        paused: c2.paused || 0,
        completed: c2.completed || 0,
        cancelled: c2.cancelled || 0,
        failed: c2.failed || 0,
      },
    }
  })

  // 4) Recent fires feed — last 50 enrollments by last_step_sent_at, joined
  // to email_sends for the engagement signal.
  const recent = await db.prepare(
    `SELECT se.id AS enrollment_id, se.sequence_type, se.recipient_email,
            se.current_step, se.status, se.last_step_sent_at, se.next_send_at,
            es.id AS email_send_id, es.kind AS kind, es.open_count, es.click_count, es.last_opened_at,
            es.status AS send_status
     FROM sequence_enrollments se
     LEFT JOIN email_sends es ON es.id = se.last_email_send_id
     WHERE se.last_step_sent_at IS NOT NULL
     ORDER BY se.last_step_sent_at DESC
     LIMIT 50`
  ).all<any>()

  return c.json({
    server_time: new Date().toISOString(),
    tiles: {
      active_enrollments: Number(activeRow?.n || 0),
      due_next_hour: Number(dueRow?.n || 0),
      fired_24h: Number(firedTodayRow?.n || 0),
      open_rate_7d: openRate7d,
      open_events_7d: Number(opens7dRow?.open_events || 0),
      click_events_7d: Number(opens7dRow?.click_events || 0),
    },
    sequences,
    recent: recent.results || [],
  })
})

// ── HTML page ────────────────────────────────────────────────
superAdminEmailSequences.get('/super-admin/email-sequences', (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Email Sequences · Roof Manager</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
  <style>
    body { background: #0a0a0a; color: #e5e7eb; font-family: Inter, system-ui, sans-serif; }
    .card { background: #111; border: 1px solid #1f1f1f; border-radius: 12px; }
    .tile { background: #111; border: 1px solid #1f1f1f; border-radius: 12px; padding: 14px 18px; }
    .tile h4 { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #9ca3af; margin: 0 0 4px; font-weight: 600; }
    .tile .v { font-size: 26px; font-weight: 700; color: #fff; line-height: 1.1; }
    .tile .sub { font-size: 11px; color: #6b7280; margin-top: 2px; }
    .seq-card { background: #111; border: 1px solid #1f1f1f; border-radius: 12px; padding: 18px; }
    .seq-card.builtin { border-left: 3px solid #3b82f6; }
    .seq-card.custom  { border-left: 3px solid #a78bfa; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .pill-blue   { background: rgba(59,130,246,.15);  color: #60a5fa; }
    .pill-purple { background: rgba(168,85,247,.15);  color: #c4b5fd; }
    .pill-green  { background: rgba(16,185,129,.15);  color: #10b981; }
    .pill-amber  { background: rgba(251,191,36,.15);  color: #fbbf24; }
    .pill-red    { background: rgba(239,68,68,.15);   color: #ef4444; }
    .pill-gray   { background: rgba(156,163,175,.15); color: #9ca3af; }
    .step-row { background: #0c0c0c; border: 1px solid #1a1a1a; border-radius: 8px; padding: 10px 12px; margin-top: 8px; display: grid; grid-template-columns: 40px 1.5fr 1fr 1fr 1fr 1fr; gap: 12px; align-items: center; font-size: 12px; }
    .step-row .stepnum { width: 28px; height: 28px; border-radius: 50%; background: #1f1f1f; display: flex; align-items: center; justify-content: center; font-weight: 700; color: #fff; }
    .miniprog { width: 100%; height: 4px; background: #1f1f1f; border-radius: 2px; overflow: hidden; }
    .miniprog > div { height: 100%; background: linear-gradient(90deg,#10b981,#00ff88); }
    .btn { font-size: 12px; font-weight: 600; padding: 6px 12px; border-radius: 6px; border: 1px solid transparent; cursor: pointer; transition: all .15s; }
    .btn-primary { background: #00cc6a; color: #0a0a0a; }
    .btn-primary:hover:not(:disabled) { background: #00ff88; }
    .btn-ghost { background: rgba(255,255,255,.06); color: #e5e7eb; }
    .btn-ghost:hover { background: rgba(255,255,255,.12); }
    .btn-red { background: rgba(239,68,68,.15); color: #f87171; border-color: rgba(239,68,68,.3); }
    .btn-red:hover { background: rgba(239,68,68,.25); }
    .btn:disabled { opacity: .4; cursor: not-allowed; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 10px; letter-spacing: .05em; text-transform: uppercase; color: #6b7280; padding: 8px 10px; border-bottom: 1px solid #1f1f1f; font-weight: 600; }
    td { padding: 10px; border-bottom: 1px solid #161616; font-size: 12px; color: #d1d5db; vertical-align: middle; }
    .pulse-dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; display: inline-block; animation: pulse 1.6s ease-in-out infinite; vertical-align: middle; margin-right: 6px; }
    @keyframes pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .5; transform: scale(1.4); } }
    .modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,.75); display: none; align-items: center; justify-content: center; z-index: 50; }
    .modal-bg.show { display: flex; }
    .modal { background: #0c0c0c; border: 1px solid #1f1f1f; border-radius: 12px; padding: 24px; width: 100%; max-width: 760px; max-height: 90vh; overflow-y: auto; }
    .modal label { display: block; font-size: 11px; text-transform: uppercase; color: #9ca3af; margin-bottom: 4px; font-weight: 600; letter-spacing: .05em; }
    .modal input, .modal textarea, .modal select { width: 100%; background: #000; border: 1px solid #2a2a2a; border-radius: 6px; padding: 8px 10px; color: #fff; font-size: 13px; }
    .modal textarea { font-family: ui-monospace, "SF Mono", Consolas, monospace; min-height: 200px; }
    .modal .field { margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="max-w-7xl mx-auto p-6">
    <div class="flex items-center justify-between mb-6">
      <div>
        <a href="/super-admin" class="text-xs text-gray-500 hover:text-gray-300"><i class="fas fa-arrow-left"></i> Super Admin</a>
        <h1 class="text-2xl font-bold text-white mt-2">Email Sequences <span class="pulse-dot"></span><span class="text-xs text-gray-500 font-normal" id="liveLabel">live · auto-refresh 10s</span></h1>
        <p class="text-sm text-gray-400 mt-1">Track every active sequence, edit custom ones, and manage enrollments in real time.</p>
      </div>
      <div class="flex items-center gap-2">
        <button class="btn btn-ghost" id="pauseLive"><i class="fas fa-pause"></i> Pause refresh</button>
        <button class="btn btn-primary" onclick="openNewSequence()"><i class="fas fa-plus"></i> New custom sequence</button>
        <button class="btn btn-ghost" onclick="openEnroll(null)"><i class="fas fa-user-plus"></i> Enroll recipient</button>
      </div>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
      <div class="tile"><h4>Active Enrollments</h4><div class="v" id="t-active">–</div><div class="sub">All sequences</div></div>
      <div class="tile"><h4>Due Next Hour</h4><div class="v" id="t-due">–</div><div class="sub">Cron will fire these</div></div>
      <div class="tile"><h4>Fired (24h)</h4><div class="v" id="t-fired">–</div><div class="sub">Steps sent</div></div>
      <div class="tile"><h4>Open Rate (7d)</h4><div class="v" id="t-orate">–</div><div class="sub" id="t-orate-sub">–</div></div>
      <div class="tile"><h4>Clicks (7d)</h4><div class="v" id="t-clicks">–</div><div class="sub">Tracked link hits</div></div>
    </div>

    <div class="text-xs text-gray-500 mb-3 flex items-center gap-2">
      <span id="last-refresh">—</span>
    </div>

    <div id="sequences" class="space-y-4 mb-8"></div>

    <div class="card overflow-hidden">
      <div class="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <div class="text-sm font-semibold text-white"><i class="fas fa-bolt mr-1 text-yellow-500"></i> Recent fires</div>
        <div class="text-xs text-gray-500">Last 50 enrollment events</div>
      </div>
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr>
              <th>Sent</th>
              <th>Recipient</th>
              <th>Sequence</th>
              <th>Step</th>
              <th>Status</th>
              <th>Opens</th>
              <th>Clicks</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="recent-rows"></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Enroll modal -->
  <div class="modal-bg" id="enroll-modal">
    <div class="modal">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold text-white">Enroll recipient</h3>
        <button onclick="closeModal('enroll-modal')" class="text-gray-500 hover:text-white"><i class="fas fa-times"></i></button>
      </div>
      <div class="field"><label>Sequence</label><select id="enroll-seq"></select></div>
      <div class="field"><label>Recipient email</label><input type="email" id="enroll-email" placeholder="someone@example.com" /></div>
      <div class="field"><label>Customer ID (optional)</label><input type="number" id="enroll-cust" placeholder="leave blank if not a customer" /></div>
      <div class="grid grid-cols-2 gap-3">
        <div class="field"><label>Start at step</label><input type="number" id="enroll-step" value="0" min="0" /></div>
        <div class="field"><label>Delay (seconds)</label><input type="number" id="enroll-delay" value="0" min="0" /></div>
      </div>
      <div class="field"><label>Notes</label><input type="text" id="enroll-notes" placeholder="why are you enrolling them?" /></div>
      <div class="text-right">
        <button class="btn btn-ghost mr-2" onclick="closeModal('enroll-modal')">Cancel</button>
        <button class="btn btn-primary" onclick="submitEnroll()">Enroll</button>
      </div>
      <div id="enroll-err" class="text-xs text-red-400 mt-3"></div>
    </div>
  </div>

  <!-- Custom sequence editor modal -->
  <div class="modal-bg" id="seq-modal">
    <div class="modal" style="max-width:880px">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold text-white" id="seq-modal-title">New custom sequence</h3>
        <button onclick="closeModal('seq-modal')" class="text-gray-500 hover:text-white"><i class="fas fa-times"></i></button>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div class="field"><label>Key (sequence_type)</label><input type="text" id="seq-type" placeholder="winter_promo_2026" /></div>
        <div class="field"><label>Display name</label><input type="text" id="seq-name" /></div>
      </div>
      <div class="field"><label>Description</label><input type="text" id="seq-desc" /></div>
      <div class="grid grid-cols-2 gap-3">
        <div class="field"><label>From address</label><input type="text" id="seq-from" placeholder="sales@roofmanager.ca" /></div>
        <div class="field"><label>Category</label><select id="seq-cat"><option value="customer">customer</option><option value="cart">cart</option><option value="lead">lead</option><option value="internal">internal</option></select></div>
      </div>
      <div class="field">
        <label>Steps (JSON array of <code>{step_index, label, delay_seconds, subject_template, body_html_template}</code>)</label>
        <textarea id="seq-steps" spellcheck="false">[
  {
    "step_index": 0,
    "label": "Intro",
    "delay_seconds": 0,
    "subject_template": "Hi {{first_name}}",
    "body_html_template": "<p>Hello!</p>"
  }
]</textarea>
      </div>
      <div class="text-right">
        <button class="btn btn-ghost mr-2" onclick="closeModal('seq-modal')">Cancel</button>
        <button class="btn btn-primary" onclick="submitSequence()">Save sequence</button>
      </div>
      <div id="seq-err" class="text-xs text-red-400 mt-3"></div>
    </div>
  </div>

<script>
let LIVE = true;
let TIMER = null;
const POLL_MS = 10000;
let LAST_DATA = null;

const fmt = (s) => {
  if (!s) return '—';
  const d = new Date(s.replace(' ','T') + 'Z');
  if (isNaN(d.getTime())) return s;
  const min = Math.floor((Date.now() - d.getTime())/60000);
  if (min < 1) return 'just now';
  if (min < 60) return min + 'm ago';
  if (min < 1440) return Math.floor(min/60) + 'h ago';
  return Math.floor(min/1440) + 'd ago';
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const fmtDelay = (sec) => {
  if (!sec) return 'immediate';
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.round(sec/60) + 'm';
  if (sec < 86400) return Math.round(sec/3600) + 'h';
  return Math.round(sec/86400) + 'd';
};

async function loadDashboard() {
  try {
    const r = await fetch('/api/super-admin/email-sequences/dashboard');
    const j = await r.json();
    LAST_DATA = j;
    renderTiles(j.tiles);
    renderSequences(j.sequences);
    renderRecent(j.recent);
    document.getElementById('last-refresh').textContent = 'Updated ' + new Date().toLocaleTimeString();
  } catch (e) {
    document.getElementById('last-refresh').textContent = 'Refresh failed: ' + (e?.message || e);
  }
}

function renderTiles(t) {
  document.getElementById('t-active').textContent = t.active_enrollments ?? 0;
  document.getElementById('t-due').textContent = t.due_next_hour ?? 0;
  document.getElementById('t-fired').textContent = t.fired_24h ?? 0;
  document.getElementById('t-orate').textContent = (t.open_rate_7d ?? 0) + '%';
  document.getElementById('t-orate-sub').textContent = (t.open_events_7d ?? 0) + ' opens · ' + (t.click_events_7d ?? 0) + ' clicks';
  document.getElementById('t-clicks').textContent = t.click_events_7d ?? 0;
}

function renderSequences(list) {
  const wrap = document.getElementById('sequences');
  if (!list || list.length === 0) {
    wrap.innerHTML = '<div class="card p-8 text-center text-gray-500">No sequence definitions loaded.</div>';
    return;
  }
  wrap.innerHTML = list.map(seqCard).join('');
}

function seqCard(s) {
  const kindPill = s.kind === 'builtin'
    ? '<span class="pill pill-blue">Built-in</span>'
    : '<span class="pill pill-purple">Custom</span>';
  const enabledPill = s.enabled
    ? '<span class="pill pill-green">Enabled</span>'
    : '<span class="pill pill-red">Disabled</span>';
  const countsRow = [
    ['active','green', s.counts.active],
    ['paused','amber', s.counts.paused],
    ['completed','gray', s.counts.completed],
    ['failed','red', s.counts.failed],
    ['cancelled','gray', s.counts.cancelled],
  ].map(([k,c,n]) => '<span class="pill pill-' + c + '">' + k + ' ' + n + '</span>').join(' ');

  const stepsHtml = s.steps.map(st => {
    const pct = st.sent > 0 ? Math.min(100, (st.opened / st.sent) * 100) : 0;
    return '<div class="step-row">' +
      '<div class="stepnum">' + (st.step_index + 1) + '</div>' +
      '<div><div class="text-white font-semibold">' + esc(st.label) + '</div>' +
        '<div class="text-xs text-gray-500">' + fmtDelay(st.delay_seconds) + ' after previous · kind=' + esc(st.kind || '—') + '</div></div>' +
      '<div><div class="text-white font-mono">' + st.sent + '</div><div class="text-xs text-gray-500">sent · ' + st.sent_24h + ' last 24h</div></div>' +
      '<div><div class="text-white font-mono">' + st.opened + '</div><div class="text-xs text-gray-500">' + st.open_events + ' open events</div></div>' +
      '<div><div class="text-white font-mono">' + st.clicks + '</div><div class="text-xs text-gray-500">clicks</div></div>' +
      '<div><div class="text-white font-mono">' + st.open_rate + '%</div><div class="miniprog mt-1"><div style="width:' + pct + '%"></div></div></div>' +
      '</div>';
  }).join('');

  const editBtn = s.kind === 'custom'
    ? '<button class="btn btn-ghost" onclick="openEditSequence(\\'' + s.sequence_type + '\\')"><i class="fas fa-pen"></i> Edit</button>' +
      '<button class="btn btn-red" onclick="archiveSequence(\\'' + s.sequence_type + '\\')"><i class="fas fa-archive"></i> Archive</button>'
    : '<span class="text-xs text-gray-500 italic">built-in · edit in code</span>';

  return '<div class="seq-card ' + s.kind + '">' +
    '<div class="flex items-start justify-between mb-2">' +
      '<div>' +
        '<div class="flex items-center gap-2">' +
          '<h3 class="text-base font-bold text-white">' + esc(s.name) + '</h3>' +
          kindPill + enabledPill +
        '</div>' +
        '<div class="text-xs text-gray-500 mt-1">' + esc(s.sequence_type) + (s.description ? ' · ' + esc(s.description) : '') + '</div>' +
      '</div>' +
      '<div class="flex items-center gap-2">' +
        '<button class="btn btn-primary" onclick="openEnroll(\\'' + s.sequence_type + '\\')"><i class="fas fa-user-plus"></i> Enroll</button>' +
        editBtn +
      '</div>' +
    '</div>' +
    '<div class="mb-2">' + countsRow + '</div>' +
    '<div>' + stepsHtml + '</div>' +
  '</div>';
}

function renderRecent(rows) {
  const tbody = document.getElementById('recent-rows');
  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-gray-600 py-8">No enrollment fires yet.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => {
    const statusClass = r.status === 'active' ? 'green' : r.status === 'paused' ? 'amber' : r.status === 'failed' ? 'red' : 'gray';
    const isActive = r.status === 'active';
    const isPaused = r.status === 'paused';
    const actions = [
      isPaused ? '<button class="btn btn-ghost" onclick="enrollAction(' + r.enrollment_id + ',\\'resume\\')" title="Resume">▶</button>'
               : isActive ? '<button class="btn btn-ghost" onclick="enrollAction(' + r.enrollment_id + ',\\'pause\\')" title="Pause">⏸</button>' : '',
      isActive ? '<button class="btn btn-ghost" onclick="enrollAction(' + r.enrollment_id + ',\\'send-now\\')" title="Send next now">⚡</button>' : '',
      isActive ? '<button class="btn btn-ghost" onclick="enrollAction(' + r.enrollment_id + ',\\'skip\\')" title="Skip to next">⏭</button>' : '',
      (isActive || isPaused) ? '<button class="btn btn-red" onclick="enrollAction(' + r.enrollment_id + ',\\'cancel\\')" title="Cancel">✕</button>' : '',
    ].filter(Boolean).join(' ');
    return '<tr>' +
      '<td>' + fmt(r.last_step_sent_at) + '</td>' +
      '<td class="font-mono text-white">' + esc(r.recipient_email) + '</td>' +
      '<td>' + esc(r.sequence_type) + '</td>' +
      '<td>step ' + (Number(r.current_step) + 1) + '</td>' +
      '<td><span class="pill pill-' + statusClass + '">' + esc(r.status) + '</span></td>' +
      '<td>' + (r.open_count ?? 0) + '</td>' +
      '<td>' + (r.click_count ?? 0) + '</td>' +
      '<td>' + actions + '</td>' +
    '</tr>';
  }).join('');
}

async function enrollAction(id, action) {
  if (action === 'cancel' && !confirm('Cancel this enrollment?')) return;
  try {
    const r = await fetch('/api/super-admin/email-tracker/enrollments/' + id + '/' + action, { method: 'POST' });
    const j = await r.json();
    if (!j.ok) { alert('Failed: ' + (j.error || 'unknown')); return; }
    loadDashboard();
  } catch (e) { alert('Error: ' + (e?.message || e)); }
}

function openEnroll(seqType) {
  const sel = document.getElementById('enroll-seq');
  const seqs = (LAST_DATA?.sequences || []).filter(s => s.enabled);
  sel.innerHTML = seqs.map(s => '<option value="' + esc(s.sequence_type) + '">' + esc(s.name) + ' (' + s.kind + ')</option>').join('');
  if (seqType) sel.value = seqType;
  document.getElementById('enroll-email').value = '';
  document.getElementById('enroll-cust').value = '';
  document.getElementById('enroll-step').value = '0';
  document.getElementById('enroll-delay').value = '0';
  document.getElementById('enroll-notes').value = '';
  document.getElementById('enroll-err').textContent = '';
  document.getElementById('enroll-modal').classList.add('show');
}

async function submitEnroll() {
  const body = {
    sequence_type: document.getElementById('enroll-seq').value,
    recipient_email: document.getElementById('enroll-email').value.trim(),
    customer_id: Number(document.getElementById('enroll-cust').value) || null,
    start_at_step: Number(document.getElementById('enroll-step').value) || 0,
    delay_seconds: Number(document.getElementById('enroll-delay').value) || 0,
    notes: document.getElementById('enroll-notes').value.trim(),
  };
  if (!body.recipient_email || !body.sequence_type) {
    document.getElementById('enroll-err').textContent = 'sequence + email required';
    return;
  }
  try {
    const r = await fetch('/api/super-admin/email-tracker/enrollments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.ok) { document.getElementById('enroll-err').textContent = j.error || 'failed'; return; }
    closeModal('enroll-modal');
    loadDashboard();
  } catch (e) {
    document.getElementById('enroll-err').textContent = e?.message || String(e);
  }
}

function openNewSequence() {
  document.getElementById('seq-modal-title').textContent = 'New custom sequence';
  document.getElementById('seq-type').value = '';
  document.getElementById('seq-type').disabled = false;
  document.getElementById('seq-name').value = '';
  document.getElementById('seq-desc').value = '';
  document.getElementById('seq-from').value = '';
  document.getElementById('seq-cat').value = 'customer';
  document.getElementById('seq-steps').value = '[\\n  {\\n    "step_index": 0,\\n    "label": "Intro",\\n    "delay_seconds": 0,\\n    "subject_template": "Hi {{first_name}}",\\n    "body_html_template": "<p>Hello!</p>"\\n  }\\n]';
  document.getElementById('seq-err').textContent = '';
  document.getElementById('seq-modal').classList.add('show');
}

async function openEditSequence(type) {
  try {
    const r = await fetch('/api/super-admin/email-tracker/sequences/' + encodeURIComponent(type));
    const j = await r.json();
    const def = j.definition;
    if (!def) { alert('not found'); return; }
    document.getElementById('seq-modal-title').textContent = 'Edit: ' + def.name;
    document.getElementById('seq-type').value = def.sequence_type;
    document.getElementById('seq-type').disabled = true;
    document.getElementById('seq-name').value = def.name || '';
    document.getElementById('seq-desc').value = def.description || '';
    document.getElementById('seq-from').value = def.default_from || '';
    document.getElementById('seq-cat').value = def.default_category || 'customer';
    document.getElementById('seq-steps').value = JSON.stringify(def.steps || [], null, 2);
    document.getElementById('seq-err').textContent = '';
    document.getElementById('seq-modal').classList.add('show');
  } catch (e) { alert('Load failed: ' + (e?.message || e)); }
}

async function submitSequence() {
  let steps;
  try { steps = JSON.parse(document.getElementById('seq-steps').value); }
  catch (e) { document.getElementById('seq-err').textContent = 'steps JSON parse error: ' + e.message; return; }
  if (!Array.isArray(steps) || steps.length === 0) {
    document.getElementById('seq-err').textContent = 'steps must be a non-empty array';
    return;
  }
  const body = {
    sequence_type: document.getElementById('seq-type').value.trim(),
    name: document.getElementById('seq-name').value.trim(),
    description: document.getElementById('seq-desc').value.trim(),
    default_from: document.getElementById('seq-from').value.trim() || undefined,
    default_category: document.getElementById('seq-cat').value,
    steps,
  };
  if (!body.sequence_type || !body.name) {
    document.getElementById('seq-err').textContent = 'key + name required';
    return;
  }
  try {
    const r = await fetch('/api/super-admin/email-tracker/sequences', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!j.ok) { document.getElementById('seq-err').textContent = j.error || 'save failed'; return; }
    closeModal('seq-modal');
    loadDashboard();
  } catch (e) { document.getElementById('seq-err').textContent = e?.message || String(e); }
}

async function archiveSequence(type) {
  if (!confirm('Archive sequence "' + type + '"? Active enrollments will be cancelled.')) return;
  try {
    const r = await fetch('/api/super-admin/email-tracker/sequences/' + encodeURIComponent(type), { method: 'DELETE' });
    const j = await r.json();
    if (!j.ok) { alert('Archive failed: ' + (j.error || 'unknown')); return; }
    loadDashboard();
  } catch (e) { alert('Error: ' + (e?.message || e)); }
}

function closeModal(id) { document.getElementById(id).classList.remove('show'); }

function setLive(on) {
  LIVE = on;
  const btn = document.getElementById('pauseLive');
  btn.innerHTML = on ? '<i class="fas fa-pause"></i> Pause refresh' : '<i class="fas fa-play"></i> Resume refresh';
  document.getElementById('liveLabel').textContent = on ? 'live · auto-refresh 10s' : 'paused · click resume';
  if (on && !TIMER) TIMER = setInterval(loadDashboard, POLL_MS);
  if (!on && TIMER) { clearInterval(TIMER); TIMER = null; }
}

document.getElementById('pauseLive').addEventListener('click', () => setLive(!LIVE));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { document.querySelectorAll('.modal-bg.show').forEach(m => m.classList.remove('show')); } });

loadDashboard();
setLive(true);
</script>
</body>
</html>`
  return c.html(html)
})

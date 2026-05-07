// ============================================================
// Super Admin — Loop Tracker
// Mounted at /super-admin/loop-tracker (HTML) and
// /api/super-admin/loop-tracker/* (JSON). Superadmin only.
// Surfaces the runs/findings written by services/loop-scanner.ts.
// ============================================================

import { Hono } from 'hono'
import { validateAdminSession, requireSuperadmin } from './auth'
import { runScan, type ScanType } from '../services/loop-scanner'
import { pruneExpiredScanSessions } from '../services/synthetic-auth'

type Bindings = { DB: D1Database; [k: string]: any }

export const superAdminLoopTracker = new Hono<{ Bindings: Bindings }>()

superAdminLoopTracker.use('*', async (c, next) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) {
    if (c.req.path.includes('/api/')) return c.json({ error: 'superadmin required' }, 403)
    return c.redirect('/login?next=' + encodeURIComponent(c.req.path), 302)
  }
  ;(c as any).set('admin', admin)
  await next()
})

const VALID_TYPES: ScanType[] = ['public', 'customer', 'admin', 'health', 'reports']

// ── JSON: list runs ──────────────────────────────────────────
superAdminLoopTracker.get('/api/runs', async (c) => {
  const type = c.req.query('type')
  const limit = Math.min(Number(c.req.query('limit') || 50), 500)
  let q = `SELECT id, scan_type, status, started_at, finished_at, duration_ms, pages_checked, ok_count, fail_count, summary, triggered_by FROM loop_scan_runs`
  const binds: any[] = []
  if (type && VALID_TYPES.includes(type as ScanType)) {
    q += ` WHERE scan_type = ?`
    binds.push(type)
  }
  q += ` ORDER BY started_at DESC LIMIT ?`
  binds.push(limit)
  const rows = await c.env.DB.prepare(q).bind(...binds).all()
  return c.json({ rows: rows.results })
})

// ── JSON: single run + findings ──────────────────────────────
superAdminLoopTracker.get('/api/runs/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const run = await c.env.DB.prepare(`SELECT * FROM loop_scan_runs WHERE id = ?`).bind(id).first()
  if (!run) return c.json({ error: 'not found' }, 404)
  const findings = await c.env.DB.prepare(
    `SELECT id, severity, category, url, message, details_json, resolved_at, resolved_by, created_at
     FROM loop_scan_findings WHERE run_id = ? ORDER BY severity DESC, id ASC`
  ).bind(id).all()
  return c.json({ run, findings: findings.results })
})

// ── JSON: status summary (for nav badge) ─────────────────────
superAdminLoopTracker.get('/api/status', async (c) => {
  const types = await c.env.DB.prepare(`
    SELECT scan_type,
           (SELECT status FROM loop_scan_runs WHERE scan_type = lsr.scan_type ORDER BY started_at DESC LIMIT 1) as last_status,
           (SELECT started_at FROM loop_scan_runs WHERE scan_type = lsr.scan_type ORDER BY started_at DESC LIMIT 1) as last_run_at
    FROM (SELECT DISTINCT scan_type FROM loop_scan_runs) lsr
  `).all()
  const unresolved = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM loop_scan_findings WHERE resolved_at IS NULL AND severity = 'error'`
  ).first<{ n: number }>()
  return c.json({
    types: types.results,
    unresolved_errors: unresolved?.n || 0,
  })
})

// ── Manually trigger a scan ──────────────────────────────────
superAdminLoopTracker.post('/api/run-now/:type', async (c) => {
  const type = c.req.param('type') as ScanType
  if (!VALID_TYPES.includes(type)) return c.json({ error: 'invalid scan type' }, 400)
  const ctx = (c as any).executionCtx as ExecutionContext | undefined
  // Run in background — return immediately with 202.
  const promise = (async () => {
    try {
      await runScan(c.env, type, 'manual')
    } catch (e) { console.error('[loop-tracker] manual run failed', e) }
    finally { await pruneExpiredScanSessions(c.env) }
  })()
  if (ctx?.waitUntil) ctx.waitUntil(promise)
  return c.json({ accepted: true, scan_type: type }, 202)
})

// ── Mark a finding resolved ──────────────────────────────────
superAdminLoopTracker.post('/api/findings/:id/resolve', async (c) => {
  const id = Number(c.req.param('id'))
  const admin = (c as any).get('admin')
  await c.env.DB.prepare(
    `UPDATE loop_scan_findings SET resolved_at = datetime('now'), resolved_by = ? WHERE id = ?`
  ).bind(admin?.email || 'unknown', id).run()
  return c.json({ ok: true })
})

// ── HTML page ────────────────────────────────────────────────
superAdminLoopTracker.get('/', async (c) => {
  return c.html(renderLoopTrackerPage())
})

function renderLoopTrackerPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Loop Tracker — Roof Manager Super Admin</title>
<style>
  body { background:#0A0A0A; color:#E5E7EB; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; margin:0; }
  header { padding:16px 24px; border-bottom:1px solid #1F2937; display:flex; align-items:center; gap:24px; }
  main { max-width:1400px; margin:0 auto; padding:24px; }
  .card { background:#111827; border:1px solid #1F2937; border-radius:12px; padding:18px; }
  .grid4 { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:24px; }
  .num { font-variant-numeric:tabular-nums; }
  .pill { display:inline-block; padding:2px 10px; border-radius:9999px; font-size:11px; font-weight:600; }
  .pill-pass { background:#064E3B; color:#A7F3D0; }
  .pill-fail { background:#7F1D1D; color:#FECACA; }
  .pill-error { background:#7F1D1D; color:#FECACA; }
  .pill-running { background:#1E3A8A; color:#BFDBFE; }
  .sev-error { color:#F87171; font-weight:600; }
  .sev-warn { color:#FBBF24; }
  table { width:100%; border-collapse:collapse; }
  th { font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#9CA3AF; padding:10px 12px; text-align:left; border-bottom:1px solid #1F2937; }
  td { padding:10px 12px; border-bottom:1px solid #1F2937; font-size:13px; vertical-align:top; }
  tr.row { cursor:pointer; }
  tr.row:hover td { background:#1F2937; }
  .btn { background:#10B981; color:#0A0A0A; padding:6px 12px; border-radius:8px; font-weight:600; border:0; cursor:pointer; font-size:12px; }
  .btn-secondary { background:#1F2937; color:#E5E7EB; padding:6px 12px; border-radius:8px; border:0; cursor:pointer; font-size:12px; }
  select { background:#0F172A; color:#E5E7EB; border:1px solid #1F2937; border-radius:8px; padding:6px 10px; }
  .findings { background:#0F172A; border-top:1px solid #1F2937; padding:0 12px; }
  .finding-row { padding:10px 12px; border-bottom:1px solid #1F2937; display:grid; grid-template-columns:80px 130px 1fr 90px; gap:12px; align-items:center; font-size:12px; }
  .url-link { color:#60A5FA; text-decoration:none; }
  .url-link:hover { text-decoration:underline; }
  .ts { color:#6B7280; font-size:11px; }
</style>
</head>
<body>
<header>
  <a href="/super-admin" style="color:#FBBF24; font-weight:700; text-decoration:none;">👑 Super Admin</a>
  <span style="color:#6B7280;">/</span>
  <span style="color:#FFF; font-weight:600;">Loop Tracker</span>
  <span style="margin-left:auto; color:#6B7280; font-size:12px;" id="lastRefresh"></span>
</header>
<main>
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:18px;">
    <h1 style="font-size:22px;font-weight:700;margin:0;">Site Scanners &amp; Daily Health</h1>
    <button class="btn-secondary" onclick="loadAll()" style="margin-left:auto">↻ Refresh</button>
  </div>

  <div class="grid4" id="statusGrid"></div>

  <div class="card" style="padding:0;">
    <div style="display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid #1F2937;">
      <h3 style="font-size:14px;color:#9CA3AF;margin:0;">Recent runs</h3>
      <select id="typeFilter">
        <option value="">All scan types</option>
        <option value="public">Public surface</option>
        <option value="customer">Customer modules</option>
        <option value="admin">Super Admin modules</option>
        <option value="health">System health (daily)</option>
      </select>
    </div>
    <table>
      <thead>
        <tr>
          <th>When</th>
          <th>Type</th>
          <th>Status</th>
          <th class="num">Duration</th>
          <th class="num">Pages</th>
          <th class="num">Errors</th>
          <th>Summary</th>
          <th>Trigger</th>
        </tr>
      </thead>
      <tbody id="runsBody"></tbody>
    </table>
  </div>
</main>

<script>
const TYPES = [
  { key:'public',   label:'Public surface',       desc:'Landing, pricing, blog' },
  { key:'customer', label:'Customer modules',     desc:'Logged-in customer portal' },
  { key:'admin',    label:'Super Admin modules',  desc:'Logged-in admin pages' },
  { key:'reports',  label:'Report sweep',         desc:'Recent reports — broken diagrams, dup structures, stuck jobs' },
  { key:'health',   label:'System health',        desc:'Daily DB + secrets check' },
];

async function getJson(url, opts) {
  const res = await fetch(url, Object.assign({ credentials:'include' }, opts || {}));
  if (res.status === 403) { window.location.href = '/login?next=' + encodeURIComponent(location.pathname); return null; }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function fmtAgo(ts) {
  if (!ts) return '—';
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  const ms = Date.now() - d.getTime();
  if (ms < 0) return 'in future';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' h ago';
  return Math.floor(h / 24) + ' d ago';
}

function fmtMs(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

function statusPill(s) {
  if (!s) return '<span class="pill" style="background:#374151;color:#9CA3AF">—</span>';
  return '<span class="pill pill-' + s + '">' + s + '</span>';
}

async function loadStatus() {
  const data = await getJson('/api/super-admin/loop-tracker/api/status');
  if (!data) return;
  const byType = Object.fromEntries((data.types || []).map(t => [t.scan_type, t]));
  document.getElementById('statusGrid').innerHTML = TYPES.map(t => {
    const cur = byType[t.key] || {};
    return '<div class="card">' +
      '<div style="font-size:11px;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">' + t.label + '</div>' +
      '<div style="font-size:14px;color:#6B7280;margin-bottom:10px">' + t.desc + '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">' + statusPill(cur.last_status) + '<span class="ts">' + fmtAgo(cur.last_run_at) + '</span></div>' +
      '<button class="btn" onclick="runNow(\\''+t.key+'\\', this)">Run now</button>' +
    '</div>';
  }).join('');
  document.getElementById('lastRefresh').textContent = 'Refreshed ' + new Date().toLocaleTimeString() + ' · ' + (data.unresolved_errors || 0) + ' unresolved error(s)';
}

async function loadRuns() {
  const type = document.getElementById('typeFilter').value;
  const url = '/api/super-admin/loop-tracker/api/runs?limit=80' + (type ? '&type=' + type : '');
  const data = await getJson(url);
  if (!data) return;
  const body = document.getElementById('runsBody');
  if (!data.rows || data.rows.length === 0) {
    body.innerHTML = '<tr><td colspan="8" style="color:#6B7280;text-align:center;padding:40px">No runs yet. Click "Run now" on a scan above to seed history.</td></tr>';
    return;
  }
  body.innerHTML = data.rows.map(r =>
    '<tr class="row" onclick="toggleFindings(' + r.id + ')">' +
      '<td><div class="ts">' + fmtAgo(r.started_at) + '</div></td>' +
      '<td>' + r.scan_type + '</td>' +
      '<td>' + statusPill(r.status) + '</td>' +
      '<td class="num" style="text-align:right">' + fmtMs(r.duration_ms) + '</td>' +
      '<td class="num" style="text-align:right">' + (r.pages_checked || 0) + '</td>' +
      '<td class="num" style="text-align:right;' + (r.fail_count > 0 ? 'color:#F87171;font-weight:700' : '') + '">' + (r.fail_count || 0) + '</td>' +
      '<td>' + (r.summary || '') + '</td>' +
      '<td><span class="ts">' + (r.triggered_by || 'cron') + '</span></td>' +
    '</tr>' +
    '<tr id="findings-' + r.id + '" style="display:none"><td colspan="8" style="padding:0"><div class="findings" id="findings-body-' + r.id + '">Loading…</div></td></tr>'
  ).join('');
}

async function toggleFindings(runId) {
  const tr = document.getElementById('findings-' + runId);
  if (tr.style.display === 'table-row') { tr.style.display = 'none'; return; }
  tr.style.display = 'table-row';
  const body = document.getElementById('findings-body-' + runId);
  const data = await getJson('/api/super-admin/loop-tracker/api/runs/' + runId);
  if (!data || !data.findings || data.findings.length === 0) {
    body.innerHTML = '<div style="padding:20px;color:#6B7280">No findings — clean run.</div>';
    return;
  }
  body.innerHTML = data.findings.map(f =>
    '<div class="finding-row">' +
      '<span class="sev-' + f.severity + '">' + f.severity.toUpperCase() + '</span>' +
      '<span style="color:#9CA3AF">' + f.category + '</span>' +
      '<div>' + (f.url ? '<a class="url-link" href="' + escapeHtml(f.url) + '" target="_blank">' + escapeHtml(f.url) + '</a><br>' : '') + '<span>' + escapeHtml(f.message) + '</span></div>' +
      (f.resolved_at
        ? '<span class="ts">resolved · ' + escapeHtml(f.resolved_by || '') + '</span>'
        : '<button class="btn-secondary" onclick="resolveFinding(' + f.id + ', event)">Mark resolved</button>') +
    '</div>'
  ).join('');
}

async function resolveFinding(id, ev) {
  ev.stopPropagation();
  const btn = ev.target;
  btn.disabled = true; btn.textContent = '…';
  await getJson('/api/super-admin/loop-tracker/api/findings/' + id + '/resolve', { method:'POST' });
  btn.outerHTML = '<span class="ts">resolved</span>';
}

async function runNow(type, btn) {
  btn.disabled = true; const old = btn.textContent; btn.textContent = 'Running…';
  try {
    await getJson('/api/super-admin/loop-tracker/api/run-now/' + type, { method:'POST' });
    setTimeout(loadAll, 4000); // give the scan a moment to write its row
  } catch (e) { alert('Failed to start: ' + e.message); }
  setTimeout(() => { btn.disabled = false; btn.textContent = old; }, 5000);
}

function escapeHtml(s) { return String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]); }

function loadAll() { loadStatus(); loadRuns(); }
document.getElementById('typeFilter').addEventListener('change', loadRuns);
loadAll();
setInterval(loadStatus, 30000); // refresh status every 30s
</script>
</body>
</html>`
}

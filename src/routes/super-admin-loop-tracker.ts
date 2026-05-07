// ============================================================
// Super Admin — Loop Tracker
// Mounted at /super-admin/loop-tracker (HTML) and
// /api/super-admin/loop-tracker/* (JSON). Superadmin only.
//
// Unified dashboard for every recurring loop in the system:
//   - Cloudflare cron scans (scan_public/customer/admin/reports/health)
//   - Cloudflare cron agents (tracing, content, lead, email, monitor, traffic, attribution)
//   - Claude /loop slash commands (funnel_monitor, gmail_health, reports_monitor)
//   - Anthropic /schedule cloud routines (anything POSTing /api/.../routines/heartbeat)
//
// Backed by:
//   - loop_definitions: catalog of every known loop (seed + auto-discovered)
//   - loop_scan_runs: heavyweight per-execution rows (inputs/outputs/metrics/findings)
//   - loop_heartbeats: lightweight per-execution log for timeseries + staleness
//   - loop_scan_findings: unresolved-error inbox
// ============================================================

import { Hono } from 'hono'
import { validateAdminSession, requireSuperadmin } from './auth'
import { runScan, recordExternalRun, type ScanType, type RunSource } from '../services/loop-scanner'
import { pruneExpiredScanSessions } from '../services/synthetic-auth'

type Bindings = { DB: D1Database; [k: string]: any }

export const superAdminLoopTracker = new Hono<{ Bindings: Bindings }>()

const VALID_SCAN_TYPES: ScanType[] = ['public', 'customer', 'admin', 'health', 'reports']

// ── Cloud-routine heartbeat: bearer-token endpoint, not session-gated ──
// Anthropic-hosted /schedule routines POST here on each run. Auth is a
// shared bearer (CLOUD_ROUTINE_TOKEN, falls back to FUNNEL_MONITOR_TOKEN
// so the existing slash-command secret can be reused). This route is
// registered BEFORE the session middleware below so it doesn't redirect
// to /login — routines have no cookie.
superAdminLoopTracker.post('/api/routines/heartbeat', async (c) => {
  const expected = (c.env as any).CLOUD_ROUTINE_TOKEN || (c.env as any).FUNNEL_MONITOR_TOKEN
  if (!expected) return c.json({ error: 'CLOUD_ROUTINE_TOKEN not configured' }, 503)
  const auth = c.req.header('Authorization') || ''
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!presented || presented !== expected) return c.json({ error: 'unauthorized' }, 401)

  const body = await c.req.json().catch(() => ({})) as {
    loop_id?: string
    name?: string
    status?: 'pass' | 'fail' | 'error'
    summary?: string
    duration_ms?: number
    inputs?: any
    outputs?: any
    findings?: any[]
    routine_id?: string
    schedule_human?: string
  }

  if (!body.loop_id) return c.json({ error: 'loop_id required' }, 400)
  const status = (body.status || 'pass') as 'pass' | 'fail' | 'error'
  const result = await recordExternalRun(c.env, {
    loopId: body.loop_id,
    source: 'cloud_routine',
    status,
    summary: (body.summary || `cloud routine tick`).slice(0, 500),
    durationMs: body.duration_ms || 0,
    inputs: body.inputs,
    outputs: body.outputs,
    findings: Array.isArray(body.findings) ? body.findings.filter(f => f && f.message).map(f => ({
      severity: f.severity === 'error' ? 'error' : 'warn',
      category: String(f.category || 'cloud_routine').slice(0, 64),
      url: f.url,
      message: String(f.message).slice(0, 500),
      details: f.details,
    })) : undefined,
  })
  // First-seen routines: enrich the auto-stub with caller-supplied metadata.
  if (body.name || body.schedule_human || body.routine_id) {
    await c.env.DB.prepare(
      `UPDATE loop_definitions
          SET name = COALESCE(?, name),
              schedule_human = COALESCE(?, schedule_human),
              category = 'cloud_routine',
              source = 'cloud_routine',
              owner = 'anthropic',
              endpoint = COALESCE(?, endpoint)
        WHERE loop_id = ?`
    ).bind(body.name || null, body.schedule_human || null, body.routine_id || null, body.loop_id).run()
  }
  return c.json({ ok: true, run_id: result.runId })
})

// ── Session-gated routes ─────────────────────────────────────
superAdminLoopTracker.use('*', async (c, next) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) {
    if (c.req.path.includes('/api/')) return c.json({ error: 'superadmin required' }, 403)
    return c.redirect('/login?next=' + encodeURIComponent(c.req.path), 302)
  }
  ;(c as any).set('admin', admin)
  await next()
})

// ── JSON: full catalog with rollup ───────────────────────────
// One row per known loop with its definition + last-run + skew + 7d
// duration percentiles + staleness verdict. The dashboard's catalog
// table reads exclusively from this endpoint.
superAdminLoopTracker.get('/api/catalog', async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT
      d.loop_id, d.name, d.category, d.source, d.schedule_cron, d.schedule_human,
      d.expected_period_seconds, d.enabled, d.owner, d.endpoint, d.description, d.runbook_url,
      d.last_run_at, d.last_status, d.last_run_id,
      d.consecutive_failures, d.total_runs, d.total_failures,
      (SELECT AVG(duration_ms) FROM loop_heartbeats WHERE loop_id = d.loop_id AND ts > datetime('now','-7 days')) as avg_dur_7d,
      (SELECT MAX(duration_ms) FROM loop_heartbeats WHERE loop_id = d.loop_id AND ts > datetime('now','-7 days')) as max_dur_7d,
      (SELECT COUNT(*) FROM loop_heartbeats WHERE loop_id = d.loop_id AND ts > datetime('now','-24 hours')) as runs_24h,
      (SELECT COUNT(*) FROM loop_heartbeats WHERE loop_id = d.loop_id AND ts > datetime('now','-24 hours') AND status IN ('fail','error')) as fails_24h
    FROM loop_definitions d
    ORDER BY
      CASE d.category
        WHEN 'health' THEN 1
        WHEN 'site_scan' THEN 2
        WHEN 'monitor' THEN 3
        WHEN 'cron' THEN 4
        WHEN 'cloud_routine' THEN 5
        ELSE 6
      END,
      d.name
  `).all<any>()

  // Stale = no run in 1.5x its expected period. Computed server-side so
  // the client doesn't need timezone juggling.
  const now = Date.now()
  const enriched = (rows.results || []).map((r: any) => {
    const lastTs = r.last_run_at ? new Date(r.last_run_at.replace(' ', 'T') + 'Z').getTime() : 0
    const ageMs = lastTs > 0 ? now - lastTs : null
    const periodMs = (r.expected_period_seconds || 0) * 1000
    const stale = !!(periodMs > 0 && ageMs !== null && ageMs > periodMs * 1.5)
    const verdict = !lastTs ? 'never_run'
      : stale ? 'stale'
      : (r.last_status === 'fail' || r.last_status === 'error') ? 'failing'
      : (r.consecutive_failures > 0) ? 'failing'
      : 'healthy'
    return { ...r, age_ms: ageMs, stale, verdict }
  })
  return c.json({ loops: enriched, generated_at: new Date().toISOString() })
})

// ── JSON: 24h timeline heatmap ───────────────────────────────
// Returns, per loop, a flat array of bucketed counts so the client can
// paint a strip chart without a second round-trip per loop.
superAdminLoopTracker.get('/api/heatmap', async (c) => {
  const hours = Math.min(Number(c.req.query('hours') || 24), 168) // cap at 7d
  const buckets = Math.min(Number(c.req.query('buckets') || 48), 168) // default 30-min slices over 24h
  const since = new Date(Date.now() - hours * 60 * 60 * 1000)
  const sinceIso = since.toISOString().slice(0, 19).replace('T', ' ')
  const rows = await c.env.DB.prepare(`
    SELECT loop_id, ts, status, duration_ms
    FROM loop_heartbeats
    WHERE ts >= ?
    ORDER BY ts ASC
  `).bind(sinceIso).all<any>()
  const bucketMs = (hours * 60 * 60 * 1000) / buckets
  const startMs = since.getTime()
  const byLoop: Record<string, { pass: number; fail: number; total: number; avg: number }[]> = {}
  for (const r of (rows.results || [])) {
    const ts = new Date(r.ts.replace(' ', 'T') + 'Z').getTime()
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor((ts - startMs) / bucketMs)))
    if (!byLoop[r.loop_id]) byLoop[r.loop_id] = Array.from({ length: buckets }, () => ({ pass: 0, fail: 0, total: 0, avg: 0 }))
    const cell = byLoop[r.loop_id][idx]
    cell.total++
    if (r.status === 'pass') cell.pass++; else cell.fail++
    cell.avg += r.duration_ms || 0
  }
  // Normalize avg
  for (const k of Object.keys(byLoop)) {
    for (const c of byLoop[k]) if (c.total > 0) c.avg = Math.round(c.avg / c.total)
  }
  return c.json({ buckets, hours, bucket_ms: bucketMs, start_ms: startMs, by_loop: byLoop })
})

// ── JSON: list runs (filterable) ─────────────────────────────
superAdminLoopTracker.get('/api/runs', async (c) => {
  const loopId = c.req.query('loop_id')
  const scanType = c.req.query('type')
  const source = c.req.query('source')
  const status = c.req.query('status')
  const limit = Math.min(Number(c.req.query('limit') || 100), 500)
  const where: string[] = []
  const binds: any[] = []
  if (loopId) { where.push(`loop_id = ?`); binds.push(loopId) }
  if (scanType && VALID_SCAN_TYPES.includes(scanType as ScanType)) { where.push(`scan_type = ?`); binds.push(scanType) }
  if (source) { where.push(`source = ?`); binds.push(source) }
  if (status) { where.push(`status = ?`); binds.push(status) }
  const sql = `SELECT id, loop_id, scan_type, status, source, started_at, finished_at, duration_ms,
                      pages_checked, ok_count, fail_count, summary, triggered_by, expected_at, skew_ms
               FROM loop_scan_runs
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY started_at DESC
               LIMIT ?`
  binds.push(limit)
  const rows = await c.env.DB.prepare(sql).bind(...binds).all()
  return c.json({ rows: rows.results })
})

// ── JSON: single run + findings + metrics ────────────────────
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

// ── JSON: status summary (for nav badge + hero strip) ────────
superAdminLoopTracker.get('/api/status', async (c) => {
  const totals = await c.env.DB.prepare(`
    SELECT
      COUNT(*) as total_loops,
      SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled_loops,
      SUM(CASE WHEN consecutive_failures > 0 OR last_status IN ('fail','error') THEN 1 ELSE 0 END) as failing_loops
    FROM loop_definitions
  `).first<any>()
  const unresolved = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM loop_scan_findings WHERE resolved_at IS NULL AND severity = 'error'`
  ).first<{ n: number }>()
  // Stale loops — use the same 1.5x window as catalog
  const staleRows = await c.env.DB.prepare(`
    SELECT loop_id, last_run_at, expected_period_seconds
    FROM loop_definitions
    WHERE enabled = 1 AND expected_period_seconds > 0
  `).all<any>()
  const now = Date.now()
  let stale = 0
  for (const r of (staleRows.results || [])) {
    const lastTs = r.last_run_at ? new Date(r.last_run_at.replace(' ', 'T') + 'Z').getTime() : 0
    if (!lastTs) { stale++; continue }
    if (now - lastTs > r.expected_period_seconds * 1000 * 1.5) stale++
  }
  return c.json({
    total_loops: totals?.total_loops || 0,
    enabled_loops: totals?.enabled_loops || 0,
    failing_loops: totals?.failing_loops || 0,
    stale_loops: stale,
    unresolved_errors: unresolved?.n || 0,
  })
})

// ── JSON: findings inbox ─────────────────────────────────────
superAdminLoopTracker.get('/api/findings', async (c) => {
  const status = c.req.query('status') || 'unresolved'
  const category = c.req.query('category')
  const severity = c.req.query('severity')
  const loopId = c.req.query('loop_id')
  const limit = Math.min(Number(c.req.query('limit') || 100), 500)
  const where: string[] = []
  const binds: any[] = []
  if (status === 'unresolved') where.push(`f.resolved_at IS NULL`)
  else if (status === 'resolved') where.push(`f.resolved_at IS NOT NULL`)
  if (category) { where.push(`f.category = ?`); binds.push(category) }
  if (severity) { where.push(`f.severity = ?`); binds.push(severity) }
  if (loopId) { where.push(`r.loop_id = ?`); binds.push(loopId) }
  const sql = `SELECT f.id, f.severity, f.category, f.url, f.message, f.details_json,
                      f.resolved_at, f.resolved_by, f.created_at, f.run_id,
                      r.loop_id, r.scan_type, r.source
                 FROM loop_scan_findings f
                 JOIN loop_scan_runs r ON r.id = f.run_id
                ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                ORDER BY f.severity DESC, f.created_at DESC
                LIMIT ?`
  binds.push(limit)
  const rows = await c.env.DB.prepare(sql).bind(...binds).all()
  return c.json({ findings: rows.results })
})

// ── Manually trigger a scan ──────────────────────────────────
superAdminLoopTracker.post('/api/run-now/:type', async (c) => {
  const type = c.req.param('type') as ScanType
  if (!VALID_SCAN_TYPES.includes(type)) return c.json({ error: 'invalid scan type' }, 400)
  const ctx = (c as any).executionCtx as ExecutionContext | undefined
  const promise = (async () => {
    try { await runScan(c.env, type, 'manual', { source: 'manual' }) }
    catch (e) { console.error('[loop-tracker] manual run failed', e) }
    finally { await pruneExpiredScanSessions(c.env) }
  })()
  if (ctx?.waitUntil) ctx.waitUntil(promise)
  return c.json({ accepted: true, scan_type: type }, 202)
})

// ── Toggle a loop enabled/disabled ───────────────────────────
superAdminLoopTracker.post('/api/loops/:loop_id/toggle', async (c) => {
  const loopId = c.req.param('loop_id')
  const body = await c.req.json().catch(() => ({})) as { enabled?: boolean }
  const enabled = body.enabled ? 1 : 0
  await c.env.DB.prepare(`UPDATE loop_definitions SET enabled = ?, updated_at = datetime('now') WHERE loop_id = ?`)
    .bind(enabled, loopId).run()
  // Mirror to agent_configs for the cron-worker gate (where applicable).
  await c.env.DB.prepare(`UPDATE agent_configs SET enabled = ?, updated_at = datetime('now') WHERE agent_type = ?`)
    .bind(enabled, loopId).run()
  return c.json({ ok: true, loop_id: loopId, enabled: !!enabled })
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

// ── Bulk resolve findings ────────────────────────────────────
superAdminLoopTracker.post('/api/findings/bulk-resolve', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { ids?: number[] }
  if (!Array.isArray(body.ids) || body.ids.length === 0) return c.json({ ok: false, error: 'ids required' }, 400)
  const admin = (c as any).get('admin')
  const placeholders = body.ids.map(() => '?').join(',')
  await c.env.DB.prepare(
    `UPDATE loop_scan_findings SET resolved_at = datetime('now'), resolved_by = ? WHERE id IN (${placeholders})`
  ).bind(admin?.email || 'unknown', ...body.ids).run()
  return c.json({ ok: true, resolved: body.ids.length })
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
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<style>
  :root {
    --bg: #0A0A0A;
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
    --fail: #F87171;
    --fail-bg: #7F1D1D;
    --fail-fg: #FECACA;
    --warn: #FBBF24;
    --warn-bg: #78350F;
    --warn-fg: #FDE68A;
    --info: #60A5FA;
    --info-bg: #1E3A8A;
    --info-fg: #BFDBFE;
    --stale: #A78BFA;
    --stale-bg: #4C1D95;
    --stale-fg: #DDD6FE;
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
  .mono { font-family: 'SF Mono', 'Monaco', 'Consolas', monospace; font-size:11px; }

  /* Hero KPI strip */
  .hero { display:grid; grid-template-columns:repeat(5,1fr); gap:12px; margin-bottom:20px; }
  .kpi { background:var(--bg-card); border:1px solid var(--border); border-radius:10px; padding:14px 16px; }
  .kpi .label { font-size:10px; text-transform:uppercase; letter-spacing:0.07em; color:var(--text-dim); margin-bottom:6px; }
  .kpi .v { font-size:28px; font-weight:700; line-height:1; color:var(--text); }
  .kpi.healthy .v { color:var(--pass); }
  .kpi.failing .v { color:var(--fail); }
  .kpi.stale .v { color:var(--stale); }
  .kpi.findings .v { color:var(--warn); }

  /* Section blocks */
  section { margin-bottom:28px; }
  section > h2 { font-size:13px; font-weight:700; text-transform:uppercase; letter-spacing:0.08em; color:var(--text-dim); margin:0 0 10px; display:flex; align-items:center; gap:10px; }
  section > h2 .count { background:var(--bg-card-hi); color:var(--text); padding:2px 8px; border-radius:9999px; font-size:10px; }

  /* Pills */
  .pill { display:inline-block; padding:2px 9px; border-radius:9999px; font-size:10px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; }
  .pill-pass { background:var(--pass-bg); color:var(--pass-fg); }
  .pill-fail { background:var(--fail-bg); color:var(--fail-fg); }
  .pill-error { background:var(--fail-bg); color:var(--fail-fg); }
  .pill-warn { background:var(--warn-bg); color:var(--warn-fg); }
  .pill-running { background:var(--info-bg); color:var(--info-fg); }
  .pill-stale { background:var(--stale-bg); color:var(--stale-fg); }
  .pill-healthy { background:var(--pass-bg); color:var(--pass-fg); }
  .pill-failing { background:var(--fail-bg); color:var(--fail-fg); }
  .pill-never_run { background:var(--bg-card-hi); color:var(--text-mute); }
  .pill-disabled { background:var(--bg-card-hi); color:var(--text-mute); }

  /* Heatmap */
  .heat-table { width:100%; border-collapse:separate; border-spacing:0; font-size:11px; }
  .heat-table th, .heat-table td { padding:3px 6px; }
  .heat-table .heat-row td.label { white-space:nowrap; color:var(--text-dim); padding-right:10px; }
  .heat-table .cell { display:inline-block; width:14px; height:14px; border-radius:3px; margin:1px; vertical-align:middle; }
  .heat-table .cell.empty { background:var(--bg-card-hi); }
  .heat-table .cell.pass { background:var(--pass); }
  .heat-table .cell.partial { background:linear-gradient(135deg,var(--pass) 50%,var(--fail) 50%); }
  .heat-table .cell.fail { background:var(--fail); }
  .heat-axis { color:var(--text-mute); font-size:10px; padding-top:4px; display:flex; justify-content:space-between; padding-left:160px; }

  /* Tables */
  table.data { width:100%; border-collapse:collapse; }
  table.data th { font-size:10px; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-dim); padding:9px 10px; text-align:left; border-bottom:1px solid var(--border); background:var(--bg-card); }
  table.data td { padding:9px 10px; border-bottom:1px solid var(--border); font-size:12.5px; vertical-align:middle; }
  table.data tr:hover td { background:var(--bg-card-hi); }
  table.data tr.row { cursor:pointer; }

  /* Buttons / inputs */
  .btn { background:var(--accent); color:var(--bg); padding:6px 12px; border-radius:8px; font-weight:700; border:0; cursor:pointer; font-size:11px; }
  .btn:disabled { opacity:0.5; cursor:not-allowed; }
  .btn-sm { padding:4px 10px; font-size:10px; }
  .btn-secondary { background:var(--bg-card-hi); color:var(--text); padding:6px 12px; border-radius:8px; border:1px solid var(--border-hi); cursor:pointer; font-size:11px; font-weight:600; }
  .btn-secondary:hover { background:var(--border-hi); }
  .btn-danger { background:var(--fail-bg); color:var(--fail-fg); }
  select, input[type=text] { background:var(--bg-input); color:var(--text); border:1px solid var(--border); border-radius:8px; padding:6px 10px; font-size:12px; }
  .toggle { display:inline-flex; align-items:center; gap:6px; cursor:pointer; user-select:none; }
  .toggle input { position:absolute; opacity:0; pointer-events:none; }
  .toggle .track { width:30px; height:18px; background:var(--bg-card-hi); border-radius:9999px; position:relative; transition:0.15s; }
  .toggle .track::after { content:''; position:absolute; left:2px; top:2px; width:14px; height:14px; background:var(--text); border-radius:50%; transition:0.15s; }
  .toggle input:checked + .track { background:var(--pass); }
  .toggle input:checked + .track::after { left:14px; background:var(--bg); }

  /* Drill-down panel */
  .findings-panel { background:var(--bg-input); border-top:1px solid var(--border); padding:0 12px; }
  .finding-row { padding:9px 12px; border-bottom:1px solid var(--border); display:grid; grid-template-columns:70px 130px 1fr 90px; gap:10px; align-items:center; font-size:12px; }
  .finding-row:last-child { border-bottom:0; }
  .sev-error { color:var(--fail); font-weight:700; }
  .sev-warn { color:var(--warn); font-weight:600; }
  .ts { color:var(--text-mute); font-size:11px; }

  .metrics-block { padding:14px; background:var(--bg-input); border-top:1px solid var(--border); font-size:11px; color:var(--text-dim); }
  .metrics-block pre { background:var(--bg); border:1px solid var(--border); border-radius:6px; padding:10px; overflow-x:auto; max-height:200px; }
  .waterfall { display:grid; grid-template-columns:80px 1fr 60px 70px; gap:8px; padding:4px 0; font-size:11px; }
  .waterfall .bar { background:var(--info); height:14px; border-radius:2px; }
  .waterfall.fail .bar { background:var(--fail); }

  .filter-row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:12px; }
  .filter-row .spacer { flex:1; }
  .err-banner { padding:10px 14px; background:var(--fail-bg); color:var(--fail-fg); border-radius:8px; font-size:12px; margin-bottom:14px; display:none; }
  .empty { color:var(--text-mute); text-align:center; padding:40px 20px; font-size:12px; }
  .skew-warn { color:var(--warn); }
  .skew-bad { color:var(--fail); }
  details summary { cursor:pointer; user-select:none; }
  details summary::-webkit-details-marker { display:none; }
</style>
</head>
<body>
<header class="bar">
  <a href="/super-admin" class="breadcrumb"><i class="fas fa-crown"></i> Super Admin</a>
  <span style="color:var(--text-mute);">/</span>
  <h1><i class="fas fa-radar" style="color:var(--accent);margin-right:6px"></i>Loop Tracker</h1>
  <span style="margin-left:auto; color:var(--text-mute); font-size:11px;" id="lastRefresh"></span>
  <button class="btn-secondary" onclick="loadAll()" title="Reload data"><i class="fas fa-rotate"></i></button>
</header>
<main>
  <div class="err-banner" id="errBanner"></div>

  <!-- Hero KPI strip -->
  <div class="hero" id="hero">
    <div class="kpi"><div class="label">Total loops</div><div class="v" id="kpiTotal">—</div></div>
    <div class="kpi healthy"><div class="label">Healthy now</div><div class="v" id="kpiHealthy">—</div></div>
    <div class="kpi failing"><div class="label">Failing</div><div class="v" id="kpiFailing">—</div></div>
    <div class="kpi stale"><div class="label">Stale</div><div class="v" id="kpiStale">—</div></div>
    <div class="kpi findings"><div class="label">Unresolved errors</div><div class="v" id="kpiFindings">—</div></div>
  </div>

  <!-- 24h heatmap -->
  <section>
    <h2>24h timeline <span class="count" id="heatCount">—</span></h2>
    <div class="card" id="heatmapCard"><div class="empty">Loading…</div></div>
  </section>

  <!-- Loop catalog -->
  <section>
    <h2>Catalog <span class="count" id="catCount">—</span></h2>
    <div class="card" style="padding:0;">
      <table class="data" id="catTable">
        <thead><tr>
          <th style="width:24px"></th>
          <th>Loop</th>
          <th>Schedule</th>
          <th>Source</th>
          <th>Last run</th>
          <th>Skew</th>
          <th class="num">p50 / p95</th>
          <th class="num">24h</th>
          <th>Streak</th>
          <th>Status</th>
          <th></th>
        </tr></thead>
        <tbody id="catBody"></tbody>
      </table>
    </div>
  </section>

  <!-- Recent runs -->
  <section>
    <h2>Recent runs <span class="count" id="runsCount">—</span></h2>
    <div class="filter-row">
      <select id="runsLoopFilter"><option value="">All loops</option></select>
      <select id="runsStatusFilter">
        <option value="">Any status</option>
        <option value="pass">Pass</option>
        <option value="fail">Fail</option>
        <option value="error">Error</option>
        <option value="running">Running</option>
      </select>
      <select id="runsSourceFilter">
        <option value="">Any source</option>
        <option value="cf_cron">Cloudflare cron</option>
        <option value="claude_loop">Claude /loop</option>
        <option value="cloud_routine">Cloud routine</option>
        <option value="manual">Manual</option>
        <option value="inline">Inline</option>
      </select>
      <span class="spacer"></span>
      <span class="ts" id="runsLimitInfo">last 100</span>
    </div>
    <div class="card" style="padding:0;">
      <table class="data" id="runsTable">
        <thead><tr>
          <th>When</th>
          <th>Loop</th>
          <th>Status</th>
          <th class="num">Duration</th>
          <th class="num">Skew</th>
          <th class="num">Pages</th>
          <th class="num">Errors</th>
          <th>Source</th>
          <th>Summary</th>
        </tr></thead>
        <tbody id="runsBody"></tbody>
      </table>
    </div>
  </section>

  <!-- Findings inbox -->
  <section>
    <h2>Findings inbox <span class="count" id="findCount">—</span></h2>
    <div class="filter-row">
      <select id="findStatusFilter">
        <option value="unresolved" selected>Unresolved</option>
        <option value="resolved">Resolved</option>
        <option value="">All</option>
      </select>
      <select id="findSeverityFilter">
        <option value="">Any severity</option>
        <option value="error">Error</option>
        <option value="warn">Warn</option>
      </select>
      <select id="findCatFilter">
        <option value="">Any category</option>
      </select>
      <span class="spacer"></span>
      <button class="btn-secondary" id="bulkResolveBtn" disabled onclick="bulkResolve()">Resolve selected</button>
    </div>
    <div class="card" style="padding:0;">
      <table class="data" id="findTable">
        <thead><tr>
          <th style="width:24px"><input type="checkbox" id="findCheckAll"></th>
          <th>When</th>
          <th>Loop</th>
          <th>Severity</th>
          <th>Category</th>
          <th>Where</th>
          <th>Message</th>
          <th></th>
        </tr></thead>
        <tbody id="findBody"></tbody>
      </table>
    </div>
  </section>
</main>

<script>
// ────────────────────────────────────────────────────────────
// State + helpers
// ────────────────────────────────────────────────────────────
let CATALOG = [];

async function getJson(url, opts) {
  try {
    const res = await fetch(url, Object.assign({ credentials:'include' }, opts || {}));
    if (res.status === 403) { window.location.href = '/login?next=' + encodeURIComponent(location.pathname); return null; }
    if (!res.ok) throw new Error('HTTP ' + res.status + ' on ' + url);
    return await res.json();
  } catch (e) { showErr(e.message); return null; }
}
function showErr(msg) {
  const b = document.getElementById('errBanner');
  b.textContent = '⚠ ' + msg; b.style.display = 'block';
  setTimeout(() => { b.style.display = 'none'; }, 6000);
}
function fmtAgo(ts) {
  if (!ts) return '—';
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  const ms = Date.now() - d.getTime();
  if (ms < 0) return 'in future';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const days = Math.floor(h / 24);
  return days + 'd ago';
}
function fmtMs(ms) {
  if (ms == null || ms === undefined) return '—';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  return (ms / 60000).toFixed(1) + 'm';
}
function fmtSkew(ms) {
  if (ms == null) return '—';
  const abs = Math.abs(ms);
  let cls = '';
  if (abs > 60000) cls = 'skew-bad';
  else if (abs > 10000) cls = 'skew-warn';
  return '<span class="' + cls + '">' + (ms >= 0 ? '+' : '') + fmtMs(ms) + '</span>';
}
function statusPill(s) {
  if (!s) return '<span class="pill pill-never_run">—</span>';
  return '<span class="pill pill-' + s + '">' + s + '</span>';
}
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]); }

// ────────────────────────────────────────────────────────────
// Hero strip
// ────────────────────────────────────────────────────────────
async function loadStatus() {
  const data = await getJson('/api/super-admin/loop-tracker/api/status');
  if (!data) return;
  document.getElementById('kpiTotal').textContent = data.total_loops;
  document.getElementById('kpiHealthy').textContent = (data.enabled_loops - data.failing_loops - data.stale_loops);
  document.getElementById('kpiFailing').textContent = data.failing_loops;
  document.getElementById('kpiStale').textContent = data.stale_loops;
  document.getElementById('kpiFindings').textContent = data.unresolved_errors;
  document.getElementById('lastRefresh').textContent = 'Refreshed ' + new Date().toLocaleTimeString();
}

// ────────────────────────────────────────────────────────────
// Heatmap (24h, 30-min buckets)
// ────────────────────────────────────────────────────────────
async function loadHeatmap() {
  const data = await getJson('/api/super-admin/loop-tracker/api/heatmap?hours=24&buckets=48');
  if (!data) return;
  const loopIds = Object.keys(data.by_loop || {});
  document.getElementById('heatCount').textContent = loopIds.length + ' active';
  const card = document.getElementById('heatmapCard');
  if (loopIds.length === 0) {
    card.innerHTML = '<div class="empty">No heartbeats in the last 24h. Once cron fires or you trigger a Run-now, this strip lights up.</div>';
    return;
  }
  loopIds.sort();
  const rows = loopIds.map(loopId => {
    const cells = (data.by_loop[loopId] || []).map(c => {
      let cls = 'empty';
      if (c.total > 0) {
        if (c.fail === 0) cls = 'pass';
        else if (c.pass === 0) cls = 'fail';
        else cls = 'partial';
      }
      const tip = c.total === 0 ? '' : (c.total + ' run(s) · ' + c.pass + ' pass / ' + c.fail + ' fail · avg ' + fmtMs(c.avg));
      return '<span class="cell ' + cls + '" title="' + escapeHtml(tip) + '"></span>';
    }).join('');
    return '<tr class="heat-row"><td class="label mono">' + escapeHtml(loopId) + '</td><td>' + cells + '</td></tr>';
  }).join('');
  const now = new Date();
  card.innerHTML = '<table class="heat-table"><tbody>' + rows + '</tbody></table>' +
    '<div class="heat-axis"><span>24h ago</span><span>12h</span><span>now (' + now.toLocaleTimeString().slice(0,5) + ')</span></div>';
}

// ────────────────────────────────────────────────────────────
// Catalog
// ────────────────────────────────────────────────────────────
async function loadCatalog() {
  const data = await getJson('/api/super-admin/loop-tracker/api/catalog');
  if (!data) return;
  CATALOG = data.loops || [];
  document.getElementById('catCount').textContent = CATALOG.length;
  // Populate the runs filter dropdown with every loop in the catalog
  const f = document.getElementById('runsLoopFilter');
  const cur = f.value;
  f.innerHTML = '<option value="">All loops</option>' + CATALOG.map(l => '<option value="' + escapeHtml(l.loop_id) + '">' + escapeHtml(l.name || l.loop_id) + '</option>').join('');
  f.value = cur;
  document.getElementById('catBody').innerHTML = CATALOG.map(catRow).join('');
}
function catRow(l) {
  const verdictPill = l.verdict === 'healthy' ? '<span class="pill pill-healthy">healthy</span>'
                    : l.verdict === 'failing' ? '<span class="pill pill-failing">failing</span>'
                    : l.verdict === 'stale'   ? '<span class="pill pill-stale">stale</span>'
                    : '<span class="pill pill-never_run">never run</span>';
  const enabledToggle = '<label class="toggle" title="Enable / disable this loop"><input type="checkbox" ' + (l.enabled ? 'checked' : '') + ' onchange="toggleLoop(\\'' + l.loop_id + '\\', this.checked)"><span class="track"></span></label>';
  const runNowBtn = (l.source === 'cf_cron' && (l.loop_id.startsWith('scan_'))) ? '<button class="btn btn-sm" onclick="runNow(\\'' + l.loop_id.replace('scan_', '') + '\\', this, event)">Run now</button>' : '';
  const dur = l.avg_dur_7d != null ? (Math.round(l.avg_dur_7d) + 'ms / ' + Math.round(l.max_dur_7d || 0) + 'ms') : '—';
  const streak = l.consecutive_failures > 0 ? '<span class="sev-error">✗' + l.consecutive_failures + '</span>' : '<span class="sev-warn" style="color:var(--text-mute)">—</span>';
  const fails24h = l.fails_24h > 0 ? ' <span class="sev-error">·' + l.fails_24h + '</span>' : '';
  return '<tr>' +
    '<td>' + enabledToggle + '</td>' +
    '<td><div style="font-weight:600">' + escapeHtml(l.name || l.loop_id) + '</div><div class="ts mono">' + escapeHtml(l.loop_id) + '</div></td>' +
    '<td><div class="ts">' + escapeHtml(l.schedule_human || '—') + '</div>' + (l.schedule_cron ? '<div class="ts mono">' + escapeHtml(l.schedule_cron) + '</div>' : '') + '</td>' +
    '<td><span class="ts">' + escapeHtml(l.source || '—') + '</span></td>' +
    '<td>' + statusPill(l.last_status) + ' <span class="ts">' + fmtAgo(l.last_run_at) + '</span></td>' +
    '<td class="num">' + (l.last_run_id ? '<a href="#run-' + l.last_run_id + '" onclick="openRunInline(' + l.last_run_id + ');return false;">' + (l.last_status || 'run') + ' #' + l.last_run_id + '</a>' : '—') + '</td>' +
    '<td class="num ts">' + dur + '</td>' +
    '<td class="num">' + (l.runs_24h || 0) + fails24h + '</td>' +
    '<td>' + streak + '</td>' +
    '<td>' + verdictPill + '</td>' +
    '<td>' + runNowBtn + '</td>' +
  '</tr>';
}

async function toggleLoop(loopId, enabled) {
  const r = await getJson('/api/super-admin/loop-tracker/api/loops/' + encodeURIComponent(loopId) + '/toggle', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ enabled }),
  });
  if (r && r.ok) { loadCatalog(); loadStatus(); }
}

async function runNow(scanType, btn, ev) {
  if (ev) ev.stopPropagation();
  btn.disabled = true; const old = btn.textContent; btn.textContent = '…';
  try {
    await getJson('/api/super-admin/loop-tracker/api/run-now/' + encodeURIComponent(scanType), { method:'POST' });
    setTimeout(loadAll, 4500);
  } catch (e) { showErr('Run-now failed: ' + e.message); }
  setTimeout(() => { btn.disabled = false; btn.textContent = old; }, 5500);
}

// ────────────────────────────────────────────────────────────
// Recent runs table + drill-down
// ────────────────────────────────────────────────────────────
async function loadRuns() {
  const loopId = document.getElementById('runsLoopFilter').value;
  const status = document.getElementById('runsStatusFilter').value;
  const source = document.getElementById('runsSourceFilter').value;
  const params = new URLSearchParams({ limit: '100' });
  if (loopId) params.set('loop_id', loopId);
  if (status) params.set('status', status);
  if (source) params.set('source', source);
  const data = await getJson('/api/super-admin/loop-tracker/api/runs?' + params.toString());
  if (!data) return;
  document.getElementById('runsCount').textContent = (data.rows || []).length;
  const body = document.getElementById('runsBody');
  if (!data.rows || data.rows.length === 0) {
    body.innerHTML = '<tr><td colspan="9" class="empty">No runs yet for this filter.</td></tr>';
    return;
  }
  body.innerHTML = data.rows.map(r =>
    '<tr class="row" onclick="toggleRun(' + r.id + ')" id="run-row-' + r.id + '">' +
      '<td><div class="ts">' + fmtAgo(r.started_at) + '</div></td>' +
      '<td><span class="mono">' + escapeHtml(r.loop_id || ('scan_' + r.scan_type)) + '</span></td>' +
      '<td>' + statusPill(r.status) + '</td>' +
      '<td class="num">' + fmtMs(r.duration_ms) + '</td>' +
      '<td class="num">' + fmtSkew(r.skew_ms) + '</td>' +
      '<td class="num">' + (r.pages_checked || 0) + '</td>' +
      '<td class="num" style="' + (r.fail_count > 0 ? 'color:var(--fail);font-weight:700' : '') + '">' + (r.fail_count || 0) + '</td>' +
      '<td><span class="ts">' + escapeHtml(r.source || r.triggered_by || '—') + '</span></td>' +
      '<td>' + escapeHtml(r.summary || '') + '</td>' +
    '</tr>' +
    '<tr id="findings-' + r.id + '" style="display:none"><td colspan="9" style="padding:0"><div id="findings-body-' + r.id + '">Loading…</div></td></tr>'
  ).join('');
}

async function toggleRun(runId) {
  const tr = document.getElementById('findings-' + runId);
  if (tr.style.display === 'table-row') { tr.style.display = 'none'; return; }
  tr.style.display = 'table-row';
  const body = document.getElementById('findings-body-' + runId);
  const data = await getJson('/api/super-admin/loop-tracker/api/runs/' + runId);
  if (!data) { body.innerHTML = '<div class="empty">Failed to load</div>'; return; }
  const run = data.run || {};
  const findings = data.findings || [];
  let metrics = null; try { metrics = run.metrics_json ? JSON.parse(run.metrics_json) : null; } catch {}
  let inputs = null; try { inputs = run.inputs_json ? JSON.parse(run.inputs_json) : null; } catch {}
  let outputs = null; try { outputs = run.outputs_json ? JSON.parse(run.outputs_json) : null; } catch {}

  const findingsHtml = findings.length === 0
    ? '<div class="empty">No findings — clean run.</div>'
    : '<div class="findings-panel">' + findings.map(f =>
        '<div class="finding-row">' +
          '<span class="sev-' + f.severity + '">' + f.severity.toUpperCase() + '</span>' +
          '<span class="ts">' + escapeHtml(f.category) + '</span>' +
          '<div>' + (f.url ? '<a href="' + escapeHtml(f.url) + '" target="_blank">' + escapeHtml(f.url) + '</a><br>' : '') + escapeHtml(f.message) + '</div>' +
          (f.resolved_at
            ? '<span class="ts">resolved</span>'
            : '<button class="btn-secondary btn-sm" onclick="resolveFinding(' + f.id + ', event)">Mark resolved</button>') +
        '</div>'
      ).join('') + '</div>';

  let waterfallHtml = '';
  if (metrics && Array.isArray(metrics.probes) && metrics.probes.length > 0) {
    const max = Math.max(...metrics.probes.map(p => p.durationMs || 0)) || 1;
    waterfallHtml = '<div style="padding:14px"><div class="ts" style="margin-bottom:8px">Probe waterfall (' + metrics.probes.length + ')</div>' +
      metrics.probes.map(p => {
        const w = Math.max(2, Math.round((p.durationMs / max) * 100));
        return '<div class="waterfall ' + (p.ok ? '' : 'fail') + '">' +
          '<span class="ts">' + escapeHtml(p.kind) + '</span>' +
          '<div><div class="bar" style="width:' + w + '%"></div></div>' +
          '<span class="num ts">' + fmtMs(p.durationMs) + '</span>' +
          '<span class="ts">' + (p.status || (p.ok ? 'ok' : 'err')) + '</span>' +
        '</div>';
      }).join('') + '</div>';
  }

  const rollupHtml = metrics && metrics.rollup
    ? '<div class="metrics-block"><strong>Rollup:</strong> ' + metrics.rollup.ok + ' ok / ' + metrics.rollup.fail + ' fail · ' + Object.entries(metrics.rollup.by_kind || {}).map(([k,v]) => k + ' p50=' + v.p50 + 'ms p95=' + v.p95 + 'ms').join(' · ') + '</div>'
    : '';

  const ioHtml = (inputs || outputs)
    ? '<details><summary class="ts" style="padding:10px 14px">Inputs / outputs (click to expand)</summary><div class="metrics-block">' +
        (inputs ? '<div class="ts" style="margin-bottom:4px">Inputs:</div><pre>' + escapeHtml(JSON.stringify(inputs, null, 2)) + '</pre>' : '') +
        (outputs ? '<div class="ts" style="margin:8px 0 4px">Outputs:</div><pre>' + escapeHtml(JSON.stringify(outputs, null, 2)) + '</pre>' : '') +
      '</div></details>'
    : '';

  body.innerHTML = findingsHtml + rollupHtml + waterfallHtml + ioHtml;
}

function openRunInline(runId) {
  const row = document.getElementById('run-row-' + runId);
  if (row) { row.scrollIntoView({ behavior:'smooth', block:'center' }); toggleRun(runId); }
  else showErr('That run is not in the visible list — clear filters and try again.');
}

async function resolveFinding(id, ev) {
  ev.stopPropagation();
  const btn = ev.target;
  btn.disabled = true; btn.textContent = '…';
  await getJson('/api/super-admin/loop-tracker/api/findings/' + id + '/resolve', { method:'POST' });
  btn.outerHTML = '<span class="ts">resolved</span>';
  loadStatus(); loadFindings();
}

// ────────────────────────────────────────────────────────────
// Findings inbox
// ────────────────────────────────────────────────────────────
async function loadFindings() {
  const status = document.getElementById('findStatusFilter').value;
  const severity = document.getElementById('findSeverityFilter').value;
  const category = document.getElementById('findCatFilter').value;
  const params = new URLSearchParams({ limit: '200' });
  if (status) params.set('status', status);
  if (severity) params.set('severity', severity);
  if (category) params.set('category', category);
  const data = await getJson('/api/super-admin/loop-tracker/api/findings?' + params.toString());
  if (!data) return;
  const findings = data.findings || [];
  document.getElementById('findCount').textContent = findings.length;
  // Populate category filter on first load
  const catSel = document.getElementById('findCatFilter');
  if (catSel.options.length <= 1) {
    const cats = Array.from(new Set(findings.map(f => f.category))).sort();
    catSel.innerHTML = '<option value="">Any category</option>' + cats.map(c => '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>').join('');
  }
  const body = document.getElementById('findBody');
  if (findings.length === 0) {
    body.innerHTML = '<tr><td colspan="8" class="empty">No findings match these filters.</td></tr>';
    return;
  }
  body.innerHTML = findings.map(f =>
    '<tr>' +
      '<td>' + (f.resolved_at ? '' : '<input type="checkbox" class="find-chk" data-id="' + f.id + '">') + '</td>' +
      '<td><span class="ts">' + fmtAgo(f.created_at) + '</span></td>' +
      '<td><span class="mono ts">' + escapeHtml(f.loop_id || ('scan_' + f.scan_type)) + '</span></td>' +
      '<td><span class="sev-' + f.severity + '">' + f.severity.toUpperCase() + '</span></td>' +
      '<td><span class="ts">' + escapeHtml(f.category) + '</span></td>' +
      '<td>' + (f.url ? '<a href="' + escapeHtml(f.url) + '" target="_blank">' + escapeHtml(f.url) + '</a>' : '<span class="ts">—</span>') + '</td>' +
      '<td>' + escapeHtml((f.message || '').slice(0, 200)) + '</td>' +
      '<td>' + (f.resolved_at
        ? '<span class="ts">resolved · ' + escapeHtml(f.resolved_by || '') + '</span>'
        : '<button class="btn-secondary btn-sm" onclick="resolveFinding(' + f.id + ', event)">Resolve</button>') + '</td>' +
    '</tr>'
  ).join('');
  document.querySelectorAll('.find-chk').forEach(c => c.addEventListener('change', updateBulk));
  updateBulk();
}

function updateBulk() {
  const checked = document.querySelectorAll('.find-chk:checked').length;
  const btn = document.getElementById('bulkResolveBtn');
  btn.disabled = checked === 0;
  btn.textContent = checked === 0 ? 'Resolve selected' : 'Resolve ' + checked + ' selected';
}

async function bulkResolve() {
  const ids = Array.from(document.querySelectorAll('.find-chk:checked')).map(c => Number(c.dataset.id));
  if (ids.length === 0) return;
  await getJson('/api/super-admin/loop-tracker/api/findings/bulk-resolve', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ids }),
  });
  loadStatus(); loadFindings();
}

document.getElementById('findCheckAll').addEventListener('change', e => {
  document.querySelectorAll('.find-chk').forEach(c => { c.checked = e.target.checked; });
  updateBulk();
});
['runsLoopFilter','runsStatusFilter','runsSourceFilter'].forEach(id => document.getElementById(id).addEventListener('change', loadRuns));
['findStatusFilter','findSeverityFilter','findCatFilter'].forEach(id => document.getElementById(id).addEventListener('change', loadFindings));

function loadAll() {
  loadStatus();
  loadHeatmap();
  loadCatalog();
  loadRuns();
  loadFindings();
}
loadAll();
setInterval(loadStatus, 30000);
setInterval(loadHeatmap, 60000);
</script>
</body>
</html>`
}

// ============================================================
// Agent Hub — Unified Autonomous Agent Management API
// All routes require superadmin authentication.
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { validateAdminSession } from './auth'
import { processOrderQueue } from '../services/ai-agent'
import { runContentAgent } from '../services/content-agent'
import { runLeadAgent } from '../services/lead-agent'
import { runEmailAgent } from '../services/email-agent'
import { runMonitorAgent } from '../services/monitor-agent'

export const agentHubRoutes = new Hono<{ Bindings: Bindings }>()

const VALID_AGENTS = new Set(['tracing', 'content', 'email', 'lead', 'monitor'])

// ── Auth middleware ───────────────────────────────────────────

agentHubRoutes.use('*', async (c, next) => {
  const session = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!session || session.role !== 'superadmin') {
    return c.json({ error: 'Superadmin access required' }, 403)
  }
  await next()
})

// ── GET /dashboard ────────────────────────────────────────────

agentHubRoutes.get('/dashboard', async (c) => {
  try {
    const db = c.env.DB
    const today = new Date().toISOString().slice(0, 10)
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()

    // All agent configs
    const configsRes = await db.prepare(
      `SELECT agent_type, enabled, config_json, last_run_at, last_run_status, last_run_details, run_count, error_count
       FROM agent_configs ORDER BY agent_type`
    ).all<any>()

    const agentMap: Record<string, any> = {}
    for (const row of configsRes.results || []) {
      agentMap[row.agent_type] = {
        enabled: row.enabled === 1,
        config: row.config_json ? JSON.parse(row.config_json) : {},
        last_run_at: row.last_run_at,
        last_run_status: row.last_run_status,
        last_run_details: row.last_run_details,
        run_count: row.run_count || 0,
        error_count: row.error_count || 0,
      }
    }

    // Per-agent today run counts from agent_runs
    const todayRunsRes = await db.prepare(
      `SELECT agent_type, COUNT(*) as cnt, SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as ok_cnt
       FROM agent_runs WHERE created_at >= ? GROUP BY agent_type`
    ).bind(today).all<any>()
    for (const r of todayRunsRes.results || []) {
      if (agentMap[r.agent_type]) {
        agentMap[r.agent_type].today_runs = r.cnt
        agentMap[r.agent_type].today_success = r.ok_cnt
      }
    }

    // Platform metrics
    const [ordersToday, postsWeek, leadsToday, emailsWeek] = await Promise.all([
      db.prepare(
        `SELECT COUNT(*) as cnt FROM agent_jobs WHERE success=1 AND created_at >= ?`
      ).bind(today).first<{ cnt: number }>(),
      db.prepare(
        `SELECT COUNT(*) as cnt FROM blog_posts WHERE status='published' AND created_at >= ?`
      ).bind(weekAgo).first<{ cnt: number }>(),
      db.prepare(
        `SELECT COUNT(*) as cnt FROM lead_responses WHERE responded_at >= ? AND success=1`
      ).bind(today).first<{ cnt: number }>(),
      db.prepare(
        `SELECT COALESCE(SUM(sent_count),0) as cnt FROM email_campaigns WHERE completed_at >= ?`
      ).bind(weekAgo).first<{ cnt: number }>(),
    ])

    // Recent combined activity
    const recentRes = await db.prepare(
      `SELECT id, agent_type, status, summary, duration_ms, created_at
       FROM agent_runs ORDER BY created_at DESC LIMIT 20`
    ).all<any>()

    return c.json({
      success: true,
      agents: agentMap,
      metrics: {
        orders_traced_today:       ordersToday?.cnt || 0,
        blog_posts_published_week: postsWeek?.cnt   || 0,
        leads_responded_today:     leadsToday?.cnt  || 0,
        emails_sent_week:          emailsWeek?.cnt  || 0,
      },
      recent_activity: recentRes.results || [],
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ── POST /:agent/run ──────────────────────────────────────────

agentHubRoutes.post('/:agent/run', async (c) => {
  const agent = c.req.param('agent')
  if (!VALID_AGENTS.has(agent)) {
    return c.json({ error: `Unknown agent type: "${agent}". Valid: ${[...VALID_AGENTS].join(', ')}` }, 400)
  }

  const runStart = Date.now()
  try {
    let result: any
    switch (agent) {
      case 'tracing': {
        const r = await processOrderQueue(c.env)
        result = { processed: r.processed.length, stats: r.stats }
        break
      }
      case 'content':
        result = await runContentAgent(c.env)
        break
      case 'lead':
        result = await runLeadAgent(c.env)
        break
      case 'email':
        result = await runEmailAgent(c.env)
        break
      case 'monitor':
        result = await runMonitorAgent(c.env)
        break
    }

    const duration = Date.now() - runStart
    const status = result?.ok === false ? 'error' : (result?.skipped ? 'skipped' : 'success')
    const summary = buildSummary(agent, result)

    await logAgentRun(c.env.DB, agent, status, summary, result, duration)
    await updateAgentConfig(c.env.DB, agent, status, summary)

    return c.json({ success: true, agent, result, duration_ms: duration })
  } catch (err: any) {
    const duration = Date.now() - runStart
    await logAgentRun(c.env.DB, agent, 'error', err.message, { error: err.message }, duration)
    await updateAgentConfig(c.env.DB, agent, 'error', err.message)
    return c.json({ error: err.message }, 500)
  }
})

// ── POST /:agent/toggle ───────────────────────────────────────

agentHubRoutes.post('/:agent/toggle', async (c) => {
  const agent = c.req.param('agent')
  if (!VALID_AGENTS.has(agent)) {
    return c.json({ error: `Unknown agent type: "${agent}"` }, 400)
  }
  try {
    const current = await c.env.DB.prepare(
      `SELECT enabled FROM agent_configs WHERE agent_type = ?`
    ).bind(agent).first<{ enabled: number }>()
    const newEnabled = current?.enabled === 1 ? 0 : 1
    await c.env.DB.prepare(
      `UPDATE agent_configs SET enabled = ?, updated_at = datetime('now') WHERE agent_type = ?`
    ).bind(newEnabled, agent).run()
    return c.json({
      success: true,
      agent,
      enabled: newEnabled === 1,
      message: `${agent} agent ${newEnabled === 1 ? 'ENABLED' : 'DISABLED'}`,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ── PUT /:agent/config ────────────────────────────────────────

agentHubRoutes.put('/:agent/config', async (c) => {
  const agent = c.req.param('agent')
  if (!VALID_AGENTS.has(agent)) {
    return c.json({ error: `Unknown agent type: "${agent}"` }, 400)
  }
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Request body must be a JSON object' }, 400)
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return c.json({ error: 'Request body must be a JSON object' }, 400)
  }
  try {
    const existing = await c.env.DB.prepare(
      `SELECT config_json FROM agent_configs WHERE agent_type = ?`
    ).bind(agent).first<{ config_json: string | null }>()
    const current = existing?.config_json ? JSON.parse(existing.config_json) : {}
    const merged = { ...current, ...(body as Record<string, unknown>) }
    await c.env.DB.prepare(
      `UPDATE agent_configs SET config_json = ?, updated_at = datetime('now') WHERE agent_type = ?`
    ).bind(JSON.stringify(merged), agent).run()
    return c.json({ success: true, agent, config: merged })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ── GET /activity ─────────────────────────────────────────────

agentHubRoutes.get('/activity', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100)
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0'))
  try {
    const res = await c.env.DB.prepare(
      `SELECT id, agent_type, status, summary, duration_ms, created_at
       FROM agent_runs ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).bind(limit, offset).all<any>()
    return c.json({ success: true, activity: res.results || [], limit, offset })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ── GET /:agent/runs ──────────────────────────────────────────

agentHubRoutes.get('/:agent/runs', async (c) => {
  const agent = c.req.param('agent')
  if (!VALID_AGENTS.has(agent)) {
    return c.json({ error: `Unknown agent type: "${agent}"` }, 400)
  }
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100)
  try {
    const res = await c.env.DB.prepare(
      `SELECT id, agent_type, status, summary, details_json, duration_ms, created_at
       FROM agent_runs WHERE agent_type = ? ORDER BY created_at DESC LIMIT ?`
    ).bind(agent, limit).all<any>()
    return c.json({ success: true, agent, runs: res.results || [] })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ── GET /monitor/insights ─────────────────────────────────────

agentHubRoutes.get('/monitor/insights', async (c) => {
  const status = c.req.query('status') || 'open'
  const limit  = Math.min(parseInt(c.req.query('limit') || '50'), 100)
  try {
    const res = await c.env.DB.prepare(
      `SELECT id, category, severity, title, description, suggested_fix, status, created_at
       FROM platform_insights WHERE status = ? ORDER BY
         CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
         created_at DESC LIMIT ?`
    ).bind(status, limit).all<any>()
    return c.json({ success: true, insights: res.results || [], status })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ── POST /monitor/insights/:id/acknowledge ────────────────────

agentHubRoutes.post('/monitor/insights/:id/acknowledge', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid insight id' }, 400)
  try {
    await c.env.DB.prepare(
      `UPDATE platform_insights SET status = 'acknowledged' WHERE id = ? AND status = 'open'`
    ).bind(id).run()
    return c.json({ success: true, id })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ── POST /monitor/insights/:id/resolve ───────────────────────

agentHubRoutes.post('/monitor/insights/:id/resolve', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid insight id' }, 400)
  try {
    await c.env.DB.prepare(
      `UPDATE platform_insights SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?`
    ).bind(id).run()
    return c.json({ success: true, id })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ── Helpers ───────────────────────────────────────────────────

function buildSummary(agent: string, result: any): string {
  if (!result) return `${agent} run completed`
  switch (agent) {
    case 'tracing':
      return `Processed ${result.processed ?? 0} order(s)`
    case 'content':
      if (result.skipped) return 'No keywords in queue'
      if (result.ok) return `Published "${result.keyword}" (quality ${result.quality?.overall ?? '?'}%)`
      return `Content failed: ${result.error || 'unknown error'}`
    case 'lead':
      if (result.responded === 0) return 'No new leads to respond to'
      return `Responded to ${result.responded} lead(s)`
    case 'email':
      if (result.skipped) return 'No unengaged contacts to email'
      if (result.ok) return `Sent "${result.campaign_name}" to ${result.sent}/${result.recipients} contacts`
      return `Email campaign failed: ${result.errors?.[0] || 'unknown error'}`
    case 'monitor':
      if (!result.ok) return `Monitor scan failed: ${result.error || 'unknown error'}`
      return `Health score ${result.health_score}/100 — ${result.issues_found} finding(s)${result.critical_count > 0 ? ` (${result.critical_count} critical)` : ''}`
    default:
      return `${agent} completed`
  }
}

async function logAgentRun(
  db: D1Database, agent: string, status: string,
  summary: string, details: any, duration: number
): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO agent_runs (agent_type, status, summary, details_json, duration_ms)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(agent, status, summary, JSON.stringify(details).slice(0, 4000), duration).run()
  } catch {}
}

async function updateAgentConfig(
  db: D1Database, agent: string, status: string, details: string
): Promise<void> {
  try {
    await db.prepare(
      `UPDATE agent_configs SET
         last_run_at = datetime('now'),
         last_run_status = ?,
         last_run_details = ?,
         run_count = run_count + 1,
         error_count = error_count + CASE WHEN ? = 'error' THEN 1 ELSE 0 END,
         updated_at = datetime('now')
       WHERE agent_type = ?`
    ).bind(status, details.slice(0, 500), status, agent).run()
  } catch {}
}

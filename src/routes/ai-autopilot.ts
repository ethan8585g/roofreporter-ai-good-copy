// ============================================================
// Roof Manager — AI Autopilot Routes
// Endpoints for the autonomous AI agent system.
// All routes require superadmin authentication.
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { validateAdminSession } from './auth'
import {
  autoProcessOrder,
  processOrderQueue,
  retryFailedOrders,
  getQueueStats,
  getConfidenceThreshold,
} from '../services/ai-agent'

export const aiAutopilotRoutes = new Hono<{ Bindings: Bindings }>()

// ── AUTH MIDDLEWARE — Superadmin only ──
aiAutopilotRoutes.use('*', async (c, next) => {
  const authHeader = c.req.header('Authorization')
  const session = await validateAdminSession(c.env.DB, authHeader)
  if (!session || session.role !== 'superadmin') {
    return c.json({ error: 'Superadmin access required' }, 403)
  }
  await next()
})


// ============================================================
// GET /dashboard — Agent dashboard with queue stats and recent jobs
// ============================================================
aiAutopilotRoutes.get('/dashboard', async (c) => {
  try {
    const stats = await getQueueStats(c.env.DB)

    // Get recent agent jobs
    const recentJobs = await c.env.DB.prepare(`
      SELECT aj.*, o.order_number, o.property_address
      FROM agent_jobs aj
      LEFT JOIN orders o ON o.id = aj.order_id
      ORDER BY aj.created_at DESC
      LIMIT 20
    `).all<any>()

    // Get orders waiting for auto-trace
    const pendingOrders = await c.env.DB.prepare(`
      SELECT id, order_number, property_address, latitude, longitude,
             status, created_at, service_tier
      FROM orders
      WHERE needs_admin_trace = 1
        AND status IN ('processing', 'paid')
      ORDER BY created_at ASC
      LIMIT 20
    `).all<any>()

    // Get agent config
    const config = await getAgentConfig(c.env.DB)

    return c.json({
      success: true,
      stats,
      recent_jobs: recentJobs.results || [],
      pending_orders: pendingOrders.results || [],
      config,
      agent_version: '1.0.0',
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// ============================================================
// POST /process-queue — Trigger the queue processor manually
// Processes up to 5 pending orders in one invocation
// ============================================================
aiAutopilotRoutes.post('/process-queue', async (c) => {
  try {
    const result = await processOrderQueue(c.env)
    return c.json({
      success: true,
      processed_count: result.processed.length,
      results: result.processed,
      stats: result.stats,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// ============================================================
// POST /process-order/:orderId — Auto-process a specific order
// ============================================================
aiAutopilotRoutes.post('/process-order/:orderId', async (c) => {
  const orderId = c.req.param('orderId')
  try {
    const threshold = await getConfidenceThreshold(c.env.DB)
    const result = await autoProcessOrder(orderId, c.env, threshold)

    // Log the job
    await c.env.DB.prepare(`
      INSERT INTO agent_jobs (order_id, action, success, confidence, processing_ms, error, details, agent_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, '1.0.0')
    `).bind(
      orderId, result.action, result.success ? 1 : 0,
      result.confidence || null, result.processing_ms,
      result.error || null, result.details || null
    ).run()

    return c.json({ success: result.success, result })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// ============================================================
// POST /retry-failed — Retry orders that previously failed
// ============================================================
aiAutopilotRoutes.post('/retry-failed', async (c) => {
  try {
    const results = await retryFailedOrders(c.env)
    return c.json({
      success: true,
      retried_count: results.length,
      results,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// ============================================================
// GET /stats — Quick queue stats (lightweight)
// ============================================================
aiAutopilotRoutes.get('/stats', async (c) => {
  try {
    const stats = await getQueueStats(c.env.DB)
    return c.json({ success: true, stats })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// ============================================================
// GET /jobs — List recent agent jobs with filtering
// ============================================================
aiAutopilotRoutes.get('/jobs', async (c) => {
  const action = c.req.query('action')  // filter by action type
  const success = c.req.query('success') // filter by success/failure
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100)

  try {
    let sql = `
      SELECT aj.*, o.order_number, o.property_address, o.service_tier
      FROM agent_jobs aj
      LEFT JOIN orders o ON o.id = aj.order_id
      WHERE 1=1
    `
    const params: any[] = []

    if (action) {
      sql += ' AND aj.action = ?'
      params.push(action)
    }
    if (success === '1' || success === '0') {
      sql += ' AND aj.success = ?'
      params.push(parseInt(success))
    }

    sql += ' ORDER BY aj.created_at DESC LIMIT ?'
    params.push(limit)

    const jobs = await c.env.DB.prepare(sql).bind(...params).all<any>()
    return c.json({ success: true, jobs: jobs.results || [] })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// ============================================================
// PUT /config — Update agent configuration
// ============================================================
aiAutopilotRoutes.put('/config', async (c) => {
  try {
    const body = await c.req.json()
    const { auto_process_enabled, confidence_threshold, max_daily_auto, notify_on_complete } = body

    if (auto_process_enabled !== undefined) {
      await upsertSetting(c.env.DB, 'agent_auto_process_enabled', auto_process_enabled ? '1' : '0')
    }
    if (confidence_threshold !== undefined) {
      const threshold = Math.max(30, Math.min(95, parseInt(confidence_threshold)))
      await upsertSetting(c.env.DB, 'agent_confidence_threshold', String(threshold))
    }
    if (max_daily_auto !== undefined) {
      await upsertSetting(c.env.DB, 'agent_max_daily_auto', String(Math.max(1, parseInt(max_daily_auto))))
    }
    if (notify_on_complete !== undefined) {
      await upsertSetting(c.env.DB, 'agent_notify_on_complete', notify_on_complete ? '1' : '0')
    }

    const config = await getAgentConfig(c.env.DB)
    return c.json({ success: true, config })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// ============================================================
// POST /toggle — Quick enable/disable the auto-processor
// ============================================================
aiAutopilotRoutes.post('/toggle', async (c) => {
  try {
    const current = await c.env.DB.prepare(
      "SELECT setting_value FROM settings WHERE master_company_id = ? AND setting_key = 'agent_auto_process_enabled'"
    ).bind(PLATFORM_COMPANY_ID).first<any>()
    const newValue = current?.setting_value === '1' ? '0' : '1'
    await upsertSetting(c.env.DB, 'agent_auto_process_enabled', newValue)

    return c.json({
      success: true,
      auto_process_enabled: newValue === '1',
      message: newValue === '1' ? 'AI Agent auto-processing ENABLED' : 'AI Agent auto-processing DISABLED'
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})


// ============================================================
// HELPERS
// ============================================================

// Platform-level agent settings use master_company_id = 0 (no real company)
const PLATFORM_COMPANY_ID = 0

async function getAgentConfig(db: D1Database): Promise<Record<string, any>> {
  const settings = await db.prepare(
    "SELECT setting_key, setting_value FROM settings WHERE master_company_id = ? AND setting_key LIKE 'agent_%'"
  ).bind(PLATFORM_COMPANY_ID).all<any>()

  const config: Record<string, any> = {
    auto_process_enabled: false,
    confidence_threshold: 60,
    max_daily_auto: 50,
    notify_on_complete: true,
  }

  for (const row of settings.results || []) {
    switch (row.setting_key) {
      case 'agent_auto_process_enabled':
        config.auto_process_enabled = row.setting_value === '1'
        break
      case 'agent_confidence_threshold':
        config.confidence_threshold = parseInt(row.setting_value) || 60
        break
      case 'agent_max_daily_auto':
        config.max_daily_auto = parseInt(row.setting_value) || 50
        break
      case 'agent_notify_on_complete':
        config.notify_on_complete = row.setting_value !== '0'
        break
    }
  }

  return config
}

async function upsertSetting(db: D1Database, key: string, value: string) {
  await db.prepare(`
    INSERT INTO settings (master_company_id, setting_key, setting_value)
    VALUES (?, ?, ?)
    ON CONFLICT(master_company_id, setting_key)
    DO UPDATE SET setting_value = ?, updated_at = datetime('now')
  `).bind(PLATFORM_COMPANY_ID, key, value, value).run()
}

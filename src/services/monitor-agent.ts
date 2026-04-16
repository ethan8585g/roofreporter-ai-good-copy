// ============================================================
// Platform Monitor Agent
// Continuously scans roofmanager.ca for bugs, errors, stale data,
// and improvement opportunities. Uses Claude to analyze health metrics
// and generates prioritised action items stored in platform_insights.
//
// Self-improving: carries forward accumulated learnings across runs
// via agent_memory so Claude builds a growing model of the platform.
// Schedule: every 6 hours (when hour % 6 === 0 in scheduled handler)
// ============================================================

import { getAnthropicClient, CLAUDE_MODEL, extractJson, readAgentMemory, writeAgentMemory } from './anthropic-client'
import { DEFAULT_CONFIDENCE_THRESHOLD } from './ai-agent'
import type { Bindings } from '../types'

const AGENT_TYPE = 'monitor'

// Bounds for auto-adjusting the tracing confidence threshold
const THRESHOLD_MIN = 45
const THRESHOLD_MAX = 85
const THRESHOLD_STEP = 5   // adjust by this much per scan

// ── Types ─────────────────────────────────────────────────────

export interface TracingAccuracyMetrics {
  avg_confidence_7d: number | null
  avg_confidence_prev_7d: number | null   // for trend comparison
  flagged_rate_7d: number                 // fraction of jobs flagged for review
  success_rate_7d: number                 // fraction successfully auto-traced
  total_jobs_7d: number
  current_threshold: number
}

export interface PlatformMetrics {
  failed_orders_24h: number
  stuck_reports: number
  failed_agent_runs_24h: number
  total_agent_runs_24h: number
  error_rate_24h: number              // 0–1 fraction
  pending_payments: number
  unprocessed_leads: number
  blog_posts_this_week: number
  avg_report_duration_sec: number | null
  open_issues_count: number
  recent_errors: string[]
  tracing: TracingAccuracyMetrics
}

export interface PlatformInsight {
  category: 'bug' | 'error' | 'improvement' | 'health' | 'performance'
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  description: string
  suggested_fix: string
}

export interface MonitorRunResult {
  ok: boolean
  health_score: number
  issues_found: number
  critical_count: number
  insights: PlatformInsight[]
  threshold_adjusted?: boolean
  threshold_adjustment?: { adjusted: boolean; old_threshold: number; new_threshold: number; reason: string }
  error?: string
}

// ── Prompt builder ────────────────────────────────────────────

export function buildMonitorPrompt(metrics: PlatformMetrics, priorMemory: string): string {
  const errorRatePct = Math.round(metrics.error_rate_24h * 100)
  return `You are a senior reliability and growth engineer analyzing Roof Manager (roofmanager.ca).

Platform stack: Cloudflare Workers + D1 SQLite + Hono + Anthropic Claude agents.
Product: SaaS roofing measurement platform for Canadian contractors and property managers.
Core features: AI roof measurement, PDF report generation, CRM pipeline, SEO blog, email marketing, lead capture.

PLATFORM HEALTH SNAPSHOT (last 24 hours)
----------------------------------------
Failed orders:                  ${metrics.failed_orders_24h}
Stuck/stale reports (>30 min):  ${metrics.stuck_reports}
Agent run failures:             ${metrics.failed_agent_runs_24h} / ${metrics.total_agent_runs_24h} total (${errorRatePct}% error rate)
Pending unprocessed payments:   ${metrics.pending_payments}
Unresponded leads in queue:     ${metrics.unprocessed_leads}
Blog posts published this week: ${metrics.blog_posts_this_week}
Avg report generation time:     ${metrics.avg_report_duration_sec !== null ? `${metrics.avg_report_duration_sec}s` : 'unknown'}
Open platform issues backlog:   ${metrics.open_issues_count}

TRACING ACCURACY (last 7 days vs prior 7 days)
-----------------------------------------------
Auto-trace jobs:                ${metrics.tracing.total_jobs_7d}
Avg confidence (this week):     ${metrics.tracing.avg_confidence_7d !== null ? `${metrics.tracing.avg_confidence_7d}/100` : 'no data'}
Avg confidence (prior week):    ${metrics.tracing.avg_confidence_prev_7d !== null ? `${metrics.tracing.avg_confidence_prev_7d}/100` : 'no data'}
Flagged for manual review:      ${Math.round(metrics.tracing.flagged_rate_7d * 100)}% of jobs
Auto-trace success rate:        ${Math.round(metrics.tracing.success_rate_7d * 100)}%
Current confidence threshold:   ${metrics.tracing.current_threshold}/100

RECENT ERROR MESSAGES
---------------------
${metrics.recent_errors.length
  ? metrics.recent_errors.map(e => `• ${e}`).join('\n')
  : '• No recent errors logged'}

ACCUMULATED PLATFORM KNOWLEDGE (from prior scans)
--------------------------------------------------
${priorMemory || '• No prior knowledge yet — this is the first scan. Focus on establishing a baseline.'}

ANALYSIS TASK
-------------
Based on the data above, identify:
1. Any active bugs or errors requiring immediate attention (failed orders, stuck reports, agent crashes)
2. Performance regressions or degradation patterns
3. Business improvement opportunities (conversion funnel, lead response time, content frequency)
4. SEO/content gaps (target 3–5 posts/week for growth)
5. Patterns compared to prior knowledge that indicate recurring problems

Also write a memory_update: a dense paragraph capturing what you now know about platform health trends,
recurring issues, and baselines — this will be fed back to you on the next scan so you can detect
regressions and improvements over time.

STRICT JSON response (no markdown fences, no extra text):
{
  "health_score": <integer 0-100, where 100 = perfect health>,
  "insights": [
    {
      "category": <"bug"|"error"|"improvement"|"health"|"performance">,
      "severity": <"critical"|"high"|"medium"|"low">,
      "title": <string, max 80 chars>,
      "description": <string, clear problem description>,
      "suggested_fix": <string, actionable next step>
    }
  ],
  "memory_update": <string, dense paragraph of accumulated platform knowledge for future scans>
}`
}

// ── Response parser ───────────────────────────────────────────

const VALID_CATEGORIES = new Set(['bug', 'error', 'improvement', 'health', 'performance'])
const VALID_SEVERITIES  = new Set(['critical', 'high', 'medium', 'low'])

export function parseMonitorFindings(text: string): {
  health_score: number
  insights: PlatformInsight[]
  memory_update: string
} {
  try {
    const raw = extractJson<any>(text)
    const health_score = Math.min(100, Math.max(0, Number(raw.health_score) || 75))

    const insights: PlatformInsight[] = (Array.isArray(raw.insights) ? raw.insights : [])
      .slice(0, 20)
      .map((i: any) => ({
        category: VALID_CATEGORIES.has(i.category) ? i.category : 'improvement',
        severity:  VALID_SEVERITIES.has(i.severity)  ? i.severity  : 'low',
        title:        String(i.title        || 'Untitled finding').slice(0, 80),
        description:  String(i.description  || ''),
        suggested_fix: String(i.suggested_fix || ''),
      }))

    return {
      health_score,
      insights,
      memory_update: String(raw.memory_update || '').slice(0, 3000),
    }
  } catch {
    return { health_score: 75, insights: [], memory_update: '' }
  }
}

// ── Pure health scorer (for tests + quick checks) ─────────────

export function computeHealthScore(metrics: PlatformMetrics): number {
  let score = 100
  // Deduct for failures
  if (metrics.failed_orders_24h > 0)   score -= Math.min(30, metrics.failed_orders_24h * 5)
  if (metrics.stuck_reports > 0)        score -= Math.min(20, metrics.stuck_reports * 4)
  if (metrics.error_rate_24h > 0.1)     score -= Math.min(20, Math.round(metrics.error_rate_24h * 100))
  if (metrics.pending_payments > 0)     score -= Math.min(15, metrics.pending_payments * 3)
  if (metrics.unprocessed_leads > 5)    score -= Math.min(10, (metrics.unprocessed_leads - 5))
  // Deduct for poor tracing accuracy
  if (metrics.tracing.avg_confidence_7d !== null && metrics.tracing.avg_confidence_7d < 65) {
    score -= Math.min(15, Math.round((65 - metrics.tracing.avg_confidence_7d) * 0.5))
  }
  if (metrics.tracing.flagged_rate_7d > 0.4) score -= 10  // >40% flagged is bad
  // Boost for activity
  if (metrics.blog_posts_this_week >= 3) score += 5
  return Math.min(100, Math.max(0, score))
}

// ── Tracing auto-correction ───────────────────────────────────
// Called after metrics are collected. Adjusts the confidence threshold
// in agent_configs so the tracing agent becomes more conservative when
// accuracy is declining, or relaxes when things are running well.

export async function autoAdjustTracingThreshold(
  db: D1Database,
  tracing: TracingAccuracyMetrics
): Promise<{ adjusted: boolean; old_threshold: number; new_threshold: number; reason: string }> {
  const old = tracing.current_threshold
  let newThreshold = old
  let reason = 'No adjustment needed'

  const avgConf = tracing.avg_confidence_7d
  const prevConf = tracing.avg_confidence_prev_7d

  if (tracing.total_jobs_7d < 3) {
    return { adjusted: false, old_threshold: old, new_threshold: old, reason: 'Not enough data (< 3 jobs this week)' }
  }

  // Accuracy declining: avg confidence dropped > 5 points week-over-week → raise threshold
  if (avgConf !== null && prevConf !== null && prevConf - avgConf > 5) {
    newThreshold = Math.min(THRESHOLD_MAX, old + THRESHOLD_STEP)
    reason = `Accuracy declining (${prevConf}→${avgConf} avg confidence). Raised threshold to be more conservative.`
  }
  // High flag rate: >40% of jobs flagged for review → raise threshold
  else if (tracing.flagged_rate_7d > 0.4 && old < THRESHOLD_MAX) {
    newThreshold = Math.min(THRESHOLD_MAX, old + THRESHOLD_STEP)
    reason = `High flag rate (${Math.round(tracing.flagged_rate_7d * 100)}% flagged). Raised threshold to reduce low-quality auto-traces.`
  }
  // Excellent accuracy: avg confidence > 80 AND flag rate < 10% → safely lower threshold to process more orders
  else if (avgConf !== null && avgConf > 80 && tracing.flagged_rate_7d < 0.1 && old > DEFAULT_CONFIDENCE_THRESHOLD) {
    newThreshold = Math.max(THRESHOLD_MIN, old - THRESHOLD_STEP)
    reason = `High accuracy (${avgConf} avg, ${Math.round(tracing.flagged_rate_7d * 100)}% flagged). Lowered threshold to process more orders.`
  }

  if (newThreshold === old) {
    return { adjusted: false, old_threshold: old, new_threshold: old, reason }
  }

  // Apply the new threshold to agent_configs
  try {
    const existing = await db.prepare(
      `SELECT config_json FROM agent_configs WHERE agent_type = 'tracing'`
    ).first<{ config_json: string | null }>()
    const current = existing?.config_json ? JSON.parse(existing.config_json) : {}
    const updated = { ...current, confidence_threshold: newThreshold }
    await db.prepare(
      `UPDATE agent_configs SET config_json = ?, updated_at = datetime('now') WHERE agent_type = 'tracing'`
    ).bind(JSON.stringify(updated)).run()
  } catch {
    return { adjusted: false, old_threshold: old, new_threshold: old, reason: 'DB update failed' }
  }

  return { adjusted: true, old_threshold: old, new_threshold: newThreshold, reason }
}

// ── Main runner ───────────────────────────────────────────────

export async function runMonitorAgent(env: Bindings): Promise<MonitorRunResult> {
  if (!env.ANTHROPIC_API_KEY) {
    return { ok: false, health_score: 0, issues_found: 0, critical_count: 0, insights: [], error: 'ANTHROPIC_API_KEY not configured' }
  }

  const db = env.DB
  const now24h   = new Date(Date.now() -  1 * 86400 * 1000).toISOString()
  const now7d    = new Date(Date.now() -  7 * 86400 * 1000).toISOString()
  const now14d   = new Date(Date.now() - 14 * 86400 * 1000).toISOString()

  // Collect platform metrics from D1
  const [
    failedOrders,
    stuckReports,
    agentRunStats,
    pendingPayments,
    unprocessedLeads,
    blogPostsWeek,
    avgReportDuration,
    openIssues,
    recentErrors,
    tracingStats7d,
    tracingStatsPrev,
    tracingConfig,
  ] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) as cnt FROM orders WHERE status='failed' AND updated_at >= ?`
    ).bind(now24h).first<{ cnt: number }>(),

    db.prepare(
      `SELECT COUNT(*) as cnt FROM reports
       WHERE status IN ('generating','pending')
       AND updated_at <= datetime('now', '-30 minutes')`
    ).first<{ cnt: number }>(),

    db.prepare(
      `SELECT
         COUNT(*) as total,
         SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) as failures
       FROM agent_runs WHERE created_at >= ?`
    ).bind(now24h).first<{ total: number; failures: number }>(),

    db.prepare(
      `SELECT COUNT(*) as cnt FROM payments WHERE status='pending' AND created_at >= ?`
    ).bind(now24h).first<{ cnt: number }>().catch(() => ({ cnt: 0 })),

    db.prepare(
      `SELECT COUNT(*) as cnt FROM asset_report_leads
       WHERE email NOT IN (SELECT lead_email FROM lead_responses)`
    ).first<{ cnt: number }>().catch(() => ({ cnt: 0 })),

    db.prepare(
      `SELECT COUNT(*) as cnt FROM blog_posts WHERE status='published' AND created_at >= ?`
    ).bind(now7d).first<{ cnt: number }>(),

    db.prepare(
      `SELECT AVG(duration_ms) as avg_ms FROM agent_runs
       WHERE agent_type='tracing' AND status='success' AND created_at >= ?`
    ).bind(now24h).first<{ avg_ms: number | null }>(),

    db.prepare(
      `SELECT COUNT(*) as cnt FROM platform_insights WHERE status='open'`
    ).first<{ cnt: number }>().catch(() => ({ cnt: 0 })),

    db.prepare(
      `SELECT summary FROM agent_runs WHERE status='error' AND created_at >= ? ORDER BY created_at DESC LIMIT 10`
    ).bind(now24h).all<{ summary: string }>(),

    // Tracing accuracy: last 7 days
    db.prepare(`
      SELECT
        COUNT(*) as total,
        AVG(confidence) as avg_conf,
        SUM(CASE WHEN action = 'flagged_for_review' THEN 1 ELSE 0 END) as flagged,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as succeeded
      FROM agent_jobs WHERE created_at >= ?
    `).bind(now7d).first<{ total: number; avg_conf: number | null; flagged: number; succeeded: number }>()
     .catch(() => null),

    // Tracing accuracy: prior 7 days (for trend)
    db.prepare(`
      SELECT AVG(confidence) as avg_conf
      FROM agent_jobs WHERE created_at >= ? AND created_at < ?
    `).bind(now14d, now7d).first<{ avg_conf: number | null }>()
     .catch(() => null),

    // Current threshold from agent_configs
    db.prepare(`SELECT config_json FROM agent_configs WHERE agent_type = 'tracing'`)
     .first<{ config_json: string | null }>().catch(() => null),
  ])

  const totalRuns    = agentRunStats?.total    || 0
  const failedRuns   = agentRunStats?.failures || 0
  const errorRate    = totalRuns > 0 ? failedRuns / totalRuns : 0
  const avgDurationSec = agentRunStats?.total && avgReportDuration?.avg_ms
    ? Math.round(avgReportDuration.avg_ms / 1000)
    : null

  // Parse current threshold from config
  let currentThreshold = DEFAULT_CONFIDENCE_THRESHOLD
  try {
    if (tracingConfig?.config_json) {
      const cfg = JSON.parse(tracingConfig.config_json)
      if (typeof cfg.confidence_threshold === 'number') currentThreshold = cfg.confidence_threshold
    }
  } catch {}

  const tracingJobs7d = tracingStats7d?.total || 0
  const flaggedRate   = tracingJobs7d > 0 ? (tracingStats7d?.flagged || 0) / tracingJobs7d : 0
  const successRate   = tracingJobs7d > 0 ? (tracingStats7d?.succeeded || 0) / tracingJobs7d : 1

  const tracingMetrics: TracingAccuracyMetrics = {
    avg_confidence_7d:      tracingStats7d?.avg_conf != null ? Math.round(tracingStats7d.avg_conf) : null,
    avg_confidence_prev_7d: tracingStatsPrev?.avg_conf != null ? Math.round(tracingStatsPrev.avg_conf) : null,
    flagged_rate_7d:        flaggedRate,
    success_rate_7d:        successRate,
    total_jobs_7d:          tracingJobs7d,
    current_threshold:      currentThreshold,
  }

  const metrics: PlatformMetrics = {
    failed_orders_24h:     failedOrders?.cnt       || 0,
    stuck_reports:         stuckReports?.cnt        || 0,
    failed_agent_runs_24h: failedRuns,
    total_agent_runs_24h:  totalRuns,
    error_rate_24h:        errorRate,
    pending_payments:      (pendingPayments as any)?.cnt || 0,
    unprocessed_leads:     (unprocessedLeads as any)?.cnt || 0,
    blog_posts_this_week:  blogPostsWeek?.cnt        || 0,
    avg_report_duration_sec: avgDurationSec,
    open_issues_count:     (openIssues as any)?.cnt  || 0,
    tracing:               tracingMetrics,
    recent_errors:         (recentErrors.results || []).map(r => r.summary).filter(Boolean),
  }

  // Read accumulated memory from prior runs
  const priorMemory = await readAgentMemory(db, AGENT_TYPE, 'platform_summary')

  // Call Claude for analysis
  const client = getAnthropicClient(env.ANTHROPIC_API_KEY)
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: buildMonitorPrompt(metrics, priorMemory) }],
  })

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as any).text)
    .join('')

  const { health_score, insights, memory_update } = parseMonitorFindings(text)

  // Persist insights to platform_insights table
  // (agent_runs logging is handled by agent-hub or the cron handler, not here)
  for (const ins of insights) {
    await db.prepare(
      `INSERT INTO platform_insights (category, severity, title, description, suggested_fix)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(ins.category, ins.severity, ins.title, ins.description, ins.suggested_fix).run()
      .catch(() => {})
  }

  // ── Auto-correct tracing confidence threshold if needed ──────
  const adjustment = await autoAdjustTracingThreshold(db, tracingMetrics)
  if (adjustment.adjusted) {
    // Record this autonomous action in agent_memory so it's visible in future analysis
    const adjustmentLog = `[${new Date().toISOString().slice(0,10)}] Auto-adjusted tracing threshold: ${adjustment.old_threshold} → ${adjustment.new_threshold}. Reason: ${adjustment.reason}`
    const existingLog = await readAgentMemory(db, AGENT_TYPE, 'threshold_adjustments')
    await writeAgentMemory(db, AGENT_TYPE, 'threshold_adjustments',
      (existingLog ? existingLog + '\n' : '') + adjustmentLog
    )
    // Surface it as a platform insight too
    insights.unshift({
      category: 'health',
      severity: adjustment.new_threshold > adjustment.old_threshold ? 'high' : 'low',
      title: `Tracing threshold auto-adjusted: ${adjustment.old_threshold}→${adjustment.new_threshold}`,
      description: adjustment.reason,
      suggested_fix: `Monitor tracing results over the next 24h to confirm the adjustment helped.`,
    })
  }

  // Persist updated memory
  if (memory_update) {
    await writeAgentMemory(db, AGENT_TYPE, 'platform_summary', memory_update)
  }

  const criticalCount = insights.filter(i => i.severity === 'critical').length

  return {
    ok: true,
    health_score,
    issues_found: insights.length,
    critical_count: criticalCount,
    insights,
    threshold_adjusted: adjustment.adjusted,
    threshold_adjustment: adjustment.adjusted ? adjustment : undefined,
  }
}

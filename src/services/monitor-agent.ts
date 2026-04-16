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
import type { Bindings } from '../types'

const AGENT_TYPE = 'monitor'

// ── Types ─────────────────────────────────────────────────────

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
  // Boost for activity
  if (metrics.blog_posts_this_week >= 3) score += 5
  return Math.min(100, Math.max(0, score))
}

// ── Main runner ───────────────────────────────────────────────

export async function runMonitorAgent(env: Bindings): Promise<MonitorRunResult> {
  const db = env.DB
  const now24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const now7d  = new Date(Date.now() - 7  * 86400 * 1000).toISOString()

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
  ])

  const totalRuns    = agentRunStats?.total    || 0
  const failedRuns   = agentRunStats?.failures || 0
  const errorRate    = totalRuns > 0 ? failedRuns / totalRuns : 0
  const avgDurationSec = agentRunStats?.total && avgReportDuration?.avg_ms
    ? Math.round(avgReportDuration.avg_ms / 1000)
    : null

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
  if (insights.length > 0) {
    // Get the run id we'll insert
    const runInsert = await db.prepare(
      `INSERT INTO agent_runs (agent_type, status, summary, details_json, duration_ms)
       VALUES ('monitor', 'success', ?, ?, 0)`
    ).bind(
      `Health score ${health_score}/100 — ${insights.length} finding(s)`,
      JSON.stringify({ health_score, issues_found: insights.length }).slice(0, 4000)
    ).run()

    const runId = runInsert.meta?.last_row_id ?? null

    // Batch insert insights (D1 doesn't support bulk inserts, loop it)
    for (const ins of insights) {
      await db.prepare(
        `INSERT INTO platform_insights (category, severity, title, description, suggested_fix, source_run_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(ins.category, ins.severity, ins.title, ins.description, ins.suggested_fix, runId).run()
    }
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
  }
}

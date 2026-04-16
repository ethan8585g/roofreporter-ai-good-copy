// ============================================================
// Traffic Analyst Agent
// Reads site_analytics (populated by tracker.js) to understand
// visitor behaviour: which pages they leave, what they clicked
// before exiting, scroll depth, time on page, and session flows.
// Claude analyses the aggregated data and produces actionable UX
// insights stored in platform_insights (category = 'traffic').
//
// Self-improving: carries accumulated learnings in agent_memory
// so each run builds on the previous one.
// Schedule: every 12 hours (when hour % 12 === 0 in cron handler)
// ============================================================

import { getAnthropicClient, CLAUDE_MODEL, extractJson, readAgentMemory, writeAgentMemory } from './anthropic-client'
import type { Bindings } from '../types'

const AGENT_TYPE = 'traffic'

// ── Types ─────────────────────────────────────────────────────

export interface PageStats {
  page_url: string
  pageviews: number
  unique_sessions: number
  exit_count: number        // sessions whose last pageview was this page
  exit_rate: number         // exit_count / unique_sessions
  avg_scroll_depth: number  // 0-100
  avg_time_on_page: number  // seconds
  top_clicks: string[]      // most-clicked elements on this page
}

export interface SessionFlow {
  session_id: string
  pages: string[]           // ordered page path sequence
  total_time: number        // seconds
  exit_page: string
  max_scroll_on_exit: number
  last_click_before_exit: string | null
}

export interface TrafficMetrics {
  period_hours: number
  total_sessions: number
  total_pageviews: number
  bounce_sessions: number   // sessions with only 1 pageview
  bounce_rate: number       // 0-1
  top_exit_pages: PageStats[]
  top_landing_pages: PageStats[]
  low_engagement_pages: PageStats[]  // avg scroll < 30% or avg time < 15s
  top_clicked_elements: Array<{ element: string; text: string; page: string; count: number }>
  exit_click_patterns: Array<{ click_before_exit: string; count: number; exit_page: string }>
  device_breakdown: Record<string, number>
  traffic_sources: Array<{ source: string; sessions: number }>
}

export interface TrafficInsight {
  category: 'traffic'
  severity: 'critical' | 'high' | 'medium' | 'low'
  title: string
  description: string
  suggested_fix: string
}

export interface TrafficRunResult {
  ok: boolean
  sessions_analyzed: number
  insights_found: number
  critical_count: number
  top_exit_page: string | null
  bounce_rate_pct: number
  insights: TrafficInsight[]
  error?: string
}

// ── Data collection ───────────────────────────────────────────

export async function collectTrafficMetrics(
  db: D1Database,
  lookbackHours: number,
  maxEvents: number
): Promise<TrafficMetrics> {
  const since = new Date(Date.now() - lookbackHours * 3600 * 1000).toISOString()

  const [
    sessionStats,
    pageviewStats,
    exitStats,
    clickStats,
    exitClickStats,
    deviceStats,
    sourceStats,
  ] = await Promise.all([
    // Overall session counts
    db.prepare(`
      SELECT
        COUNT(DISTINCT session_id) as total_sessions,
        COUNT(*) as total_events
      FROM site_analytics
      WHERE created_at >= ? AND session_id IS NOT NULL
    `).bind(since).first<{ total_sessions: number; total_events: number }>(),

    // Per-page stats: pageviews, unique sessions, avg scroll, avg time
    db.prepare(`
      SELECT
        page_url,
        COUNT(*) as pageviews,
        COUNT(DISTINCT session_id) as unique_sessions,
        ROUND(AVG(CASE WHEN scroll_depth IS NOT NULL THEN scroll_depth ELSE 0 END), 1) as avg_scroll,
        ROUND(AVG(CASE WHEN time_on_page IS NOT NULL AND time_on_page > 0 THEN time_on_page ELSE NULL END), 1) as avg_time
      FROM site_analytics
      WHERE created_at >= ? AND event_type = 'pageview'
      GROUP BY page_url
      ORDER BY unique_sessions DESC
      LIMIT 30
    `).bind(since).all<any>(),

    // Exit pages: last pageview per session
    db.prepare(`
      SELECT page_url, COUNT(*) as exit_count
      FROM (
        SELECT session_id, page_url,
               ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at DESC) as rn
        FROM site_analytics
        WHERE created_at >= ? AND event_type = 'pageview' AND session_id IS NOT NULL
      ) ranked
      WHERE rn = 1
      GROUP BY page_url
      ORDER BY exit_count DESC
      LIMIT 15
    `).bind(since).all<any>(),

    // Top clicked elements
    db.prepare(`
      SELECT page_url, click_element, click_text, COUNT(*) as cnt
      FROM site_analytics
      WHERE created_at >= ? AND event_type = 'click'
        AND click_element IS NOT NULL AND click_element != ''
      GROUP BY page_url, click_element, click_text
      ORDER BY cnt DESC
      LIMIT 30
    `).bind(since).all<any>(),

    // Clicks that happened in the final event before a session exit
    db.prepare(`
      SELECT e.page_url as exit_page, e.click_element, e.click_text, COUNT(*) as cnt
      FROM site_analytics e
      JOIN (
        SELECT session_id, MAX(created_at) as last_ts
        FROM site_analytics
        WHERE created_at >= ? AND event_type = 'pageview' AND session_id IS NOT NULL
        GROUP BY session_id
      ) last_pv ON e.session_id = last_pv.session_id
      WHERE e.event_type = 'click'
        AND e.created_at >= last_pv.last_ts
        AND e.click_element IS NOT NULL AND e.click_element != ''
      GROUP BY e.page_url, e.click_element, e.click_text
      ORDER BY cnt DESC
      LIMIT 20
    `).bind(since).all<any>(),

    // Device breakdown
    db.prepare(`
      SELECT device_type, COUNT(DISTINCT session_id) as sessions
      FROM site_analytics
      WHERE created_at >= ? AND event_type = 'pageview' AND device_type IS NOT NULL
      GROUP BY device_type
    `).bind(since).all<any>(),

    // Traffic sources
    db.prepare(`
      SELECT
        COALESCE(utm_source, CASE WHEN referrer IS NULL OR referrer = '' THEN 'direct' ELSE 'organic' END) as source,
        COUNT(DISTINCT session_id) as sessions
      FROM site_analytics
      WHERE created_at >= ? AND event_type = 'pageview'
      GROUP BY source
      ORDER BY sessions DESC
      LIMIT 10
    `).bind(since).all<any>(),
  ])

  const totalSessions = sessionStats?.total_sessions || 0

  // Build exit rate map
  const exitMap: Record<string, number> = {}
  for (const row of exitStats.results || []) {
    exitMap[row.page_url] = row.exit_count
  }

  // Identify bounce sessions (only 1 pageview)
  const bounceRes = await db.prepare(`
    SELECT COUNT(*) as cnt FROM (
      SELECT session_id FROM site_analytics
      WHERE created_at >= ? AND event_type = 'pageview' AND session_id IS NOT NULL
      GROUP BY session_id
      HAVING COUNT(*) = 1
    )
  `).bind(since).first<{ cnt: number }>()
  const bounceSessions = bounceRes?.cnt || 0

  // Assemble page stats
  const allPages: PageStats[] = (pageviewStats.results || []).map((row: any) => {
    const exitCount = exitMap[row.page_url] || 0
    const topClicks = (clickStats.results || [])
      .filter((c: any) => c.page_url === row.page_url)
      .slice(0, 5)
      .map((c: any) => `${c.click_element}${c.click_text ? ' ("' + c.click_text + '")' : ''}`)
    return {
      page_url: row.page_url,
      pageviews: row.pageviews,
      unique_sessions: row.unique_sessions,
      exit_count: exitCount,
      exit_rate: row.unique_sessions > 0 ? exitCount / row.unique_sessions : 0,
      avg_scroll_depth: row.avg_scroll || 0,
      avg_time_on_page: row.avg_time || 0,
      top_clicks: topClicks,
    }
  })

  const topExitPages = [...allPages]
    .filter(p => p.unique_sessions >= 3)
    .sort((a, b) => b.exit_rate - a.exit_rate)
    .slice(0, 8)

  const topLandingPages = [...allPages]
    .sort((a, b) => b.unique_sessions - a.unique_sessions)
    .slice(0, 8)

  const lowEngagementPages = allPages.filter(
    p => p.unique_sessions >= 5 && (p.avg_scroll_depth < 30 || (p.avg_time_on_page > 0 && p.avg_time_on_page < 15))
  ).slice(0, 6)

  const topClickedElements = (clickStats.results || []).map((c: any) => ({
    element: c.click_element,
    text: c.click_text || '',
    page: c.page_url,
    count: c.cnt,
  })).slice(0, 15)

  const exitClickPatterns = (exitClickStats.results || []).map((c: any) => ({
    click_before_exit: `${c.click_element}${c.click_text ? ' ("' + c.click_text + '")' : ''}`,
    count: c.cnt,
    exit_page: c.exit_page,
  }))

  const deviceBreakdown: Record<string, number> = {}
  for (const row of deviceStats.results || []) {
    deviceBreakdown[row.device_type || 'unknown'] = row.sessions
  }

  const trafficSources = (sourceStats.results || []).map((r: any) => ({
    source: r.source,
    sessions: r.sessions,
  }))

  return {
    period_hours: lookbackHours,
    total_sessions: totalSessions,
    total_pageviews: sessionStats?.total_events || 0,
    bounce_sessions: bounceSessions,
    bounce_rate: totalSessions > 0 ? bounceSessions / totalSessions : 0,
    top_exit_pages: topExitPages,
    top_landing_pages: topLandingPages,
    low_engagement_pages: lowEngagementPages,
    top_clicked_elements: topClickedElements,
    exit_click_patterns: exitClickPatterns,
    device_breakdown: deviceBreakdown,
    traffic_sources: trafficSources,
  }
}

// ── Prompt builder ────────────────────────────────────────────

export function buildTrafficPrompt(metrics: TrafficMetrics, priorMemory: string): string {
  const bouncePct = Math.round(metrics.bounce_rate * 100)

  const exitPagesText = metrics.top_exit_pages.length === 0
    ? '• No data yet'
    : metrics.top_exit_pages.map(p =>
        `• ${p.page_url} — exit rate ${Math.round(p.exit_rate * 100)}% ` +
        `(${p.exit_count} exits / ${p.unique_sessions} sessions) | ` +
        `avg scroll: ${p.avg_scroll_depth}% | avg time: ${p.avg_time_on_page}s` +
        (p.top_clicks.length ? `\n  Top clicks: ${p.top_clicks.join(', ')}` : '')
      ).join('\n')

  const lowEngText = metrics.low_engagement_pages.length === 0
    ? '• None'
    : metrics.low_engagement_pages.map(p =>
        `• ${p.page_url} — scroll: ${p.avg_scroll_depth}%, time: ${p.avg_time_on_page}s, sessions: ${p.unique_sessions}`
      ).join('\n')

  const exitClickText = metrics.exit_click_patterns.length === 0
    ? '• No exit-click data yet'
    : metrics.exit_click_patterns.map(p =>
        `• ${p.click_before_exit} on ${p.exit_page} — ${p.count}× before leaving`
      ).join('\n')

  const topClicksText = metrics.top_clicked_elements.slice(0, 10).map(c =>
    `• [${c.page}] ${c.element}${c.text ? ' ("' + c.text + '")' : ''} — ${c.count}×`
  ).join('\n') || '• No click data'

  const deviceText = Object.entries(metrics.device_breakdown)
    .map(([k, v]) => `${k}: ${v}`).join(' | ') || 'unknown'

  const sourceText = metrics.traffic_sources
    .map(s => `${s.source}: ${s.sessions} sessions`).join(' | ') || 'no source data'

  return `You are a senior UX and conversion rate optimization expert analyzing traffic data for Roof Manager (roofmanager.ca).

Product: SaaS roofing measurement platform. Goal: convert Canadian roofing contractors from landing page visitors into paying subscribers.
Key conversion pages: /, /pricing, /lander/*, /customer/login (signup), /order/new (first order).

TRAFFIC OVERVIEW (last ${metrics.period_hours}h)
-----------------------------------------------
Total sessions:     ${metrics.total_sessions}
Total pageviews:    ${metrics.total_pageviews}
Bounce sessions:    ${metrics.bounce_sessions} (${bouncePct}% bounce rate)
Devices:            ${deviceText}
Traffic sources:    ${sourceText}

TOP EXIT PAGES (pages where visitors most commonly leave the site)
------------------------------------------------------------------
${exitPagesText}

LOW-ENGAGEMENT PAGES (low scroll depth or time on page)
-------------------------------------------------------
${lowEngText}

WHAT USERS CLICKED BEFORE LEAVING (exit-click patterns)
--------------------------------------------------------
${exitClickText}

TOP CLICKED ELEMENTS OVERALL
-----------------------------
${topClicksText}

ACCUMULATED KNOWLEDGE (from prior scans — use this to detect trends)
---------------------------------------------------------------------
${priorMemory || '• First scan — no prior data. Focus on establishing baselines and immediate problems.'}

ANALYSIS TASK
-------------
Based on the data above:
1. Identify why users are leaving the top exit pages — infer from scroll depth, time, and what they clicked last
2. Flag any pages with severely low engagement that need UX fixes
3. Identify which CTAs or navigation elements are driving exits vs conversions
4. Spot any conversion funnel drop-offs (e.g., users landing on pricing but not clicking signup)
5. Provide specific, actionable recommendations (copy changes, CTA repositioning, content additions, page restructuring)
6. Note any trends compared to prior scans (bounce rate improving? Exit page shifting?)

Write a memory_update paragraph capturing current baselines, trends, and what you know about this site's visitor behaviour — this is fed back to you next scan.

STRICT JSON response (no markdown fences, no extra text):
{
  "insights": [
    {
      "severity": <"critical"|"high"|"medium"|"low">,
      "title": <string, max 80 chars>,
      "description": <string — clear diagnosis of the problem and what the data shows>,
      "suggested_fix": <string — specific actionable recommendation>
    }
  ],
  "memory_update": <string — dense paragraph of visitor behaviour trends for future scans>
}`
}

// ── Response parser ───────────────────────────────────────────

const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low'])

export function parseTrafficFindings(text: string): {
  insights: TrafficInsight[]
  memory_update: string
} {
  try {
    const raw = extractJson<any>(text)
    const insights: TrafficInsight[] = (Array.isArray(raw.insights) ? raw.insights : [])
      .slice(0, 15)
      .map((i: any) => ({
        category: 'traffic' as const,
        severity: VALID_SEVERITIES.has(i.severity) ? i.severity : 'medium',
        title: String(i.title || 'UX Finding').slice(0, 80),
        description: String(i.description || ''),
        suggested_fix: String(i.suggested_fix || ''),
      }))
    return {
      insights,
      memory_update: String(raw.memory_update || '').slice(0, 3000),
    }
  } catch {
    return { insights: [], memory_update: '' }
  }
}

// ── Main runner ───────────────────────────────────────────────

export async function runTrafficAgent(env: Bindings): Promise<TrafficRunResult> {
  // Guard: API key must be present before doing any work
  if (!env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      sessions_analyzed: 0,
      insights_found: 0,
      critical_count: 0,
      top_exit_page: null,
      bounce_rate_pct: 0,
      insights: [],
      error: 'ANTHROPIC_API_KEY not configured',
    }
  }

  const db = env.DB

  // Load config
  const configRow = await db.prepare(
    `SELECT config_json FROM agent_configs WHERE agent_type = 'traffic'`
  ).first<{ config_json: string | null }>().catch(() => null)

  let lookbackHours = 24
  let maxEvents = 500
  let minSessions = 3
  try {
    if (configRow?.config_json) {
      const cfg = JSON.parse(configRow.config_json)
      if (cfg.lookback_hours) lookbackHours = Number(cfg.lookback_hours)
      if (cfg.max_events_analyzed) maxEvents = Number(cfg.max_events_analyzed)
      if (cfg.min_sessions) minSessions = Number(cfg.min_sessions)
    }
  } catch {}

  // Collect metrics from site_analytics
  const metrics = await collectTrafficMetrics(db, lookbackHours, maxEvents)

  // Respect min_sessions threshold — skip if not enough data for meaningful analysis
  if (metrics.total_sessions < minSessions) {
    return {
      ok: true,
      sessions_analyzed: metrics.total_sessions,
      insights_found: 0,
      critical_count: 0,
      top_exit_page: null,
      bounce_rate_pct: Math.round(metrics.bounce_rate * 100),
      insights: [],
    }
  }

  // Read prior memory
  const priorMemory = await readAgentMemory(db, AGENT_TYPE, 'traffic_summary')

  // Call Claude
  const client = getAnthropicClient(env.ANTHROPIC_API_KEY)
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: buildTrafficPrompt(metrics, priorMemory) }],
  })

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as any).text)
    .join('')

  const { insights, memory_update } = parseTrafficFindings(text)

  // Persist insights to platform_insights table
  for (const ins of insights) {
    await db.prepare(
      `INSERT INTO platform_insights (category, severity, title, description, suggested_fix)
       VALUES (?, ?, ?, ?, ?)`
    ).bind('traffic', ins.severity, ins.title, ins.description, ins.suggested_fix).run()
      .catch(() => {})
  }

  // Persist memory
  if (memory_update) {
    await writeAgentMemory(db, AGENT_TYPE, 'traffic_summary', memory_update)
  }

  const criticalCount = insights.filter(i => i.severity === 'critical').length
  const topExitPage = metrics.top_exit_pages[0]?.page_url || null

  return {
    ok: true,
    sessions_analyzed: metrics.total_sessions,
    insights_found: insights.length,
    critical_count: criticalCount,
    top_exit_page: topExitPage,
    bounce_rate_pct: Math.round(metrics.bounce_rate * 100),
    insights,
  }
}

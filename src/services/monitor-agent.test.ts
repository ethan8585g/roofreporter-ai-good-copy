import { describe, it, expect } from 'vitest'
import {
  buildMonitorPrompt,
  parseMonitorFindings,
  computeHealthScore,
  autoAdjustTracingThreshold,
  type PlatformMetrics,
  type TracingAccuracyMetrics,
} from './monitor-agent'

// ── Fixtures ──────────────────────────────────────────────────

const healthyTracing: TracingAccuracyMetrics = {
  avg_confidence_7d: 82,
  avg_confidence_prev_7d: 80,
  flagged_rate_7d: 0.08,
  success_rate_7d: 0.92,
  total_jobs_7d: 25,
  current_threshold: 60,
}

const poorTracing: TracingAccuracyMetrics = {
  avg_confidence_7d: 55,
  avg_confidence_prev_7d: 72,
  flagged_rate_7d: 0.5,
  success_rate_7d: 0.5,
  total_jobs_7d: 20,
  current_threshold: 60,
}

const healthyMetrics: PlatformMetrics = {
  failed_orders_24h: 0,
  stuck_reports: 0,
  failed_agent_runs_24h: 0,
  total_agent_runs_24h: 40,
  error_rate_24h: 0,
  pending_payments: 0,
  unprocessed_leads: 2,
  blog_posts_this_week: 4,
  avg_report_duration_sec: 8,
  open_issues_count: 0,
  recent_errors: [],
  tracing: healthyTracing,
}

const degradedMetrics: PlatformMetrics = {
  failed_orders_24h: 5,
  stuck_reports: 3,
  failed_agent_runs_24h: 8,
  total_agent_runs_24h: 20,
  error_rate_24h: 0.4,
  pending_payments: 3,
  unprocessed_leads: 12,
  blog_posts_this_week: 0,
  avg_report_duration_sec: 120,
  open_issues_count: 7,
  recent_errors: ['Agent crash: ANTHROPIC_API_KEY not set', 'D1 query timeout'],
  tracing: poorTracing,
}

// ── buildMonitorPrompt ────────────────────────────────────────

describe('buildMonitorPrompt', () => {
  it('includes failed order count', () => {
    const prompt = buildMonitorPrompt(degradedMetrics, '')
    expect(prompt).toContain('5')
  })

  it('includes error rate as percentage', () => {
    const prompt = buildMonitorPrompt(degradedMetrics, '')
    expect(prompt).toContain('40%')
  })

  it('includes unprocessed leads', () => {
    const prompt = buildMonitorPrompt(degradedMetrics, '')
    expect(prompt).toContain('12')
  })

  it('includes blog post count', () => {
    const prompt = buildMonitorPrompt(healthyMetrics, '')
    expect(prompt).toContain('4')
  })

  it('includes prior memory when provided', () => {
    const prompt = buildMonitorPrompt(healthyMetrics, 'Prior: platform has been stable for 2 weeks')
    expect(prompt).toContain('Prior: platform has been stable')
  })

  it('shows first-scan message when no prior memory', () => {
    const prompt = buildMonitorPrompt(healthyMetrics, '')
    expect(prompt).toContain('first scan')
  })

  it('includes recent error messages', () => {
    const prompt = buildMonitorPrompt(degradedMetrics, '')
    expect(prompt).toContain('ANTHROPIC_API_KEY not set')
  })

  it('shows no-errors message when recent_errors is empty', () => {
    const prompt = buildMonitorPrompt(healthyMetrics, '')
    expect(prompt).toContain('No recent errors logged')
  })

  it('instructs STRICT JSON output', () => {
    const prompt = buildMonitorPrompt(healthyMetrics, '')
    expect(prompt).toContain('STRICT JSON')
  })

  it('shows avg report duration when available', () => {
    const prompt = buildMonitorPrompt(healthyMetrics, '')
    expect(prompt).toContain('8s')
  })

  it('shows unknown when avg duration is null', () => {
    const metrics = { ...healthyMetrics, avg_report_duration_sec: null }
    const prompt = buildMonitorPrompt(metrics, '')
    expect(prompt).toContain('unknown')
  })
})

// ── parseMonitorFindings ──────────────────────────────────────

describe('parseMonitorFindings', () => {
  const validResponse = JSON.stringify({
    health_score: 82,
    insights: [
      {
        category: 'bug',
        severity: 'high',
        title: 'Stuck reports not auto-retried',
        description: 'Reports older than 30 min stay in generating state indefinitely.',
        suggested_fix: 'Add a cleanup cron that resets stale reports after 60 min.',
      },
    ],
    memory_update: 'Platform baseline: ~40 agent runs/day, 0% error rate when healthy.',
  })

  it('parses valid response', () => {
    const result = parseMonitorFindings(validResponse)
    expect(result.health_score).toBe(82)
    expect(result.insights).toHaveLength(1)
    expect(result.insights[0].title).toBe('Stuck reports not auto-retried')
  })

  it('parses memory_update', () => {
    const result = parseMonitorFindings(validResponse)
    expect(result.memory_update).toContain('40 agent runs')
  })

  it('clamps health_score above 100 to 100', () => {
    const json = JSON.stringify({ health_score: 150, insights: [], memory_update: '' })
    expect(parseMonitorFindings(json).health_score).toBe(100)
  })

  it('clamps health_score below 0 to 0', () => {
    const json = JSON.stringify({ health_score: -20, insights: [], memory_update: '' })
    expect(parseMonitorFindings(json).health_score).toBe(0)
  })

  it('strips markdown fences before parsing', () => {
    const fenced = '```json\n' + validResponse + '\n```'
    const result = parseMonitorFindings(fenced)
    expect(result.health_score).toBe(82)
  })

  it('returns safe defaults on invalid JSON', () => {
    const result = parseMonitorFindings('not json at all')
    expect(result.health_score).toBe(75)
    expect(result.insights).toHaveLength(0)
    expect(result.memory_update).toBe('')
  })

  it('normalises unknown category to improvement', () => {
    const json = JSON.stringify({
      health_score: 70,
      insights: [{ category: 'mystery', severity: 'medium', title: 'T', description: 'D', suggested_fix: 'F' }],
      memory_update: '',
    })
    const result = parseMonitorFindings(json)
    expect(result.insights[0].category).toBe('improvement')
  })

  it('normalises unknown severity to low', () => {
    const json = JSON.stringify({
      health_score: 70,
      insights: [{ category: 'bug', severity: 'extreme', title: 'T', description: 'D', suggested_fix: 'F' }],
      memory_update: '',
    })
    const result = parseMonitorFindings(json)
    expect(result.insights[0].severity).toBe('low')
  })

  it('caps insights at 20 entries', () => {
    const insights = Array.from({ length: 30 }, (_, i) => ({
      category: 'bug', severity: 'low', title: `Issue ${i}`, description: '', suggested_fix: '',
    }))
    const json = JSON.stringify({ health_score: 60, insights, memory_update: '' })
    const result = parseMonitorFindings(json)
    expect(result.insights).toHaveLength(20)
  })

  it('truncates title to 80 chars', () => {
    const longTitle = 'A'.repeat(120)
    const json = JSON.stringify({
      health_score: 70,
      insights: [{ category: 'bug', severity: 'low', title: longTitle, description: '', suggested_fix: '' }],
      memory_update: '',
    })
    const result = parseMonitorFindings(json)
    expect(result.insights[0].title).toHaveLength(80)
  })
})

// ── computeHealthScore ────────────────────────────────────────

describe('computeHealthScore', () => {
  it('returns 100 for a perfectly healthy platform', () => {
    const metrics = { ...healthyMetrics, blog_posts_this_week: 3 }
    expect(computeHealthScore(metrics)).toBeGreaterThanOrEqual(100)
  })

  it('deducts for failed orders', () => {
    const score = computeHealthScore({ ...healthyMetrics, failed_orders_24h: 3 })
    expect(score).toBeLessThan(100)
  })

  it('deducts for stuck reports', () => {
    const score = computeHealthScore({ ...healthyMetrics, stuck_reports: 2 })
    expect(score).toBeLessThan(100)
  })

  it('deducts heavily for high error rate', () => {
    // healthyMetrics has blog_posts_this_week: 4 (+5 boost), so 100 - 20 + 5 = 85
    const score = computeHealthScore({ ...healthyMetrics, error_rate_24h: 0.5 })
    expect(score).toBeLessThan(90)
  })

  it('never goes below 0', () => {
    expect(computeHealthScore(degradedMetrics)).toBeGreaterThanOrEqual(0)
  })

  it('never goes above 100', () => {
    expect(computeHealthScore(healthyMetrics)).toBeLessThanOrEqual(100)
  })

  it('boosts score for frequent blog posts (>=3/week)', () => {
    // Use a slightly imperfect platform so the +5 blog boost is visible above the base
    const base = { ...healthyMetrics, failed_orders_24h: 1, blog_posts_this_week: 0 }
    const noPostsScore  = computeHealthScore(base)
    const withPostsScore = computeHealthScore({ ...base, blog_posts_this_week: 4 })
    expect(withPostsScore).toBeGreaterThan(noPostsScore)
  })

  it('deducts for poor tracing accuracy', () => {
    const good = computeHealthScore({ ...healthyMetrics, tracing: healthyTracing })
    const poor = computeHealthScore({ ...healthyMetrics, tracing: poorTracing })
    expect(poor).toBeLessThan(good)
  })
})

// ── autoAdjustTracingThreshold ────────────────────────────────

describe('autoAdjustTracingThreshold', () => {
  // Minimal stub DB that handles both .prepare().first() and .prepare().bind(...).run()
  function makeDb(configJson: string | null = null) {
    let stored: string | null = configJson
    return {
      prepare(_sql: string) {
        return {
          // Direct call without bind (SELECT without params)
          first: async () => stored !== null ? { config_json: stored } : null,
          // Chained: .bind(...).run() or .bind(...).first()
          bind: (...args: any[]) => ({
            first: async () => stored !== null ? { config_json: stored } : null,
            run:   async () => { if (args[0] != null) stored = String(args[0]) },
          }),
          run: async () => {},
        }
      },
      _getStored: () => stored,
    } as any
  }

  it('raises threshold when accuracy is declining', async () => {
    const db = makeDb(JSON.stringify({ confidence_threshold: 60 }))
    const tracing: TracingAccuracyMetrics = {
      ...poorTracing,
      avg_confidence_7d: 60,
      avg_confidence_prev_7d: 75,  // dropped 15 points
      flagged_rate_7d: 0.3,
      total_jobs_7d: 20,
      current_threshold: 60,
    }
    const result = await autoAdjustTracingThreshold(db, tracing)
    expect(result.adjusted).toBe(true)
    expect(result.new_threshold).toBeGreaterThan(result.old_threshold)
  })

  it('raises threshold when flag rate is too high (>40%)', async () => {
    const db = makeDb(JSON.stringify({ confidence_threshold: 60 }))
    const tracing: TracingAccuracyMetrics = {
      ...healthyTracing,
      flagged_rate_7d: 0.45,
      avg_confidence_7d: 65,
      avg_confidence_prev_7d: 66,  // stable (no trend trigger)
      total_jobs_7d: 20,
      current_threshold: 60,
    }
    const result = await autoAdjustTracingThreshold(db, tracing)
    expect(result.adjusted).toBe(true)
    expect(result.new_threshold).toBe(65)
  })

  it('does not adjust when less than 3 jobs', async () => {
    const db = makeDb(null)
    const tracing: TracingAccuracyMetrics = { ...poorTracing, total_jobs_7d: 2 }
    const result = await autoAdjustTracingThreshold(db, tracing)
    expect(result.adjusted).toBe(false)
  })

  it('does not raise above max threshold (85)', async () => {
    const db = makeDb(JSON.stringify({ confidence_threshold: 85 }))
    const tracing: TracingAccuracyMetrics = {
      ...poorTracing,
      avg_confidence_prev_7d: 90,
      avg_confidence_7d: 50,
      total_jobs_7d: 10,
      current_threshold: 85,
    }
    const result = await autoAdjustTracingThreshold(db, tracing)
    expect(result.new_threshold).toBeLessThanOrEqual(85)
  })

  it('does not adjust when already at default and accuracy is stable', async () => {
    const db = makeDb(null)
    const tracing: TracingAccuracyMetrics = {
      ...healthyTracing,
      avg_confidence_7d:      80,
      avg_confidence_prev_7d: 79,  // stable, no decline trigger
      flagged_rate_7d:        0.08, // < 40%
      total_jobs_7d:          15,
      current_threshold:      60,   // already at default
    }
    const result = await autoAdjustTracingThreshold(db, tracing)
    expect(result.adjusted).toBe(false)
  })
})

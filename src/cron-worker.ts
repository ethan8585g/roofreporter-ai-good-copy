// ============================================================
// Cron Worker — Autonomous Agent Hub scheduler
// Deployed separately as a Cloudflare Worker (not Pages).
// Fires every 10 minutes via wrangler-cron.jsonc triggers.
// Each agent is gated by its agent_configs.enabled flag + time logic.
// ============================================================

import type { Bindings } from './types'
import { processOrderQueue } from './services/ai-agent'
import { runContentAgent } from './services/content-agent'
import { runLeadAgent } from './services/lead-agent'
import { runEmailAgent } from './services/email-agent'
import { runMonitorAgent } from './services/monitor-agent'

export default {
  // No-op fetch handler — this worker only exists for cron
  async fetch(): Promise<Response> {
    return new Response('Agent cron worker — no HTTP interface', { status: 200 })
  },

  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    const now = new Date()
    const hour = now.getUTCHours()
    const dayOfWeek = now.getUTCDay() // 0=Sun, 2=Tue

    async function isAgentEnabled(agentType: string): Promise<boolean> {
      const row = await env.DB.prepare(
        `SELECT enabled FROM agent_configs WHERE agent_type = ?`
      ).bind(agentType).first<{ enabled: number }>()
      return row?.enabled === 1
    }

    async function logRun(agentType: string, status: string, summary: string, details: any, durationMs: number) {
      try {
        await env.DB.prepare(
          `INSERT INTO agent_runs (agent_type, status, summary, details_json, duration_ms) VALUES (?, ?, ?, ?, ?)`
        ).bind(agentType, status, summary, JSON.stringify(details).slice(0, 4000), durationMs).run()
        await env.DB.prepare(
          `UPDATE agent_configs SET last_run_at=datetime('now'), last_run_status=?, last_run_details=?,
           run_count=run_count+1, error_count=error_count+CASE WHEN ?='error' THEN 1 ELSE 0 END,
           updated_at=datetime('now') WHERE agent_type=?`
        ).bind(status, summary.slice(0, 500), status, agentType).run()
      } catch {}
    }

    // ── Tracing Agent (every cron tick — every 10 min) ────────
    if (await isAgentEnabled('tracing')) {
      ctx.waitUntil((async () => {
        const t0 = Date.now()
        try {
          const result = await processOrderQueue(env)
          const summary = `Processed ${result.processed.length} order(s)`
          console.log(`[CRON:tracing] ${summary}`)
          await logRun('tracing', 'success', summary, result.stats, Date.now() - t0)
        } catch (err: any) {
          console.error('[CRON:tracing] Error:', err.message)
          await logRun('tracing', 'error', err.message, {}, Date.now() - t0)
        }
      })())
    }

    // ── Content Agent (daily at 8am UTC) ─────────────────────
    if (hour === 8 && await isAgentEnabled('content')) {
      ctx.waitUntil((async () => {
        const t0 = Date.now()
        try {
          const result = await runContentAgent(env)
          const summary = result.skipped ? 'No keywords in queue'
            : result.ok ? `Published "${result.keyword}" (q=${result.quality?.overall}%)`
            : `Failed: ${result.error}`
          console.log(`[CRON:content] ${summary}`)
          await logRun('content', result.ok ? 'success' : (result.skipped ? 'skipped' : 'error'), summary, result, Date.now() - t0)
        } catch (err: any) {
          console.error('[CRON:content] Error:', err.message)
          await logRun('content', 'error', err.message, {}, Date.now() - t0)
        }
      })())
    }

    // ── Lead Agent (every 2 hours) ────────────────────────────
    if (hour % 2 === 0 && await isAgentEnabled('lead')) {
      ctx.waitUntil((async () => {
        const t0 = Date.now()
        try {
          const result = await runLeadAgent(env)
          const summary = result.responded === 0 ? 'No new leads'
            : `Responded to ${result.responded} lead(s)`
          console.log(`[CRON:lead] ${summary}`)
          await logRun('lead', result.ok ? 'success' : 'error', summary, result, Date.now() - t0)
        } catch (err: any) {
          console.error('[CRON:lead] Error:', err.message)
          await logRun('lead', 'error', err.message, {}, Date.now() - t0)
        }
      })())
    }

    // ── Email Agent (Tuesdays at 10am UTC) ───────────────────
    if (dayOfWeek === 2 && hour === 10 && await isAgentEnabled('email')) {
      ctx.waitUntil((async () => {
        const t0 = Date.now()
        try {
          const result = await runEmailAgent(env)
          const summary = result.skipped ? 'No contacts to email'
            : result.ok ? `Sent "${result.campaign_name}" to ${result.sent} contact(s)`
            : `Failed: ${result.errors?.[0]}`
          console.log(`[CRON:email] ${summary}`)
          await logRun('email', result.ok ? 'success' : (result.skipped ? 'skipped' : 'error'), summary, result, Date.now() - t0)
        } catch (err: any) {
          console.error('[CRON:email] Error:', err.message)
          await logRun('email', 'error', err.message, {}, Date.now() - t0)
        }
      })())
    }

    // ── Monitor Agent (every 6 hours: 0, 6, 12, 18 UTC) ──────
    if (hour % 6 === 0 && await isAgentEnabled('monitor')) {
      ctx.waitUntil((async () => {
        const t0 = Date.now()
        try {
          const result = await runMonitorAgent(env)
          const summary = `Health ${result.health_score}/100 — ${result.issues_found} finding(s)${result.critical_count > 0 ? ` (${result.critical_count} critical!)` : ''}`
          console.log(`[CRON:monitor] ${summary}`)
          await logRun('monitor', result.ok ? 'success' : 'error', summary, { health_score: result.health_score, issues_found: result.issues_found }, Date.now() - t0)
        } catch (err: any) {
          console.error('[CRON:monitor] Error:', err.message)
          await logRun('monitor', 'error', err.message, {}, Date.now() - t0)
        }
      })())
    }
  },
}

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
import { runTrafficAgent } from './services/traffic-agent'
import { sweepAutoInvoices } from './services/auto-invoice'

// ── Abandoned signup recovery ─────────────────────────────────────────────────
async function runAbandonedSignupRecovery(env: Bindings): Promise<{ sent: number; skipped: number }> {
  const db = (env as any).DB
  const resendKey = (env as any).RESEND_API_KEY
  if (!resendKey) return { sent: 0, skipped: 0 }

  // Find attempts ≥1 hour old, not completed, not already recovered, not opted out
  let rows: any[] = []
  try {
    const result = await db.prepare(`
      SELECT sa.id, sa.email, sa.preview_id
      FROM signup_attempts sa
      WHERE sa.completed = 0
        AND sa.recovery_sent = 0
        AND sa.created_at < datetime('now', '-1 hour')
        AND NOT EXISTS (
          SELECT 1 FROM signup_recovery_optouts sro WHERE sro.email = sa.email
        )
        AND NOT EXISTS (
          SELECT 1 FROM customers c WHERE c.email = sa.email
        )
      LIMIT 50
    `).all<any>()
    rows = result.results || []
  } catch (err: any) {
    console.warn('[recovery] query failed (tables may not exist):', err?.message)
    return { sent: 0, skipped: 0 }
  }

  let sent = 0
  let skipped = 0
  for (const row of rows) {
    const optoutUrl = `https://www.roofmanager.ca/api/customer/signup-optout?email=${encodeURIComponent(row.email)}`
    const registerUrl = `https://www.roofmanager.ca/register?email=${encodeURIComponent(row.email)}${row.preview_id ? `&preview_id=${row.preview_id}` : ''}`
    const html = `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
        <h2 style="color:#0A0A0A;margin-bottom:8px">You left before finishing — here's your roof report</h2>
        <p style="color:#374151;margin-bottom:24px">
          We noticed you started setting up your Roof Manager account but didn't finish.
          Your free roof preview is waiting — complete your registration to access it.
        </p>
        <a href="${registerUrl}" style="display:inline-block;background:#00FF88;color:#0A0A0A;font-weight:700;padding:14px 28px;border-radius:10px;text-decoration:none;font-size:16px;margin-bottom:24px">
          Complete My Registration →
        </a>
        <p style="color:#6b7280;font-size:12px">
          <a href="${optoutUrl}" style="color:#9ca3af">Unsubscribe</a> · Roof Manager, roofmanager.ca
        </p>
      </div>
    `
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Roof Manager <noreply@roofmanager.ca>',
          to: [row.email],
          subject: 'You left before finishing — your roof preview is waiting',
          html,
        }),
      })
      if (res.ok) {
        await db.prepare(`UPDATE signup_attempts SET recovery_sent = 1, recovery_sent_at = datetime('now') WHERE id = ?`).bind(row.id).run()
        sent++
      } else {
        skipped++
      }
    } catch (err: any) {
      console.error('[recovery] email send error:', err?.message)
      skipped++
    }
  }
  return { sent, skipped }
}

export default {
  // No-op fetch handler — this worker only exists for cron
  async fetch(): Promise<Response> {
    return new Response('Agent cron worker — no HTTP interface', { status: 200 })
  },

  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    const now = new Date()
    const hour = now.getUTCHours()
    const minute = now.getUTCMinutes()
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

    // ── Lead Agent (every 5 minutes — every cron tick) ───────
    if (await isAgentEnabled('lead')) {
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

    // ── Monitor Agent (every hour — fires on the :00 tick) ───
    if (minute === 0 && await isAgentEnabled('monitor')) {
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

    // ── Abandoned Signup Recovery (every hour on :00 tick) ──
    if (minute === 0) {
      ctx.waitUntil((async () => {
        try {
          const result = await runAbandonedSignupRecovery(env)
          console.log(`[CRON:signup-recovery] Sent ${result.sent}, skipped ${result.skipped}`)
        } catch (err: any) {
          console.error('[CRON:signup-recovery] Error:', err.message)
        }
      })())
    }

    // ── Auto-Invoice Sweep (every cron tick — every 10 min) ───
    // Safety net for races where the inline hook on report completion
    // didn't fire (worker killed, deploy boundary, etc). Idempotent.
    ctx.waitUntil((async () => {
      const t0 = Date.now()
      try {
        const created = await sweepAutoInvoices(env, 60)
        if (created > 0) console.log(`[CRON:auto-invoice] Drafted ${created} proposal(s)`)
      } catch (err: any) {
        console.error('[CRON:auto-invoice] Error:', err?.message)
      }
    })())

    // ── Traffic Analyst Agent — hourly fallback (on :00 tick) ─
    // Primary trigger is event-driven (fires via /api/analytics/track
    // whenever a page_exit arrives, rate-limited to 10-min cooldown).
    // This hourly cron is a safety net for low-traffic periods.
    // It also respects the same 10-min cooldown so it never double-fires
    // right after an event-driven run.
    if (minute === 0 && await isAgentEnabled('traffic')) {
      ctx.waitUntil((async () => {
        try {
          // Cooldown check: skip if the live trigger already ran within the last 10 minutes
          const config = await env.DB.prepare(
            `SELECT last_run_at FROM agent_configs WHERE agent_type = 'traffic'`
          ).first<{ last_run_at: string | null }>()
          const lastRun = config?.last_run_at ? new Date(config.last_run_at).getTime() : 0
          if (Date.now() - lastRun < 10 * 60 * 1000) {
            console.log('[CRON:traffic] Skipped — live trigger ran recently')
            return
          }

          const t0 = Date.now()
          const result = await runTrafficAgent(env)
          const summary = result.sessions_analyzed === 0
            ? 'No visitor sessions to analyze yet'
            : `Analyzed ${result.sessions_analyzed} sessions — ${result.insights_found} UX finding(s), ${result.bounce_rate_pct}% bounce rate${result.top_exit_page ? `, top exit: ${result.top_exit_page}` : ''}`
          console.log(`[CRON:traffic] ${summary}`)
          await logRun('traffic', result.ok ? 'success' : 'error', summary, { sessions: result.sessions_analyzed, insights: result.insights_found }, Date.now() - t0)
        } catch (err: any) {
          console.error('[CRON:traffic] Error:', err.message)
          await logRun('traffic', 'error', err.message, {}, Date.now())
        }
      })())
    }
  },
}

// ============================================================
// Cron Worker — Autonomous Agent Hub scheduler
// Deployed separately as a Cloudflare Worker (not Pages).
// Fires every 10 minutes via wrangler-cron.jsonc triggers.
// Each agent is gated by its agent_configs.enabled flag + time logic.
// ============================================================

import type { Bindings } from './types'
import { processOrderQueue } from './services/ai-agent'
import { runOnce as runBlogAgent } from './services/blog-agent'
import { runLeadAgent } from './services/lead-agent'
import { runEmailAgent } from './services/email-agent'
import { runMonitorAgent } from './services/monitor-agent'
import { runTrafficAgent } from './services/traffic-agent'
import { runNightlyAttributionRollup } from './services/attribution'
import { runScan as runLoopScan, writeHeartbeat as writeLoopHeartbeat, touchDefinition as touchLoopDefinition, recordExternalRun, type ScanType } from './services/loop-scanner'
import { pruneExpiredScanSessions } from './services/synthetic-auth'
import { runBacklinkHealthSweep } from './routes/backlinks'
import { runAdsHealthCheck } from './services/ads-health'
import { sendAdsHealthEmail } from './services/ads-health-email'
import { runSignupJourney } from './services/signup-journey'
import { sendJourneyEmail } from './services/journey-email'
import { runSignupHealthCheck } from './services/signup-health'
import { sendSignupHealthEmail } from './services/health-email'

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
        <div style="text-align:center;background:#000;padding:20px;border-radius:12px 12px 0 0;margin:-32px -32px 24px">
          <img src="https://www.roofmanager.ca/static/logo.png?v=20260504" alt="Roof Manager" width="160" style="max-width:160px;height:auto;display:block;margin:0 auto"/>
        </div>
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

// ── Rover chat session idle/ended sweep ───────────────────────────────────────
// Phase 3 #13: rover_conversations.status only ever transitioned 'active'→'ended'
// when an admin explicitly closed a chat. The Inbox UI surfaced every dormant
// chat as "Active". This sweep transitions sessions based on last_message_at:
//   no message in 30 min  → 'idle'
//   no message in 24 hr   → 'ended'
const ROVER_IDLE_AFTER_MIN = 30
const ROVER_END_AFTER_HOURS = 24
async function runRoverSessionSweep(env: Bindings): Promise<{ idled: number; ended: number }> {
  const db = (env as any).DB
  let idled = 0
  let ended = 0
  try {
    const endRes = await db.prepare(
      `UPDATE rover_conversations
          SET status = 'ended', ended_at = COALESCE(ended_at, datetime('now')), updated_at = datetime('now')
        WHERE status IN ('active','idle')
          AND COALESCE(last_message_at, created_at) < datetime('now', '-${ROVER_END_AFTER_HOURS} hours')`
    ).run()
    ended = (endRes as any)?.meta?.changes || 0
  } catch (err: any) {
    console.warn('[rover-sweep] end pass failed:', err?.message)
  }
  try {
    const idleRes = await db.prepare(
      `UPDATE rover_conversations
          SET status = 'idle', updated_at = datetime('now')
        WHERE status = 'active'
          AND COALESCE(last_message_at, created_at) < datetime('now', '-${ROVER_IDLE_AFTER_MIN} minutes')`
    ).run()
    idled = (idleRes as any)?.meta?.changes || 0
  } catch (err: any) {
    console.warn('[rover-sweep] idle pass failed:', err?.message)
  }
  return { idled, ended }
}

// ── Roofer Secretary trial management ─────────────────────────────────────────
// Sends a day-25 reminder email via Resend and auto-cancels past_due subscriptions
// that have been stuck for more than 7 days. Square handles the actual day-31
// charge automatically via the subscription start_date; the webhook flips status.
async function runSecretaryTrialManagement(env: Bindings): Promise<{ remindersSent: number; pastDueCancelled: number }> {
  const db = (env as any).DB
  const resendKey = (env as any).RESEND_API_KEY
  let remindersSent = 0
  let pastDueCancelled = 0

  // 1. Trial ending in 2–3 days → reminder email (idempotent via billing event log).
  try {
    const rows = await db.prepare(`
      SELECT ss.id, ss.customer_id, ss.trial_ends_at, ss.card_last4, c.email, c.name
      FROM secretary_subscriptions ss
      JOIN customers c ON c.id = ss.customer_id
      WHERE ss.status = 'trialing'
        AND ss.trial_ends_at IS NOT NULL
        AND datetime(ss.trial_ends_at) BETWEEN datetime('now','+2 days') AND datetime('now','+3 days')
        AND NOT EXISTS (
          SELECT 1 FROM secretary_billing_events sbe
          WHERE sbe.customer_id = ss.customer_id AND sbe.event_type = 'trial_ending_soon'
            AND sbe.created_at > datetime('now','-7 days')
        )
      LIMIT 100
    `).all<any>()

    for (const row of (rows.results || [])) {
      if (!resendKey || !row.email) continue
      const html = `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
          <div style="text-align:center;background:#000;padding:20px;border-radius:12px 12px 0 0;margin:-32px -32px 24px">
            <img src="https://www.roofmanager.ca/static/logo.png?v=20260504" alt="Roof Manager" width="160" style="max-width:160px;height:auto;display:block;margin:0 auto"/>
          </div>
          <h2 style="color:#0A0A0A">Your Roofer Secretary trial ends in 3 days</h2>
          <p style="color:#374151">Hi ${row.name || 'there'},</p>
          <p style="color:#374151">
            Your 1-month free trial of Roofer Secretary ends on <strong>${row.trial_ends_at}</strong>.
            On that date we'll charge the card ending in ${row.card_last4 || '••••'} <strong>$199</strong> for your first monthly subscription.
          </p>
          <p style="color:#374151">
            Want to keep answering every call with AI? There's nothing to do — service continues automatically.
            Want to cancel? Just visit your Secretary dashboard and hit Cancel before ${row.trial_ends_at}.
          </p>
          <a href="https://www.roofmanager.ca/customer/secretary" style="display:inline-block;background:#00FF88;color:#0A0A0A;font-weight:700;padding:14px 28px;border-radius:10px;text-decoration:none">Open Secretary Dashboard →</a>
          <p style="color:#9ca3af;font-size:12px;margin-top:24px">Roof Manager · roofmanager.ca</p>
        </div>`
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'Roof Manager <noreply@roofmanager.ca>',
            to: [row.email],
            subject: 'Your Roofer Secretary trial ends in 3 days',
            html,
          }),
        })
        if (res.ok) {
          await db.prepare(
            `INSERT INTO secretary_billing_events (customer_id, event_type, metadata) VALUES (?, 'trial_ending_soon', ?)`
          ).bind(row.customer_id, JSON.stringify({ trial_ends_at: row.trial_ends_at })).run()
          remindersSent++
        }
      } catch (err: any) {
        console.warn('[secretary-cron] reminder send failed:', err?.message)
      }
    }
  } catch (err: any) {
    console.warn('[secretary-cron] reminder sweep failed:', err?.message)
  }

  // 2. Past-due > 7 days → auto-cancel.
  try {
    const stale = await db.prepare(`
      SELECT ss.id, ss.customer_id, ss.square_subscription_id
      FROM secretary_subscriptions ss
      WHERE ss.status = 'past_due'
        AND datetime(ss.updated_at) < datetime('now','-7 days')
      LIMIT 50
    `).all<any>()

    for (const row of (stale.results || [])) {
      try {
        // Cancel in Square (lazy-import to avoid top-level deps).
        if (row.square_subscription_id) {
          const mod = await import('./services/square-subscriptions')
          await mod.cancelSubscription(env as any, row.square_subscription_id)
        }
        await db.prepare(
          `UPDATE secretary_subscriptions SET status='cancelled', cancelled_at=datetime('now'), updated_at=datetime('now') WHERE id = ?`
        ).bind(row.id).run()
        await db.prepare(
          `INSERT INTO secretary_billing_events (customer_id, event_type, metadata) VALUES (?, 'auto_cancelled_past_due', ?)`
        ).bind(row.customer_id, JSON.stringify({ square_subscription_id: row.square_subscription_id })).run()
        pastDueCancelled++
      } catch (err: any) {
        console.warn(`[secretary-cron] past-due cancel failed for sub ${row.id}:`, err?.message)
      }
    }
  } catch (err: any) {
    console.warn('[secretary-cron] past-due sweep failed:', err?.message)
  }

  return { remindersSent, pastDueCancelled }
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
        // Mirror into the Loop Tracker so the unified dashboard shows it too.
        await writeLoopHeartbeat(env, agentType, status === 'success' ? 'pass' : status, durationMs, null, summary, 'cf_cron').catch((e: any) => console.warn(`[heartbeat-write:${agentType}] failed:`, e?.message || e))
        await touchLoopDefinition(env, agentType, status === 'success' ? 'pass' : status, null).catch((e: any) => console.warn(`[touch-def:${agentType}] failed:`, e?.message || e))
      } catch {}
    }

    // Write a single "tick" heartbeat per cron firing so the dashboard can
    // confirm the cron Worker itself is alive — independent of any individual
    // loop. If this stops appearing, the Worker isn't firing at all.
    ctx.waitUntil(
      writeLoopHeartbeat(env, 'cron_worker_tick', 'pass', 0, null, `tick at ${now.toISOString()}`, 'cf_cron')
        .then(() => touchLoopDefinition(env, 'cron_worker_tick', 'pass', null))
        .catch((e: any) => console.warn('[cron_worker_tick] heartbeat write failed:', e?.message || e))
    )

    // ── Backlinks health sweep — Mondays at 13:00 UTC (one cron tick) ──
    // Checks ~50 oldest live/verified placements per week. Updates
    // last_check_status and stamps removed_at on rot. Manual run available
    // from /super-admin/seo/backlinks.
    if (dayOfWeek === 1 && hour === 13 && minute < 10) {
      ctx.waitUntil((async () => {
        const t0 = Date.now()
        try {
          const result = await runBacklinkHealthSweep(env, 50)
          const summary = `Checked ${result.checked}: ok=${result.ok} rot=${result.rot} err=${result.errors}`
          console.log(`[CRON:backlink-health] ${summary}`)
          await logRun('backlink_health', result.rot > 0 ? 'warning' : 'success', summary, result, Date.now() - t0)
        } catch (err: any) {
          console.error('[CRON:backlink-health] Error:', err.message)
          await logRun('backlink_health', 'error', err.message, {}, Date.now() - t0)
        }
      })())
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

    // ── Blog Agent (Gemini) — daily at 8, 14, 20 UTC (3 posts/day) ──
    if ((hour === 8 || hour === 14 || hour === 20) && minute < 10 && await isAgentEnabled('content')) {
      ctx.waitUntil((async () => {
        const t0 = Date.now()
        try {
          const result = await runBlogAgent(env)
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
          // First error string starting with 'skipped:' indicates a graceful
          // skip (no email transport configured) — surface as skipped status.
          const skipReason = result.errors.find(e => e.startsWith('skipped:'))
          const summary = !result.ok ? `Failed: ${result.errors[0] || 'unknown error'}`
            : skipReason ? skipReason
            : result.responded === 0 ? 'No new leads'
            : `Responded to ${result.responded} lead(s)`
          const status = !result.ok ? 'error' : (skipReason ? 'skipped' : 'success')
          console.log(`[CRON:lead] ${summary}`)
          await logRun('lead', status, summary, result, Date.now() - t0)
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
          const summary = !result.ok
            ? (result.error_label || result.error || 'Monitor scan failed')
            : `Health ${result.health_score}/100 — ${result.issues_found} finding(s)${result.critical_count > 0 ? ` (${result.critical_count} critical!)` : ''}`
          const status: 'success' | 'error' | 'skipped' =
            result.ok ? 'success' : (result.error_code === 'circuit_open' ? 'skipped' : 'error')
          console.log(`[CRON:monitor] ${summary}`)
          await logRun('monitor', status, summary, {
            health_score: result.health_score,
            issues_found: result.issues_found,
            error_code: result.error_code,
            error_label: result.error_label,
          }, Date.now() - t0)
        } catch (err: any) {
          // Belt-and-suspenders — runMonitorAgent should now never throw,
          // but if it does, classify here too instead of dumping raw JSON.
          const m = String(err?.message || err || '').toLowerCase()
          const code = m.includes('credit balance') ? 'insufficient_credits'
            : m.includes('rate limit') ? 'rate_limited'
            : m.includes('unauthorized') || m.includes('invalid api key') ? 'auth_failed'
            : 'unknown'
          const label = code === 'insufficient_credits' ? 'Anthropic billing — credits exhausted'
            : code === 'rate_limited' ? 'Anthropic rate-limited'
            : code === 'auth_failed' ? 'Anthropic auth failed'
            : 'Monitor scan crashed unexpectedly'
          console.error('[CRON:monitor] Error:', err?.message)
          await logRun('monitor', 'error', label, { error_code: code, error_label: label }, Date.now() - t0)
        }
      })())
    }

    // ── Abandoned Signup Recovery (every hour on :00 tick) ──
    if (minute === 0) {
      ctx.waitUntil((async () => {
        const t0 = Date.now()
        try {
          const result = await runAbandonedSignupRecovery(env)
          const summary = `Sent ${result.sent}, skipped ${result.skipped}`
          console.log(`[CRON:signup-recovery] ${summary}`)
          await logRun('signup_recovery', 'success', summary, result, Date.now() - t0).catch((e: any) => console.warn('[logRun:signup_recovery:success] failed:', e?.message || e))
        } catch (err: any) {
          console.error('[CRON:signup-recovery] Error:', err.message)
          await logRun('signup_recovery', 'error', err.message, {}, Date.now() - t0).catch((e: any) => console.warn('[logRun:signup_recovery:error] failed:', e?.message || e))
        }
      })())
    }

    // ── Rover chat session idle/ended sweep (every cron tick) ─
    // 30-min idle → 'idle', 24-hr stale → 'ended'. Cheap UPDATE, no LLM.
    ctx.waitUntil((async () => {
      try {
        const result = await runRoverSessionSweep(env)
        if (result.idled || result.ended) {
          console.log(`[CRON:rover-sweep] idled ${result.idled}, ended ${result.ended}`)
        }
      } catch (err: any) {
        console.error('[CRON:rover-sweep] Error:', err.message)
      }
    })())

    // ── Roofer Secretary trial management (daily at 15:00 UTC = 8am Mountain) ──
    // Fires a reminder 3 days before trial end + cancels past_due subs >7 days old.
    if (hour === 15 && minute < 10) {
      ctx.waitUntil((async () => {
        try {
          const result = await runSecretaryTrialManagement(env)
          console.log(`[CRON:secretary] Reminders: ${result.remindersSent}, past-due cancelled: ${result.pastDueCancelled}`)
        } catch (err: any) {
          console.error('[CRON:secretary] Error:', err.message)
        }
      })())
    }

    // ── Attribution & content rollup (daily at 03:00 UTC) ───
    // Recomputes analytics_attribution for customers with recent activity
    // and rebuilds analytics_content_daily for yesterday.
    if (hour === 3 && minute < 10) {
      ctx.waitUntil((async () => {
        const t0 = Date.now()
        try {
          const r = await runNightlyAttributionRollup(env.DB)
          const summary = `Attribution rollup — ${r.recomputed||0} customers, ${r.templates||0} templates for ${r.date}`
          console.log(`[CRON:attribution] ${summary}`)
          await logRun('attribution', 'success', summary, r, Date.now() - t0).catch((e: any) => console.warn('[logRun:attribution:success] failed:', e?.message || e))
        } catch (err: any) {
          console.error('[CRON:attribution] Error:', err.message)
          await logRun('attribution', 'error', err.message, {}, Date.now() - t0).catch((e: any) => console.warn('[logRun:attribution:error] failed:', e?.message || e))
        }
      })())
    }

    // Auto-invoice is strictly event-driven: it fires from the inline
    // hook in generateReportForOrder when reports.status → 'completed'
    // (triggered by a user placing an order, or the admin returning a
    // trace). No cron sweep — we don't want to retroactively draft
    // proposals for older orders.

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
          const summary = !result.ok ? `Failed: ${result.error || 'unknown error'}`
            : result.sessions_analyzed === 0
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

    // ── Loop Tracker scanners ────────────────────────────────────────────
    // Every 30 min, staggered by minute so the three surface scans don't
    // pile concurrent fetch + Browser Rendering invocations at the same
    // edge node. Each is gated on agent_configs.enabled = 1; runScan
    // writes its own loop_scan_runs/heartbeat row, so we don't double-log
    // through logRun() — it would just duplicate the entry.
    const SCAN_AT: Array<[number, ScanType]> = [
      [0, 'public'],   [30, 'public'],
      [10, 'customer'], [40, 'customer'],
      [20, 'admin'],   [50, 'admin'],
    ]
    for (const [m, type] of SCAN_AT) {
      if (minute === m && await isAgentEnabled(`scan_${type}`)) {
        const expectedAt = new Date(now)
        expectedAt.setUTCSeconds(0, 0)
        ctx.waitUntil((async () => {
          try {
            await runLoopScan(env, type, 'cron', { source: 'cf_cron', expectedAt })
          } catch (err: any) {
            console.error(`[CRON:scan_${type}] Error:`, err?.message)
          } finally {
            await pruneExpiredScanSessions(env).catch((e: any) => console.warn('[pruneExpiredScanSessions] failed:', e?.message || e))
          }
        })())
      }
    }

    // Reports error sweep — fires every cron tick (every 10 min). DB-only
    // (no Browser Rendering or auth), report errors block customer
    // delivery so we want minimum-latency detection. Cheap.
    if (await isAgentEnabled('scan_reports')) {
      const expectedAt = new Date(now)
      expectedAt.setUTCSeconds(0, 0)
      ctx.waitUntil((async () => {
        try {
          await runLoopScan(env, 'reports', 'cron', { source: 'cf_cron', expectedAt })
        } catch (err: any) {
          console.error('[CRON:scan_reports] Error:', err?.message)
        }
      })())
    }

    // Daily system health check at 09:00 UTC.
    if (hour === 9 && minute === 0 && await isAgentEnabled('scan_health')) {
      const expectedAt = new Date(now)
      expectedAt.setUTCHours(9, 0, 0, 0)
      ctx.waitUntil((async () => {
        try {
          await runLoopScan(env, 'health', 'cron', { source: 'cf_cron', expectedAt })
        } catch (err: any) {
          console.error('[CRON:scan_health] Error:', err?.message)
        }
      })())
    }

    // Ads-health sweep — every 4 hours at :00 (00, 04, 08, 12, 16, 20 UTC).
    // Probes Meta + Google Ads + GA4 attribution stack: pixel-in-HTML presence,
    // GA4 MP debug probe, Meta CAPI test event, gclid/UTM capture rates,
    // CAPI status mix, conversion drift vs 7d. Email goes out only on warn/fail.
    // Safe to run from cron because runAdsHealthCheck is the same code path the
    // /api/ads-health/tick endpoint uses.
    if (hour % 4 === 0 && minute === 0 && await isAgentEnabled('scan_ads_health')) {
      const expectedAt = new Date(now)
      expectedAt.setUTCHours(hour, 0, 0, 0)
      ctx.waitUntil((async () => {
        const t0 = Date.now()
        try {
          const result = await runAdsHealthCheck(env)
          const email = await sendAdsHealthEmail(env, result)
          const status: 'pass' | 'fail' = result.verdict === 'fail' ? 'fail' : 'pass'
          const findings = result.issues.map(i => ({
            severity: (i.severity === 'error' ? 'error' : 'warn') as 'error' | 'warn',
            category: 'ads_health',
            message: i.message,
            details: { section: i.section },
          }))
          await recordExternalRun(env, {
            loopId: 'ads_health',
            source: 'cf_cron',
            status,
            summary: `${result.verdict} · ${result.issues.length} issue(s) · email ${email.skipped ? 'skipped (verdict pass)' : email.ok ? 'sent' : `failed: ${email.error}`}`.slice(0, 500),
            durationMs: Date.now() - t0,
            outputs: { verdict: result.verdict, sections: result.sections.map(s => ({ key: s.key, status: s.status, summary: s.summary })), email },
            findings,
            expectedAt,
          })
        } catch (err: any) {
          console.error('[CRON:scan_ads_health] Error:', err?.message)
        }
      })())
    }

    // Signup-journey synthetic test — every hour at :00. Walks every
    // /customer/* page + the major auth'd APIs + a few toggle round-trips
    // against PROD, emails dead ends to support if any. Cheap (~3-4s) and
    // catches CSRF/auth/route regressions within the hour.
    if (minute === 0 && await isAgentEnabled('signup_journey')) {
      const expectedAt = new Date(now)
      expectedAt.setUTCMinutes(0, 0, 0)
      ctx.waitUntil((async () => {
        const t0 = Date.now()
        try {
          const result = await runSignupJourney(env)
          const email = await sendJourneyEmail(env, result)
          const status: 'pass' | 'fail' = result.verdict === 'fail' ? 'fail' : 'pass'
          const findings = (result.dead_ends || []).map((d: any) => ({
            severity: (d.severity === 'error' ? 'error' : 'warn') as 'error' | 'warn',
            category: 'signup_journey',
            message: `${d.category} ${d.path} → ${d.status ?? '—'}: ${d.message}`,
            details: d,
          }))
          await recordExternalRun(env, {
            loopId: 'signup_journey',
            source: 'cf_cron',
            status,
            summary: `${result.verdict} · ${result.dead_ends?.length || 0} dead end(s) · pages ${result.pages?.checked - result.pages?.failed}/${result.pages?.checked} · APIs ${result.apis?.checked - result.apis?.failed}/${result.apis?.checked} · email ${email.skipped ? 'skipped' : email.ok ? 'sent' : `failed: ${email.error}`}`.slice(0, 500),
            durationMs: Date.now() - t0,
            outputs: { verdict: result.verdict, pages: result.pages, apis: result.apis, toggles: result.toggles, email },
            findings,
            expectedAt,
          })
        } catch (err: any) {
          console.error('[CRON:signup_journey] Error:', err?.message)
        }
      })())
    }

    // Signup-health daily sweep at 10:00 UTC — probes signup surface +
    // Gmail transport + funnel regression + backend secrets + reports +
    // payments. Always emails the summary to support (digest, not just
    // failures).
    if (hour === 10 && minute === 0 && await isAgentEnabled('signup_health')) {
      const expectedAt = new Date(now)
      expectedAt.setUTCHours(10, 0, 0, 0)
      ctx.waitUntil((async () => {
        const t0 = Date.now()
        try {
          const result = await runSignupHealthCheck(env)
          const email = await sendSignupHealthEmail(env, result)
          const status: 'pass' | 'fail' = result.verdict === 'fail' ? 'fail' : 'pass'
          await recordExternalRun(env, {
            loopId: 'signup_health',
            source: 'cf_cron',
            status,
            summary: `${result.verdict} · ${(result.sections || []).length} section(s) · email ${email.ok ? 'sent' : `failed: ${email.error}`}`.slice(0, 500),
            durationMs: Date.now() - t0,
            outputs: { verdict: result.verdict, sections: result.sections, email },
            expectedAt,
          })
        } catch (err: any) {
          console.error('[CRON:signup_health] Error:', err?.message)
        }
      })())
    }
  },
}

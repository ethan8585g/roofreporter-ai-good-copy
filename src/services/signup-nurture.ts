// ============================================================
// SIGNUP NURTURE — Automated 3-touch follow-up sequence for new
// free signups who haven't ordered yet. Runs from cron-worker.ts
// every 10 min, fires each stage at its window.
//
// Stages (one row per customer per stage, dedup'd via user_activity_log):
//   +1h   — friendly "want to try it?" nudge, low-pressure
//   +24h  — social proof + sample report link
//   +3d   — urgency reminder ("free reports still waiting")
//   +7d   — STOP. Don't be a stalker.
//
// Each stage is idempotent: re-running the cron won't double-send because
// the user_activity_log row is the dedupe ledger (LIKE %customer_id":<id>%).
//
// Industry benchmark: 10-15% activation lift across the full 3-touch
// sequence vs no nurture, per HubSpot. At 5-9 signups/day:
//   +0.5-1.4 extra activated customers/day, no ad spend.
// ============================================================

import { loadGmailCreds, sendGmailOAuth2 } from './email'
import { logEmailSend, markEmailFailed, buildTrackingPixel } from './email-tracking'

export type NurtureStage = '1h' | '24h' | '3d'

interface NurtureCandidate {
  id: number
  email: string
  name: string | null
}

interface NurtureResult {
  stage: NurtureStage
  found: number
  sent: number
  failed: number
  skipped: number
  errors: string[]
}

// One config per stage — kept in one place so adding a new stage is a
// single object, not scattered edits across the function.
const STAGE_CONFIG: Record<NurtureStage, {
  actionKey: string
  failedActionKey: string
  // SQL fragment that scopes by created_at. Uses inclusive boundaries
  // matching cron cadence (10 min) so customers don't slip through.
  ageWindow: string
  subject: (firstName: string) => string
  body: (firstName: string) => string
}> = {
  '1h': {
    actionKey: 'signup_followup_1h_sent',
    failedActionKey: 'signup_followup_1h_failed',
    ageWindow: `c.created_at >= datetime('now', '-2 hours') AND c.created_at <= datetime('now', '-1 hours')`,
    subject: (firstName) => `Want to try your first roof report, ${firstName}?`,
    body: (firstName) => buildHtmlEmail({
      heading: `Welcome to Roof Manager, ${firstName} \u{1F44B}`,
      lead: `Thanks for signing up. You have <strong>4 free roof measurement reports</strong> waiting in your account — no credit card needed.`,
      body: `Want to try one right now? Most contractors test with their current property or a recent job address — it takes about 60 seconds:`,
      ctaLabel: `Order Your First Free Report →`,
      ctaUrl: `https://www.roofmanager.ca/customer/dashboard?utm_source=nurture&utm_medium=email&utm_campaign=signup_followup_1h`,
      secondary: `Not ready yet? No problem. <a href="https://www.roofmanager.ca/report/share/14d5fcef4db44d09bddb" style="color:#00CC70;text-decoration:none;font-weight:600;">See a sample report</a> first — no signup required.`,
      closing: `Questions? Just reply to this email — a human reads every reply.`,
    }),
  },
  '24h': {
    actionKey: 'signup_followup_24h_sent',
    failedActionKey: 'signup_followup_24h_failed',
    ageWindow: `c.created_at >= datetime('now', '-25 hours') AND c.created_at <= datetime('now', '-24 hours')`,
    subject: (firstName) => `${firstName}, here’s how 5,000+ contractors use Roof Manager`,
    body: (firstName) => buildHtmlEmail({
      heading: `5,000+ roofers trust this for their estimates`,
      lead: `Hey ${firstName} — yesterday you set up a Roof Manager account but haven’t run a report yet. Here’s what other contractors are doing with it.`,
      body: `• <strong>Bidding faster</strong>: $8 satellite measurement instead of a $30+ EagleView<br>• <strong>Accurate takeoffs</strong>: 2–5% accuracy, AI-verified eaves/ridges/valleys<br>• <strong>Full BOM in the report</strong>: shingles, underlayment, ridge cap, drip edge — priced and ready<br>• <strong>No ladder, no drone</strong>: works from satellite imagery, any address`,
      ctaLabel: `Try It With An Address →`,
      ctaUrl: `https://www.roofmanager.ca/customer/dashboard?utm_source=nurture&utm_medium=email&utm_campaign=signup_followup_24h`,
      secondary: `Want to see what a finished report looks like? <a href="https://www.roofmanager.ca/report/share/14d5fcef4db44d09bddb" style="color:#00CC70;text-decoration:none;font-weight:600;">View a real one here</a> (no login required).`,
      closing: `4.9/5 from 200+ reviews. PIPEDA-compliant. Canadian-owned data.`,
    }),
  },
  '3d': {
    actionKey: 'signup_followup_3d_sent',
    failedActionKey: 'signup_followup_3d_failed',
    ageWindow: `c.created_at >= datetime('now', '-73 hours') AND c.created_at <= datetime('now', '-72 hours')`,
    subject: (firstName) => `Your 4 free roof reports are still waiting, ${firstName}`,
    body: (firstName) => buildHtmlEmail({
      heading: `Your 4 free reports don’t expire — but they’re still waiting`,
      lead: `${firstName}, just a quick reminder — your Roof Manager account has 4 free roof measurement reports on it. No credit card, no contract. They’re yours when you’re ready.`,
      body: `Most contractors run their first report the moment they have a real address to bid on. If you have one right now, the report comes back in 1–2 hours — enough time to quote same-day.`,
      ctaLabel: `Run My First Free Report →`,
      ctaUrl: `https://www.roofmanager.ca/customer/dashboard?utm_source=nurture&utm_medium=email&utm_campaign=signup_followup_3d`,
      secondary: `Not the right fit? <a href="https://www.roofmanager.ca/customer/account/request-deletion" style="color:#9ca3af;text-decoration:none;font-weight:500;">Close my account</a> anytime — we won’t email you again after this.`,
      closing: `This is the last automated email you’ll get from us. Real humans only from here.`,
    }),
  },
}

interface HtmlEmailParts {
  heading: string
  lead: string
  body: string
  ctaLabel: string
  ctaUrl: string
  secondary: string
  closing: string
}

function buildHtmlEmail(p: HtmlEmailParts): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;color:#111;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;background:#ffffff;">
  <h1 style="font-size:22px;font-weight:800;margin:0 0 16px;color:#0A0A0A;line-height:1.3;">${p.heading}</h1>
  <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 18px;">${p.lead}</p>
  <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 18px;">${p.body}</p>
  <p style="margin:24px 0;text-align:center;">
    <a href="${p.ctaUrl}" style="display:inline-block;background:#00FF88;color:#0A0A0A;font-weight:800;padding:14px 32px;border-radius:10px;text-decoration:none;font-size:15px;">${p.ctaLabel}</a>
  </p>
  <p style="font-size:14px;line-height:1.6;color:#6b7280;margin:24px 0 0;">${p.secondary}</p>
  <p style="font-size:14px;line-height:1.6;color:#6b7280;margin:18px 0 0;">${p.closing}</p>
  <p style="font-size:14px;line-height:1.6;color:#6b7280;margin:24px 0 0;">— The Roof Manager team</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px;">
  <p style="font-size:12px;color:#9ca3af;line-height:1.5;margin:0;">You received this because you signed up at www.roofmanager.ca. We send at most 3 emails in your first week, then stop.</p>
</div>
</body></html>`
}

function firstNameFromCustomer(name: string | null, email: string): string {
  if (!name) return 'there'
  const trimmed = String(name).trim()
  if (!trimmed) return 'there'
  if (trimmed === email || trimmed.includes('@')) return 'there'
  const first = trimmed.split(/\s+/)[0]
  return first && first.length <= 32 ? first : 'there'
}

/**
 * Run one nurture stage's sweep. Public so cron-worker can run all three
 * stages on the same tick.
 */
export async function runSignupNurtureStage(env: any, stage: NurtureStage): Promise<NurtureResult> {
  const cfg = STAGE_CONFIG[stage]
  const result: NurtureResult = { stage, found: 0, sent: 0, failed: 0, skipped: 0, errors: [] }

  const creds = await loadGmailCreds(env)
  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    result.errors.push(`[${stage}] Gmail OAuth2 creds missing — aborted`)
    return result
  }
  const sender = creds.senderEmail || 'sales@roofmanager.ca'

  // SECURITY: action key is hard-coded per stage, not user input, so
  // string-substituting into SQL is fine here.
  const candidates = await env.DB.prepare(`
    SELECT c.id, c.email, c.name
    FROM customers c
    WHERE c.email IS NOT NULL
      AND c.is_active = 1
      AND COALESCE(c.free_trial_used, 0) = 0
      AND COALESCE(c.credits_used, 0) = 0
      AND ${cfg.ageWindow}
      AND NOT EXISTS (
        SELECT 1 FROM user_activity_log ual
        WHERE ual.action = '${cfg.actionKey}'
          AND ual.details LIKE '%customer_id":' || c.id || '%'
      )
    LIMIT 50
  `).all<NurtureCandidate>()

  const rows = (candidates.results || []) as NurtureCandidate[]
  result.found = rows.length

  for (const row of rows) {
    if (!row.email || !row.email.includes('@')) { result.skipped++; continue }

    // Re-check at send time (cron tick → send latency) so we don't email
    // someone who ordered between the query and the send.
    const fresh = await env.DB.prepare(
      `SELECT free_trial_used, credits_used FROM customers WHERE id = ?`
    ).bind(row.id).first<any>()
    if (!fresh) { result.skipped++; continue }
    if ((fresh.free_trial_used || 0) > 0 || (fresh.credits_used || 0) > 0) {
      result.skipped++
      continue
    }

    const firstName = firstNameFromCustomer(row.name, row.email)
    const subject = cfg.subject(firstName)
    const rawHtml = cfg.body(firstName)
    // Log to email_sends BEFORE attempting send so we capture failures too.
    const trackingToken = await logEmailSend(env, {
      customerId: row.id, recipient: row.email, kind: `nurture_${stage}`, subject,
    })
    const pixel = buildTrackingPixel(trackingToken)
    // Inject pixel just before </body>. Fallback: append at end.
    const html = rawHtml.includes('</body>')
      ? rawHtml.replace('</body>', `${pixel}</body>`)
      : rawHtml + pixel

    try {
      await sendGmailOAuth2(
        creds.clientId, creds.clientSecret, creds.refreshToken,
        row.email, subject, html, sender, env
      )
      await env.DB.prepare(
        `INSERT INTO user_activity_log (company_id, action, details) VALUES (1, ?, ?)`
      ).bind(cfg.actionKey, JSON.stringify({ customer_id: row.id, email: row.email, stage, sent_at: new Date().toISOString() })).run()
      result.sent++
    } catch (e: any) {
      result.failed++
      result.errors.push(`[${stage}] #${row.id} ${row.email}: ${e?.message || e}`)
      console.warn(`[signup-nurture:${stage}] send failed for customer ${row.id}:`, e?.message || e)
      await markEmailFailed(env, trackingToken, String(e?.message || e))
      try {
        await env.DB.prepare(
          `INSERT INTO user_activity_log (company_id, action, details) VALUES (1, ?, ?)`
        ).bind(cfg.failedActionKey, JSON.stringify({ customer_id: row.id, email: row.email, error: String(e?.message || e).slice(0, 500) })).run()
      } catch {}
    }
  }

  return result
}

/**
 * Manually send ONE nurture stage email to ONE customer, bypassing the
 * time-window check. Used by super-admin to fire a nurture touch on demand
 * (e.g. to re-engage a specific signup). Still logs to user_activity_log
 * so the auto cron won't double-send the same stage to this customer later.
 *
 * @param env Workers env
 * @param customerId Customer to email
 * @param stage Which nurture stage to send
 * @returns success/error info
 */
export async function sendSignupNurtureToCustomer(
  env: any,
  customerId: number,
  stage: NurtureStage
): Promise<{ success: boolean; sent_to?: string; subject?: string; error?: string }> {
  const cfg = STAGE_CONFIG[stage]
  if (!cfg) return { success: false, error: `Unknown stage: ${stage}` }

  const customer = await env.DB.prepare(
    `SELECT id, email, name FROM customers WHERE id = ?`
  ).bind(customerId).first<any>()
  if (!customer) return { success: false, error: `Customer ${customerId} not found` }
  if (!customer.email || !customer.email.includes('@')) {
    return { success: false, error: `Customer ${customerId} has no valid email` }
  }

  const creds = await loadGmailCreds(env)
  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    return { success: false, error: 'Gmail OAuth2 creds missing on env' }
  }
  const sender = creds.senderEmail || 'sales@roofmanager.ca'

  const firstName = firstNameFromCustomer(customer.name, customer.email)
  const subject = cfg.subject(firstName)
  const rawHtml = cfg.body(firstName)
  const trackingToken = await logEmailSend(env, {
    customerId: customer.id, recipient: customer.email, kind: `nurture_${stage}`, subject,
  })
  const pixel = buildTrackingPixel(trackingToken)
  const html = rawHtml.includes('</body>')
    ? rawHtml.replace('</body>', `${pixel}</body>`)
    : rawHtml + pixel

  try {
    await sendGmailOAuth2(
      creds.clientId, creds.clientSecret, creds.refreshToken,
      customer.email, subject, html, sender, env
    )
    await env.DB.prepare(
      `INSERT INTO user_activity_log (company_id, action, details) VALUES (1, ?, ?)`
    ).bind(cfg.actionKey, JSON.stringify({
      customer_id: customer.id, email: customer.email, stage,
      sent_at: new Date().toISOString(), trigger: 'manual',
    })).run()
    return { success: true, sent_to: customer.email, subject }
  } catch (e: any) {
    await markEmailFailed(env, trackingToken, String(e?.message || e))
    return { success: false, error: e?.message || String(e) }
  }
}

/**
 * Run all 3 nurture stages on this cron tick. Each stage is independent;
 * a single tick can send a 1h email to customer A, a 24h email to
 * customer B, and a 3d email to customer C.
 */
export async function runSignupNurture(env: any): Promise<NurtureResult[]> {
  const results: NurtureResult[] = []
  for (const stage of ['1h', '24h', '3d'] as NurtureStage[]) {
    try {
      results.push(await runSignupNurtureStage(env, stage))
    } catch (e: any) {
      results.push({ stage, found: 0, sent: 0, failed: 0, skipped: 0, errors: [String(e?.message || e)] })
    }
  }
  return results
}

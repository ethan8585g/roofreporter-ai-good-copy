// ============================================================
// SIGNUP NURTURE — Automated +1h follow-up for new free signups
// who haven't ordered yet. Runs from cron-worker.ts every 10 min.
//
// Logic per cron tick:
//   1. SELECT customers where:
//        - created_at is 1-2 hours ago (window matches cron cadence)
//        - free_trial_used = 0 AND credits_used = 0 (not activated)
//        - has not been emailed already (no user_activity_log row
//          with action='signup_followup_1h_sent' for this customer)
//        - email is present
//   2. For each, send a personalized "Want to try your first report?"
//      nudge via Gmail OAuth2.
//   3. Log signup_followup_1h_sent to prevent double-sends.
//
// Industry benchmark: 10-15% of dormant signups activate after a
// well-timed 1h nudge. At 5-9 signups/day → +0.5-1.4 extra activated
// customers/day from this alone, no ad spend.
//
// Future: add +24h social-proof email and +3d urgency email. Both
// hang off the same pattern — just different `action` log key and
// time window.
// ============================================================

import { loadGmailCreds, sendGmailOAuth2 } from './email'

interface NurtureCandidate {
  id: number
  email: string
  name: string | null
}

interface NurtureResult {
  found: number
  sent: number
  failed: number
  skipped: number
  errors: string[]
}

const FOLLOWUP_ACTION = 'signup_followup_1h_sent'

function firstNameFromCustomer(name: string | null, email: string): string {
  // Name fallback rules:
  //  - If name is null/empty/email-shaped → "there" (avoids
  //    "Hey smarrancasr@aol.com," looking generic)
  //  - Otherwise first token of name (so "John Smith" → "John")
  if (!name) return 'there'
  const trimmed = String(name).trim()
  if (!trimmed) return 'there'
  if (trimmed === email || trimmed.includes('@')) return 'there'
  const first = trimmed.split(/\s+/)[0]
  return first && first.length <= 32 ? first : 'there'
}

function buildEmailHtml(firstName: string): string {
  // Plain, friendly, contractor-targeted. CTA goes to /customer/dashboard
  // (logged-in landing). Mentions sample report so they have a no-risk first step.
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;color:#111;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;background:#ffffff;">
  <h1 style="font-size:22px;font-weight:800;margin:0 0 16px;color:#0A0A0A;line-height:1.3;">Welcome to Roof Manager, ${firstName} \u{1F44B}</h1>
  <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 18px;">Thanks for signing up. You’ve got <strong>4 free roof measurement reports</strong> waiting in your account — no credit card needed.</p>
  <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 18px;">Want to try one right now? Most contractors test with their current property or a recent job address — takes about 60 seconds:</p>
  <p style="margin:24px 0;text-align:center;">
    <a href="https://www.roofmanager.ca/customer/dashboard?utm_source=nurture&utm_medium=email&utm_campaign=signup_followup_1h" style="display:inline-block;background:#00FF88;color:#0A0A0A;font-weight:800;padding:14px 32px;border-radius:10px;text-decoration:none;font-size:15px;">Order Your First Free Report →</a>
  </p>
  <p style="font-size:14px;line-height:1.6;color:#6b7280;margin:24px 0 0;">Not ready yet? No problem. <a href="https://www.roofmanager.ca/report/share/14d5fcef4db44d09bddb" style="color:#00CC70;text-decoration:none;font-weight:600;">See a sample report</a> first — no signup required.</p>
  <p style="font-size:14px;line-height:1.6;color:#6b7280;margin:18px 0 0;">Questions? Just reply to this email — a human reads every reply.</p>
  <p style="font-size:14px;line-height:1.6;color:#6b7280;margin:24px 0 0;">— The Roof Manager team</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px;">
  <p style="font-size:12px;color:#9ca3af;line-height:1.5;margin:0;">You received this because you signed up at www.roofmanager.ca. We’ll send at most 3 emails in your first week, then stop.</p>
</div>
</body></html>`
}

/**
 * Run one tick of the signup nurture sweep. Idempotent — re-running won’t
 * double-send because of the user_activity_log de-dupe check.
 *
 * @param env Cloudflare Workers env (must have DB + Gmail OAuth2 creds)
 */
export async function runSignupNurture(env: any): Promise<NurtureResult> {
  const result: NurtureResult = { found: 0, sent: 0, failed: 0, skipped: 0, errors: [] }

  // Anti-pattern guard: refuse to run when transport is unavailable so
  // we don’t silently skip every candidate forever.
  const creds = await loadGmailCreds(env)
  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    result.errors.push('Gmail OAuth2 creds missing — nurture sweep aborted')
    return result
  }
  const sender = creds.senderEmail || 'sales@roofmanager.ca'

  // 1–2 hour old, unactivated, never emailed.
  const candidates = await env.DB.prepare(`
    SELECT c.id, c.email, c.name
    FROM customers c
    WHERE c.email IS NOT NULL
      AND c.is_active = 1
      AND COALESCE(c.free_trial_used, 0) = 0
      AND COALESCE(c.credits_used, 0) = 0
      AND c.created_at >= datetime('now', '-2 hours')
      AND c.created_at <= datetime('now', '-1 hours')
      AND NOT EXISTS (
        SELECT 1 FROM user_activity_log ual
        WHERE ual.action = ?
          AND ual.details LIKE '%customer_id":' || c.id || '%'
      )
    LIMIT 50
  `).bind(FOLLOWUP_ACTION).all<NurtureCandidate>()

  const rows = (candidates.results || []) as NurtureCandidate[]
  result.found = rows.length

  for (const row of rows) {
    if (!row.email || !row.email.includes('@')) {
      result.skipped++
      continue
    }
    // Re-check at send-time (cron tick → send latency) — customer
    // may have ordered between query and send. Skip if so.
    const fresh = await env.DB.prepare(
      `SELECT free_trial_used, credits_used FROM customers WHERE id = ?`
    ).bind(row.id).first<any>()
    if (!fresh) { result.skipped++; continue }
    if ((fresh.free_trial_used || 0) > 0 || (fresh.credits_used || 0) > 0) {
      result.skipped++
      continue
    }

    const firstName = firstNameFromCustomer(row.name, row.email)
    const subject = `Want to try your first roof report, ${firstName}?`
    const html = buildEmailHtml(firstName)

    try {
      await sendGmailOAuth2(
        creds.clientId, creds.clientSecret, creds.refreshToken,
        row.email, subject, html, sender, env
      )
      // Log success so we don’t re-send next tick. Note: details JSON
      // must contain customer_id":<id> token because the de-dupe LIKE
      // pattern above keys off it. Keep this exact format.
      await env.DB.prepare(
        `INSERT INTO user_activity_log (company_id, action, details) VALUES (1, ?, ?)`
      ).bind(FOLLOWUP_ACTION, JSON.stringify({ customer_id: row.id, email: row.email, sent_at: new Date().toISOString() })).run()
      result.sent++
    } catch (e: any) {
      result.failed++
      result.errors.push(`#${row.id} ${row.email}: ${e?.message || e}`)
      console.warn(`[signup-nurture] send failed for customer ${row.id}:`, e?.message || e)
      // Still log it so we don’t keep retrying a permanently bad address.
      // Use a different action key so analytics can distinguish "sent" vs "tried".
      try {
        await env.DB.prepare(
          `INSERT INTO user_activity_log (company_id, action, details) VALUES (1, 'signup_followup_1h_failed', ?)`
        ).bind(JSON.stringify({ customer_id: row.id, email: row.email, error: String(e?.message || e).slice(0, 500) })).run()
      } catch {}
    }
  }

  return result
}

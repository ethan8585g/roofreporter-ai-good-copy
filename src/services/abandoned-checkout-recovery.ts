// ============================================================
// ABANDONED CHECKOUT RECOVERY — 2-touch sequence for customers
// who hit Square checkout but never completed payment.
//
// Signal: square_payments rows with status='pending' that have
// no matching successful order/payment created since.
//
// Stages (dedup'd via user_activity_log):
//   +2h   — "Your roof report is one click away" (resend nudge)
//   +24h  — "Still want that roof report?" (soft followup + offer help)
//
// Sender: support@roofmanager.ca (customer-facing voice rule).
// Sign-off: "The Roof Manager team".
//
// Re-checks at send time so we never email someone whose payment
// flipped paid/failed/refunded between query and send.
// ============================================================

import { loadGmailCreds } from './email'

export type CartRecoveryStage = '2h' | '24h'

interface CartCandidate {
  payment_id: number
  customer_id: number
  email: string
  name: string | null
  amount: number
  description: string | null
  metadata_json: string | null
  created_at: string
}

export interface CartRecoveryResult {
  stage: CartRecoveryStage
  found: number
  sent: number
  failed: number
  skipped: number
  errors: string[]
}

const STAGE_CONFIG: Record<CartRecoveryStage, {
  actionKey: string
  failedActionKey: string
  ageWindow: string
  subject: (firstName: string) => string
  body: (parts: BodyParts) => string
}> = {
  '2h': {
    actionKey: 'cart_recovery_2h_sent',
    failedActionKey: 'cart_recovery_2h_failed',
    ageWindow: `sp.created_at >= datetime('now', '-3 hours') AND sp.created_at <= datetime('now', '-2 hours')`,
    subject: (firstName) => `Your roof report is one click away${firstName !== 'there' ? `, ${firstName}` : ''}`,
    body: (p) => buildHtmlEmail({
      heading: `Finish your roof report`,
      lead: `Hey ${p.firstName}, you started checkout for <strong>${p.packageLine}</strong> a couple hours ago but didn't finish. Your payment link is still good — pick it back up below.`,
      body: `Roof Manager reports come back in <strong>1–2 hours</strong> with 2–5% measurement accuracy. As soon as payment clears we kick the report off.`,
      ctaLabel: `Finish Checkout →`,
      ctaUrl: `https://www.roofmanager.ca/customer/dashboard?utm_source=cart_recovery&utm_medium=email&utm_campaign=cart_recovery_2h`,
      secondary: `If something went sideways with the payment form, just hit reply — a human reads every reply and will get it sorted in minutes.`,
      closing: ``,
    }),
  },
  '24h': {
    actionKey: 'cart_recovery_24h_sent',
    failedActionKey: 'cart_recovery_24h_failed',
    ageWindow: `sp.created_at >= datetime('now', '-25 hours') AND sp.created_at <= datetime('now', '-24 hours')`,
    subject: (firstName) => `Still want that roof report${firstName !== 'there' ? `, ${firstName}` : ''}?`,
    body: (p) => buildHtmlEmail({
      heading: `Yesterday you started checking out — anything we can help with?`,
      lead: `${p.firstName}, yesterday you started checkout for <strong>${p.packageLine}</strong>. The link's still active, but more importantly — if something's blocking you, we want to know.`,
      body: `Common things that come up: wrong property address, payment card declined, just wanted to sleep on it. Whatever it is, reply to this email and we'll sort it out. No pressure, no autoresponder — a real person reads it.`,
      ctaLabel: `Resume Checkout →`,
      ctaUrl: `https://www.roofmanager.ca/customer/dashboard?utm_source=cart_recovery&utm_medium=email&utm_campaign=cart_recovery_24h`,
      secondary: `Prefer to skip the report this time? No worries — this is the last email you'll get about it.`,
      closing: ``,
    }),
  },
}

interface BodyParts {
  firstName: string
  packageLine: string
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
  ${p.closing ? `<p style="font-size:14px;line-height:1.6;color:#6b7280;margin:18px 0 0;">${p.closing}</p>` : ''}
  <p style="font-size:14px;line-height:1.6;color:#6b7280;margin:24px 0 0;">— The Roof Manager team</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px;">
  <p style="font-size:12px;color:#9ca3af;line-height:1.5;margin:0;">You received this because you started a Roof Manager checkout. We send at most 2 reminders, then stop.</p>
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

function packageLineFromCandidate(c: CartCandidate): string {
  if (c.description && c.description.trim()) {
    return c.description.replace(/\s*\[[^\]]+\]\s*$/, '').trim()
  }
  try {
    if (c.metadata_json) {
      const meta = JSON.parse(c.metadata_json)
      if (meta?.package_name) return String(meta.package_name)
    }
  } catch {}
  return 'your roof report'
}

export async function runAbandonedCheckoutRecoveryStage(
  env: any,
  stage: CartRecoveryStage,
): Promise<CartRecoveryResult> {
  const cfg = STAGE_CONFIG[stage]
  const result: CartRecoveryResult = { stage, found: 0, sent: 0, failed: 0, skipped: 0, errors: [] }

  const creds = await loadGmailCreds(env)
  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    result.errors.push(`[${stage}] Gmail OAuth2 creds missing — aborted`)
    return result
  }
  // Customer-facing recovery uses support@ per the email voice rule.
  const sender = 'support@roofmanager.ca'

  // Pending checkouts in the window, with no successful payment row for the
  // same customer since their attempt (covers retry-with-different-card case).
  const candidates = await env.DB.prepare(`
    SELECT
      sp.id            AS payment_id,
      sp.customer_id   AS customer_id,
      c.email          AS email,
      c.name           AS name,
      sp.amount        AS amount,
      sp.description   AS description,
      sp.metadata_json AS metadata_json,
      sp.created_at    AS created_at
    FROM square_payments sp
    JOIN customers c ON c.id = sp.customer_id
    WHERE sp.status = 'pending'
      AND sp.payment_type IN ('credit_pack', 'single_report', 'subscription')
      AND sp.customer_id IS NOT NULL
      AND c.email IS NOT NULL
      AND c.is_active = 1
      AND ${cfg.ageWindow}
      AND NOT EXISTS (
        SELECT 1 FROM square_payments sp2
        WHERE sp2.customer_id = sp.customer_id
          AND sp2.status IN ('paid','completed')
          AND sp2.created_at >= sp.created_at
      )
      AND NOT EXISTS (
        SELECT 1 FROM user_activity_log ual
        WHERE ual.action = '${cfg.actionKey}'
          AND ual.details LIKE '%payment_id":' || sp.id || '%'
      )
    LIMIT 50
  `).all<CartCandidate>()

  const rows = (candidates.results || []) as CartCandidate[]
  result.found = rows.length

  for (const row of rows) {
    if (!row.email || !row.email.includes('@')) { result.skipped++; continue }

    // Re-check at send time — payment may have flipped paid/failed between
    // the query and the send attempt.
    const fresh = await env.DB.prepare(
      `SELECT status FROM square_payments WHERE id = ?`
    ).bind(row.payment_id).first<{ status: string }>()
    if (!fresh || fresh.status !== 'pending') { result.skipped++; continue }

    const firstName = firstNameFromCustomer(row.name, row.email)
    const packageLine = packageLineFromCandidate(row)
    const subject = cfg.subject(firstName)
    const html = cfg.body({ firstName, packageLine })

    const { logAndSendEmail } = await import('./email-wrapper')
    const r = await logAndSendEmail({
      env, to: row.email, from: sender,
      subject, html,
      kind: `cart_recovery_${stage}`, category: 'cart',
      customerId: row.customer_id,
    })

    if (r.ok) {
      await env.DB.prepare(
        `INSERT INTO user_activity_log (company_id, action, details) VALUES (1, ?, ?)`
      ).bind(cfg.actionKey, JSON.stringify({
        payment_id: row.payment_id, customer_id: row.customer_id, email: row.email,
        stage, sent_at: new Date().toISOString(),
      })).run()
      result.sent++
    } else {
      result.failed++
      result.errors.push(`[${stage}] payment #${row.payment_id} ${row.email}: ${r.error}`)
      try {
        await env.DB.prepare(
          `INSERT INTO user_activity_log (company_id, action, details) VALUES (1, ?, ?)`
        ).bind(cfg.failedActionKey, JSON.stringify({
          payment_id: row.payment_id, customer_id: row.customer_id, email: row.email,
          error: String(r.error || '').slice(0, 500),
        })).run()
      } catch {}
    }
  }

  return result
}

export async function runAbandonedCheckoutRecovery(env: any): Promise<CartRecoveryResult[]> {
  const results: CartRecoveryResult[] = []
  for (const stage of ['2h', '24h'] as CartRecoveryStage[]) {
    try {
      results.push(await runAbandonedCheckoutRecoveryStage(env, stage))
    } catch (e: any) {
      results.push({ stage, found: 0, sent: 0, failed: 0, skipped: 0, errors: [String(e?.message || e)] })
    }
  }
  return results
}

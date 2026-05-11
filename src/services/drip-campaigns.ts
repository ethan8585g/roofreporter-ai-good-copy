/**
 * Drip campaigns — health-state-driven outreach emails.
 *
 * Three campaigns ship on day 1, all written in Christine's casual
 * voice. Defaults to DRY-RUN mode so you can preview before turning
 * on real sends. Flip dry_run=false in agent_configs.drips.config_json.
 *
 *   stuck_signup_60d   — signed up 60+ days ago, never ordered
 *   at_risk_churn_30d  — paying customer silent 30d AND no order 90d
 *   trial_ends_3d      — trial ends in 1-3 days, no order yet
 *
 * Per-customer cooldown (90 days) prevents re-sending the same
 * template. The drip_campaign_state table is the single source of
 * truth; drip evaluator UPSERTs there on every send.
 */

import { sendGmailOAuth2, loadGmailCreds } from './email'
import { logEmailSend, markEmailFailed, buildTrackingPixel, wrapEmailLinks } from './email-tracking'

type Db = D1Database

interface DripConfig {
  dry_run: boolean
  sender_email: string
  sender_name: string
  cooldown_days: number
  max_per_run: number
  campaigns_enabled: string[]
}

interface DripResult {
  template: string
  sent: number
  dry_run: number
  errors: number
  skipped_cooldown: number
}

const DEFAULT_CONFIG: DripConfig = {
  dry_run: true,
  sender_email: 'sales@roofmanager.ca',
  sender_name: 'Roof Manager Sales',
  cooldown_days: 90,
  max_per_run: 50,
  campaigns_enabled: ['stuck_signup_60d', 'at_risk_churn_30d', 'trial_ends_3d'],
}

async function loadConfig(db: Db): Promise<DripConfig> {
  try {
    const row = await db.prepare(`SELECT enabled, config_json FROM agent_configs WHERE agent_type='drips'`).first<any>()
    if (!row) return DEFAULT_CONFIG
    if (!row.enabled) return { ...DEFAULT_CONFIG, campaigns_enabled: [] }
    const cfg = row.config_json ? JSON.parse(row.config_json) : {}
    return { ...DEFAULT_CONFIG, ...cfg }
  } catch {
    return DEFAULT_CONFIG
  }
}

function escHtml(v: any): string {
  return String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[m])
}

function emailWrapper(bodyHtml: string): string {
  return `
<div style="max-width:600px;margin:0 auto;font-family:Inter,Arial,Helvetica,sans-serif;background:#f4f4f5;padding:24px">
  <div style="background:#000;padding:20px;border-radius:12px 12px 0 0;text-align:center">
    <img src="https://www.roofmanager.ca/static/logo.png?v=20260504" alt="Roof Manager" width="160" style="max-width:160px;height:auto;display:block;margin:0 auto"/>
  </div>
  <div style="background:#fff;padding:32px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;font-size:15px;color:#1a1a2e;line-height:1.6">
    ${bodyHtml}
  </div>
  <p style="font-size:11px;color:#9CA3AF;text-align:center;margin:16px 0 0">
    You're getting this because you have a Roof Manager account.
    <a href="https://www.roofmanager.ca/customer/notifications" style="color:#9CA3AF">Manage email preferences</a>.
  </p>
</div>`
}

interface RenderedEmail {
  subject: string
  html: string
}

// ── TEMPLATES ────────────────────────────────────────────────
// Edit the strings below to adjust voice. Subject + body are the
// only customer-facing text — everything else is wrapper.
function renderStuckSignup(c: { name: string | null; first_name: string; credits_remaining: number }): RenderedEmail {
  const greeting = c.first_name ? `Hi ${escHtml(c.first_name)},` : 'Hi there,'
  return {
    subject: `${c.first_name ? c.first_name + ', ' : ''}your free roof reports are still waiting`,
    html: emailWrapper(`
      <p style="margin:0 0 16px">${greeting}</p>
      <p style="margin:0 0 16px">
        Quick note from the Roof Manager team — you signed up a while back but haven't run your first report yet,
        and your account still has <strong>${c.credits_remaining} free roof report${c.credits_remaining === 1 ? '' : 's'}</strong> waiting.
      </p>
      <p style="margin:0 0 16px">
        If you haven't had a chance to check it out yet, no worries — most customers run their first measurement
        in about 5 minutes. Punch in any address and Roof Manager pulls the satellite imagery and roof geometry for you.
      </p>
      <p style="margin:0 0 24px">
        Happy to walk you through it on a quick call if that's easier — or just dive in:
      </p>
      <div style="text-align:center;margin:24px 0">
        <a href="https://www.roofmanager.ca/customer" style="display:inline-block;background:#00CC6A;color:#0A0A0A;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px;text-decoration:none">Run my first report</a>
      </div>
      <p style="margin:24px 0 0;color:#6B7280;font-size:14px">
        — The Roof Manager team<br>
        <span style="font-size:12px">sales@roofmanager.ca · roofmanager.ca</span>
      </p>
    `)
  }
}

function renderAtRiskChurn(c: { name: string | null; first_name: string; days_since_order: number }): RenderedEmail {
  const greeting = c.first_name ? `Hi ${escHtml(c.first_name)},` : 'Hi there,'
  return {
    subject: `Quick check-in from Roof Manager${c.first_name ? ', ' + c.first_name : ''}`,
    html: emailWrapper(`
      <p style="margin:0 0 16px">${greeting}</p>
      <p style="margin:0 0 16px">
        We noticed it's been a while since your last roof report on Roof Manager — about ${c.days_since_order} days,
        give or take. We just wanted to check in: is there anything not working for you, or anything we could
        be doing better?
      </p>
      <p style="margin:0 0 16px">
        If something broke or got in the way, we'd genuinely like to know — it helps us fix the same thing for
        every other customer. And if you've just been busy, no worries at all, your account is right where you left it.
      </p>
      <p style="margin:0 0 24px">
        Reply to this email, or grab a 15-minute slot if you'd rather chat:
      </p>
      <div style="text-align:center;margin:24px 0">
        <a href="https://calendar.app.google/KNLFST4CNxViPPN3A" style="display:inline-block;background:#00CC6A;color:#0A0A0A;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px;text-decoration:none">Book a 15-min chat</a>
      </div>
      <p style="margin:24px 0 0;color:#6B7280;font-size:14px">
        — The Roof Manager team<br>
        <span style="font-size:12px">sales@roofmanager.ca · roofmanager.ca</span>
      </p>
    `)
  }
}

function renderTrialEnds(c: { name: string | null; first_name: string; days_until_end: number }): RenderedEmail {
  const greeting = c.first_name ? `Hi ${escHtml(c.first_name)},` : 'Hi there,'
  const daysWord = c.days_until_end <= 1 ? 'tomorrow' : `in ${c.days_until_end} days`
  return {
    subject: `Your Roof Manager trial ends ${daysWord} — want a hand?`,
    html: emailWrapper(`
      <p style="margin:0 0 16px">${greeting}</p>
      <p style="margin:0 0 16px">
        Heads up — your Roof Manager free trial wraps up <strong>${daysWord}</strong>. We noticed you haven't run a
        roof report yet, and we don't want you to miss the chance to test-drive it before the trial ends.
      </p>
      <p style="margin:0 0 16px">
        If you've got 15 minutes, we can hop on a call and walk you through your first measurement — that way you
        know if it's a fit before deciding anything. Or if you want to try it solo, the dashboard is right here:
      </p>
      <div style="text-align:center;margin:24px 0">
        <a href="https://www.roofmanager.ca/customer" style="display:inline-block;background:#00CC6A;color:#0A0A0A;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px;text-decoration:none;margin-right:8px">Try a roof report</a>
        <a href="https://calendar.app.google/KNLFST4CNxViPPN3A" style="display:inline-block;background:#fff;color:#0A0A0A;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px;text-decoration:none;border:1px solid #0A0A0A">Book a 15-min walkthrough</a>
      </div>
      <p style="margin:24px 0 0;color:#6B7280;font-size:14px">
        — The Roof Manager team<br>
        <span style="font-size:12px">sales@roofmanager.ca · roofmanager.ca</span>
      </p>
    `)
  }
}

// ── ELIGIBILITY QUERIES ──────────────────────────────────────
// Each campaign returns up to `limit` candidates that haven't received
// THIS template within `cooldownDays`. Drips are paused entirely if
// drip_campaign_state.paused = 1 for that customer.
function buildEligibility(db: Db, template: string, cooldownDays: number, limit: number) {
  if (template === 'stuck_signup_60d') {
    return db.prepare(`
      SELECT c.id, c.email, c.name,
             COALESCE(c.free_trial_total, 3) - COALESCE(c.free_trial_used, 0) AS credits_remaining
      FROM customers c
      LEFT JOIN drip_campaign_state d ON d.customer_id = c.id
      WHERE c.is_active = 1
        AND c.email IS NOT NULL
        AND c.created_at < datetime('now', '-60 days')
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)
        AND COALESCE(c.free_trial_used, 0) < COALESCE(c.free_trial_total, 3)
        AND COALESCE(d.paused, 0) = 0
        AND (
          d.last_drip_template IS NULL
          OR d.last_drip_template <> 'stuck_signup_60d'
          OR d.last_drip_sent_at IS NULL
          OR d.last_drip_sent_at < datetime('now', ?)
        )
      ORDER BY c.created_at DESC
      LIMIT ?
    `).bind(`-${cooldownDays} days`, limit)
  }
  if (template === 'at_risk_churn_30d') {
    return db.prepare(`
      SELECT c.id, c.email, c.name,
             CAST((julianday('now') - julianday(csi.last_order_at)) AS INTEGER) AS days_since_order
      FROM customers c
      LEFT JOIN customer_sales_intel csi ON csi.customer_id = c.id
      LEFT JOIN drip_campaign_state d ON d.customer_id = c.id
      WHERE c.is_active = 1
        AND c.email IS NOT NULL
        AND c.subscription_status IN ('active', 'past_due', 'trialing')
        AND COALESCE(csi.last_active_at, c.last_login, c.created_at) < datetime('now', '-30 days')
        AND csi.last_order_at IS NOT NULL
        AND csi.last_order_at < datetime('now', '-90 days')
        AND COALESCE(d.paused, 0) = 0
        AND (
          d.last_drip_template IS NULL
          OR d.last_drip_template <> 'at_risk_churn_30d'
          OR d.last_drip_sent_at IS NULL
          OR d.last_drip_sent_at < datetime('now', ?)
        )
      ORDER BY days_since_order DESC
      LIMIT ?
    `).bind(`-${cooldownDays} days`, limit)
  }
  if (template === 'trial_ends_3d') {
    return db.prepare(`
      SELECT c.id, c.email, c.name,
             CAST((julianday(c.trial_ends_at) - julianday('now')) AS INTEGER) AS days_until_end
      FROM customers c
      LEFT JOIN drip_campaign_state d ON d.customer_id = c.id
      WHERE c.is_active = 1
        AND c.email IS NOT NULL
        AND c.trial_ends_at IS NOT NULL
        AND c.trial_ends_at > datetime('now')
        AND c.trial_ends_at < datetime('now', '+3 days')
        AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)
        AND COALESCE(d.paused, 0) = 0
        AND (
          d.last_drip_template IS NULL
          OR d.last_drip_template <> 'trial_ends_3d'
          OR d.last_drip_sent_at IS NULL
          OR d.last_drip_sent_at < datetime('now', ?)
        )
      ORDER BY c.trial_ends_at ASC
      LIMIT ?
    `).bind(`-${cooldownDays} days`, limit)
  }
  return null
}

function firstNameFrom(name: string | null): string {
  if (!name) return ''
  return String(name).trim().split(/\s+/)[0] || ''
}

function renderTemplate(template: string, candidate: any): RenderedEmail | null {
  const first = firstNameFrom(candidate.name)
  if (template === 'stuck_signup_60d') {
    return renderStuckSignup({ name: candidate.name, first_name: first, credits_remaining: candidate.credits_remaining || 0 })
  }
  if (template === 'at_risk_churn_30d') {
    return renderAtRiskChurn({ name: candidate.name, first_name: first, days_since_order: candidate.days_since_order || 0 })
  }
  if (template === 'trial_ends_3d') {
    return renderTrialEnds({ name: candidate.name, first_name: first, days_until_end: Math.max(1, candidate.days_until_end || 1) })
  }
  return null
}

/**
 * Run the drip evaluator. Iterates every enabled campaign, picks
 * eligible customers (cooldown-respecting), and either sends or
 * dry-runs based on config.
 */
export async function runDripCampaigns(env: any, opts: { previewOnly?: boolean } = {}): Promise<{ campaigns: DripResult[]; dry_run: boolean; preview?: any[] }> {
  const db = env.DB as Db
  const cfg = await loadConfig(db)
  const isDry = opts.previewOnly || cfg.dry_run
  const results: DripResult[] = []
  const previewRows: any[] = []

  let creds: { clientId: string; clientSecret: string; refreshToken: string } | null = null
  if (!isDry && cfg.campaigns_enabled.length > 0) {
    try {
      creds = await loadGmailCreds(env)
    } catch (e: any) {
      console.warn('[drip-campaigns] Gmail creds load failed:', e?.message)
    }
  }

  for (const template of cfg.campaigns_enabled) {
    const r: DripResult = { template, sent: 0, dry_run: 0, errors: 0, skipped_cooldown: 0 }
    const stmt = buildEligibility(db, template, cfg.cooldown_days, cfg.max_per_run)
    if (!stmt) { results.push(r); continue }

    let rows: any[] = []
    try {
      const res = await stmt.all()
      rows = (res.results || []) as any[]
    } catch (e: any) {
      console.warn(`[drip-campaigns:${template}] eligibility query failed:`, e?.message)
      results.push(r)
      continue
    }

    for (const row of rows) {
      const rendered = renderTemplate(template, row)
      if (!rendered) { r.errors++; continue }

      if (opts.previewOnly) {
        previewRows.push({
          template,
          customer_id: row.id,
          email: row.email,
          name: row.name,
          subject: rendered.subject,
          mode: isDry ? 'DRY_RUN' : 'WOULD_SEND'
        })
        r.dry_run++
        continue
      }

      if (isDry) {
        // Record state but don't send. This is the steady-state preview
        // mode — once you flip dry_run=false in agent_configs, real sends start.
        r.dry_run++
        try {
          await db.prepare(`
            INSERT INTO drip_campaign_state (customer_id, last_drip_template, last_drip_sent_at, drip_count, last_evaluated_at)
            VALUES (?, ?, NULL, 0, datetime('now'))
            ON CONFLICT(customer_id) DO UPDATE SET
              last_evaluated_at = datetime('now')
          `).bind(row.id, template + ':DRY').run()
        } catch (e: any) {
          console.warn('[drip-campaigns] dry-run state insert failed:', e?.message)
        }
        continue
      }

      // Live send.
      if (!creds) { r.errors++; continue }
      const dripToken = await logEmailSend(env as any, { customerId: row.id ?? null, recipient: row.email, kind: `drip_${template}`, subject: rendered.subject })
      const dripPixel = buildTrackingPixel(dripToken)
      const dripWithPixel = rendered.html.includes('</body>') ? rendered.html.replace('</body>', `${dripPixel}</body>`) : rendered.html + dripPixel
      const dripHtml = wrapEmailLinks(dripWithPixel, dripToken)
      try {
        await sendGmailOAuth2(
          creds.clientId, creds.clientSecret, creds.refreshToken,
          row.email, rendered.subject, dripHtml,
          cfg.sender_email
        )
        await db.prepare(`
          INSERT INTO drip_campaign_state (customer_id, last_drip_template, last_drip_sent_at, drip_count, last_evaluated_at)
          VALUES (?, ?, datetime('now'), 1, datetime('now'))
          ON CONFLICT(customer_id) DO UPDATE SET
            last_drip_template = excluded.last_drip_template,
            last_drip_sent_at = excluded.last_drip_sent_at,
            drip_count = COALESCE(drip_campaign_state.drip_count, 0) + 1,
            last_evaluated_at = excluded.last_evaluated_at
        `).bind(row.id, template).run()
        r.sent++
      } catch (e: any) {
        console.warn(`[drip-campaigns:${template}] send failed for ${row.email}:`, e?.message)
        await markEmailFailed(env as any, dripToken, String(e?.message || e))
        r.errors++
      }
    }

    results.push(r)
  }

  // Update agent_configs.last_run_*
  try {
    const total = results.reduce((acc, r) => acc + r.sent + r.dry_run, 0)
    await db.prepare(`
      UPDATE agent_configs
      SET last_run_at = datetime('now'),
          last_run_status = 'success',
          last_run_details = ?,
          run_count = COALESCE(run_count, 0) + 1,
          updated_at = datetime('now')
      WHERE agent_type = 'drips'
    `).bind(JSON.stringify({ total, results, dry_run: isDry })).run()
  } catch {}

  return opts.previewOnly
    ? { campaigns: results, dry_run: isDry, preview: previewRows }
    : { campaigns: results, dry_run: isDry }
}

/** Toggle dry_run on or off (super admin only). */
export async function setDripDryRun(db: Db, dryRun: boolean): Promise<void> {
  const row = await db.prepare(`SELECT config_json FROM agent_configs WHERE agent_type='drips'`).first<any>()
  const cfg = row?.config_json ? JSON.parse(row.config_json) : { ...DEFAULT_CONFIG }
  cfg.dry_run = dryRun
  await db.prepare(`UPDATE agent_configs SET config_json=?, updated_at=datetime('now') WHERE agent_type='drips'`)
    .bind(JSON.stringify(cfg)).run()
}

// ============================================================
// Lead Response Agent — Autonomous personalized outreach
// Powered by Anthropic Claude (claude-sonnet-4-6)
// Fires on new leads in asset_report_leads not yet responded to.
// ============================================================

import type { Bindings } from '../types'
import { getAnthropicClient, CLAUDE_MODEL, extractJson } from './anthropic-client'
import { sendViaResend, sendGmailOAuth2, loadGmailCreds } from './email'
import { logEmailSend, markEmailFailed, buildTrackingPixel, wrapEmailLinks } from './email-tracking'

export interface LeadRow {
  id: number
  email: string
  name?: string | null
  company?: string | null
  address?: string | null
  building_count?: number | null
  source: string
}

export interface LeadEmail {
  subject: string
  html: string
}

export interface LeadRunResult {
  ok: boolean
  responded: number
  skipped: number
  errors: string[]
  duration_ms: number
}

// ── Prompt builder (exported for testing) ─────────────────────

export function buildLeadPrompt(lead: LeadRow): string {
  // Treat known placeholders the same as a missing name. Historical rows
  // landed with name='Website Visitor' / 'Blog visitor' from anonymous form
  // submissions; passing those into the prompt would surface as "Hi
  // Website," in generated emails.
  const PLACEHOLDER_NAMES = /^(website visitor|blog visitor|anonymous|unknown|n\/?a)$/i
  const rawName = (lead.name || '').trim()
  const name = !rawName || PLACEHOLDER_NAMES.test(rawName) ? 'there' : rawName
  const company = lead.company ? ` at ${lead.company}` : ''
  const address = lead.address ? ` for the property at ${lead.address}` : ''
  const buildingNote = lead.building_count && lead.building_count > 1
    ? ` (${lead.building_count} buildings)`
    : ''
  const sourceMap: Record<string, string> = {
    homepage_cta: 'your website',
    demo_portal: 'the demo portal',
    condo_cheat_sheet: 'the condo reserve fund guide',
    other: 'our website',
  }
  const sourceLabel = sourceMap[lead.source] || 'our website'

  return `You are writing a follow-up email on behalf of Roof Manager (roofmanager.ca) — roof measurement and roofer CRM software used by property managers, roofing contractors, and condo boards across the US and Canada.

Never write "AI-powered" or "AI-driven" — describe specific capabilities instead (satellite measurement, voice receptionist, etc.).

The lead is: ${name}${company}. They requested information${address}${buildingNote} via ${sourceLabel}.

Write a short, warm, VALUE-FIRST follow-up email. Do NOT be salesy or pushy. The goal is to:
1. Acknowledge what they asked for
2. Give them one concrete piece of useful information (e.g., "a typical 2,000 sq ft roof in Canada costs $8,000–$15,000 to replace")
3. Offer a next step: a free sample report or a quick call

Tone: professional but friendly, like a knowledgeable colleague — not a sales pitch.
Length: 4-6 short paragraphs.
Sign off as: "The Roof Manager Team"
Include a CTA button link to https://roofmanager.ca/free-roof-estimate

Return STRICT JSON only — no markdown fences:
{
  "subject": "Subject line (max 60 chars, not spammy)",
  "html": "<full HTML email body with inline styles suitable for email clients>"
}`
}

// ── Response parser (exported for testing) ────────────────────

const DEFAULT_RESPONSE: LeadEmail = {
  subject: 'Your Roof Manager request',
  html: '<p>Thank you for your interest in Roof Manager. We\'ll be in touch shortly.</p><p><a href="https://roofmanager.ca/free-roof-estimate">Get a free roof estimate</a></p>',
}

export function parseLeadEmail(text: string): LeadEmail {
  try {
    const result = extractJson<LeadEmail>(text)
    if (!result.subject || !result.html) throw new Error('Missing fields')
    return result
  } catch {
    return DEFAULT_RESPONSE
  }
}

// ── Duplicate guard (exported for testing) ────────────────────

export function shouldSkipLead(email: string, respondedEmails: Set<string>): boolean {
  return respondedEmails.has(email.toLowerCase().trim())
}

// ── Main orchestrator ─────────────────────────────────────────

export async function runLeadAgent(env: Bindings): Promise<LeadRunResult> {
  const start = Date.now()
  const result: LeadRunResult = { ok: true, responded: 0, skipped: 0, errors: [], duration_ms: 0 }

  if (!env.ANTHROPIC_API_KEY) {
    return { ...result, ok: false, errors: ['ANTHROPIC_API_KEY not configured'], duration_ms: 0 }
  }
  // Email transport: prefer Resend if configured, fall back to Gmail OAuth2
  // (which IS the working production transport — see Loop Tracker docs).
  // Bail with a clean "skipped" if neither is available.
  const hasResend = !!env.RESEND_API_KEY
  const gmailCreds = await loadGmailCreds(env as any)
  const hasGmail = !!(gmailCreds.clientId && gmailCreds.clientSecret && gmailCreds.refreshToken)
  if (!hasResend && !hasGmail) {
    // Skip cleanly — not an error. Treats the cron worker missing email
    // creds as "no work today" rather than alarming on every tick.
    return { ...result, ok: true, errors: ['skipped: no email transport configured (RESEND_API_KEY + GMAIL_* both missing on cron Worker)'], duration_ms: 0 }
  }

  // Fetch new leads not yet responded to
  const leads = await env.DB.prepare(
    `SELECT a.id, a.email, a.name, a.company, a.address, a.building_count, a.source
     FROM asset_report_leads a
     WHERE NOT EXISTS (
       SELECT 1 FROM lead_responses lr WHERE lr.lead_email = lower(a.email)
     )
     ORDER BY a.created_at ASC
     LIMIT 10`
  ).all<LeadRow>()

  if (!leads.results?.length) {
    return { ...result, skipped: 0, duration_ms: Date.now() - start }
  }

  const client = getAnthropicClient(env.ANTHROPIC_API_KEY)

  // Lightweight email format check — reject obviously broken addresses BEFORE
  // burning the LLM budget + a Gmail/Resend send attempt that's guaranteed to
  // bounce. Mark as failed so the OUTER query doesn't re-pick it next tick.
  const isValidEmail = (e: string | null | undefined): boolean => {
    if (!e || typeof e !== 'string') return false
    const trimmed = e.trim()
    if (trimmed.length < 5 || trimmed.length > 320) return false
    // RFC-lite — covers ~99% of real-world addresses, rejects whitespace,
    // multiple @, missing TLD, etc.
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)
  }

  for (const lead of leads.results) {
    if (!isValidEmail(lead.email)) {
      result.errors.push(`Lead ${lead.email || '<empty>'}: invalid email format — skipped`)
      // Record so we don't re-pick this row on every tick.
      try {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO lead_responses (lead_email, lead_source, response_subject, success)
           VALUES (lower(?), ?, 'INVALID_EMAIL', 0)`
        ).bind(String(lead.email || ''), lead.source).run()
      } catch {}
      continue
    }
    try {
      const msg = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 2048,
        messages: [{ role: 'user', content: buildLeadPrompt(lead) }],
      })
      const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
      const email = parseLeadEmail(text)

      // Cold leads aren't customers yet — customerId stays null. kind tags
      // the email_sends row so the Journey UI groups it as outreach.
      const trackingToken = await logEmailSend(env, {
        customerId: null,
        recipient: lead.email,
        kind: 'lead_outreach',
        subject: email.subject,
      })
      const pixel = buildTrackingPixel(trackingToken)
      const htmlWithPixel = email.html.includes('</body>')
        ? email.html.replace('</body>', `${pixel}</body>`)
        : email.html + pixel
      const trackedHtml = wrapEmailLinks(htmlWithPixel, trackingToken)

      try {
        if (hasResend) {
          await sendViaResend(
            env.RESEND_API_KEY!,
            lead.email,
            email.subject,
            trackedHtml,
            env.GMAIL_SENDER_EMAIL || null,
          )
        } else {
          await sendGmailOAuth2(
            gmailCreds.clientId!,
            gmailCreds.clientSecret!,
            gmailCreds.refreshToken!,
            lead.email,
            email.subject,
            trackedHtml,
            gmailCreds.senderEmail || env.GMAIL_SENDER_EMAIL || null,
          )
        }
      } catch (sendErr: any) {
        await markEmailFailed(env, trackingToken, String(sendErr?.message || sendErr))
        throw sendErr
      }

      await env.DB.prepare(
        `INSERT OR IGNORE INTO lead_responses (lead_email, lead_source, response_subject, success)
         VALUES (lower(?), ?, ?, 1)`
      ).bind(lead.email, lead.source, email.subject).run()

      result.responded++
    } catch (err: any) {
      const msg = `Lead ${lead.email}: ${err.message || String(err)}`
      result.errors.push(msg)

      // Record failure so we don't retry endlessly
      try {
        await env.DB.prepare(
          `INSERT OR IGNORE INTO lead_responses (lead_email, lead_source, response_subject, success)
           VALUES (lower(?), ?, 'ERROR', 0)`
        ).bind(lead.email, lead.source).run()
      } catch {}
    }
  }

  result.duration_ms = Date.now() - start
  result.ok = result.errors.length === 0 || result.responded > 0
  return result
}

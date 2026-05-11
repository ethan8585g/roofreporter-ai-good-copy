// ============================================================
// Email Marketing Agent — Autonomous weekly campaign generation
// Powered by Anthropic Claude (claude-sonnet-4-6)
// Targets unengaged contacts from email_contacts table.
// ============================================================

import type { Bindings } from '../types'
import { getAnthropicClient, CLAUDE_MODEL, extractJson } from './anthropic-client'
import { sendViaResend } from './email'
import { logEmailSend, markEmailFailed, buildTrackingPixel, wrapEmailLinks } from './email-tracking'

export interface CampaignStats {
  total_contacts: number
  avg_open_rate: number           // 0-1
  last_campaign_date: string | null
  top_sources: string[]
}

export interface CampaignContent {
  campaign_name: string
  subject: string
  preheader: string
  body_html: string
  body_text: string
}

export interface EmailAgentResult {
  ok: boolean
  campaign_id?: number
  campaign_name?: string
  recipients: number
  sent: number
  errors: string[]
  skipped?: boolean
  duration_ms: number
}

// ── Prompt builder (exported for testing) ─────────────────────

export function buildCampaignPrompt(stats: CampaignStats): string {
  const lastCampaign = stats.last_campaign_date
    ? `The last campaign was sent on ${stats.last_campaign_date}.`
    : 'No campaigns have been sent yet.'
  const openRate = `${Math.round(stats.avg_open_rate * 100)}%`
  const sources = stats.top_sources.length
    ? `Most contacts came from: ${stats.top_sources.join(', ')}.`
    : ''

  return `You are a content strategist for Roof Manager (roofmanager.ca) — roof measurement and roofer CRM software for contractors and property managers across the US and Canada.

Never write "AI-powered" or "AI-driven" — describe specific capabilities instead.

Write a weekly educational email campaign for ${stats.total_contacts} unengaged contacts.
Current average open rate: ${openRate}. ${lastCampaign} ${sources}

The email should:
- Lead with VALUE — a useful tip, industry insight, or money-saving fact about roofing
- Be educational, NOT promotional. No "BUY NOW" language.
- Mention Roof Manager naturally as a tool that solves the problem discussed
- Include one clear CTA to https://roofmanager.ca/free-roof-estimate or https://roofmanager.ca/pricing
- Be mobile-friendly HTML with inline styles
- Subject line: compelling, under 50 chars, no spam trigger words
- Preheader: 80-100 chars, teases the content

Return STRICT JSON only — no markdown fences:
{
  "campaign_name": "Short internal name for this campaign",
  "subject": "Subject line",
  "preheader": "Preheader text",
  "body_html": "<full HTML email with inline styles>",
  "body_text": "Plain text version"
}`
}

// ── Parser (exported for testing) ────────────────────────────

export function parseCampaignContent(text: string): CampaignContent {
  const content = extractJson<CampaignContent>(text)
  if (!content.subject || !content.body_html || !content.campaign_name) {
    throw new Error(`Campaign content missing required fields. Got: ${Object.keys(content).join(', ')}`)
  }
  return content
}

// ── Segment filter (exported for testing) ────────────────────

export interface ContactRow {
  id: number
  email: string
  contact_name?: string | null
  sends_count: number
  status: string
}

export function filterEligibleContacts(contacts: ContactRow[], maxSends = 3): ContactRow[] {
  return contacts.filter(c => c.status === 'active' && c.sends_count < maxSends)
}

// ── Main orchestrator ─────────────────────────────────────────

export async function runEmailAgent(env: Bindings): Promise<EmailAgentResult> {
  const start = Date.now()
  const result: EmailAgentResult = { ok: true, recipients: 0, sent: 0, errors: [], duration_ms: 0 }

  if (!env.ANTHROPIC_API_KEY) {
    return { ...result, ok: false, errors: ['ANTHROPIC_API_KEY not configured'], duration_ms: 0 }
  }
  if (!env.RESEND_API_KEY) {
    return { ...result, ok: false, errors: ['RESEND_API_KEY not configured'], duration_ms: 0 }
  }

  // Fetch unengaged contacts (active, not opened, under send cap)
  const contactsRes = await env.DB.prepare(
    `SELECT id, email, contact_name, sends_count, status
     FROM email_contacts
     WHERE status = 'active' AND opens_count = 0 AND sends_count < 3
     LIMIT 200`
  ).all<ContactRow>()

  const contacts = filterEligibleContacts(contactsRes.results || [])
  if (contacts.length === 0) {
    return { ...result, skipped: true, duration_ms: Date.now() - start }
  }

  // Gather campaign stats for Claude context
  const statsRow = await env.DB.prepare(
    `SELECT
       COUNT(*) as total,
       AVG(CAST(opens_count AS REAL) / NULLIF(sends_count, 0)) as avg_open_rate
     FROM email_contacts WHERE status = 'active'`
  ).first<{ total: number; avg_open_rate: number | null }>()

  const lastCampaignRow = await env.DB.prepare(
    `SELECT completed_at FROM email_campaigns WHERE status = 'completed' ORDER BY completed_at DESC LIMIT 1`
  ).first<{ completed_at: string | null }>()

  const sourceRows = await env.DB.prepare(
    `SELECT source, COUNT(*) as cnt FROM email_contacts WHERE source IS NOT NULL GROUP BY source ORDER BY cnt DESC LIMIT 3`
  ).all<{ source: string }>()

  const stats: CampaignStats = {
    total_contacts: contacts.length,
    avg_open_rate: statsRow?.avg_open_rate ?? 0,
    last_campaign_date: lastCampaignRow?.completed_at ?? null,
    top_sources: sourceRows.results?.map(r => r.source) ?? [],
  }

  // Generate campaign with Claude
  const client = getAnthropicClient(env.ANTHROPIC_API_KEY)
  let content: CampaignContent
  try {
    const msg = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: buildCampaignPrompt(stats) }],
    })
    const text = msg.content[0].type === 'text' ? msg.content[0].text : ''
    content = parseCampaignContent(text)
  } catch (err: any) {
    return { ...result, ok: false, errors: [`Claude error: ${err.message}`], duration_ms: Date.now() - start }
  }

  // Create campaign record
  const listIds = JSON.stringify([])
  const campaignRow = await env.DB.prepare(
    `INSERT INTO email_campaigns
       (name, subject, from_name, body_html, body_text, list_ids, status, total_recipients, started_at)
     VALUES (?, ?, 'Roof Manager', ?, ?, ?, 'active', ?, datetime('now'))`
  ).bind(
    content.campaign_name, content.subject,
    content.body_html, content.body_text,
    listIds, contacts.length,
  ).run()
  const campaignId = (campaignRow.meta as any)?.last_row_id as number
  result.campaign_id = campaignId
  result.campaign_name = content.campaign_name
  result.recipients = contacts.length

  // Send to each contact — log to email_sends + pixel + click wrapping
  // so each campaign send shows up in the Journey > Email Tracking feed
  // alongside transactional mail. customerId stays null (these are
  // prospects, not platform customers).
  for (const contact of contacts) {
    const trackingToken = await logEmailSend(env, {
      customerId: null,
      recipient: contact.email,
      kind: 'campaign',
      subject: content.subject,
    })
    const pixel = buildTrackingPixel(trackingToken)
    const htmlWithPixel = content.body_html.includes('</body>')
      ? content.body_html.replace('</body>', `${pixel}</body>`)
      : content.body_html + pixel
    const trackedHtml = wrapEmailLinks(htmlWithPixel, trackingToken)
    try {
      await sendViaResend(
        env.RESEND_API_KEY,
        contact.email,
        content.subject,
        trackedHtml,
        env.GMAIL_SENDER_EMAIL || null,
      )
      await env.DB.prepare(
        `UPDATE email_contacts SET sends_count = sends_count + 1, last_sent_at = datetime('now') WHERE id = ?`
      ).bind(contact.id).run()
      await env.DB.prepare(
        `INSERT INTO email_send_log (campaign_id, contact_id, email, status, sent_at)
         VALUES (?, ?, ?, 'sent', datetime('now'))`
      ).bind(campaignId, contact.id, contact.email).run()
      result.sent++
    } catch (err: any) {
      await markEmailFailed(env, trackingToken, String(err?.message || err))
      result.errors.push(`${contact.email}: ${err.message}`)
    }
  }

  // Mark campaign complete
  await env.DB.prepare(
    `UPDATE email_campaigns SET status = 'completed', sent_count = ?, completed_at = datetime('now') WHERE id = ?`
  ).bind(result.sent, campaignId).run()

  result.duration_ms = Date.now() - start
  result.ok = result.sent > 0
  return result
}

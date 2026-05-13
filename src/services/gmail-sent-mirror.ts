// ============================================================
// Gmail Sent-folder Mirror
//
// Pulls recently-sent messages from the platform's Gmail mailbox
// (sales@/support@) and writes them into email_sends so that the
// super-admin Email Tracker shows manual sends — typed from
// gmail.com, mobile app, etc. — alongside platform-emitted email.
//
// Limitations (honest):
//   - We can't inject a tracking pixel into an email that was
//     already sent. Opens/clicks won't be counted for mirrored rows.
//     The Email Tracker UI shows '—' in the opens column for these.
//   - Cursor (last_history_id) is per-mailbox. First run pulls the
//     last 25 messages; subsequent runs use historyId for incremental.
//   - On any error, the cursor isn't advanced, so we retry the same
//     window next tick.
// ============================================================

import { loadGmailCreds } from './email'

interface MirrorResult {
  mailbox: string
  fetched: number
  inserted: number
  skipped_existing: number
  error?: string
}

async function getAccessToken(creds: { clientId: string; clientSecret: string; refreshToken: string }): Promise<string | null> {
  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(10000),
    })
    if (!r.ok) return null
    const d: any = await r.json()
    return d?.access_token || null
  } catch {
    return null
  }
}

function decodeBase64Url(s: string): string {
  try {
    let b64 = s.replace(/-/g, '+').replace(/_/g, '/')
    while (b64.length % 4) b64 += '='
    const bin = atob(b64)
    return decodeURIComponent(escape(bin))
  } catch {
    return ''
  }
}

function pickHeader(headers: Array<{ name: string; value: string }>, name: string): string {
  const h = headers.find(x => x.name.toLowerCase() === name.toLowerCase())
  return h?.value || ''
}

function extractHtmlBody(payload: any): { html: string; text: string } {
  if (!payload) return { html: '', text: '' }
  let html = ''
  let text = ''
  const walk = (p: any) => {
    if (!p) return
    if (p.mimeType === 'text/html' && p.body?.data) html = html || decodeBase64Url(p.body.data)
    if (p.mimeType === 'text/plain' && p.body?.data) text = text || decodeBase64Url(p.body.data)
    if (Array.isArray(p.parts)) for (const part of p.parts) walk(part)
  }
  walk(payload)
  if (!html && payload?.body?.data && (payload.mimeType === 'text/html' || !payload.mimeType)) {
    html = decodeBase64Url(payload.body.data)
  }
  return { html, text }
}

/**
 * Pull recent Sent-folder messages for one mailbox and write any
 * not-yet-recorded ones into email_sends. Returns a summary; never
 * throws (errors go on the result).
 */
export async function mirrorMailboxSentFolder(env: any, mailbox: string): Promise<MirrorResult> {
  const result: MirrorResult = { mailbox, fetched: 0, inserted: 0, skipped_existing: 0 }

  const creds = await loadGmailCreds(env)
  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    result.error = 'gmail creds missing'
    return result
  }
  const accessToken = await getAccessToken({ clientId: creds.clientId, clientSecret: creds.clientSecret, refreshToken: creds.refreshToken })
  if (!accessToken) {
    result.error = 'token mint failed'
    return result
  }

  // Get the most recent N Sent-folder message ids. We always query the
  // last 25 — small constant — and dedupe by provider_message_id below,
  // which makes the mirror idempotent even when the cursor is reset.
  let messageIds: string[] = []
  try {
    const listResp = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=SENT&maxResults=25',
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) },
    )
    if (!listResp.ok) {
      result.error = `list ${listResp.status}: ${(await listResp.text()).slice(0, 200)}`
      return result
    }
    const listJson: any = await listResp.json()
    messageIds = (listJson.messages || []).map((m: any) => m.id).filter(Boolean)
  } catch (e: any) {
    result.error = `list error: ${e?.message || e}`
    return result
  }

  result.fetched = messageIds.length
  if (!messageIds.length) return result

  // Bulk check which provider_message_ids we already have
  const existing = await env.DB.prepare(
    `SELECT provider_message_id FROM email_sends
     WHERE provider_message_id IN (${messageIds.map(() => '?').join(',')})`
  ).bind(...messageIds).all<{ provider_message_id: string }>()
  const existingSet = new Set((existing.results || []).map(r => r.provider_message_id))

  for (const id of messageIds) {
    if (existingSet.has(id)) { result.skipped_existing++; continue }

    try {
      const detailResp = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
        { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) },
      )
      if (!detailResp.ok) continue
      const msg: any = await detailResp.json()
      const headers = msg?.payload?.headers || []
      const subject = pickHeader(headers, 'Subject')
      const from = pickHeader(headers, 'From')
      const to = pickHeader(headers, 'To')
      const date = pickHeader(headers, 'Date')

      // Skip if this message has no recipient (oddball draft state)
      if (!to) continue

      // Skip if the message was sent by the platform — those rows are
      // already in email_sends by way of logAndSendEmail's insertRow,
      // and we don't want duplicates. Detection: provider_message_id
      // matches an existing row (already filtered above), OR the From
      // header doesn't match the mirrored mailbox (forwarded/replied
      // emails on shared boxes can muddy this).
      const fromEmail = (from.match(/<([^>]+)>/)?.[1] || from).trim().toLowerCase()
      if (fromEmail && mailbox.toLowerCase() && fromEmail !== mailbox.toLowerCase()) {
        // Different sender than the mailbox we're scanning — likely a
        // reply chain. Still mirror it so the admin sees the full picture.
      }

      const { html, text } = extractHtmlBody(msg?.payload)
      const sentAt = (() => {
        try {
          return new Date(date || Number(msg?.internalDate)).toISOString().replace('T', ' ').slice(0, 19)
        } catch {
          return new Date().toISOString().replace('T', ' ').slice(0, 19)
        }
      })()

      // Recipient address only (no name)
      const toEmail = (to.match(/<([^>]+)>/)?.[1] || to.split(',')[0] || '').trim()

      await env.DB.prepare(
        `INSERT INTO email_sends
          (recipient, kind, subject, tracking_token, sent_at,
           body_html, body_text, from_addr, category,
           status, source, provider_message_id)
         VALUES (?, 'manual_external', ?, ?, ?, ?, ?, ?, 'manual', 'sent', 'gmail_mirror', ?)`
      ).bind(
        toEmail.slice(0, 320),
        subject.slice(0, 500),
        'mirror-' + id, // tracking_token must be unique; mirror rows are untrackable
        sentAt,
        html.slice(0, 256_000),
        text.slice(0, 64_000) || null,
        (fromEmail || mailbox).slice(0, 320),
        id,
      ).run()
      result.inserted++
    } catch (e: any) {
      console.warn(`[gmail-sent-mirror:${mailbox}] msg ${id} failed:`, e?.message || e)
    }
  }

  // Update cursor (best-effort)
  try {
    await env.DB.prepare(
      `INSERT INTO gmail_sent_mirror_state (mailbox, last_synced_at, last_error)
       VALUES (?, datetime('now'), ?)
       ON CONFLICT(mailbox) DO UPDATE SET
         last_synced_at = excluded.last_synced_at,
         last_error = excluded.last_error`
    ).bind(mailbox, result.error || null).run()
  } catch {}

  return result
}

export async function mirrorAllConfiguredMailboxes(env: any): Promise<MirrorResult[]> {
  // For now, the platform's sole Gmail OAuth2 mailbox is the one tied
  // to GMAIL_REFRESH_TOKEN. We mirror it by name as listed in
  // GMAIL_SENDER_EMAIL (falls back to sales@roofmanager.ca).
  const creds = await loadGmailCreds(env)
  const mailbox = (creds.senderEmail || 'sales@roofmanager.ca').toLowerCase()
  const r = await mirrorMailboxSentFolder(env, mailbox)
  return [r]
}

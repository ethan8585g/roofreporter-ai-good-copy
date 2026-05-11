// ============================================================
// EMAIL TRACKING — open + send-log helper used by every outbound
// transactional email (welcome, nurture, etc.).
//
// Flow:
//   1. logEmailSend() — call BEFORE send. Generates a tracking_token,
//      writes the email_sends row (sent_at, kind, recipient, subject).
//      Returns the token so caller can embed the pixel in the HTML body.
//   2. buildTrackingPixel(token) — returns the <img> tag to inject just
//      before the closing </body>. Hidden 1x1 transparent GIF.
//   3. recordOpen(token, ip, ua) — called by GET /api/email-pixel/:token
//      when the mail client fetches the pixel. Increments open_count.
//
// Caveats (NOT silent):
//   - Gmail/Apple Mail prefetch images → first "open" can be the
//     server-side proxy, not the human.
//   - Outlook + privacy-protected clients block images → opens never
//     register even if the human read the email.
//   - Plain-text-only clients never fire the pixel.
//   - Click tracking (wrapping CTA links) is the reliable signal —
//     follow-up build.
// ============================================================

import type { Bindings } from '../types'

export interface LogEmailSendParams {
  customerId: number | null
  recipient: string
  kind: string
  subject: string
}

/**
 * Random URL-safe 32-char token. crypto.getRandomValues is available in
 * Cloudflare Workers without any imports.
 */
function generateTrackingToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  // base64url encoding — URL-safe, no padding
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Insert an email_sends row BEFORE sending. Returns the tracking_token
 * so the caller can embed the pixel in the email body. Never throws —
 * if the DB write fails, returns null and email still sends untracked.
 */
export async function logEmailSend(env: any, p: LogEmailSendParams): Promise<string | null> {
  try {
    const token = generateTrackingToken()
    await env.DB.prepare(
      `INSERT INTO email_sends (customer_id, recipient, kind, subject, tracking_token, sent_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      p.customerId,
      p.recipient.slice(0, 320),
      p.kind.slice(0, 100),
      (p.subject || '').slice(0, 500),
      token,
    ).run()
    return token
  } catch (e: any) {
    console.warn('[email-tracking] logEmailSend failed:', e?.message || e)
    return null
  }
}

/**
 * Mark an existing log row as failed-to-send. Use when sendGmailOAuth2
 * throws after the row has been created. Keeps the audit trail honest.
 */
export async function markEmailFailed(env: any, token: string | null, error: string): Promise<void> {
  if (!token) return
  try {
    await env.DB.prepare(
      `UPDATE email_sends SET send_error = ? WHERE tracking_token = ?`
    ).bind(error.slice(0, 500), token).run()
  } catch (e: any) {
    console.warn('[email-tracking] markEmailFailed failed:', e?.message || e)
  }
}

/**
 * Build the tracking pixel HTML. Inject this just before </body> in the
 * email HTML. 1×1 transparent GIF, hidden via inline style.
 *
 * The fallback (when token is null) returns an empty string so callers
 * don't need to conditionally include it.
 */
export function buildTrackingPixel(token: string | null, baseUrl = 'https://www.roofmanager.ca'): string {
  if (!token) return ''
  // Format the URL so it looks like a real .gif (some mail clients are
  // suspicious of bare endpoints).
  return `<img src="${baseUrl}/api/email-pixel/${encodeURIComponent(token)}.gif" alt="" width="1" height="1" style="display:none;width:1px;height:1px;max-width:1px;max-height:1px;border:0;line-height:0;overflow:hidden;visibility:hidden;mso-hide:all;" />`
}

/**
 * Record an email open. Called by GET /api/email-pixel/:token. Updates
 * opened_at (first open only) + increments open_count + last_opened_*.
 */
export async function recordEmailOpen(
  env: any,
  token: string,
  ip: string | null,
  ua: string | null,
): Promise<{ found: boolean }> {
  try {
    const result = await env.DB.prepare(
      `UPDATE email_sends
       SET opened_at = COALESCE(opened_at, datetime('now')),
           open_count = open_count + 1,
           last_opened_at = datetime('now'),
           last_opened_ip = ?,
           last_opened_ua = ?
       WHERE tracking_token = ?`
    ).bind(
      (ip || '').slice(0, 64) || null,
      (ua || '').slice(0, 255) || null,
      token,
    ).run()
    return { found: (result.meta?.changes || 0) > 0 }
  } catch (e: any) {
    console.warn('[email-tracking] recordEmailOpen failed:', e?.message || e)
    return { found: false }
  }
}

/**
 * Wrap every href in the email HTML with a tracked redirect URL.
 * Only wraps links to hosts in ALLOWED_HOSTS — external links pass
 * through untracked (avoids accidentally intercepting unknown 3rd
 * party links, and avoids the open-redirect attack surface).
 *
 * Encoding: base64url so URLs survive email-client query-param mangling.
 * Decoded + re-validated server-side at /api/email-link before redirect.
 *
 * The tracking_token is the SAME token used for the open-pixel — that's
 * how the click endpoint ties a click back to a specific email send.
 *
 * Skips: mailto:, tel:, anchor #fragments, links that are already wrapped.
 */
export function wrapEmailLinks(html: string, token: string | null, baseUrl = 'https://www.roofmanager.ca'): string {
  if (!token) return html
  const ALLOWED_HOSTS = new Set([
    'www.roofmanager.ca', 'roofmanager.ca',
    'calendar.app.google', // demo booking
  ])
  // Match: href="https://..." or href='https://...'. Quote style preserved.
  return html.replace(/href=(["'])(https?:\/\/[^"']+)\1/g, (match, quote, rawUrl) => {
    let parsed: URL
    try { parsed = new URL(rawUrl) } catch { return match }
    if (!ALLOWED_HOSTS.has(parsed.hostname)) return match
    // Skip if already wrapped (idempotent on re-runs).
    if (parsed.pathname.startsWith('/api/email-link/')) return match
    // Encode original URL as base64url.
    let b64 = ''
    try {
      const bin = unescape(encodeURIComponent(rawUrl))
      b64 = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    } catch { return match }
    const tracked = `${baseUrl}/api/email-link/${encodeURIComponent(token)}?u=${b64}`
    return `href=${quote}${tracked}${quote}`
  })
}

/**
 * Decode a base64url-encoded URL from the click endpoint's `?u=` param.
 * Returns null if the encoding is malformed.
 */
export function decodeWrappedUrl(b64: string): string | null {
  try {
    // base64url → base64
    let s = b64.replace(/-/g, '+').replace(/_/g, '/')
    // Re-pad
    while (s.length % 4) s += '='
    const bin = atob(s)
    return decodeURIComponent(escape(bin))
  } catch {
    return null
  }
}

/**
 * Record an email click. Called by GET /api/email-link/:token. Updates
 * click_count + first/last_clicked_at + last_clicked_url so the journey
 * view can show "clicked X 3× (last <url> at <ts>)".
 */
export async function recordEmailClick(
  env: any,
  token: string,
  url: string,
  ip: string | null,
  ua: string | null,
): Promise<{ found: boolean }> {
  try {
    const result = await env.DB.prepare(
      `UPDATE email_sends
       SET click_count = click_count + 1,
           first_clicked_at = COALESCE(first_clicked_at, datetime('now')),
           last_clicked_at = datetime('now'),
           last_clicked_url = ?,
           last_clicked_ip = ?,
           last_clicked_ua = ?
       WHERE tracking_token = ?`
    ).bind(
      url.slice(0, 1000),
      (ip || '').slice(0, 64) || null,
      (ua || '').slice(0, 255) || null,
      token,
    ).run()
    return { found: (result.meta?.changes || 0) > 0 }
  } catch (e: any) {
    console.warn('[email-tracking] recordEmailClick failed:', e?.message || e)
    return { found: false }
  }
}

/**
 * 1×1 transparent GIF as a raw Uint8Array. Returned by the pixel
 * endpoint. Smallest possible image file (43 bytes).
 */
export function transparentGifBytes(): Uint8Array {
  // GIF89a 1x1 transparent
  return new Uint8Array([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00,
    0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff, 0xff,
    0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
    0x01, 0x00, 0x3b,
  ])
}

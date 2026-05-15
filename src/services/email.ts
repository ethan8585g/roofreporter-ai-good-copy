import type { Bindings } from '../types'
// ============================================================
// Roof Manager — Email Delivery Service
// Supports: Gmail Service Account, Gmail OAuth2, Resend API
// ============================================================

// Mint-or-reuse a share_token for an order. The `/report/share/:token`
// route is public (no auth gate), unlike `/api/reports/:id/html` which is
// IDOR-protected and 401s for email recipients without a session.
// Centralizes the pattern duplicated in notifyTraceCompletedToCustomer
// and POST /:orderId/share.
export async function getOrCreateShareToken(
  env: Bindings,
  orderId: number | string
): Promise<string | null> {
  if (!env?.DB || orderId == null) return null
  try {
    const row = await env.DB.prepare(
      'SELECT share_token FROM reports WHERE order_id = ? ORDER BY id DESC LIMIT 1'
    ).bind(orderId).first<{ share_token: string | null }>()
    if (row?.share_token) return row.share_token
    const token = crypto.randomUUID().replace(/-/g, '').substring(0, 20)
    const result = await env.DB.prepare(
      "UPDATE reports SET share_token = ?, share_sent_at = datetime('now'), updated_at = datetime('now') WHERE order_id = ?"
    ).bind(token, orderId).run()
    // Only return the token if at least one row was actually updated. When
    // no report row exists yet, the UPDATE is a no-op and returning the
    // unpersisted token would produce an email link that 404s.
    const changes = (result as any)?.meta?.changes ?? (result as any)?.changes ?? 0
    if (changes < 1) return null
    return token
  } catch {
    return null
  }
}

// Short link-style email for completed reports — two buttons that open
// the full professional report and the customer-facing copy in a browser.
// Uses the public /report/share/<token> route so links work without a
// logged-in session. Falls back to /api/reports paths only when no token
// can be minted (e.g. the report row hasn't been created yet) — those
// will 401 for the recipient, but at least the email body is intact.
export function buildReportLinkEmail(
  baseUrl: string,
  orderId: number | string,
  address: string,
  reportNum: string,
  recipient: string,
  hasCustomerCopy: boolean = true,
  shareToken: string | null = null,
): string {
  const root = (baseUrl || 'https://www.roofmanager.ca').replace(/\/$/, '')
  const fullUrl = shareToken
    ? `${root}/report/share/${shareToken}`
    : `${root}/api/reports/${orderId}/html`
  const customerUrl = shareToken
    ? `${root}/report/share/${shareToken}?v=c`
    : `${root}/api/reports/${orderId}/customer-html`
  const customerButton = hasCustomerCopy
    ? `<a href="${customerUrl}" style="display:inline-block;background:#fff;color:#1E3A5F;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px;text-decoration:none;border:2px solid #1E3A5F;margin:6px">View Customer Report</a>`
    : ''
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px">
  <div style="background:#000;color:#fff;padding:20px 28px;border-radius:12px 12px 0 0;text-align:center">
    <img src="https://www.roofmanager.ca/static/logo.png?v=20260504" alt="Roof Manager" width="180" style="max-width:180px;height:auto;display:block;margin:0 auto"/>
    <div style="font-size:12px;color:#9CA3AF;margin-top:8px;letter-spacing:0.5px">Roof Report Ready</div>
  </div>
  <div style="background:#fff;padding:28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <p style="font-size:15px;color:#1a1a2e;margin:0 0 12px">Your roof report for <strong>${address}</strong> is ready.</p>
    <p style="font-size:13px;color:#6B7280;margin:0 0 22px">Report ${reportNum}</p>
    <div style="text-align:center;margin:8px 0 4px">
      <a href="${fullUrl}" style="display:inline-block;background:#1E3A5F;color:#fff;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px;text-decoration:none;margin:6px">View Full Report</a>
      ${customerButton}
    </div>
    <p style="font-size:12px;color:#9CA3AF;margin:20px 0 0;text-align:center">Click either button to open the document in your browser. The full report has all measurements; the customer report is the homeowner-friendly copy with diagrams only.</p>
  </div>
  <div style="text-align:center;padding:16px;color:#9CA3AF;font-size:11px">
    <p style="margin:0">Sent to ${recipient} &middot; Questions? sales@roofmanager.ca</p>
  </div>
</div>
</body>
</html>`
}

export function buildEmailWrapper(reportHtml: string, address: string, reportNum: string, recipient: string, customerReportHtml?: string | null): string {
  const customerBlock = customerReportHtml
    ? `
  <!-- Customer Copy (no measurements) — shipped alongside the regular report -->
  <div style="margin-top:24px;padding:16px 20px;background:#0F172A;color:#fff;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:16px;font-weight:800;letter-spacing:1px">CUSTOMER COPY</div>
    <div style="font-size:12px;color:#93C5FD;margin-top:4px">Aerial &amp; diagrams only — no measurements</div>
  </div>
  <div style="border:2px solid #0F172A;border-top:none;border-radius:0 0 12px 12px;overflow:hidden;background:#fff">
    ${customerReportHtml}
  </div>`
    : ''

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:680px;margin:0 auto;padding:20px">
  <!-- Email Header -->
  <div style="background:#000;color:#fff;padding:20px 28px;border-radius:12px 12px 0 0;text-align:center">
    <img src="https://www.roofmanager.ca/static/logo.png?v=20260504" alt="Roof Manager" width="200" style="max-width:200px;height:auto;display:block;margin:0 auto"/>
    <div style="font-size:12px;color:#9CA3AF;margin-top:8px;letter-spacing:0.5px">Professional Roof Measurement Report</div>
  </div>

  <!-- Email Body -->
  <div style="background:#fff;padding:28px;border:1px solid #e5e7eb;border-top:none">
    <p style="font-size:15px;color:#1a1a2e;margin:0 0 16px">Hello,</p>
    <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 16px">
      Your professional 9-page roof measurement report for <strong>${address}</strong> is ready.
      Report number: <strong>${reportNum}</strong>.
    </p>
    <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 20px">
      The full report includes:
    </p>
    <ul style="font-size:13px;color:#374151;line-height:1.8;margin:0 0 24px;padding-left:20px">
      <li><strong>Page 1:</strong> Cover &mdash; Key Measurements &amp; Property Summary</li>
      <li><strong>Page 2:</strong> Top View &mdash; Aerial Satellite Image with Overlay</li>
      <li><strong>Page 3:</strong> Rotated Side Views &mdash; N / S / E / W Street-Level Perspectives</li>
      <li><strong>Page 4:</strong> Close-Up Detail &mdash; Quadrant Views &amp; Property Context</li>
      <li><strong>Page 5:</strong> Length Diagram &mdash; Segment Lengths &amp; Edge Types</li>
      <li><strong>Page 6:</strong> Pitch Diagram &mdash; Roof Pitch by Facet</li>
      <li><strong>Page 7:</strong> Area Diagram &mdash; Facet Areas in Square Feet</li>
      <li><strong>Page 8:</strong> Report Summary &mdash; Complexity &amp; Waste Calculation</li>
      <li><strong>Page 9:</strong> Totals &amp; Materials &mdash; Complete Material Order</li>
    </ul>
    ${customerReportHtml ? '<p style="font-size:13px;color:#374151;line-height:1.6;margin:0 0 16px;padding:12px 14px;background:#F1F5F9;border-left:3px solid #0F172A;border-radius:4px"><strong>Two reports below:</strong> the full measurement report (for your records) and a customer-facing copy with diagrams only — designed to share with the homeowner without revealing the measurements.</p>' : ''}

    <div style="text-align:center;margin:24px 0">
      <div style="font-size:12px;color:#6B7280;margin-bottom:8px">View your full report below</div>
    </div>
  </div>

  <!-- The Report (embedded) -->
  <div style="border:2px solid #2563EB;border-radius:0 0 12px 12px;overflow:hidden;background:#fff">
    ${reportHtml}
  </div>
${customerBlock}
  <!-- Email Footer -->
  <div style="text-align:center;padding:20px;color:#9CA3AF;font-size:11px">
    <p>&copy; ${new Date().getFullYear()} Roof Manager | Professional Roof Measurement Reports</p>
    <p style="margin-top:4px">This report was sent to ${recipient}. Questions? Contact sales@roofmanager.ca</p>
  </div>
</div>
</body>
</html>`
}

// Send email via Gmail API using service account
// senderEmail: If provided, the service account will impersonate this user (requires domain-wide delegation)
//              If null, the service account will try to send as itself (limited support)
export async function sendGmailEmail(serviceAccountJson: string, to: string, subject: string, htmlBody: string, senderEmail?: string | null): Promise<void> {
  // Get access token with Gmail scope
  const sa = JSON.parse(serviceAccountJson)

  // Create JWT with Gmail send scope
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }

  // Build JWT payload
  // If senderEmail is provided, use domain-wide delegation to impersonate that user
  // The 'sub' claim tells Google: "I'm the service account, acting on behalf of this user"
  const jwtPayload: Record<string, any> = {
    iss: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/gmail.send'
  }

  if (senderEmail) {
    jwtPayload.sub = senderEmail // Impersonate this user via domain-wide delegation
  }
  // If no senderEmail, omit 'sub' — service account tries to send as itself

  const payload = jwtPayload

  const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const ab2b64url = (buf: ArrayBuffer) => {
    const bytes = new Uint8Array(buf)
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  const pemContents = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '')
  const binaryString = atob(pemContents)
  const keyBytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) keyBytes[i] = binaryString.charCodeAt(i)
  const cryptoKey = await crypto.subtle.importKey('pkcs8', keyBytes.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput))
  const jwt = `${signingInput}.${ab2b64url(signature)}`

  // Exchange for access token
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`
  })

  if (!tokenResp.ok) {
    const err = await tokenResp.text()
    throw new Error(`Gmail OAuth failed (${tokenResp.status}): ${err}`)
  }

  const tokenData: any = await tokenResp.json()
  const accessToken = tokenData.access_token

  // Build RFC 2822 email message with proper encoding for large HTML
  const boundary = 'boundary_' + Date.now()
  const fromEmail = senderEmail || sa.client_email

  // Encode the HTML body to base64 separately (handles Unicode properly)
  const htmlBodyBytes = new TextEncoder().encode(htmlBody)
  let htmlBase64 = ''
  const chunk = 3 * 1024 // Process in chunks to avoid stack overflow
  for (let i = 0; i < htmlBodyBytes.length; i += chunk) {
    const slice = htmlBodyBytes.slice(i, i + chunk)
    let binary = ''
    for (let j = 0; j < slice.length; j++) binary += String.fromCharCode(slice[j])
    htmlBase64 += btoa(binary)
  }

  const rawMessage = [
    `From: Roof Manager Reports <${fromEmail}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${(() => { const b = new TextEncoder().encode(subject); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s) })()}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    `Your professional roof measurement report is ready. View this email in an HTML-capable client to see the full 9-page report including measurements and material calculations.`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    htmlBase64,
    '',
    `--${boundary}--`
  ].join('\r\n')

  // Convert entire message to base64url for Gmail API
  // Use TextEncoder to handle the raw bytes properly
  const messageBytes = new TextEncoder().encode(rawMessage)
  let messageBinary = ''
  for (let i = 0; i < messageBytes.length; i++) messageBinary += String.fromCharCode(messageBytes[i])
  const encodedMessage = btoa(messageBinary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  // Send via Gmail API
  // When impersonating a user, 'me' refers to the impersonated user
  const gmailUser = senderEmail || 'me'
  const sendResp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(gmailUser)}/messages/send`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw: encodedMessage })
  })

  if (!sendResp.ok) {
    const err = await sendResp.text()
    throw new Error(`Gmail send failed (${sendResp.status}): ${err}`)
  }
}

// ============================================================
// GMAIL CREDS LOADER — env first, D1 settings table fallback.
// Mirrors the resolution used by /api/auth/gmail/status so a successful
// "Connect Gmail" flow (which writes to settings) is honored by every send path.
// ============================================================
export async function loadGmailCreds(env: Bindings): Promise<{
  clientId: string
  clientSecret: string
  refreshToken: string
  senderEmail: string
  source: { clientSecret: 'env' | 'db' | 'missing'; refreshToken: 'env' | 'db' | 'missing'; senderEmail: 'env' | 'db' | 'missing' }
}> {
  const clientId: string = env?.GMAIL_CLIENT_ID || ''
  let clientSecret: string = env?.GMAIL_CLIENT_SECRET || ''
  let refreshToken: string = env?.GMAIL_REFRESH_TOKEN || ''
  let senderEmail: string = env?.GMAIL_SENDER_EMAIL || ''
  const source = {
    clientSecret: (clientSecret ? 'env' : 'missing') as 'env' | 'db' | 'missing',
    refreshToken: (refreshToken ? 'env' : 'missing') as 'env' | 'db' | 'missing',
    senderEmail: (senderEmail ? 'env' : 'missing') as 'env' | 'db' | 'missing',
  }
  if (env?.DB && (!clientSecret || !refreshToken || !senderEmail)) {
    try {
      if (!clientSecret) {
        const r = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_client_secret' AND master_company_id=1").first<any>()
        if (r?.setting_value) { clientSecret = r.setting_value; source.clientSecret = 'db' }
      }
      if (!refreshToken) {
        const r = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_refresh_token' AND master_company_id=1").first<any>()
        if (r?.setting_value) { refreshToken = r.setting_value; source.refreshToken = 'db' }
      }
      if (!senderEmail) {
        const r = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_sender_email' AND master_company_id=1").first<any>()
        if (r?.setting_value) { senderEmail = r.setting_value; source.senderEmail = 'db' }
      }
    } catch {}
  }
  return { clientId, clientSecret, refreshToken, senderEmail, source }
}

// ============================================================
// RESEND API — Simple transactional email (recommended for personal Gmail)
// Free tier: 100 emails/day, no domain verification needed for testing
// https://resend.com/docs/api-reference/emails/send-email
// ============================================================
export async function sendViaResend(
  apiKey: string, to: string, subject: string,
  htmlBody: string, fromEmail?: string | null
): Promise<{ id: string }> {
  // Resend free tier sends from onboarding@resend.dev
  // With verified domain, send from your own email
  const from = fromEmail
    ? `Roof Manager Reports <${fromEmail}>`
    : 'Roof Manager Reports <onboarding@resend.dev>'

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html: htmlBody
    })
  })

  if (!response.ok) {
    const errBody = await response.text()
    throw new Error(`Resend API error (${response.status}): ${errBody}`)
  }

  const data: any = await response.json().catch(() => ({}))
  return { id: data?.id || '' }
}

// ============================================================
// PDF RENDERING — Cloudflare Browser Rendering Workers binding.
// Uses env.BROWSER (puppeteer binding) so authentication is the worker's
// own identity, not a token scope on CLOUDFLARE_API_TOKEN. Previous REST
// path silently 401'd whenever the token wasn't scoped for Browser
// Rendering, which caused customer emails to ship .html attachments that
// Gmail wouldn't preview inline (Heidi West, RM-20260512-5044).
// Returns null on any failure — caller ships the email without an
// attachment (the share link in the email body is the primary access
// path now, so a missing PDF is annoying, not blocking).
// ============================================================
async function renderHtmlToPdf(env: Bindings, html: string, label = 'unknown'): Promise<Uint8Array | null> {
  if (!env?.BROWSER || !html) return null
  let browser: any = null
  try {
    const puppeteer = await import('@cloudflare/puppeteer')
    browser = await puppeteer.default.launch(env.BROWSER)
    const page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 1600 })
    // 'networkidle0' (zero in-flight requests for 500ms) can hang on slow
    // external resources — e.g. the Google Static Maps tile that the pro
    // report embeds. 'load' fires when all resources have either loaded
    // or errored, which is the right semantic for "render the page as
    // the user would see it" without indefinite waits. 45s timeout gives
    // headroom for the 176KB pro report with its embedded SVGs.
    await page.setContent(html, { waitUntil: 'load', timeout: 45000 })
    const buf = await page.pdf({ format: 'Letter', printBackground: true, timeout: 45000 })
    if (!buf || buf.byteLength === 0) {
      console.warn(`[renderHtmlToPdf:${label}] empty PDF buffer`)
      return null
    }
    console.log(`[renderHtmlToPdf:${label}] ok, ${buf.byteLength} bytes`)
    return new Uint8Array(buf)
  } catch (e: any) {
    console.error(`[renderHtmlToPdf:${label}] failed:`, e?.message || e, e?.stack || '')
    return null
  } finally {
    if (browser) { try { await browser.close() } catch {} }
  }
}

export async function renderCustomerReportPdf(
  env: Bindings,
  orderId: number | string,
): Promise<Uint8Array | null> {
  if (!env?.BROWSER || !env?.DB) {
    console.warn('[renderCustomerReportPdf] missing BROWSER binding or DB — PDF skipped')
    return null
  }
  const row = await env.DB.prepare(
    'SELECT customer_report_html, professional_report_html FROM reports WHERE order_id = ? ORDER BY id DESC LIMIT 1'
  ).bind(orderId).first<any>()
  const html = row?.customer_report_html || row?.professional_report_html
  return renderHtmlToPdf(env, html)
}

// ============================================================
// REPORT ATTACHMENTS — Returns BOTH the customer-facing PDF (no
// measurements) AND the full professional PDF (with measurements,
// edge totals, material take-off) so the recipient — who paid for
// the report — gets the complete deliverable. The customer PDF is
// the "share-with-the-homeowner" copy; the professional PDF is the
// one that goes to a roofer. Each renders independently; if one
// fails the other still ships.
// ============================================================
export async function getCustomerReportAttachments(
  env: Bindings,
  orderId: number | string,
  orderNumber: string,
): Promise<Array<{ filename: string; mimeType: string; bytes: Uint8Array }>> {
  const safe = String(orderNumber).replace(/[^\w.\-]/g, '_')
  const out: Array<{ filename: string; mimeType: string; bytes: Uint8Array }> = []
  if (!env?.BROWSER || !env?.DB) {
    console.warn('[getCustomerReportAttachments] missing BROWSER binding or DB — PDFs skipped')
    return out
  }
  const row = await env.DB.prepare(
    'SELECT customer_report_html, professional_report_html FROM reports WHERE order_id = ? ORDER BY id DESC LIMIT 1'
  ).bind(orderId).first<any>()
  // Single shared browser for both renders. Earlier code launched two
  // separate puppeteer sessions sequentially; the second launch after the
  // heavy 176KB pro render hit the Worker CPU/memory budget and returned
  // null, so the customer PDF silently dropped and the email shipped with
  // only the pro attachment. Reusing one browser eliminates the second
  // spin-up. Customer renders first because it's ~20KB and near-certain
  // to succeed — if pro later fails the recipient at least has the
  // customer-shareable copy plus the share link in the body.
  let browser: any = null
  try {
    const puppeteer = await import('@cloudflare/puppeteer')
    browser = await puppeteer.default.launch(env.BROWSER)
    const cust = row?.customer_report_html
      ? await renderHtmlOnBrowser(browser, row.customer_report_html, 'customer')
      : null
    if (cust) out.push({ filename: `roof-report-${safe}-customer.pdf`, mimeType: 'application/pdf', bytes: cust })
    const pro = row?.professional_report_html
      ? await renderHtmlOnBrowser(browser, row.professional_report_html, 'professional')
      : null
    if (pro) out.push({ filename: `roof-report-${safe}-full.pdf`, mimeType: 'application/pdf', bytes: pro })
  } catch (e: any) {
    console.error('[getCustomerReportAttachments] browser launch/render failed:', e?.message || e)
  } finally {
    if (browser) { try { await browser.close() } catch {} }
  }
  return out
}

// Renders one HTML doc to a PDF on an already-launched puppeteer browser.
// Used by getCustomerReportAttachments so both PDFs share one Chrome
// instance — second-launch overhead was dropping the customer attachment.
async function renderHtmlOnBrowser(browser: any, html: string, label: string): Promise<Uint8Array | null> {
  let page: any = null
  try {
    page = await browser.newPage()
    await page.setViewport({ width: 1200, height: 1600 })
    await page.setContent(html, { waitUntil: 'load', timeout: 45000 })
    const buf = await page.pdf({ format: 'Letter', printBackground: true, timeout: 45000 })
    if (!buf || buf.byteLength === 0) {
      console.warn(`[renderHtmlOnBrowser:${label}] empty PDF buffer`)
      return null
    }
    console.log(`[renderHtmlOnBrowser:${label}] ok, ${buf.byteLength} bytes`)
    return new Uint8Array(buf)
  } catch (e: any) {
    console.error(`[renderHtmlOnBrowser:${label}] failed:`, e?.message || e)
    return null
  } finally {
    if (page) { try { await page.close() } catch {} }
  }
}

// Back-compat shim for callers that still want a single attachment.
export async function getCustomerReportAttachment(
  env: Bindings,
  orderId: number | string,
  orderNumber: string,
): Promise<{ filename: string; mimeType: string; bytes: Uint8Array } | null> {
  const all = await getCustomerReportAttachments(env, orderId, orderNumber)
  return all[0] || null
}

// ============================================================
// CUSTOMER NOTIFICATION — "Your report is ready" after admin trace
// Sent when the super admin manually completes a trace on a customer's
// behalf (the submit-for-trace path). Customer dashboard polling is
// already wired but customers without an open browser had no signal —
// this email closes that gap.
// ============================================================

// HTML entity escape — protects email clients from injection via
// user-controlled fields like property_address or customer_name.
function htmlEsc(v: any): string {
  return String(v ?? '').replace(/[&<>"']/g, (m) => (
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' } as Record<string,string>)[m]
  ))
}

export async function notifyTraceCompletedToCustomer(
  env: Bindings,
  args: {
    to: string
    order_number: string
    property_address: string
    customer_name?: string
    order_id?: number | string
    customer_id?: number | null
    allow_resend?: boolean
  }
): Promise<void> {
  const { to, order_number, property_address, customer_name, order_id, customer_id, allow_resend } = args
  if (!to) return
  // Suppression list short-circuit. notifyTraceCompletedToCustomer bypasses
  // the logAndSendEmail wrapper (it needs PDF attachments + a specific HTML
  // body), so the wrapper's suppression check never ran. Without this gate,
  // an email_suppressions row for the recipient was being ignored entirely.
  // Bgequip@telus.net got 8 report_ready sends pre-suppression — keep them
  // from getting more.
  if (env?.DB) {
    try {
      const supp = await env.DB.prepare(
        `SELECT id FROM email_suppressions WHERE LOWER(email) = LOWER(?) AND released_at IS NULL LIMIT 1`
      ).bind(to).first<{ id: number } | null>()
      if (supp) {
        console.log(`[notifyTraceCompletedToCustomer] suppressed: ${to} on suppression list (email_suppressions.id=${supp.id})`)
        return
      }
    } catch (e: any) {
      console.warn('[notifyTraceCompletedToCustomer] suppression check failed, proceeding:', e?.message || e)
    }
  }
  // Idempotency gate — refuse to send the same report_ready twice for the
  // same order. Was firing 2-3x per delivered report (retraces + bulk-
  // approve + approve-and-deliver re-runs) and customers complained about
  // duplicates. Dedup on (order_id, kind=report_ready). Admin preview /
  // test sends pass allow_resend=true to bypass intentionally.
  const dedupKey = order_id != null ? `report_ready:${order_id}` : null
  if (!allow_resend && dedupKey && env?.DB) {
    try {
      const prior = await env.DB.prepare(
        "SELECT id FROM email_sends WHERE dedup_key = ? AND (status IS NULL OR status = 'sent') LIMIT 1"
      ).bind(dedupKey).first<{ id: number } | null>()
      if (prior) {
        console.log(`[notifyTraceCompletedToCustomer] skip: ${dedupKey} already sent (email_sends.id=${prior.id})`)
        return
      }
    } catch (e: any) {
      console.warn('[notifyTraceCompletedToCustomer] dedup check failed, proceeding:', e?.message || e)
    }
  }
  const firstName = (customer_name || '').split(' ')[0]
  const greeting = firstName ? `Hi ${htmlEsc(firstName)},` : 'Hi,'
  const subject = `Your roof measurement report is ready — ${order_number}`
  // Log + tracking BEFORE send so we capture failures and embed the pixel.
  const { logEmailSend, markEmailFailed, buildTrackingPixel, wrapEmailLinks } = await import('./email-tracking')
  const trackingToken = await logEmailSend(env, {
    customerId: customer_id ?? null,
    recipient: to,
    kind: 'report_ready',
    subject,
    orderId: order_id != null ? Number(order_id) : null,
    dedupKey,
  })
  const pixel = buildTrackingPixel(trackingToken)

  // Mint or reuse a share_token so the email always carries an "open in
  // browser" link, independent of whether the PDF/HTML attachment renders
  // or whether the customer can navigate the dashboard. This is the path
  // that recovered Heidi West (RM-20260512-5044) — her .html attachment
  // wouldn't preview in Gmail, but the share link works on every device.
  let shareUrl: string | null = null
  if (env?.DB && order_id != null) {
    try {
      const row = await env.DB.prepare(
        'SELECT share_token FROM reports WHERE order_id = ? ORDER BY id DESC LIMIT 1'
      ).bind(order_id).first<{ share_token: string | null }>()
      let token = row?.share_token || null
      if (!token) {
        token = crypto.randomUUID().replace(/-/g, '').substring(0, 20)
        await env.DB.prepare(
          "UPDATE reports SET share_token = ?, share_sent_at = datetime('now'), updated_at = datetime('now') WHERE order_id = ?"
        ).bind(token, order_id).run()
      }
      shareUrl = `https://www.roofmanager.ca/report/share/${token}`  // no ?v=c → defaults to professional/full view
    } catch {}
  }

  // Two links when share_token resolved:
  //   - Full measurement report (default share URL — pro view with
  //     measurements, edges, materials). The "main" report for the
  //     paying customer.
  //   - Customer/share copy (?v=c — homeowner-friendly, no
  //     measurements). For forwarding to the property owner.
  const fullReportUrl = shareUrl
  const customerShareUrl = shareUrl ? `${shareUrl}?v=c` : null
  const viewOnlineCta = shareUrl
    ? `<a href="${fullReportUrl}" style="display:inline-block;background:#0369a1;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;margin:8px 4px 0 0">View full measurement report →</a>
  <a href="${customerShareUrl}" style="display:inline-block;background:#475569;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;margin:8px 0">Customer-shareable copy →</a>
  <p style="color:#888;font-size:12px;margin:6px 0 18px">Both open in any browser. The customer copy hides measurements so it's safe to forward to the homeowner. Full PDFs of each are also attached to this email.</p>`
    : ''

  const rawHtml = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
  <h2 style="color:#111;margin-bottom:4px">Your report is ready</h2>
  <p style="color:#555;margin-top:0">${htmlEsc(order_number)}</p>
  <p style="color:#222;font-size:15px;line-height:1.5">${greeting}</p>
  <p style="color:#222;font-size:15px;line-height:1.5">
    Our team has finished tracing the roof at <strong>${htmlEsc(property_address)}</strong>.
  </p>
  ${viewOnlineCta}
  ${shareUrl ? '' : `<a href="https://www.roofmanager.ca/customer" style="display:inline-block;background:#111;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:4px">Open my dashboard →</a>`}
  <p style="color:#888;font-size:12px;margin-top:24px">
    Roof Manager · roofmanager.ca
  </p>
${pixel}</div>`
  const html = wrapEmailLinks(rawHtml, trackingToken)

  const clientId = env?.GMAIL_CLIENT_ID
  let clientSecret = env?.GMAIL_CLIENT_SECRET || ''
  let refreshToken = env?.GMAIL_REFRESH_TOKEN || ''
  let senderEmail = env?.GMAIL_SENDER_EMAIL || ''
  if (env?.DB && (!clientSecret || !refreshToken || !senderEmail)) {
    try {
      const r = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_refresh_token' AND master_company_id=1").first<any>()
      if (r?.setting_value) refreshToken = r.setting_value
      const s = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_client_secret' AND master_company_id=1").first<any>()
      if (s?.setting_value) clientSecret = s.setting_value
      if (!senderEmail) {
        const se = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_sender_email' AND master_company_id=1").first<any>()
        if (se?.setting_value) senderEmail = se.setting_value
      }
    } catch {}
  }

  // Render BOTH PDFs (customer-facing + full professional) when Browser
  // Rendering is available, so the paying customer receives the complete
  // deliverable in their email — not just the homeowner-facing copy. The
  // share link in the email body remains the guaranteed access path; the
  // attachments are a bonus when render succeeds.
  const attachments = order_id != null
    ? await getCustomerReportAttachments(env, order_id, order_number)
    : []

  let lastErr: any = null
  if (env?.RESEND_API_KEY) {
    try {
      // Resend path stays attachment-less for now; Gmail path handles
      // the attach when reached.
      await sendViaResend(env.RESEND_API_KEY, to, subject, html)
      return
    } catch (e: any) { lastErr = e }
  }
  if (clientId && clientSecret && refreshToken) {
    if (attachments.length > 0) {
      try {
        await sendGmailOAuth2WithAttachment(
          clientId, clientSecret, refreshToken,
          to, subject, html,
          attachments,
          senderEmail || null,
        )
        return
      } catch (e: any) {
        lastErr = e
        console.warn('[notifyTraceCompletedToCustomer] attachment send failed, retrying without:', e?.message || e)
      }
    }
    try {
      await sendGmailOAuth2(clientId, clientSecret, refreshToken, to, subject, html, senderEmail || null)
      return
    } catch (e: any) { lastErr = e }
  }
  if (lastErr) {
    await markEmailFailed(env, trackingToken, String(lastErr?.message || lastErr))
    throw lastErr
  }
  await markEmailFailed(env, trackingToken, 'no email provider configured')
  throw new Error('no email provider configured')
}

// ============================================================
// SALES NOTIFICATION — Sent to super admin on new report requests
// ============================================================
export async function notifyNewReportRequest(
  env: Bindings,
  order: {
    order_number: string
    property_address: string
    requester_name: string
    requester_email: string
    service_tier: string
    price: number
    is_trial: boolean
  }
): Promise<void> {
  const typeLabel = order.is_trial ? 'Free Trial' : `Paid — $${Number(order.price).toFixed(2)}`
  const subject = `New Report Request — ${order.order_number}`
  // All user-controlled fields are HTML-escaped to prevent injection into
  // admin email clients (the recipients are super admins — XSS in their
  // inbox is high-impact).
  const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
  <h2 style="color:#111;margin-bottom:4px">New Report Request</h2>
  <p style="color:#555;margin-top:0">${htmlEsc(order.order_number)}</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:8px 0;color:#888;width:140px">Property</td><td style="padding:8px 0;font-weight:600">${htmlEsc(order.property_address)}</td></tr>
    <tr><td style="padding:8px 0;color:#888">Customer</td><td style="padding:8px 0">${htmlEsc(order.requester_name)} &lt;${htmlEsc(order.requester_email)}&gt;</td></tr>
    <tr><td style="padding:8px 0;color:#888">Tier</td><td style="padding:8px 0">${htmlEsc(order.service_tier)}</td></tr>
    <tr><td style="padding:8px 0;color:#888">Type</td><td style="padding:8px 0">${htmlEsc(typeLabel)}</td></tr>
  </table>
  <a href="https://www.roofmanager.ca/admin/superadmin" style="display:inline-block;background:#111;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">View in Super Admin →</a>
</div>`

  // Single canonical recipient. Forwarding to individual super admins lives
  // in Gmail filters/rules — sending direct to multiple admin mailboxes was
  // producing 3-4 duplicate copies (sales@ direct + sales→admin forwards +
  // each admin_users row) per order.
  const recipients = new Set<string>(['sales@roofmanager.ca'])

  const clientId = env?.GMAIL_CLIENT_ID
  let clientSecret = env?.GMAIL_CLIENT_SECRET || ''
  let refreshToken = env?.GMAIL_REFRESH_TOKEN || ''
  let senderEmail = env?.GMAIL_SENDER_EMAIL || ''
  if (env?.DB && (!clientSecret || !refreshToken || !senderEmail)) {
    try {
      const r = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_refresh_token' AND master_company_id=1").first<any>()
      if (r?.setting_value) refreshToken = r.setting_value
      const s = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_client_secret' AND master_company_id=1").first<any>()
      if (s?.setting_value) clientSecret = s.setting_value
      if (!senderEmail) {
        const se = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_sender_email' AND master_company_id=1").first<any>()
        if (se?.setting_value) senderEmail = se.setting_value
      }
    } catch {}
  }

  const logAudit = async (action: string, detail: string) => {
    if (!env?.DB) return
    try {
      await env.DB.prepare(
        "INSERT INTO user_activity_log (company_id, action, details) VALUES (1, ?, ?)"
      ).bind(action, `[${order.order_number}] ${detail}`.slice(0, 500)).run()
    } catch {}
  }

  let delivered = 0
  const errors: string[] = []

  for (const to of recipients) {
    let sent = false

    if (env?.RESEND_API_KEY) {
      try {
        await sendViaResend(env.RESEND_API_KEY, to, subject, html)
        sent = true
      } catch (e: any) {
        errors.push(`resend→${to}: ${e?.message || e}`)
      }
    }

    if (!sent && clientId && clientSecret && refreshToken) {
      try {
        await sendGmailOAuth2(clientId, clientSecret, refreshToken, to, subject, html, senderEmail || null)
        sent = true
      } catch (e: any) {
        errors.push(`gmail→${to}: ${e?.message || e}`)
      }
    }

    if (sent) delivered++
  }

  if (delivered === 0) {
    const reason = errors.length ? errors.join(' | ') : 'no email provider configured'
    console.warn('[notifyNewReportRequest] Failed to send notification:', reason)
    await logAudit('report_request_notify_failed', reason)
  } else if (errors.length) {
    await logAudit('report_request_notify_partial', `delivered=${delivered} errors=${errors.join(' | ')}`)
  } else {
    await logAudit('report_request_notify_sent', `delivered=${delivered} to=${[...recipients].join(',')}`)
  }
}

// Site-health alert: signup funnel regression detected by /funnel-monitor.
// Throws on total delivery failure so the caller can mark email_status='failed'.
export async function notifyFunnelRegression(
  env: Bindings,
  data: {
    order_number: string
    drop_stage: string
    notes: string[]
    window: { start: string; end: string }
    current: { pageviews: number; form_starts: number; form_submits: number; customers_created: number; email_verified: number; unique_visitors: number }
    baseline_avg: { pageviews: number; form_starts: number; form_submits: number; customers_created: number; email_verified: number; unique_visitors: number }
    last_hour?: { form_submits: number; customers_created: number }
  }
): Promise<void> {
  const subject = `Signup funnel regression — ${data.drop_stage}`
  const fmt = (n: number) => Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : '—'
  const last1h = data.last_hour
    ? `<tr><td style="padding:8px 0;color:#888">Last 1h (backend)</td><td style="padding:8px 0">${data.last_hour.form_submits} submits → ${data.last_hour.customers_created} customers</td></tr>`
    : ''
  const html = `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
  <h2 style="color:#b91c1c;margin-bottom:4px">Signup funnel regression</h2>
  <p style="color:#555;margin-top:0">${htmlEsc(data.order_number)}</p>
  <p style="margin:16px 0;font-weight:600">${htmlEsc(data.notes.join(' • '))}</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:8px 0;color:#888;width:200px">Drop stage</td><td style="padding:8px 0;font-weight:600">${htmlEsc(data.drop_stage)}</td></tr>
    <tr><td style="padding:8px 0;color:#888">Window (UTC)</td><td style="padding:8px 0">${htmlEsc(data.window.start)} → ${htmlEsc(data.window.end)}</td></tr>
    <tr><td style="padding:8px 0;color:#888">/register pageviews</td><td style="padding:8px 0">${data.current.pageviews} <span style="color:#888">(baseline avg ${fmt(data.baseline_avg.pageviews)})</span></td></tr>
    <tr><td style="padding:8px 0;color:#888">Form starts</td><td style="padding:8px 0">${data.current.form_starts} <span style="color:#888">(baseline ${fmt(data.baseline_avg.form_starts)})</span></td></tr>
    <tr><td style="padding:8px 0;color:#888">Form submits</td><td style="padding:8px 0">${data.current.form_submits} <span style="color:#888">(baseline ${fmt(data.baseline_avg.form_submits)})</span></td></tr>
    <tr><td style="padding:8px 0;color:#888">Customers created</td><td style="padding:8px 0">${data.current.customers_created} <span style="color:#888">(baseline ${fmt(data.baseline_avg.customers_created)})</span></td></tr>
    ${last1h}
  </table>
  <a href="https://www.roofmanager.ca/super-admin/loop-tracker" style="display:inline-block;background:#111;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">View Loop Tracker →</a>
  <p style="color:#888;font-size:12px;margin-top:24px">Christine — site-health automated alert.</p>
</div>`

  const recipients = new Set<string>(['christinegourley04@gmail.com'])
  if (env?.DB) {
    try {
      const rows = await env.DB.prepare(
        "SELECT email FROM admin_users WHERE role='superadmin' AND is_active=1 AND email IS NOT NULL AND email != ''"
      ).all<{ email: string }>()
      for (const r of (rows?.results || [])) {
        if (r?.email) recipients.add(r.email.trim().toLowerCase())
      }
    } catch {}
  }

  const { logAndSendEmail } = await import('./email-wrapper')
  const errors: string[] = []
  let delivered = 0
  for (const to of recipients) {
    const r = await logAndSendEmail({
      env, to, subject, html,
      kind: 'funnel_regression', category: 'alert', track: false,
    })
    if (r.ok) delivered++
    else if (r.error) errors.push(`${to}: ${r.error}`)
  }

  if (delivered === 0) {
    throw new Error(errors.length ? errors.join(' | ') : 'no email provider configured')
  }
}

// Site-health alert: Gmail OAuth2 transport probe failed. Tries Resend first
// since Gmail is the suspect transport, then falls back to Gmail (a probe
// failure can be transient — sends may still succeed). Throws on total
// delivery failure so the caller can mark email_status='failed'.
export async function notifyEmailHealthFailure(
  env: Bindings,
  data: {
    order_number: string
    creds: { client_id: string; client_secret: string; refresh_token: string; sender_email: string }
    token_mint: { ok: boolean; status: number | null; expires_in_s: number | null; scope: string | null; error: string | null }
    notes: string[]
    checked_at: string
  }
): Promise<void> {
  const subject = `URGENT — Gmail OAuth2 transport unhealthy`
  const html = `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
  <h2 style="color:#b91c1c;margin-bottom:4px">Gmail OAuth2 transport unhealthy</h2>
  <p style="color:#555;margin-top:0">${htmlEsc(data.order_number)}</p>
  <p style="margin:16px 0;font-weight:600">All outbound email (customer reports, admin alerts, password resets) is at risk. Gmail is the only configured transport in prod.</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:8px 0;color:#888;width:200px">Checked at</td><td style="padding:8px 0">${htmlEsc(data.checked_at)}</td></tr>
    <tr><td style="padding:8px 0;color:#888">client_id</td><td style="padding:8px 0">${htmlEsc(data.creds.client_id)}</td></tr>
    <tr><td style="padding:8px 0;color:#888">client_secret</td><td style="padding:8px 0">${htmlEsc(data.creds.client_secret)}</td></tr>
    <tr><td style="padding:8px 0;color:#888">refresh_token</td><td style="padding:8px 0">${htmlEsc(data.creds.refresh_token)}</td></tr>
    <tr><td style="padding:8px 0;color:#888">sender_email</td><td style="padding:8px 0">${htmlEsc(data.creds.sender_email)}</td></tr>
    <tr><td style="padding:8px 0;color:#888">Token-mint HTTP</td><td style="padding:8px 0">${data.token_mint.status ?? 'n/a'}</td></tr>
    <tr><td style="padding:8px 0;color:#888">Error</td><td style="padding:8px 0;font-family:monospace;font-size:12px;word-break:break-all">${htmlEsc(data.token_mint.error || '(none)')}</td></tr>
  </table>
  <p style="margin:16px 0">Fix path: re-grant OAuth consent at <code>/api/auth/gmail</code> on prod, or refresh the token via super-admin email settings.</p>
  <a href="https://www.roofmanager.ca/super-admin/loop-tracker" style="display:inline-block;background:#111;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">View Loop Tracker →</a>
  <p style="color:#888;font-size:12px;margin-top:24px">Christine — site-health automated alert.</p>
</div>`

  const recipients = new Set<string>(['christinegourley04@gmail.com'])
  if (env?.DB) {
    try {
      const rows = await env.DB.prepare(
        "SELECT email FROM admin_users WHERE role='superadmin' AND is_active=1 AND email IS NOT NULL AND email != ''"
      ).all<{ email: string }>()
      for (const r of (rows?.results || [])) {
        if (r?.email) recipients.add(r.email.trim().toLowerCase())
      }
    } catch {}
  }

  const { logAndSendEmail } = await import('./email-wrapper')
  const errors: string[] = []
  let delivered = 0
  for (const to of recipients) {
    const r = await logAndSendEmail({
      env, to, subject, html,
      kind: 'gmail_health_alert', category: 'alert', track: false,
    })
    if (r.ok) delivered++
    else if (r.error) errors.push(`${to}: ${r.error}`)
  }

  if (delivered === 0) {
    throw new Error(errors.length ? errors.join(' | ') : 'no email provider configured')
  }
}

// ============================================================
// GMAIL OAUTH2 — Send email using OAuth2 refresh token
// Works with personal Gmail. One-time consent at /api/auth/gmail
// ============================================================
export async function sendGmailOAuth2(
  clientId: string, clientSecret: string, refreshToken: string,
  to: string, subject: string, htmlBody: string,
  senderEmail?: string | null,
  env?: any
): Promise<{ id: string }> {
  // Exchange refresh token for access token
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    }).toString(),
    signal: AbortSignal.timeout(10000)
  })

  if (!tokenResp.ok) {
    const err = await tokenResp.text()
    throw new Error(`Gmail OAuth2 token refresh failed (${tokenResp.status}): ${err}`)
  }

  const tokenData: any = await tokenResp.json()
  const accessToken = tokenData.access_token

  // If Google rotated the refresh token (rare but supported by the OAuth2
  // spec — happens when an account hits the 50-token-per-client cap or
  // re-consents), persist the new one. Without this the next refresh after
  // rotation throws "invalid_grant" and email transport silently dies.
  if (tokenData.refresh_token && tokenData.refresh_token !== refreshToken) {
    console.warn('[Gmail OAuth2] Refresh token rotated — persisting new token')
    if (env?.DB) {
      try {
        await env.DB.prepare(
          "UPDATE settings SET setting_value = ?, updated_at = datetime('now') WHERE setting_key = 'gmail_refresh_token' AND master_company_id = 1"
        ).bind(tokenData.refresh_token).run()
      } catch (e: any) {
        console.error('[Gmail OAuth2] Failed to persist rotated refresh_token:', e?.message || e)
      }
    }
  }

  // Build RFC 2822 email
  const boundary = 'boundary_' + Date.now()
  const fromAddr = senderEmail || 'me'

  // Base64 encode the HTML body in chunks, then wrap to 76 chars per
  // RFC 2045. The previous version emitted one giant unbroken base64
  // string which some mail clients (notably some Gmail rendering paths)
  // refused to decode — recipients saw a wall of raw base64 text instead
  // of the rendered HTML. The attachment-bearing variant of this function
  // has always wrapped; this brings the plain variant into parity.
  const htmlBodyBytes = new TextEncoder().encode(htmlBody)
  let htmlBase64Raw = ''
  const chunk = 3 * 1024
  for (let i = 0; i < htmlBodyBytes.length; i += chunk) {
    const slice = htmlBodyBytes.slice(i, i + chunk)
    let binary = ''
    for (let j = 0; j < slice.length; j++) binary += String.fromCharCode(slice[j])
    htmlBase64Raw += btoa(binary)
  }
  const htmlBase64 = htmlBase64Raw.match(/.{1,76}/g)?.join('\r\n') || htmlBase64Raw

  const rawMessage = [
    `From: Roof Manager Reports <${fromAddr}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${(() => { const b = new TextEncoder().encode(subject); let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s) })()}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    'Your professional roof measurement report is ready. View this email in an HTML-capable client to see the full 9-page report.',
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    htmlBase64,
    '',
    `--${boundary}--`
  ].join('\r\n')

  // Encode to base64url for Gmail API
  const messageBytes = new TextEncoder().encode(rawMessage)
  let messageBinary = ''
  for (let i = 0; i < messageBytes.length; i++) messageBinary += String.fromCharCode(messageBytes[i])
  const encodedMessage = btoa(messageBinary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  // Send via Gmail API — 'me' = the authorized user
  const sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw: encodedMessage })
  })

  if (!sendResp.ok) {
    const err = await sendResp.text()
    throw new Error(`Gmail send failed (${sendResp.status}): ${err}`)
  }
  const data: any = await sendResp.json().catch(() => ({}))
  return { id: data?.id || '' }
}

// ============================================================
// GMAIL OAUTH2 WITH ATTACHMENT — multipart/mixed send with one binary attachment.
// Used by the super-admin "Send Report Email" action. Attachment is fetched
// server-side from a pre-validated URL, then base64-encoded inline.
// ============================================================
export async function sendGmailOAuth2WithAttachment(
  clientId: string, clientSecret: string, refreshToken: string,
  to: string, subject: string, htmlBody: string,
  attachmentOrAttachments:
    | { filename: string; mimeType: string; bytes: Uint8Array }
    | Array<{ filename: string; mimeType: string; bytes: Uint8Array }>,
  senderEmail?: string | null,
  replyTo?: string | null
): Promise<{ id: string }> {
  // Normalize single → array so the rest of this function only has to
  // deal with one shape. Caller passes either one attachment (legacy)
  // or many (e.g. customer report email shipping both customer + full
  // PDFs in one send).
  const attachments = Array.isArray(attachmentOrAttachments) ? attachmentOrAttachments : [attachmentOrAttachments]
  if (attachments.length === 0) throw new Error('sendGmailOAuth2WithAttachment called with zero attachments')
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    }).toString(),
    signal: AbortSignal.timeout(10000)
  })
  if (!tokenResp.ok) {
    const err = await tokenResp.text()
    throw new Error(`Gmail OAuth2 token refresh failed (${tokenResp.status}): ${err}`)
  }
  const tokenData: any = await tokenResp.json()
  const accessToken = tokenData.access_token

  const outer = 'outer_' + Date.now()
  const inner = 'inner_' + Date.now()
  const fromAddr = senderEmail || 'me'

  const encChunked = (bytes: Uint8Array): string => {
    let out = ''
    const chunk = 3 * 1024
    for (let i = 0; i < bytes.length; i += chunk) {
      const slice = bytes.slice(i, i + chunk)
      let bin = ''
      for (let j = 0; j < slice.length; j++) bin += String.fromCharCode(slice[j])
      out += btoa(bin)
    }
    // wrap to 76-char lines (RFC 2045)
    return out.match(/.{1,76}/g)?.join('\r\n') || out
  }

  const htmlBase64 = encChunked(new TextEncoder().encode(htmlBody))
  // Pre-encode every attachment so we can build the MIME body in one pass.
  const encodedAttachments = attachments.map(a => ({
    base64: encChunked(a.bytes),
    safeFilename: a.filename.replace(/[^\w.\-]/g, '_').slice(0, 200),
    mimeType: a.mimeType,
  }))

  const subjectEnc = (() => {
    const b = new TextEncoder().encode(subject); let s = ''
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
    return btoa(s)
  })()

  const rawMessage = [
    `From: Roof Manager <${fromAddr}>`,
    `To: ${to}`,
    // Critical: only append Reply-To when set. An empty array entry here
    // joins as an empty line, which RFC 5322 treats as end-of-headers —
    // every header after (including Subject + Content-Type) gets shoved
    // into the body, and the recipient sees raw MIME instead of the
    // rendered HTML. This was Heidi's "massive raw code" email.
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: =?UTF-8?B?${subjectEnc}?=`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/mixed; boundary="${outer}"`,
    '',
    `--${outer}`,
    `Content-Type: multipart/alternative; boundary="${inner}"`,
    '',
    `--${inner}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 7bit',
    '',
    'Your roof measurement report is attached. View this email in an HTML-capable client for the full message.',
    '',
    `--${inner}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    htmlBase64,
    '',
    `--${inner}--`,
    '',
    // One attachment block per file. Each block is its own outer-boundary
    // part with its own Content-Type / Content-Disposition / base64 body.
    ...encodedAttachments.flatMap(a => [
      `--${outer}`,
      `Content-Type: ${a.mimeType}; name="${a.safeFilename}"`,
      `Content-Disposition: attachment; filename="${a.safeFilename}"`,
      'Content-Transfer-Encoding: base64',
      '',
      a.base64,
      '',
    ]),
    `--${outer}--`
  ].filter((l) => l !== '' || true).join('\r\n')

  const messageBytes = new TextEncoder().encode(rawMessage)
  let messageBinary = ''
  for (let i = 0; i < messageBytes.length; i++) messageBinary += String.fromCharCode(messageBytes[i])
  const encodedMessage = btoa(messageBinary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: encodedMessage })
  })
  if (!sendResp.ok) {
    const err = await sendResp.text()
    throw new Error(`Gmail send (with attachment) failed (${sendResp.status}): ${err}`)
  }
  const data: any = await sendResp.json().catch(() => ({}))
  return { id: data?.id || '' }
}

// ============================================================
// Notify sales@roofmanager.ca of a new web-form lead.
// Resolves Gmail OAuth2 creds from env, with DB fallback.
// Non-throwing — safe to fire-and-forget from any handler.
// ============================================================
export async function notifySalesNewLead(env: Bindings, data: {
  source: string
  name?: string | null
  email?: string | null
  phone?: string | null
  company?: string | null
  message?: string | null
  extra?: Record<string, string | number | null | undefined>
}): Promise<void> {
  const esc = (v: any) => String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' } as any)[m])
  const rows: string[] = []
  const push = (label: string, val: any, link?: 'mailto' | 'tel') => {
    if (val === null || val === undefined || val === '') return
    const v = esc(val)
    const cell = link === 'mailto' ? `<a href="mailto:${v}" style="color:#0ea5e9">${v}</a>`
      : link === 'tel' ? `<a href="tel:${v}" style="color:#0ea5e9">${v}</a>`
      : v
    rows.push(`<tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:110px;vertical-align:top"><strong>${esc(label)}</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b">${cell}</td></tr>`)
  }
  push('Name', data.name)
  push('Email', data.email, 'mailto')
  push('Phone', data.phone, 'tel')
  push('Company', data.company)
  push('Message', data.message)
  if (data.extra) for (const [k, v] of Object.entries(data.extra)) push(k, v)

  const html = `
<div style="max-width:600px;margin:0 auto;font-family:Inter,system-ui,sans-serif">
  <div style="background:#000;padding:20px 24px;border-radius:12px 12px 0 0;text-align:center">
    <img src="https://www.roofmanager.ca/static/logo.png?v=20260504" alt="Roof Manager" width="160" style="max-width:160px;height:auto;display:block;margin:0 auto 8px"/>
    <h1 style="color:#fff;font-size:16px;margin:0;font-weight:600">🔔 New Lead</h1>
    <p style="color:#9CA3AF;font-size:12px;margin:4px 0 0">Source: ${esc(data.source)}</p>
  </div>
  <div style="background:white;padding:24px;border:1px solid #e2e8f0;border-top:none">
    <table style="width:100%;border-collapse:collapse">${rows.join('')}</table>
  </div>
  <div style="background:#f8fafc;padding:16px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0;border-top:none;text-align:center">
    <a href="https://www.roofmanager.ca/super-admin" style="color:#0ea5e9;font-size:12px;font-weight:600">View in Super Admin Dashboard</a>
  </div>
</div>`
  const subject = `🔔 New Lead: ${data.name || data.email || 'anonymous'} — ${data.source}`

  const { logAndSendEmail } = await import('./email-wrapper')
  const r = await logAndSendEmail({
    env,
    to: 'sales@roofmanager.ca',
    from: 'sales@roofmanager.ca',
    subject,
    html,
    kind: 'lead_notification',
    category: 'lead',
    track: false,
    replyTo: data.email || undefined,
  })
  if (!r.ok) {
    console.error('[notifySalesNewLead] failed:', r.error)
  }
}

// ============================================================
// Notify sales@roofmanager.ca when a NEW USER signs up.
// Called fire-and-forget from registration handlers; never throws.
// ============================================================
export async function notifyNewUserSignup(env: Bindings, data: {
  signup_method: 'email' | 'google' | 'apple'
  customer_id?: number | string | null
  email?: string | null
  name?: string | null
  phone?: string | null
  company_name?: string | null
  company_size?: string | null
  primary_use?: string | null
  ip?: string | null
}): Promise<void> {
  const esc = (v: any) => String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' } as any)[m])
  const rows: string[] = []
  const push = (label: string, val: any, link?: 'mailto' | 'tel') => {
    if (val === null || val === undefined || val === '') return
    const v = esc(val)
    const cell = link === 'mailto' ? `<a href="mailto:${v}" style="color:#0ea5e9">${v}</a>`
      : link === 'tel' ? `<a href="tel:${v}" style="color:#0ea5e9">${v}</a>`
      : v
    rows.push(`<tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:130px;vertical-align:top"><strong>${esc(label)}</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b">${cell}</td></tr>`)
  }
  push('Name', data.name)
  push('Email', data.email, 'mailto')
  push('Phone', data.phone, 'tel')
  push('Company', data.company_name)
  push('Company size', data.company_size)
  push('Primary use', data.primary_use)
  push('Signup method', data.signup_method === 'google' ? 'Google sign-in' : 'Email + password')
  if (data.customer_id) push('Customer ID', `#${data.customer_id}`)
  if (data.ip) push('IP', data.ip)

  const html = `
<div style="max-width:600px;margin:0 auto;font-family:Inter,system-ui,sans-serif">
  <div style="background:#000;padding:20px 24px;border-radius:12px 12px 0 0;text-align:center">
    <img src="https://www.roofmanager.ca/static/logo.png?v=20260504" alt="Roof Manager" width="160" style="max-width:160px;height:auto;display:block;margin:0 auto 8px"/>
    <h1 style="color:#fff;font-size:16px;margin:0;font-weight:600">🎉 New User Signup</h1>
    <p style="color:#9CA3AF;font-size:12px;margin:4px 0 0">A new account just registered.</p>
  </div>
  <div style="background:white;padding:24px;border:1px solid #e2e8f0;border-top:none">
    <table style="width:100%;border-collapse:collapse">${rows.join('')}</table>
  </div>
  <div style="background:#f8fafc;padding:16px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0;border-top:none;text-align:center">
    <a href="https://www.roofmanager.ca/super-admin" style="color:#0ea5e9;font-size:12px;font-weight:600">View in Super Admin Dashboard</a>
  </div>
</div>`
  const subject = `🎉 New Signup: ${data.name || data.email || 'unknown'}${data.company_name ? ' (' + data.company_name + ')' : ''}`

  const { logAndSendEmail } = await import('./email-wrapper')
  const r = await logAndSendEmail({
    env,
    to: 'sales@roofmanager.ca',
    from: 'sales@roofmanager.ca',
    subject,
    html,
    kind: 'signup_notification',
    category: 'alert',
    track: false,
    customerId: data.customer_id ? Number(data.customer_id) || null : null,
    replyTo: data.email || undefined,
  })
  if (!r.ok) {
    console.error('[notifyNewUserSignup] failed:', r.error)
  }
}

// ============================================================
// Send a "Welcome to Roof Manager" email to a newly-registered user.
// Fire-and-forget; never throws. Mirrors notifyNewUserSignup's
// Gmail OAuth2 → Resend → GCP Service Account fallback chain.
// ============================================================
export async function sendWelcomeEmail(env: Bindings, data: {
  email: string
  name?: string | null
  customerId?: number | null
}): Promise<void> {
  if (!data?.email) return
  // Suppression list short-circuit — bypasses logAndSendEmail wrapper.
  if (env?.DB) {
    try {
      const supp = await env.DB.prepare(
        `SELECT id FROM email_suppressions WHERE LOWER(email) = LOWER(?) AND released_at IS NULL LIMIT 1`
      ).bind(data.email).first<{ id: number } | null>()
      if (supp) {
        console.log(`[sendWelcomeEmail] suppressed: ${data.email} (email_suppressions.id=${supp.id})`)
        return
      }
    } catch (e: any) {
      console.warn('[sendWelcomeEmail] suppression check failed, proceeding:', e?.message || e)
    }
  }
  const esc = (v: any) => String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' } as any)[m])
  const firstName = (data.name || '').trim().split(/\s+/)[0] || ''
  const greeting = firstName ? `Hi ${esc(firstName)},` : 'Hi there,'
  const demoUrl = 'https://calendar.app.google/KNLFST4CNxViPPN3A'

  const subject = 'Welcome to Roof Manager'

  // Email-open + click tracking — log the send BEFORE we attempt transport
  // so we capture even failed sends (with send_error). Pixel + wrapped CTA
  // links share the same tracking_token so both opens and clicks roll up
  // to the same email_sends row.
  const { logEmailSend, markEmailFailed, buildTrackingPixel, wrapEmailLinks } = await import('./email-tracking')
  const trackingToken = await logEmailSend(env, {
    customerId: data.customerId ?? null,
    recipient: data.email,
    kind: 'welcome',
    subject,
  })
  const pixel = buildTrackingPixel(trackingToken)
  const html = `
<div style="max-width:600px;margin:0 auto;font-family:Inter,Arial,Helvetica,sans-serif;background:#f4f4f5;padding:24px">
  <div style="background:#000;padding:24px;border-radius:12px 12px 0 0;text-align:center">
    <img src="https://www.roofmanager.ca/static/logo.png?v=20260504" alt="Roof Manager" width="180" style="max-width:180px;height:auto;display:block;margin:0 auto 8px"/>
    <p style="color:#9CA3AF;font-size:12px;margin:6px 0 0;letter-spacing:0.5px">Welcome aboard</p>
  </div>
  <div style="background:#fff;padding:32px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px">
    <h1 style="font-size:22px;color:#0A0A0A;margin:0 0 16px;font-weight:700">Welcome to Roof Manager</h1>
    <p style="font-size:15px;color:#1a1a2e;margin:0 0 16px;line-height:1.6">${greeting}</p>
    <p style="font-size:15px;color:#1a1a2e;margin:0 0 16px;line-height:1.6">
      Thanks for signing up for Roof Manager — the all-in-one platform for AI-powered roof measurements, reports, and CRM.
      Your account is ready and your free trial roof reports have been added to it.
    </p>
    <p style="font-size:15px;color:#1a1a2e;margin:0 0 24px;line-height:1.6">
      Jump in any time at
      <a href="https://www.roofmanager.ca/customer" style="color:#00CC6A;font-weight:600;text-decoration:none">www.roofmanager.ca</a>
      and start measuring your first roof.
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
    <p style="font-size:15px;color:#1a1a2e;margin:0 0 18px;line-height:1.6">
      If you have questions, concerns, or want to learn more and get a guided tour, book a demo with us:
    </p>
    <div style="text-align:center;margin:8px 0 4px">
      <a href="${demoUrl}" style="display:inline-block;background:#00CC6A;color:#0A0A0A;font-weight:700;font-size:15px;padding:14px 28px;border-radius:10px;text-decoration:none">Book a Demo</a>
    </div>
    <p style="font-size:12px;color:#9CA3AF;margin:18px 0 0;text-align:center;word-break:break-all">${demoUrl}</p>
  </div>
  <p style="font-size:11px;color:#9CA3AF;text-align:center;margin:16px 0 0">© Roof Manager · www.roofmanager.ca</p>
</div>
${pixel}`

  // Wrap all approved-host hrefs with click-tracking redirects. Done AFTER
  // the HTML is built so the wrapping is the last transform on the body.
  const trackedHtml = wrapEmailLinks(html, trackingToken)

  // Strategy 1: Gmail OAuth2
  let sent = false
  const clientId = env.GMAIL_CLIENT_ID
  let clientSecret = env.GMAIL_CLIENT_SECRET || ''
  let refreshToken = env.GMAIL_REFRESH_TOKEN || ''
  if (!refreshToken || !clientSecret) {
    try {
      const r = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_refresh_token' AND master_company_id=1").first<any>()
      if (r?.setting_value) refreshToken = r.setting_value
      const s = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_client_secret' AND master_company_id=1").first<any>()
      if (s?.setting_value) clientSecret = s.setting_value
    } catch (e: any) {
      console.warn('[sendWelcomeEmail] DB credential lookup failed:', e?.message)
    }
  }

  if (clientId && clientSecret && refreshToken) {
    try {
      await sendGmailOAuth2(clientId, clientSecret, refreshToken, data.email, subject, trackedHtml, 'sales@roofmanager.ca')
      sent = true
      console.log('[sendWelcomeEmail] sent via Gmail OAuth2 to', data.email)
    } catch (e: any) {
      console.error('[sendWelcomeEmail] Gmail OAuth2 failed:', e?.message || e)
    }
  }

  // Strategy 2: Resend fallback
  if (!sent && env.RESEND_API_KEY) {
    try {
      await sendViaResend(env.RESEND_API_KEY, data.email, subject, trackedHtml)
      sent = true
      console.log('[sendWelcomeEmail] sent via Resend fallback to', data.email)
    } catch (e: any) {
      console.error('[sendWelcomeEmail] Resend fallback failed:', e?.message || e)
    }
  }

  // Strategy 3: GCP Service Account fallback
  if (!sent && env.GCP_SERVICE_ACCOUNT_JSON) {
    try {
      await sendGmailEmail(env.GCP_SERVICE_ACCOUNT_JSON, data.email, subject, trackedHtml, 'sales@roofmanager.ca')
      sent = true
      console.log('[sendWelcomeEmail] sent via GCP Service Account fallback to', data.email)
    } catch (e: any) {
      console.error('[sendWelcomeEmail] GCP Service Account failed:', e?.message || e)
    }
  }

  if (!sent) {
    console.error('[sendWelcomeEmail] ALL email methods failed — welcome email for', data.email, 'was NOT delivered')
    await markEmailFailed(env, trackingToken, 'All transports failed (Gmail OAuth2 / Resend / GCP SA)')
  }
}

// ============================================================
// CUSTOMER NOTIFICATION — "Sorry, we're unable to complete this report"
// Sent when super admin denies a report request. The customer is told the
// report cannot be completed and invited to reply for next steps. No
// refund logic here — super admin handles refunds out-of-band.
// ============================================================
export async function notifyReportDenied(
  env: Bindings,
  args: {
    to: string
    order_number: string
    property_address: string
    customer_name?: string
    customer_id?: number | null
    denial_reason?: string
    credit_refunded?: boolean
  }
): Promise<void> {
  const { to, order_number, property_address, customer_name, customer_id, denial_reason, credit_refunded } = args
  if (!to) return
  // Suppression list short-circuit — bypasses logAndSendEmail wrapper.
  if (env?.DB) {
    try {
      const supp = await env.DB.prepare(
        `SELECT id FROM email_suppressions WHERE LOWER(email) = LOWER(?) AND released_at IS NULL LIMIT 1`
      ).bind(to).first<{ id: number } | null>()
      if (supp) {
        console.log(`[notifyReportDenied] suppressed: ${to} (email_suppressions.id=${supp.id})`)
        return
      }
    } catch (e: any) {
      console.warn('[notifyReportDenied] suppression check failed, proceeding:', e?.message || e)
    }
  }
  const firstName = (customer_name || '').split(' ')[0]
  const greeting = firstName ? `Hi ${htmlEsc(firstName)},` : 'Hi,'
  const subject = `Update on your roof report — ${order_number}`

  const { logEmailSend, markEmailFailed, buildTrackingPixel, wrapEmailLinks } = await import('./email-tracking')
  const trackingToken = await logEmailSend(env, {
    customerId: customer_id ?? null,
    recipient: to,
    kind: 'report_denied',
    subject,
  })
  const pixel = buildTrackingPixel(trackingToken)

  const reasonBlock = denial_reason
    ? `<p style="color:#222;font-size:15px;line-height:1.5;background:#fef2f2;border-left:3px solid #b91c1c;padding:10px 14px;margin:14px 0">${htmlEsc(denial_reason)}</p>`
    : ''

  const creditBlock = credit_refunded
    ? `<p style="color:#064e3b;font-size:15px;line-height:1.5;background:#ecfdf5;border-left:3px solid #059669;padding:10px 14px;margin:14px 0">Your credit for this report has been reimbursed to your account and is ready to use on a future order.</p>`
    : ''

  const rawHtml = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
  <h2 style="color:#111;margin-bottom:4px">We're unable to complete this report</h2>
  <p style="color:#555;margin-top:0">${htmlEsc(order_number)}</p>
  <p style="color:#222;font-size:15px;line-height:1.5">${greeting}</p>
  <p style="color:#222;font-size:15px;line-height:1.5">
    We're sorry — after reviewing the property at <strong>${htmlEsc(property_address)}</strong>, we're not able to complete this roof report.
  </p>
  ${reasonBlock}
  ${creditBlock}
  <p style="color:#222;font-size:15px;line-height:1.5">
    If you'd like to discuss next steps or have any questions, just reply to this email or reach us at <a href="mailto:sales@roofmanager.ca" style="color:#0369a1">sales@roofmanager.ca</a>.
  </p>
  <p style="color:#222;font-size:15px;line-height:1.5">— The Roof Manager team</p>
  <p style="color:#888;font-size:12px;margin-top:24px">
    Roof Manager · roofmanager.ca
  </p>
${pixel}</div>`
  const html = wrapEmailLinks(rawHtml, trackingToken)

  const clientId = env?.GMAIL_CLIENT_ID
  let clientSecret = env?.GMAIL_CLIENT_SECRET || ''
  let refreshToken = env?.GMAIL_REFRESH_TOKEN || ''
  let senderEmail = env?.GMAIL_SENDER_EMAIL || ''
  if (env?.DB && (!clientSecret || !refreshToken || !senderEmail)) {
    try {
      const r = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_refresh_token' AND master_company_id=1").first<any>()
      if (r?.setting_value) refreshToken = r.setting_value
      const s = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_client_secret' AND master_company_id=1").first<any>()
      if (s?.setting_value) clientSecret = s.setting_value
      if (!senderEmail) {
        const se = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_sender_email' AND master_company_id=1").first<any>()
        if (se?.setting_value) senderEmail = se.setting_value
      }
    } catch {}
  }

  let lastErr: any = null
  if (env?.RESEND_API_KEY) {
    try {
      await sendViaResend(env.RESEND_API_KEY, to, subject, html)
      return
    } catch (e: any) { lastErr = e }
  }
  if (clientId && clientSecret && refreshToken) {
    try {
      await sendGmailOAuth2(clientId, clientSecret, refreshToken, to, subject, html, senderEmail || 'sales@roofmanager.ca')
      return
    } catch (e: any) { lastErr = e }
  }
  if (lastErr) {
    await markEmailFailed(env, trackingToken, String(lastErr?.message || lastErr))
    throw lastErr
  }
  await markEmailFailed(env, trackingToken, 'no email provider configured')
  throw new Error('no email provider configured')
}

// ============================================================
// SALES NOTIFICATION — Customer requested a re-trace
// Sent to sales@roofmanager.ca when a customer submits a re-trace request
// via the customer dashboard. Mirrors notifyNewReportRequest pattern: single
// canonical recipient; admin forwarding handled at the inbox layer.
// ============================================================
export async function notifyCustomerRetraceRequest(
  env: Bindings,
  args: {
    order_number: string
    property_address: string
    customer_name?: string
    customer_email?: string
    reason_text: string
    order_id?: number | string
  }
): Promise<void> {
  const { order_number, property_address, customer_name, customer_email, reason_text } = args
  const subject = `Re-trace requested — ${order_number}`
  const html = `
<div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
  <h2 style="color:#b45309;margin-bottom:4px"><i style="margin-right:6px">↻</i>Re-trace requested</h2>
  <p style="color:#555;margin-top:0">${htmlEsc(order_number)}</p>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr><td style="padding:8px 0;color:#888;width:140px">Property</td><td style="padding:8px 0;font-weight:600">${htmlEsc(property_address)}</td></tr>
    <tr><td style="padding:8px 0;color:#888">Customer</td><td style="padding:8px 0">${htmlEsc(customer_name || '')} &lt;${htmlEsc(customer_email || '')}&gt;</td></tr>
  </table>
  <p style="color:#555;font-size:13px;margin:8px 0 4px">Customer's reason:</p>
  <p style="color:#222;font-size:14px;line-height:1.5;background:#fffbeb;border-left:3px solid #b45309;padding:12px 14px;margin:4px 0 18px;white-space:pre-wrap">${htmlEsc(reason_text)}</p>
  <a href="https://www.roofmanager.ca/admin/superadmin" style="display:inline-block;background:#111;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">View in Super Admin →</a>
</div>`

  const recipients = new Set<string>(['sales@roofmanager.ca'])

  const clientId = env?.GMAIL_CLIENT_ID
  let clientSecret = env?.GMAIL_CLIENT_SECRET || ''
  let refreshToken = env?.GMAIL_REFRESH_TOKEN || ''
  let senderEmail = env?.GMAIL_SENDER_EMAIL || ''
  if (env?.DB && (!clientSecret || !refreshToken || !senderEmail)) {
    try {
      const r = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_refresh_token' AND master_company_id=1").first<any>()
      if (r?.setting_value) refreshToken = r.setting_value
      const s = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_client_secret' AND master_company_id=1").first<any>()
      if (s?.setting_value) clientSecret = s.setting_value
      if (!senderEmail) {
        const se = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_sender_email' AND master_company_id=1").first<any>()
        if (se?.setting_value) senderEmail = se.setting_value
      }
    } catch {}
  }

  let delivered = 0
  const errors: string[] = []

  for (const to of recipients) {
    let sent = false
    if (env?.RESEND_API_KEY) {
      try {
        await sendViaResend(env.RESEND_API_KEY, to, subject, html)
        sent = true
      } catch (e: any) {
        errors.push(`resend→${to}: ${e?.message || e}`)
      }
    }
    if (!sent && clientId && clientSecret && refreshToken) {
      try {
        await sendGmailOAuth2(clientId, clientSecret, refreshToken, to, subject, html, senderEmail || 'sales@roofmanager.ca')
        sent = true
      } catch (e: any) {
        errors.push(`gmail→${to}: ${e?.message || e}`)
      }
    }
    if (sent) delivered++
  }

  if (delivered === 0) {
    const reason = errors.length ? errors.join(' | ') : 'no email provider configured'
    console.warn('[notifyCustomerRetraceRequest] Failed to send notification:', reason)
  }
}

// ============================================================
// Signup-recovery "you left before finishing" nudge.
// Routes through logAndSendEmail so the send shows up in
// email_sends with open/click tracking. Stamps the most recent
// matching signup_attempts row (or inserts a synthetic one when
// the user reached the verification step without /signup-started
// firing, e.g. anonymous traffic that came in via /register).
// 2-stage sequence:
//   stage '1h'  → kind='signup_recovery_nudge'    → recovery_sent / recovery_sent_at
//   stage '24h' → kind='signup_recovery_nudge_24h' → recovery_sent_24h / recovery_sent_24h_at
// Used by:
//   - cron-worker runAbandonedSignupRecovery (bulk loop, both stages)
//   - super-admin Abandoned Signups dashboard (manual button, stage='1h')
// Caller is responsible for the opt-out check.
// ============================================================
export async function sendSignupRecoveryEmail(
  env: Bindings,
  email: string,
  opts: { previewId?: string | null; force?: boolean; stage?: '1h' | '24h' } = {}
): Promise<{ ok: boolean; status: string; error?: string; emailSendId: number | null }> {
  if (!email) return { ok: false, status: 'failed', error: 'no email', emailSendId: null }
  const db = env.DB
  const stage = opts.stage || '1h'

  try {
    const optout = await db.prepare(
      'SELECT 1 FROM signup_recovery_optouts WHERE email = ? LIMIT 1'
    ).bind(email).first<any>()
    if (optout) return { ok: false, status: 'suppressed', error: 'opted out', emailSendId: null }
  } catch (e: any) {
    // Table may not exist in some dev envs — fall through, the wrapper
    // will still apply the global suppression list.
    console.warn('[sendSignupRecoveryEmail] optout check skipped:', e?.message)
  }

  // Resolve preview_id from the most recent signup_attempts row if the
  // caller didn't supply one. previewId in the register link is purely
  // for restoring the user's roof preview — it's optional.
  let previewId = opts.previewId || null
  let signupAttemptId: number | null = null
  try {
    const sa = await db.prepare(
      `SELECT id, preview_id, recovery_sent, recovery_sent_24h
       FROM signup_attempts WHERE email = ?
       ORDER BY created_at DESC LIMIT 1`
    ).bind(email).first<any>()
    if (sa) {
      signupAttemptId = Number(sa.id)
      if (!previewId && sa.preview_id) previewId = sa.preview_id
      if (!opts.force) {
        if (stage === '1h' && sa.recovery_sent === 1) {
          return { ok: false, status: 'deduped', error: 'recovery 1h already sent', emailSendId: null }
        }
        if (stage === '24h' && sa.recovery_sent_24h === 1) {
          return { ok: false, status: 'deduped', error: 'recovery 24h already sent', emailSendId: null }
        }
      }
    }
  } catch (e: any) {
    console.warn('[sendSignupRecoveryEmail] signup_attempts lookup skipped:', e?.message)
  }

  const optoutUrl = `https://www.roofmanager.ca/api/customer/signup-optout?email=${encodeURIComponent(email)}`
  const registerUrl = `https://www.roofmanager.ca/register?email=${encodeURIComponent(email)}${previewId ? `&preview_id=${encodeURIComponent(previewId)}` : ''}`

  const subject = stage === '24h'
    ? "Still want that free roof preview?"
    : "You left before finishing — your roof preview is waiting"

  const headline = stage === '24h'
    ? "One more nudge — your roof preview is still here"
    : "You left before finishing — here's your roof report"

  const body = stage === '24h'
    ? `Yesterday we held a spot open for the free roof preview you started. It's still
       saved and ready — finishing takes about a minute and unlocks your free trial reports.
       This is the last reminder we'll send.`
    : `We noticed you started setting up your Roof Manager account but didn't finish.
       Your free roof preview is waiting — pick up where you left off and we'll add
       your free trial reports to the account.`

  const html = `
    <div style="font-family:Inter,Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:32px;color:#0A0A0A">
      <div style="text-align:center;background:#000;padding:20px;border-radius:12px 12px 0 0;margin:-32px -32px 24px">
        <img src="https://www.roofmanager.ca/static/logo.png?v=20260504" alt="Roof Manager" width="160" style="max-width:160px;height:auto;display:block;margin:0 auto"/>
      </div>
      <h2 style="color:#0A0A0A;margin:0 0 12px;font-size:22px">${headline}</h2>
      <p style="color:#374151;line-height:1.6;margin:0 0 24px">${body}</p>
      <div style="text-align:center;margin:28px 0">
        <a href="${registerUrl}" style="display:inline-block;background:#00FF88;color:#0A0A0A;font-weight:700;padding:14px 28px;border-radius:10px;text-decoration:none;font-size:16px">
          Complete My Registration →
        </a>
      </div>
      <p style="color:#6b7280;font-size:12px;margin:32px 0 0;text-align:center">
        <a href="${optoutUrl}" style="color:#9ca3af">Unsubscribe</a> · Roof Manager · roofmanager.ca
      </p>
    </div>
  `

  const { logAndSendEmail } = await import('./email-wrapper')
  const r = await logAndSendEmail({
    env,
    to: email,
    subject,
    html,
    kind: stage === '24h' ? 'signup_recovery_nudge_24h' : 'signup_recovery_nudge',
    category: 'cart',
    from: 'sales@roofmanager.ca',
    track: true,
  })

  // Stamp the signup_attempts row (or insert one) so dedup works next time.
  if (r.ok || r.status === 'sent') {
    try {
      const stampCol = stage === '24h' ? 'recovery_sent_24h' : 'recovery_sent'
      const stampAtCol = stage === '24h' ? 'recovery_sent_24h_at' : 'recovery_sent_at'
      if (signupAttemptId != null) {
        await db.prepare(
          `UPDATE signup_attempts
           SET ${stampCol} = 1, ${stampAtCol} = datetime('now')
           WHERE id = ?`
        ).bind(signupAttemptId).run()
      } else if (stage === '1h') {
        // Only the 1h path inserts a synthetic row — by the time the
        // 24h sweep fires, the 1h row must already exist.
        await db.prepare(
          `INSERT INTO signup_attempts (email, preview_id, completed, recovery_sent, recovery_sent_at, created_at)
           VALUES (?, ?, 0, 1, datetime('now'), datetime('now'))`
        ).bind(email, previewId).run()
      }
    } catch (e: any) {
      console.warn('[sendSignupRecoveryEmail] stamp recovery flag failed:', e?.message)
    }
  }

  return {
    ok: !!r.ok,
    status: r.status,
    error: r.error,
    emailSendId: r.emailSendId,
  }
}
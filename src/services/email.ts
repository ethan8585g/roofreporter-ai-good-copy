// ============================================================
// Roof Manager — Email Delivery Service
// Supports: Gmail Service Account, Gmail OAuth2, Resend API
// ============================================================

// Short link-style email for completed reports — two buttons that open
// the full professional report and the customer-facing copy in a browser.
// Replaces the older inline-HTML wrapper for customer report deliveries.
export function buildReportLinkEmail(
  baseUrl: string,
  orderId: number | string,
  address: string,
  reportNum: string,
  recipient: string,
  hasCustomerCopy: boolean = true,
): string {
  const root = (baseUrl || 'https://www.roofmanager.ca').replace(/\/$/, '')
  const fullUrl = `${root}/api/reports/${orderId}/html`
  const customerUrl = `${root}/api/reports/${orderId}/customer-html`
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
export async function loadGmailCreds(env: any): Promise<{
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
// PDF RENDERING — Cloudflare Browser Rendering REST /pdf endpoint.
// Used to attach the customer-facing report HTML as a PDF on the
// trace-completed email. Returns null on any failure (missing tokens,
// missing report row, render error) so callers degrade to a no-attachment
// send rather than blocking the whole email.
// ============================================================
export async function renderCustomerReportPdf(
  env: any,
  orderId: number | string,
): Promise<Uint8Array | null> {
  try {
    const accountId = env?.CLOUDFLARE_ACCOUNT_ID
    const apiToken = env?.CLOUDFLARE_API_TOKEN
    if (!accountId || !apiToken || !env?.DB) return null
    const row = await env.DB.prepare(
      'SELECT customer_report_html, professional_report_html FROM reports WHERE order_id = ? ORDER BY id DESC LIMIT 1'
    ).bind(orderId).first<any>()
    const html = row?.customer_report_html || row?.professional_report_html
    if (!html) return null
    const resp = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/pdf`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          html,
          viewport: { width: 1200, height: 1600 },
          gotoOptions: { waitUntil: 'networkidle0', timeout: 30000 },
        }),
        signal: AbortSignal.timeout(45000),
      },
    )
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      console.warn(`[renderCustomerReportPdf] CF Browser Rendering ${resp.status}: ${detail.slice(0, 200)}`)
      return null
    }
    const buf = await resp.arrayBuffer()
    if (!buf || buf.byteLength === 0) return null
    return new Uint8Array(buf)
  } catch (e: any) {
    console.warn('[renderCustomerReportPdf] error:', e?.message || e)
    return null
  }
}

// ============================================================
// REPORT ATTACHMENT — Resolves the best-available attachment for a
// trace-completed email. Tries PDF (Cloudflare Browser Rendering) first;
// falls back to attaching the customer_report_html as a self-contained
// .html file when the PDF path is unavailable (token missing scope, BR
// not enabled, or render failed). Returns null only when there is no
// report row at all — in which case the caller sends a plain email.
// ============================================================
export async function getCustomerReportAttachment(
  env: any,
  orderId: number | string,
  orderNumber: string,
): Promise<{ filename: string; mimeType: string; bytes: Uint8Array } | null> {
  const safe = String(orderNumber).replace(/[^\w.\-]/g, '_')

  const pdf = await renderCustomerReportPdf(env, orderId)
  if (pdf) {
    return { filename: `roof-report-${safe}.pdf`, mimeType: 'application/pdf', bytes: pdf }
  }

  // HTML fallback — the customer can open it in any browser and print/save
  // as PDF themselves. The stored markup is already self-contained
  // (inline styles, embedded SVG, no external scripts).
  if (!env?.DB) return null
  try {
    const row = await env.DB.prepare(
      'SELECT customer_report_html, professional_report_html FROM reports WHERE order_id = ? ORDER BY id DESC LIMIT 1'
    ).bind(orderId).first<any>()
    const html = row?.customer_report_html || row?.professional_report_html
    if (!html) return null
    const wrapped = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Roof Report ${safe}</title></head><body style="margin:0;padding:0;background:#fff">${html}</body></html>`
    return {
      filename: `roof-report-${safe}.html`,
      mimeType: 'text/html; charset=utf-8',
      bytes: new TextEncoder().encode(wrapped),
    }
  } catch (e: any) {
    console.warn('[getCustomerReportAttachment] HTML fallback error:', e?.message || e)
    return null
  }
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
  env: any,
  args: {
    to: string
    order_number: string
    property_address: string
    customer_name?: string
    order_id?: number | string
  }
): Promise<void> {
  const { to, order_number, property_address, customer_name, order_id } = args
  if (!to) return
  const firstName = (customer_name || '').split(' ')[0]
  const greeting = firstName ? `Hi ${htmlEsc(firstName)},` : 'Hi,'
  const subject = `Your roof measurement report is ready — ${order_number}`
  const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
  <h2 style="color:#111;margin-bottom:4px">Your report is ready</h2>
  <p style="color:#555;margin-top:0">${htmlEsc(order_number)}</p>
  <p style="color:#222;font-size:15px;line-height:1.5">${greeting}</p>
  <p style="color:#222;font-size:15px;line-height:1.5">
    Our team has finished tracing the roof at <strong>${htmlEsc(property_address)}</strong>.
    Your measurement report is now available in your dashboard.
  </p>
  <a href="https://www.roofmanager.ca/customer" style="display:inline-block;background:#111;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px">Open my dashboard →</a>
  <p style="color:#888;font-size:12px;margin-top:24px">
    Roof Manager · roofmanager.ca
  </p>
</div>`

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

  // Best-effort attachment: PDF if Browser Rendering is reachable, else
  // a self-contained HTML file the customer can open + print-to-PDF. Any
  // failure degrades to a plain (no-attachment) send so the email itself
  // is never blocked.
  const attachment = order_id != null
    ? await getCustomerReportAttachment(env, order_id, order_number)
    : null

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
    if (attachment) {
      try {
        await sendGmailOAuth2WithAttachment(
          clientId, clientSecret, refreshToken,
          to, subject, html,
          attachment,
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
  if (lastErr) throw lastErr
  throw new Error('no email provider configured')
}

// ============================================================
// SALES NOTIFICATION — Sent to super admin on new report requests
// ============================================================
export async function notifyNewReportRequest(
  env: any,
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

  const recipients = new Set<string>(['sales@roofmanager.ca'])
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
  env: any,
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

  const errors: string[] = []
  let delivered = 0
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
    throw new Error(errors.length ? errors.join(' | ') : 'no email provider configured')
  }
}

// Site-health alert: Gmail OAuth2 transport probe failed. Tries Resend first
// since Gmail is the suspect transport, then falls back to Gmail (a probe
// failure can be transient — sends may still succeed). Throws on total
// delivery failure so the caller can mark email_status='failed'.
export async function notifyEmailHealthFailure(
  env: any,
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

  // Try Resend first — Gmail is the suspect transport. If Resend isn't
  // configured, fall back to Gmail anyway (probe failures can be transient).
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

  const errors: string[] = []
  let delivered = 0
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

  // Base64 encode the HTML body in chunks
  const htmlBodyBytes = new TextEncoder().encode(htmlBody)
  let htmlBase64 = ''
  const chunk = 3 * 1024
  for (let i = 0; i < htmlBodyBytes.length; i += chunk) {
    const slice = htmlBodyBytes.slice(i, i + chunk)
    let binary = ''
    for (let j = 0; j < slice.length; j++) binary += String.fromCharCode(slice[j])
    htmlBase64 += btoa(binary)
  }

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
  attachment: { filename: string; mimeType: string; bytes: Uint8Array },
  senderEmail?: string | null,
  replyTo?: string | null
): Promise<{ id: string }> {
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
  const attachmentBase64 = encChunked(attachment.bytes)
  const safeFilename = attachment.filename.replace(/[^\w.\-]/g, '_').slice(0, 200)

  const subjectEnc = (() => {
    const b = new TextEncoder().encode(subject); let s = ''
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
    return btoa(s)
  })()

  const rawMessage = [
    `From: Roof Manager <${fromAddr}>`,
    `To: ${to}`,
    replyTo ? `Reply-To: ${replyTo}` : '',
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
    `--${outer}`,
    `Content-Type: ${attachment.mimeType}; name="${safeFilename}"`,
    `Content-Disposition: attachment; filename="${safeFilename}"`,
    'Content-Transfer-Encoding: base64',
    '',
    attachmentBase64,
    '',
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
export async function notifySalesNewLead(env: any, data: {
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

  // Strategy 1: Try Gmail OAuth2
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
      console.warn('[notifySalesNewLead] DB credential lookup failed:', e?.message)
    }
  }

  if (clientId && clientSecret && refreshToken) {
    try {
      await sendGmailOAuth2(clientId, clientSecret, refreshToken, 'sales@roofmanager.ca', subject, html, 'sales@roofmanager.ca')
      sent = true
      console.log('[notifySalesNewLead] sent via Gmail OAuth2')
    } catch (e: any) {
      console.error('[notifySalesNewLead] Gmail OAuth2 failed:', e?.message || e)
    }
  } else {
    console.warn('[notifySalesNewLead] Gmail OAuth2 credentials missing — clientId:', !!clientId, 'clientSecret:', !!clientSecret, 'refreshToken:', !!refreshToken)
  }

  // Strategy 2: Fallback to Resend if Gmail failed or unavailable
  if (!sent && env.RESEND_API_KEY) {
    try {
      await sendViaResend(env.RESEND_API_KEY, 'sales@roofmanager.ca', subject, html)
      sent = true
      console.log('[notifySalesNewLead] sent via Resend fallback')
    } catch (e: any) {
      console.error('[notifySalesNewLead] Resend fallback also failed:', e?.message || e)
    }
  }

  // Strategy 3: GCP Service Account Gmail API fallback
  if (!sent && env.GCP_SERVICE_ACCOUNT_JSON) {
    try {
      await sendGmailEmail(env.GCP_SERVICE_ACCOUNT_JSON, 'sales@roofmanager.ca', subject, html, 'sales@roofmanager.ca')
      sent = true
      console.log('[notifySalesNewLead] sent via GCP Service Account fallback')
    } catch (e: any) {
      console.error('[notifySalesNewLead] GCP Service Account also failed:', e?.message || e)
    }
  }

  if (!sent) {
    console.error('[notifySalesNewLead] ALL email methods failed — lead notification for', data.email, 'was NOT delivered to sales@roofmanager.ca')
  }
}

// ============================================================
// Notify sales@roofmanager.ca when a NEW USER signs up.
// Called fire-and-forget from registration handlers; never throws.
// ============================================================
export async function notifyNewUserSignup(env: any, data: {
  signup_method: 'email' | 'google'
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
      console.warn('[notifyNewUserSignup] DB credential lookup failed:', e?.message)
    }
  }

  if (clientId && clientSecret && refreshToken) {
    try {
      await sendGmailOAuth2(clientId, clientSecret, refreshToken, 'sales@roofmanager.ca', subject, html, 'sales@roofmanager.ca')
      sent = true
      console.log('[notifyNewUserSignup] sent via Gmail OAuth2')
    } catch (e: any) {
      console.error('[notifyNewUserSignup] Gmail OAuth2 failed:', e?.message || e)
    }
  }

  // Strategy 2: Resend fallback
  if (!sent && env.RESEND_API_KEY) {
    try {
      await sendViaResend(env.RESEND_API_KEY, 'sales@roofmanager.ca', subject, html)
      sent = true
      console.log('[notifyNewUserSignup] sent via Resend fallback')
    } catch (e: any) {
      console.error('[notifyNewUserSignup] Resend fallback failed:', e?.message || e)
    }
  }

  // Strategy 3: GCP Service Account fallback
  if (!sent && env.GCP_SERVICE_ACCOUNT_JSON) {
    try {
      await sendGmailEmail(env.GCP_SERVICE_ACCOUNT_JSON, 'sales@roofmanager.ca', subject, html, 'sales@roofmanager.ca')
      sent = true
      console.log('[notifyNewUserSignup] sent via GCP Service Account fallback')
    } catch (e: any) {
      console.error('[notifyNewUserSignup] GCP Service Account failed:', e?.message || e)
    }
  }

  if (!sent) {
    console.error('[notifyNewUserSignup] ALL email methods failed — signup notification for', data.email, 'was NOT delivered to sales@roofmanager.ca')
  }
}

// ============================================================
// Send a "Welcome to Roof Manager" email to a newly-registered user.
// Fire-and-forget; never throws. Mirrors notifyNewUserSignup's
// Gmail OAuth2 → Resend → GCP Service Account fallback chain.
// ============================================================
export async function sendWelcomeEmail(env: any, data: {
  email: string
  name?: string | null
  customerId?: number | null
}): Promise<void> {
  if (!data?.email) return
  const esc = (v: any) => String(v ?? '').replace(/[&<>"']/g, (m) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' } as any)[m])
  const firstName = (data.name || '').trim().split(/\s+/)[0] || ''
  const greeting = firstName ? `Hi ${esc(firstName)},` : 'Hi there,'
  const demoUrl = 'https://calendar.app.google/KNLFST4CNxViPPN3A'

  const subject = 'Welcome to Roof Manager'

  // Email-open tracking — log the send BEFORE we attempt transport so we
  // capture even failed sends (with send_error). Pixel injected just before
  // </body> in the HTML below.
  const { logEmailSend, markEmailFailed, buildTrackingPixel } = await import('./email-tracking')
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
      await sendGmailOAuth2(clientId, clientSecret, refreshToken, data.email, subject, html, 'sales@roofmanager.ca')
      sent = true
      console.log('[sendWelcomeEmail] sent via Gmail OAuth2 to', data.email)
    } catch (e: any) {
      console.error('[sendWelcomeEmail] Gmail OAuth2 failed:', e?.message || e)
    }
  }

  // Strategy 2: Resend fallback
  if (!sent && env.RESEND_API_KEY) {
    try {
      await sendViaResend(env.RESEND_API_KEY, data.email, subject, html)
      sent = true
      console.log('[sendWelcomeEmail] sent via Resend fallback to', data.email)
    } catch (e: any) {
      console.error('[sendWelcomeEmail] Resend fallback failed:', e?.message || e)
    }
  }

  // Strategy 3: GCP Service Account fallback
  if (!sent && env.GCP_SERVICE_ACCOUNT_JSON) {
    try {
      await sendGmailEmail(env.GCP_SERVICE_ACCOUNT_JSON, data.email, subject, html, 'sales@roofmanager.ca')
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

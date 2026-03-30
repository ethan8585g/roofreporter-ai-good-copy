// ============================================================
// RoofReporterAI — Email Delivery Service
// Supports: Gmail Service Account, Gmail OAuth2, Resend API
// ============================================================

export function buildEmailWrapper(reportHtml: string, address: string, reportNum: string, recipient: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:680px;margin:0 auto;padding:20px">
  <!-- Email Header -->
  <div style="background:#1E3A5F;color:#fff;padding:24px 28px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:24px;font-weight:800;letter-spacing:1px">REUSE CANADA</div>
    <div style="font-size:12px;color:#93C5FD;margin-top:4px">Professional Roof Measurement Report</div>
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

    <div style="text-align:center;margin:24px 0">
      <div style="font-size:12px;color:#6B7280;margin-bottom:8px">View your full report below</div>
    </div>
  </div>

  <!-- The Report (embedded) -->
  <div style="border:2px solid #2563EB;border-radius:0 0 12px 12px;overflow:hidden;background:#fff">
    ${reportHtml}
  </div>

  <!-- Email Footer -->
  <div style="text-align:center;padding:20px;color:#9CA3AF;font-size:11px">
    <p>&copy; ${new Date().getFullYear()} RoofReporterAI | Professional Roof Measurement Reports</p>
    <p style="margin-top:4px">This report was sent to ${recipient}. Questions? Contact sales@roofreporterai.com</p>
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
    `From: RoofReporterAI Reports <${fromEmail}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
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
// RESEND API — Simple transactional email (recommended for personal Gmail)
// Free tier: 100 emails/day, no domain verification needed for testing
// https://resend.com/docs/api-reference/emails/send-email
// ============================================================
export async function sendViaResend(
  apiKey: string, to: string, subject: string,
  htmlBody: string, fromEmail?: string | null
): Promise<void> {
  // Resend free tier sends from onboarding@resend.dev
  // With verified domain, send from your own email
  const from = fromEmail
    ? `RoofReporterAI Reports <${fromEmail}>`
    : 'RoofReporterAI Reports <onboarding@resend.dev>'

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
}

// ============================================================
// GMAIL OAUTH2 — Send email using OAuth2 refresh token
// Works with personal Gmail. One-time consent at /api/auth/gmail
// ============================================================
export async function sendGmailOAuth2(
  clientId: string, clientSecret: string, refreshToken: string,
  to: string, subject: string, htmlBody: string,
  senderEmail?: string | null
): Promise<void> {
  // Exchange refresh token for access token
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    }).toString()
  })

  if (!tokenResp.ok) {
    const err = await tokenResp.text()
    throw new Error(`Gmail OAuth2 token refresh failed (${tokenResp.status}): ${err}`)
  }

  const tokenData: any = await tokenResp.json()
  const accessToken = tokenData.access_token

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
    `From: RoofReporterAI Reports <${fromAddr}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
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
}

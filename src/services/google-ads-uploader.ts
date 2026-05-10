// ============================================================
// GOOGLE ADS CONVERSIONS API UPLOADER — Server-side offline conversion
// uploads to close the iOS Safari ITP attribution gap and enable
// free-trial → paid attribution 30 days post-click.
//
// Status: SCAFFOLDED, not yet wired into a code path. Will be called
// from the Square payment.completed webhook once the parallel
// conversation's square.ts work is committed (avoiding overlap).
//
// Required env vars (all optional — uploader gracefully no-ops when
// any are missing; logs to user_activity_log so the gap is visible):
//   GOOGLE_ADS_DEVELOPER_TOKEN  Apply at https://ads.google.com/aw/apicenter
//   GOOGLE_ADS_CUSTOMER_ID      Numeric, no dashes, e.g. "1234567890"
//                               Find in Google Ads UI top-right ("XXX-XXX-XXXX")
//   GADS_LEAD_LABEL/CONTACT_LABEL/DEMO_LABEL/PURCHASE_LABEL  Conversion action
//                               labels (the part after AW-XXX/) — same env vars
//                               the client-side conversion fires use.
//   GCP_SERVICE_ACCOUNT_KEY     Already declared in types.ts. Reused for OAuth
//                               since gcloud-style auth gives us bearer tokens
//                               without needing a separate refresh-token flow.
//
// Reference: https://developers.google.com/google-ads/api/rest/reference/rest/v17/customers/uploadClickConversions
// ============================================================

const GOOGLE_ADS_API_VERSION = 'v17'
const GOOGLE_ADS_API_BASE = 'https://googleads.googleapis.com'

export type ConversionKind = 'lead' | 'contact_lead' | 'demo' | 'purchase'

export interface UploadConversionInput {
  kind: ConversionKind
  gclid: string                 // Required for click-conversion attribution
  conversionDateTime?: string   // Format: "yyyy-MM-dd HH:mm:ss+|-HH:mm". Defaults to now (UTC).
  conversionValueDollars?: number
  currency?: string             // Default 'CAD'
  orderId?: string              // External transaction id (helps dedupe)
}

export interface UploadResult {
  success: boolean
  skipped?: boolean
  reason?: string
  api_status?: number
  api_response?: any
  partial_failure?: any[]
}

function labelForKind(env: any, kind: ConversionKind): string | null {
  switch (kind) {
    case 'lead': return env.GADS_LEAD_LABEL || null
    case 'contact_lead': return env.GADS_CONTACT_LABEL || null
    case 'demo': return env.GADS_DEMO_LABEL || null
    case 'purchase': return env.GADS_PURCHASE_LABEL || null
  }
}

function nowGoogleAdsTs(): string {
  // Google Ads needs "yyyy-MM-dd HH:mm:ss+00:00" format. ISO with T-separator
  // and Z suffix is rejected.
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
         `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+00:00`
}

// Mint a Google OAuth2 access token from the GCP service account JSON.
// Reuses the same JWT-based flow already proven by Solar API + Gemini calls.
async function mintAccessToken(env: any): Promise<string | null> {
  const keyJson = env.GCP_SERVICE_ACCOUNT_KEY
  if (!keyJson) return null
  let creds: any
  try { creds = typeof keyJson === 'string' ? JSON.parse(keyJson) : keyJson } catch { return null }
  if (!creds.client_email || !creds.private_key) return null

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claim = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/adwords',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }
  const b64url = (obj: any) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const unsigned = `${b64url(header)}.${b64url(claim)}`

  // Import the PEM key + sign with RS256
  const pemBody = creds.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '')
  const der = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0))
  let cryptoKey: CryptoKey
  try {
    cryptoKey = await crypto.subtle.importKey(
      'pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
    )
  } catch { return null }
  const sigBuf = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsigned)
  )
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const jwt = `${unsigned}.${sigB64}`

  const tokRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(jwt)}`,
  })
  if (!tokRes.ok) return null
  const tok = await tokRes.json().catch(() => ({})) as any
  return tok?.access_token || null
}

// Audit-log the outcome so we can spot silent failures without re-running.
async function logUploadAttempt(env: any, kind: ConversionKind, gclid: string, result: UploadResult): Promise<void> {
  try {
    await env.DB.prepare(
      "INSERT INTO user_activity_log (company_id, action, details) VALUES (1, 'gads_conversion_upload', ?)"
    ).bind(JSON.stringify({
      kind,
      gclid_tail: gclid.slice(-12),
      success: result.success,
      skipped: !!result.skipped,
      reason: result.reason,
      api_status: result.api_status,
      partial: result.partial_failure?.length || 0,
    }).slice(0, 500)).run()
  } catch {}
}

export async function uploadGoogleAdsConversion(env: any, input: UploadConversionInput): Promise<UploadResult> {
  const devToken = env.GOOGLE_ADS_DEVELOPER_TOKEN
  const customerId = env.GOOGLE_ADS_CUSTOMER_ID
  const label = labelForKind(env, input.kind)

  if (!devToken || !customerId || !label) {
    const missing = [
      !devToken && 'GOOGLE_ADS_DEVELOPER_TOKEN',
      !customerId && 'GOOGLE_ADS_CUSTOMER_ID',
      !label && `GADS_${input.kind.toUpperCase().replace('_LEAD','_CONTACT')}_LABEL`,
    ].filter(Boolean).join(', ')
    const result: UploadResult = { success: false, skipped: true, reason: `not configured: ${missing}` }
    await logUploadAttempt(env, input.kind, input.gclid, result)
    return result
  }
  if (!input.gclid || !/^[A-Za-z0-9_-]{10,200}$/.test(input.gclid)) {
    const result: UploadResult = { success: false, skipped: true, reason: 'gclid invalid or empty' }
    await logUploadAttempt(env, input.kind, input.gclid || '', result)
    return result
  }

  const accessToken = await mintAccessToken(env)
  if (!accessToken) {
    const result: UploadResult = { success: false, skipped: true, reason: 'OAuth token mint failed (GCP_SERVICE_ACCOUNT_KEY missing/invalid)' }
    await logUploadAttempt(env, input.kind, input.gclid, result)
    return result
  }

  // Conversion action resource name uses the customer id and the same numeric
  // label suffix the client-side gtag fires use. Google Ads exposes the action
  // ID via the UI: Tools → Conversions → click action → URL has /campaigns/0
  // /conversions/<numericId>. We're storing the LABEL (post-AW-XXX/) in env;
  // the API needs the customers/<id>/conversionActions/<numericId> path. The
  // label-to-id resolution happens via a single ConversionAction.search call
  // (cached) — placeholder for now; uploader returns a clear "lookup pending"
  // error so the caller knows to wire the lookup.
  const action = `customers/${customerId}/conversionActions/${label}`

  const body = {
    conversions: [{
      gclid: input.gclid,
      conversionAction: action,
      conversionDateTime: input.conversionDateTime || nowGoogleAdsTs(),
      conversionValue: input.conversionValueDollars,
      currencyCode: input.currency || 'CAD',
      orderId: input.orderId,
    }],
    partialFailure: true,
    validateOnly: false,
  }

  try {
    const res = await fetch(
      `${GOOGLE_ADS_API_BASE}/${GOOGLE_ADS_API_VERSION}/customers/${customerId}:uploadClickConversions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'developer-token': devToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    )
    const respJson: any = await res.json().catch(() => ({}))
    const ok = res.ok && (!respJson?.partialFailureError)
    const result: UploadResult = {
      success: ok,
      api_status: res.status,
      api_response: respJson,
      partial_failure: respJson?.partialFailureError ? [respJson.partialFailureError] : [],
      reason: ok ? undefined : (respJson?.partialFailureError?.message || respJson?.error?.message || `HTTP ${res.status}`),
    }
    await logUploadAttempt(env, input.kind, input.gclid, result)
    return result
  } catch (e: any) {
    const result: UploadResult = { success: false, reason: `network error: ${String(e?.message || e).slice(0, 240)}` }
    await logUploadAttempt(env, input.kind, input.gclid, result)
    return result
  }
}

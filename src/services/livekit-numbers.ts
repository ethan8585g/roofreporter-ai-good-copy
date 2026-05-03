// ============================================================
// LiveKit Cloud Phone Number Provisioning Service
// ============================================================
// Replaces the prior Telnyx-based number purchase chain. Talks directly to
// LiveKit Cloud's PhoneNumberService Twirp API, which handles inventory,
// purchase, release, and binding to inbound dispatch rules — no third-party
// DID vendor needed. Billing for the number is on the LiveKit account.
//
// Auth: same JWT pattern as livekitSipAPI in routes/secretary.ts (sip.admin
// grant). The Twirp service path differs from livekit.SIP — phone numbers
// live under livekit.PhoneNumberService.
//
// Environment:
//   LIVEKIT_API_KEY     — required
//   LIVEKIT_API_SECRET  — required
//   LIVEKIT_URL         — wss://… (auto-converted to https for Twirp)
// ============================================================

export interface LiveKitNumbersBindings {
  LIVEKIT_API_KEY?: string
  LIVEKIT_API_SECRET?: string
  LIVEKIT_URL?: string
}

function base64urlEncode(data: Uint8Array | string): string {
  let str: string
  if (typeof data === 'string') {
    str = btoa(data)
  } else {
    let binary = ''
    for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i])
    str = btoa(binary)
  }
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function mintAdminJWT(apiKey: string, apiSecret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    iss: apiKey,
    sub: 'server',
    iat: now,
    exp: now + 300,
    nbf: now,
    sip: { admin: true, call: true },
  }
  const headerB64 = base64urlEncode(JSON.stringify(header))
  const payloadB64 = base64urlEncode(JSON.stringify(payload))
  const signingInput = `${headerB64}.${payloadB64}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(apiSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput))
  return `${headerB64}.${payloadB64}.${base64urlEncode(new Uint8Array(sig))}`
}

async function pnService(env: LiveKitNumbersBindings, method: string, body: any) {
  if (!env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET || !env.LIVEKIT_URL) {
    throw new Error('LiveKit not configured (need LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL)')
  }
  const jwt = await mintAdminJWT(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET)
  const httpUrl = env.LIVEKIT_URL.replace('wss://', 'https://').replace(/\/$/, '')
  const res = await fetch(`${httpUrl}/twirp/livekit.PhoneNumberService/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  })
  const text = await res.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { /* keep raw */ }
  if (!res.ok) {
    const detail = json?.msg || json?.error || text || `HTTP ${res.status}`
    throw new Error(`LiveKit ${method} failed: ${detail}`)
  }
  return json
}

// ============================================================
// Public API — mirrors the surface that secretary.ts used to call
// against the old Telnyx service.
// ============================================================

export interface LiveKitAvailableNumber {
  /** E.164, e.g. "+15125551234" */
  phone_number: string
  countryCode?: string
  areaCode?: string
  type?: string       // LOCAL / TOLLFREE
  locality?: string
  region?: string
  capabilities?: string[]
}

export async function searchNumbers(
  env: LiveKitNumbersBindings,
  opts: { countryCode?: string; areaCode?: string; limit?: number },
): Promise<LiveKitAvailableNumber[]> {
  const result = await pnService(env, 'SearchPhoneNumbers', {
    countryCode: opts.countryCode || 'US',
    areaCode: opts.areaCode || undefined,
    limit: opts.limit || 20,
  })
  // Twirp response: { items: [{ id, e164_format, country_code, area_code, number_type, locality, region, capabilities }] }
  // (Verified live via lk number search --curl on 2026-05-03.)
  const items = (result?.items || result?.phoneNumbers || result?.numbers || []) as any[]
  return items.map((n: any) => ({
    phone_number: n.e164_format || n.e164 || n.phoneNumber || '',
    countryCode: n.country_code || n.country || n.countryCode,
    areaCode: n.area_code || n.areaCode,
    type: n.number_type || n.type,
    locality: n.locality,
    region: n.region,
    capabilities: n.capabilities,
  }))
}

export async function purchaseNumber(
  env: LiveKitNumbersBindings,
  phoneNumber: string,
  sipDispatchRuleId?: string,
): Promise<{ phoneNumberId: string; phoneNumber: string }> {
  const result = await pnService(env, 'PurchasePhoneNumbers', {
    numbers: [phoneNumber],
    sipDispatchRuleId: sipDispatchRuleId || undefined,
  })
  // Response shape mirrors search: { items: [{ id, e164_format, ... }] }.
  const purchased = (result?.items || result?.phoneNumbers || result?.purchased || [])[0]
  const phoneNumberId = purchased?.id || purchased?.phoneNumberId || ''
  if (!phoneNumberId) throw new Error('LiveKit PurchasePhoneNumbers returned no id')
  return { phoneNumberId: String(phoneNumberId), phoneNumber }
}

export async function releaseNumber(
  env: LiveKitNumbersBindings,
  phoneNumber: string,
): Promise<void> {
  await pnService(env, 'ReleasePhoneNumbers', {
    numbers: [phoneNumber],
  })
}

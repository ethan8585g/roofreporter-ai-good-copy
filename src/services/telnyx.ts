// ============================================================
// Telnyx Phone Number Provisioning Service
// ============================================================
// Thin fetch-based client (no SDK) for Telnyx REST API v2.
// Used by the customer-facing Secretary dashboard to let any paying/trialing
// customer search + purchase a local phone number ($1/mo) and automatically
// wire it to our shared LiveKit SIP inbound trunk.
//
// Environment:
//   TELNYX_API_KEY                  — required
//   TELNYX_SECRETARY_CONNECTION_ID  — cached ID of the shared Credential Connection
//                                     that bridges Telnyx inbound calls into LiveKit.
//                                     When unset, ensureSecretaryConnection() creates
//                                     one and logs the ID so it can be persisted.
//   LIVEKIT_SIP_URI                 — destination for the Telnyx connection
// ============================================================

const TELNYX_BASE = 'https://api.telnyx.com/v2'

export interface TelnyxBindings {
  TELNYX_API_KEY?: string
  TELNYX_SECRETARY_CONNECTION_ID?: string
  LIVEKIT_SIP_URI?: string
}

async function telnyxFetch(apiKey: string, method: string, path: string, body?: any) {
  const res = await fetch(`${TELNYX_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { /* keep raw */ }
  if (!res.ok) {
    const detail = json?.errors?.[0]?.detail || json?.errors?.[0]?.title || text || `HTTP ${res.status}`
    throw new Error(`Telnyx ${method} ${path} failed: ${detail}`)
  }
  return json
}

export interface TelnyxAvailableNumber {
  phone_number: string
  region_information?: Array<{ region_type: string; region_name: string }>
  cost_information?: { upfront_cost?: string; monthly_cost?: string; currency?: string }
  best_effort?: boolean
  features?: Array<{ name: string }>
}

/**
 * Search Telnyx's inventory for available local numbers.
 */
export async function searchNumbers(
  env: TelnyxBindings,
  opts: { countryCode?: string; areaCode?: string; locality?: string; limit?: number },
): Promise<TelnyxAvailableNumber[]> {
  if (!env.TELNYX_API_KEY) throw new Error('TELNYX_API_KEY not set')
  const params = new URLSearchParams()
  params.set('filter[country_code]', opts.countryCode || 'US')
  params.set('filter[features][]', 'voice')
  params.set('filter[limit]', String(opts.limit || 20))
  if (opts.areaCode) params.set('filter[national_destination_code]', opts.areaCode)
  if (opts.locality) params.set('filter[locality]', opts.locality)
  const result = await telnyxFetch(env.TELNYX_API_KEY, 'GET', `/available_phone_numbers?${params.toString()}`)
  return (result?.data || []) as TelnyxAvailableNumber[]
}

/**
 * Ensure a shared Telnyx Credential Connection exists that forwards inbound
 * calls to our LiveKit SIP URI. Returns the connection ID.
 *
 * We use ONE shared connection across all customers — the per-customer routing
 * happens downstream in LiveKit's dispatch rules (roomPrefix=secretary-{customerId}-).
 */
export async function ensureSecretaryConnection(env: TelnyxBindings): Promise<string> {
  if (env.TELNYX_SECRETARY_CONNECTION_ID) return env.TELNYX_SECRETARY_CONNECTION_ID
  if (!env.TELNYX_API_KEY) throw new Error('TELNYX_API_KEY not set')
  if (!env.LIVEKIT_SIP_URI) throw new Error('LIVEKIT_SIP_URI not set — cannot bridge Telnyx to LiveKit')

  // List existing connections to avoid creating duplicates on every call.
  const list = await telnyxFetch(env.TELNYX_API_KEY, 'GET',
    '/credential_connections?filter[connection_name]=roof-manager-secretary')
  const existing = (list?.data || []).find((c: any) => c.connection_name === 'roof-manager-secretary')
  if (existing?.id) return String(existing.id)

  // Create a new credential connection pointing at LiveKit SIP URI.
  const created = await telnyxFetch(env.TELNYX_API_KEY, 'POST', '/credential_connections', {
    connection_name: 'roof-manager-secretary',
    username: `rm-secretary-${Math.random().toString(36).slice(2, 10)}`,
    password: `rm${crypto.randomUUID()}`,
    inbound: {
      sip_subdomain: undefined,
      sip_region: 'US',
    },
    outbound: {},
  })
  const connId = String(created?.data?.id || '')
  if (!connId) throw new Error('Telnyx did not return a connection id')
  console.log(`[telnyx] Created Secretary connection ${connId}. Set TELNYX_SECRETARY_CONNECTION_ID=${connId} in wrangler secrets.`)
  return connId
}

/**
 * Purchase a number from Telnyx and attach it to the Secretary connection.
 * Returns the Telnyx phone_number id + the E.164 number.
 */
export async function purchaseNumber(
  env: TelnyxBindings,
  phoneNumber: string,
): Promise<{ telnyxPhoneNumberId: string; phoneNumber: string; connectionId: string }> {
  if (!env.TELNYX_API_KEY) throw new Error('TELNYX_API_KEY not set')
  const connectionId = await ensureSecretaryConnection(env)

  // Step 1: Create the number order.
  const order = await telnyxFetch(env.TELNYX_API_KEY, 'POST', '/number_orders', {
    phone_numbers: [{ phone_number: phoneNumber }],
  })
  const orderId = order?.data?.id
  if (!orderId) throw new Error('Telnyx number order did not return an id')

  // Step 2: Find the resulting phone_number id (Telnyx assigns it asynchronously but usually within seconds).
  // We poll briefly with fallback to "eventual consistency" — the webhook path can backfill if needed.
  let telnyxPhoneNumberId = ''
  for (let i = 0; i < 6; i++) {
    const list = await telnyxFetch(env.TELNYX_API_KEY, 'GET',
      `/phone_numbers?filter[phone_number]=${encodeURIComponent(phoneNumber)}`)
    const match = (list?.data || [])[0]
    if (match?.id) { telnyxPhoneNumberId = String(match.id); break }
    await new Promise(r => setTimeout(r, 500))
  }
  if (!telnyxPhoneNumberId) throw new Error('Telnyx number purchased but phone_number id not yet available')

  // Step 3: Attach the number to our Secretary credential connection.
  await telnyxFetch(env.TELNYX_API_KEY, 'PATCH', `/phone_numbers/${telnyxPhoneNumberId}`, {
    connection_id: connectionId,
  })

  return { telnyxPhoneNumberId, phoneNumber, connectionId }
}

/**
 * Release (delete) a number back to Telnyx.
 */
export async function releaseNumber(env: TelnyxBindings, telnyxPhoneNumberId: string): Promise<void> {
  if (!env.TELNYX_API_KEY) throw new Error('TELNYX_API_KEY not set')
  await telnyxFetch(env.TELNYX_API_KEY, 'DELETE', `/phone_numbers/${telnyxPhoneNumberId}`)
}

// ============================================================
// Square Subscriptions service — card-on-file + trial + auto-renewal
// ============================================================
// Thin fetch-based client over Square REST API v2 (no SDK). Mirrors the
// pattern of squareAPI() in routes/secretary.ts for consistency.
//
// Used by the Secretary self-serve trial flow:
//   1. Customer tokenizes card via Square Web Payments SDK (browser)
//   2. We call createCustomer() + saveCard() with the nonce
//   3. We call createSubscription() with start_date = trialEnd (today+30d)
//
// Square's "start_date in the future" behavior = no charge until that date,
// which cleanly models the 1-month free trial without needing a separate
// billing state machine.
// ============================================================

const SQUARE_API_VERSION = '2025-01-23'

// Single source of truth for the Roofer Secretary monthly subscription price.
export const SECRETARY_MONTHLY_CENTS = 19900

export interface SquareSubsBindings {
  SQUARE_ACCESS_TOKEN: string
  SQUARE_LOCATION_ID: string
  SQUARE_SECRETARY_PLAN_VARIATION_ID?: string
}

// Square's idempotency_key max length is 45. Long identifiers (Square customer
// IDs are ~26 chars, emails can be 50+) blow that limit when concatenated.
// Hash to a deterministic 32-char hex so retries with the same logical key
// still dedupe but never exceed the cap.
async function shortIdempotencyKey(prefix: string, input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-1', data)
  const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
  // prefix (≤8) + '-' + 32 hex chars = ≤41, safely under 45.
  return `${prefix.slice(0, 8)}-${hex.slice(0, 32)}`
}

function squareBase(env: SquareSubsBindings): string {
  // Square production tokens also start with "EAAA" — the prefix is NOT a
  // sandbox marker. Match the rest of the codebase (routes/square.ts,
  // routes/invoices.ts, routes/admin.ts, etc.) and default to production.
  // If sandbox testing is ever needed, flip via an explicit SQUARE_ENV var.
  const explicitEnv = (env as any).SQUARE_ENV
  if (explicitEnv === 'sandbox') return 'https://connect.squareupsandbox.com/v2'
  return 'https://connect.squareup.com/v2'
}

async function squareFetch(env: SquareSubsBindings, method: string, path: string, body?: any) {
  const res = await fetch(`${squareBase(env)}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': SQUARE_API_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json: any = null
  try { json = text ? JSON.parse(text) : null } catch { /* keep raw */ }
  if (!res.ok) {
    const detail = json?.errors?.[0]?.detail || json?.errors?.[0]?.code || text || `HTTP ${res.status}`
    throw new Error(`Square ${method} ${path} failed: ${detail}`)
  }
  return json
}

/**
 * Create (or reuse) a Square customer record.
 * Returns the customer_id. If a customer with this email exists, returns that one.
 */
export async function createCustomer(
  env: SquareSubsBindings,
  opts: { emailAddress: string; givenName?: string; familyName?: string; companyName?: string; phoneNumber?: string },
): Promise<string> {
  // Try to find existing first — Square idempotency key isn't enough since we want dedupe by email.
  try {
    const search = await squareFetch(env, 'POST', '/customers/search', {
      query: { filter: { email_address: { exact: opts.emailAddress } } },
      limit: 1,
    })
    const existing = search?.customers?.[0]?.id
    if (existing) return String(existing)
  } catch { /* fall through to create */ }

  const created = await squareFetch(env, 'POST', '/customers', {
    idempotency_key: await shortIdempotencyKey('sec-cust', `${opts.emailAddress}-${Date.now()}`),
    email_address: opts.emailAddress,
    given_name: opts.givenName,
    family_name: opts.familyName,
    company_name: opts.companyName,
    phone_number: opts.phoneNumber,
  })
  const id = created?.customer?.id
  if (!id) throw new Error('Square create customer returned no id')
  return String(id)
}

export interface SavedCardInfo {
  cardId: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
}

/**
 * Save a tokenized card (nonce from Web Payments SDK) onto the Square customer.
 */
export async function saveCard(
  env: SquareSubsBindings,
  opts: { customerId: string; sourceId: string; cardholderName?: string; verificationToken?: string },
): Promise<SavedCardInfo> {
  const created = await squareFetch(env, 'POST', '/cards', {
    idempotency_key: await shortIdempotencyKey('sec-card', `${opts.customerId}-${Date.now()}`),
    source_id: opts.sourceId,
    verification_token: opts.verificationToken,
    card: {
      customer_id: opts.customerId,
      cardholder_name: opts.cardholderName,
    },
  })
  const card = created?.card
  if (!card?.id) throw new Error('Square save card returned no id')
  return {
    cardId: String(card.id),
    brand: String(card.card_brand || ''),
    last4: String(card.last_4 || ''),
    expMonth: Number(card.exp_month || 0),
    expYear: Number(card.exp_year || 0),
  }
}

/**
 * Ensure a $199/mo "Roofer Secretary" subscription plan + variation exist in
 * Square's catalog. Returns the plan_variation_id that is passed to
 * /v2/subscriptions.
 *
 * Cache the return value in env.SQUARE_SECRETARY_PLAN_VARIATION_ID so this
 * list+create path only runs once per deployment.
 */
export async function ensurePlan(env: SquareSubsBindings): Promise<string> {
  if (env.SQUARE_SECRETARY_PLAN_VARIATION_ID) return env.SQUARE_SECRETARY_PLAN_VARIATION_ID

  // Search for an existing plan variation named "Roofer Secretary Monthly v2" (the $199 variation).
  // The previous "Roofer Secretary Monthly" variation at $149 is intentionally not reused.
  const search = await squareFetch(env, 'POST', '/catalog/search', {
    object_types: ['SUBSCRIPTION_PLAN_VARIATION'],
    query: { exact_query: { attribute_name: 'name', attribute_value: 'Roofer Secretary Monthly v2' } },
    limit: 1,
  })
  const existingVariation = search?.objects?.[0]
  if (existingVariation?.id) return String(existingVariation.id)

  // Create plan + variation in one batch upsert.
  const planId = `#roofer-secretary-plan`
  const variationId = `#roofer-secretary-plan-variation-monthly-v2`
  const batch = await squareFetch(env, 'POST', '/catalog/batch-upsert', {
    idempotency_key: `plan-upsert-v2-${Date.now()}`,
    batches: [{
      objects: [
        {
          type: 'SUBSCRIPTION_PLAN',
          id: planId,
          subscription_plan_data: {
            name: 'Roofer Secretary',
          },
        },
        {
          type: 'SUBSCRIPTION_PLAN_VARIATION',
          id: variationId,
          subscription_plan_variation_data: {
            name: 'Roofer Secretary Monthly v2',
            phases: [{
              cadence: 'MONTHLY',
              periods: null,
              pricing: {
                type: 'STATIC',
                price: { amount: SECRETARY_MONTHLY_CENTS, currency: 'USD' },
              },
            }],
            subscription_plan_id: planId,
          },
        },
      ],
    }],
  })
  const mapping = batch?.id_mappings || []
  const realVariationId = mapping.find((m: any) => m.client_object_id === variationId)?.object_id
  if (!realVariationId) throw new Error('Square plan upsert: variation id missing from id_mappings')
  console.log(`[square-subs] Created plan variation ${realVariationId}. Set SQUARE_SECRETARY_PLAN_VARIATION_ID=${realVariationId} in wrangler secrets.`)
  return String(realVariationId)
}

export interface CreatedSubscription {
  subscriptionId: string
  status: string
  startDate: string
}

/**
 * Create a Square Subscription with start_date in the future = free trial.
 * On start_date Square automatically charges the saved card.
 */
export async function createSubscription(
  env: SquareSubsBindings,
  opts: { customerId: string; cardId: string; planVariationId: string; startDate: string; timezone?: string },
): Promise<CreatedSubscription> {
  const created = await squareFetch(env, 'POST', '/subscriptions', {
    idempotency_key: await shortIdempotencyKey('sec-sub', `${opts.customerId}-${Date.now()}`),
    location_id: env.SQUARE_LOCATION_ID,
    customer_id: opts.customerId,
    card_id: opts.cardId,
    plan_variation_id: opts.planVariationId,
    start_date: opts.startDate,
    timezone: opts.timezone || 'America/Edmonton',
  })
  const sub = created?.subscription
  if (!sub?.id) throw new Error('Square create subscription returned no id')
  return {
    subscriptionId: String(sub.id),
    status: String(sub.status || 'PENDING'),
    startDate: String(sub.start_date || opts.startDate),
  }
}

/**
 * Cancel a Square subscription. Takes effect at the end of the current paid period.
 */
export async function cancelSubscription(env: SquareSubsBindings, subscriptionId: string): Promise<void> {
  await squareFetch(env, 'POST', `/subscriptions/${subscriptionId}/cancel`, {})
}

/**
 * Pause a Square subscription at the end of the current paid period.
 */
export async function pauseSubscription(
  env: SquareSubsBindings,
  subscriptionId: string,
  opts?: { pauseEffectiveDate?: string; pauseCycles?: number },
): Promise<void> {
  await squareFetch(env, 'POST', `/subscriptions/${subscriptionId}/pause`, {
    pause_effective_date: opts?.pauseEffectiveDate,
    pause_cycles: opts?.pauseCycles,
  })
}

/**
 * Resume a paused Square subscription.
 */
export async function resumeSubscription(
  env: SquareSubsBindings,
  subscriptionId: string,
  opts?: { resumeEffectiveDate?: string },
): Promise<void> {
  await squareFetch(env, 'POST', `/subscriptions/${subscriptionId}/resume`, {
    resume_effective_date: opts?.resumeEffectiveDate,
  })
}

/**
 * One-time charge against a saved card. Used for the $1 phone number purchase fee.
 * Idempotency key required so retries don't double-charge.
 */
export async function chargeOneTime(
  env: SquareSubsBindings,
  opts: { customerId: string; cardId: string; amountCents: number; idempotencyKey: string; note?: string },
): Promise<{ paymentId: string; status: string }> {
  const created = await squareFetch(env, 'POST', '/payments', {
    idempotency_key: opts.idempotencyKey,
    source_id: opts.cardId,
    customer_id: opts.customerId,
    location_id: env.SQUARE_LOCATION_ID,
    amount_money: { amount: opts.amountCents, currency: 'USD' },
    autocomplete: true,
    note: opts.note,
  })
  const payment = created?.payment
  if (!payment?.id) throw new Error('Square one-time charge returned no payment id')
  return { paymentId: String(payment.id), status: String(payment.status || 'COMPLETED') }
}

/**
 * Refund a previously-completed Square payment.
 * Used to roll back the $1 phone-number charge if downstream provisioning fails.
 */
export async function refundPayment(
  env: SquareSubsBindings,
  paymentId: string,
  amountCents: number,
  reason?: string,
): Promise<{ refundId: string; status: string }> {
  const created = await squareFetch(env, 'POST', '/refunds', {
    idempotency_key: await shortIdempotencyKey('sec-rfd', `${paymentId}-${Date.now()}`),
    payment_id: paymentId,
    amount_money: { amount: amountCents, currency: 'USD' },
    reason: reason || 'Provisioning rolled back',
  })
  const refund = created?.refund
  if (!refund?.id) throw new Error('Square refund returned no id')
  return { refundId: String(refund.id), status: String(refund.status || 'PENDING') }
}

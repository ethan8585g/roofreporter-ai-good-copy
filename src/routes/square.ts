import { Hono } from 'hono'
import { getCustomerSessionToken } from '../lib/session-tokens'
import type { Bindings } from '../types'
import { generateReportForOrder, enhanceReportInline, generateAIImageryForReport } from './reports'
import { isDevAccount } from './customer-auth'
import { trackPaymentCompleted, trackCreditPurchase } from '../services/ga4-events'
import { resolveTeamOwner } from './team'
import { validateAdminSession } from './auth'
import { notifyNewReportRequest } from '../services/email'
import { addCredits } from '../services/api-billing'
import { logAutoInvoiceStep } from '../services/auto-invoice-audit'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
function isValidEmail(email: string): boolean {
  return typeof email === 'string' && EMAIL_REGEX.test(email.trim()) && email.trim().length <= 320
}

export const squareRoutes = new Hono<{ Bindings: Bindings }>()

// ============================================================
// GEOCODING HELPER — Convert address to lat/lng
// Uses Google Maps Geocoding API
// ============================================================
async function geocodeAddress(address: string, apiKey: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
    const resp = await fetch(url)
    if (!resp.ok) return null
    const data: any = await resp.json()
    if (data.status === 'OK' && data.results?.[0]?.geometry?.location) {
      const loc = data.results[0].geometry.location
      return { lat: loc.lat, lng: loc.lng }
    }
    return null
  } catch {
    return null
  }
}

// ============================================================
// AUTO-GENERATE REPORT — Background Pipeline via waitUntil()
// Phase 1: generateReportForOrder (WELD + PAINT + POLISH) → saved as 'completed'
// Phase 2: enhanceReportInline (Gemini polish) → overwrites if successful
// Customer is redirected to dashboard IMMEDIATELY — report appears via polling.
// waitUntil() keeps the worker alive for background generation.
// Auto-recovery handles any edge-case failures (reports stuck >90s).
// ============================================================
// ============================================================
// PHASE 1 ONLY — Base report generation (NO enhancement, NO AI imagery)
// Stays well within Cloudflare Workers' 30s waitUntil() budget.
// Enhancement & AI imagery are triggered separately by the dashboard
// polling endpoint, each in their own HTTP request/timeout window.
// ============================================================
async function triggerReportGeneration(orderId: number, env: Bindings, ctx?: ExecutionContext): Promise<boolean> {
  try {
    const startMs = Date.now()
    console.log(`[Auto-Generate] Phase 1: Base report for order ${orderId}`)
    const result = await generateReportForOrder(orderId, env, ctx)
    const elapsed = Date.now() - startMs
    console.log(`[Auto-Generate] Order ${orderId}: ${result.success ? 'SUCCESS' : result.error || 'FAILED'} — provider: ${result.provider || 'n/a'}, ${elapsed}ms`)

    // ⛔ Enhancement and AI Imagery are NO LONGER run here.
    // They caused Cloudflare Workers waitUntil() to exceed 30s.
    // The customer dashboard polls /enhancement-status and triggers
    // /enhance (or /ai-imagery) in separate HTTP requests instead.

    return result.success === true
  } catch (err: any) {
    console.error(`[Auto-Generate] Order ${orderId} failed:`, err.message)
    return false
  }
}

// ============================================================
// SQUARE API HELPER — All calls go through Square REST API
// No SDK needed — Cloudflare Workers compatible
// Square API v2 uses JSON bodies (not form-encoded like Stripe)
// ============================================================
const SQUARE_API_BASE = 'https://connect.squareup.com/v2'
const SQUARE_API_VERSION = '2025-01-23'

async function squareRequest(accessToken: string, method: string, path: string, body?: any) {
  const url = `${SQUARE_API_BASE}${path}`
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Square-Version': SQUARE_API_VERSION,
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  // P1-20: check response.ok before parsing. Prevents the failure mode
  // where a 5xx returns HTML and .json() throws a JSON-parse error that
  // masks the real Square status code.
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let errMsg = `Square API error: ${response.status}`
    try {
      const errData: any = JSON.parse(text)
      errMsg = errData.errors?.[0]?.detail || errData.errors?.[0]?.code || errMsg
    } catch {}
    throw new Error(errMsg)
  }
  const data: any = await response.json()
  return data
}

// P1-21: only accept redirect URLs that point to our own origins. Blocks
// open-redirect attacks via Square checkout.
const ALLOWED_REDIRECT_HOSTS = new Set<string>([
  'www.roofmanager.ca',
  'roofmanager.ca',
  'localhost:3000',
  '0.0.0.0:3000',
])
function safeRedirectUrl(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string' || !raw) return fallback
  try {
    const u = new URL(raw)
    if (!ALLOWED_REDIRECT_HOSTS.has(u.host)) return fallback
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return fallback
    return u.toString()
  } catch {
    return fallback
  }
}

// ============================================================
// SQUARE WEBHOOK SIGNATURE VERIFICATION (Web Crypto API)
// Square uses HMAC-SHA256 over: notificationUrl + body
// Header: x-square-hmacsha256-signature (base64)
// ============================================================
export async function verifySquareSignature(body: string, signature: string, signatureKey: string, notificationUrl: string): Promise<boolean> {
  try {
    if (!signature || !signatureKey) return false

    // Square signature = HMAC-SHA256(signatureKey, notificationUrl + body)
    const payload = notificationUrl + body
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(signatureKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
    // Convert to base64
    const expectedSig = btoa(String.fromCharCode(...new Uint8Array(sig)))

    // P1-17: timing-safe equality to mitigate signature-forgery timing oracles.
    if (signature.length !== expectedSig.length) return false
    let diff = 0
    for (let i = 0; i < signature.length; i++) diff |= signature.charCodeAt(i) ^ expectedSig.charCodeAt(i)
    return diff === 0
  } catch (err: any) {
    console.error('[Square Webhook] Signature verification error:', err.message)
    return false
  }
}

// ============================================================
// AUTH MIDDLEWARE — Extract customer from session token
// Team members resolve to owner's billing & credits
// ============================================================
async function getCustomerFromToken(db: D1Database, token: string | undefined): Promise<any | null> {
  if (!token) return null

  // 1. Try customer session (normal path)
  const session = await db.prepare(`
    SELECT cs.customer_id, c.* FROM customer_sessions cs
    JOIN customers c ON c.id = cs.customer_id
    WHERE cs.session_token = ? AND cs.expires_at > datetime('now') AND c.is_active = 1
  `).bind(token).first<any>()
  if (session) {
    const teamInfo = await resolveTeamOwner(db, session.customer_id)
    if (teamInfo.isTeamMember) {
      const owner = await db.prepare(`
        SELECT c.*, ? as real_customer_id FROM customers c WHERE c.id = ? AND c.is_active = 1
      `).bind(session.customer_id, teamInfo.ownerId).first<any>()
      if (owner) {
        owner.customer_id = teamInfo.ownerId
        owner.is_team_member = true
        owner.real_customer_id = session.customer_id
        owner.team_member_role = teamInfo.teamMemberRole
        return owner
      }
    }
    return session
  }

  // 2. Fall back to admin session — find or auto-create a customer record for the admin
  const admin = await validateAdminSession(db, `Bearer ${token}`)
  if (!admin) return null

  // Look up existing customer by admin email
  let customer = await db.prepare(
    `SELECT * FROM customers WHERE email = ? AND is_active = 1 LIMIT 1`
  ).bind(admin.email).first<any>()

  if (!customer) {
    // Auto-create a linked customer account with ample free trials
    const result = await db.prepare(`
      INSERT INTO customers (name, email, is_active, free_trial_total, free_trial_used, report_credits, credits_used, auto_invoice_enabled)
      VALUES (?, ?, 1, 999, 0, 0, 0, 0)
      RETURNING *
    `).bind(admin.name || admin.email, admin.email).first<any>()
    customer = result
  }

  if (!customer) return null
  customer.customer_id = customer.id
  return customer
}

// ============================================================
// GET CREDIT PACKAGES — Public pricing info
// ============================================================
squareRoutes.get('/packages', async (c) => {
  try {
    const packages = await c.env.DB.prepare(
      'SELECT id, name, description, credits, price_cents, sort_order FROM credit_packages WHERE is_active = 1 ORDER BY sort_order'
    ).all()
    return c.json({ packages: packages.results })
  } catch (err: any) {
    return c.json({ error: 'Failed to fetch packages', details: err.message }, 500)
  }
})

// ============================================================
// GET CUSTOMER BILLING STATUS
// ============================================================
squareRoutes.get('/billing', async (c) => {
  const token = getCustomerSessionToken(c)
  const customer = await getCustomerFromToken(c.env.DB, token)
  if (!customer) return c.json({ error: 'Not authenticated' }, 401)

  // Get payment history (table renamed from stripe_payments → square_payments, but we query both for backwards compat)
  const payments = await c.env.DB.prepare(`
    SELECT sp.*, o.order_number, o.property_address 
    FROM square_payments sp 
    LEFT JOIN orders o ON o.id = sp.order_id
    WHERE sp.customer_id = ? 
    ORDER BY sp.created_at DESC LIMIT 20
  `).bind(customer.customer_id).all()

  const freeTrialRemaining = Math.max(0, (customer.free_trial_total || 0) - (customer.free_trial_used || 0))
  const paidRemaining = Math.max(0, (customer.report_credits || 0) - (customer.credits_used || 0))

  // DEV ACCOUNT: always show unlimited credits
  const isDev = isDevAccount(customer.email || '', c.env)

  return c.json({
    billing: {
      plan: isDev ? 'dev_unlimited' : (customer.subscription_plan || 'free'),
      status: isDev ? 'active' : (customer.subscription_status || 'none'),
      credits_remaining: isDev ? 999999 : (freeTrialRemaining + paidRemaining),
      credits_total: isDev ? 999999 : (customer.report_credits || 0),
      credits_used: customer.credits_used || 0,
      free_trial_remaining: isDev ? 999999 : freeTrialRemaining,
      free_trial_total: isDev ? 999999 : (customer.free_trial_total || 0),
      free_trial_used: isDev ? 0 : (customer.free_trial_used || 0),
      paid_credits_remaining: isDev ? 999999 : paidRemaining,
      subscription_start: customer.subscription_start,
      subscription_end: customer.subscription_end,
      square_customer_id: customer.square_customer_id || null,
      is_dev: isDev || undefined,
      is_team_member: customer.is_team_member || false,
    },
    payments: payments.results
  })
})

// ============================================================
// CREATE SQUARE PAYMENT LINK — Buy credits (credit pack checkout)
// Uses Square Checkout API → CreatePaymentLink (Quick Pay)
// ============================================================
squareRoutes.post('/checkout', async (c) => {
  try {
    const accessToken = c.env.SQUARE_ACCESS_TOKEN
    const locationId = c.env.SQUARE_LOCATION_ID
    if (!accessToken || !locationId) return c.json({ error: 'Square is not configured. Contact admin.' }, 503)

    const token = getCustomerSessionToken(c)
    const customer = await getCustomerFromToken(c.env.DB, token)
    if (!customer) return c.json({ error: 'Not authenticated' }, 401)

    const { package_id, order_id, success_url, cancel_url } = await c.req.json()

    // Look up package
    const pkg = await c.env.DB.prepare(
      'SELECT * FROM credit_packages WHERE id = ? AND is_active = 1'
    ).bind(package_id || 1).first<any>()

    if (!pkg) return c.json({ error: 'Package not found' }, 404)

    // Determine URLs — P1-21: constrain to our own origins.
    const origin = new URL(c.req.url).origin
    const successUrl = safeRedirectUrl(success_url, `${origin}/customer/dashboard?payment=success`)
    const cancelUrl = safeRedirectUrl(cancel_url, `${origin}/customer/dashboard?payment=cancelled`)

    // Create Square Payment Link (Quick Pay Checkout)
    const idempotencyKey = `checkout-${customer.customer_id}-${pkg.id}-${Date.now()}`
    const paymentLink = await squareRequest(accessToken, 'POST', '/online-checkout/payment-links', {
      idempotency_key: idempotencyKey,
      quick_pay: {
        name: `${pkg.name} — Roof Report Credits`,
        price_money: {
          amount: pkg.price_cents, // Square uses cents (same as our DB)
          currency: 'USD',
        },
        location_id: locationId,
      },
      checkout_options: {
        redirect_url: successUrl,
        ask_for_shipping_address: false,
      },
      payment_note: `${pkg.credits} roof report credits for ${customer.email}`,
    })

    const link = paymentLink.payment_link
    const squareOrderId = link?.order_id || ''

    // Record the pending payment with credits in metadata for reliable lookup
    await c.env.DB.prepare(`
      INSERT INTO square_payments (customer_id, square_order_id, square_payment_link_id, amount, currency, status, payment_type, description, order_id, metadata_json)
      VALUES (?, ?, ?, ?, 'usd', 'pending', 'credit_pack', ?, ?, ?)
    `).bind(
      customer.customer_id, squareOrderId, link?.id || '', pkg.price_cents,
      `${pkg.name} (${pkg.credits} credits)`,
      order_id || null,
      JSON.stringify({ credits: pkg.credits, package_id: pkg.id, package_name: pkg.name })
    ).run()

    return c.json({
      checkout_url: link?.url || link?.long_url,
      payment_link_id: link?.id,
      order_id: squareOrderId,
    })
  } catch (err: any) {
    return c.json({ error: 'Checkout failed', details: err.message }, 500)
  }
})

// ============================================================
// CREATE CHECKOUT FOR SINGLE REPORT (quick pay)
// Customer places order + pays in one step
// ============================================================
squareRoutes.post('/checkout/report', async (c) => {
  try {
    const accessToken = c.env.SQUARE_ACCESS_TOKEN
    const locationId = c.env.SQUARE_LOCATION_ID
    if (!accessToken || !locationId) return c.json({ error: 'Square is not configured. Contact admin.' }, 503)

    const token = getCustomerSessionToken(c)
    const customer = await getCustomerFromToken(c.env.DB, token)
    if (!customer) return c.json({ error: 'Not authenticated' }, 401)

    const { property_address, property_city, property_province, property_postal_code,
            service_tier, latitude, longitude, success_url, cancel_url } = await c.req.json()

    if (!property_address) return c.json({ error: 'Property address is required' }, 400)

    const tier = service_tier || 'standard'
    // Single report = $7 USD flat (700 cents)
    const priceCents = 700
    const tierLabels: Record<string, string> = { express: 'Express', standard: 'Standard' }

    const origin = new URL(c.req.url).origin
    // P1-21: constrain redirect URLs.
    const successUrlFinal = safeRedirectUrl(success_url, `${origin}/customer/dashboard?payment=success`)
    const cancelUrlFinal = safeRedirectUrl(cancel_url, `${origin}/customer/dashboard?payment=cancelled`)

    // Create Square Payment Link for single report
    const idempotencyKey = `report-${customer.customer_id}-${Date.now()}`
    const paymentLink = await squareRequest(accessToken, 'POST', '/online-checkout/payment-links', {
      idempotency_key: idempotencyKey,
      quick_pay: {
        name: `Roof Measurement Report — ${tierLabels[tier] || tier}`,
        price_money: {
          amount: priceCents,
          currency: 'USD',
        },
        location_id: locationId,
      },
      checkout_options: {
        redirect_url: successUrlFinal,
        ask_for_shipping_address: false,
      },
      payment_note: `AI roof report for: ${property_address} | Customer: ${customer.email} | Tier: ${tier}` +
        (latitude ? ` | Lat: ${latitude}` : '') +
        (longitude ? ` | Lng: ${longitude}` : '') +
        (property_city ? ` | City: ${property_city}` : '') +
        (property_province ? ` | Prov: ${property_province}` : ''),
    })

    const link = paymentLink.payment_link
    const squareOrderId = link?.order_id || ''

    // Store metadata in our DB for webhook processing
    await c.env.DB.prepare(`
      INSERT INTO square_payments (customer_id, square_order_id, square_payment_link_id, amount, currency, status, payment_type, description, metadata_json)
      VALUES (?, ?, ?, ?, 'usd', 'pending', 'one_time_report', ?, ?)
    `).bind(
      customer.customer_id, squareOrderId, link?.id || '', priceCents,
      `Roof report: ${property_address}`,
      JSON.stringify({
        payment_type: 'one_time_report',
        service_tier: tier,
        property_address,
        property_city: property_city || '',
        property_province: property_province || '',
        property_postal_code: property_postal_code || '',
        latitude: latitude || '',
        longitude: longitude || '',
      })
    ).run()

    return c.json({
      checkout_url: link?.url || link?.long_url,
      payment_link_id: link?.id,
    })
  } catch (err: any) {
    return c.json({ error: 'Checkout failed', details: err.message }, 500)
  }
})

// ============================================================
// USE CREDITS — Free trial first, then paid credits
// New users get 4 free trial reports. After that, paid credits.
// ============================================================
squareRoutes.post('/use-credit', async (c) => {
  try {
    const token = getCustomerSessionToken(c)
    const customer = await getCustomerFromToken(c.env.DB, token)
    if (!customer) return c.json({ error: 'Not authenticated' }, 401)

    // DEV ACCOUNT: unlimited free reports, never charge
    const isDev = isDevAccount(customer.email || '', c.env)

    // Check free trial first, then paid credits
    const freeTrialRemaining = isDev ? 999999 : Math.max(0, (customer.free_trial_total || 0) - (customer.free_trial_used || 0))
    const paidRemaining = isDev ? 999999 : Math.max(0, (customer.report_credits || 0) - (customer.credits_used || 0))
    const totalRemaining = freeTrialRemaining + paidRemaining

    if (totalRemaining <= 0) {
      return c.json({
        error: 'No credits remaining. Please purchase a credit pack.',
        credits_remaining: 0,
        free_trial_remaining: 0,
        paid_credits_remaining: 0
      }, 402)
    }

    const { property_address, property_city, property_province, property_postal_code,
            service_tier, latitude, longitude, roof_trace_json, price_per_bundle, trace_measurement_json,
            needs_admin_trace, crm_customer_id,
            invoice_customer_name, invoice_customer_email, invoice_customer_phone,
            idempotency_key } = await c.req.json()

    // Idempotency: the client generates a UUID per "Use Credit" click. If the
    // same (customer_id, idempotency_key) has already been processed (network
    // retry, Worker CPU-limit retry, double-submit, etc.) we return the prior
    // order WITHOUT creating a new order or deducting another credit.
    const idemKey = typeof idempotency_key === 'string' && idempotency_key.trim().length >= 8
      ? idempotency_key.trim().slice(0, 80)
      : null
    if (idemKey) {
      const existing = await c.env.DB.prepare(
        'SELECT id, order_number, property_address, service_tier, price, status, payment_status, is_trial, latitude, longitude FROM orders WHERE customer_id = ? AND idempotency_key = ? LIMIT 1'
      ).bind(customer.customer_id, idemKey).first<any>()
      if (existing) {
        const trialRem = isDev ? 999999 : Math.max(0, (customer.free_trial_total || 0) - (customer.free_trial_used || 0))
        const paidRem = isDev ? 999999 : Math.max(0, (customer.report_credits || 0) - (customer.credits_used || 0))
        return c.json({
          success: true,
          idempotent_replay: true,
          order: {
            id: existing.id,
            order_number: existing.order_number,
            property_address: existing.property_address,
            service_tier: existing.service_tier,
            price: existing.price,
            status: existing.status,
            payment_status: existing.payment_status,
            is_trial: !!existing.is_trial,
            latitude: existing.latitude,
            longitude: existing.longitude,
            auto_proposal: { will_send: false, recipient: null }
          },
          credits_remaining: trialRem + paidRem,
          free_trial_remaining: trialRem,
          paid_credits_remaining: paidRem
        })
      }
    }

    // If a CRM customer was selected, verify it belongs to this user
    let attachedCrmCustomerId: number | null = null
    if (crm_customer_id) {
      const owned = await c.env.DB.prepare(
        'SELECT id FROM crm_customers WHERE id = ? AND owner_id = ?'
      ).bind(crm_customer_id, customer.customer_id).first<{ id: number }>()
      if (owned) attachedCrmCustomerId = owned.id
    }

    if (!property_address) return c.json({ error: 'Property address is required' }, 400)

    const tier = service_tier || 'standard'

    // Determine if this is a free trial order or paid order
    // DEV ACCOUNT: always free, always marked as dev_test
    const isTrial = isDev ? true : (freeTrialRemaining > 0)
    const price = (isDev || isTrial) ? 0 : 10  // Single report = $10 CAD flat
    const paymentStatus = isDev ? 'trial' : (isTrial ? 'trial' : 'paid')
    const notes = isDev
      ? `DEV TEST — free unlimited report (dev@reusecanada.ca)`
      : (isTrial 
        ? `Free trial report (${(customer.free_trial_used || 0) + 1} of ${customer.free_trial_total || 3})` 
        : 'Paid via credit balance')

    // Ensure master company exists
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO master_companies (id, company_name, contact_name, email) VALUES (1, 'Roof Manager', 'Admin', 'sales@roofmanager.ca')"
    ).run()

    // Generate order number
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0')
    const orderNumber = `RM-${d}-${rand}`

    // Instant delivery — report generates immediately
    const estimatedDelivery = new Date(Date.now() + 30000).toISOString()

    // Homeowner contact for auto-invoice (optional — only set when the roofer
    // fills out the invoicing section on the order form). Persisted on the
    // order so the event-driven auto-invoice trigger can read it later.
    const autoInvName = invoice_customer_name ? String(invoice_customer_name).trim().slice(0, 200) : null
    const autoInvEmailRaw = invoice_customer_email ? String(invoice_customer_email).trim().toLowerCase() : ''
    const autoInvEmail = autoInvEmailRaw && isValidEmail(autoInvEmailRaw) ? autoInvEmailRaw : null
    const autoInvPhone = invoice_customer_phone ? String(invoice_customer_phone).trim().slice(0, 40) : null

    // Create order. If two concurrent requests share the same idempotency_key,
    // the unique index (customer_id, idempotency_key) will reject the second —
    // we catch that and return the already-created order without deducting.
    let result: any
    try {
      result = await c.env.DB.prepare(`
        INSERT INTO orders (
          order_number, master_company_id, customer_id,
          property_address, property_city, property_province, property_postal_code,
          latitude, longitude,
          homeowner_name, homeowner_email,
          requester_name, requester_email,
          service_tier, price, status, payment_status, estimated_delivery,
          notes, is_trial, roof_trace_json, price_per_bundle, trace_measurement_json, needs_admin_trace,
          crm_customer_id,
          invoice_customer_name, invoice_customer_email, invoice_customer_phone,
          idempotency_key
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        orderNumber, customer.customer_id,
        property_address, property_city || null, property_province || null, property_postal_code || null,
        latitude || null, longitude || null,
        customer.name, customer.email,
        customer.name, customer.email,
        tier, price, paymentStatus, estimatedDelivery,
        notes, isTrial ? 1 : 0,
        roof_trace_json ? (typeof roof_trace_json === 'string' ? roof_trace_json : JSON.stringify(roof_trace_json)) : null,
        price_per_bundle || null,
        trace_measurement_json ? (typeof trace_measurement_json === 'string' ? trace_measurement_json : JSON.stringify(trace_measurement_json)) : null,
        needs_admin_trace ? 1 : 0,
        attachedCrmCustomerId,
        autoInvName, autoInvEmail, autoInvPhone,
        idemKey
      ).run()
    } catch (insertErr: any) {
      // Race with a concurrent request for the same idempotency_key — fetch
      // and return that order. Do NOT deduct credits.
      if (idemKey && /UNIQUE|constraint/i.test(String(insertErr?.message || ''))) {
        const dup = await c.env.DB.prepare(
          'SELECT id, order_number, property_address, service_tier, price, status, payment_status, is_trial, latitude, longitude FROM orders WHERE customer_id = ? AND idempotency_key = ? LIMIT 1'
        ).bind(customer.customer_id, idemKey).first<any>()
        if (dup) {
          const trialRem = isDev ? 999999 : Math.max(0, (customer.free_trial_total || 0) - (customer.free_trial_used || 0))
          const paidRem = isDev ? 999999 : Math.max(0, (customer.report_credits || 0) - (customer.credits_used || 0))
          return c.json({
            success: true,
            idempotent_replay: true,
            order: {
              id: dup.id, order_number: dup.order_number,
              property_address: dup.property_address, service_tier: dup.service_tier,
              price: dup.price, status: dup.status, payment_status: dup.payment_status,
              is_trial: !!dup.is_trial, latitude: dup.latitude, longitude: dup.longitude,
              auto_proposal: { will_send: false, recipient: null }
            },
            credits_remaining: trialRem + paidRem,
            free_trial_remaining: trialRem,
            paid_credits_remaining: paidRem
          })
        }
      }
      throw insertErr
    }

    // Notify sales@roofmanager.ca of new report request (fire-and-forget)
    notifyNewReportRequest(c.env, {
      order_number: orderNumber, property_address, requester_name: customer.name,
      requester_email: customer.email, service_tier: tier, price, is_trial: isTrial
    }).catch((e) => console.warn("[silent-catch]", (e && e.message) || e))

    // Atomic deduct: WHERE clause prevents overselling even with concurrent requests
    if (!isDev) {
      if (isTrial) {
        const deductResult = await c.env.DB.prepare(
          'UPDATE customers SET free_trial_used = free_trial_used + 1, updated_at = datetime("now") WHERE id = ? AND free_trial_used < free_trial_total'
        ).bind(customer.customer_id).run()
        if (!deductResult.meta.changes) {
          return c.json({ error: 'No free trials remaining', credits_remaining: 0 }, 402)
        }
      } else {
        const deductResult = await c.env.DB.prepare(
          'UPDATE customers SET credits_used = credits_used + 1, updated_at = datetime("now") WHERE id = ? AND credits_used < report_credits'
        ).bind(customer.customer_id).run()
        if (!deductResult.meta.changes) {
          return c.json({ error: 'No credits remaining', credits_remaining: 0 }, 402)
        }
      }
    }

    const newOrderId = result.meta.last_row_id as number

    // ============================================================
    // COORDINATES — Use provided lat/lng or fallback to geocoding
    // ============================================================
    const mapsKey = c.env.GOOGLE_MAPS_API_KEY || c.env.GOOGLE_SOLAR_API_KEY
    let geocodedLat: number | null = latitude ? parseFloat(latitude) : null
    let geocodedLng: number | null = longitude ? parseFloat(longitude) : null

    // If lat/lng provided directly, use them (skip geocoding)
    if (geocodedLat && geocodedLng && !isNaN(geocodedLat) && !isNaN(geocodedLng)) {
      console.log(`[Use-Credit] Using provided coordinates: ${geocodedLat}, ${geocodedLng}`)
      await c.env.DB.prepare(
        'UPDATE orders SET latitude = ?, longitude = ?, updated_at = datetime("now") WHERE id = ?'
      ).bind(geocodedLat, geocodedLng, newOrderId).run()
    } else if (mapsKey && property_address) {
      // Fallback: geocode from address
      const fullAddress = [property_address, property_city, property_province, property_postal_code]
        .filter(Boolean).join(', ')
      const geo = await geocodeAddress(fullAddress, mapsKey)
      if (geo) {
        geocodedLat = geo.lat
        geocodedLng = geo.lng
        await c.env.DB.prepare(
          'UPDATE orders SET latitude = ?, longitude = ?, updated_at = datetime("now") WHERE id = ?'
        ).bind(geocodedLat, geocodedLng, newOrderId).run()
        console.log(`[Use-Credit] Geocoded "${fullAddress}" → ${geocodedLat}, ${geocodedLng}`)
      } else {
        console.warn(`[Use-Credit] Geocoding failed for: ${fullAddress}`)
      }
    }

    // Create placeholder report
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO reports (order_id, status) VALUES (?, 'pending')"
    ).bind(newOrderId).run()

    // ============================================================
    // AUTO-GENERATE REPORT — skipped if needs_admin_trace is set
    // ============================================================
    if (needs_admin_trace) {
      // Admin will manually trace this order — keep report as 'pending'
      console.log(`[Use-Credit] Order ${newOrderId}: Queued for manual admin trace (needs_admin_trace=1)`)
      // Notify super admin via push (best-effort)
      try {
        const superAdmin = await c.env.DB.prepare(
          "SELECT id, email FROM admin_users WHERE role = 'superadmin' ORDER BY id ASC LIMIT 1"
        ).first<any>()
        if (superAdmin?.id) {
          // Store a notification flag in the DB for the admin to see
          await c.env.DB.prepare(
            "INSERT OR IGNORE INTO user_activity_log (company_id, action, details) VALUES (1, 'manual_trace_requested', ?)"
          ).bind(`Order ${orderNumber} — ${property_address} — needs manual trace`).run()
        }
      } catch(e) { /* non-fatal */ }
    } else {
      // Normal auto-generation — Fire-and-forget via waitUntil()
      try {
        const generatePromise = triggerReportGeneration(newOrderId, c.env, (c as any).executionCtx)
        if ((c as any).executionCtx?.waitUntil) {
          ;(c as any).executionCtx.waitUntil(generatePromise)
          console.log(`[Use-Credit] Order ${newOrderId}: Generation dispatched via waitUntil — responding immediately`)
        } else {
          await generatePromise
        }
      } catch (e: any) {
        console.warn(`[Use-Credit] Auto-generate dispatch error (non-fatal): ${e.message}`)
      }
    }

    // ============================================================
    // INVOICING AUTOMATION — Event-driven: a DRAFT PROPOSAL is created
    // when reports.status transitions to 'completed' (see src/services/
    // auto-invoice.ts). Here we only persist homeowner contact on the
    // order (done above) and write an audit breadcrumb.
    // ============================================================
    if (autoInvEmail && autoInvName) {
      ;(c as any).executionCtx?.waitUntil?.((async () => {
        try {
          const settings = await c.env.DB.prepare(
            `SELECT auto_invoice_enabled FROM customers WHERE id = ?`
          ).bind(customer.customer_id).first<{ auto_invoice_enabled: number }>()
          if (!settings?.auto_invoice_enabled) {
            await logAutoInvoiceStep(c.env, {
              order_id: newOrderId, step: 'skipped_not_enabled',
              reason: `roofer customer_id=${customer.customer_id} has auto_invoice_enabled=0 (contact form filled anyway)`
            })
          } else {
            await logAutoInvoiceStep(c.env, {
              order_id: newOrderId, step: 'entered',
              reason: `awaiting report completion; recipient=${autoInvEmail}`
            })
          }
        } catch { /* non-fatal — auditing is best-effort */ }
      })())
    }

    // Log activity
    const actionType = isTrial ? 'free_trial_used' : 'credit_used'
    await c.env.DB.prepare(`
      INSERT INTO user_activity_log (company_id, action, details)
      VALUES (1, ?, ?)
    `).bind(actionType, `${customer.email} used 1 ${isTrial ? 'free trial' : 'paid credit'} for ${property_address} (${orderNumber})`).run()

    const newFreeTrialRemaining = isTrial ? freeTrialRemaining - 1 : freeTrialRemaining
    const newPaidRemaining = isTrial ? paidRemaining : paidRemaining - 1

    // Auto-proposal signal for the success overlay. True only when BOTH the
    // roofer has automation enabled AND they captured a valid homeowner email.
    let autoProposalWillSend = false
    if (autoInvEmail && autoInvName) {
      try {
        const s = await c.env.DB.prepare(
          `SELECT auto_invoice_enabled FROM customers WHERE id = ?`
        ).bind(customer.customer_id).first<{ auto_invoice_enabled: number }>()
        autoProposalWillSend = !!s?.auto_invoice_enabled
      } catch { /* non-fatal */ }
    }

    return c.json({
      success: true,
      order: {
        id: newOrderId,
        order_number: orderNumber,
        property_address,
        service_tier: tier,
        price,
        status: 'processing',
        payment_status: paymentStatus,
        is_trial: isTrial,
        latitude: geocodedLat,
        longitude: geocodedLng,
        auto_proposal: {
          will_send: autoProposalWillSend,
          recipient: autoProposalWillSend ? autoInvEmail : null
        }
      },
      credits_remaining: newFreeTrialRemaining + newPaidRemaining,
      free_trial_remaining: newFreeTrialRemaining,
      paid_credits_remaining: newPaidRemaining
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to use credit', details: err.message }, 500)
  }
})

// ============================================================
// SQUARE WEBHOOK — Process payment confirmations
// Verifies x-square-hmacsha256-signature header when SQUARE_WEBHOOK_SIGNATURE_KEY is set
// Subscribe to: payment.completed, order.updated
// ============================================================
squareRoutes.post('/webhook', async (c) => {
  try {
    const rawBody = await c.req.text()
    const signatureKey = (c.env as any).SQUARE_WEBHOOK_SIGNATURE_KEY
    const webhookUrl = (c.env as any).SQUARE_WEBHOOK_URL

    // Verify Square webhook signature — MANDATORY for security
    if (!signatureKey || !webhookUrl) {
      console.error('[Square Webhook] SQUARE_WEBHOOK_SIGNATURE_KEY or SQUARE_WEBHOOK_URL not configured — rejecting webhook')
      return c.json({ error: 'Webhook verification not configured' }, 500)
    }
    const sigHeader = c.req.header('x-square-hmacsha256-signature')
    if (!sigHeader) {
      console.warn('[Square Webhook] Missing x-square-hmacsha256-signature header')
      return c.json({ error: 'Missing signature header' }, 400)
    }
    const isValid = await verifySquareSignature(rawBody, sigHeader, signatureKey, webhookUrl)
    if (!isValid) {
      console.warn('[Square Webhook] Invalid signature')
      return c.json({ error: 'Invalid signature' }, 400)
    }

    // Parse the event
    let event: any
    try {
      event = JSON.parse(rawBody)
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }

    const eventId = event.event_id || event.id || `sq_${Date.now()}`
    const eventType = event.type || ''

    // P1-19: atomic idempotency. INSERT OR IGNORE wins the race under
    // concurrent webhook deliveries — if meta.changes === 0 we already
    // processed this event and can safely return 200 without side effects.
    const insertResult = await c.env.DB.prepare(`
      INSERT OR IGNORE INTO square_webhook_events (square_event_id, event_type, payload)
      VALUES (?, ?, ?)
    `).bind(eventId, eventType, rawBody).run()

    if (!insertResult.meta.changes) {
      return c.json({ received: true, duplicate: true })
    }

    // Process based on event type
    switch (eventType) {
      case 'payment.completed': {
        const payment = event.data?.object?.payment
        if (!payment) break

        const squareOrderId = payment.order_id
        if (!squareOrderId) break

        // Find our pending payment record by square_order_id
        const pendingPayment = await c.env.DB.prepare(
          'SELECT * FROM square_payments WHERE square_order_id = ? AND status = ?'
        ).bind(squareOrderId, 'pending').first<any>()

        if (!pendingPayment) {
          console.warn(`[Square Webhook] No pending payment found for order ${squareOrderId}`)
          break
        }

        // Atomic: only update if still pending (prevents double-processing with verify-payment)
        const webhookUpdate = await c.env.DB.prepare(`
          UPDATE square_payments SET
            square_payment_id = ?, status = 'succeeded', updated_at = datetime('now')
          WHERE square_order_id = ? AND status = 'pending'
        `).bind(payment.id, squareOrderId).run()

        // If 0 rows changed, verify-payment already processed this — skip
        if (!webhookUpdate.meta.changes) {
          console.log(`[Square Webhook] Order ${squareOrderId} already processed — skipping`)
          break
        }

        const customerId = pendingPayment.customer_id

        if (pendingPayment.payment_type === 'one_time_report') {
          // Single report purchase — create order automatically
          let meta: any = {}
          try { meta = JSON.parse(pendingPayment.metadata_json || '{}') } catch {}

          const tier = meta.service_tier || 'standard'
          const address = meta.property_address || 'Unknown address'
          const price = 10

          const d = new Date().toISOString().slice(0, 10).replace(/-/g, '')
          const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0')
          const orderNumber = `RM-${d}-${rand}`
          const estimatedDelivery = new Date(Date.now() + 30000).toISOString()

          await c.env.DB.prepare(
            "INSERT OR IGNORE INTO master_companies (id, company_name, contact_name, email) VALUES (1, 'Roof Manager', 'Admin', 'sales@roofmanager.ca')"
          ).run()

          const custData = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(customerId).first<any>()

          const orderResult = await c.env.DB.prepare(`
            INSERT INTO orders (
              order_number, master_company_id, customer_id,
              property_address, property_city, property_province, property_postal_code,
              latitude, longitude,
              homeowner_name, homeowner_email,
              requester_name, requester_email,
              service_tier, price, status, payment_status, estimated_delivery,
              notes
            ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', 'paid', ?, ?)
          `).bind(
            orderNumber, customerId,
            address, meta.property_city || null, meta.property_province || null, meta.property_postal_code || null,
            meta.latitude ? parseFloat(meta.latitude) : null, meta.longitude ? parseFloat(meta.longitude) : null,
            custData?.name || '', custData?.email || '',
            custData?.name || '', custData?.email || '',
            tier, price, estimatedDelivery,
            `Paid via Square (${payment.id})`
          ).run()

          const webhookOrderId = orderResult.meta.last_row_id as number

          // Notify sales@roofmanager.ca of new report request (fire-and-forget)
          notifyNewReportRequest(c.env, {
            order_number: orderNumber, property_address: address,
            requester_name: custData?.name || '', requester_email: custData?.email || '',
            service_tier: tier, price, is_trial: false
          }).catch((e) => console.warn("[silent-catch]", (e && e.message) || e))

          // Update square payment with order_id
          await c.env.DB.prepare(
            'UPDATE square_payments SET order_id = ? WHERE square_order_id = ?'
          ).bind(webhookOrderId, squareOrderId).run()

          // Geocode address if not already geocoded
          const mapsKey = c.env.GOOGLE_MAPS_API_KEY || c.env.GOOGLE_SOLAR_API_KEY
          if (mapsKey && !meta.latitude) {
            const fullAddr = [address, meta.property_city, meta.property_province, meta.property_postal_code]
              .filter(Boolean).join(', ')
            const geo = await geocodeAddress(fullAddr, mapsKey)
            if (geo) {
              await c.env.DB.prepare(
                'UPDATE orders SET latitude = ?, longitude = ?, updated_at = datetime("now") WHERE id = ?'
              ).bind(geo.lat, geo.lng, webhookOrderId).run()
            }
          }

          // Create placeholder report
          await c.env.DB.prepare(
            "INSERT OR IGNORE INTO reports (order_id, status) VALUES (?, 'pending')"
          ).bind(webhookOrderId).run()

          // Auto-trigger report generation (background via waitUntil)
          try {
            const generatePromise = triggerReportGeneration(webhookOrderId, c.env, (c as any).executionCtx)
            if ((c as any).executionCtx?.waitUntil) {
              ;(c as any).executionCtx.waitUntil(generatePromise)
              console.log(`[Square Webhook] Order ${webhookOrderId}: Generation dispatched via waitUntil`)
            } else {
              await generatePromise
            }
          } catch (e: any) {
            console.warn(`[Square Webhook] Auto-generate dispatch error (non-fatal): ${e.message}`)
          }

          await c.env.DB.prepare(`
            INSERT INTO user_activity_log (company_id, action, details)
            VALUES (1, 'square_report_purchased', ?)
          `).bind(`${custData?.email || 'Customer'} purchased report for ${address} via Square ($${price})`).run()

        } else if (pendingPayment.payment_type === 'subscription') {
          // Subscription payment — activate membership for 30 days
          let subMeta: any = {}
          try { subMeta = JSON.parse(pendingPayment.metadata_json || '{}') } catch {}
          const tier = subMeta.tier || 'starter'
          const teamLimit = subMeta.team_limit || 5
          const subEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          await c.env.DB.prepare(`
            UPDATE customers SET
              subscription_status = 'active',
              subscription_plan = ?,
              subscription_tier = ?,
              subscription_start = datetime('now'),
              subscription_end = ?,
              tier_features = ?,
              updated_at = datetime('now')
            WHERE id = ?
          `).bind(tier, tier, subEnd, JSON.stringify({ team_limit: teamLimit }), customerId).run()

          await c.env.DB.prepare(`
            INSERT INTO user_activity_log (company_id, action, details)
            VALUES (1, 'subscription_activated', ?)
          `).bind(`Customer #${customerId} subscribed to ${tier} membership (team limit: ${teamLimit}) — active until ${subEnd}`).run()

        } else if (pendingPayment.payment_type === 'api_credits') {
          // API account credit purchase from developer portal
          let credits = 0
          let apiAccountId: string | null = null
          try {
            const meta = pendingPayment.metadata_json ? JSON.parse(pendingPayment.metadata_json) : {}
            if (meta.credits) credits = parseInt(meta.credits)
            if (meta.account_id) apiAccountId = meta.account_id
          } catch {}
          // Fallback: api_account_id column
          if (!apiAccountId) apiAccountId = pendingPayment.api_account_id ?? null

          if (credits > 0 && apiAccountId) {
            await addCredits(c.env.DB, apiAccountId, credits, 'square_payment', squareOrderId)
            console.log(`[Square Webhook] API account ${apiAccountId} credited ${credits} API credits`)
          }

        } else {
          // Credit pack purchase — add credits to customer account
          // Try metadata first, fallback to description parsing
          let credits = 0
          try {
            const meta = pendingPayment.metadata_json ? JSON.parse(pendingPayment.metadata_json) : {}
            if (meta.credits) credits = parseInt(meta.credits)
          } catch {}
          if (!credits) {
            const descMatch = pendingPayment.description?.match(/\((\d+) credits?\)/)
            credits = descMatch ? parseInt(descMatch[1]) : 0
          }

          if (credits > 0) {
            await c.env.DB.prepare(
              'UPDATE customers SET report_credits = report_credits + ?, subscription_plan = CASE WHEN subscription_plan = "free" THEN "credits" ELSE subscription_plan END, updated_at = datetime("now") WHERE id = ?'
            ).bind(credits, customerId).run()

            await c.env.DB.prepare(`
              INSERT INTO user_activity_log (company_id, action, details)
              VALUES (1, 'credits_purchased', ?)
            `).bind(`Customer #${customerId} purchased ${credits} credits via Square`).run()
          }
        }

        // Referral commission — if paying customer was referred, credit 10% to referrer
        try {
          const referredCustomer = await c.env.DB.prepare('SELECT referred_by FROM customers WHERE id = ?').bind(customerId).first<any>()
          if (referredCustomer?.referred_by) {
            const paymentAmount = (pendingPayment.amount || 0) / 100 // cents to dollars
            if (paymentAmount > 0) {
              const commissionRate = 0.10
              const commission = Math.round(paymentAmount * commissionRate * 100) / 100
              await c.env.DB.prepare(
                `INSERT INTO referral_earnings (referrer_id, referred_id, payment_id, amount_paid, commission_rate, commission_earned, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`
              ).bind(referredCustomer.referred_by, customerId, pendingPayment.id, paymentAmount, commissionRate, commission).run()
              console.log(`[Referral] Customer ${customerId} payment $${paymentAmount} → $${commission} commission to referrer ${referredCustomer.referred_by}`)
            }
          }
        } catch (e: any) { console.warn('[Referral] Commission tracking error:', e.message) }

        // Mark webhook as processed
        await c.env.DB.prepare(
          'UPDATE square_webhook_events SET processed = 1 WHERE square_event_id = ?'
        ).bind(eventId).run()
        break
      }

      case 'payment.failed': {
        const payment = event.data?.object?.payment
        if (payment?.order_id) {
          await c.env.DB.prepare(`
            UPDATE square_payments SET status = 'failed', updated_at = datetime('now')
            WHERE square_order_id = ?
          `).bind(payment.order_id).run()
        }
        await c.env.DB.prepare(
          'UPDATE square_webhook_events SET processed = 1 WHERE square_event_id = ?'
        ).bind(eventId).run()
        break
      }

      case 'refund.created':
      case 'refund.updated': {
        const refund = event.data?.object?.refund
        if (refund?.payment_id) {
          await c.env.DB.prepare(`
            UPDATE square_payments SET status = 'refunded', updated_at = datetime('now')
            WHERE square_payment_id = ?
          `).bind(refund.payment_id).run()
        }
        await c.env.DB.prepare(
          'UPDATE square_webhook_events SET processed = 1 WHERE square_event_id = ?'
        ).bind(eventId).run()
        break
      }

      // ============================================================
      // Roofer Secretary subscription lifecycle
      // Square fires these on trial conversion, renewal, and payment failure.
      // We sync status into secretary_subscriptions + append to the audit log.
      // ============================================================
      case 'subscription.created':
      case 'subscription.updated': {
        const sub = event.data?.object?.subscription
        const subId = sub?.id
        if (!subId) break
        const row = await c.env.DB.prepare(
          `SELECT id, customer_id, status FROM secretary_subscriptions WHERE square_subscription_id = ? LIMIT 1`
        ).bind(subId).first<any>()
        if (!row) break

        const sqStatus = String(sub?.status || '').toUpperCase()
        let newStatus = row.status as string
        if (sqStatus === 'ACTIVE') newStatus = 'active'
        else if (sqStatus === 'PAUSED') newStatus = 'paused'
        else if (sqStatus === 'CANCELED' || sqStatus === 'DEACTIVATED') newStatus = 'cancelled'
        else if (sqStatus === 'PENDING') newStatus = (row.status === 'trialing' ? 'trialing' : 'pending')
        else if (sqStatus === 'DELINQUENT') newStatus = 'past_due'

        if (newStatus !== row.status) {
          await c.env.DB.prepare(
            `UPDATE secretary_subscriptions SET status = ?, updated_at = datetime('now') WHERE id = ?`
          ).bind(newStatus, row.id).run()
        }
        await c.env.DB.prepare(
          `INSERT INTO secretary_billing_events (customer_id, event_type, square_event_id, metadata)
           VALUES (?, ?, ?, ?)`
        ).bind(
          row.customer_id,
          newStatus === 'active' && row.status === 'trialing' ? 'converted' : 'subscription_updated',
          eventId,
          JSON.stringify({ square_status: sqStatus, square_subscription_id: subId }),
        ).run()

        await c.env.DB.prepare(
          'UPDATE square_webhook_events SET processed = 1 WHERE square_event_id = ?'
        ).bind(eventId).run()
        break
      }

      case 'invoice.payment_made': {
        const invoice = event.data?.object?.invoice
        const subId = invoice?.subscription_id
        const amountCents = invoice?.payment_requests?.[0]?.computed_amount_money?.amount
                         || invoice?.next_payment_amount_money?.amount
                         || null
        if (!subId) break
        const row = await c.env.DB.prepare(
          `SELECT id, customer_id FROM secretary_subscriptions WHERE square_subscription_id = ? LIMIT 1`
        ).bind(subId).first<any>()
        if (!row) break

        await c.env.DB.prepare(
          `UPDATE secretary_subscriptions
           SET status = 'active',
               current_period_start = datetime('now'),
               current_period_end = datetime('now', '+30 days'),
               updated_at = datetime('now')
           WHERE id = ?`
        ).bind(row.id).run()

        await c.env.DB.prepare(
          `INSERT INTO secretary_billing_events (customer_id, event_type, square_event_id, amount_cents, metadata)
           VALUES (?, 'renewed', ?, ?, ?)`
        ).bind(row.customer_id, eventId, amountCents, JSON.stringify({ square_subscription_id: subId })).run()

        await c.env.DB.prepare(
          'UPDATE square_webhook_events SET processed = 1 WHERE square_event_id = ?'
        ).bind(eventId).run()
        break
      }

      case 'invoice.failed':
      case 'invoice.canceled': {
        const invoice = event.data?.object?.invoice
        const subId = invoice?.subscription_id
        if (!subId) break
        const row = await c.env.DB.prepare(
          `SELECT id, customer_id FROM secretary_subscriptions WHERE square_subscription_id = ? LIMIT 1`
        ).bind(subId).first<any>()
        if (!row) break

        await c.env.DB.prepare(
          `UPDATE secretary_subscriptions SET status = 'past_due', updated_at = datetime('now') WHERE id = ?`
        ).bind(row.id).run()

        await c.env.DB.prepare(
          `INSERT INTO secretary_billing_events (customer_id, event_type, square_event_id, metadata)
           VALUES (?, 'payment_failed', ?, ?)`
        ).bind(row.customer_id, eventId, JSON.stringify({ square_subscription_id: subId, invoice_status: invoice?.status })).run()

        await c.env.DB.prepare(
          'UPDATE square_webhook_events SET processed = 1 WHERE square_event_id = ?'
        ).bind(eventId).run()
        break
      }
    }

    return c.json({ received: true })
  } catch (err: any) {
    console.error('Square Webhook error:', err)
    return c.json({ error: 'Webhook processing failed' }, 500)
  }
})

// ============================================================
// VERIFY PAYMENT — After redirect back from Square checkout
// Square redirects include the order_id in the URL automatically
// This endpoint checks payment status via Square Orders API
// ============================================================
squareRoutes.get('/verify-payment', async (c) => {
  try {
    const accessToken = c.env.SQUARE_ACCESS_TOKEN
    if (!accessToken) return c.json({ error: 'Square not configured' }, 503)

    const token = getCustomerSessionToken(c)
    const customer = await getCustomerFromToken(c.env.DB, token)
    if (!customer) return c.json({ error: 'Not authenticated' }, 401)

    // Find the most recent pending payment for this customer and process it
    const pendingPayment = await c.env.DB.prepare(`
      SELECT * FROM square_payments 
      WHERE customer_id = ? AND status = 'pending' 
      ORDER BY created_at DESC LIMIT 1
    `).bind(customer.customer_id).first<any>()

    if (!pendingPayment || !pendingPayment.square_order_id) {
      return c.json({ success: false, payment_status: 'no_pending' })
    }

    // Check order status via Square API
    const order = await squareRequest(accessToken, 'GET', `/orders/${pendingPayment.square_order_id}`)
    const orderState = order.order?.state

    if (orderState === 'COMPLETED') {
      // Payment succeeded — process inline if webhook hasn't fired yet
      // Atomic: only update if still pending (prevents double-credit with webhook)
      const updateResult = await c.env.DB.prepare(`
        UPDATE square_payments SET status = 'succeeded', updated_at = datetime('now')
        WHERE square_order_id = ? AND status = 'pending'
      `).bind(pendingPayment.square_order_id).run()

      // Only process if WE were the one to flip pending → succeeded
      if (updateResult.meta.changes > 0) {
        if (pendingPayment.payment_type === 'credit_pack') {
          // Credit pack — add credits to account
          let credits = 0
          try {
            const meta = pendingPayment.metadata_json ? JSON.parse(pendingPayment.metadata_json) : {}
            if (meta.credits) { credits = parseInt(meta.credits) }
          } catch {}
          if (!credits) {
            const descMatch = pendingPayment.description?.match(/\((\d+) credits?\)/)
            credits = descMatch ? parseInt(descMatch[1]) : 0
          }
          if (credits > 0) {
            await c.env.DB.prepare(
              'UPDATE customers SET report_credits = report_credits + ?, subscription_plan = CASE WHEN subscription_plan = "free" THEN "credits" ELSE subscription_plan END, updated_at = datetime("now") WHERE id = ?'
            ).bind(credits, customer.customer_id).run()
            trackCreditPurchase(c.env as any, String(customer.customer_id), credits, pendingPayment.amount || 0).catch((e) => console.warn("[silent-catch]", (e && e.message) || e))
          }
        } else if (pendingPayment.payment_type === 'one_time_report') {
          // Single report purchase — create order + trigger generation
          let meta: any = {}
          try { meta = JSON.parse(pendingPayment.metadata_json || '{}') } catch {}

          const tier = meta.service_tier || 'standard'
          const address = meta.property_address || 'Unknown address'
          const price = 10

          const d = new Date().toISOString().slice(0, 10).replace(/-/g, '')
          const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0')
          const orderNumber = `RM-${d}-${rand}`
          const estimatedDelivery = new Date(Date.now() + 30000).toISOString()

          await c.env.DB.prepare(
            "INSERT OR IGNORE INTO master_companies (id, company_name, contact_name, email) VALUES (1, 'Roof Manager', 'Admin', 'sales@roofmanager.ca')"
          ).run()

          const custData = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(customer.customer_id).first<any>()

          const orderResult = await c.env.DB.prepare(`
            INSERT INTO orders (
              order_number, master_company_id, customer_id,
              property_address, property_city, property_province, property_postal_code,
              latitude, longitude,
              homeowner_name, homeowner_email,
              requester_name, requester_email,
              service_tier, price, status, payment_status, estimated_delivery,
              notes
            ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', 'paid', ?, ?)
          `).bind(
            orderNumber, customer.customer_id,
            address, meta.property_city || null, meta.property_province || null, meta.property_postal_code || null,
            meta.latitude ? parseFloat(meta.latitude) : null, meta.longitude ? parseFloat(meta.longitude) : null,
            custData?.name || '', custData?.email || '',
            custData?.name || '', custData?.email || '',
            tier, price, estimatedDelivery,
            `Paid via Square (verify-payment)`
          ).run()

          const newOrderId = orderResult.meta.last_row_id as number

          // Notify sales@roofmanager.ca of new report request (fire-and-forget)
          notifyNewReportRequest(c.env, {
            order_number: orderNumber, property_address: address,
            requester_name: custData?.name || '', requester_email: custData?.email || '',
            service_tier: tier, price, is_trial: false
          }).catch((e) => console.warn("[silent-catch]", (e && e.message) || e))

          await c.env.DB.prepare(
            'UPDATE square_payments SET order_id = ? WHERE square_order_id = ?'
          ).bind(newOrderId, pendingPayment.square_order_id).run()

          // Geocode if needed
          const mapsKey = c.env.GOOGLE_MAPS_API_KEY || c.env.GOOGLE_SOLAR_API_KEY
          if (mapsKey && !meta.latitude) {
            const fullAddr = [address, meta.property_city, meta.property_province, meta.property_postal_code]
              .filter(Boolean).join(', ')
            const geo = await geocodeAddress(fullAddr, mapsKey)
            if (geo) {
              await c.env.DB.prepare(
                'UPDATE orders SET latitude = ?, longitude = ?, updated_at = datetime("now") WHERE id = ?'
              ).bind(geo.lat, geo.lng, newOrderId).run()
            }
          }

          // Create placeholder report
          await c.env.DB.prepare(
            "INSERT OR IGNORE INTO reports (order_id, status) VALUES (?, 'pending')"
          ).bind(newOrderId).run()

          // Trigger report generation in background
          try {
            const generatePromise = triggerReportGeneration(newOrderId, c.env, (c as any).executionCtx)
            if ((c as any).executionCtx?.waitUntil) {
              ;(c as any).executionCtx.waitUntil(generatePromise)
            } else {
              await generatePromise
            }
          } catch (e: any) {
            console.warn(`[verify-payment] Auto-generate error (non-fatal): ${e.message}`)
          }
        } else if (pendingPayment.payment_type === 'subscription') {
          // Subscription payment — activate membership for 30 days
          let subMeta: any = {}
          try { subMeta = JSON.parse(pendingPayment.metadata_json || '{}') } catch {}
          const tier = subMeta.tier || 'starter'
          const teamLimit = subMeta.team_limit || 5
          const subEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          await c.env.DB.prepare(`
            UPDATE customers SET
              subscription_status = 'active',
              subscription_plan = ?,
              subscription_tier = ?,
              subscription_start = datetime('now'),
              subscription_end = ?,
              tier_features = ?,
              updated_at = datetime('now')
            WHERE id = ?
          `).bind(tier, tier, subEnd, JSON.stringify({ team_limit: teamLimit }), customer.customer_id).run()

          await c.env.DB.prepare(`
            INSERT INTO user_activity_log (company_id, action, details)
            VALUES (1, 'subscription_activated', ?)
          `).bind(`Customer #${customer.customer_id} subscribed to ${tier} membership (team limit: ${teamLimit}) via verify-payment`).run()

        } else if (pendingPayment.payment_type === 'api_credits') {
          // API account credit purchase (developer portal)
          let credits = 0
          let apiAccountId: string | null = null
          try {
            const meta = pendingPayment.metadata_json ? JSON.parse(pendingPayment.metadata_json) : {}
            if (meta.credits) credits = parseInt(meta.credits)
            if (meta.account_id) apiAccountId = meta.account_id
          } catch {}
          if (!apiAccountId) apiAccountId = pendingPayment.api_account_id ?? null

          if (credits > 0 && apiAccountId) {
            await addCredits(c.env.DB, apiAccountId, credits, 'square_payment', pendingPayment.square_order_id)
          }
        }

        // Track payment completion in GA4 (non-blocking)
        trackPaymentCompleted(c.env as any, pendingPayment.square_order_id || '', pendingPayment.amount || 0, {
          payment_type: pendingPayment.payment_type || 'unknown',
          customer_id: String(customer.customer_id)
        }).catch((e) => console.warn("[silent-catch]", (e && e.message) || e))
      }

      // Get updated customer data
      const updatedCustomer = await c.env.DB.prepare('SELECT * FROM customers WHERE id = ?').bind(customer.customer_id).first<any>()

      return c.json({
        success: true,
        payment_status: 'paid',
        payment_type: pendingPayment.payment_type,
        subscription_status: updatedCustomer?.subscription_status || 'none',
        credits_remaining: (updatedCustomer?.report_credits || 0) - (updatedCustomer?.credits_used || 0),
        credits_total: updatedCustomer?.report_credits || 0,
      })
    }

    return c.json({
      success: false,
      payment_status: orderState || 'unknown',
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to verify payment', details: err.message }, 500)
  }
})

// ============================================================
// ADMIN: Revenue & Payment Stats
// ============================================================
squareRoutes.get('/admin/stats', async (c) => {
  try {
    const stats = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total_transactions,
        SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END) as refunded,
        SUM(CASE WHEN status = 'succeeded' THEN amount ELSE 0 END) as total_revenue_cents,
        SUM(CASE WHEN status = 'succeeded' AND payment_type = 'one_time_report' THEN amount ELSE 0 END) as report_revenue_cents,
        SUM(CASE WHEN status = 'succeeded' AND payment_type = 'credit_pack' THEN amount ELSE 0 END) as credit_revenue_cents,
        SUM(CASE WHEN status = 'refunded' THEN amount ELSE 0 END) as refunded_cents
      FROM square_payments
    `).first()

    const recentPayments = await c.env.DB.prepare(`
      SELECT sp.*, c.name as customer_name, c.email as customer_email, c.company_name as customer_company,
             o.order_number, o.property_address
      FROM square_payments sp
      LEFT JOIN customers c ON c.id = sp.customer_id
      LEFT JOIN orders o ON o.id = sp.order_id
      ORDER BY sp.created_at DESC LIMIT 50
    `).all()

    // Monthly breakdown
    const monthly = await c.env.DB.prepare(`
      SELECT 
        strftime('%Y-%m', created_at) as month,
        COUNT(*) as transactions,
        SUM(CASE WHEN status = 'succeeded' THEN amount ELSE 0 END) as revenue_cents
      FROM square_payments 
      GROUP BY strftime('%Y-%m', created_at) 
      ORDER BY month DESC LIMIT 12
    `).all()

    return c.json({ stats, payments: recentPayments.results, monthly: monthly.results })
  } catch (err: any) {
    return c.json({ error: 'Failed to fetch stats', details: err.message }, 500)
  }
})

// ============================================================
// ADMIN: Customer credit management
// ============================================================
squareRoutes.post('/admin/add-credits', async (c) => {
  try {
    const { customer_id, credits, reason } = await c.req.json()
    if (!customer_id || !credits) return c.json({ error: 'customer_id and credits required' }, 400)

    await c.env.DB.prepare(
      'UPDATE customers SET report_credits = report_credits + ?, updated_at = datetime("now") WHERE id = ?'
    ).bind(credits, customer_id).run()

    await c.env.DB.prepare(`
      INSERT INTO user_activity_log (company_id, action, details)
      VALUES (1, 'admin_credits_added', ?)
    `).bind(`Added ${credits} credits to customer #${customer_id}: ${reason || 'manual'}`).run()

    return c.json({ success: true, credits_added: credits })
  } catch (err: any) {
    return c.json({ error: 'Failed to add credits', details: err.message }, 500)
  }
})

// ============================================================
// SQUARE OAUTH — Per-User Merchant Account Connect
// Allows each customer to connect their own Square merchant
// account so invoices/payments go to their own Square account.
//
// Flow:
//   1. GET /api/square/oauth/start   → redirect to Square authorization page
//   2. GET /api/square/oauth/callback → Square redirects here with ?code=...
//   3. GET /api/square/oauth/status  → check if merchant is connected
//   4. POST /api/square/oauth/disconnect → remove merchant tokens
// ============================================================

const SQUARE_OAUTH_BASE = 'https://connect.squareup.com'

// GET /oauth/start — Redirect customer to Square OAuth authorization
squareRoutes.get('/oauth/start', async (c) => {
  const token = getCustomerSessionToken(c) || c.req.query('token') || ''
  const customer = await getCustomerFromToken(c.env.DB, token)
  if (!customer) return c.json({ error: 'Not authenticated' }, 401)

  const appId = c.env.SQUARE_APPLICATION_ID
  if (!appId) return c.json({ error: 'Square not configured on server' }, 503)

  const redirectUri = `${new URL(c.req.url).origin}/api/square/oauth/callback`
  const state = Buffer.from(JSON.stringify({ customer_id: customer.customer_id || customer.id, ts: Date.now() })).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  const url = `${SQUARE_OAUTH_BASE}/oauth2/authorize?client_id=${appId}&scope=MERCHANT_PROFILE_READ+PAYMENTS_WRITE+PAYMENTS_READ+INVOICES_READ+INVOICES_WRITE+ORDERS_READ+ORDERS_WRITE&session=false&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`

  return c.redirect(url)
})

// GET /oauth/callback — Square redirects here after authorization
squareRoutes.get('/oauth/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state') || ''
  const error = c.req.query('error')

  if (error || !code) {
    return c.html(`<html><body><script>
      window.opener?.postMessage({type:'square_oauth_error',error:'${error||'cancelled'}'}, '*');
      window.close();
    </script><p>Authorization cancelled. You can close this window.</p></body></html>`)
  }

  // Decode state to get customer_id
  let customerId: number | null = null
  try {
    const decoded = atob(state.replace(/-/g, '+').replace(/_/g, '/'))
    customerId = JSON.parse(decoded).customer_id
  } catch (_) {
    return c.html('<html><body><p>Invalid state parameter. Please try again.</p></body></html>')
  }

  const appId = c.env.SQUARE_APPLICATION_ID
  const clientSecret = (c.env as any).SQUARE_CLIENT_SECRET
  if (!appId || !clientSecret) {
    return c.html('<html><body><p>Square not configured on server. Contact support.</p></body></html>')
  }

  try {
    // Exchange code for access token
    const redirectUri = `${new URL(c.req.url).origin}/api/square/oauth/callback`
    const tokenRes = await fetch(`${SQUARE_OAUTH_BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Square-Version': SQUARE_API_VERSION },
      body: JSON.stringify({
        client_id: appId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      })
    })
    const tokenData = await tokenRes.json() as any
    if (!tokenData.access_token) {
      return c.html(`<html><body><script>window.opener?.postMessage({type:'square_oauth_error',error:'Token exchange failed'}, '*'); window.close();</script><p>Authorization failed. Please try again.</p></body></html>`)
    }

    // Fetch merchant profile
    const merchantRes = await fetch(`${SQUARE_OAUTH_BASE}/v2/merchants/me`, {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Square-Version': SQUARE_API_VERSION }
    })
    const merchantData = await merchantRes.json() as any
    const merchant = merchantData.merchant
    const merchantId = merchant?.id || tokenData.merchant_id || ''
    const merchantName = merchant?.business_name || merchant?.country || ''

    // Get first location ID
    let locationId = ''
    try {
      const locRes = await fetch(`${SQUARE_OAUTH_BASE}/v2/locations`, {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Square-Version': SQUARE_API_VERSION }
      })
      const locData = await locRes.json() as any
      const activeLoc = (locData.locations || []).find((l: any) => l.status === 'ACTIVE')
      locationId = activeLoc?.id || locData.locations?.[0]?.id || ''
    } catch (_) {}

    const expiresAt = tokenData.expires_at || null

    // Save tokens to customer record
    await c.env.DB.prepare(`
      UPDATE customers SET
        square_merchant_id = ?,
        square_merchant_access_token = ?,
        square_merchant_refresh_token = ?,
        square_merchant_token_expires_at = ?,
        square_merchant_location_id = ?,
        square_merchant_name = ?,
        square_merchant_connected_at = datetime('now'),
        updated_at = datetime('now')
      WHERE id = ?
    `).bind(merchantId, tokenData.access_token, tokenData.refresh_token || '', expiresAt, locationId, merchantName, customerId).run()

    return c.html(`<html><body><script>
      window.opener?.postMessage({type:'square_oauth_success',merchant_id:'${merchantId}',merchant_name:'${merchantName.replace(/'/g, '')}'}, '*');
      window.close();
    </script><p>Square account connected successfully! You can close this window.</p></body></html>`)
  } catch (err: any) {
    return c.html(`<html><body><script>window.opener?.postMessage({type:'square_oauth_error',error:'${err.message?.replace(/'/g,'')}'}, '*'); window.close();</script><p>Error: ${err.message}</p></body></html>`)
  }
})

// GET /oauth/status — Check if customer has connected Square merchant
squareRoutes.get('/oauth/status', async (c) => {
  const token = getCustomerSessionToken(c)
  const customer = await getCustomerFromToken(c.env.DB, token)
  if (!customer) return c.json({ error: 'Not authenticated' }, 401)

  const cid = customer.customer_id || customer.id
  const row = await c.env.DB.prepare(`
    SELECT square_merchant_id, square_merchant_name, square_merchant_location_id, square_merchant_connected_at
    FROM customers WHERE id = ?
  `).bind(cid).first<any>()

  const connected = !!(row?.square_merchant_id)
  return c.json({
    connected,
    merchant_id: row?.square_merchant_id || null,
    merchant_name: row?.square_merchant_name || null,
    location_id: row?.square_merchant_location_id || null,
    connected_at: row?.square_merchant_connected_at || null,
    app_configured: !!(c.env.SQUARE_APPLICATION_ID && (c.env as any).SQUARE_CLIENT_SECRET),
  })
})

// POST /oauth/disconnect — Remove customer's Square merchant connection
squareRoutes.post('/oauth/disconnect', async (c) => {
  const token = getCustomerSessionToken(c)
  const customer = await getCustomerFromToken(c.env.DB, token)
  if (!customer) return c.json({ error: 'Not authenticated' }, 401)

  const cid = customer.customer_id || customer.id
  try {
    await c.env.DB.prepare(`
      UPDATE customers SET
        square_merchant_id = NULL, square_merchant_access_token = NULL,
        square_merchant_refresh_token = NULL, square_merchant_token_expires_at = NULL,
        square_merchant_location_id = NULL, square_merchant_name = NULL,
        square_merchant_connected_at = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).bind(cid).run()
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: 'Failed to disconnect', details: err.message }, 500)
  }
})

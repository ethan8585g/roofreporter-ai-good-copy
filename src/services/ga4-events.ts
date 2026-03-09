// ============================================================
// GA4 Server-Side Event Tracking via Measurement Protocol
// Fires events from the backend so they appear in GA4 even
// when the client-side gtag.js isn't present (e.g., API calls,
// webhooks, background jobs).
// ============================================================

const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect'

interface GA4EventParams {
  [key: string]: string | number | boolean | undefined
}

interface GA4Event {
  name: string
  params?: GA4EventParams
}

interface SendGA4EventOptions {
  measurementId: string
  apiSecret: string
  clientId?: string
  userId?: string
  events: GA4Event[]
}

/**
 * Send one or more events to GA4 via the Measurement Protocol.
 * Non-blocking — swallows errors so it never disrupts the main flow.
 */
export async function sendGA4Event(opts: SendGA4EventOptions): Promise<boolean> {
  try {
    const url = `${GA4_ENDPOINT}?measurement_id=${opts.measurementId}&api_secret=${opts.apiSecret}`
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({
        client_id: opts.clientId || `server_${Date.now()}`,
        user_id: opts.userId || undefined,
        events: opts.events.slice(0, 25) // GA4 max 25 events per batch
      })
    })
    return res.status === 204 || res.status === 200
  } catch (e: any) {
    console.error('[GA4-MP] Event send error:', e.message)
    return false
  }
}

/**
 * Helper: fire a single named event with params.
 * Requires GA4_MEASUREMENT_ID and GA4_API_SECRET in env.
 * Silently no-ops if either is missing.
 */
export function trackGA4(
  env: { GA4_MEASUREMENT_ID?: string; GA4_API_SECRET?: string; [k: string]: any },
  eventName: string,
  params: GA4EventParams = {},
  userId?: string
): Promise<boolean> {
  const mid = (env as any).GA4_MEASUREMENT_ID
  const secret = (env as any).GA4_API_SECRET
  if (!mid || !secret) return Promise.resolve(false) // not configured — skip

  return sendGA4Event({
    measurementId: mid,
    apiSecret: secret,
    clientId: `server_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    userId,
    events: [{
      name: eventName,
      params: {
        ...params,
        event_source: 'server',
        timestamp: new Date().toISOString()
      }
    }]
  })
}

// ── Convenience wrappers for common backend events ──

export function trackReportGenerated(
  env: any,
  orderId: string,
  extra: GA4EventParams = {}
): Promise<boolean> {
  return trackGA4(env, 'report_generated', {
    order_id: orderId,
    category: 'report',
    ...extra
  })
}

export function trackReportEnhanced(
  env: any,
  orderId: string,
  extra: GA4EventParams = {}
): Promise<boolean> {
  return trackGA4(env, 'report_enhanced', {
    order_id: orderId,
    category: 'report',
    ...extra
  })
}

export function trackPaymentCompleted(
  env: any,
  orderId: string,
  amountCents: number,
  extra: GA4EventParams = {}
): Promise<boolean> {
  return trackGA4(env, 'payment_completed', {
    order_id: orderId,
    value: amountCents / 100,
    currency: 'CAD',
    category: 'payment',
    ...extra
  })
}

export function trackEmailSent(
  env: any,
  emailType: string,
  recipient: string,
  extra: GA4EventParams = {}
): Promise<boolean> {
  return trackGA4(env, 'email_sent', {
    email_type: emailType,
    recipient_domain: recipient.split('@')[1] || 'unknown',
    category: 'email',
    ...extra
  })
}

export function trackUserSignup(
  env: any,
  userId: string,
  method: string = 'email',
  extra: GA4EventParams = {}
): Promise<boolean> {
  return trackGA4(env, 'sign_up', {
    method,
    category: 'user',
    ...extra
  }, userId)
}

export function trackCreditPurchase(
  env: any,
  userId: string,
  credits: number,
  amountCents: number,
  extra: GA4EventParams = {}
): Promise<boolean> {
  return trackGA4(env, 'credit_purchase', {
    credits,
    value: amountCents / 100,
    currency: 'CAD',
    category: 'payment',
    ...extra
  }, userId)
}

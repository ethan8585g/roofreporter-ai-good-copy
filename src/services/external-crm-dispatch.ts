// ============================================================
// External CRM Dispatch Service
// On report finalization, POST a stable JSON payload to every
// enabled customer_api_connections row for the order's owner.
// Modeled on src/services/api-webhook.ts (HMAC + retry schedule).
// ============================================================

import type { Bindings } from '../types'

const RETRY_DELAYS_SECONDS = [0, 30, 300, 1800, 7200, 43200]
const MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length
const REQUEST_TIMEOUT_MS = 10_000

// ── AES-GCM helpers (key derived from JWT_SECRET via SHA-256) ────────────

async function deriveKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const hash = await crypto.subtle.digest('SHA-256', enc.encode(secret))
  return crypto.subtle.importKey('raw', hash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

function bytesToB64(b: Uint8Array): string {
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s)
}

function b64ToBytes(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function encryptApiKey(secret: string, plaintext: string): Promise<{ cipher: string; iv: string; hint: string }> {
  const key = await deriveKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const enc = new TextEncoder()
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)))
  const hint = plaintext.length <= 4 ? '••••' : '••••' + plaintext.slice(-4)
  return { cipher: bytesToB64(ct), iv: bytesToB64(iv), hint }
}

export async function decryptApiKey(secret: string, cipherB64: string, ivB64: string): Promise<string> {
  const key = await deriveKey(secret)
  const iv = b64ToBytes(ivB64)
  const ct = b64ToBytes(cipherB64)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct)
  return new TextDecoder().decode(pt)
}

// ── HMAC body signature (lets receiver verify integrity) ─────────────────

async function signBody(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder()
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(body))
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  return `sha256=${hex}`
}

// ── SSRF guard for outbound URLs ─────────────────────────────────────────

export function isSafeOutboundUrl(raw: string): { ok: boolean; reason?: string } {
  let u: URL
  try { u = new URL(raw) } catch { return { ok: false, reason: 'Invalid URL' } }
  if (u.protocol !== 'https:') return { ok: false, reason: 'HTTPS required' }
  const host = u.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return { ok: false, reason: 'Localhost not allowed' }
  // Reject IPv4 literals in private/loopback/link-local space
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    if (a === 10 || a === 127 || a === 0) return { ok: false, reason: 'Private/loopback IP not allowed' }
    if (a === 169 && b === 254) return { ok: false, reason: 'Link-local IP not allowed' }
    if (a === 172 && b >= 16 && b <= 31) return { ok: false, reason: 'Private IP not allowed' }
    if (a === 192 && b === 168) return { ok: false, reason: 'Private IP not allowed' }
  }
  // Reject IPv6 loopback / link-local literal
  if (host === '[::1]' || host.startsWith('[fe80:') || host.startsWith('[fc') || host.startsWith('[fd')) {
    return { ok: false, reason: 'IPv6 private/loopback not allowed' }
  }
  return { ok: true }
}

// ── Payload builder ──────────────────────────────────────────────────────

function buildPayload(orderId: string, order: any, report: any): any {
  const raw = (() => { try { return JSON.parse(report.api_response_raw || '{}') } catch { return {} } })()
  const origin = 'https://www.roofmanager.ca'
  return {
    event: 'report.ready',
    timestamp: Math.floor(Date.now() / 1000),
    order_id: String(orderId),
    order_number: order.order_number || `RM-${orderId}`,
    property: {
      address: order.property_address || raw?.property?.address || null,
      city: order.property_city || raw?.property?.city || null,
      province: order.property_province || raw?.property?.province || null,
      postal_code: order.property_postal_code || raw?.property?.postal_code || null,
      latitude: order.latitude ?? raw?.property?.latitude ?? null,
      longitude: order.longitude ?? raw?.property?.longitude ?? null,
      homeowner_name: order.homeowner_name || null,
      homeowner_email: order.homeowner_email || null,
      homeowner_phone: order.homeowner_phone || null,
    },
    measurements: {
      total_footprint_sqft: raw?.total_footprint_sqft ?? report.roof_footprint_sqft ?? null,
      total_true_area_sqft: raw?.total_true_area_sqft ?? report.roof_area_sqft ?? null,
      roof_pitch_degrees: raw?.roof_pitch_degrees ?? report.roof_pitch_degrees ?? null,
      gross_squares: raw?.gross_squares ?? report.gross_squares ?? null,
      complexity_class: raw?.complexity_class ?? report.complexity_class ?? null,
      edge_summary: raw?.edge_summary ?? null,
    },
    links: {
      report_html: `${origin}/api/reports/${orderId}/html`,
      report_pdf: `${origin}/api/reports/${orderId}/pdf`,
      customer_view: `${origin}/customer/reports/${orderId}`,
    },
    raw,
  }
}

// ── Single-attempt POST ──────────────────────────────────────────────────

interface DispatchResult { ok: boolean; statusCode?: number; error?: string }

async function postOnce(url: string, headers: Record<string, string>, body: string): Promise<DispatchResult> {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
      redirect: 'error',
    })
    clearTimeout(t)
    return { ok: res.ok, statusCode: res.status }
  } catch (err: any) {
    clearTimeout(t)
    return { ok: false, error: err?.message ?? 'Unknown error' }
  }
}

async function buildHeaders(apiKey: string, authHeader: string, authPrefix: string, body: string): Promise<Record<string, string>> {
  const sig = await signBody(apiKey, body)
  return {
    'Content-Type': 'application/json',
    [authHeader || 'Authorization']: (authPrefix || '') + apiKey,
    'X-RoofManager-Signature': sig,
    'X-RoofManager-Event': 'report.ready',
    'User-Agent': 'RoofManager-CRM/1.0',
  }
}

// ── Per-connection delivery (with retry, persists status to DB) ──────────

async function deliverToConnection(
  env: Bindings,
  conn: any,
  orderId: string,
  customerId: number,
  payload: any,
  deliveryId: number,
  attempt = 0
): Promise<void> {
  if (attempt >= MAX_ATTEMPTS) return

  const wait = RETRY_DELAYS_SECONDS[attempt] * 1000
  if (wait > 0) await new Promise(r => setTimeout(r, wait))

  let apiKey: string
  try {
    apiKey = await decryptApiKey(env.JWT_SECRET, conn.api_key_cipher, conn.api_key_iv)
  } catch (e: any) {
    await env.DB.prepare(
      `UPDATE customer_api_deliveries SET status='failed', attempts=?, last_attempt_at=datetime('now'), error_message=? WHERE id=?`
    ).bind(attempt + 1, `decrypt_error: ${e?.message || 'unknown'}`, deliveryId).run().catch(() => {})
    return
  }

  const body = JSON.stringify(payload)
  const headers = await buildHeaders(apiKey, conn.auth_header, conn.auth_prefix, body)
  const result = await postOnce(conn.endpoint_url, headers, body)
  const newAttempts = attempt + 1

  if (result.ok) {
    await env.DB.prepare(
      `UPDATE customer_api_deliveries SET status='delivered', http_status=?, attempts=?, last_attempt_at=datetime('now'), delivered_at=datetime('now'), error_message=NULL WHERE id=?`
    ).bind(result.statusCode ?? 200, newAttempts, deliveryId).run().catch(() => {})
    console.log(`[CRM-Dispatch] order ${orderId} → conn ${conn.id} delivered on attempt ${newAttempts} (${result.statusCode})`)
    return
  }

  await env.DB.prepare(
    `UPDATE customer_api_deliveries SET status='failed', http_status=?, attempts=?, last_attempt_at=datetime('now'), error_message=? WHERE id=?`
  ).bind(result.statusCode ?? null, newAttempts, (result.error || `HTTP ${result.statusCode}`).slice(0, 500), deliveryId).run().catch(() => {})

  console.warn(`[CRM-Dispatch] order ${orderId} → conn ${conn.id} attempt ${newAttempts} failed: ${result.error || result.statusCode}`)

  if (newAttempts < MAX_ATTEMPTS) {
    deliverToConnection(env, conn, orderId, customerId, payload, deliveryId, newAttempts)
      .catch(err => console.error('[CRM-Dispatch] retry error', err))
  }
}

// ── Public API ───────────────────────────────────────────────────────────

export async function dispatchReportToExternalCRMs(
  env: Bindings,
  orderId: string | number,
  customerId: number,
  _ctx?: ExecutionContext
): Promise<void> {
  if (!customerId) return
  const oid = String(orderId)

  const conns = await env.DB.prepare(
    `SELECT id, customer_id, name, provider, endpoint_url, api_key_cipher, api_key_iv, auth_header, auth_prefix
     FROM customer_api_connections WHERE customer_id = ? AND enabled = 1`
  ).bind(customerId).all<any>()

  const list = conns.results || []
  if (list.length === 0) return

  const order = await env.DB.prepare(
    `SELECT id, order_number, property_address, property_city, property_province, property_postal_code,
            latitude, longitude, homeowner_name, homeowner_email, homeowner_phone, customer_id
     FROM orders WHERE id = ?`
  ).bind(oid).first<any>()
  if (!order) return

  const report = await env.DB.prepare(
    `SELECT api_response_raw, roof_area_sqft, roof_footprint_sqft, roof_pitch_degrees, gross_squares, complexity_class
     FROM reports WHERE order_id = ?`
  ).bind(oid).first<any>()
  if (!report) return

  const payload = buildPayload(oid, order, report)

  for (const conn of list) {
    // Idempotency: insert pending row if missing. If a 'delivered' row already
    // exists for (order_id, connection_id), skip — protects against duplicate
    // posts on report regeneration.
    const existing = await env.DB.prepare(
      `SELECT id, status FROM customer_api_deliveries WHERE order_id = ? AND connection_id = ?`
    ).bind(oid, conn.id).first<any>()

    let deliveryId: number
    if (existing) {
      if (existing.status === 'delivered') {
        console.log(`[CRM-Dispatch] order ${oid} → conn ${conn.id} already delivered; skipping`)
        continue
      }
      deliveryId = Number(existing.id)
      await env.DB.prepare(
        `UPDATE customer_api_deliveries SET status='pending', error_message=NULL WHERE id=?`
      ).bind(deliveryId).run().catch(() => {})
    } else {
      const ins = await env.DB.prepare(
        `INSERT INTO customer_api_deliveries (connection_id, order_id, customer_id, status, attempts) VALUES (?, ?, ?, 'pending', 0)`
      ).bind(conn.id, oid, customerId).run()
      deliveryId = Number(ins.meta?.last_row_id) || 0
      if (!deliveryId) continue
    }

    deliverToConnection(env, conn, oid, customerId, payload, deliveryId, 0)
      .catch(err => console.error(`[CRM-Dispatch] dispatch error conn ${conn.id}:`, err))
  }
}

// ── Test-button helper (single attempt, synchronous) ─────────────────────

export async function testCRMConnection(
  env: Bindings,
  connectionId: number,
  customerId: number
): Promise<{ ok: boolean; statusCode?: number; error?: string; durationMs: number }> {
  const conn = await env.DB.prepare(
    `SELECT id, endpoint_url, api_key_cipher, api_key_iv, auth_header, auth_prefix
     FROM customer_api_connections WHERE id = ? AND customer_id = ?`
  ).bind(connectionId, customerId).first<any>()
  if (!conn) return { ok: false, error: 'Connection not found', durationMs: 0 }

  const apiKey = await decryptApiKey(env.JWT_SECRET, conn.api_key_cipher, conn.api_key_iv)
  const payload = {
    event: 'connection.test',
    timestamp: Math.floor(Date.now() / 1000),
    message: 'This is a test ping from Roof Manager. If you can see this, your CRM connection is wired up correctly.',
  }
  const body = JSON.stringify(payload)
  const headers = await buildHeaders(apiKey, conn.auth_header, conn.auth_prefix, body)

  const t0 = Date.now()
  const res = await postOnce(conn.endpoint_url, headers, body)
  return { ...res, durationMs: Date.now() - t0 }
}

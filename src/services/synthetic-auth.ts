// Synthetic auth for the loop scanner. We don't store the user's real
// password as a secret; instead the scanner mints a *short-lived* session
// directly in admin_sessions / customer_sessions for the user identified
// by SCAN_ADMIN_EMAIL / SCAN_CUSTOMER_EMAIL. Sessions are deleted right
// after the scan finishes.

import type { Bindings } from '../types'

const SESSION_TTL_MS = 5 * 60 * 1000 // 5 minutes — long enough for one scan

export async function issueScanAdminJWT(env: Bindings): Promise<string> {
  const email = (env as any).SCAN_ADMIN_EMAIL
  if (!email) throw new Error('SCAN_ADMIN_EMAIL secret not set')
  const row = await env.DB.prepare(
    `SELECT id FROM admin_users WHERE email = ? AND is_active = 1 LIMIT 1`
  ).bind(email).first<{ id: number }>()
  if (!row) throw new Error(`Admin user not found for SCAN_ADMIN_EMAIL=${email}`)
  const token = mintToken('scan-admin')
  await env.DB.prepare(
    `INSERT INTO admin_sessions (admin_id, session_token, expires_at) VALUES (?, ?, ?)`
  ).bind(row.id, token, new Date(Date.now() + SESSION_TTL_MS).toISOString()).run()
  return token
}

export async function issueScanCustomerJWT(env: Bindings): Promise<string> {
  const email = (env as any).SCAN_CUSTOMER_EMAIL
  if (!email) throw new Error('SCAN_CUSTOMER_EMAIL secret not set')
  const row = await env.DB.prepare(
    `SELECT id FROM customers WHERE email = ? LIMIT 1`
  ).bind(email).first<{ id: number }>()
  if (!row) throw new Error(`Customer not found for SCAN_CUSTOMER_EMAIL=${email}`)
  const token = mintToken('scan-customer')
  await env.DB.prepare(
    `INSERT INTO customer_sessions (customer_id, session_token, expires_at) VALUES (?, ?, ?)`
  ).bind(row.id, token, new Date(Date.now() + SESSION_TTL_MS).toISOString()).run()
  return token
}

// Delete all scan-prefixed sessions older than 1 hour. Called opportunistically.
export async function pruneExpiredScanSessions(env: Bindings): Promise<void> {
  try {
    await env.DB.prepare(
      `DELETE FROM admin_sessions WHERE session_token LIKE 'scan-%' AND expires_at < datetime('now')`
    ).run()
    await env.DB.prepare(
      `DELETE FROM customer_sessions WHERE session_token LIKE 'scan-%' AND expires_at < datetime('now')`
    ).run()
  } catch {}
}

function mintToken(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}-${crypto.randomUUID()}`
}

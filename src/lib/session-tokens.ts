// Shared session-token extractors. P1-31 cookie-auth infrastructure.
//
// Every route file that does its own session lookup used to read the token
// exclusively from `Authorization: Bearer …`. Clients reading that header
// from localStorage are vulnerable to XSS exfiltration; we prefer HttpOnly
// cookies. These helpers accept either source so the client can migrate
// off localStorage without a big-bang flag day.

import type { Context } from 'hono'

export const ADMIN_SESSION_COOKIE = 'rm_admin_session'
export const CUSTOMER_SESSION_COOKIE = 'rm_customer_session'

function readCookieValue(cookieHeader: string | undefined | null, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(/;\s*/)) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1))
  }
  return null
}

function extractBearerOrCookie(c: Context, cookieName: string): string | null {
  const auth = c.req.header('Authorization')
  // Tolerate `Bearer ` (empty token) — happens when the client does
  // `'Bearer ' + localStorage.getItem(key)` and the key is missing. Fall
  // through to the cookie lookup in that case.
  if (auth && auth.startsWith('Bearer ')) {
    const t = auth.slice(7).trim()
    if (t) return t
  }
  return readCookieValue(c.req.header('Cookie'), cookieName)
}

/**
 * Get the customer-session token from Authorization: Bearer (legacy) OR
 * the `rm_customer_session` HttpOnly cookie (P0-05). Returns null if
 * neither is present.
 */
export function getCustomerSessionToken(c: Context): string | null {
  return extractBearerOrCookie(c, CUSTOMER_SESSION_COOKIE)
}

/**
 * Same, for the admin surface — Authorization: Bearer OR
 * `rm_admin_session` cookie.
 */
export function getAdminSessionToken(c: Context): string | null {
  return extractBearerOrCookie(c, ADMIN_SESSION_COOKIE)
}

/**
 * Convenience: look up the current customer_id for a request. Accepts
 * either token source. Returns null when no session matches.
 */
export async function requireCustomerId(c: Context): Promise<number | null> {
  const token = getCustomerSessionToken(c)
  if (!token) return null
  const db = (c.env as any).DB as D1Database
  const row = await db.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<{ customer_id: number }>()
  return row?.customer_id ?? null
}

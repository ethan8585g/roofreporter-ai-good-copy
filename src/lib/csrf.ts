// Double-submit cookie CSRF protection.
//
// Flow:
//   - On session creation, issue a non-HttpOnly `rm_csrf` cookie alongside the
//     HttpOnly `rm_session` cookie.
//   - Client JS reads the CSRF cookie and echoes it in the `X-RM-CSRF` header
//     on every state-changing request.
//   - Middleware compares header to cookie; mismatch → 403.
//
// Safe methods (GET/HEAD/OPTIONS) are exempt. Bearer-token API calls
// (programmatic developer-portal keys) are exempt — CSRF only matters for
// browser cookie auth.

import type { Context, MiddlewareHandler } from 'hono'

export const CSRF_COOKIE = 'rm_csrf'
export const CSRF_HEADER = 'x-rm-csrf'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function generateCsrfToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function readCookie(c: Context, name: string): string | null {
  const raw = c.req.header('cookie') || ''
  for (const part of raw.split(/;\s*/)) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1))
  }
  return null
}

// Timing-safe equality on the CSRF comparison.
function eq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export const csrfMiddleware: MiddlewareHandler = async (c, next) => {
  if (SAFE_METHODS.has(c.req.method)) return next()
  // Bearer-token API clients bypass CSRF (no cookie → no CSRF attack surface).
  const auth = c.req.header('authorization') || ''
  if (auth.startsWith('Bearer ')) return next()

  const cookieTok = readCookie(c, CSRF_COOKIE)
  const headerTok = c.req.header(CSRF_HEADER) || ''
  if (!cookieTok || !headerTok || !eq(cookieTok, headerTok)) {
    return c.json({ error: 'CSRF token missing or invalid' }, 403)
  }
  return next()
}

// Cookie attribute builder for a CSRF cookie (non-HttpOnly so JS can read it).
export function csrfCookieAttrs(token: string, maxAgeSeconds: number): string {
  return `${CSRF_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax; Secure`
}

// Make a CSRF middleware gated on the presence of a specific session-cookie name.
// Use case: customerAuthRoutes mounts pre-auth endpoints (login/register/etc) on
// the same router as authenticated state-change endpoints. Pre-auth requests
// have no session cookie → no CSRF attack surface → bypass. Authenticated
// requests carrying the session cookie are enforced.
export function makeCsrfMiddleware(sessionCookieName: string): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next()
    // Bearer-token API clients bypass CSRF (no cookie → no CSRF attack surface).
    const auth = c.req.header('authorization') || ''
    if (auth.startsWith('Bearer ')) return next()
    // No session cookie present = pre-auth request (login, register, etc.) — bypass.
    const cookieHeader = c.req.header('cookie') || ''
    if (!cookieHeader.includes(`${sessionCookieName}=`)) return next()

    const cookieTok = readCookie(c, CSRF_COOKIE)
    const headerTok = c.req.header(CSRF_HEADER) || ''
    if (!cookieTok || !headerTok || !eq(cookieTok, headerTok)) {
      return c.json({ error: 'CSRF token missing or invalid' }, 403)
    }
    return next()
  }
}

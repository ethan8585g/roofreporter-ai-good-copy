// KV-backed sliding-window rate limiter. Safe to call when KV is not bound;
// in that case it no-ops and returns `ok: true`.
//
// Scope: use for unauthenticated endpoints (login, password reset, analytics
// track, forgot-password) where the attacker can't be identified by user id.

import type { Context } from 'hono'

export type RateLimitResult = { ok: boolean; remaining: number; resetSeconds: number }

export function clientIp(c: Context): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-real-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    '0.0.0.0'
  )
}

// Attempt one request against a sliding window. Returns ok=false with the
// reset time when the limit is hit. Counts are stored as JSON { hits: [ts...] }.
export async function rateLimit(
  kv: KVNamespace | undefined,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  if (!kv) return { ok: true, remaining: limit, resetSeconds: 0 }
  const now = Math.floor(Date.now() / 1000)
  const cutoff = now - windowSeconds
  let hits: number[] = []
  try {
    const raw = await kv.get(key)
    if (raw) {
      const parsed = JSON.parse(raw) as { hits?: number[] }
      hits = (parsed.hits || []).filter((t) => t > cutoff)
    }
  } catch {
    hits = []
  }
  if (hits.length >= limit) {
    const oldest = hits[0]
    return { ok: false, remaining: 0, resetSeconds: Math.max(1, oldest + windowSeconds - now) }
  }
  hits.push(now)
  try {
    await kv.put(key, JSON.stringify({ hits }), { expirationTtl: windowSeconds + 60 })
  } catch {
    // KV write failures should not block legitimate traffic.
  }
  return { ok: true, remaining: limit - hits.length, resetSeconds: windowSeconds }
}

// Convenience: rate-limit by IP + endpoint label.
export async function limitByIp(
  c: Context,
  label: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const kv = (c.env as any).RATE_LIMIT_KV || (c.env as any).KV || undefined
  return rateLimit(kv, `rl:${label}:${clientIp(c)}`, limit, windowSeconds)
}

export async function limitByKey(
  c: Context,
  label: string,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  const kv = (c.env as any).RATE_LIMIT_KV || (c.env as any).KV || undefined
  return rateLimit(kv, `rl:${label}:${key}`, limit, windowSeconds)
}

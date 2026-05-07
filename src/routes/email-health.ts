// ============================================================
// EMAIL HEALTH MONITOR — Gmail OAuth2 token-mint probe.
// ============================================================
// Roof Manager has no Resend fallback configured — Gmail OAuth2 is the
// sole working transport. The actual silent-failure mode is: refresh
// token gets revoked / expires / loses scope, and customer/admin emails
// vanish without a peep.
//
// This endpoint exercises the same path every send takes: load creds via
// loadGmailCreds() (env first, D1 fallback), then exchange the refresh
// token for an access token. If the mint fails, the transport is dead —
// queue an URGENT super-admin notification.
//
// Auth: shares FUNNEL_MONITOR_TOKEN with the funnel-monitor loop. Same
// bearer, same /loop pattern. Wrap with `/loop 6h /gmail-health` for a
// recurring health probe.

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { loadGmailCreds } from '../services/email'

export const emailHealthRoutes = new Hono<{ Bindings: Bindings }>()

interface HealthResult {
  healthy: boolean
  checked_at: string
  creds: {
    client_id: 'present' | 'missing'
    client_secret: 'env' | 'db' | 'missing'
    refresh_token: 'env' | 'db' | 'missing'
    sender_email: 'env' | 'db' | 'missing'
  }
  token_mint: {
    ok: boolean
    status: number | null
    expires_in_s: number | null
    scope: string | null
    error: string | null
  }
  alert_id: number | null
  notes: string[]
}

emailHealthRoutes.use('*', async (c, next) => {
  const expected = c.env.FUNNEL_MONITOR_TOKEN
  if (!expected) {
    return c.json({ error: 'FUNNEL_MONITOR_TOKEN is not configured on the server' }, 503)
  }
  const auth = c.req.header('Authorization') || ''
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!presented || presented !== expected) {
    return c.json({ error: 'unauthorized' }, 401)
  }
  return next()
})

emailHealthRoutes.post('/tick', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { dry_run?: boolean }
  const dryRun = body.dry_run === true

  const result = await probeGmailHealth(c.env)

  if (!result.healthy && !dryRun) {
    result.alert_id = await queueEmailHealthAlert(c.env, result)
  }

  return c.json(result)
})

async function probeGmailHealth(env: Bindings): Promise<HealthResult> {
  const checkedAt = new Date().toISOString()
  const notes: string[] = []

  // Step 1: resolve creds (mirror what every send path does).
  const creds = await loadGmailCreds(env as any)
  const credsSummary = {
    client_id: (creds.clientId ? 'present' : 'missing') as 'present' | 'missing',
    client_secret: creds.source.clientSecret,
    refresh_token: creds.source.refreshToken,
    sender_email: creds.source.senderEmail,
  }

  if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
    notes.push('one or more Gmail OAuth2 creds are missing — sends will fail')
    return {
      healthy: false,
      checked_at: checkedAt,
      creds: credsSummary,
      token_mint: { ok: false, status: null, expires_in_s: null, scope: null, error: 'creds_missing' },
      alert_id: null,
      notes,
    }
  }

  // Step 2: try to mint an access token. This is the same exchange every
  // sendGmailOAuth2() call performs — if it fails, sends fail.
  let mintStatus: number | null = null
  let mintBody: any = null
  let mintError: string | null = null
  try {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(10000),
    })
    mintStatus = resp.status
    if (!resp.ok) {
      const text = await resp.text()
      mintError = text.slice(0, 480)
      notes.push(`token mint failed (${resp.status}): ${mintError}`)
    } else {
      mintBody = await resp.json().catch(() => ({}))
    }
  } catch (e: any) {
    mintError = String(e?.message || e).slice(0, 480)
    notes.push(`token mint network error: ${mintError}`)
  }

  const ok = mintStatus !== null && mintStatus >= 200 && mintStatus < 300 && mintBody && mintBody.access_token

  return {
    healthy: !!ok,
    checked_at: checkedAt,
    creds: credsSummary,
    token_mint: {
      ok: !!ok,
      status: mintStatus,
      expires_in_s: mintBody?.expires_in ?? null,
      scope: mintBody?.scope ?? null,
      error: mintError,
    },
    alert_id: null,
    notes,
  }
}

async function queueEmailHealthAlert(env: Bindings, result: HealthResult): Promise<number | null> {
  const orderNumber = `GMAIL-HEALTH-${result.checked_at.replace(/[^0-9]/g, '').slice(0, 12)}`
  try {
    const ins = await env.DB.prepare(`
      INSERT INTO super_admin_notifications (
        kind, order_number, property_address, severity, email_status, payload_json
      ) VALUES ('email_health', ?, ?, 'urgent', 'skipped', ?)
    `).bind(
      orderNumber,
      `Gmail OAuth2 transport unhealthy — ${result.token_mint.error || 'unknown error'}`,
      JSON.stringify({
        checked_at: result.checked_at,
        creds: result.creds,
        token_mint: result.token_mint,
        notes: result.notes,
      }),
    ).run()
    return (ins?.meta?.last_row_id as number) || null
  } catch (e: any) {
    console.error('[email-health] failed to insert health alert:', e?.message || e)
    return null
  }
}

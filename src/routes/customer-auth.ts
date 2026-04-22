import { Hono } from 'hono'
import type { Bindings } from '../types'
import { trackUserSignup, trackUserLogin } from '../services/ga4-events'
import { resolveTeamOwner } from './team'
import { hashPassword, verifyPassword, isLegacyHash, dummyVerify } from '../lib/password'
import { getCustomerSessionToken } from '../lib/session-tokens'

// P1-11: sanitize values before splicing into MIME headers. Strips CR/LF and
// control chars that could be used for header injection (inject Bcc, etc.).
function mimeHeader(v: string | undefined | null): string {
  return String(v ?? '').replace(/[\r\n\u0000-\u001F\u007F]/g, '').slice(0, 1000)
}

// P0-05: HttpOnly cookie name for customer sessions.
const CUSTOMER_SESSION_COOKIE = 'rm_customer_session'
function setCustomerSessionCookie(c: any, token: string, maxAgeSeconds: number) {
  c.header('Set-Cookie', `${CUSTOMER_SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`, { append: true })
}
function clearCustomerSessionCookie(c: any) {
  c.header('Set-Cookie', `${CUSTOMER_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`, { append: true })
}

export const customerAuthRoutes = new Hono<{ Bindings: Bindings }>()

// Seeds the 12 default material catalog items for a new account so users have
// context on what the Material Catalog section is for when they first open it.
async function seedDefaultMaterials(db: any, ownerId: number) {
  const defaults = [
    { category: 'shingles',      name: 'Architectural Shingles (Laminate)',    unit: 'bundles', unit_price: 42.00,  coverage_per_unit: '33 sq ft per bundle (3 bundles/square)', is_default: 1, sort_order: 1 },
    { category: 'shingles',      name: '3-Tab Standard Shingles',              unit: 'bundles', unit_price: 32.00,  coverage_per_unit: '33 sq ft per bundle (3 bundles/square)', is_default: 0, sort_order: 2 },
    { category: 'underlayment',  name: 'Synthetic Underlayment',               unit: 'rolls',   unit_price: 95.00,  coverage_per_unit: '400 sq ft per roll',                     is_default: 1, sort_order: 3 },
    { category: 'ice_shield',    name: 'Ice & Water Shield Membrane',          unit: 'rolls',   unit_price: 165.00, coverage_per_unit: '200 sq ft per roll',                     is_default: 1, sort_order: 4 },
    { category: 'starter',       name: 'Starter Strip Shingles',              unit: 'boxes',   unit_price: 45.00,  coverage_per_unit: '100 lin ft per box',                     is_default: 1, sort_order: 5 },
    { category: 'ridge_cap',     name: 'Ridge/Hip Cap Shingles',              unit: 'bundles', unit_price: 65.00,  coverage_per_unit: '35 lin ft per bundle',                   is_default: 1, sort_order: 6 },
    { category: 'drip_edge',     name: 'Aluminum Drip Edge (Type C/D)',       unit: 'pieces',  unit_price: 8.50,   coverage_per_unit: '10 ft per piece',                        is_default: 1, sort_order: 7 },
    { category: 'valley_metal',  name: 'W-Valley Flashing (Aluminum)',        unit: 'pieces',  unit_price: 22.00,  coverage_per_unit: '10 ft per piece',                        is_default: 1, sort_order: 8 },
    { category: 'nails',         name: 'Roofing Nails 1-1/4" Galvanized',    unit: 'boxes',   unit_price: 28.00,  coverage_per_unit: '5 lb box (~2 squares)',                  is_default: 1, sort_order: 9 },
    { category: 'ventilation',   name: 'Ridge Vent',                          unit: 'pieces',  unit_price: 22.00,  coverage_per_unit: '4 ft per piece',                         is_default: 1, sort_order: 10 },
    { category: 'custom',        name: 'Roofing Cement / Caulk',             unit: 'tubes',   unit_price: 8.50,   coverage_per_unit: '~1 tube per 5 squares',                  is_default: 1, sort_order: 11 },
    { category: 'custom',        name: 'Pipe Boot / Collar',                 unit: 'pieces',  unit_price: 18.00,  coverage_per_unit: '~2 per 1000 sq ft',                      is_default: 0, sort_order: 12 },
  ]
  for (const d of defaults) {
    await db.prepare(
      `INSERT INTO material_catalog (owner_id, category, name, unit, unit_price, coverage_per_unit, supplier, is_default, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(ownerId, d.category, d.name, d.unit, d.unit_price, d.coverage_per_unit, '', d.is_default, d.sort_order).run()
  }
}

// ============================================================
// DEV / TEST ACCOUNT — P0-04: source-level credential bypass removed.
// The dev account still exists in the DB (dev@reusecanada.ca) and logs in
// through the normal PBKDF2 path. `isDevAccount` is kept only to gate
// credit-grant side effects for that row when DEV_MODE is set.
// ============================================================
const DEV_ACCOUNT_EMAIL = 'dev@reusecanada.ca'

export function isDevAccount(email: string, env?: any): boolean {
  const devEnabled = env ? !!(env as any).DEV_MODE : false
  if (!devEnabled) return false
  return email.toLowerCase().trim() === DEV_ACCOUNT_EMAIL
}

function generateSessionToken(): string {
  return crypto.randomUUID() + '-' + crypto.randomUUID()
}

// ============================================================
// EMAIL VERIFICATION — 6-digit code sent to email before registration
// ============================================================

// P1-09: crypto.getRandomValues instead of Math.random
function generateVerificationCode(): string {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  const n = 100000 + (buf[0] % 900000)
  return n.toString()
}

// Send email using best available provider
// Priority: 1) Resend API  2) Gmail OAuth2 (env or DB token)  3) GCP service account
async function sendVerificationEmail(env: any, toEmail: string, code: string, db?: any): Promise<boolean> {
  const senderEmail = (env as any).GMAIL_SENDER_EMAIL || 'sales@roofmanager.ca'
  const emailSubject = `Your Roof Manager Verification Code: ${code}`
  const emailHtml = getVerificationEmailHTML(code)

  // ---- METHOD 1: Resend API (simplest) ----
  const resendKey = (env as any).RESEND_API_KEY
  if (resendKey) {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: `Roof Manager <onboarding@resend.dev>`,
          to: [toEmail],
          subject: emailSubject,
          html: emailHtml
        })
      })
      if (resp.ok) {
        console.log(`[Verification Email] Sent to ${toEmail} via Resend`)
        return true
      }
      console.error('[Verification Email] Resend failed:', await resp.text())
    } catch (e: any) {
      console.error('[Verification Email] Resend error:', e.message)
    }
  }

  // ---- METHOD 2: Gmail OAuth2 (check env vars first, then DB for stored credentials) ----
  let gmailRefreshToken = (env as any).GMAIL_REFRESH_TOKEN || ''
  const gmailClientId = (env as any).GMAIL_CLIENT_ID || ''
  let gmailClientSecret = (env as any).GMAIL_CLIENT_SECRET || ''

  // Check DB for stored credentials (from /api/auth/gmail/callback and /api/auth/gmail/setup)
  if (db) {
    if (!gmailRefreshToken) {
      try {
        const row = await db.prepare(
          "SELECT setting_value FROM settings WHERE setting_key = 'gmail_refresh_token' AND master_company_id = 1"
        ).first()
        if (row?.setting_value) {
          gmailRefreshToken = row.setting_value
          console.log('[Verification Email] Using Gmail refresh token from database')
        }
      } catch (e) { /* settings table might not exist yet */ }
    }
    if (!gmailClientSecret) {
      try {
        const row = await db.prepare(
          "SELECT setting_value FROM settings WHERE setting_key = 'gmail_client_secret' AND master_company_id = 1"
        ).first()
        if (row?.setting_value) {
          gmailClientSecret = row.setting_value
          console.log('[Verification Email] Using Gmail client secret from database')
        }
      } catch (e) { /* ignore */ }
    }
  }

  if (gmailRefreshToken && gmailClientId && gmailClientSecret) {
    try {
      // Get fresh access token
      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: gmailRefreshToken,
          client_id: gmailClientId,
          client_secret: gmailClientSecret
        }).toString()
      })
      const tokenData: any = await tokenResp.json()
      if (tokenData.access_token) {
        // P1-11: strip CR/LF from every splice to block header injection.
        const rawEmail = [
          `From: Roof Manager <${mimeHeader(senderEmail)}>`,
          `To: ${mimeHeader(toEmail)}`,
          `Subject: ${mimeHeader(emailSubject)}`,
          'Content-Type: text/html; charset=UTF-8',
          '',
          emailHtml
        ].join('\r\n')

        // Base64url encode
        const encoded = btoa(unescape(encodeURIComponent(rawEmail)))
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

        const sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: encoded })
        })
        if (sendResp.ok) {
          console.log(`[Verification Email] Sent to ${toEmail} via Gmail OAuth2`)
          return true
        }
        console.error('[Verification Email] Gmail send failed:', await sendResp.text())
      } else {
        console.error('[Verification Email] Gmail token exchange failed:', JSON.stringify(tokenData))
      }
    } catch (e: any) {
      console.error('[Verification Email] Gmail error:', e.message)
    }
  }

  // ---- METHOD 3: Gmail via GCP service account (requires Workspace domain-wide delegation) ----
  try {
    const gcpKeyStr = (env as any).GCP_SERVICE_ACCOUNT_KEY
    if (gcpKeyStr) {
      const gcpKey = typeof gcpKeyStr === 'string' ? JSON.parse(gcpKeyStr) : gcpKeyStr
      const saEmail = gcpKey.client_email
      const impersonateEmail = senderEmail

      // Create JWT for service account
      const header = { alg: 'RS256', typ: 'JWT' }
      const now = Math.floor(Date.now() / 1000)
      const claim = {
        iss: saEmail,
        sub: impersonateEmail,
        scope: 'https://www.googleapis.com/auth/gmail.send',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600
      }

      // Import private key
      const pemContents = gcpKey.private_key
        .replace('-----BEGIN PRIVATE KEY-----', '')
        .replace('-----END PRIVATE KEY-----', '')
        .replace(/\n/g, '')
      const keyData = Uint8Array.from(atob(pemContents), (c: string) => c.charCodeAt(0))
      const cryptoKey = await crypto.subtle.importKey('pkcs8', keyData, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])

      const toBase64Url = (data: string) => btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      const headerB64 = toBase64Url(JSON.stringify(header))
      const claimB64 = toBase64Url(JSON.stringify(claim))
      const signInput = `${headerB64}.${claimB64}`
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signInput))
      const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      const jwt = `${signInput}.${sigB64}`

      // Exchange JWT for access token
      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
      })
      const tokenData: any = await tokenResp.json()

      if (tokenData.access_token) {
        // P1-11: strip CR/LF from every splice to block header injection.
        const rawEmail = [
          `From: Roof Manager <${mimeHeader(impersonateEmail)}>`,
          `To: ${mimeHeader(toEmail)}`,
          `Subject: ${mimeHeader(emailSubject)}`,
          'Content-Type: text/html; charset=UTF-8',
          '',
          emailHtml
        ].join('\r\n')

        const encoded = btoa(unescape(encodeURIComponent(rawEmail)))
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

        const sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: encoded })
        })
        if (sendResp.ok) {
          console.log(`[Verification Email] Sent to ${toEmail} via GCP service account`)
          return true
        }
        console.error('[Verification Email] GCP Gmail send failed:', await sendResp.text())
      } else {
        console.error('[Verification Email] GCP token exchange failed:', JSON.stringify(tokenData))
      }
    }
  } catch (e: any) {
    console.error('[Verification Email] GCP service account error:', e.message)
  }

  console.error('[Verification Email] ALL methods failed for:', toEmail, '| Resend:', !!resendKey, '| Gmail OAuth2:', !!(gmailRefreshToken && gmailClientId), '| GCP:', !!(env as any).GCP_SERVICE_ACCOUNT_KEY)
  return false
}

function getVerificationEmailHTML(code: string): string {
  return `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
    <div style="text-align: center; margin-bottom: 32px;">
      <div style="display: inline-block; width: 48px; height: 48px; background: #0ea5e9; border-radius: 12px; line-height: 48px; text-align: center;">
        <span style="color: white; font-size: 24px;">&#127968;</span>
      </div>
      <h1 style="color: #1e3a5f; font-size: 24px; margin: 16px 0 4px;">Roof Manager</h1>
      <p style="color: #6b7280; font-size: 14px; margin: 0;">Email Verification</p>
    </div>
    <div style="background: #f8fafc; border-radius: 16px; padding: 32px; text-align: center;">
      <p style="color: #374151; font-size: 16px; margin: 0 0 24px;">Enter this code to verify your email and complete registration:</p>
      <div style="background: white; border: 2px solid #0ea5e9; border-radius: 12px; padding: 16px; display: inline-block; min-width: 200px;">
        <span style="font-family: 'Courier New', monospace; font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #1e3a5f;">${code}</span>
      </div>
      <p style="color: #9ca3af; font-size: 13px; margin: 24px 0 0;">This code expires in 10 minutes.<br>If you didn't request this, please ignore this email.</p>
    </div>
    <p style="color: #d1d5db; font-size: 11px; text-align: center; margin-top: 24px;">&copy; 2026 Roof Manager &middot; Alberta, Canada</p>
  </div>`
}

// ============================================================
// SEND VERIFICATION CODE — Step 1 of registration
// ============================================================
customerAuthRoutes.post('/send-verification', async (c) => {
  try {
    const { email } = await c.req.json()
    if (!email) return c.json({ error: 'Email is required' }, 400)

    const cleanEmail = email.toLowerCase().trim()

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return c.json({ error: 'Invalid email format' }, 400)
    }

    // Check if account already exists
    const existing = await c.env.DB.prepare(
      'SELECT id FROM customers WHERE email = ?'
    ).bind(cleanEmail).first()
    if (existing) {
      return c.json({ error: 'An account with this email already exists. Please sign in instead.' }, 409)
    }

    // Rate limit: max 1 code per email per 30 minutes (6-digit codes are brute-forceable,
    // so we also keep per-IP throttling at the signup endpoint).
    const recentCodes = await c.env.DB.prepare(
      "SELECT COUNT(*) as cnt FROM email_verification_codes WHERE email = ? AND used = 0 AND created_at > datetime('now', '-30 minutes')"
    ).bind(cleanEmail).first<any>()
    if (recentCodes && recentCodes.cnt >= 1) {
      return c.json({ error: 'A verification code was already sent recently. Please wait 30 minutes before requesting another.' }, 429)
    }
    // P1-10: tighter per-IP + per-email throttling to slow brute-force enumeration.
    // Global: 20 IP requests / hour. Per-email: 3 codes / hour. Lockout after
    // hitting the limit — no bypass via parallel emails from same IP.
    const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    try {
      await c.env.DB.prepare("CREATE TABLE IF NOT EXISTS verification_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT, email TEXT, created_at TEXT DEFAULT (datetime('now')))").run()
      const [ipAttempts, emailAttempts] = await Promise.all([
        c.env.DB.prepare("SELECT COUNT(*) as cnt FROM verification_attempts WHERE ip = ? AND created_at > datetime('now', '-1 hour')").bind(clientIp).first<any>(),
        c.env.DB.prepare("SELECT COUNT(*) as cnt FROM verification_attempts WHERE email = ? AND created_at > datetime('now', '-1 hour')").bind(cleanEmail).first<any>(),
      ])
      if ((ipAttempts && ipAttempts.cnt >= 20) || (emailAttempts && emailAttempts.cnt >= 3)) {
        return c.json({ error: 'Too many verification requests. Please wait an hour and try again.' }, 429)
      }
      await c.env.DB.prepare("INSERT INTO verification_attempts (ip, email) VALUES (?, ?)").bind(clientIp, cleanEmail).run()
    } catch (e: any) { console.warn('[verification] rate-limit check failed:', e?.message || e) }

    // Generate code
    const code = generateVerificationCode()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString() // 10 minutes

    // Invalidate previous codes for this email
    await c.env.DB.prepare(
      "UPDATE email_verification_codes SET used = 1 WHERE email = ? AND used = 0"
    ).bind(cleanEmail).run()

    // Store the new code
    await c.env.DB.prepare(
      'INSERT INTO email_verification_codes (email, code, expires_at) VALUES (?, ?, ?)'
    ).bind(cleanEmail, code, expiresAt).run()

    // Send email — pass DB so it can look up stored Gmail OAuth tokens
    const sent = await sendVerificationEmail(c.env, cleanEmail, code, c.env.DB)

    if (!sent) {
      // Clean up the stored code so the user can retry immediately without hitting the 30-min rate limit.
      // (Orphaned used=0 codes would otherwise block all retries for 30 minutes.)
      await c.env.DB.prepare(
        "DELETE FROM email_verification_codes WHERE email = ? AND used = 0 AND created_at > datetime('now', '-5 minutes')"
      ).bind(cleanEmail).run().catch(() => {})
      console.error(`[Verification] Email send failed for ${cleanEmail}`)
      return c.json({
        success: false,
        email_sent: false,
        error: 'We couldn\'t send your verification email right now. Please try again, or contact sales@roofmanager.ca if this continues.'
      }, 503)
    }

    return c.json({
      success: true,
      email_sent: true,
      message: `Verification code sent to ${cleanEmail}. Check your inbox (and spam folder).`
    })
  } catch (err: any) {
    console.error('[Verification] Error:', err.message)
    return c.json({ error: 'Failed to send verification code', details: err.message }, 500)
  }
})

// ============================================================
// VERIFY CODE — Step 2 of registration
// ============================================================
customerAuthRoutes.post('/verify-code', async (c) => {
  try {
    const { email, code } = await c.req.json()
    if (!email || !code) return c.json({ error: 'Email and verification code are required' }, 400)

    const cleanEmail = email.toLowerCase().trim()

    const record = await c.env.DB.prepare(
      "SELECT * FROM email_verification_codes WHERE email = ? AND code = ? AND used = 0 AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1"
    ).bind(cleanEmail, code.trim()).first<any>()

    if (!record) {
      return c.json({ error: 'Invalid or expired verification code. Please request a new one.' }, 400)
    }

    // Mark code as used
    await c.env.DB.prepare(
      'UPDATE email_verification_codes SET used = 1, verified_at = datetime(\'now\') WHERE id = ?'
    ).bind(record.id).run()

    // Generate a verification token (short-lived, used to complete registration)
    const verificationToken = crypto.randomUUID()
    await c.env.DB.prepare(
      'UPDATE email_verification_codes SET verification_token = ? WHERE id = ?'
    ).bind(verificationToken, record.id).run()

    return c.json({
      success: true,
      verified: true,
      verification_token: verificationToken,
      message: 'Email verified! You can now complete your registration.'
    })
  } catch (err: any) {
    return c.json({ error: 'Verification failed', details: err.message }, 500)
  }
})

// ============================================================
// GOOGLE SIGN-IN — Verify Google ID token and create/login customer
// ============================================================
customerAuthRoutes.post('/google', async (c) => {
  try {
    const { credential } = await c.req.json()
    
    if (!credential) {
      return c.json({ error: 'Google credential token required' }, 400)
    }

    // Decode Google ID token (JWT) — verify with Google's tokeninfo endpoint
    const verifyResp = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`)
    
    if (!verifyResp.ok) {
      return c.json({ error: 'Invalid Google token' }, 401)
    }

    const googleUser: any = await verifyResp.json()

    // Verify the token audience matches our client ID
    const clientId = (c.env as any).GOOGLE_OAUTH_CLIENT_ID || (c.env as any).GMAIL_CLIENT_ID
    if (clientId && googleUser.aud !== clientId) {
      return c.json({ error: 'Token audience mismatch' }, 401)
    }

    const email = googleUser.email?.toLowerCase().trim()
    const name = googleUser.name || email.split('@')[0]
    const googleId = googleUser.sub
    const avatar = googleUser.picture || ''

    if (!email || !googleId) {
      return c.json({ error: 'Invalid Google profile data' }, 400)
    }

    // Check if customer exists by google_id or email
    let customer = await c.env.DB.prepare(
      'SELECT * FROM customers WHERE google_id = ? OR email = ?'
    ).bind(googleId, email).first<any>()

    if (customer) {
      // Update existing customer with Google info
      await c.env.DB.prepare(`
        UPDATE customers SET 
          google_id = ?, google_avatar = ?, name = COALESCE(name, ?), 
          email_verified = 1, last_login = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).bind(googleId, avatar, name, customer.id).run()
    } else {
      // Create new customer with 4 free trial reports (NOT paid credits)
      const result = await c.env.DB.prepare(`
        INSERT INTO customers (email, name, google_id, google_avatar, email_verified, is_active, report_credits, credits_used, free_trial_total, free_trial_used, auto_invoice_enabled)
        VALUES (?, ?, ?, ?, 1, 1, 0, 0, 4, 0, 1)
      `).bind(email, name, googleId, avatar).run()

      customer = {
        id: result.meta.last_row_id,
        email, name, google_id: googleId, google_avatar: avatar,
        report_credits: 0, credits_used: 0,
        free_trial_total: 4, free_trial_used: 0,
        is_new_signup: true
      }

      // Log the free trial
      await c.env.DB.prepare(`
        INSERT INTO user_activity_log (company_id, action, details)
        VALUES (1, 'free_trial_granted', ?)
      `).bind(`4 free trial reports granted to ${email} (Google sign-in)`).run()

      // Seed default material catalog so new account has context on the section (non-blocking)
      seedDefaultMaterials(c.env.DB, customer.id as number).catch((e) => console.warn('[customer-auth] seedDefaultMaterials failed (google):', e?.message || e))

      // Track Google signup in GA4 (non-blocking)
      trackUserSignup(c.env as any, String(customer.id), 'google', { email_domain: email.split('@')[1] || 'unknown' }).catch((e) => console.warn('[customer-auth] GA4 trackUserSignup failed (google):', e?.message || e))
    }

    // Create session
    const token = generateSessionToken()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // P1-01: 7 days

    await c.env.DB.prepare(`
      INSERT INTO customer_sessions (customer_id, session_token, expires_at)
      VALUES (?, ?, ?)
    `).bind(customer.id, token, expiresAt).run()

    // P0-05: HttpOnly cookie on Google sign-in too.
    setCustomerSessionCookie(c, token, 7 * 24 * 60 * 60)

    // Log activity
    await c.env.DB.prepare(`
      INSERT INTO user_activity_log (company_id, action, details)
      VALUES (1, 'customer_google_login', ?)
    `).bind(`Customer ${email} signed in via Google`).run()

    const isNew = customer.is_new_signup || false
    const paidCreditsRemaining = (customer.report_credits || 0) - (customer.credits_used || 0)
    const freeTrialRemaining = (customer.free_trial_total || 4) - (customer.free_trial_used || 0)
    const totalRemaining = Math.max(0, freeTrialRemaining) + Math.max(0, paidCreditsRemaining)

    return c.json({
      success: true,
      // conv-v5: expose is_new so client can fire sign_up GA4/Meta events only once
      is_new: isNew,
      customer: {
        id: customer.id,
        email: customer.email || email,
        name: customer.name || name,
        company_name: customer.company_name,
        phone: customer.phone,
        google_avatar: customer.google_avatar || avatar,
        role: 'customer',
        credits_remaining: totalRemaining,
        free_trial_remaining: Math.max(0, freeTrialRemaining),
        free_trial_total: customer.free_trial_total || 4,
        paid_credits_remaining: Math.max(0, paidCreditsRemaining)
      },
      token,
      ...(isNew ? { welcome: true, message: 'Welcome! You have 4 free trial roof reports to get started.' } : {})
    })
  } catch (err: any) {
    return c.json({ error: 'Google sign-in failed', details: err.message }, 500)
  }
})

// ============================================================
// CUSTOMER REGISTER (email/password) — Requires verified email
// ============================================================
customerAuthRoutes.post('/register', async (c) => {
  try {
    // conv-v5: Section 5 — accept B2B qualifying fields (phone, company_size, primary_use)
    const body = await c.req.json()
    const {
      email,
      password,
      name,
      phone,
      company_name,
      company_size,
      primary_use,
      website, // honeypot — bots fill this, humans don't
      verification_token,
      referred_by_code,
    } = body as {
      email?: string; password?: string; name?: string; phone?: string;
      company_name?: string; company_size?: string; primary_use?: string;
      website?: string; verification_token?: string; referred_by_code?: string;
    }

    if (!email || !password || !name) {
      return c.json({ error: 'Email, password, and name are required' }, 400)
    }
    if (password.length < 6) {
      return c.json({ error: 'Password must be at least 6 characters' }, 400)
    }
    // conv-v5: company_name is now required for B2B qualification
    if (!company_name || !String(company_name).trim()) {
      return c.json({ error: 'Company name is required' }, 400)
    }
    // conv-v5: honeypot — silently accept-and-drop obvious bot signups
    if (website && String(website).trim().length > 0) {
      return c.json({ error: 'Registration failed. Please try again.' }, 400)
    }
    // conv-v5: validate company_size (allow blank/undefined so phone-skip + blank-select still works)
    const VALID_COMPANY_SIZES = new Set(['solo', '2-5', '6-15', '16-50', '50+'])
    const cleanCompanySize = (company_size && VALID_COMPANY_SIZES.has(String(company_size)))
      ? String(company_size)
      : null
    // conv-v5: validate primary_use (optional field)
    const VALID_PRIMARY_USES = new Set(['storm', 'retail', 'commercial', 'solar', 'other'])
    const cleanPrimaryUse = (primary_use && VALID_PRIMARY_USES.has(String(primary_use)))
      ? String(primary_use)
      : null
    // conv-v5: soft phone validation — accept if >= 7 chars OR blank (skip), never reject
    const cleanPhone = (phone && String(phone).replace(/\D/g, '').length >= 7)
      ? String(phone).trim()
      : (phone && String(phone).trim().length > 0 ? String(phone).trim() : null)

    const cleanEmail = email.toLowerCase().trim()
    const cleanCompanyName = String(company_name).trim()

    // Rate limit signups: max 5 per IP per hour (verification already rate-limits per-email).
    try {
      const clientIp = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
      await c.env.DB.prepare("CREATE TABLE IF NOT EXISTS register_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT, email TEXT, created_at TEXT DEFAULT (datetime('now')))").run()
      const attempts = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM register_attempts WHERE ip = ? AND created_at > datetime('now', '-1 hour')").bind(clientIp).first<any>()
      if (attempts && attempts.cnt >= 5) {
        return c.json({ error: 'Too many signup attempts from this network. Please wait and try again.' }, 429)
      }
      await c.env.DB.prepare("INSERT INTO register_attempts (ip, email) VALUES (?, ?)").bind(clientIp, cleanEmail).run()
    } catch (e: any) { console.warn('[register] rate-limit check failed:', e?.message || e) }

    // Verify the email verification token (unless email config is not set up)
    if (verification_token) {
      const verified = await c.env.DB.prepare(
        "SELECT * FROM email_verification_codes WHERE email = ? AND verification_token = ? AND verified_at IS NOT NULL AND created_at > datetime('now', '-30 minutes')"
      ).bind(cleanEmail, verification_token).first<any>()

      if (!verified) {
        return c.json({ error: 'Email verification expired or invalid. Please verify your email again.' }, 400)
      }
    } else {
      // Check if email verification is configured — if ANY email service is available, require verification
      const hasResend = !!(c.env as any).RESEND_API_KEY
      const hasGmail = !!((c.env as any).GMAIL_REFRESH_TOKEN && (c.env as any).GMAIL_CLIENT_ID)
      const hasGCP = !!(c.env as any).GCP_SERVICE_ACCOUNT_KEY
      if (hasResend || hasGmail || hasGCP) {
        return c.json({ error: 'Email verification is required. Please verify your email first.' }, 400)
      }
      // If no email service configured, allow registration without verification (graceful degradation)
    }

    const existing = await c.env.DB.prepare(
      'SELECT id FROM customers WHERE email = ?'
    ).bind(cleanEmail).first()

    if (existing) {
      return c.json({ error: 'An account with this email already exists' }, 409)
    }

    const storedHash = await hashPassword(password)

    // Generate referral code
    const refCode = 'REF-' + crypto.randomUUID().replace(/-/g, '').substring(0, 10).toUpperCase()

    // Check for referral — referred_by from request body
    let referredBy: number | null = null
    if (referred_by_code) {
      const referrer = await c.env.DB.prepare('SELECT id FROM customers WHERE referral_code = ? AND is_active = 1').bind(referred_by_code).first<any>()
      if (referrer) referredBy = referrer.id
    }

    // Insert with 4 free trial reports (NOT paid credits) — email_verified = 1 since we verified
    // conv-v5: persist phone, company_size, primary_use for sales-qualification
    const result = await c.env.DB.prepare(`
      INSERT INTO customers (email, name, phone, company_name, company_size, primary_use, password_hash, email_verified, is_active, report_credits, credits_used, free_trial_total, free_trial_used, referral_code, referred_by, auto_invoice_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 0, 0, 4, 0, ?, ?, 1)
    `).bind(cleanEmail, name, cleanPhone, cleanCompanyName, cleanCompanySize, cleanPrimaryUse, storedHash, refCode, referredBy).run()

    if (!result.meta.last_row_id) {
      return c.json({ error: 'Failed to create account. Please try again.' }, 500)
    }

    const token = generateSessionToken()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    
    await c.env.DB.prepare(`
      INSERT INTO customer_sessions (customer_id, session_token, expires_at)
      VALUES (?, ?, ?)
    `).bind(result.meta.last_row_id, token, expiresAt).run()

    // P0-05: HttpOnly cookie on registration auto-login too.
    setCustomerSessionCookie(c, token, 7 * 24 * 60 * 60)

    await c.env.DB.prepare(`
      INSERT INTO user_activity_log (company_id, action, details)
      VALUES (1, 'customer_registered', ?)
    `).bind(`New customer: ${name} (${cleanEmail}) — 4 free trial reports granted — email verified`).run()

    // Seed default material catalog so new account has context on the section (non-blocking)
    seedDefaultMaterials(c.env.DB, result.meta.last_row_id as number).catch((e) => console.warn('[customer-auth] seedDefaultMaterials failed (email):', e?.message || e))

    // Track signup in GA4 (non-blocking) — conv-v5: include B2B qualifying dims
    trackUserSignup(c.env as any, String(result.meta.last_row_id), 'email', {
      email_domain: cleanEmail.split('@')[1] || 'unknown',
      company_size: cleanCompanySize || '',
      primary_use: cleanPrimaryUse || '',
    }).catch((e) => console.warn('[customer-auth] GA4 trackUserSignup failed (email):', e?.message || e))

    return c.json({
      success: true,
      is_new: true,
      customer: {
        id: result.meta.last_row_id,
        email: cleanEmail,
        name,
        company_name: cleanCompanyName,
        phone: cleanPhone,
        company_size: cleanCompanySize,
        primary_use: cleanPrimaryUse,
        role: 'customer',
        credits_remaining: 4,
        free_trial_remaining: 4,
        free_trial_total: 4,
        paid_credits_remaining: 0
      },
      token,
      welcome: true,
      message: 'Welcome! You have 4 free trial roof reports to get started.'
    })
  } catch (err: any) {
    return c.json({ error: 'Registration failed', details: err.message }, 500)
  }
})

// ============================================================
// CUSTOMER LOGIN (email/password)
// ============================================================
customerAuthRoutes.post('/login', async (c) => {
  try {
    const { email, password } = await c.req.json()

    if (!email || !password) {
      return c.json({ error: 'Email and password are required' }, 400)
    }

    // Session + verification code cleanup (piggyback, non-blocking)
    c.env.DB.prepare("DELETE FROM customer_sessions WHERE expires_at < datetime('now')").run().catch((e) => console.warn('[customer-auth] session cleanup failed:', e?.message || e))
    c.env.DB.prepare("DELETE FROM email_verification_codes WHERE expires_at < datetime('now') AND used = 1").run().catch((e) => console.warn('[customer-auth] verification-code cleanup failed:', e?.message || e))

    const cleanEmail = email.toLowerCase().trim()

    // ============================================================
    // P0-04: source-level dev bypass removed. The dev@reusecanada.ca
    // row exists in DB and logs in through the normal path below.
    // ============================================================

    // ============================================================
    // NORMAL CUSTOMER LOGIN
    // ============================================================
    const customer = await c.env.DB.prepare(
      'SELECT * FROM customers WHERE email = ? AND is_active = 1'
    ).bind(cleanEmail).first<any>()

    if (!customer) {
      // P1-08: constant-time response when user not found.
      await dummyVerify(password)
      return c.json({ error: 'Invalid email or password' }, 401)
    }

    if (!customer.password_hash) {
      return c.json({ error: 'This account was created via Google. Please register with email/password to set your credentials.' }, 401)
    }

    const valid = await verifyPassword(password, customer.password_hash)
    if (!valid) {
      return c.json({ error: 'Invalid email or password' }, 401)
    }

    // P0-03: upgrade legacy hashes transparently after successful verify.
    if (isLegacyHash(customer.password_hash)) {
      try {
        const fresh = await hashPassword(password)
        await c.env.DB.prepare("UPDATE customers SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(fresh, customer.id).run()
      } catch (e) {
        console.warn('[customer-auth] hash upgrade failed:', (e as any)?.message)
      }
    }

    await c.env.DB.prepare(
      "UPDATE customers SET last_login = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).bind(customer.id).run()

    const token = generateSessionToken()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    
    await c.env.DB.prepare(`
      INSERT INTO customer_sessions (customer_id, session_token, expires_at)
      VALUES (?, ?, ?)
    `).bind(customer.id, token, expiresAt).run()

    // P0-05: also set HttpOnly cookie.
    setCustomerSessionCookie(c, token, 7 * 24 * 60 * 60)

    // Track login event in GA4
    trackUserLogin(c.env as any, String(customer.id), 'email', { email_domain: customer.email.split('@')[1] || 'unknown' }).catch((e) => console.warn("[silent-catch]", (e && e.message) || e))

    return c.json({
      success: true,
      customer: {
        id: customer.id,
        email: customer.email,
        name: customer.name,
        company_name: customer.company_name,
        phone: customer.phone,
        google_avatar: customer.google_avatar,
        role: 'customer',
        // P2: include billing/subscription state so /login responses align
        // with /me and the client doesn't need a second round-trip.
        subscription_status: customer.subscription_status || 'none',
        subscription_plan: customer.subscription_plan || 'free',
        credits_remaining: Math.max(
          0,
          (Number(customer.report_credits) || 0) - (Number(customer.credits_used) || 0)
        ) + Math.max(
          0,
          (Number(customer.free_trial_total) || 0) - (Number(customer.free_trial_used) || 0)
        ),
      },
      token
    })
  } catch (err: any) {
    return c.json({ error: 'Login failed', details: err.message }, 500)
  }
})

// ============================================================
// CUSTOMER PROFILE (get current customer)
// ============================================================
customerAuthRoutes.get('/me', async (c) => {
  const token = getCustomerSessionToken(c)
  if (!token) {
    return c.json({ error: 'Not authenticated' }, 401)
  }

  const session = await c.env.DB.prepare(`
    SELECT cs.customer_id,
           c.email, c.name, c.phone, c.company_name, c.google_avatar,
           c.address, c.city, c.province, c.postal_code,
           c.report_credits, c.credits_used, c.free_trial_total, c.free_trial_used,
           c.subscription_status, c.subscription_plan, c.subscription_end,
           c.brand_logo_url, c.brand_business_name,
           c.company_type, c.solar_panel_wattage_w,
           c.onboarding_completed, c.onboarding_step
    FROM customer_sessions cs
    JOIN customers c ON c.id = cs.customer_id
    WHERE cs.session_token = ? AND cs.expires_at > datetime('now') AND c.is_active = 1
  `).bind(token).first<any>()

  if (!session) {
    return c.json({ error: 'Session expired or invalid' }, 401)
  }

  // DEV ACCOUNT: always unlimited
  const isDev = isDevAccount(session.email || '', c.env)
  const paidCreditsRemaining = isDev ? 999999 : ((session.report_credits || 0) - (session.credits_used || 0))
  const freeTrialRemaining = isDev ? 999999 : ((session.free_trial_total || 0) - (session.free_trial_used || 0))
  const totalRemaining = isDev ? 999999 : (Math.max(0, freeTrialRemaining) + Math.max(0, paidCreditsRemaining))

  // Check team membership
  const teamInfo = await resolveTeamOwner(c.env.DB, session.customer_id)

  // If team member, fetch owner's credit balances so team member sees shared credits
  let creditSource = session
  let ownerName = ''
  let ownerCompany = ''
  let ownerSubscriptionStatus = session.subscription_status || 'none'
  let ownerSubscriptionPlan = session.subscription_plan || 'free'
  let ownerSubscriptionEnd = session.subscription_end || null
  if (teamInfo.isTeamMember) {
    const owner = await c.env.DB.prepare(`
      SELECT report_credits, credits_used, free_trial_total, free_trial_used, name, company_name,
             subscription_status, subscription_plan, subscription_end FROM customers WHERE id = ?
    `).bind(teamInfo.ownerId).first<any>()
    if (owner) {
      creditSource = owner
      ownerName = owner.name || ''
      ownerCompany = owner.company_name || ''
      ownerSubscriptionStatus = owner.subscription_status || 'none'
      ownerSubscriptionPlan = owner.subscription_plan || 'free'
      ownerSubscriptionEnd = owner.subscription_end || null
    }
  }

  const ownerIsDev = teamInfo.isTeamMember ? false : isDev
  const paidCreditsRemainingCalc = ownerIsDev ? 999999 : ((creditSource.report_credits || 0) - (creditSource.credits_used || 0))
  const freeTrialRemainingCalc = ownerIsDev ? 999999 : ((creditSource.free_trial_total || 0) - (creditSource.free_trial_used || 0))
  const totalRemainingCalc = ownerIsDev ? 999999 : (Math.max(0, freeTrialRemainingCalc) + Math.max(0, paidCreditsRemainingCalc))

  // Show ads to non-subscribers: anyone without an active subscription
  // Dev accounts, active subscribers, and team owners with credits are ad-free
  const showAds = !ownerIsDev && session.subscription_status !== 'active'

  return c.json({
    show_ads: showAds,
    customer: {
      id: session.customer_id,
      email: session.email,
      name: session.name,
      phone: session.phone,
      company_name: session.company_name,
      google_avatar: session.google_avatar,
      address: session.address,
      city: session.city,
      province: session.province,
      postal_code: session.postal_code,
      role: 'customer',
      is_dev: isDev || undefined,
      credits_remaining: totalRemainingCalc,
      free_trial_remaining: ownerIsDev ? 999999 : Math.max(0, freeTrialRemainingCalc),
      free_trial_total: ownerIsDev ? 999999 : (creditSource.free_trial_total || 0),
      free_trial_used: ownerIsDev ? 0 : (creditSource.free_trial_used || 0),
      paid_credits_remaining: ownerIsDev ? 999999 : Math.max(0, paidCreditsRemainingCalc),
      paid_credits_total: ownerIsDev ? 999999 : (creditSource.report_credits || 0),
      paid_credits_used: ownerIsDev ? 0 : (creditSource.credits_used || 0),
      brand_logo_url: session.brand_logo_url || null,
      brand_business_name: session.brand_business_name || null,
      // Team membership info
      is_team_member: teamInfo.isTeamMember,
      team_owner_id: teamInfo.isTeamMember ? teamInfo.ownerId : undefined,
      team_role: teamInfo.teamMemberRole || undefined,
      team_owner_name: teamInfo.isTeamMember ? ownerName : undefined,
      team_owner_company: teamInfo.isTeamMember ? ownerCompany : undefined,
      // Company type: 'roofing' | 'solar' | null (null = not yet selected)
      company_type: session.company_type || null,
      solar_panel_wattage_w: session.solar_panel_wattage_w || 400,
      onboarding_completed: session.onboarding_completed || 0,
      onboarding_step: session.onboarding_step || 0,
      // For team members, expose the owner's subscription so paywall UI reflects the account that pays
      subscription_status: isDev ? 'active' : ownerSubscriptionStatus,
      subscription_plan: isDev ? 'dev_unlimited' : ownerSubscriptionPlan,
      subscription_end: ownerSubscriptionEnd
    }
  })
})

// ============================================================
// PATCH /solar-settings — Save company_type and/or panel wattage
// ============================================================
customerAuthRoutes.patch('/solar-settings', async (c) => {
  const token = getCustomerSessionToken(c)
  if (!token) return c.json({ error: 'Not authenticated' }, 401)

  const session = await c.env.DB.prepare(`
    SELECT cs.customer_id FROM customer_sessions cs
    WHERE cs.session_token = ? AND cs.expires_at > datetime('now')
  `).bind(token).first<any>()
  if (!session) return c.json({ error: 'Session expired or invalid' }, 401)

  const body = await c.req.json()
  const { company_type, solar_panel_wattage_w } = body

  if (company_type !== undefined && company_type !== 'roofing' && company_type !== 'solar') {
    return c.json({ error: 'company_type must be "roofing" or "solar"' }, 400)
  }

  const updates: string[] = []
  const bindings: any[] = []
  if (company_type !== undefined) { updates.push('company_type = ?'); bindings.push(company_type) }
  if (solar_panel_wattage_w !== undefined) { updates.push('solar_panel_wattage_w = ?'); bindings.push(Number(solar_panel_wattage_w) || 400) }
  if (updates.length === 0) return c.json({ error: 'Nothing to update' }, 400)

  updates.push("updated_at = datetime('now')")
  bindings.push(session.customer_id)
  await c.env.DB.prepare(`UPDATE customers SET ${updates.join(', ')} WHERE id = ?`).bind(...bindings).run()

  return c.json({ success: true })
})

// ============================================================
// GET CUSTOMER PROFILE — Returns current user profile data
// ============================================================
customerAuthRoutes.get('/profile', async (c) => {
  const token = getCustomerSessionToken(c)
  if (!token) return c.json({ error: 'Not authenticated' }, 401)

  const session = await c.env.DB.prepare(`
    SELECT customer_id FROM customer_sessions
    WHERE session_token = ? AND expires_at > datetime('now')
  `).bind(token).first<any>()

  if (!session) return c.json({ error: 'Session expired' }, 401)

  const customer = await c.env.DB.prepare(`
    SELECT id, email, name, phone, company_name, address, city, province, postal_code,
           google_avatar, report_credits, credits_used, free_trial_total, free_trial_used,
           subscription_plan, subscription_status, stripe_customer_id, square_customer_id,
           brand_business_name, brand_logo_url, brand_primary_color, brand_secondary_color,
           brand_tagline, brand_phone, brand_email, brand_website, brand_address,
           brand_license_number, brand_insurance_info,
           onboarding_completed, onboarding_step,
           company_type, solar_panel_wattage_w,
           created_at, last_login
    FROM customers WHERE id = ?
  `).bind(session.customer_id).first()

  if (!customer) return c.json({ error: 'Customer not found' }, 404)

  return c.json({ customer })
})

// ============================================================
// POST /onboarding/complete — Mark onboarding as finished
// ============================================================
customerAuthRoutes.post('/onboarding/complete', async (c) => {
  const token = getCustomerSessionToken(c)
  if (!token) return c.json({ error: 'Not authenticated' }, 401)
  const session = await c.env.DB.prepare(
    `SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')`
  ).bind(token).first<any>()
  if (!session) return c.json({ error: 'Session expired' }, 401)
  await c.env.DB.prepare(
    `UPDATE customers SET onboarding_completed = 1, onboarding_step = 3, updated_at = datetime('now') WHERE id = ?`
  ).bind(session.customer_id).run()
  return c.json({ success: true })
})

// ============================================================
// UPDATE CUSTOMER PROFILE
// ============================================================
customerAuthRoutes.put('/profile', async (c) => {
  const token = getCustomerSessionToken(c)
  if (!token) return c.json({ error: 'Not authenticated' }, 401)

  const session = await c.env.DB.prepare(`
    SELECT customer_id FROM customer_sessions
    WHERE session_token = ? AND expires_at > datetime('now')
  `).bind(token).first<any>()

  if (!session) return c.json({ error: 'Session expired' }, 401)

  const { name, phone, company_name, address, city, province, postal_code } = await c.req.json()

  await c.env.DB.prepare(`
    UPDATE customers SET
      name = COALESCE(?, name), phone = ?, company_name = ?,
      address = ?, city = ?, province = ?, postal_code = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(name, phone || null, company_name || null, address || null, city || null, province || null, postal_code || null, session.customer_id).run()

  return c.json({ success: true })
})

// ============================================================
// UPDATE BRANDING / REPORT CUSTOMIZATION
// ============================================================
customerAuthRoutes.put('/branding', async (c) => {
  const token = getCustomerSessionToken(c)
  if (!token) return c.json({ error: 'Not authenticated' }, 401)

  const session = await c.env.DB.prepare(`
    SELECT customer_id FROM customer_sessions
    WHERE session_token = ? AND expires_at > datetime('now')
  `).bind(token).first<any>()
  if (!session) return c.json({ error: 'Session expired' }, 401)

  const body = await c.req.json()
  const {
    brand_business_name, brand_logo_url, brand_tagline,
    brand_phone, brand_email, brand_website, brand_address,
    brand_license_number, brand_insurance_info,
    brand_primary_color, brand_secondary_color,
  } = body

  await c.env.DB.prepare(`
    UPDATE customers SET
      brand_business_name = ?, brand_logo_url = ?, brand_tagline = ?,
      brand_phone = ?, brand_email = ?, brand_website = ?, brand_address = ?,
      brand_license_number = ?, brand_insurance_info = ?,
      brand_primary_color = ?, brand_secondary_color = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    brand_business_name || null, brand_logo_url || null, brand_tagline || null,
    brand_phone || null, brand_email || null, brand_website || null, brand_address || null,
    brand_license_number || null, brand_insurance_info || null,
    brand_primary_color || null, brand_secondary_color || null,
    session.customer_id
  ).run()

  return c.json({ success: true })
})

// ============================================================
// C-5: UPLOAD LOGO (stores base64 data URI in brand_logo_url)
// ============================================================
customerAuthRoutes.post('/branding/logo', async (c) => {
  const token = getCustomerSessionToken(c)
  if (!token) return c.json({ error: 'Not authenticated' }, 401)

  const session = await c.env.DB.prepare(`
    SELECT customer_id FROM customer_sessions
    WHERE session_token = ? AND expires_at > datetime('now')
  `).bind(token).first<any>()
  if (!session) return c.json({ error: 'Session expired' }, 401)

  const { logo_data } = await c.req.json()
  if (!logo_data) return c.json({ error: 'logo_data is required' }, 400)

  await c.env.DB.prepare(
    `UPDATE customers SET brand_logo_url = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(logo_data, session.customer_id).run()

  return c.json({ success: true })
})

// ============================================================
// C-5: SAVE AD SETTINGS (stores as JSON in brand_ads_json)
// ============================================================
customerAuthRoutes.put('/branding/ads', async (c) => {
  const token = getCustomerSessionToken(c)
  if (!token) return c.json({ error: 'Not authenticated' }, 401)

  const session = await c.env.DB.prepare(`
    SELECT customer_id FROM customer_sessions
    WHERE session_token = ? AND expires_at > datetime('now')
  `).bind(token).first<any>()
  if (!session) return c.json({ error: 'Session expired' }, 401)

  const ads = await c.req.json()

  await c.env.DB.prepare(
    `UPDATE customers SET brand_ads_json = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(JSON.stringify(ads), session.customer_id).run()

  return c.json({ success: true })
})

// ============================================================
// C-6: SET SUBSCRIPTION TIER (called from signup wizard)
// ============================================================
customerAuthRoutes.post('/set-tier', async (c) => {
  const token = getCustomerSessionToken(c)
  if (!token) return c.json({ error: 'Not authenticated' }, 401)

  const session = await c.env.DB.prepare(`
    SELECT customer_id FROM customer_sessions
    WHERE session_token = ? AND expires_at > datetime('now')
  `).bind(token).first<any>()
  if (!session) return c.json({ error: 'Session expired' }, 401)

  const { tier, city, province } = await c.req.json()

  await c.env.DB.prepare(
    `UPDATE customers SET subscription_tier = ?,
      city = COALESCE(?, city), province = COALESCE(?, province),
      updated_at = datetime('now')
     WHERE id = ?`
  ).bind(tier || 'starter', city || null, province || null, session.customer_id).run()

  return c.json({ success: true })
})

// ============================================================
// CHANGE PASSWORD
// ============================================================
customerAuthRoutes.post('/change-password', async (c) => {
  const token = getCustomerSessionToken(c)
  if (!token) return c.json({ error: 'Not authenticated' }, 401)

  const session = await c.env.DB.prepare(`
    SELECT cs.customer_id, cu.password_hash
    FROM customer_sessions cs
    JOIN customers cu ON cu.id = cs.customer_id
    WHERE cs.session_token = ? AND cs.expires_at > datetime('now')
  `).bind(token).first<any>()
  if (!session) return c.json({ error: 'Session expired' }, 401)

  const body = await c.req.json()
  const { current_password, new_password } = body

  if (!current_password || !new_password) {
    return c.json({ error: 'current_password and new_password are required' }, 400)
  }
  if (new_password.length < 8) {
    return c.json({ error: 'New password must be at least 8 characters' }, 400)
  }

  // Verify current password using the established verifyPassword helper (PBKDF2 + legacy SHA-256)
  if (!session.password_hash) {
    return c.json({ error: 'This account uses Google Sign-In and has no password to change.' }, 400)
  }
  const valid = await verifyPassword(current_password, session.password_hash)
  if (!valid) {
    return c.json({ error: 'Current password is incorrect' }, 400)
  }

  const storedHash = await hashPassword(new_password)

  await c.env.DB.prepare(`
    UPDATE customers SET password_hash = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(storedHash, session.customer_id).run()

  // P1-04: invalidate all customer sessions on password change.
  await c.env.DB.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').bind(session.customer_id).run().catch(() => {})

  return c.json({ success: true })
})

// ============================================================
// CUSTOMER LOGOUT
// ============================================================
customerAuthRoutes.post('/logout', async (c) => {
  let token = getCustomerSessionToken(c) || null
  if (!token) {
    const cookieHeader = c.req.header('Cookie') || ''
    for (const part of cookieHeader.split(/;\s*/)) {
      if (part.startsWith(`${CUSTOMER_SESSION_COOKIE}=`)) { token = decodeURIComponent(part.slice(CUSTOMER_SESSION_COOKIE.length + 1)); break }
    }
  }
  if (token) {
    await c.env.DB.prepare('DELETE FROM customer_sessions WHERE session_token = ?').bind(token).run()
  }
  // P0-05: clear cookie.
  clearCustomerSessionCookie(c)
  return c.json({ success: true })
})

// ============================================================
// CUSTOMER ORDERS (orders belonging to this customer)
// ============================================================
customerAuthRoutes.get('/orders', async (c) => {
  const token = getCustomerSessionToken(c)
  if (!token) return c.json({ error: 'Not authenticated' }, 401)

  const session = await c.env.DB.prepare(`
    SELECT customer_id FROM customer_sessions
    WHERE session_token = ? AND expires_at > datetime('now')
  `).bind(token).first<any>()

  if (!session) return c.json({ error: 'Session expired' }, 401)

  // Resolve team membership — show owner's orders if team member
  const { ownerId } = await resolveTeamOwner(c.env.DB, session.customer_id)

  const orders = await c.env.DB.prepare(`
    SELECT o.*, r.status as report_status, r.roof_area_sqft, r.total_material_cost_cad,
           r.complexity_class, r.confidence_score,
           r.enhancement_status, r.enhancement_version, r.enhancement_sent_at,
           r.ai_imagery_status, r.satellite_image_url, r.solar_panel_layout
    FROM orders o
    LEFT JOIN reports r ON r.order_id = o.id
    WHERE o.customer_id = ?
    ORDER BY o.created_at DESC
  `).bind(ownerId).all()

  return c.json({ orders: orders.results })
})

// ============================================================
// PATCH /api/customer/reports/:id/panel-layout
// Persist user-edited solar panel positions for a report.
// Body: { user_panels: [{lat,lng,orientation}, ...] }
// ============================================================
customerAuthRoutes.patch('/reports/:id/panel-layout', async (c) => {
  const token = getCustomerSessionToken(c)
  if (!token) return c.json({ error: 'Not authenticated' }, 401)
  const session = await c.env.DB.prepare(`
    SELECT customer_id FROM customer_sessions
    WHERE session_token = ? AND expires_at > datetime('now')
  `).bind(token).first<any>()
  if (!session) return c.json({ error: 'Session expired' }, 401)

  const orderId = c.req.param('id')
  const { ownerId } = await resolveTeamOwner(c.env.DB, session.customer_id)

  const order = await c.env.DB.prepare(
    `SELECT id FROM orders WHERE id = ? AND customer_id = ?`
  ).bind(orderId, ownerId).first<any>()
  if (!order) return c.json({ error: 'Order not found' }, 404)

  const body = await c.req.json().catch(() => ({}))
  const userPanels = Array.isArray(body.user_panels) ? body.user_panels : []

  const existing = await c.env.DB.prepare(
    `SELECT solar_panel_layout FROM reports WHERE order_id = ?`
  ).bind(orderId).first<any>()
  let layout: any = {}
  if (existing?.solar_panel_layout) {
    try { layout = JSON.parse(existing.solar_panel_layout) } catch {}
  }
  layout.user_panels = userPanels
  layout.user_panel_count = userPanels.length
  layout.user_updated_at = new Date().toISOString()
  if (Array.isArray(body.obstructions)) layout.obstructions = body.obstructions
  if (body.inverter_config && typeof body.inverter_config === 'object') layout.inverter_config = body.inverter_config
  if (body.battery_config && typeof body.battery_config === 'object') layout.battery_config = body.battery_config
  else if (body.battery_config === null) layout.battery_config = null
  if (Array.isArray(body.variants)) layout.variants = body.variants
  if (typeof body.active_variant_index === 'number') layout.active_variant_index = body.active_variant_index
  if (typeof body.panel_width_meters === 'number' && body.panel_width_meters > 0) layout.panel_width_meters = body.panel_width_meters
  if (typeof body.panel_height_meters === 'number' && body.panel_height_meters > 0) layout.panel_height_meters = body.panel_height_meters

  await c.env.DB.prepare(
    `UPDATE reports SET solar_panel_layout = ?, updated_at = datetime('now') WHERE order_id = ?`
  ).bind(JSON.stringify(layout), orderId).run()

  return c.json({ success: true, panel_count: userPanels.length })
})

// ============================================================
// ORDER PROGRESS TRACKER — Real-time status for report generation
// Returns a timeline of generation steps with current status
// ============================================================
customerAuthRoutes.get('/orders/:orderId/progress', async (c) => {
  const token = getCustomerSessionToken(c)
  if (!token) return c.json({ error: 'Not authenticated' }, 401)

  const session = await c.env.DB.prepare(`
    SELECT customer_id FROM customer_sessions
    WHERE session_token = ? AND expires_at > datetime('now')
  `).bind(token).first<any>()

  if (!session) return c.json({ error: 'Session expired' }, 401)

  const orderId = c.req.param('orderId')

  // Get order + report status
  const order = await c.env.DB.prepare(`
    SELECT o.*, r.status as report_status, r.generation_attempts, 
           r.generation_started_at, r.generation_completed_at,
           r.error_message as report_error, r.confidence_score,
           r.imagery_quality, r.report_version,
           r.roof_area_sqft, r.total_material_cost_cad, r.complexity_class
    FROM orders o
    LEFT JOIN reports r ON r.order_id = o.id
    WHERE o.id = ? AND o.customer_id = ?
  `).bind(orderId, session.customer_id).first<any>()

  if (!order) return c.json({ error: 'Order not found' }, 404)

  // Build progress timeline
  const steps = [
    {
      id: 'payment',
      label: 'Payment Received',
      icon: 'fa-credit-card',
      status: order.payment_status === 'paid' || order.payment_status === 'trial' ? 'completed' : 'pending',
      completed_at: order.created_at,
      detail: order.is_trial ? 'Free trial report' : (order.payment_status === 'paid' ? `$${order.price} CAD` : 'Awaiting payment')
    },
    {
      id: 'geocoding',
      label: 'Property Located',
      icon: 'fa-map-marker-alt',
      status: order.latitude && order.longitude ? 'completed' : (order.status === 'failed' ? 'failed' : 'pending'),
      completed_at: order.latitude ? order.created_at : null,
      detail: order.latitude ? `${order.latitude.toFixed(6)}, ${order.longitude.toFixed(6)}` : 'Geocoding address...'
    },
    {
      id: 'imagery',
      label: 'Satellite Imagery',
      icon: 'fa-satellite',
      status: order.report_status === 'running' ? 'running' :
             (order.report_status === 'completed' ? 'completed' :
              order.report_status === 'failed' ? 'failed' : 'pending'),
      completed_at: order.generation_started_at || null,
      detail: order.report_status === 'running' ? 'Fetching satellite & DSM data...' :
              (order.imagery_quality ? `Quality: ${order.imagery_quality}` : 'Queued')
    },
    {
      id: 'measurement',
      label: 'Roof Measurement',
      icon: 'fa-ruler-combined',
      status: order.report_status === 'completed' ? 'completed' :
             (order.report_status === 'running' ? 'running' : 
              order.report_status === 'failed' ? 'failed' : 'pending'),
      completed_at: order.report_status === 'completed' ? order.generation_completed_at : null,
      detail: order.roof_area_sqft ? `${Math.round(order.roof_area_sqft)} sq ft` : 'Analyzing roof geometry...'
    },
    {
      id: 'materials',
      label: 'Material Estimate',
      icon: 'fa-calculator',
      status: order.report_status === 'completed' ? 'completed' : 'pending',
      completed_at: order.report_status === 'completed' ? order.generation_completed_at : null,
      detail: order.total_material_cost_cad ? `$${order.total_material_cost_cad.toFixed(2)} CAD` : 'Calculating materials...'
    },
    {
      id: 'report',
      label: 'Report Generated',
      icon: 'fa-file-pdf',
      status: order.report_status === 'completed' ? 'completed' :
             (order.report_status === 'failed' ? 'failed' : 'pending'),
      completed_at: order.report_status === 'completed' ? (order.delivered_at || order.generation_completed_at) : null,
      detail: order.report_status === 'completed' ? `v${order.report_version || '2.0'} — Confidence: ${order.confidence_score || 'N/A'}%` :
              (order.report_status === 'failed' ? (order.report_error || 'Generation failed') : 'Assembling PDF...')
    }
  ]

  // Determine overall progress percentage
  const completedSteps = steps.filter(s => s.status === 'completed').length
  const progressPct = Math.round((completedSteps / steps.length) * 100)

  return c.json({
    order_id: order.id,
    order_number: order.order_number,
    property_address: order.property_address,
    order_status: order.status,
    report_status: order.report_status || 'queued',
    generation_attempts: order.generation_attempts || 0,
    progress_pct: progressPct,
    steps,
    error: order.report_status === 'failed' ? order.report_error : null,
    can_retry: order.report_status === 'failed' && (order.generation_attempts || 0) < 3
  })
})

// ============================================================
// CUSTOMER INVOICES
// ============================================================
customerAuthRoutes.get('/invoices', async (c) => {
  const token = getCustomerSessionToken(c)
  if (!token) return c.json({ error: 'Not authenticated' }, 401)

  const session = await c.env.DB.prepare(`
    SELECT customer_id FROM customer_sessions
    WHERE session_token = ? AND expires_at > datetime('now')
  `).bind(token).first<any>()

  if (!session) return c.json({ error: 'Session expired' }, 401)

  const invoices = await c.env.DB.prepare(`
    SELECT i.*, o.property_address, o.order_number
    FROM invoices i
    LEFT JOIN orders o ON o.id = i.order_id
    WHERE i.customer_id = ?
    ORDER BY i.created_at DESC
  `).bind(session.customer_id).all()

  return c.json({ invoices: invoices.results })
})

// Get single invoice with items
customerAuthRoutes.get('/invoices/:id', async (c) => {
  const token = getCustomerSessionToken(c)
  if (!token) return c.json({ error: 'Not authenticated' }, 401)

  const session = await c.env.DB.prepare(`
    SELECT customer_id FROM customer_sessions
    WHERE session_token = ? AND expires_at > datetime('now')
  `).bind(token).first<any>()

  if (!session) return c.json({ error: 'Session expired' }, 401)

  const id = c.req.param('id')
  const invoice = await c.env.DB.prepare(`
    SELECT i.*, o.property_address, o.order_number, c.name as customer_name, c.email as customer_email,
           c.phone as customer_phone, c.company_name as customer_company, c.address as customer_address,
           c.city as customer_city, c.province as customer_province, c.postal_code as customer_postal
    FROM invoices i
    LEFT JOIN orders o ON o.id = i.order_id
    LEFT JOIN customers c ON c.id = i.customer_id
    WHERE i.id = ? AND i.customer_id = ?
  `).bind(id, session.customer_id).first<any>()

  if (!invoice) return c.json({ error: 'Invoice not found' }, 404)

  // Mark as viewed if it was just sent
  if (invoice.status === 'sent') {
    await c.env.DB.prepare("UPDATE invoices SET status = 'viewed', updated_at = datetime('now') WHERE id = ?").bind(id).run()
    invoice.status = 'viewed'
  }

  const items = await c.env.DB.prepare(
    'SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order'
  ).bind(id).all()

  return c.json({ invoice, items: items.results })
})

// ============================================================
// FORGOT PASSWORD — Send reset link to customer email
// ============================================================
async function sendPasswordResetEmail(env: any, toEmail: string, name: string, resetUrl: string, db?: any): Promise<boolean> {
  const senderEmail = (env as any).GMAIL_SENDER_EMAIL || 'sales@roofmanager.ca'
  const subject = 'Reset your Roof Manager password'
  const html = `
  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
    <div style="text-align: center; margin-bottom: 32px;">
      <div style="display: inline-block; width: 48px; height: 48px; background: #0ea5e9; border-radius: 12px; line-height: 48px; text-align: center;">
        <span style="color: white; font-size: 24px;">&#127968;</span>
      </div>
      <h1 style="color: #1e3a5f; font-size: 24px; margin: 16px 0 4px;">Roof Manager</h1>
      <p style="color: #6b7280; font-size: 14px; margin: 0;">Password Reset</p>
    </div>
    <div style="background: #f8fafc; border-radius: 16px; padding: 32px; text-align: center;">
      <p style="color: #374151; font-size: 16px; margin: 0 0 8px;">Hi ${name},</p>
      <p style="color: #6b7280; font-size: 14px; margin: 0 0 28px;">We received a request to reset your password. Click the button below to create a new one.</p>
      <a href="${resetUrl}" style="display: inline-block; background: #0ea5e9; color: white; font-weight: 700; font-size: 15px; padding: 14px 32px; border-radius: 10px; text-decoration: none;">Reset My Password</a>
      <p style="color: #9ca3af; font-size: 12px; margin: 24px 0 8px;">This link expires in 1 hour.</p>
      <p style="color: #9ca3af; font-size: 12px; margin: 0;">If you didn't request a password reset, you can safely ignore this email — your password won't change.</p>
    </div>
    <p style="color: #d1d5db; font-size: 11px; text-align: center; margin-top: 24px;">&copy; 2026 Roof Manager &middot; Alberta, Canada</p>
  </div>`

  // Try Resend first
  const resendKey = (env as any).RESEND_API_KEY
  if (resendKey) {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: `Roof Manager <onboarding@resend.dev>`, to: [toEmail], subject, html })
      })
      if (resp.ok) return true
    } catch (e: any) { console.error('[PasswordReset] Resend error:', e.message) }
  }

  // Fallback: Gmail OAuth2
  let gmailRefreshToken = (env as any).GMAIL_REFRESH_TOKEN || ''
  const gmailClientId = (env as any).GMAIL_CLIENT_ID || ''
  let gmailClientSecret = (env as any).GMAIL_CLIENT_SECRET || ''
  if (db && !gmailRefreshToken) {
    try {
      const row = await db.prepare("SELECT setting_value FROM settings WHERE setting_key = 'gmail_refresh_token' AND master_company_id = 1").first()
      if (row?.setting_value) gmailRefreshToken = row.setting_value
    } catch {}
  }
  if (gmailRefreshToken && gmailClientId && gmailClientSecret) {
    try {
      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: gmailRefreshToken, client_id: gmailClientId, client_secret: gmailClientSecret }).toString()
      })
      const tokenData: any = await tokenResp.json()
      if (tokenData.access_token) {
        const rawEmail = [`From: Roof Manager <${mimeHeader(senderEmail)}>`, `To: ${mimeHeader(toEmail)}`, `Subject: ${mimeHeader(subject)}`, 'Content-Type: text/html; charset=UTF-8', '', html].join('\r\n')
        const encoded = btoa(unescape(encodeURIComponent(rawEmail))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
        const sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: encoded })
        })
        if (sendResp.ok) return true
      }
    } catch (e: any) { console.error('[PasswordReset] Gmail error:', e.message) }
  }

  console.error('[PasswordReset] All email methods failed for:', toEmail)
  return false
}

customerAuthRoutes.post('/forgot-password', async (c) => {
  try {
    const { email } = await c.req.json()
    const cleanEmail = email?.toLowerCase().trim()
    if (!cleanEmail) return c.json({ error: 'Email is required' }, 400)

    // Always return success to prevent email enumeration
    const customer = await c.env.DB.prepare(
      'SELECT id, name FROM customers WHERE email = ? AND is_active = 1'
    ).bind(cleanEmail).first<any>()

    if (customer) {
      // Rate limit: max 1 reset email per 30 minutes (tightened to slow password-reset phishing).
      const recent = await c.env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM password_reset_tokens WHERE email = ? AND account_type = 'customer' AND created_at > datetime('now', '-30 minutes')"
      ).bind(cleanEmail).first<any>()

      if (!recent || recent.cnt < 1) {
        const token = crypto.randomUUID() + '-' + crypto.randomUUID()
        // P0-06: tighten expiry from 60 → 30 minutes.
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()

        // Invalidate previous tokens for this email
        await c.env.DB.prepare(
          "UPDATE password_reset_tokens SET used = 1 WHERE email = ? AND account_type = 'customer' AND used = 0"
        ).bind(cleanEmail).run()

        await c.env.DB.prepare(
          "INSERT INTO password_reset_tokens (email, token, account_type, expires_at) VALUES (?, ?, 'customer', ?)"
        ).bind(cleanEmail, token, expiresAt).run()

        const baseUrl = (c.env as any).APP_BASE_URL || 'https://www.roofmanager.ca'
        const resetUrl = `${baseUrl}/customer/reset-password?token=${token}`
        const emailSent = await sendPasswordResetEmail(c.env, cleanEmail, customer.name || 'Customer', resetUrl, c.env.DB)
        if (!emailSent) console.warn('[ForgotPassword] Email failed for:', cleanEmail)
      }
    }

    // Cleanup expired/used tokens (non-blocking)
    c.env.DB.prepare("DELETE FROM password_reset_tokens WHERE (expires_at < datetime('now') OR used = 1) AND created_at < datetime('now', '-1 day')").run().catch((e) => console.warn("[silent-catch]", (e && e.message) || e))

    return c.json({ success: true, message: 'If an account with that email exists, a password reset link has been sent.' })
  } catch (err: any) {
    return c.json({ error: 'Failed to process request', details: err.message }, 500)
  }
})

// ============================================================
// RESET PASSWORD — Validate token and set new password
// ============================================================
customerAuthRoutes.post('/reset-password', async (c) => {
  try {
    const { token, new_password } = await c.req.json()
    if (!token || !new_password) return c.json({ error: 'Token and new password are required' }, 400)
    if (new_password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400)

    const record = await c.env.DB.prepare(
      "SELECT * FROM password_reset_tokens WHERE token = ? AND account_type = 'customer' AND used = 0 AND expires_at > datetime('now')"
    ).bind(token).first<any>()

    if (!record) {
      return c.json({ error: 'This reset link is invalid or has expired. Please request a new one.' }, 400)
    }

    const storedHash = await hashPassword(new_password)

    await c.env.DB.prepare(
      "UPDATE customers SET password_hash = ?, updated_at = datetime('now') WHERE email = ?"
    ).bind(storedHash, record.email).run()

    await c.env.DB.prepare(
      'UPDATE password_reset_tokens SET used = 1 WHERE token = ?'
    ).bind(token).run()

    // P1-04: invalidate all sessions for this customer on password reset
    const cust = await c.env.DB.prepare('SELECT id FROM customers WHERE email = ?').bind(record.email).first<any>()
    if (cust?.id) {
      await c.env.DB.prepare('DELETE FROM customer_sessions WHERE customer_id = ?').bind(cust.id).run().catch(() => {})
    }

    return c.json({ success: true, message: 'Password updated successfully. You can now sign in with your new password.' })
  } catch (err: any) {
    return c.json({ error: 'Failed to reset password', details: err.message }, 500)
  }
})

// ============================================================
// GET /reports-list — List completed reports for attachment
// ============================================================
customerAuthRoutes.get('/reports-list', async (c) => {
  try {
    const token = getCustomerSessionToken(c)
    if (!token) return c.json({ error: 'Unauthorized' }, 401)
    const session = await c.env.DB.prepare(
      "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
    ).bind(token).first<any>()
    if (!session) return c.json({ error: 'Session expired' }, 401)
    const { ownerId } = await resolveTeamOwner(c.env.DB, session.customer_id)

    const reports = await c.env.DB.prepare(`
      SELECT r.id, r.status, o.property_address, o.created_at,
        r.roof_area_sqft, r.roof_pitch_degrees as roof_pitch,
        r.api_response_raw IS NOT NULL as has_data
      FROM reports r
      JOIN orders o ON o.id = r.order_id
      WHERE o.customer_id = ? AND r.status IN ('completed','enhancing')
      ORDER BY o.created_at DESC
      LIMIT 50
    `).bind(ownerId).all()

    return c.json({ reports: reports.results })
  } catch (err: any) {
    return c.json({ error: 'Failed to fetch reports', details: err.message }, 500)
  }
})

// ============================================================
// Item Library CRUD — Reusable line items for proposals/invoices
// ============================================================
customerAuthRoutes.get('/item-library', async (c) => {
  try {
    const token = getCustomerSessionToken(c)
    if (!token) return c.json({ error: 'Unauthorized' }, 401)
    const session = await c.env.DB.prepare(
      "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
    ).bind(token).first<any>()
    if (!session) return c.json({ error: 'Session expired' }, 401)
    const { ownerId } = await resolveTeamOwner(c.env.DB, session.customer_id)

    const items = await c.env.DB.prepare(
      'SELECT * FROM item_library WHERE owner_customer_id = ? ORDER BY sort_order, name'
    ).bind(ownerId).all().catch(() => ({ results: [] }))

    return c.json({ items: items.results })
  } catch (err: any) {
    return c.json({ error: 'Failed to fetch item library', details: err.message }, 500)
  }
})

customerAuthRoutes.post('/item-library', async (c) => {
  try {
    const token = getCustomerSessionToken(c)
    if (!token) return c.json({ error: 'Unauthorized' }, 401)
    const session = await c.env.DB.prepare(
      "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
    ).bind(token).first<any>()
    if (!session) return c.json({ error: 'Session expired' }, 401)
    const { ownerId } = await resolveTeamOwner(c.env.DB, session.customer_id)

    const { name, description, category, default_unit, default_unit_price, default_quantity, is_taxable } = await c.req.json()
    if (!name) return c.json({ error: 'Name is required' }, 400)

    const result = await c.env.DB.prepare(`
      INSERT INTO item_library (owner_customer_id, name, description, category, default_unit, default_unit_price, default_quantity, is_taxable)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      ownerId, name, description || '', category || 'roofing',
      default_unit || 'each', default_unit_price || 0, default_quantity || 1, is_taxable ? 1 : 0
    ).run()

    return c.json({ success: true, id: result.meta.last_row_id }, 201)
  } catch (err: any) {
    return c.json({ error: 'Failed to add item', details: err.message }, 500)
  }
})

// ============================================================
// REFERRAL PROGRAM — View referral code, referred users, earnings
// ============================================================
customerAuthRoutes.get('/referrals', async (c) => {
  const token = getCustomerSessionToken(c)
  if (!token) return c.json({ error: 'Auth required' }, 401)
  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  if (!session) return c.json({ error: 'Session expired' }, 401)
  const customerId = session.customer_id

  // Get or generate referral code
  const customer = await c.env.DB.prepare('SELECT referral_code, name, email FROM customers WHERE id = ?').bind(customerId).first<any>()
  let refCode = customer?.referral_code || ''
  if (!refCode) {
    refCode = 'REF-' + crypto.randomUUID().replace(/-/g, '').substring(0, 10).toUpperCase()
    await c.env.DB.prepare('UPDATE customers SET referral_code = ? WHERE id = ?').bind(refCode, customerId).run()
  }

  // Get referred users
  const referred = await c.env.DB.prepare(
    `SELECT id, name, email, company_name, created_at,
       (SELECT COUNT(*) FROM orders WHERE customer_id = c.id AND status = 'completed') as reports_ordered
     FROM customers c WHERE referred_by = ? AND is_active = 1 ORDER BY created_at DESC`
  ).bind(customerId).all<any>()

  // Get earnings
  const earnings = await c.env.DB.prepare(
    `SELECT re.*, c.name as referred_name, c.company_name as referred_company
     FROM referral_earnings re LEFT JOIN customers c ON c.id = re.referred_id
     WHERE re.referrer_id = ? ORDER BY re.created_at DESC`
  ).bind(customerId).all<any>()

  const totalEarned = await c.env.DB.prepare(
    'SELECT COALESCE(SUM(commission_earned), 0) as total FROM referral_earnings WHERE referrer_id = ?'
  ).bind(customerId).first<any>()

  const totalPending = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(commission_earned), 0) as total FROM referral_earnings WHERE referrer_id = ? AND status = 'pending'"
  ).bind(customerId).first<any>()

  return c.json({
    referral_code: refCode,
    share_url: 'https://www.roofmanager.ca/lander?ref=' + refCode,
    referred_users: referred.results || [],
    earnings: earnings.results || [],
    total_earned: totalEarned?.total || 0,
    total_pending: totalPending?.total || 0,
    total_referred: (referred.results || []).length,
    commission_rate: 10,
  })
})

// ============================================================
// GOOGLE CALENDAR OAUTH — Customer Dashboard
// ============================================================

// GET /gcal/auth-url — Generate Google OAuth URL for calendar sync
customerAuthRoutes.get('/gcal/auth-url', async (c) => {
  const token = getCustomerSessionToken(c)
  if (!token) return c.json({ error: 'Not authenticated' }, 401)
  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  if (!session) return c.json({ error: 'Session expired' }, 401)

  const customerId = session.customer_id
  const clientId = (c.env as any).GMAIL_CLIENT_ID2 || (c.env as any).GMAIL_CLIENT_ID
  if (!clientId) {
    return c.json({ error: 'Google Calendar integration is not configured.' }, 400)
  }

  // P1-16: hardcode OAuth redirect URI per environment (matches callback).
  const configuredBase = (c.env as any).APP_BASE_URL || 'https://www.roofmanager.ca'
  const url = new URL(c.req.url)
  const redirectUri = url.host.startsWith('localhost') || url.host.startsWith('0.0.0.0')
    ? `${url.protocol}//${url.host}/api/customer/gcal/callback`
    : `${configuredBase}/api/customer/gcal/callback`

  const state = `${customerId}:${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`

  // Store state for CSRF validation
  await c.env.DB.prepare(
    "UPDATE customers SET gcal_oauth_state = ? WHERE id = ?"
  ).bind(state, customerId).run().catch(async () => {
    // Column may not exist yet — add it
    await c.env.DB.prepare("ALTER TABLE customers ADD COLUMN gcal_oauth_state TEXT").run().catch((e) => console.warn("[silent-catch]", (e && e.message) || e))
    await c.env.DB.prepare("UPDATE customers SET gcal_oauth_state = ? WHERE id = ?").bind(state, customerId).run()
  })

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email')
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')
  authUrl.searchParams.set('state', state)

  // Get the logged-in customer's email to hint Google which account to use
  const custRow = await c.env.DB.prepare('SELECT email FROM customers WHERE id = ?').bind(customerId).first<any>()
  if (custRow?.email) {
    authUrl.searchParams.set('login_hint', custRow.email)
  }

  return c.json({ url: authUrl.toString() })
})

// GET /gcal/callback — OAuth callback (browser redirect)
customerAuthRoutes.get('/gcal/callback', async (c) => {
  const code = c.req.query('code')
  const error = c.req.query('error')
  const state = c.req.query('state') || ''

  if (error || !code) {
    return c.html(`<!DOCTYPE html><html><head><title>Google Calendar</title><link rel="stylesheet" href="/static/tailwind.css"></head>
<body class="bg-[#0a0a0a] min-h-screen flex items-center justify-center"><div class="bg-[#111] border border-white/10 rounded-2xl shadow-xl p-8 max-w-md text-center">
<div class="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4"><span class="text-red-400 text-2xl">✕</span></div>
<h2 class="text-xl font-bold text-white mb-2">Connection Failed</h2>
<p class="text-gray-400 mb-4">${error || 'No authorization code received'}</p>
<button onclick="window.close()" class="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-blue-700">Close Window</button>
</div></body></html>`)
  }

  const customerId = parseInt(state.split(':')[0])
  if (!customerId) {
    return c.html(`<!DOCTYPE html><html><head><title>Google Calendar</title></head><body class="bg-[#0a0a0a] text-white p-8"><p>Invalid state. Please try again.</p></body></html>`)
  }

  // Validate state matches what we stored
  const customer = await c.env.DB.prepare(
    "SELECT gcal_oauth_state FROM customers WHERE id = ?"
  ).bind(customerId).first<any>()
  if (!customer || customer.gcal_oauth_state !== state) {
    return c.html(`<!DOCTYPE html><html><head><title>Google Calendar</title></head><body class="bg-[#0a0a0a] text-white p-8"><p>Invalid state token. Please try again.</p></body></html>`)
  }

  const clientId = (c.env as any).GMAIL_CLIENT_ID2 || (c.env as any).GMAIL_CLIENT_ID
  let clientSecret = (c.env as any).GMAIL_CLIENT_SECRET2 || (c.env as any).GMAIL_CLIENT_SECRET || ''
  if (!clientSecret) {
    try {
      const csRow = await c.env.DB.prepare(
        "SELECT setting_value FROM settings WHERE setting_key = 'gmail_client_secret' AND master_company_id = 1"
      ).first<any>()
      if (csRow?.setting_value) clientSecret = csRow.setting_value
    } catch {}
  }

  // P1-16: hardcode the OAuth redirect URI per-environment instead of
  // deriving from the request Host. Blocks Host-header attacks where a
  // rogue subdomain steers the code exchange elsewhere.
  const configuredBase = (c.env as any).APP_BASE_URL || 'https://www.roofmanager.ca'
  const url = new URL(c.req.url)
  const redirectUri = url.host.startsWith('localhost') || url.host.startsWith('0.0.0.0')
    ? `${url.protocol}//${url.host}/api/customer/gcal/callback`
    : `${configuredBase}/api/customer/gcal/callback`

  if (!clientId || !clientSecret) {
    return c.html(`<!DOCTYPE html><html><head><title>Google Calendar</title><link rel="stylesheet" href="/static/tailwind.css"></head>
<body class="bg-[#0a0a0a] min-h-screen flex items-center justify-center"><div class="bg-[#111] border border-white/10 rounded-2xl shadow-xl p-8 max-w-md text-center">
<div class="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4"><span class="text-red-400 text-2xl">⚠</span></div>
<h2 class="text-xl font-bold text-white mb-2">Configuration Error</h2>
<p class="text-gray-400 mb-4">Google OAuth credentials are not configured. Contact support.</p>
<button onclick="window.close()" class="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold">Close</button>
</div></body></html>`)
  }

  // Exchange code for tokens
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri
    }).toString()
  })

  const tokenData: any = await tokenResp.json()
  if (!tokenResp.ok || !tokenData.refresh_token) {
    return c.html(`<!DOCTYPE html><html><head><title>Google Calendar</title><link rel="stylesheet" href="/static/tailwind.css"></head>
<body class="bg-[#0a0a0a] min-h-screen flex items-center justify-center"><div class="bg-[#111] border border-white/10 rounded-2xl shadow-xl p-8 max-w-md text-center">
<div class="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-4"><span class="text-red-400 text-2xl">⚠</span></div>
<h2 class="text-xl font-bold text-white mb-2">Token Exchange Failed</h2>
<p class="text-gray-400 mb-1"><strong>Error:</strong> ${tokenData.error || (tokenData.refresh_token === undefined ? 'no_refresh_token' : 'unknown')}</p>
<p class="text-gray-400 mb-1"><strong>Description:</strong> ${tokenData.error_description || '(none)'}</p>
<p class="text-gray-500 text-xs mb-4"><strong>Redirect URI:</strong> ${redirectUri}</p>
<button onclick="window.close()" class="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold">Close</button>
</div></body></html>`)
  }

  // Get user email
  let gcalEmail = ''
  try {
    const profileResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    })
    const profile: any = await profileResp.json()
    gcalEmail = profile.email || ''
  } catch {}

  // Store tokens on the customer record
  const dbResult = await c.env.DB.prepare(`
    UPDATE customers SET gmail_refresh_token = ?, gmail_connected_email = ?, gmail_connected_at = datetime('now'), gcal_oauth_state = NULL WHERE id = ?
  `).bind(tokenData.refresh_token, gcalEmail, customerId).run()

  // Verify it was stored
  const verify = await c.env.DB.prepare(
    'SELECT gmail_refresh_token, gmail_connected_email FROM customers WHERE id = ?'
  ).bind(customerId).first<any>()

  return c.html(`<!DOCTYPE html>
<html><head><title>Google Calendar Connected</title>
<link rel="stylesheet" href="/static/tailwind.css">
</head>
<body class="bg-[#0a0a0a] min-h-screen flex items-center justify-center">
<div class="bg-[#111] border border-white/10 rounded-2xl shadow-xl p-8 max-w-md text-center">
  <div class="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4">
    <span class="text-green-400 text-2xl">✓</span>
  </div>
  <h2 class="text-xl font-bold text-white mb-2">Calendar Connected!</h2>
  <p class="text-gray-400 mb-1">Successfully connected:</p>
  <p class="text-blue-400 font-semibold mb-4">${gcalEmail}</p>
  <p class="text-sm text-gray-500 mb-6">Your Google Calendar events will now appear on your dashboard. This window will close automatically.</p>
  <button onclick="window.close()" class="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-blue-700">Close Window</button>
</div>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'gcal_connected', email: '${gcalEmail}' }, '*');
    setTimeout(function() { window.close(); }, 3000);
  }
</script>
</body></html>`)
})

// GET /gcal/status — Check calendar connection status
customerAuthRoutes.get('/gcal/status', async (c) => {
  const token = getCustomerSessionToken(c)
  if (!token) return c.json({ error: 'Not authenticated' }, 401)
  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  if (!session) return c.json({ error: 'Session expired' }, 401)

  const customer = await c.env.DB.prepare(
    'SELECT gmail_refresh_token, gmail_connected_email, gmail_connected_at FROM customers WHERE id = ?'
  ).bind(session.customer_id).first<any>()

  return c.json({
    connected: !!(customer?.gmail_refresh_token),
    email: customer?.gmail_connected_email || null,
    connected_at: customer?.gmail_connected_at || null,
    _debug_customer_id: session.customer_id,
    _debug_has_token: !!customer?.gmail_refresh_token,
    _debug_customer_found: !!customer
  })
})

// POST /gcal/disconnect — Disconnect Google Calendar
customerAuthRoutes.post('/gcal/disconnect', async (c) => {
  const token = getCustomerSessionToken(c)
  if (!token) return c.json({ error: 'Not authenticated' }, 401)
  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  if (!session) return c.json({ error: 'Session expired' }, 401)

  await c.env.DB.prepare(
    "UPDATE customers SET gmail_refresh_token = NULL, gmail_connected_email = NULL, gmail_connected_at = NULL WHERE id = ?"
  ).bind(session.customer_id).run()

  return c.json({ success: true })
})

// ============================================================
// REFERRAL PAYOUT — Request cash-out of pending commissions
// POST /api/customer/referrals/redeem
// Body: { payout_method: 'credits' | 'etransfer', etransfer_email?: string }
// ============================================================
customerAuthRoutes.post('/referrals/redeem', async (c) => {
  const token = getCustomerSessionToken(c)
  if (!token) return c.json({ error: 'Auth required' }, 401)

  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  if (!session) return c.json({ error: 'Session expired' }, 401)

  const customerId = session.customer_id

  let body: any = {}
  try { body = await c.req.json() } catch {}
  const { payout_method, etransfer_email } = body

  if (!payout_method || !['credits', 'etransfer'].includes(payout_method)) {
    return c.json({ error: "payout_method must be 'credits' or 'etransfer'" }, 400)
  }
  if (payout_method === 'etransfer' && !etransfer_email) {
    return c.json({ error: 'etransfer_email is required for e-transfer payouts' }, 400)
  }

  // Sum all pending commissions for this referrer
  const pending = await c.env.DB.prepare(
    "SELECT COALESCE(SUM(commission_earned), 0) as total FROM referral_earnings WHERE referrer_id = ? AND status = 'pending'"
  ).bind(customerId).first<any>()

  const amount = Number(pending?.total || 0)

  if (amount < 1) {
    return c.json({ error: 'No pending earnings to redeem. Minimum redemption is $1.00 CAD.' }, 400)
  }

  // Ensure the payout_requests table exists
  await c.env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS referral_payout_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payout_method TEXT NOT NULL,
      etransfer_email TEXT,
      status TEXT DEFAULT 'pending',
      admin_notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      processed_at TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )
  `).run()

  // Create the payout request
  const result = await c.env.DB.prepare(`
    INSERT INTO referral_payout_requests (customer_id, amount, payout_method, etransfer_email, status)
    VALUES (?, ?, ?, ?, 'pending')
  `).bind(customerId, amount, payout_method, etransfer_email || null).run()

  // Mark all pending earnings as 'requested' so they can't be double-redeemed
  await c.env.DB.prepare(
    "UPDATE referral_earnings SET status = 'requested' WHERE referrer_id = ? AND status = 'pending'"
  ).bind(customerId).run()

  // If payout_method is 'credits', convert immediately to report credits
  if (payout_method === 'credits') {
    // $1 CAD = 1 report credit (adjust ratio as needed)
    const creditsToAdd = Math.floor(amount)
    await c.env.DB.prepare(
      "UPDATE customers SET report_credits = report_credits + ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(creditsToAdd, customerId).run()

    // Mark earnings as paid
    await c.env.DB.prepare(
      "UPDATE referral_earnings SET status = 'paid' WHERE referrer_id = ? AND status = 'requested'"
    ).bind(customerId).run()

    // Mark payout request as completed
    await c.env.DB.prepare(
      "UPDATE referral_payout_requests SET status = 'completed', processed_at = datetime('now'), admin_notes = ? WHERE id = ?"
    ).bind(`Auto-converted $${amount.toFixed(2)} to ${creditsToAdd} report credits`, result.meta.last_row_id).run()

    return c.json({
      success: true,
      message: `$${amount.toFixed(2)} CAD converted to ${creditsToAdd} report credits and added to your account.`,
      payout_method: 'credits',
      amount_redeemed: amount,
      credits_added: creditsToAdd,
      payout_request_id: result.meta.last_row_id,
    })
  }

  // For e-transfer: create pending request for admin to process manually
  return c.json({
    success: true,
    message: `Payout request of $${amount.toFixed(2)} CAD submitted. You will receive an e-transfer to ${etransfer_email} within 3-5 business days.`,
    payout_method: 'etransfer',
    amount_redeemed: amount,
    etransfer_email,
    payout_request_id: result.meta.last_row_id,
    status: 'pending_admin_review',
  })
})

// ============================================================
// REFERRAL PAYOUT HISTORY — List all payout requests
// GET /api/customer/referrals/payouts
// ============================================================
customerAuthRoutes.get('/referrals/payouts', async (c) => {
  const token = getCustomerSessionToken(c)
  if (!token) return c.json({ error: 'Auth required' }, 401)

  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  if (!session) return c.json({ error: 'Session expired' }, 401)

  try {
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS referral_payout_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        payout_method TEXT NOT NULL,
        etransfer_email TEXT,
        status TEXT DEFAULT 'pending',
        admin_notes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        processed_at TEXT,
        FOREIGN KEY (customer_id) REFERENCES customers(id)
      )
    `).run()

    const payouts = await c.env.DB.prepare(
      'SELECT * FROM referral_payout_requests WHERE customer_id = ? ORDER BY created_at DESC'
    ).bind(session.customer_id).all<any>()

    return c.json({ payouts: payouts.results || [] })
  } catch (err: any) {
    return c.json({ payouts: [], error: err.message })
  }
})

// ============================================================
// MAGIC LINK — Send sign-in/sign-up link via email
// ============================================================
customerAuthRoutes.post('/magic-link', async (c) => {
  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid_body' }, 400) }
  const email = (body.email || '').trim().toLowerCase()
  if (!email || !email.includes('@')) return c.json({ error: 'invalid_email' }, 400)

  const db = (c.env as any).DB
  const tokenBytes = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b: number) => b.toString(16).padStart(2, '0')).join('')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

  // Check if customer exists
  const existing = await db.prepare('SELECT id FROM customers WHERE email = ?').bind(email).first()
  const tokenType = existing ? 'signin' : 'signup'

  await db.prepare('INSERT INTO magic_link_tokens (token, email, token_type, expires_at) VALUES (?, ?, ?, ?)')
    .bind(tokenBytes, email, tokenType, expiresAt).run()

  const magicUrl = `https://www.roofmanager.ca/auth/magic?token=${tokenBytes}`
  const subject = 'Your Roof Manager sign-in link'
  const htmlBody = `
    <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px">
      <h2 style="color:#0A0A0A">Sign in to Roof Manager</h2>
      <p>Click the button below to sign in. This link expires in 15 minutes.</p>
      <a href="${magicUrl}" style="display:inline-block;background:#00FF88;color:#0A0A0A;font-weight:700;padding:14px 28px;border-radius:10px;text-decoration:none;font-size:16px;margin:16px 0">
        Sign in to Roof Manager &rarr;
      </a>
      <p style="color:#6b7280;font-size:13px">If you didn't request this, you can safely ignore this email.</p>
    </div>
  `

  // Send email using Resend if available
  const resendKey = (c.env as any).RESEND_API_KEY
  if (resendKey) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: 'Roof Manager <noreply@roofmanager.ca>', to: [email], subject, html: htmlBody })
      })
    } catch (err: any) {
      console.error('magic link email error:', err)
    }
  } else {
    console.log('MAGIC LINK (no email service configured):', magicUrl)
  }

  return c.json({ success: true })
})

// ============================================================
// SIGNUP RECOVERY OPT-OUT
// GET /api/customer/signup-optout?email=...
// ============================================================
customerAuthRoutes.get('/signup-optout', async (c) => {
  const email = (c.req.query('email') || '').trim().toLowerCase()
  if (!email) return c.html('<p>Invalid link.</p>', 400)
  const db = (c.env as any).DB
  try {
    await db.prepare('INSERT OR IGNORE INTO signup_recovery_optouts (email) VALUES (?)').bind(email).run()
  } catch (err: any) {
    console.warn('[signup-optout] DB error:', err?.message || err)
  }
  return c.html(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Unsubscribed</title></head><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0"><div style="text-align:center;max-width:400px;padding:32px"><h2 style="color:#0A0A0A">You're unsubscribed</h2><p style="color:#6b7280">You won't receive any more signup reminder emails from Roof Manager.</p><a href="/" style="color:#00CC6A;text-decoration:none;font-weight:600">← Back to Roof Manager</a></div></body></html>`)
})

// ============================================================
// SIGNUP STARTED — abandoned signup capture
// ============================================================
customerAuthRoutes.post('/signup-started', async (c) => {
  let body: any
  try { body = await c.req.json() } catch { return c.json({ success: true }) }
  const email = (body.email || '').trim().toLowerCase()
  if (!email || !email.includes('@')) return c.json({ success: true })

  const db = (c.env as any).DB

  // If completed=true, mark existing attempts as completed
  if (body.completed) {
    await db.prepare('UPDATE signup_attempts SET completed = 1 WHERE email = ? AND completed = 0').bind(email).run().catch(() => {})
    return c.json({ success: true })
  }

  // Insert or ignore if already exists today
  try {
    const existing = await db.prepare(
      "SELECT id FROM signup_attempts WHERE email = ? AND date(created_at) = date('now')"
    ).bind(email).first()

    if (!existing) {
      const utm = body.utm || {}
      await db.prepare(`
        INSERT INTO signup_attempts (email, preview_id, utm_source, utm_medium, utm_campaign)
        VALUES (?, ?, ?, ?, ?)
      `).bind(email, body.preview_id || '', utm.source || '', utm.medium || '', utm.campaign || '').run()
    }
  } catch (err: any) {
    // signup_attempts table may not exist yet — non-fatal
    console.warn('[signup-started] DB error (non-fatal):', err?.message || err)
  }

  return c.json({ success: true })
})

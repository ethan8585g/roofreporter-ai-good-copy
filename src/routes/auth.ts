import { Hono } from 'hono'
import type { Bindings } from '../types'
import { hashPassword, verifyPassword, isLegacyHash, dummyVerify } from '../lib/password'

export const authRoutes = new Hono<{ Bindings: Bindings }>()

// ============================================================
// ADMIN SESSION MANAGEMENT — DB-backed sessions with expiry
// Replaces the old "return token but never validate it" approach
// ============================================================
async function createAdminSession(db: D1Database, adminId: number): Promise<string> {
  const token = crypto.randomUUID() + '-' + crypto.randomUUID()
  // P1-01: 7-day rolling session expiry (renewed on each valid request).
  // Shrinks blast radius of a stolen token from 30 days to 7.
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  
  await db.prepare(`
    INSERT INTO admin_sessions (admin_id, session_token, expires_at)
    VALUES (?, ?, ?)
  `).bind(adminId, token, expiresAt).run()
  
  return token
}

// P0-05: cookie name used for the HttpOnly admin session cookie.
export const ADMIN_SESSION_COOKIE = 'rm_admin_session'

function readCookieValue(cookieHeader: string | undefined | null, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(/;\s*/)) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    // Phase 2 #5: trim the cookie name. Some clients send `; rm_admin_session=…`
    // with a leading space the `\s*` split misses on the first segment.
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1))
  }
  return null
}

// Exported: validate admin session token and return admin user. Accepts the
// token via Authorization: Bearer (legacy) OR the rm_admin_session cookie
// (P0-05: HttpOnly, so safe from XSS exfiltration). Callers can pass the
// cookie header as an optional third arg; callers that don't stay on Bearer.
export async function validateAdminSession(
  db: D1Database,
  authHeader: string | undefined,
  cookieHeader?: string | undefined
): Promise<any | null> {
  // Tolerate `Bearer ` (empty) — happens when a client does
  // `'Bearer ' + localStorage.getItem(key)` and the key is missing. Fall
  // back to the cookie in that case.
  let token: string | null = null
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const t = authHeader.slice(7).trim()
    if (t) token = t
  }
  if (!token) token = readCookieValue(cookieHeader, ADMIN_SESSION_COOKIE)
  if (!token) return null

  const session = await db.prepare(`
    SELECT s.admin_id, a.id, a.email, a.name, a.role, a.company_name, a.is_active
    FROM admin_sessions s
    JOIN admin_users a ON a.id = s.admin_id
    WHERE s.session_token = ? AND s.expires_at > datetime('now') AND a.is_active = 1
  `).bind(token).first<any>()

  // P1-01: rolling renewal also uses the shorter 7-day window.
  // Phase 3 #9: await the renewal so a failed UPDATE can't quietly let the
  // session expire without anyone noticing. The latency cost is one indexed
  // UPDATE on a row we already touched in the SELECT above.
  if (session) {
    const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    try {
      await db.prepare('UPDATE admin_sessions SET expires_at = ? WHERE session_token = ?').bind(newExpiry, token).run()
    } catch (e: any) {
      console.warn('[auth] admin-session renewal failed:', e?.message || e)
    }
  }

  return session
}

// Exported: require superadmin role middleware helper
export function requireSuperadmin(admin: any): boolean {
  return admin && admin.role === 'superadmin'
}

// ============================================================
// BOOTSTRAP — First admin account created from env vars
// Set ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD in .dev.vars
// or Cloudflare secrets. Used ONLY for initial setup.
// After first login, change password and remove env vars.
// ============================================================
async function ensureBootstrapAdmin(db: D1Database, env: any): Promise<void> {
  // Check if admin_sessions table exists (part of the migration)
  try {
    await db.prepare('SELECT 1 FROM admin_sessions LIMIT 0').run()
  } catch {
    // Create admin_sessions table if it doesn't exist
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id INTEGER NOT NULL,
        session_token TEXT UNIQUE NOT NULL,
        expires_at TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
      )
    `).run()
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(session_token)').run()
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id)').run()
  }

  // Phase 1 #4: race-safe bootstrap. Two concurrent Workers requests can both
  // see count=0; the conditional INSERT below makes the create atomic at the
  // SQL layer so only one superadmin ever gets seeded.
  const adminCount = await db.prepare('SELECT COUNT(*) as count FROM admin_users').first<any>()
  if (adminCount && adminCount.count > 0) return // Already have admins

  // Bootstrap from env vars
  const bootstrapEmail = env.ADMIN_BOOTSTRAP_EMAIL
  const bootstrapPassword = env.ADMIN_BOOTSTRAP_PASSWORD
  const bootstrapName = env.ADMIN_BOOTSTRAP_NAME || 'Admin'

  if (!bootstrapEmail || !bootstrapPassword) {
    console.warn('[Auth] No admin users exist and ADMIN_BOOTSTRAP_EMAIL/PASSWORD not set. Admin login will fail.')
    return
  }

  const storedHash = await hashPassword(bootstrapPassword)

  // INSERT … SELECT WHERE NOT EXISTS makes the "no admins yet" check and the
  // insert one atomic statement. If another request races and seeds first,
  // this insert produces 0 rows and we leave the existing superadmin in place.
  const result = await db.prepare(`
    INSERT INTO admin_users (email, password_hash, name, role, company_name, is_active)
    SELECT ?, ?, ?, 'superadmin', 'Roof Manager', 1
    WHERE NOT EXISTS (SELECT 1 FROM admin_users)
  `).bind(bootstrapEmail.toLowerCase().trim(), storedHash, bootstrapName).run()

  const inserted = (result?.meta as any)?.changes ?? 0
  if (inserted > 0) {
    console.log(`[Auth] Bootstrap admin created: ${bootstrapEmail}`)
  } else {
    console.log('[Auth] Bootstrap admin not created — another request seeded first')
  }
}

// ============================================================
// ADMIN LOGIN — Validates against admin_users DB table
// No hardcoded credentials. Password checked via hash.
// ============================================================
authRoutes.post('/login', async (c) => {
  try {
    const { email, password } = await c.req.json()

    if (!email || !password) {
      return c.json({ error: 'Email and password are required' }, 400)
    }

    const cleanEmail = email.toLowerCase().trim()

    // Ensure bootstrap admin exists (idempotent)
    await ensureBootstrapAdmin(c.env.DB, c.env)

    // Look up admin user in DB
    const user = await c.env.DB.prepare(
      'SELECT * FROM admin_users WHERE email = ? AND is_active = 1'
    ).bind(cleanEmail).first<any>()

    if (!user) {
      // P1-08: run a dummy verify so login latency looks identical whether
      // or not the email exists (defeat timing-based email enumeration).
      await dummyVerify(password)
      return c.json({ error: 'Admin access is restricted. Use the customer portal at /customer/login' }, 403)
    }

    // Verify hashed password
    if (!user.password_hash) {
      return c.json({ error: 'Account not properly configured. Contact admin.' }, 500)
    }

    const valid = await verifyPassword(password, user.password_hash)
    if (!valid) {
      return c.json({ error: 'Invalid password' }, 401)
    }

    // P0-03: transparently upgrade legacy hashes after a successful login.
    if (isLegacyHash(user.password_hash)) {
      try {
        const fresh = await hashPassword(password)
        await c.env.DB.prepare("UPDATE admin_users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(fresh, user.id).run()
      } catch (e) {
        console.warn('[auth] hash upgrade failed:', (e as any)?.message)
      }
    }

    // Update last login
    await c.env.DB.prepare(
      "UPDATE admin_users SET last_login = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).bind(user.id).run()

    // Ensure master company exists
    const masterExists = await c.env.DB.prepare('SELECT id FROM master_companies LIMIT 1').first()
    if (!masterExists) {
      await c.env.DB.prepare(`
        INSERT INTO master_companies (company_name, contact_name, email, phone)
        VALUES ('Roof Manager', ?, ?, '')
      `).bind(user.name, cleanEmail).run()
    }

    // Create session (DB-stored, validated on every request)
    const sessionToken = await createAdminSession(c.env.DB, user.id)

    // Log activity
    try {
      await c.env.DB.prepare(`
        INSERT INTO user_activity_log (company_id, action, details)
        VALUES (1, 'admin_login', ?)
      `).bind(`Admin login: ${cleanEmail} (${user.role})`).run()
    } catch {}

    // P0-05: also issue an HttpOnly, Secure, SameSite=Lax cookie. Clients
    // that migrate to cookie-auth will no longer need to stash the token in
    // localStorage. Legacy Bearer flow still works while the frontend migrates.
    // P1-01: cookie lifetime matches the session lifetime (7 days).
    const maxAge = 7 * 24 * 60 * 60
    c.header('Set-Cookie', `${ADMIN_SESSION_COOKIE}=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`, { append: true })

    return c.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        company_name: user.company_name || 'Roof Manager',
        last_login: new Date().toISOString()
      },
      token: sessionToken
    })
  } catch (err: any) {
    // Phase 2 #7: log full detail server-side, return a generic message.
    console.error('[auth] /login 500:', err?.message || err)
    return c.json({ error: 'Login failed. Please try again.' }, 500)
  }
})

// ============================================================
// REGISTER — Disabled for admin portal.
// ============================================================
authRoutes.post('/register', async (c) => {
  return c.json({
    error: 'Admin registration is disabled. Only the owner account has admin access.',
    redirect: '/customer/login',
    message: 'Please use the customer portal to create an account.'
  }, 403)
})

// ============================================================
// GET CURRENT USER — Validates session token in DB
// ============================================================
authRoutes.get('/me', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) {
    return c.json({ error: 'Not authenticated or session expired' }, 401)
  }

  return c.json({
    user: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      company_name: admin.company_name
    }
  })
})

// ============================================================
// LIST USERS (admin only)
// ============================================================
authRoutes.get('/users', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) {
    return c.json({ error: 'Superadmin access required' }, 403)
  }

  try {
    const users = await c.env.DB.prepare(
      'SELECT id, email, name, role, company_name, phone, is_active, last_login, created_at FROM admin_users ORDER BY created_at DESC'
    ).all()
    return c.json({ users: users.results })
  } catch (err: any) {
    // Phase 2 #7
    console.error('[auth] /list-users 500:', err?.message || err)
    return c.json({ error: 'Failed to list users.' }, 500)
  }
})

// ============================================================
// CHANGE PASSWORD — Admin changes own password
// ============================================================
authRoutes.post('/change-password', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) {
    return c.json({ error: 'Not authenticated' }, 401)
  }

  try {
    const { current_password, new_password } = await c.req.json()
    if (!current_password || !new_password) {
      return c.json({ error: 'Current and new password required' }, 400)
    }
    if (new_password.length < 8) {
      return c.json({ error: 'New password must be at least 8 characters' }, 400)
    }

    // Verify current password
    const user = await c.env.DB.prepare(
      'SELECT password_hash FROM admin_users WHERE id = ?'
    ).bind(admin.admin_id || admin.id).first<any>()

    if (!user || !await verifyPassword(current_password, user.password_hash)) {
      return c.json({ error: 'Current password is incorrect' }, 401)
    }

    // Set new password
    const storedHash = await hashPassword(new_password)
    await c.env.DB.prepare(
      "UPDATE admin_users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(storedHash, admin.admin_id || admin.id).run()

    // P1-03/P1-04: invalidate all sessions for this admin on credential change
    await c.env.DB.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').bind(admin.admin_id || admin.id).run().catch(() => {})

    return c.json({ success: true, message: 'Password changed successfully' })
  } catch (err: any) {
    // Phase 2 #7
    console.error('[auth] /change-password 500:', err?.message || err)
    return c.json({ error: 'Failed to change password.' }, 500)
  }
})

// ============================================================
// ADMIN FORGOT PASSWORD — Send reset link to admin email
// ============================================================
authRoutes.post('/forgot-password', async (c) => {
  try {
    const { email } = await c.req.json()
    const cleanEmail = email?.toLowerCase().trim()
    if (!cleanEmail) return c.json({ error: 'Email is required' }, 400)

    // Always return success to prevent email enumeration
    const admin = await c.env.DB.prepare(
      'SELECT id, name FROM admin_users WHERE email = ? AND is_active = 1'
    ).bind(cleanEmail).first<any>()

    if (admin) {
      const recent = await c.env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM password_reset_tokens WHERE email = ? AND account_type = 'admin' AND created_at > datetime('now', '-30 minutes')"
      ).bind(cleanEmail).first<any>()

      if (!recent || recent.cnt < 1) {
        const token = crypto.randomUUID() + '-' + crypto.randomUUID()
        // P0-06: tighten expiry from 60 → 30 minutes.
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()

        await c.env.DB.prepare(
          "UPDATE password_reset_tokens SET used = 1 WHERE email = ? AND account_type = 'admin' AND used = 0"
        ).bind(cleanEmail).run()

        // Phase 1 #2: bind admin_id so reset consumes by ID, not email.
        await c.env.DB.prepare(
          "INSERT INTO password_reset_tokens (email, token, account_type, expires_at, admin_id) VALUES (?, ?, 'admin', ?, ?)"
        ).bind(cleanEmail, token, expiresAt, admin.id).run()

        const baseUrl = (c.env as any).APP_BASE_URL || 'https://www.roofmanager.ca'
        const resetUrl = `${baseUrl}/reset-password?token=${token}`
        const resendKey = (c.env as any).RESEND_API_KEY
        const html = `<div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:40px 20px"><div style="text-align:center;margin-bottom:32px"><div style="background:#000;padding:20px;border-radius:12px;display:inline-block"><img src="https://www.roofmanager.ca/static/logo.png" alt="Roof Manager" width="180" style="max-width:180px;height:auto;display:block"/></div><p style="color:#6b7280;font-size:14px;margin:12px 0 0">Admin Password Reset</p></div><div style="background:#f8fafc;border-radius:16px;padding:32px;text-align:center"><p style="color:#374151;font-size:16px;margin:0 0 8px">Hi ${admin.name || 'Admin'},</p><p style="color:#6b7280;font-size:14px;margin:0 0 28px">Click below to reset your admin password. This link expires in 1 hour.</p><a href="${resetUrl}" style="display:inline-block;background:#0ea5e9;color:white;font-weight:700;font-size:15px;padding:14px 32px;border-radius:10px;text-decoration:none">Reset Admin Password</a><p style="color:#9ca3af;font-size:12px;margin:24px 0 0">If you didn't request this, your password remains unchanged.</p></div></div>`

        let sent = false
        if (resendKey) {
          try {
            const resp = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ from: `Roof Manager <noreply@roofmanager.ca>`, to: [cleanEmail], subject: 'Reset your Roof Manager admin password', html })
            })
            if (resp.ok) sent = true
            else console.error('[AdminPasswordReset] Resend failed:', await resp.text())
          } catch (e: any) { console.error('[AdminPasswordReset] Resend error:', e?.message || e) }
        }
        if (!sent) {
          // Fallback: Gmail OAuth2
          const gmailRefreshToken = (c.env as any).GMAIL_REFRESH_TOKEN || ''
          const gmailClientId = (c.env as any).GMAIL_CLIENT_ID || ''
          const gmailClientSecret = (c.env as any).GMAIL_CLIENT_SECRET || ''
          if (gmailRefreshToken && gmailClientId && gmailClientSecret) {
            try {
              const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: gmailRefreshToken, client_id: gmailClientId, client_secret: gmailClientSecret }).toString()
              })
              const tokenData: any = await tokenResp.json()
              if (tokenData.access_token) {
                const senderEmail = (c.env as any).GMAIL_SENDER_EMAIL || 'sales@roofmanager.ca'
                const rawEmail = [`From: Roof Manager <${senderEmail}>`, `To: ${cleanEmail}`, `Subject: Reset your Roof Manager admin password`, 'Content-Type: text/html; charset=UTF-8', '', html].join('\r\n')
                const encoded = btoa(unescape(encodeURIComponent(rawEmail))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
                const sendResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({ raw: encoded })
                })
                if (!sendResp.ok) console.error('[AdminPasswordReset] Gmail send failed:', await sendResp.text())
              }
            } catch (e: any) { console.error('[AdminPasswordReset] Gmail error:', e?.message || e) }
          } else {
            console.error('[AdminPasswordReset] No email transport configured for:', cleanEmail)
          }
        }
      }
    }

    // P1-07: generic message (not "admin account") to avoid email-enumeration.
    return c.json({ success: true, message: "If an account exists, we've sent instructions." })
  } catch (err: any) {
    // Phase 2 #7
    console.error('[auth] /forgot-password 500:', err?.message || err)
    return c.json({ error: 'Failed to process request.' }, 500)
  }
})

// ============================================================
// ADMIN RESET PASSWORD — Validate token and set new password
// ============================================================
authRoutes.post('/reset-password', async (c) => {
  try {
    const { token, new_password } = await c.req.json()
    if (!token || !new_password) return c.json({ error: 'Token and new password are required' }, 400)
    if (new_password.length < 8) return c.json({ error: 'Password must be at least 8 characters' }, 400)

    const record = await c.env.DB.prepare(
      "SELECT * FROM password_reset_tokens WHERE token = ? AND account_type = 'admin' AND used = 0 AND expires_at > datetime('now')"
    ).bind(token).first<any>()

    if (!record) {
      return c.json({ error: 'This reset link is invalid or has expired. Please request a new one.' }, 400)
    }

    // Phase 1 #2: prefer admin_id from the token row. Tokens issued before
    // migration 0200 won't have it; fall back to email lookup for those.
    let targetAdminId: number | null = record.admin_id ? Number(record.admin_id) : null
    if (!targetAdminId) {
      const admin = await c.env.DB.prepare('SELECT id FROM admin_users WHERE email = ?').bind(record.email).first<any>()
      targetAdminId = admin?.id ? Number(admin.id) : null
    }
    if (!targetAdminId) {
      return c.json({ error: 'This reset link is invalid or has expired. Please request a new one.' }, 400)
    }

    const storedHash = await hashPassword(new_password)

    await c.env.DB.prepare(
      "UPDATE admin_users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(storedHash, targetAdminId).run()

    await c.env.DB.prepare(
      'UPDATE password_reset_tokens SET used = 1 WHERE token = ?'
    ).bind(token).run()

    // P1-03: invalidate all sessions for this admin on password reset
    await c.env.DB.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').bind(targetAdminId).run().catch(() => {})

    return c.json({ success: true, message: 'Admin password updated. You can now sign in.' })
  } catch (err: any) {
    // Phase 2 #7
    console.error('[auth] /reset-password 500:', err?.message || err)
    return c.json({ error: 'Failed to reset password.' }, 500)
  }
})

// ============================================================
// ADMIN LOGOUT — Invalidate session (P1-02: await + assert changes)
// ============================================================
authRoutes.post('/logout', async (c) => {
  const authHeader = c.req.header('Authorization')
  const cookieHeader = c.req.header('Cookie') || ''
  let token: string | null = null
  if (authHeader?.startsWith('Bearer ')) token = authHeader.slice(7)
  if (!token) {
    for (const part of cookieHeader.split(/;\s*/)) {
      // Phase 2 #5: trim before comparing so leading-space cookie segments still match.
      const seg = part.trim()
      if (seg.startsWith(`${ADMIN_SESSION_COOKIE}=`)) { token = decodeURIComponent(seg.slice(ADMIN_SESSION_COOKIE.length + 1)); break }
    }
  }
  if (token) {
    await c.env.DB.prepare('DELETE FROM admin_sessions WHERE session_token = ?').bind(token).run()
  }
  // Clear the cookie on the client.
  c.header('Set-Cookie', `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`, { append: true })
  return c.json({ success: true })
})

// ============================================================
// ADMIN DASHBOARD API — Extended stats for all tabs
// Protected by session validation
// ============================================================
authRoutes.get('/admin-stats', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) {
    return c.json({ error: 'Not authenticated' }, 401)
  }

  try {
    // All customers with order/invoice aggregates (revenue excludes trial orders)
    const customers = await c.env.DB.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) as order_count,
        (SELECT COALESCE(SUM(o.price), 0) FROM orders o WHERE o.customer_id = c.id AND o.payment_status = 'paid' AND (o.is_trial IS NULL OR o.is_trial = 0) AND (o.notes IS NULL OR o.notes NOT LIKE 'Paid via credit balance%'))
          + (SELECT COALESCE(SUM(mp.amount), 0) FROM manual_payments mp WHERE mp.customer_id = c.id) as total_spent,
        (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id) as invoice_count,
        (SELECT COALESCE(SUM(i.total), 0) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'paid') as invoices_paid,
        (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id = c.id) as last_order_date,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.is_trial = 1) as trial_orders
      FROM customers c
      ORDER BY c.created_at DESC
    `).all()

    // Earnings by month (last 12 months)
    const monthlyEarnings = await c.env.DB.prepare(`
      SELECT 
        strftime('%Y-%m', created_at) as month,
        COUNT(*) as order_count,
        SUM(CASE WHEN payment_status = 'paid' AND (is_trial IS NULL OR is_trial = 0) THEN price ELSE 0 END) as revenue,
        SUM(CASE WHEN is_trial IS NULL OR is_trial = 0 THEN price ELSE 0 END) as total_value,
        SUM(CASE WHEN is_trial = 1 THEN 1 ELSE 0 END) as trial_count
      FROM orders
      WHERE created_at >= date('now', '-12 months')
      GROUP BY strftime('%Y-%m', created_at)
      ORDER BY month DESC
    `).all()

    // Earnings by week (last 8 weeks). Excludes trials and credit-redemption
    // orders so the weekly chart matches the other revenue rollups.
    const weeklyEarnings = await c.env.DB.prepare(`
      SELECT
        strftime('%Y-W%W', created_at) as week,
        COUNT(*) as order_count,
        SUM(CASE WHEN payment_status = 'paid' AND (is_trial IS NULL OR is_trial = 0) AND (notes IS NULL OR notes NOT LIKE 'Paid via credit balance%') THEN price ELSE 0 END) as revenue
      FROM orders
      WHERE created_at >= date('now', '-8 weeks')
      GROUP BY strftime('%Y-W%W', created_at)
      ORDER BY week DESC
    `).all()

    // Today's earnings
    const todayStats = await c.env.DB.prepare(`
      SELECT 
        COUNT(*) as orders_today,
        SUM(CASE WHEN payment_status = 'paid' AND (is_trial IS NULL OR is_trial = 0) THEN price ELSE 0 END) as revenue_today,
        SUM(CASE WHEN is_trial IS NULL OR is_trial = 0 THEN price ELSE 0 END) as value_today,
        SUM(CASE WHEN is_trial = 1 THEN 1 ELSE 0 END) as trial_orders_today
      FROM orders
      WHERE date(created_at) = date('now')
    `).first()

    // This week's earnings
    const weekStats = await c.env.DB.prepare(`
      SELECT 
        COUNT(*) as orders_week,
        SUM(CASE WHEN payment_status = 'paid' AND (is_trial IS NULL OR is_trial = 0) THEN price ELSE 0 END) as revenue_week,
        SUM(CASE WHEN is_trial = 1 THEN 1 ELSE 0 END) as trial_orders_week
      FROM orders
      WHERE created_at >= date('now', 'weekday 0', '-7 days')
    `).first()

    // This month's earnings
    const monthStats = await c.env.DB.prepare(`
      SELECT 
        COUNT(*) as orders_month,
        SUM(CASE WHEN payment_status = 'paid' AND (is_trial IS NULL OR is_trial = 0) THEN price ELSE 0 END) as revenue_month,
        SUM(CASE WHEN is_trial = 1 THEN 1 ELSE 0 END) as trial_orders_month
      FROM orders
      WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
    `).first()

    // All-time revenue
    const allTimeStats = await c.env.DB.prepare(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(price) as total_value,
        SUM(CASE WHEN payment_status = 'paid' AND (is_trial IS NULL OR is_trial = 0) THEN price ELSE 0 END) as total_collected,
        SUM(CASE WHEN payment_status NOT IN ('paid','trial') THEN price ELSE 0 END) as total_outstanding,
        AVG(CASE WHEN is_trial = 0 OR is_trial IS NULL THEN price ELSE NULL END) as avg_order_value,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_orders,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_orders,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_orders,
        SUM(CASE WHEN is_trial = 1 THEN 1 ELSE 0 END) as trial_orders,
        SUM(CASE WHEN is_trial = 0 OR is_trial IS NULL THEN 1 ELSE 0 END) as paid_orders
      FROM orders
    `).first()

    // Free trial statistics
    let trialStats: any = {}
    try {
      trialStats = await c.env.DB.prepare(`
        SELECT
          COUNT(*) as total_customers,
          SUM(CASE WHEN free_trial_total > 0 THEN 1 ELSE 0 END) as trial_eligible,
          SUM(free_trial_used) as total_trial_reports_used,
          SUM(free_trial_total) as total_trial_reports_available,
          SUM(CASE WHEN free_trial_used > 0 THEN 1 ELSE 0 END) as customers_who_used_trial,
          SUM(CASE WHEN free_trial_used >= free_trial_total AND free_trial_total > 0 THEN 1 ELSE 0 END) as exhausted_trial,
          SUM(CASE WHEN report_credits > 0 OR credits_used > 0 THEN 1 ELSE 0 END) as paying_customers,
          SUM(report_credits) as total_paid_credits_purchased,
          SUM(credits_used) as total_paid_credits_used
        FROM customers
      `).first() || {}
    } catch(e) {}

    // Payments received
    const payments = await c.env.DB.prepare(`
      SELECT p.*, o.order_number, o.property_address, o.homeowner_name
      FROM payments p
      LEFT JOIN orders o ON p.order_id = o.id
      ORDER BY p.created_at DESC
      LIMIT 50
    `).all()

    // Invoice stats
    const invoiceStats = await c.env.DB.prepare(`
      SELECT 
        COUNT(*) as total_invoices,
        SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END) as total_collected,
        SUM(CASE WHEN status IN ('sent','viewed') THEN total ELSE 0 END) as total_outstanding,
        SUM(CASE WHEN status = 'overdue' THEN total ELSE 0 END) as total_overdue,
        SUM(CASE WHEN status = 'draft' THEN total ELSE 0 END) as total_draft
      FROM invoices
    `).first()

    // All invoices
    const invoices = await c.env.DB.prepare(`
      SELECT i.*, c.name as customer_name, c.email as customer_email, c.company_name as customer_company,
        o.order_number, o.property_address
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      LEFT JOIN orders o ON i.order_id = o.id
      ORDER BY i.created_at DESC
    `).all()

    // Sales pipeline
    const salesPipeline = await c.env.DB.prepare(`
      SELECT 
        status,
        COUNT(*) as count,
        SUM(price) as total_value
      FROM orders
      GROUP BY status
    `).all()

    // Conversion rate
    const conversionStats = await c.env.DB.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as converted
      FROM orders
    `).first()

    // Top customers by revenue
    const topCustomers = await c.env.DB.prepare(`
      SELECT c.name, c.email, c.company_name,
        COUNT(o.id) as order_count,
        SUM(CASE WHEN o.is_trial IS NULL OR o.is_trial = 0 THEN o.price ELSE 0 END) as total_value,
        SUM(CASE WHEN o.payment_status = 'paid' AND (o.is_trial IS NULL OR o.is_trial = 0) THEN o.price ELSE 0 END) as paid_value,
        SUM(CASE WHEN o.is_trial = 1 THEN 1 ELSE 0 END) as trial_orders
      FROM customers c
      JOIN orders o ON o.customer_id = c.id
      GROUP BY c.id
      ORDER BY total_value DESC
      LIMIT 10
    `).all()

    // Tier breakdown
    const tierStats = await c.env.DB.prepare(`
      SELECT service_tier, COUNT(*) as count, SUM(price) as total_value,
        SUM(CASE WHEN payment_status = 'paid' THEN price ELSE 0 END) as paid_value
      FROM orders GROUP BY service_tier
    `).all()

    // Customer growth (signups by month)
    const customerGrowth = await c.env.DB.prepare(`
      SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as signups
      FROM customers
      WHERE created_at >= date('now', '-12 months')
      GROUP BY strftime('%Y-%m', created_at)
      ORDER BY month DESC
    `).all()

    // Recent activity
    const recentActivity = await c.env.DB.prepare(`
      SELECT * FROM user_activity_log ORDER BY created_at DESC LIMIT 30
    `).all()

    // API usage
    const apiUsage = await c.env.DB.prepare(`
      SELECT request_type, COUNT(*) as count, 
        AVG(duration_ms) as avg_duration,
        SUM(CASE WHEN response_status >= 200 AND response_status < 300 THEN 1 ELSE 0 END) as success_count
      FROM api_requests_log
      WHERE created_at >= date('now', '-30 days')
      GROUP BY request_type
    `).all()

    // Recent orders
    const recentOrders = await c.env.DB.prepare(`
      SELECT o.*, c.name as customer_name, c.email as customer_email
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      ORDER BY o.created_at DESC
      LIMIT 50
    `).all()

    // Report stats
    let reportStats: any = {}
    try {
      reportStats = await c.env.DB.prepare(`
        SELECT
          COUNT(*) as total_reports,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_reports,
          AVG(gross_squares) as avg_squares,
          AVG(total_material_cost_cad) as avg_material_cost,
          SUM(total_material_cost_cad) as total_material_value,
          AVG(confidence_score) as avg_confidence
        FROM reports
      `).first() || {}
    } catch (e) {}

    return c.json({
      customers: customers.results,
      monthly_earnings: monthlyEarnings.results,
      weekly_earnings: weeklyEarnings.results,
      today: todayStats,
      this_week: weekStats,
      this_month: monthStats,
      all_time: allTimeStats,
      trial_stats: trialStats,
      payments: payments.results,
      invoice_stats: invoiceStats,
      invoices: invoices.results,
      sales_pipeline: salesPipeline.results,
      conversion: conversionStats,
      top_customers: topCustomers.results,
      tier_stats: tierStats.results,
      customer_growth: customerGrowth.results,
      recent_activity: recentActivity.results,
      api_usage: apiUsage.results,
      recent_orders: recentOrders.results,
      report_stats: reportStats
    })
  } catch (err: any) {
    // Phase 2 #7
    console.error('[auth] /admin-stats 500:', err?.message || err)
    return c.json({ error: 'Failed to load admin stats.' }, 500)
  }
})

// ============================================================
// GMAIL OAUTH2 — One-time authorization for personal Gmail
// Protected by admin session
// ============================================================

// Helper: get a setting value from the settings table
async function getDbSetting(db: any, key: string): Promise<string | null> {
  try {
    const row = await db.prepare(
      "SELECT setting_value FROM settings WHERE setting_key = ? AND master_company_id = 1"
    ).bind(key).first<any>()
    return row?.setting_value || null
  } catch (e) { return null }
}

// Helper: save a setting value to the settings table
async function setDbSetting(db: any, key: string, value: string, encrypted = false): Promise<void> {
  const existing = await db.prepare(
    "SELECT id FROM settings WHERE setting_key = ? AND master_company_id = 1"
  ).bind(key).first<any>()
  if (existing) {
    await db.prepare(
      "UPDATE settings SET setting_value = ?, is_encrypted = ?, updated_at = datetime('now') WHERE setting_key = ? AND master_company_id = 1"
    ).bind(value, encrypted ? 1 : 0, key).run()
  } else {
    await db.prepare(
      "INSERT INTO settings (master_company_id, setting_key, setting_value, is_encrypted) VALUES (1, ?, ?, ?)"
    ).bind(key, value, encrypted ? 1 : 0).run()
  }
}

// POST /api/auth/gmail/setup — Save Gmail OAuth client secret from GCP console
authRoutes.post('/gmail/setup', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Admin authentication required' }, 401)

  const { client_secret } = await c.req.json()
  if (!client_secret || client_secret.length < 10) {
    return c.json({ error: 'Valid Gmail OAuth client secret is required' }, 400)
  }

  // Store in DB
  await setDbSetting(c.env.DB, 'gmail_client_secret', client_secret, true)

  return c.json({
    success: true,
    message: 'Gmail client secret saved. Now visit /api/auth/gmail to complete authorization.',
    next_step: '/api/auth/gmail'
  })
})

authRoutes.get('/gmail', async (c) => {
  // Allow without auth for browser redirect flow (OAuth callback)
  
  const clientId = (c.env as any).GMAIL_CLIENT_ID
  if (!clientId) {
    return c.json({
      error: 'GMAIL_CLIENT_ID not configured',
      setup: {
        step1: 'Go to https://console.cloud.google.com/apis/credentials',
        step2: 'Create OAuth 2.0 Client ID (Web application type)',
        step3: 'Add authorized redirect URI: {your_domain}/api/auth/gmail/callback',
        step4: 'Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .dev.vars or use /api/auth/gmail/setup',
        step5: 'Visit this endpoint again to start authorization'
      }
    }, 400)
  }

  // Check if client secret is available (env or DB)
  let clientSecret = (c.env as any).GMAIL_CLIENT_SECRET || ''
  if (!clientSecret) {
    clientSecret = await getDbSetting(c.env.DB, 'gmail_client_secret') || ''
  }
  if (!clientSecret) {
    return c.json({
      error: 'GMAIL_CLIENT_SECRET not configured',
      fix: 'Go to Admin Dashboard → Settings → Email Setup, paste your OAuth client secret, then try again.',
      setup_endpoint: 'POST /api/auth/gmail/setup with {"client_secret": "your-secret"}',
      gcp_console: 'https://console.cloud.google.com/apis/credentials'
    }, 400)
  }

  const url = new URL(c.req.url)
  const redirectUri = `${url.protocol}//${url.host}/api/auth/gmail/callback`

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/gmail.send')
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')

  return c.redirect(authUrl.toString())
})

authRoutes.get('/gmail/callback', async (c) => {
  const code = c.req.query('code')
  const error = c.req.query('error')

  if (error) {
    return c.html(`<html><body style="font-family:sans-serif;padding:40px;max-width:600px;margin:auto">
      <h2 style="color:#dc2626">Authorization Failed</h2>
      <p>Google returned error: <strong>${error}</strong></p>
      <a href="/api/auth/gmail" style="color:#2563eb">Try again</a>
    </body></html>`)
  }

  if (!code) {
    return c.html(`<html><body style="font-family:sans-serif;padding:40px;max-width:600px;margin:auto">
      <h2 style="color:#dc2626">No Authorization Code</h2>
      <a href="/api/auth/gmail" style="color:#2563eb">Try again</a>
    </body></html>`)
  }

  const clientId = (c.env as any).GMAIL_CLIENT_ID
  // Read client secret from env or DB
  let clientSecret = (c.env as any).GMAIL_CLIENT_SECRET || ''
  if (!clientSecret) {
    clientSecret = await getDbSetting(c.env.DB, 'gmail_client_secret') || ''
  }

  if (!clientId || !clientSecret) {
    return c.json({ error: 'GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET not configured. Use /api/auth/gmail/setup first.' }, 400)
  }

  const url = new URL(c.req.url)
  const redirectUri = `${url.protocol}//${url.host}/api/auth/gmail/callback`

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

  if (!tokenResp.ok) {
    return c.html(`<html><body style="font-family:sans-serif;padding:40px;max-width:600px;margin:auto">
      <h2 style="color:#dc2626">Token Exchange Failed</h2>
      <p><strong>Error:</strong> ${tokenData.error || 'unknown'}</p>
      <p><strong>Description:</strong> ${tokenData.error_description || '(none)'}</p>
      <p><strong>Redirect URI used:</strong> ${redirectUri}</p>
      <p style="font-size:12px;color:#666">Make sure this exact URI is listed under "Authorized redirect URIs" in GCP Console for your OAuth client.</p>
      <a href="/api/auth/gmail" style="color:#2563eb">Try again</a>
    </body></html>`)
  }

  const refreshToken = tokenData.refresh_token
  const accessToken = tokenData.access_token

  let userEmail = ''
  try {
    const profileResp = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    })
    const profile: any = await profileResp.json()
    userEmail = profile.emailAddress || ''
  } catch (e) {}

  if (refreshToken) {
    try {
      await c.env.DB.prepare(`
        INSERT OR REPLACE INTO settings (master_company_id, setting_key, setting_value, is_encrypted)
        VALUES (1, 'gmail_refresh_token', ?, 0)
      `).bind(refreshToken).run()

      await c.env.DB.prepare(`
        INSERT OR REPLACE INTO settings (master_company_id, setting_key, setting_value, is_encrypted)
        VALUES (1, 'gmail_sender_email', ?, 0)
      `).bind(userEmail).run()
    } catch (e) {}
  }

  return c.html(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="/static/tailwind.css"></head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center">
<div class="bg-white rounded-2xl shadow-xl p-8 max-w-lg w-full mx-4">
  <div class="text-center mb-6">
    <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
      <svg class="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
      </svg>
    </div>
    <h2 class="text-2xl font-bold text-gray-800">Gmail Connected!</h2>
    <p class="text-gray-500 mt-2">Reports will now be sent from <strong>${userEmail}</strong></p>
  </div>
  ${refreshToken ? `
  <div class="bg-gray-50 rounded-xl p-4 mb-6">
    <p class="text-sm font-semibold text-gray-700 mb-2">Refresh Token (save to .dev.vars):</p>
    <div class="bg-white border border-gray-200 rounded-lg p-3 font-mono text-xs break-all select-all">${refreshToken}</div>
    <p class="text-xs text-gray-500 mt-2">Add to .dev.vars: <code class="bg-gray-100 px-1 rounded">GMAIL_REFRESH_TOKEN=${refreshToken}</code></p>
  </div>
  ` : ''}
  <a href="/admin" class="block text-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-colors">Go to Admin Dashboard</a>
</div>
</body></html>`)
})

authRoutes.get('/gmail/status', async (c) => {
  const hasClientId = !!(c.env as any).GMAIL_CLIENT_ID
  const hasClientSecretEnv = !!(c.env as any).GMAIL_CLIENT_SECRET
  const hasRefreshTokenEnv = !!(c.env as any).GMAIL_REFRESH_TOKEN

  let dbRefreshToken = false
  let dbClientSecret = false
  let dbSenderEmail = ''
  try {
    const rtRow = await c.env.DB.prepare(
      "SELECT setting_value FROM settings WHERE setting_key = 'gmail_refresh_token' AND master_company_id = 1"
    ).first<any>()
    if (rtRow?.setting_value) dbRefreshToken = true

    const csRow = await c.env.DB.prepare(
      "SELECT setting_value FROM settings WHERE setting_key = 'gmail_client_secret' AND master_company_id = 1"
    ).first<any>()
    if (csRow?.setting_value) dbClientSecret = true

    const emailRow = await c.env.DB.prepare(
      "SELECT setting_value FROM settings WHERE setting_key = 'gmail_sender_email' AND master_company_id = 1"
    ).first<any>()
    dbSenderEmail = emailRow?.setting_value || ''
  } catch (e) {}

  const hasClientSecret = hasClientSecretEnv || dbClientSecret
  const hasRefreshToken = hasRefreshTokenEnv || dbRefreshToken

  return c.json({
    gmail_oauth2: {
      client_id_configured: hasClientId,
      client_secret_configured: hasClientSecret,
      client_secret_source: hasClientSecretEnv ? 'env' : (dbClientSecret ? 'database' : 'missing'),
      refresh_token_configured: hasRefreshToken,
      refresh_token_source: hasRefreshTokenEnv ? 'env' : (dbRefreshToken ? 'database' : 'missing'),
      sender_email: dbSenderEmail || (c.env as any).GMAIL_SENDER_EMAIL || '',
      ready: hasClientId && hasClientSecret && hasRefreshToken,
      needs_setup: !hasClientSecret ? 'client_secret' : (!hasRefreshToken ? 'authorize' : null),
      authorize_url: (hasClientId && hasClientSecret) ? '/api/auth/gmail' : null,
      setup_url: '/api/auth/gmail/setup'
    }
  })
})

// POST /api/auth/gmail/disconnect — Remove stored Gmail refresh token + sender email
authRoutes.post('/gmail/disconnect', async (c) => {
  try {
    await c.env.DB.prepare(
      "DELETE FROM settings WHERE master_company_id = 1 AND setting_key IN ('gmail_refresh_token','gmail_sender_email')"
    ).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e?.message || 'Failed to disconnect Gmail' }, 500)
  }
})

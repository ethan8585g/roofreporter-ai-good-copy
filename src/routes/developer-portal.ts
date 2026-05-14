// ============================================================
// Developer Portal — /developer/*
// Self-serve signup, login, dashboard, and credit top-up
// for API customers (api_accounts).
// Auth: cookie-based DB sessions (mirrors admin_sessions pattern)
// ============================================================

import type { Context } from 'hono'
import { Hono } from 'hono'
import type { Bindings, AppEnv } from '../types'
import { generateApiKey } from '../middleware/api-auth'
import { addCredits, getLedgerPage } from '../services/api-billing'

export const developerPortalRoutes = new Hono<AppEnv>()

// ── Constants ─────────────────────────────────────────────────────────────────
const SESSION_TTL = 30 * 24 * 60 * 60  // 30 days (seconds)
const SESSION_COOKIE = 'dp_session'

// ── HTML escape — prevents XSS when interpolating user data into templates ────
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── Password helpers (PBKDF2, same constants as auth.ts) ──────────────────────

async function hashPassword(password: string, salt?: string): Promise<{ hash: string; salt: string }> {
  const s = salt || crypto.randomUUID()
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits']
  )
  const hashBuffer = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(s), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  )
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  return { hash: hashHex, salt: s }
}

function timingSafeEq(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash || !storedHash.startsWith('pbkdf2:')) return false
  const inner = storedHash.slice(7)
  const idx = inner.indexOf(':')
  if (idx < 0) return false
  const salt = inner.slice(0, idx)
  const hash = inner.slice(idx + 1)
  const result = await hashPassword(password, salt)
  return timingSafeEq(result.hash, hash)
}

// ── Session helpers ───────────────────────────────────────────────────────────

async function createSession(db: D1Database, accountId: string): Promise<string> {
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + SESSION_TTL
  await db.prepare(`
    INSERT INTO api_account_sessions (id, account_id, session_token, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), accountId, token, expiresAt, now).run()
  return token
}

async function getSessionAccount(db: D1Database, token: string | undefined): Promise<any | null> {
  if (!token) return null
  const now = Math.floor(Date.now() / 1000)
  const row = await db.prepare(`
    SELECT a.*, s.session_token
    FROM api_account_sessions s
    JOIN api_accounts a ON a.id = s.account_id
    WHERE s.session_token = ? AND s.expires_at > ?
  `).bind(token, now).first<any>()
  if (!row) return null
  // Rolling renewal
  db.prepare('UPDATE api_account_sessions SET expires_at = ? WHERE session_token = ?')
    .bind(now + SESSION_TTL, token).run().catch(() => {})
  return row
}

function getSessionToken(c: Context<AppEnv>): string | undefined {
  const cookieHeader: string = c.req.header('cookie') ?? ''
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === SESSION_COOKIE) return v.join('=')
  }
  return undefined
}

// Sets the session cookie on a Response object (not a Hono context).
// Pass the raw Response returned by c.redirect() or new Response().
function attachSessionCookie(resp: Response, token: string): Response {
  resp.headers.set(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/developer; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`
  )
  return resp
}

// ── Auth guard ────────────────────────────────────────────────────────────────

async function requireAuth(c: Context<AppEnv>): Promise<any | null> {
  const token = getSessionToken(c)
  return getSessionAccount(c.env.DB, token)
}

// ── HTML shell ────────────────────────────────────────────────────────────────

function page(title: string, body: string, extraHead = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} — Roof Manager API</title>
  <link rel="stylesheet" href="/static/tailwind.css">
  ${extraHead}
  <style>
    :root {
      --bg-base: #0f1117;
      --bg-card: #1a1d27;
      --bg-card2: #21253a;
      --border: #2e3348;
      --text-muted: #8b95b0;
      --accent: #4f8ef7;
      --accent-dark: #3b75e0;
      --success: #22c55e;
      --danger: #ef4444;
    }
    body { background: var(--bg-base); color: #e2e8f0; font-family: system-ui, sans-serif; }
    .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; }
    .input {
      background: var(--bg-base);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: #e2e8f0;
      padding: 10px 14px;
      width: 100%;
      outline: none;
      transition: border-color .15s;
    }
    .input:focus { border-color: var(--accent); }
    .btn {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 10px 22px; border-radius: 8px; font-weight: 600;
      cursor: pointer; border: none; transition: background .15s, opacity .15s;
    }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-primary:hover { background: var(--accent-dark); }
    .btn-secondary { background: var(--bg-card2); color: #e2e8f0; border: 1px solid var(--border); }
    .btn-secondary:hover { border-color: var(--accent); }
    .btn-danger { background: var(--danger); color: #fff; }
    .label { display: block; font-size: .8rem; color: var(--text-muted); margin-bottom: 5px; font-weight: 500; text-transform: uppercase; letter-spacing: .04em; }
    .badge { display: inline-flex; align-items: center; padding: 2px 10px; border-radius: 999px; font-size: .75rem; font-weight: 600; }
    .badge-green { background: #16a34a22; color: #22c55e; }
    .badge-yellow { background: #ca8a0422; color: #eab308; }
    .badge-red { background: #ef444422; color: #ef4444; }
    .mono { font-family: 'Menlo', 'Consolas', monospace; }
    .alert-error { background: #ef444418; border: 1px solid #ef444444; border-radius: 8px; color: #fca5a5; padding: 12px 16px; margin-bottom: 16px; font-size: .9rem; }
    .alert-success { background: #22c55e18; border: 1px solid #22c55e44; border-radius: 8px; color: #86efac; padding: 12px 16px; margin-bottom: 16px; font-size: .9rem; }
  </style>
</head>
<body>
  ${body}
</body>
</html>`
}

function navBar(account: any) {
  return `
  <nav style="background:var(--bg-card);border-bottom:1px solid var(--border);" class="px-6 py-4 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <svg width="28" height="28" viewBox="0 0 32 32" fill="none"><path d="M4 16L16 4L28 16V28H20V20H12V28H4V16Z" fill="#4f8ef7"/></svg>
      <span style="font-weight:700;font-size:1.1rem;">Roof Manager <span style="color:var(--text-muted);font-weight:400;">API Portal</span></span>
    </div>
    <div class="flex items-center gap-4">
      <span style="color:var(--text-muted);font-size:.9rem;">${esc(account.company_name)}</span>
      <a href="/developer/logout" class="btn btn-secondary" style="padding:6px 16px;font-size:.85rem;">Sign Out</a>
    </div>
  </nav>`
}

// ── Dashboard data + HTML helpers ─────────────────────────────────────────────
// Extracted so POST /signup and POST /keys/new can render the page inline
// (without a redirect) — this keeps the raw API key out of URLs and logs.

interface DashboardData {
  keys: any[]
  jobs: any[]
  balance: number
  packages: any[]
  completedReports: any[]
}

async function loadDashboardData(db: D1Database, accountId: string): Promise<DashboardData> {
  const [keysResult, jobsResult, balanceRow, pkgsResult, reportsResult] = await Promise.all([
    db.prepare('SELECT id, key_prefix, name, last_used_at, revoked_at, created_at FROM api_keys WHERE account_id = ? ORDER BY created_at DESC')
      .bind(accountId).all<any>(),
    db.prepare('SELECT id, status, address, created_at, finalized_at FROM api_jobs WHERE account_id = ? ORDER BY created_at DESC LIMIT 10')
      .bind(accountId).all<any>(),
    db.prepare('SELECT credit_balance FROM api_accounts WHERE id = ?').bind(accountId).first<{ credit_balance: number }>(),
    db.prepare('SELECT * FROM credit_packages WHERE is_active = 1 ORDER BY credits ASC').all<any>(),
    db.prepare(`
      SELECT j.id as job_id, j.address, j.created_at, j.finalized_at, j.order_id,
             o.order_number,
             r.roof_area_sqft, r.roof_pitch_degrees, r.complexity_class
      FROM api_jobs j
      LEFT JOIN orders o ON o.id = j.order_id
      LEFT JOIN reports r ON r.order_id = j.order_id
      WHERE j.account_id = ? AND j.status = 'ready'
      ORDER BY j.finalized_at DESC
      LIMIT 100
    `).bind(accountId).all<any>(),
  ])
  return {
    keys: keysResult.results ?? [],
    jobs: jobsResult.results ?? [],
    balance: balanceRow?.credit_balance ?? 0,
    packages: pkgsResult.results ?? [],
    completedReports: reportsResult.results ?? [],
  }
}

function buildDashboardHtml(
  account: any,
  data: DashboardData,
  baseUrl: string,
  opts: { newKey?: string; welcome?: boolean; bought?: boolean } = {}
): string {
  const { keys, jobs, balance, packages, completedReports } = data
  const { newKey = '', welcome = false, bought = false } = opts
  const activeKeys = keys.filter(k => !k.revoked_at)

  function statusBadge(s: string) {
    const map: Record<string, string> = {
      queued: 'badge-yellow', tracing: 'badge-yellow', generating: 'badge-yellow',
      ready: 'badge-green', failed: 'badge-red', cancelled: 'badge-red'
    }
    return `<span class="badge ${map[s] ?? 'badge-yellow'}">${esc(s)}</span>`
  }

  function timeAgo(unixSec: number) {
    if (!unixSec) return '—'
    const diff = Math.floor(Date.now() / 1000) - unixSec
    if (diff < 60) return 'just now'
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  }

  // newKey is the raw API key — it is alphanumeric + base64url chars only, safe to embed
  // in a JS string literal and in a <code> element. We still esc() all other user values.
  const newKeyBanner = newKey ? `
    <div style="background:#4f8ef718;border:1px solid #4f8ef744;border-radius:10px;padding:18px 20px;margin-bottom:24px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:700;margin-bottom:4px;">Your API Key (shown once — copy it now)</div>
          <code class="mono" id="newApiKey" style="font-size:.9rem;word-break:break-all;color:#93c5fd;">${esc(newKey)}</code>
        </div>
        <button onclick="navigator.clipboard.writeText(document.getElementById('newApiKey').textContent).then(()=>this.textContent='Copied!')"
          class="btn btn-primary" style="white-space:nowrap;padding:8px 16px;font-size:.85rem;">Copy</button>
      </div>
    </div>` : ''

  return page('Dashboard', `
  ${navBar(account)}

  <div style="max-width:960px;margin:0 auto;padding:32px 24px;">

    ${welcome ? `<div class="alert-success" style="margin-bottom:24px;">
      <strong>Welcome to Roof Manager API!</strong> Your account is set up and your first API key is shown below.
      <strong>Copy it now — it will not be shown again.</strong>
    </div>` : ''}

    ${bought ? `<div class="alert-success" style="margin-bottom:24px;">
      <strong>Payment successful!</strong> Your credits have been added to your account.
    </div>` : ''}

    ${newKeyBanner}

    <!-- Stats row -->
    <div class="grid grid-cols-3 gap-4 mb-8">
      <div class="card p-5 text-center">
        <div style="font-size:2rem;font-weight:800;color:var(--accent);">${balance}</div>
        <div style="color:var(--text-muted);font-size:.85rem;margin-top:4px;">API Credits</div>
      </div>
      <div class="card p-5 text-center">
        <div style="font-size:2rem;font-weight:800;">${activeKeys.length}</div>
        <div style="color:var(--text-muted);font-size:.85rem;margin-top:4px;">Active Keys</div>
      </div>
      <div class="card p-5 text-center">
        <div style="font-size:2rem;font-weight:800;">${completedReports.length}</div>
        <div style="color:var(--text-muted);font-size:.85rem;margin-top:4px;">Reports Delivered</div>
      </div>
    </div>

    <div class="grid gap-8" style="grid-template-columns:1fr 1fr;">

      <!-- API Keys -->
      <div>
        <div class="flex items-center justify-between mb-4">
          <h2 style="font-size:1.1rem;font-weight:700;">API Keys</h2>
          <form method="POST" action="/developer/keys/new" style="display:inline;">
            <button type="submit" class="btn btn-secondary" style="padding:6px 14px;font-size:.8rem;">+ Generate New Secret Key</button>
          </form>
        </div>
        <div style="background:var(--bg-card);border:1px solid #f59e0b44;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:.8rem;color:#92400e;display:flex;align-items:flex-start;gap:8px;">
          <span style="font-size:1rem;margin-top:1px;">🔒</span>
          <span><strong>Key compromised or lost?</strong> Revoke it immediately below — it stops working within seconds. Then generate a new key above.</span>
        </div>
        <div class="card" style="overflow:hidden;">
          ${keys.length === 0 ? `<div style="padding:24px;text-align:center;color:var(--text-muted);">No API keys yet.</div>` :
            keys.map(k => `
            <div style="padding:14px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <div style="min-width:0;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">
                  <code class="mono" style="font-size:.85rem;">rm_live_${esc(k.key_prefix)}…</code>
                  ${k.revoked_at ? `<span class="badge badge-red">Revoked</span>` : `<span class="badge badge-green">Active</span>`}
                </div>
                <div style="font-size:.78rem;color:var(--text-muted);">${esc(k.name || 'Unnamed')} · Last used: ${timeAgo(k.last_used_at)}</div>
              </div>
              ${!k.revoked_at ? `
              <form method="POST" action="/developer/keys/${esc(k.id)}/revoke" onsubmit="return confirm('Revoke this key? Any API calls using it will stop working immediately. You can generate a new key after.');">
                <button type="submit" class="btn btn-danger" style="padding:5px 12px;font-size:.78rem;" title="Revoke this key if it was compromised or leaked">🚫 Revoke Key</button>
              </form>` : ''}
            </div>`).join('')}
        </div>
        <p style="font-size:.75rem;color:var(--text-muted);margin-top:8px;">Only the key prefix is shown (rm_live_XXXX…). The full key was displayed once at creation and is not stored.</p>
      </div>

      <!-- Buy Credits -->
      <div>
        <h2 style="font-size:1.1rem;font-weight:700;margin-bottom:4px;">Buy Credits</h2>
        <p style="color:var(--text-muted);font-size:.85rem;margin-bottom:16px;">1 credit = 1 roof measurement report</p>
        ${packages.length === 0
          ? `<div class="card p-6 text-center" style="color:var(--text-muted);">No credit packages available. Contact sales@roofmanager.ca</div>`
          : `<div style="display:flex;flex-direction:column;gap:12px;">
              ${packages.map(pkg => `
              <form method="POST" action="/developer/checkout">
                <input type="hidden" name="package_id" value="${esc(pkg.id)}">
                <button type="submit" class="card" style="width:100%;text-align:left;padding:16px;cursor:pointer;transition:border-color .15s;" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
                  <div style="display:flex;align-items:center;justify-content:space-between;">
                    <div>
                      <div style="font-weight:700;">${esc(pkg.name)}</div>
                      <div style="color:var(--text-muted);font-size:.85rem;margin-top:2px;">${esc(pkg.credits)} credits</div>
                    </div>
                    <div style="font-size:1.2rem;font-weight:800;color:var(--accent);">$${(pkg.price_cents / 100).toFixed(2)}</div>
                  </div>
                </button>
              </form>`).join('')}
            </div>`}
      </div>
    </div>

    <!-- Report History -->
    <div style="margin-top:32px;">
      <div class="flex items-center justify-between mb-4">
        <h2 style="font-size:1.1rem;font-weight:700;">Report History</h2>
        <span style="font-size:.82rem;color:var(--text-muted);">${completedReports.length} completed report${completedReports.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="card" style="overflow:hidden;">
        ${completedReports.length === 0
          ? `<div style="padding:32px;text-align:center;color:var(--text-muted);">
               <div style="font-size:2rem;margin-bottom:8px;">📋</div>
               <div style="font-weight:600;margin-bottom:4px;">No completed reports yet</div>
               <div style="font-size:.85rem;">Reports appear here once your submitted jobs are traced and finalized by our team.</div>
             </div>`
          : `<table style="width:100%;border-collapse:collapse;">
              <thead>
                <tr style="border-bottom:1px solid var(--border);">
                  <th style="text-align:left;padding:10px 16px;font-size:.78rem;color:var(--text-muted);font-weight:600;">ADDRESS</th>
                  <th style="text-align:right;padding:10px 16px;font-size:.78rem;color:var(--text-muted);font-weight:600;">AREA (SQFT)</th>
                  <th style="text-align:right;padding:10px 16px;font-size:.78rem;color:var(--text-muted);font-weight:600;">PITCH</th>
                  <th style="text-align:right;padding:10px 16px;font-size:.78rem;color:var(--text-muted);font-weight:600;">COMPLETED</th>
                  <th style="text-align:right;padding:10px 16px;font-size:.78rem;color:var(--text-muted);font-weight:600;">DOWNLOAD</th>
                </tr>
              </thead>
              <tbody>
                ${completedReports.map(r => `
                <tr style="border-bottom:1px solid var(--border);">
                  <td style="padding:10px 16px;font-size:.88rem;max-width:260px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(r.address)}</td>
                  <td style="padding:10px 16px;text-align:right;font-size:.88rem;font-weight:600;">${r.roof_area_sqft ? Number(r.roof_area_sqft).toLocaleString('en-CA', { maximumFractionDigits: 0 }) : '—'}</td>
                  <td style="padding:10px 16px;text-align:right;font-size:.88rem;">${r.roof_pitch_degrees ? `${Math.round(r.roof_pitch_degrees)}°` : '—'}</td>
                  <td style="padding:10px 16px;text-align:right;font-size:.85rem;color:var(--text-muted);">${timeAgo(r.finalized_at)}</td>
                  <td style="padding:10px 16px;text-align:right;">
                    <a href="/developer/reports/${esc(r.job_id)}/pdf" target="_blank"
                       style="display:inline-block;padding:5px 12px;background:var(--accent);color:#fff;border-radius:6px;font-size:.78rem;font-weight:600;text-decoration:none;">
                      ⬇ PDF
                    </a>
                  </td>
                </tr>`).join('')}
              </tbody>
            </table>`}
      </div>
    </div>

    <!-- Recent Jobs -->
    <div style="margin-top:32px;">
      <div class="flex items-center justify-between mb-4">
        <h2 style="font-size:1.1rem;font-weight:700;">Recent Jobs</h2>
        <a href="/developer/usage" style="color:var(--accent);font-size:.85rem;">View full history →</a>
      </div>
      <div class="card" style="overflow:hidden;">
        ${jobs.length === 0
          ? `<div style="padding:24px;text-align:center;color:var(--text-muted);">No jobs submitted yet. Use <code class="mono" style="font-size:.85em;background:var(--bg-base);padding:1px 6px;border-radius:4px;">POST /v1/reports</code> to submit your first address.</div>`
          : `<table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr style="border-bottom:1px solid var(--border);">
                <th style="text-align:left;padding:10px 16px;font-size:.78rem;color:var(--text-muted);font-weight:600;">JOB ID</th>
                <th style="text-align:left;padding:10px 16px;font-size:.78rem;color:var(--text-muted);font-weight:600;">ADDRESS</th>
                <th style="text-align:left;padding:10px 16px;font-size:.78rem;color:var(--text-muted);font-weight:600;">STATUS</th>
                <th style="text-align:right;padding:10px 16px;font-size:.78rem;color:var(--text-muted);font-weight:600;">SUBMITTED</th>
              </tr>
            </thead>
            <tbody>
              ${jobs.map(j => `
              <tr style="border-bottom:1px solid var(--border);">
                <td style="padding:10px 16px;"><code class="mono" style="font-size:.8rem;color:var(--text-muted);">${esc(j.id.slice(0, 8))}…</code></td>
                <td style="padding:10px 16px;font-size:.88rem;max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(j.address)}</td>
                <td style="padding:10px 16px;">${statusBadge(j.status)}</td>
                <td style="padding:10px 16px;text-align:right;font-size:.85rem;color:var(--text-muted);">${timeAgo(j.created_at)}</td>
              </tr>`).join('')}
            </tbody>
          </table>`}
      </div>
    </div>

    <!-- Quick Start -->
    <div style="margin-top:32px;" class="card p-6">
      <h2 style="font-size:1.1rem;font-weight:700;margin-bottom:16px;">Quick Start</h2>
      <div style="margin-bottom:12px;">
        <div class="label" style="margin-bottom:8px;">Submit a report request</div>
        <pre class="mono" style="background:var(--bg-base);border:1px solid var(--border);border-radius:8px;padding:14px;font-size:.82rem;overflow-x:auto;color:#93c5fd;white-space:pre;"><code>curl -X POST ${esc(baseUrl)}/v1/reports \\
  -H "Authorization: Bearer &lt;your-api-key&gt;" \\
  -H "Content-Type: application/json" \\
  -d '{"address": "123 Main St, Toronto, ON"}'</code></pre>
      </div>
      <div>
        <div class="label" style="margin-bottom:8px;">Poll for results</div>
        <pre class="mono" style="background:var(--bg-base);border:1px solid var(--border);border-radius:8px;padding:14px;font-size:.82rem;overflow-x:auto;color:#93c5fd;white-space:pre;"><code>curl ${esc(baseUrl)}/v1/reports/&lt;job_id&gt; \\
  -H "Authorization: Bearer &lt;your-api-key&gt;"</code></pre>
      </div>
    </div>

  </div>
  `)
}

// ── GET /developer — Landing / signup prompt ──────────────────────────────────

developerPortalRoutes.get('/', async (c) => {
  const token = getSessionToken(c)
  if (token) {
    const account = await getSessionAccount(c.env.DB, token)
    if (account) return c.redirect('/developer/dashboard')
  }

  return c.html(page('Get Started', `
  <div class="min-h-screen flex flex-col items-center justify-center px-4 py-16">
    <div style="max-width:480px;width:100%;">
      <div class="text-center mb-10">
        <div class="flex justify-center mb-4">
          <svg width="52" height="52" viewBox="0 0 32 32" fill="none"><path d="M4 16L16 4L28 16V28H20V20H12V28H4V16Z" fill="#4f8ef7"/></svg>
        </div>
        <h1 style="font-size:2rem;font-weight:800;margin-bottom:8px;">Roof Manager API</h1>
        <p style="color:var(--text-muted);font-size:1.05rem;">Professional roof measurements delivered via API.<br>Submit an address, get a signed PDF report.</p>
      </div>

      <div class="card p-8 mb-6">
        <div class="grid grid-cols-3 gap-4 text-center mb-8">
          <div>
            <div style="font-size:1.5rem;font-weight:700;color:var(--accent);">API</div>
            <div style="font-size:.8rem;color:var(--text-muted);">REST-based</div>
          </div>
          <div>
            <div style="font-size:1.5rem;font-weight:700;color:var(--accent);">PDF</div>
            <div style="font-size:.8rem;color:var(--text-muted);">Signed URLs</div>
          </div>
          <div>
            <div style="font-size:1.5rem;font-weight:700;color:var(--accent);">Credits</div>
            <div style="font-size:.8rem;color:var(--text-muted);">Pay-per-report</div>
          </div>
        </div>

        <div class="flex gap-3">
          <a href="/developer/signup" class="btn btn-primary flex-1" style="justify-content:center;">Create Account</a>
          <a href="/developer/login" class="btn btn-secondary flex-1" style="justify-content:center;">Sign In</a>
        </div>
      </div>

      <div class="card p-6">
        <h3 style="font-weight:600;margin-bottom:12px;font-size:.95rem;">How it works</h3>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${['Submit an address via <code class="mono" style="font-size:.85em;background:var(--bg-base);padding:1px 5px;border-radius:4px;">POST /v1/reports</code>',
            'Our team manually traces the roof measurements',
            'Receive a webhook + signed PDF URL when ready',
            'Download the professional measurement report'].map((s, i) => `
          <div style="display:flex;gap:10px;align-items:flex-start;">
            <div style="min-width:22px;height:22px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:700;margin-top:1px;">${i + 1}</div>
            <span style="color:var(--text-muted);font-size:.9rem;">${s}</span>
          </div>`).join('')}
        </div>
      </div>
    </div>
  </div>
  `))
})

// ── GET /developer/signup ─────────────────────────────────────────────────────

developerPortalRoutes.get('/signup', async (c) => {
  const error = c.req.query('error') ?? ''
  const errorMsg = error === 'exists' ? 'An account with that email already exists. <a href="/developer/login" style="color:var(--accent);">Sign in instead.</a>'
    : error === 'weak' ? 'Password must be at least 8 characters.'
    : error === 'fields' ? 'All fields are required.'
    : ''

  return c.html(page('Create Account', `
  <div class="min-h-screen flex items-center justify-center px-4 py-12">
    <div style="max-width:440px;width:100%;">
      <div class="text-center mb-8">
        <a href="/developer" class="flex items-center justify-center gap-2 mb-4" style="text-decoration:none;">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M4 16L16 4L28 16V28H20V20H12V28H4V16Z" fill="#4f8ef7"/></svg>
        </a>
        <h1 style="font-size:1.6rem;font-weight:800;">Create Developer Account</h1>
        <p style="color:var(--text-muted);margin-top:6px;font-size:.9rem;">Get your API key instantly. No credit card required to start.</p>
      </div>

      <div class="card p-8">
        ${errorMsg ? `<div class="alert-error">${errorMsg}</div>` : ''}
        <form method="POST" action="/developer/signup">
          <div style="margin-bottom:16px;">
            <label class="label">Company / Organization Name</label>
            <input class="input" type="text" name="company_name" placeholder="Acme Roofing Inc." required autocomplete="organization">
          </div>
          <div style="margin-bottom:16px;">
            <label class="label">Email</label>
            <input class="input" type="email" name="email" placeholder="dev@example.com" required autocomplete="email">
          </div>
          <div style="margin-bottom:24px;">
            <label class="label">Password</label>
            <input class="input" type="password" name="password" placeholder="Min. 8 characters" required autocomplete="new-password" minlength="8">
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%;">Create Account &amp; Get API Key</button>
        </form>
        <p style="text-align:center;margin-top:16px;font-size:.85rem;color:var(--text-muted);">
          Already have an account? <a href="/developer/login" style="color:var(--accent);">Sign in</a>
        </p>
      </div>
    </div>
  </div>
  `))
})

// ── POST /developer/signup ────────────────────────────────────────────────────

developerPortalRoutes.post('/signup', async (c) => {
  const db = c.env.DB
  let body: any
  try { body = await c.req.parseBody() } catch { return c.redirect('/developer/signup?error=fields') }

  const company_name = String(body.company_name ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')

  if (!company_name || !email || !password) return c.redirect('/developer/signup?error=fields')
  if (password.length < 8) return c.redirect('/developer/signup?error=weak')

  // Check duplicate email
  const existing = await db.prepare('SELECT id FROM api_accounts WHERE contact_email = ?').bind(email).first()
  if (existing) return c.redirect('/developer/signup?error=exists')

  // Hash password
  const { hash, salt } = await hashPassword(password)
  const passwordHash = `pbkdf2:${salt}:${hash}`

  // Create account
  const accountId = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)
  await db.prepare(`
    INSERT INTO api_accounts (id, company_name, contact_email, credit_balance, status, password_hash, created_at)
    VALUES (?, ?, ?, 0, 'active', ?, ?)
  `).bind(accountId, company_name, email, passwordHash, now).run()

  // Issue first API key
  const { raw, prefix, hash: keyHash } = await generateApiKey()
  await db.prepare(`
    INSERT INTO api_keys (id, account_id, key_prefix, key_hash, name, created_at)
    VALUES (?, ?, ?, ?, 'Default Key', ?)
  `).bind(crypto.randomUUID(), accountId, prefix, keyHash, now).run()

  // Create session
  const token = await createSession(db, accountId)

  // Render dashboard directly — raw key stays in the HTTP response body only,
  // never in a URL (which would appear in server logs and browser history).
  const account = { id: accountId, company_name, contact_email: email }
  const data = await loadDashboardData(db, accountId)
  const baseUrl = new URL(c.req.url).origin
  const html = buildDashboardHtml(account, data, baseUrl, { newKey: raw, welcome: true })

  return attachSessionCookie(
    new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
    token
  )
})

// ── GET /developer/login ──────────────────────────────────────────────────────

developerPortalRoutes.get('/login', async (c) => {
  // P2: login page should never be cached.
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  c.header('Pragma', 'no-cache')
  const error = c.req.query('error') ?? ''
  const errorMsg = error === 'invalid' ? 'Invalid email or password.'
    : error === 'suspended' ? 'Account is suspended. Contact support@roofmanager.ca.'
    : ''

  return c.html(page('Sign In', `
  <div class="min-h-screen flex items-center justify-center px-4 py-12">
    <div style="max-width:400px;width:100%;">
      <div class="text-center mb-8">
        <a href="/developer" class="flex items-center justify-center gap-2 mb-4" style="text-decoration:none;">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><path d="M4 16L16 4L28 16V28H20V20H12V28H4V16Z" fill="#4f8ef7"/></svg>
        </a>
        <h1 style="font-size:1.6rem;font-weight:800;">Developer Sign In</h1>
      </div>

      <div class="card p-8">
        ${errorMsg ? `<div class="alert-error">${errorMsg}</div>` : ''}
        <form method="POST" action="/developer/login">
          <div style="margin-bottom:16px;">
            <label class="label">Email</label>
            <input class="input" type="email" name="email" required autocomplete="email" autofocus>
          </div>
          <div style="margin-bottom:24px;">
            <label class="label">Password</label>
            <input class="input" type="password" name="password" required autocomplete="current-password">
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%;">Sign In</button>
        </form>
        <p style="text-align:center;margin-top:16px;font-size:.85rem;color:var(--text-muted);">
          Don't have an account? <a href="/developer/signup" style="color:var(--accent);">Create one</a>
        </p>
      </div>
    </div>
  </div>
  `))
})

// ── POST /developer/login ─────────────────────────────────────────────────────

developerPortalRoutes.post('/login', async (c) => {
  const db = c.env.DB
  let body: any
  try { body = await c.req.parseBody() } catch { return c.redirect('/developer/login?error=invalid') }

  const email = String(body.email ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')

  const account = await db.prepare(
    'SELECT * FROM api_accounts WHERE contact_email = ?'
  ).bind(email).first<any>()

  if (!account || !account.password_hash) return c.redirect('/developer/login?error=invalid')
  const valid = await verifyPassword(password, account.password_hash)
  if (!valid) return c.redirect('/developer/login?error=invalid')
  if (account.status !== 'active') return c.redirect('/developer/login?error=suspended')

  const token = await createSession(db, account.id)
  return attachSessionCookie(c.redirect('/developer/dashboard'), token)
})

// ── GET /developer/logout ─────────────────────────────────────────────────────

developerPortalRoutes.get('/logout', async (c) => {
  const token = getSessionToken(c)
  if (token) {
    c.env.DB.prepare('DELETE FROM api_account_sessions WHERE session_token = ?').bind(token).run().catch(() => {})
  }
  const resp = c.redirect('/developer/login')
  ;(resp as any).headers.set(
    'Set-Cookie',
    `${SESSION_COOKIE}=; Path=/developer; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  )
  return resp
})

// ── GET /developer/dashboard ──────────────────────────────────────────────────

developerPortalRoutes.get('/dashboard', async (c) => {
  const account = await requireAuth(c)
  if (!account) return c.redirect('/developer/login')

  const db = c.env.DB
  const bought = c.req.query('payment') === 'success'
  const baseUrl = new URL(c.req.url).origin
  const data = await loadDashboardData(db, account.id)

  // Phase 2: prevent caching of pages that may render secrets/API keys.
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  c.header('Pragma', 'no-cache')
  return c.html(buildDashboardHtml(account, data, baseUrl, { bought }))
})

// ── POST /developer/keys/new — Generate a new API key ─────────────────────────
// Renders the dashboard inline so the raw key never appears in a URL.

developerPortalRoutes.post('/keys/new', async (c) => {
  const account = await requireAuth(c)
  if (!account) return c.redirect('/developer/login')

  const db = c.env.DB
  const { raw, prefix, hash: keyHash } = await generateApiKey()
  const now = Math.floor(Date.now() / 1000)

  await db.prepare(`
    INSERT INTO api_keys (id, account_id, key_prefix, key_hash, name, created_at)
    VALUES (?, ?, ?, ?, 'New Key', ?)
  `).bind(crypto.randomUUID(), account.id, prefix, keyHash, now).run()

  const baseUrl = new URL(c.req.url).origin
  const data = await loadDashboardData(db, account.id)
  return c.html(buildDashboardHtml(account, data, baseUrl, { newKey: raw }))
})

// ── POST /developer/keys/:keyId/revoke ────────────────────────────────────────

developerPortalRoutes.post('/keys/:keyId/revoke', async (c) => {
  const account = await requireAuth(c)
  if (!account) return c.redirect('/developer/login')

  const keyId = c.req.param('keyId')
  const now = Math.floor(Date.now() / 1000)

  // Scoped to account — no IDOR
  await c.env.DB.prepare(`
    UPDATE api_keys SET revoked_at = ? WHERE id = ? AND account_id = ?
  `).bind(now, keyId, account.id).run()

  return c.redirect('/developer/dashboard')
})

// ── POST /developer/checkout — Square payment for API credits ─────────────────

developerPortalRoutes.post('/checkout', async (c) => {
  const account = await requireAuth(c)
  if (!account) return c.redirect('/developer/login')

  const db = c.env.DB
  const accessToken = c.env.SQUARE_ACCESS_TOKEN
  const locationId = (c.env as any).SQUARE_LOCATION_ID
  if (!accessToken || !locationId) {
    return c.html(page('Checkout Error', `<div style="padding:48px;text-align:center;"><div class="alert-error">Payment is not configured. Contact support@roofmanager.ca</div><a href="/developer/dashboard" class="btn btn-secondary" style="margin-top:16px;">Back</a></div>`))
  }

  let body: any
  try { body = await c.req.parseBody() } catch { return c.redirect('/developer/dashboard') }
  const packageId = parseInt(String(body.package_id ?? '1'), 10)

  const pkg = await db.prepare('SELECT * FROM credit_packages WHERE id = ? AND is_active = 1')
    .bind(packageId).first<any>()
  if (!pkg) return c.redirect('/developer/dashboard')

  const origin = new URL(c.req.url).origin
  const successUrl = `${origin}/developer/dashboard?payment=success`
  const idempotencyKey = `api-credits-${account.id}-${pkg.id}-${Date.now()}`

  let paymentLink: any
  try {
    const resp = await fetch('https://connect.squareup.com/v2/online-checkout/payment-links', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Square-Version': '2025-01-23',
      },
      body: JSON.stringify({
        idempotency_key: idempotencyKey,
        quick_pay: {
          name: `${pkg.name} — Roof Manager API Credits`,
          price_money: { amount: pkg.price_cents, currency: 'CAD' },
          location_id: locationId,
        },
        checkout_options: { redirect_url: successUrl, ask_for_shipping_address: false },
        payment_note: `${pkg.credits} API credits for ${account.contact_email}`,
      }),
    })
    paymentLink = await resp.json()
  } catch (err: any) {
    return c.html(page('Checkout Error', `<div style="padding:48px;text-align:center;"><div class="alert-error">Checkout failed: ${esc(err.message)}</div><a href="/developer/dashboard" class="btn btn-secondary" style="margin-top:16px;">Back</a></div>`))
  }

  const link = paymentLink.payment_link
  if (!link?.url && !link?.long_url) {
    return c.html(page('Checkout Error', `<div style="padding:48px;text-align:center;"><div class="alert-error">Could not create payment link. Try again or contact support.</div><a href="/developer/dashboard" class="btn btn-secondary" style="margin-top:16px;">Back</a></div>`))
  }

  const squareOrderId = link.order_id || ''

  // Record pending payment.
  // customer_id = 0 is a sentinel for API-account purchases (satisfies NOT NULL; D1 does not
  // enforce the FK constraint, so 0 is safe even though no customers row with id=0 exists).
  await db.prepare(`
    INSERT INTO square_payments (customer_id, api_account_id, square_order_id, square_payment_link_id, amount, currency, status, payment_type, description, metadata_json)
    VALUES (0, ?, ?, ?, ?, 'usd', 'pending', 'api_credits', ?, ?)
  `).bind(
    account.id, squareOrderId, link.id || '',
    pkg.price_cents,
    `${pkg.name} (${pkg.credits} API credits)`,
    JSON.stringify({ credits: pkg.credits, package_id: pkg.id, package_name: pkg.name, account_id: account.id })
  ).run()

  return c.redirect(link.url || link.long_url)
})

// ── GET /developer/usage — Credit ledger ──────────────────────────────────────

// ── GET /developer/reports/:jobId/pdf — Session-authenticated PDF download ─────

developerPortalRoutes.get('/reports/:jobId/pdf', async (c) => {
  const account = await requireAuth(c)
  if (!account) return c.redirect('/developer/login')

  const jobId = c.req.param('jobId')
  const db = c.env.DB

  const job = await db.prepare(`
    SELECT id, order_id, status FROM api_jobs WHERE id = ? AND account_id = ? AND status = 'ready'
  `).bind(jobId, account.id).first<any>()

  if (!job || !job.order_id) {
    return c.html(page('Not Found', `
      ${navBar(account)}
      <div style="max-width:600px;margin:80px auto;padding:0 24px;text-align:center;">
        <div style="font-size:2rem;margin-bottom:12px;">📄</div>
        <h2 style="font-size:1.2rem;font-weight:700;margin-bottom:8px;">Report not found</h2>
        <p style="color:var(--text-muted);margin-bottom:20px;">This report does not exist or does not belong to your account.</p>
        <a href="/developer/dashboard" class="btn btn-primary">← Back to Dashboard</a>
      </div>
    `), 404)
  }

  const baseUrl = new URL(c.req.url).origin
  const pdfRes = await fetch(`${baseUrl}/api/reports/${job.order_id}/pdf`)

  if (!pdfRes.ok) {
    return c.html(page('Error', `
      ${navBar(account)}
      <div style="max-width:600px;margin:80px auto;padding:0 24px;text-align:center;">
        <div style="font-size:2rem;margin-bottom:12px;">⚠️</div>
        <h2 style="font-size:1.2rem;font-weight:700;margin-bottom:8px;">Could not load report</h2>
        <p style="color:var(--text-muted);margin-bottom:20px;">The report PDF is temporarily unavailable. Please try again.</p>
        <a href="/developer/dashboard" class="btn btn-primary">← Back to Dashboard</a>
      </div>
    `), 502)
  }

  return new Response(pdfRes.body, {
    headers: {
      'Content-Type': pdfRes.headers.get('Content-Type') ?? 'text/html',
      'Content-Disposition': `inline; filename="roof-report-${jobId.slice(0, 8)}.pdf"`,
    }
  })
})

// ── GET /developer/usage ──────────────────────────────────────────────────────

developerPortalRoutes.get('/usage', async (c) => {
  const account = await requireAuth(c)
  if (!account) return c.redirect('/developer/login')

  // P2: usage dashboard may surface key activity; don't cache.
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, private')
  c.header('Pragma', 'no-cache')

  const db = c.env.DB
  const now = Math.floor(Date.now() / 1000)
  const ledger = await getLedgerPage(db, account.id, now - 90 * 86400, now, 50, 0)
  const entries = ledger.results ?? []

  function deltaColor(delta: number) {
    return delta > 0 ? 'color:var(--success)' : 'color:var(--danger)'
  }

  function timeStr(unix: number) {
    return new Date(unix * 1000).toLocaleString('en-CA', {
      timeZone: 'America/Toronto', month: 'short', day: 'numeric',
      year: 'numeric', hour: '2-digit', minute: '2-digit'
    })
  }

  return c.html(page('Usage History', `
  ${navBar(account)}
  <div style="max-width:800px;margin:0 auto;padding:32px 24px;">
    <div class="flex items-center gap-3 mb-6">
      <a href="/developer/dashboard" style="color:var(--text-muted);text-decoration:none;font-size:.9rem;">← Dashboard</a>
      <span style="color:var(--border);">|</span>
      <h1 style="font-size:1.3rem;font-weight:700;">Credit History (last 90 days)</h1>
    </div>

    <div class="card" style="overflow:hidden;">
      ${entries.length === 0
        ? `<div style="padding:32px;text-align:center;color:var(--text-muted);">No transactions yet.</div>`
        : `<table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="border-bottom:1px solid var(--border);">
              <th style="text-align:left;padding:10px 16px;font-size:.78rem;color:var(--text-muted);font-weight:600;">DATE</th>
              <th style="text-align:left;padding:10px 16px;font-size:.78rem;color:var(--text-muted);font-weight:600;">REASON</th>
              <th style="text-align:right;padding:10px 16px;font-size:.78rem;color:var(--text-muted);font-weight:600;">CHANGE</th>
              <th style="text-align:right;padding:10px 16px;font-size:.78rem;color:var(--text-muted);font-weight:600;">BALANCE</th>
            </tr>
          </thead>
          <tbody>
            ${entries.map((e: any) => `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:10px 16px;font-size:.85rem;color:var(--text-muted);">${timeStr(e.created_at)}</td>
              <td style="padding:10px 16px;font-size:.88rem;text-transform:capitalize;">${esc(e.reason)}${e.ref_id ? ` <span style="color:var(--text-muted);font-size:.8rem;">(${esc(e.ref_id.slice(0, 8))}…)</span>` : ''}</td>
              <td style="padding:10px 16px;text-align:right;font-weight:700;${deltaColor(e.delta)};">${e.delta > 0 ? '+' : ''}${e.delta}</td>
              <td style="padding:10px 16px;text-align:right;font-size:.88rem;">${e.balance_after}</td>
            </tr>`).join('')}
          </tbody>
        </table>`}
    </div>
  </div>
  `))
})

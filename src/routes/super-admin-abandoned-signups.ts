// ============================================================
// Super Admin — Abandoned Signups dashboard
// Mounted at /super-admin/abandoned-signups (HTML) and
// /api/super-admin/abandoned-signups/* (JSON). Superadmin only.
//
// Surfaces people who reached the verification step but never
// completed account registration. Two tabs:
//
//   1. Verified, No Account — got a code AND entered it correctly
//      (email_verification_codes.verified_at IS NOT NULL) but
//      never landed in the customers table. Highest intent.
//   2. Code Sent, Never Verified — got at least one code, never
//      entered it, never created an account. Lower intent but
//      still worth re-engaging.
//
// Per-row engagement (from email_sends): emails sent, opens, last
// open. Per-row action: send recovery nudge (manual override of
// the cron loop) which reuses sendSignupRecoveryEmail so the row
// flows through email_sends with tracking.
// ============================================================

import { Hono } from 'hono'
import { validateAdminSession, requireSuperadmin } from './auth'
import { sendSignupRecoveryEmail } from '../services/email'
import type { Bindings, AppEnv } from '../types'

export const superAdminAbandonedSignups = new Hono<AppEnv>()

// ── Session gate (superadmin only) ───────────────────────────
// Scoped to paths this router actually owns. See the email-tracker
// router's note on the root-mount auth-gate pitfall.
superAdminAbandonedSignups.use('*', async (c, next) => {
  const path = c.req.path
  const ownsThisPath = path === '/super-admin/abandoned-signups'
    || path.startsWith('/super-admin/abandoned-signups/')
    || path.startsWith('/api/super-admin/abandoned-signups/')
  if (!ownsThisPath) {
    await next()
    return
  }
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) {
    if (path.includes('/api/')) return c.json({ error: 'superadmin required' }, 403)
    return c.redirect('/login?next=' + encodeURIComponent(path), 302)
  }
  ;(c as any).set('admin', admin)
  await next()
})

const RECOVERY_KINDS = `('email_verification','signup_recovery_nudge','account_exists_nudge')`

// ── JSON: summary tiles ──────────────────────────────────────
superAdminAbandonedSignups.get('/api/super-admin/abandoned-signups/summary', async (c) => {
  const url = new URL(c.req.url)
  const days = Math.max(1, Math.min(180, Number(url.searchParams.get('days') || '30')))

  // Tab 1: verified but no customer row
  const verifiedNoAccount = await c.env.DB.prepare(`
    SELECT COUNT(DISTINCT evc.email) AS n
    FROM email_verification_codes evc
    LEFT JOIN customers c ON c.email = evc.email
    WHERE c.id IS NULL
      AND evc.verified_at IS NOT NULL
      AND evc.created_at > datetime('now', ?)
  `).bind(`-${days} days`).first<any>()

  // Tab 2: code sent, never verified, never accounted
  const sentNeverVerified = await c.env.DB.prepare(`
    SELECT COUNT(DISTINCT evc.email) AS n
    FROM email_verification_codes evc
    LEFT JOIN customers c ON c.email = evc.email
    WHERE c.id IS NULL
      AND evc.verified_at IS NULL
      AND evc.created_at > datetime('now', ?)
      AND NOT EXISTS (
        SELECT 1 FROM email_verification_codes evc2
        WHERE evc2.email = evc.email AND evc2.verified_at IS NOT NULL
      )
  `).bind(`-${days} days`).first<any>()

  // Recovery emails sent in the window
  const recoverySent = await c.env.DB.prepare(`
    SELECT COUNT(*) AS sent, COALESCE(SUM(open_count),0) AS opens,
           SUM(CASE WHEN open_count > 0 THEN 1 ELSE 0 END) AS opened
    FROM email_sends
    WHERE kind = 'signup_recovery_nudge'
      AND sent_at > datetime('now', ?)
  `).bind(`-${days} days`).first<any>()

  // Conversions after recovery — customer.created_at > the most recent
  // recovery send_at for that recipient
  const recoveryConversions = await c.env.DB.prepare(`
    SELECT COUNT(*) AS n
    FROM customers c
    WHERE EXISTS (
      SELECT 1 FROM email_sends es
      WHERE es.recipient = c.email
        AND es.kind = 'signup_recovery_nudge'
        AND es.sent_at < c.created_at
    )
      AND c.created_at > datetime('now', ?)
  `).bind(`-${days} days`).first<any>()

  const recoverySentN = Number(recoverySent?.sent || 0)
  const recoveryOpenedN = Number(recoverySent?.opened || 0)

  return c.json({
    days,
    verified_no_account: Number(verifiedNoAccount?.n || 0),
    sent_never_verified: Number(sentNeverVerified?.n || 0),
    recovery_sent: recoverySentN,
    recovery_opens: Number(recoverySent?.opens || 0),
    recovery_open_rate: recoverySentN > 0
      ? Math.round((recoveryOpenedN / recoverySentN) * 1000) / 10
      : 0,
    recovery_conversions: Number(recoveryConversions?.n || 0),
  })
})

// ── JSON: list rows for a tab ────────────────────────────────
superAdminAbandonedSignups.get('/api/super-admin/abandoned-signups/list', async (c) => {
  const url = new URL(c.req.url)
  const tab = url.searchParams.get('tab') === 'sent' ? 'sent' : 'verified'
  const days = Math.max(1, Math.min(180, Number(url.searchParams.get('days') || '30')))
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit') || '200')))

  const verifiedClause = tab === 'verified'
    ? 'evc.verified_at IS NOT NULL'
    : `evc.verified_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM email_verification_codes evc2
         WHERE evc2.email = evc.email AND evc2.verified_at IS NOT NULL
       )`

  // Single grouped query — one row per email with engagement aggregates.
  // Sub-selects against email_sends scoped to recovery/verification kinds.
  const sql = `
    SELECT
      evc.email AS email,
      MIN(evc.created_at) AS first_seen,
      MAX(COALESCE(evc.verified_at, evc.created_at)) AS last_activity,
      COUNT(evc.id) AS code_count,
      MAX(CASE WHEN evc.verified_at IS NOT NULL THEN 1 ELSE 0 END) AS ever_verified,
      (SELECT COUNT(*) FROM email_sends es
        WHERE es.recipient = evc.email
          AND es.kind IN ${RECOVERY_KINDS}) AS emails_sent,
      (SELECT COALESCE(SUM(open_count),0) FROM email_sends es
        WHERE es.recipient = evc.email
          AND es.kind IN ${RECOVERY_KINDS}) AS opens_total,
      (SELECT SUM(CASE WHEN open_count > 0 THEN 1 ELSE 0 END) FROM email_sends es
        WHERE es.recipient = evc.email
          AND es.kind IN ${RECOVERY_KINDS}) AS emails_opened,
      (SELECT MAX(opened_at) FROM email_sends es
        WHERE es.recipient = evc.email
          AND es.kind IN ${RECOVERY_KINDS}) AS last_opened,
      (SELECT MAX(sent_at) FROM email_sends es
        WHERE es.recipient = evc.email
          AND es.kind = 'signup_recovery_nudge') AS recovery_sent_at,
      (SELECT MAX(recovery_sent) FROM signup_attempts sa
        WHERE sa.email = evc.email) AS recovery_flag,
      (SELECT preview_id FROM signup_attempts sa
        WHERE sa.email = evc.email ORDER BY created_at DESC LIMIT 1) AS preview_id,
      (SELECT utm_source FROM signup_attempts sa
        WHERE sa.email = evc.email ORDER BY created_at DESC LIMIT 1) AS utm_source,
      EXISTS(SELECT 1 FROM signup_recovery_optouts sro WHERE sro.email = evc.email) AS opted_out
    FROM email_verification_codes evc
    LEFT JOIN customers c ON c.email = evc.email
    WHERE c.id IS NULL
      AND evc.created_at > datetime('now', ?)
      AND ${verifiedClause}
    GROUP BY evc.email
    ORDER BY last_activity DESC
    LIMIT ?
  `

  let results: any[] = []
  try {
    const r = await c.env.DB.prepare(sql).bind(`-${days} days`, limit).all<any>()
    results = r.results || []
  } catch (e: any) {
    return c.json({ error: e?.message || 'query failed', rows: [] }, 500)
  }

  return c.json({
    tab,
    days,
    rows: results.map((r: any) => ({
      email: r.email,
      first_seen: r.first_seen,
      last_activity: r.last_activity,
      code_count: Number(r.code_count || 0),
      ever_verified: Number(r.ever_verified || 0) === 1,
      emails_sent: Number(r.emails_sent || 0),
      emails_opened: Number(r.emails_opened || 0),
      opens_total: Number(r.opens_total || 0),
      last_opened: r.last_opened,
      recovery_sent_at: r.recovery_sent_at,
      recovery_flag: Number(r.recovery_flag || 0) === 1,
      preview_id: r.preview_id,
      utm_source: r.utm_source,
      opted_out: Number(r.opted_out || 0) === 1,
    })),
  })
})

// ── JSON: send recovery nudge to one email ───────────────────
superAdminAbandonedSignups.post('/api/super-admin/abandoned-signups/send-nudge', async (c) => {
  let body: any = {}
  try { body = await c.req.json() } catch {}
  const email = String(body?.email || '').trim().toLowerCase()
  const force = body?.force === true
  if (!email || !email.includes('@')) {
    return c.json({ ok: false, error: 'email required' }, 400)
  }

  // Refuse if this email already has a customer row — they completed
  // signup; sending the "you left before finishing" nudge would be a lie.
  try {
    const existing = await c.env.DB.prepare(
      'SELECT id FROM customers WHERE email = ? LIMIT 1'
    ).bind(email).first<any>()
    if (existing) return c.json({ ok: false, error: 'customer already exists', status: 'invalid' }, 409)
  } catch {}

  const r = await sendSignupRecoveryEmail(c.env, email, { force })
  return c.json({ ok: r.ok, status: r.status, error: r.error, email_send_id: r.emailSendId })
})

// ── HTML: dashboard page ─────────────────────────────────────
superAdminAbandonedSignups.get('/super-admin/abandoned-signups', (c) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Abandoned Signups · Roof Manager</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" />
  <style>
    body { background: #0a0a0a; color: #e5e7eb; font-family: Inter, system-ui, sans-serif; }
    .card { background: #111; border: 1px solid #1f1f1f; border-radius: 12px; }
    .tile { background: #111; border: 1px solid #1f1f1f; border-radius: 12px; padding: 16px 20px; }
    .tile h4 { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #9ca3af; margin: 0 0 6px; font-weight: 600; }
    .tile .v { font-size: 28px; font-weight: 700; color: #fff; line-height: 1.1; }
    .tile .sub { font-size: 11px; color: #6b7280; margin-top: 4px; }
    .tab-btn { padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all .15s; background: transparent; color: #9ca3af; border: 1px solid transparent; }
    .tab-btn.active { background: linear-gradient(135deg,#dc2626,#ef4444); color: #fff; box-shadow: 0 4px 12px rgba(220,38,38,.3); }
    .tab-btn:not(.active):hover { background: rgba(255,255,255,.06); color: #fff; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: #6b7280; padding: 10px 12px; border-bottom: 1px solid #1f1f1f; font-weight: 600; }
    td { padding: 12px; border-bottom: 1px solid #161616; font-size: 13px; color: #d1d5db; vertical-align: middle; }
    tr:hover td { background: rgba(255,255,255,.02); }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
    .pill-green { background: rgba(16,185,129,.15); color: #10b981; }
    .pill-amber { background: rgba(251,191,36,.15); color: #fbbf24; }
    .pill-red { background: rgba(239,68,68,.15); color: #ef4444; }
    .pill-gray { background: rgba(156,163,175,.15); color: #9ca3af; }
    .nudge-btn { background: #00cc6a; color: #0a0a0a; font-weight: 700; padding: 6px 12px; border-radius: 6px; font-size: 12px; border: none; cursor: pointer; transition: all .15s; }
    .nudge-btn:hover:not(:disabled) { background: #00ff88; transform: translateY(-1px); }
    .nudge-btn:disabled { background: #374151; color: #6b7280; cursor: not-allowed; }
    .empty { text-align: center; padding: 60px 20px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="max-w-7xl mx-auto p-6">
    <div class="flex items-center justify-between mb-6">
      <div>
        <a href="/super-admin" class="text-xs text-gray-500 hover:text-gray-300"><i class="fas fa-arrow-left"></i> Super Admin</a>
        <h1 class="text-2xl font-bold text-white mt-2">Abandoned Signups</h1>
        <p class="text-sm text-gray-400 mt-1">People who hit the verification step but never finished registration.</p>
      </div>
      <div class="flex items-center gap-3">
        <label class="text-xs text-gray-400">Window</label>
        <select id="days" class="bg-black border border-gray-800 rounded-lg px-3 py-2 text-sm text-white">
          <option value="7">7 days</option>
          <option value="30" selected>30 days</option>
          <option value="90">90 days</option>
          <option value="180">180 days</option>
        </select>
        <button onclick="loadAll()" class="bg-white/10 hover:bg-white/20 text-white text-sm px-3 py-2 rounded-lg" title="Refresh">
          <i class="fas fa-rotate"></i>
        </button>
      </div>
    </div>

    <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6" id="tiles">
      <div class="tile"><h4>Verified, No Account</h4><div class="v" id="t-verified">–</div><div class="sub">Entered code, bailed on form</div></div>
      <div class="tile"><h4>Sent, Never Verified</h4><div class="v" id="t-sent">–</div><div class="sub">Got the code email, never returned</div></div>
      <div class="tile"><h4>Recovery Emails Sent</h4><div class="v" id="t-rec-sent">–</div><div class="sub">In window</div></div>
      <div class="tile"><h4>Recovery Open Rate</h4><div class="v" id="t-rec-open">–</div><div class="sub" id="t-rec-open-sub">–</div></div>
      <div class="tile"><h4>Recovery → Signup</h4><div class="v" id="t-rec-conv">–</div><div class="sub">Customers created after a nudge</div></div>
    </div>

    <div class="card p-4 mb-4">
      <div class="flex items-center gap-2">
        <button class="tab-btn active" data-tab="verified" onclick="setTab('verified')">
          <i class="fas fa-check-circle mr-1"></i> Verified, No Account
        </button>
        <button class="tab-btn" data-tab="sent" onclick="setTab('sent')">
          <i class="fas fa-envelope mr-1"></i> Code Sent, Never Verified
        </button>
      </div>
    </div>

    <div class="card overflow-hidden">
      <div id="status-row" class="text-xs text-gray-500 px-4 py-2 border-b border-gray-800">Loading…</div>
      <div style="overflow-x:auto">
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>First Seen</th>
              <th>Last Activity</th>
              <th>Codes</th>
              <th>Emails Sent</th>
              <th>Opens</th>
              <th>Last Open</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
      <div id="empty" class="empty hidden">
        <i class="fas fa-leaf text-3xl mb-3 text-gray-700"></i>
        <p>No abandoned signups in this window. Healthy funnel.</p>
      </div>
    </div>
  </div>

<script>
let currentTab = 'verified';
const fmt = (s) => {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return s;
  const now = Date.now();
  const diffMin = Math.floor((now - d.getTime()) / 60000);
  if (diffMin < 60) return diffMin + 'm ago';
  if (diffMin < 1440) return Math.floor(diffMin / 60) + 'h ago';
  const days = Math.floor(diffMin / 1440);
  if (days < 30) return days + 'd ago';
  return d.toISOString().slice(0,10);
};

function days() { return document.getElementById('days').value; }

function setTab(t) {
  currentTab = t;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === t));
  loadRows();
}

async function loadTiles() {
  try {
    const r = await fetch('/api/super-admin/abandoned-signups/summary?days=' + days());
    const j = await r.json();
    document.getElementById('t-verified').textContent = j.verified_no_account ?? 0;
    document.getElementById('t-sent').textContent = j.sent_never_verified ?? 0;
    document.getElementById('t-rec-sent').textContent = j.recovery_sent ?? 0;
    document.getElementById('t-rec-open').textContent = (j.recovery_open_rate ?? 0) + '%';
    document.getElementById('t-rec-open-sub').textContent = (j.recovery_opens ?? 0) + ' total opens';
    document.getElementById('t-rec-conv').textContent = j.recovery_conversions ?? 0;
  } catch (e) {
    console.error('summary load failed', e);
  }
}

async function loadRows() {
  const status = document.getElementById('status-row');
  const tbody = document.getElementById('rows');
  const empty = document.getElementById('empty');
  status.textContent = 'Loading…';
  tbody.innerHTML = '';
  empty.classList.add('hidden');
  try {
    const r = await fetch('/api/super-admin/abandoned-signups/list?tab=' + currentTab + '&days=' + days());
    const j = await r.json();
    const rows = j.rows || [];
    status.textContent = rows.length + ' ' + (rows.length === 1 ? 'person' : 'people') + ' · ' + currentTab + ' · last ' + j.days + ' days';
    if (rows.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    tbody.innerHTML = rows.map(rowHtml).join('');
  } catch (e) {
    status.textContent = 'Load failed: ' + (e?.message || e);
  }
}

function rowHtml(r) {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  let statusPill;
  if (r.opted_out) statusPill = '<span class="pill pill-red">Opted out</span>';
  else if (r.recovery_flag || r.recovery_sent_at) statusPill = '<span class="pill pill-amber">Nudge sent</span>';
  else if (r.ever_verified) statusPill = '<span class="pill pill-green">Verified</span>';
  else statusPill = '<span class="pill pill-gray">Code sent</span>';

  const btnDisabled = r.opted_out;
  const btnLabel = r.recovery_flag || r.recovery_sent_at ? 'Re-send nudge' : 'Send nudge';
  const btn = btnDisabled
    ? '<button class="nudge-btn" disabled title="Opted out">Opted out</button>'
    : '<button class="nudge-btn" onclick="sendNudge(this, \\'' + esc(r.email).replace(/\\\\/g,'\\\\\\\\').replace(/'/g,"\\\\'") + '\\', ' + (r.recovery_flag || r.recovery_sent_at ? 'true' : 'false') + ')">' + btnLabel + '</button>';

  return '<tr>' +
    '<td><div class="font-mono text-white">' + esc(r.email) + '</div>' +
      (r.utm_source ? '<div class="text-xs text-gray-500 mt-1">utm: ' + esc(r.utm_source) + '</div>' : '') + '</td>' +
    '<td>' + fmt(r.first_seen) + '</td>' +
    '<td>' + fmt(r.last_activity) + '</td>' +
    '<td>' + r.code_count + '</td>' +
    '<td>' + r.emails_sent + '</td>' +
    '<td>' + r.emails_opened + (r.opens_total > r.emails_opened ? ' <span class="text-xs text-gray-500">(' + r.opens_total + ' total)</span>' : '') + '</td>' +
    '<td>' + fmt(r.last_opened) + '</td>' +
    '<td>' + statusPill + '</td>' +
    '<td class="text-right">' + btn + '</td>' +
    '</tr>';
}

async function sendNudge(btn, email, isResend) {
  if (!confirm((isResend ? 'Re-send' : 'Send') + ' recovery nudge to ' + email + '?')) return;
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Sending…';
  try {
    const r = await fetch('/api/super-admin/abandoned-signups/send-nudge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, force: !!isResend }),
    });
    const j = await r.json();
    if (j.ok) {
      btn.textContent = '✓ Sent';
      btn.style.background = '#10b981';
      setTimeout(() => { loadRows(); loadTiles(); }, 1200);
    } else {
      btn.disabled = false;
      btn.textContent = original;
      alert('Failed: ' + (j.error || j.status || 'unknown'));
    }
  } catch (e) {
    btn.disabled = false;
    btn.textContent = original;
    alert('Error: ' + (e?.message || e));
  }
}

function loadAll() { loadTiles(); loadRows(); }

document.getElementById('days').addEventListener('change', loadAll);
loadAll();
</script>
</body>
</html>`
  return c.html(html)
})

#!/usr/bin/env node
// ============================================================
// Roofer Secretary — End-to-End Smoke Test
// ------------------------------------------------------------
// Hits every customer-facing Secretary endpoint on production and reports
// pass/fail with HTTP status + error body. Read-only by default; flip
// the `--write` flag to also exercise mutating endpoints (will not
// charge a card, but WILL save config rows to D1 — use a dev account).
//
// Usage:
//   RM_TOKEN=<your customer session token> node tools/secretary_smoke_test.mjs
//   RM_TOKEN=... node tools/secretary_smoke_test.mjs --write
//
// To grab your token: open www.roofmanager.ca/customer/dashboard while
// logged in, devtools → Application → Local Storage → copy
// `rc_customer_token`. (If empty, the cookie `rm_customer_session` works
// too — pass via RM_COOKIE.)
// ============================================================

const BASE = process.env.RM_BASE || 'https://www.roofmanager.ca'
const TOKEN = process.env.RM_TOKEN || ''
const COOKIE = process.env.RM_COOKIE || ''
const DO_WRITES = process.argv.includes('--write')

if (!TOKEN && !COOKIE) {
  console.error('Set RM_TOKEN=<session token> or RM_COOKIE=rm_customer_session=<token> before running.')
  process.exit(2)
}

const HEADERS = (extra = {}) => ({
  'Content-Type': 'application/json',
  ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  ...(COOKIE ? { Cookie: COOKIE.startsWith('rm_customer_session=') ? COOKIE : `rm_customer_session=${COOKIE}` } : {}),
  ...extra,
})

const results = []

async function check(name, method, path, body = null, opts = {}) {
  const url = `${BASE}${path}`
  const init = { method, headers: HEADERS() }
  if (body !== null) init.body = JSON.stringify(body)
  let status = 0, json = null, text = ''
  try {
    const res = await fetch(url, init)
    status = res.status
    text = await res.text()
    try { json = text ? JSON.parse(text) : null } catch {}
  } catch (e) {
    results.push({ name, method, path, status: 0, ok: false, error: e.message })
    return null
  }
  const expected = opts.expected || [200]
  const allow404 = opts.allow404 || false
  const ok = expected.includes(status) || (allow404 && status === 404)
  const errorMsg = ok ? '' : (json?.error || json?.errors?.[0]?.detail || text.slice(0, 200))
  results.push({ name, method, path, status, ok, error: errorMsg, body: json })
  return json
}

async function run() {
  console.log(`\n🧪 Roofer Secretary smoke test — base=${BASE}\n`)

  // ── Auth + status sanity ────────────────────────────────────
  const me = await check('Me (customer-auth)', 'GET', '/api/customer-auth/me')
  const cust = me?.customer || me
  if (me?.error || !cust?.email) {
    console.error('\n❌ Cannot identify customer. Token likely invalid/expired.')
    return printSummary()
  }
  console.log(`Authenticated as: ${cust.email} (id ${cust.id || cust.customer_id || '?'})`)
  // stash for later
  me.id = cust.id; me.email = cust.email

  // ── Subscription status / trial ─────────────────────────────
  await check('Subscription status', 'GET', '/api/secretary/status')
  await check('Trial status', 'GET', '/api/secretary/trial-status')

  // ── Config / directories ────────────────────────────────────
  await check('Get config', 'GET', '/api/secretary/config', null, { allow404: true })
  await check('Get directories', 'GET', '/api/secretary/directories', null, { allow404: true })

  // ── Calls / messages / appointments / callbacks ─────────────
  await check('Call log', 'GET', '/api/secretary/calls', null, { allow404: true })

  // ── Phone numbers (search) — should work pre-trial after our fix ─
  await check('Number search (US, area=512)', 'GET', '/api/secretary/numbers/search?country=US&areaCode=512&limit=5')
  await check('Number search (CA, area=780)', 'GET', '/api/secretary/numbers/search?country=CA&areaCode=780&limit=5')

  // ── Phone setup status ──────────────────────────────────────
  await check('Phone setup status', 'GET', '/api/secretary/phone-status', null, { allow404: true })
  await check('Carriers', 'GET', '/api/secretary/carriers', null, { allow404: true })

  // ── Public agent-config alias (should work without auth) ────
  if (me?.id || me?.customer_id) {
    const cid = me.id || me.customer_id
    await check('Agent config (public alias)', 'GET', `/api/secretary/agent-config/${cid}`, null, { allow404: true })
    await check('Agent config (legacy /api/agents)', 'GET', `/api/agents/agent-config/${cid}`, null, { allow404: true })
  }

  // ── LiveKit token ───────────────────────────────────────────
  await check('LiveKit token', 'POST', '/api/secretary/livekit-token', { roomName: 'smoke-test' })

  // ── Mutation smoke (only with --write) ──────────────────────
  if (DO_WRITES) {
    console.log('\n⚙️  --write mode: exercising mutation endpoints (no charges)\n')
    await check('Save config (smoke)', 'POST', '/api/secretary/config', {
      business_phone: '+15555550100',
      greeting_script: 'Smoke test greeting',
      common_qa: 'Q: test\nA: test',
      general_notes: 'smoke test note',
      secretary_mode: 'directory',
      agent_name: 'SmokeBot',
      agent_voice: 'alloy',
    })
    await check('Save directories (smoke)', 'PUT', '/api/secretary/directories', {
      directories: [
        { name: 'Sales', phone_or_action: '+15555550101', special_notes: '' },
        { name: 'Service', phone_or_action: '+15555550102', special_notes: '' },
      ],
    })
    await check('Toggle service', 'POST', '/api/secretary/toggle')
    // Toggle back so we don't leave the test account in active state.
    await check('Toggle back', 'POST', '/api/secretary/toggle')
  }

  printSummary()
}

function printSummary() {
  console.log('\n' + '─'.repeat(80))
  let pass = 0, fail = 0
  for (const r of results) {
    const icon = r.ok ? '✅' : '❌'
    const line = `${icon} [${String(r.status).padStart(3)}] ${r.method.padEnd(4)} ${r.path}`
    console.log(line + (r.ok ? '' : `\n        → ${r.error}`))
    r.ok ? pass++ : fail++
  }
  console.log('─'.repeat(80))
  console.log(`Total: ${results.length}  ✅ Pass: ${pass}  ❌ Fail: ${fail}`)
  if (fail > 0) process.exit(1)
}

run().catch(e => {
  console.error('Test runner crashed:', e)
  process.exit(1)
})

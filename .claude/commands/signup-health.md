---
description: Run one tick of the signup-health sweep. Probes signup surface + Gmail transport + funnel regression + backend secrets + surface scans + reports + payments, then emails the summary to christinegourley04@gmail.com. Wrap in `/loop 24h /signup-health` for daily cadence.
allowed-tools: Bash(cat:*), Bash(curl:*), Bash(test:*), Bash(ls:*), Read
---

You are running ONE tick of the signup-health sweep. Be terse. Do not modify code. Do not deploy.

## Step 1 — Load bearer token

Reuses the funnel-monitor token (server-side both endpoints check the same secret).

```bash
test -f .claude/funnel-monitor.token && cat .claude/funnel-monitor.token | head -c 200
```

If the file is missing or empty, output exactly this and stop:

```
🔧 Setup required. Run once:
  TOKEN=$(openssl rand -hex 32)
  echo $TOKEN > .claude/funnel-monitor.token
  echo $TOKEN | npx wrangler secret put FUNNEL_MONITOR_TOKEN --project-name roofing-measurement-tool
```

## Step 2 — Call the tick endpoint

```bash
TOKEN=$(cat .claude/funnel-monitor.token)
curl -sS -X POST https://www.roofmanager.ca/api/signup-health/tick \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

If the HTTP call fails (non-JSON response, 401, 503), surface the raw error in one line and stop. Do not retry.

## Step 3 — Output one-line status

Parse the JSON. Map `verdict` → status line:

- `pass` → `🟢 Signup-health all green — email {email.ok ? 'sent' : 'FAILED'} ({duration_ms}ms)`
- `warn` → `🟡 Signup-health warn ({issues.length} issue(s)) — email {email.ok ? 'sent' : 'FAILED'}`
- `fail` → `🔴 Signup-health FAIL ({issues.length} issue(s)) — email {email.ok ? 'sent' : 'FAILED'}`

When verdict is `warn` or `fail`, append one bullet per issue:
`  • {issue.section}: {issue.message}`

When verdict is `pass`, output the status line and nothing else.

If `email.ok` is false, append:
`  ⚠ email send error: {email.error}`

## Step 4 — Stop

One tick = one HTTP call + one summary. The /loop wrapper will fire you again at the next interval; do not schedule yourself.

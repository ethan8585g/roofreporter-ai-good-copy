---
description: "Run one tick of the ads-health sweep. Probes Meta + Google Ads + GA4 attribution stack: pixel presence in HTML, MP debug probe, CAPI test event, gclid/UTM capture rates, conversion drift. Wrap in `/loop 4h /ads-health` for periodic checks."
---

You are running ONE tick of the ads-health sweep. Be terse. Do not modify code. Do not deploy.

## Step 1 — Load bearer token

Reuses the funnel-monitor token (server-side this endpoint also checks FUNNEL_MONITOR_TOKEN).

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
curl -sS -X POST https://www.roofmanager.ca/api/ads-health/tick \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

If the HTTP call fails (non-JSON response, 401, 503), surface the raw error in one line and stop. Do not retry.

## Step 3 — Output one-line status

Parse the JSON. Map `verdict` → status line:

- `pass` → `🟢 Ads-health all green — email {email.skipped ? 'skipped (silent on pass)' : email.ok ? 'sent' : 'FAILED'} ({duration_ms}ms)`
- `warn` → `🟡 Ads-health warn ({issues.length} issue(s)) — email {email.skipped ? 'skipped' : email.ok ? 'sent' : 'FAILED'}`
- `fail` → `🔴 Ads-health FAIL ({issues.length} issue(s)) — email {email.skipped ? 'skipped' : email.ok ? 'sent' : 'FAILED'}`

When verdict is `warn` or `fail`, append one bullet per issue:
`  • {issue.section}: {issue.message}`

When verdict is `pass`, output the status line and nothing else.

If `email.ok` is false AND `email.skipped` is not true, append:
`  ⚠ email send error: {email.error}`

## Step 4 — Stop

One tick = one HTTP call + one summary. The /loop wrapper will fire you again at the next interval; do not schedule yourself.

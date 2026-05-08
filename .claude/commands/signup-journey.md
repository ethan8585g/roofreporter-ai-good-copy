---
description: Run one tick of the signup-journey trace. Mints a synthetic logged-in customer session, walks every /customer/* page + the major auth'd APIs + a few toggle round-trips, and emails any dead ends to christinegourley04@gmail.com (only when issues are found). Wrap in `/loop 1h /signup-journey` for hourly cadence.
allowed-tools: Bash(cat:*), Bash(curl:*), Bash(test:*), Bash(ls:*), Read
---

You are running ONE tick of the signup-journey trace. Be terse. Do not modify code. Do not deploy.

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
curl -sS -X POST https://www.roofmanager.ca/api/signup-journey/tick \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

If the HTTP call fails (non-JSON response, 401, 503), surface the raw error in one line and stop. Do not retry.

## Step 3 — Output one-line status

Parse the JSON. Map `verdict` → status line:

- `pass` → `🟢 Journey clean — pages {pages.checked - pages.failed}/{pages.checked}, APIs {apis.checked - apis.failed}/{apis.checked}, toggles {toggles.checked - toggles.failed}/{toggles.checked} ({duration_ms}ms)`
- `warn` → `🟡 Journey warn ({dead_ends.length} soft issue(s)) — pages {pages.failed} fail, APIs {apis.failed} fail, toggles {toggles.failed} fail`
- `fail` → `🔴 Journey FAIL ({dead_ends.length} dead end(s)) — pages {pages.failed} fail, APIs {apis.failed} fail, toggles {toggles.failed} fail`

When verdict is `warn` or `fail`, append one bullet per dead end (max 8):
`  • [{dead_end.severity}] {dead_end.category} {dead_end.path} → {dead_end.status ?? '—'}: {dead_end.message}`

If there are more than 8 dead ends, append a final bullet:
`  • …and {dead_ends.length - 8} more (see email + loop tracker)`

When verdict is `pass`, output the status line and nothing else. (Email is skipped on healthy ticks by default.)

If `email.ok` is false (and not just `skipped`), append:
`  ⚠ email send error: {email.error}`

## Step 4 — Stop

One tick = one HTTP call + one summary. The /loop wrapper handles cadence.

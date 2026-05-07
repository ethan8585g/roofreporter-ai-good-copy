---
description: Run one tick of the signup-funnel monitor — alerts on conversion regressions vs same-hour-of-day 7d baseline. Wrap in `/loop 1h /funnel-monitor` for hourly cadence.
allowed-tools: Bash(cat:*), Bash(curl:*), Bash(test:*), Bash(ls:*), Read
---

You are running ONE tick of the signup-funnel monitor. Be terse. Do not modify code. Do not deploy. Do not narrate.

## Step 1 — Load bearer token

Read the token from `.claude/funnel-monitor.token` (gitignored).

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
curl -sS -X POST https://www.roofmanager.ca/api/funnel-monitor/tick \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

If the HTTP call fails (non-JSON response, 401, 503), surface the raw error in one line and stop. Do not retry.

## Step 3 — Output one-line status

Parse the JSON. Map `verdict` → status line:

- `healthy` → `🟢 Funnel healthy — {current.pageviews} views, {current.form_submits} submits, {current.customers_created} signups in last hour`
- `watch` → `🟡 Watch: {drop_stage} {first note from notes[]}`
- `alert` → `🔴 Alert queued (#{alert_id}): {first note from notes[]}`
- `insufficient_data` → `⚪ Insufficient data — {first note from notes[]}`

Append a single bullet line per stage ONLY when verdict is `alert` or `watch`, formatted as:
`  • {stage.name}: {rate as %} (baseline {baseline_rate as %}, Δ {delta_pct}%)`

For `healthy` and `insufficient_data`, output the status line and nothing else.

## Step 4 — Stop

That's it. One tick = one HTTP call + one summary. The /loop wrapper will fire you again at the next interval; do not schedule yourself.

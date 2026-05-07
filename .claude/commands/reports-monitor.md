---
description: Run one tick of the report-error monitor — sweeps recent roof-measurement reports for broken diagrams, duplicated structures, missing HTML, and stuck/failed states. Wrap in `/loop 1h /reports-monitor` for hourly cadence.
allowed-tools: Bash(cat:*), Bash(curl:*), Bash(test:*), Bash(ls:*), Read
---

You are running ONE tick of the reports-error monitor. Be terse. Do not modify code. Do not deploy. Do not narrate.

## Step 1 — Load bearer token

Read the token from `.claude/reports-monitor.token` (gitignored).

```bash
test -f .claude/reports-monitor.token && cat .claude/reports-monitor.token | head -c 200
```

If the file is missing or empty, output exactly this and stop:

```
🔧 Setup required. Run once:
  TOKEN=$(openssl rand -hex 32)
  echo $TOKEN > .claude/reports-monitor.token
  echo $TOKEN | npx wrangler secret put REPORTS_MONITOR_TOKEN --project-name roofing-measurement-tool
```

## Step 2 — Call the tick endpoint

```bash
TOKEN=$(cat .claude/reports-monitor.token)
curl -sS -X POST https://www.roofmanager.ca/api/reports-monitor/tick \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

If the HTTP call fails (non-JSON response, 401, 503), surface the raw error in one line and stop. Do not retry.

## Step 3 — Output one-line status

Parse the JSON. Map the result to a status line:

- `fail_count === 0 && pages_checked > 0` → `🟢 Reports OK — {pages_checked} scanned, 0 errors`
- `fail_count === 0 && pages_checked === 0` → `⚪ No new reports in scan window`
- `fail_count > 0` → `🔴 {fail_count} error(s) across {pages_checked} report(s) — run #{run_id}`

When `fail_count > 0`, append one bullet per category present in `by_category`, formatted as:
`  • {category}: {count}`

Then up to 5 bullets from `findings` (severity 'error' first), formatted as:
`  • [{severity}] {message}`

For the green/empty cases, output the status line and nothing else.

## Step 4 — Stop

That's it. One tick = one HTTP call + one summary. The /loop wrapper will fire you again at the next interval; do not schedule yourself.

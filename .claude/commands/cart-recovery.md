---
description: Run one tick of the abandoned-checkout-recovery sweep. Fires the +2h and +24h emails to customers whose Square checkout is stuck in pending. Wrap in `/loop 10m /cart-recovery` for continuous cadence (matches the cron-worker schedule).
allowed-tools: Bash(cat:*), Bash(curl:*), Bash(test:*), Bash(ls:*), Read
---

You are running ONE tick of the abandoned-checkout-recovery sweep. Be terse. Do not modify code. Do not deploy.

## Step 1 — Load bearer token

Reuses the funnel-monitor token (server-side the endpoint checks the same secret).

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
curl -sS -X POST https://www.roofmanager.ca/api/cart-recovery/tick \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

If the HTTP call fails (non-JSON response, 401, 503), surface the raw error in one line and stop. Do not retry.

## Step 3 — Output one-line status

Parse the JSON. Map `verdict` → status line:

- `idle` → `⚪ Cart-recovery idle — 0 abandoned checkouts in window ({duration_ms}ms)`
- `sent` → `🟢 Cart-recovery sent {totals.sent} ({stages_breakdown}) — {duration_ms}ms`
- `fail` → `🔴 Cart-recovery FAIL — sent {totals.sent}, failed {totals.failed}`

Where `stages_breakdown` is the per-stage `sent/found`, e.g. `2h=3/3 24h=1/2`.

When verdict is `fail`, append one bullet per stage with errors:
`  • {stage.stage}: {stage.errors[0]}`

When verdict is `idle` or `sent` and `totals.failed === 0`, output the status line and nothing else.

## Step 4 — Stop

One tick = one HTTP call + one summary. The /loop wrapper will fire you again at the next interval; do not schedule yourself.

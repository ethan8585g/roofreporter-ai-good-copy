---
description: Run one tick of the mobile webfront + customer module trace. Loads each surface in a real Cloudflare browser at iPhone viewport (375×667 @ 2x DPR, iOS Safari UA) and emails any breakage to christinegourley04@gmail.com (only when issues are found). Wrap in `/loop 12h /mobile-monitor` for twice-daily cadence.
allowed-tools: Bash(cat:*), Bash(curl:*), Bash(test:*), Bash(ls:*), Read
---

You are running ONE tick of the mobile-monitor trace. Be terse. Do not modify code. Do not deploy.

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
curl -sS -X POST https://www.roofmanager.ca/api/mobile-monitor/tick \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

If the HTTP call fails (non-JSON response, 401, 503), surface the raw error in one line and stop. Do not retry.

## Step 3 — Output one-line status

Parse the JSON. Map `verdict` → status line:

- `pass` → `🟢 Mobile clean — public {public.checked - public.failed}/{public.checked}, customer {customer.checked - customer.failed}/{customer.checked} ({duration_ms}ms)`
- `warn` → `🟡 Mobile warn ({findings.length} soft issue(s)) — public {public.failed} fail, customer {customer.failed} fail`
- `fail` → `🔴 Mobile FAIL ({findings.filter(f=>f.severity==='error').length} dead end(s)) — public {public.failed} fail, customer {customer.failed} fail`

When verdict is `warn` or `fail`, append one bullet per finding (max 8):
`  • [{finding.severity}] {finding.section}/{finding.category} {finding.path} → {finding.status ?? '—'}: {finding.message}`

If there are more than 8 findings, append a final bullet:
`  • …and {findings.length - 8} more (see email + loop tracker)`

When verdict is `pass`, output the status line and nothing else. (Email is skipped on healthy ticks by default.)

If `email.ok` is false (and not just `skipped`), append:
`  ⚠ email send error: {email.error}`

If `browser_rendering_available` is false, append on its own line:
`  ⚠ Browser Rendering not configured — set CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN secrets`

## Step 4 — Stop

One tick = one HTTP call + one summary. The /loop wrapper handles cadence.

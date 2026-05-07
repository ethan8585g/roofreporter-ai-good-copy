---
description: Probe Gmail OAuth2 transport health — mints an access token from the production refresh token. Queues an URGENT super-admin alert if it fails. Wrap with `/loop 6h /gmail-health` for periodic checks.
allowed-tools: Bash(cat:*), Bash(curl:*), Bash(test:*), Read
---

You are running ONE tick of the Gmail-OAuth2 health probe. Be terse. Do not modify code. Do not deploy.

## Step 1 — Load bearer token

```bash
test -f .claude/funnel-monitor.token && cat .claude/funnel-monitor.token | head -c 200
```

If the file is missing or empty, output the setup instructions from `/funnel-monitor` (token is shared) and stop.

## Step 2 — Call the tick endpoint

```bash
TOKEN=$(cat .claude/funnel-monitor.token)
curl -sS -X POST https://www.roofmanager.ca/api/email-health/tick \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

If the HTTP call fails, surface the raw error in one line and stop.

## Step 3 — Output one-line status

Parse the JSON. Map `healthy` → status line:

- `healthy: true` → `🟢 Gmail OAuth2 healthy — access token mints OK (expires in {token_mint.expires_in_s}s, scope {token_mint.scope})`
- `healthy: false` → `🔴 Gmail OAuth2 BROKEN (alert #{alert_id}): {first note from notes[]}`

When unhealthy, append two bullets:
- `  • creds: client_id={creds.client_id}, client_secret={creds.client_secret}, refresh_token={creds.refresh_token}, sender_email={creds.sender_email}`
- `  • token mint: status={token_mint.status}, error={token_mint.error}`

## Step 4 — Stop

One tick = one HTTP call + one summary. The /loop wrapper handles cadence.

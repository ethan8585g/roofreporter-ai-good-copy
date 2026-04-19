# AI Secretary Provisioning — Super Admin Guide

## Overview

The AI Secretary provisioning system allows a super admin to onboard new customers as AI Secretary subscribers entirely from the web UI — no CLI or terminal access required.

**Dashboard URL:** `/admin/super/secretary`

## Workflow

1. **Provision** — Fill out the customer form, pick a phone strategy (pool, Twilio purchase, or BYO SIP), configure the agent, and click "Provision + Deploy SIP Trunk".
2. **Verify** — The system creates a LiveKit SIP inbound trunk + dispatch rule, assigns the phone number, and marks `connection_status = connected`. Click "Test Call" to verify.
3. **Deploy Agent** — If the Python agent code has changed, use the Agent Deploy tab to trigger a LiveKit Cloud deployment via GitHub Actions.
4. **Manage** — Use the Subscribers tab to monitor status, redeploy trunks, or toggle active state.

## Required Environment Variables

### Cloudflare Workers (via `wrangler secret put`)

| Variable | Required | Description |
|----------|----------|-------------|
| `LIVEKIT_API_KEY` | Yes | LiveKit project API key |
| `LIVEKIT_API_SECRET` | Yes | LiveKit project API secret |
| `LIVEKIT_URL` | Yes | LiveKit WebSocket URL (e.g. `wss://roofreporterai-btkwkiwh.livekit.cloud`) |
| `LIVEKIT_SIP_URI` | Yes | LiveKit SIP URI (from Project Settings → SIP) |
| `TWILIO_ACCOUNT_SID` | For Twilio | Twilio account SID (for number purchase/pool) |
| `TWILIO_AUTH_TOKEN` | For Twilio | Twilio auth token |
| `LIVEKIT_DEPLOY_WEBHOOK_URL` | For deploy | GitHub repository_dispatch URL |
| `LIVEKIT_DEPLOY_WEBHOOK_SECRET` | Optional | HMAC-SHA256 secret for webhook signatures |

### GitHub Actions Secrets

| Secret | Description |
|--------|-------------|
| `LK_CLOUD_TOKEN` | LiveKit Cloud API token for `lk agent deploy` |

## Phone Number Strategies

### 1. Assign from Pool
Numbers pre-loaded into `secretary_phone_pool`. Super admin picks one during provisioning.

### 2. Purchase from Twilio
Search available numbers by country/area code, purchase directly from Twilio, and auto-add to pool.

### 3. BYO SIP Credentials
Customer provides their own E.164 number + SIP username/password. The trunk is created with auth credentials.

## Agent Deployment

The Python agent at `livekit-agent/` is deployed to LiveKit Cloud via:

1. **Automatic** — Push to `main` with changes in `livekit-agent/` triggers `.github/workflows/livekit-agent-deploy.yml`.
2. **Manual** — Click "Deploy Agent to LiveKit Cloud" in the dashboard, which fires a `repository_dispatch` webhook to the same workflow.
3. **CLI** — Run `lk agent deploy --subdomain roofreporterai-btkwkiwh --yes .` from the `livekit-agent/` directory.

## Troubleshooting

### "LIVEKIT_DEPLOY_WEBHOOK_URL not configured" (501)
Set the webhook URL via `wrangler secret put LIVEKIT_DEPLOY_WEBHOOK_URL`. For GitHub Actions, use:
```
https://api.github.com/repos/{owner}/{repo}/dispatches
```
You'll also need a GitHub Personal Access Token with `repo` scope set as the Authorization header, or configure the webhook to use a GitHub App token.

### Trunk created but dispatch rule fails
The system performs automatic compensating rollback — the orphaned trunk is deleted. Check `secretary_config.last_test_details` for the error message.

### connection_status stuck on "pending_forwarding"
This should not happen — every code path resolves to either `connected` or `failed`. If it does, run "Redeploy Trunk" from the Subscribers tab.

### Test call returns "failed"
1. Verify the phone number is correct in `secretary_config.assigned_phone_number`.
2. Check that the LiveKit trunk exists via the SIP Bridge tab in the admin panel.
3. Ensure the Python agent is deployed and running (`lk agent logs`).

### Agent not answering calls
1. Verify the dispatch rule is routing to rooms with prefix `secretary-{customerId}-`.
2. Check the agent config endpoint: `GET /api/secretary/agent-config/{customerId}` should return valid config.
3. Check LiveKit Cloud logs: `lk agent logs --subdomain roofreporterai-btkwkiwh`.

# Debug Prompt — AI Secretary Module End-to-End

Paste this into a Claude Code terminal opened at the repo root.

---

The AI Secretary module is broken for customers that already completed setup. On the test account **dev@reusecanada.ca** (secretary configured, forwarding to my personal cell), none of these take effect on real calls or after save:

- Call script (`greeting_script`) edits
- Agent name change (`agent_name`)
- Call forwarding / forwarding number changes
- Call transcripts (not being saved / not visible in the UI)

I need you to **fully debug the entire module, end to end, as deployed** — not just statically read code. Treat this as a production incident across four layers: Workers API (Hono + D1), UI (`public/static/secretary.js` + `getSecretaryPageHTML` in `src/index.tsx`), LiveKit Python agent (`livekit-agent/`), and Twilio SIP trunk + dispatch rules.

## Suspected bugs to verify FIRST (found during triage — confirm or rule out)

1. **Dead config endpoint.** The LiveKit agent hits `{API_BASE}/api/secretary/agent-config/{customer_id}` (see `livekit-agent/agent.py:131` and `livekit-agent/src/agent.py:58`). But `secretaryRoutes` has no such route — the real endpoint is mounted at `/api/agents/agent-config/:customerId` (`src/routes/agents.ts:129`, mounted in `src/index.tsx:317` as `/api/agents`). Hit both URLs against prod with the dev account's customer_id and confirm which 404s. If confirmed, this alone would explain why script / name changes never apply — the agent falls back to the hardcoded `"Sarah"` + generic greeting defaults in `agent.py`.

2. **Two agent.py files.** `livekit-agent/agent.py` (522 lines) and `livekit-agent/src/agent.py` (469 lines) both exist with overlapping but divergent logic. Check `deploy.sh`, `Dockerfile`, `ecosystem.config.cjs`, `pyproject.toml`, and `livekit.toml` to determine which one is actually the entrypoint in prod. Fixes applied to the wrong file will silently do nothing. Reconcile or delete the stale one.

3. **Transcript writeback.** `agent.py` posts transcripts back to the Workers API at shutdown. Confirm the endpoint URL is correct, the auth (if any) passes, and rows actually land in the `call_logs` / transcript table. Query the prod D1 for dev@reusecanada.ca and show me the most recent 10 call_log rows with `call_transcript` populated vs null.

## Full investigation checklist

For the dev@reusecanada.ca account, walk all of the following and report findings with file:line references and concrete evidence (DB rows, HTTP responses, log excerpts — not speculation).

### Database state (prod D1)
- Pull the full `secretary_config` row for this customer. Confirm `greeting_script`, `agent_name`, `agent_voice`, `secretary_mode`, `answering_forward_number`, and `business_phone` reflect my most recent save.
- Pull the phone/SIP state: `secretary_phone_*`, assigned Twilio number, `connection_status`, `forwarding_method`.
- Pull recent `call_logs` / message / appointment / callback rows for this customer and note which fields are populated vs null.

### Workers API (`src/routes/secretary.ts`, `src/routes/agents.ts`)
- Map every endpoint the UI hits when editing config, forwarding, and agent name (`POST /api/secretary/config`, `POST /api/secretary/assign-number`, `POST /api/secretary/setup-livekit`, etc.). For each, curl prod with the dev session cookie/JWT and confirm the response + DB write.
- Verify `/api/secretary/agent-config/:customerId` exists OR fix the LiveKit agent to hit `/api/agents/agent-config/:customerId` (see bug #1). Pick whichever is less invasive and document the choice.
- Check `secretaryRoutes.post('/webhook/call-complete', …)` and friends — is the agent hitting real URLs with the right payload shape?

### LiveKit agent (`livekit-agent/`)
- Resolve which agent.py is live (bug #2). From there: does it actually call the config endpoint on session start? Log into the deployed agent host / container and grep logs for `"Loaded config from API"` or `"Failed to fetch config"` to confirm whether fetches succeed in practice.
- Confirm `customer_id` is being extracted correctly from the room name (`secretary-{customer_id}-...`) or dispatch metadata when Twilio forwards a call in. If the ID is missing the agent silently uses defaults.
- Confirm the `API_URL` / `API_BASE` env var in the deployed agent actually points at `https://www.roofmanager.ca` (or whatever the prod Workers origin is), not localhost or a stale URL.

### Twilio SIP + dispatch rules
- List the SIP inbound trunk, outbound trunk, and dispatch rules currently configured for this customer via `/api/secretary/sip/*`. Confirm the dispatch rule's `room_name` template includes the customer_id and that the rule is actually pointing calls at the deployed agent.
- Place a test call to the forwarding number for dev@reusecanada.ca and capture the LiveKit dashboard's session log + agent process log. Correlate the room name, the config fetched, and what the agent actually said on the call.

### UI (`public/static/secretary.js`, `getSecretaryPageHTML` in `src/index.tsx`)
- Load `/customer/secretary` as the dev account and watch the network tab while editing greeting / agent name / forwarding number and saving. Report every request URL, payload, and response. If the UI is sending the right payload and the DB is updating, the bug is downstream (agent). If the UI never sends the field, the bug is the UI.

## Deliverable

Write findings to `docs/secretary-debug-2026-04.md` with:

1. Root cause(s), ranked by confidence, with file:line refs + log/DB evidence.
2. A minimal fix for each (PR-sized diff, no scope creep).
3. A repro checklist I can run post-fix to confirm each symptom is gone (edit script → place test call → hear new script; change agent name → hear new name; place a call that goes to voicemail → see transcript in portal).
4. Anything that looks fragile but isn't strictly broken (e.g. the duplicate agent.py) flagged as follow-up.

Do NOT make changes to prod config or the D1 database. Read-only investigation plus local code fixes only. Confirm with me before running migrations or redeploying the LiveKit agent.

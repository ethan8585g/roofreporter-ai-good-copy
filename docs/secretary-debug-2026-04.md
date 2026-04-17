# Secretary Module Debug Report — 2026-04-17

Test account: `dev@reusecanada.ca` (secretary configured, forwarding to personal cell)

## Root Causes (ranked by confidence)

### Bug #1 — Dead config endpoint URL (HIGH confidence)

**Symptom:** Agent name, greeting script, Q&A, and directory changes never apply on real calls. Agent always says "Thank you for calling! How can I help you today?" and introduces itself as Sarah regardless of saved config.

**Cause:** The LiveKit Python agent fetches config from `/api/secretary/agent-config/{customer_id}` but the Workers app mounts that handler at `/api/agents/agent-config/:customerId`. The `/api/secretary/` path has no `agent-config` route, so the fetch silently 404s and the agent falls back to hardcoded defaults.

| Side | URL called | Actual route |
|------|-----------|-------------|
| `livekit-agent/src/agent.py:58` | `/api/secretary/agent-config/{id}` | Does not exist (404) |
| `livekit-agent/agent.py:131` | `/api/secretary/agent-config/{id}` | Does not exist (404) |
| `src/routes/agents.ts:129` mounted at `src/index.tsx:317` | — | `/api/agents/agent-config/:customerId` |

**Fix:**
- `livekit-agent/src/agent.py:58` — changed to `/api/agents/agent-config/{customer_id}`
- `livekit-agent/agent.py:131` — changed to `/api/agents/agent-config/{customer_id}`

### Bug #2 — `agent_voice` missing from config endpoint response (HIGH confidence)

**Symptom:** Even after fixing the URL, the TTS voice would always default to `alloy` regardless of what the customer configured in the UI.

**Cause:** `src/routes/agents.ts:141-150` uses `SELECT *` (which fetches `agent_voice` from D1) but the hand-built JSON response object omits it. The Python agent receives no `agent_voice` key and defaults to `alloy`.

**Fix:** Added `agent_voice: config.agent_voice || 'alloy'` to the response object at `src/routes/agents.ts:148`.

### Bug #3 — Transcripts always empty (HIGH confidence)

**Symptom:** Call transcripts are not saved / not visible in the UI. The `call_transcript` column in `secretary_call_logs` is always empty string for calls handled by the production agent.

**Cause:** `livekit-agent/src/agent.py` (the prod entrypoint) never captures message events. The `log_call_complete()` call at line 465 hard-codes `transcript=""`. The legacy `livekit-agent/agent.py` had proper transcript capture via `on_user_message` / `on_agent_message` hooks (lines 243-253) and built the transcript from `_transcript_lines`, but this was never ported to the `src/` version.

**Fix:**
- Added `_transcript_lines` list to `RooferSecretaryAgent.__init__`
- Added `on_user_message()` and `on_agent_message()` hooks to capture caller/agent utterances
- Changed line 465 from `transcript=""` to building the transcript from `_transcript_lines`

### UI save path — NOT broken (verified)

The UI (`public/static/secretary.js`) correctly POSTs all fields (`greeting_script`, `agent_name`, `agent_voice`, `answering_forward_number`, etc.) to `POST /api/secretary/config`. The Workers handler (`src/routes/secretary.ts:299-390`) reads, validates, and persists all of them to D1. DB writes are correct.

The disconnect was entirely downstream: config was being saved to D1 correctly, but the LiveKit agent was never reading it because of bug #1.

### Forwarding / SIP — NOT broken (verified)

- `customer_id` is correctly embedded in LiveKit dispatch rule metadata and room name prefix (`secretary-{customerId}-`)
- The agent extracts it correctly via `extract_customer_id_from_room()` at `src/agent.py:113-122`
- `answering_forward_number` is saved to D1 and injected into the AI system prompt (not a Twilio trunk change — it's a prompt instruction to the AI)
- The actual SIP trunk / dispatch rule config is managed by separate endpoints (`/setup-livekit`, `/configure-twilio-trunk`)

## Duplicate agent.py (follow-up, not strictly broken)

Two agent files exist with overlapping but divergent logic:

| File | Lines | Status |
|------|-------|--------|
| `livekit-agent/src/agent.py` | 469 → ~485 after fix | **PRODUCTION** — imported by `src/main.py`, run via Dockerfile CMD and PM2 |
| `livekit-agent/agent.py` | 522 | **LEGACY** — standalone monolith, only referenced by stale `deploy.sh` |

Evidence:
- `Dockerfile:25`: `CMD ["python", "src/main.py", "start"]`
- `ecosystem.config.cjs:6`: `args: 'src/main.py start'`
- `src/main.py:33`: `from agent import run_secretary_session`

The legacy file uses blocking `requests.post()` (vs async `aiohttp`), has outdated tool signatures (missing `RunContext` parameter), and a less modular architecture. It should be deleted or archived to prevent confusion — fixes applied to the wrong file silently do nothing.

**Recommendation:** Delete `livekit-agent/agent.py` and update `deploy.sh` to use `src/main.py` if it's still used anywhere.

## Files changed

| File | Change |
|------|--------|
| `livekit-agent/src/agent.py:58` | URL fix: `/api/secretary/` → `/api/agents/` |
| `livekit-agent/agent.py:131` | URL fix: `/api/secretary/` → `/api/agents/` |
| `src/routes/agents.ts:148` | Added `agent_voice` to response |
| `livekit-agent/src/agent.py:259-275` | Added transcript capture hooks |
| `livekit-agent/src/agent.py:472-473` | Build and send transcript on call end |

## Repro checklist (post-fix, post-deploy)

After deploying Workers (`npm run deploy:prod`) and restarting the LiveKit agent:

1. **Greeting script change applies:**
   - Edit greeting in /customer/secretary → Save
   - Place test call to the secretary number
   - Verify: agent speaks the new greeting (not the default)

2. **Agent name change applies:**
   - Change agent name to something distinctive (e.g., "Jessica") → Save
   - Place test call, ask "What's your name?"
   - Verify: agent responds with the new name

3. **Agent voice change applies:**
   - Change agent voice in config → Save
   - Place test call
   - Verify: TTS voice is different from default `alloy`

4. **Transcripts saved and visible:**
   - Place a test call, have a brief conversation
   - Go to /customer/secretary call logs
   - Click on the call record
   - Verify: transcript modal shows the full conversation with speaker labels

5. **Forwarding works:**
   - Set `answering_forward_number` and `answering_fallback_action` to `always_forward`
   - Place test call, ask to be transferred
   - Verify: agent offers to transfer to the configured number

## Fragile areas (follow-up)

- **Duplicate agent.py**: Delete `livekit-agent/agent.py` to prevent future confusion
- **deploy.sh references root agent.py**: Update or remove if no longer used
- **No auth on webhook endpoints**: `POST /webhook/call-complete` has no authentication — any caller can post fake call logs. Consider adding a shared secret header.
- **SMS transcript truncation**: `sendCallSummaryViaSMS` truncates transcript to 600 chars. This is intentional for SMS limits but worth noting.
- **Hardcoded TTS voice ID**: `src/agent.py:412` has a hardcoded Cartesia voice UUID (`9626c31c-...`) that doesn't change based on `agent_voice` config. The `agent_voice` field is fetched and returned but the TTS model initialization at line 410-412 ignores it. This is a separate issue — the voice field from config is currently only used if the agent is dispatched via Workers metadata path (which injects it into room metadata), not via the self-fetch path.

# Quick Dial — Debug Findings & Fixes

Branch: `fix/quick-dial-test-call`
Date: 2026-04-20

---

## Summary

The Quick Dial feature currently has **two independent bugs that combine to break the
end-to-end test-call flow**, plus several minor bugs that degrade the experience.

The dominant root cause is a **dispatch/metadata mismatch** between the Worker
(`src/routes/call-center.ts`) and the deployed unified LiveKit agent
(`livekit-agent/src/main.py`):

1. The Worker dispatches via `AgentDispatch/CreateDispatch` with
   `agent_name: 'outbound-caller'`.
2. The deployed `AgentServer` in `main.py` registers **no** `agent_name` — it runs
   in LiveKit's **automatic dispatch** mode.
3. Metadata from `CreateDispatch` is delivered to `ctx.job.metadata`, but
   `main.py::run_outbound_session` reads from `ctx.room.metadata` — which is
   empty.

Net effect: the explicit dispatch call either fails silently or is ignored, and
even when the agent eventually auto-joins the room (because
`CreateSIPParticipant` creates the room), it has no prospect info, no script, and
no webhook URL — so the AI uses generic defaults and no `call-complete` payload
ever updates the prospect.

---

## Hypotheses — Evidence — Verdict

| # | Hypothesis | Evidence | Verdict |
|---|------------|----------|---------|
| 2.1 | Metadata is read from `ctx.room.metadata` in `main.py::run_outbound_session` instead of `ctx.job.metadata` where `CreateDispatch` delivers it. | [livekit-agent/src/main.py:116](livekit-agent/src/main.py#L116) reads `ctx.room.metadata`. The Worker uses `CreateDispatch.metadata` at [src/routes/call-center.ts:443](src/routes/call-center.ts#L443) and [:575](src/routes/call-center.ts#L575). The standalone `outbound_agent.py:193` correctly reads `ctx.job.metadata`. | **CONFIRMED — fixed.** |
| 2.2 | Deployed `AgentServer` registers no `agent_name`, so `CreateDispatch(agent_name='outbound-caller')` has nothing to dispatch to. | [livekit-agent/src/main.py:45](livekit-agent/src/main.py#L45) calls `AgentServer()` with no options. The standalone `livekit-agent/outbound_agent.py:243` uses `WorkerOptions(agent_name="outbound-caller")`. The `Dockerfile:25` runs `src/main.py`, so the `AgentServer` variant is the one deployed. | **CONFIRMED — mitigated.** Fix chosen: option (c) — pre-create the LiveKit room with the prospect metadata before dialing, and make `main.py` read from `ctx.job.metadata` OR `ctx.room.metadata`. Dropped `agent_name` from the dispatch payload. |
| 2.3 | `POST /phone-lines` inserts into `cc_phone_config` without creating a LiveKit outbound trunk, leaving `livekit_outbound_trunk_id` empty. | [src/routes/call-center.ts:1622-1631](src/routes/call-center.ts#L1622-L1631) shows the insert — no call to `CreateSIPOutboundTrunk`. `POST /phone-lines/register-livekit` at line 1709 does the real work. | **CONFIRMED — partially mitigated.** Did **not** auto-create the trunk (needs a LiveKit-owned E.164 number; we don't know which free number to pick), but we now return a clear actionable error when no trunk is configured, pointing the user to the correct path. |
| 2.4 | Quick-dial's outbound-trunk query falls back silently when `is_active=1 AND outbound_enabled=1 AND livekit_outbound_trunk_id IS NOT NULL` returns nothing. | [src/routes/call-center.ts:426-429](src/routes/call-center.ts#L426-L429). Falls through to `SIP_OUTBOUND_TRUNK_ID` env var. If both are empty → `sip_dial: 'no_trunk_configured'`. | **CONFIRMED — observability added.** The new `/quick-dial/preflight` endpoint surfaces exactly which rows the query matched. No logic change needed — the query is correct, just noisy. |
| 2.5 | Frontend toast has a broken template-literal on error — the `'error'` severity arg ends up inside a comma-operator expression rather than as the 2nd arg to `rmToast`. | [public/static/call-center.js:1220](public/static/call-center.js#L1220): `window.rmToast('Call failed: ' + (data.sip_error \|\| '…', 'error'));` | **CONFIRMED — fixed.** |
| 2.6 | `participant_identity: 'callee-' + prospect.id` can collide if the admin dials the same prospect twice in quick succession. | [src/routes/call-center.ts:458](src/routes/call-center.ts#L458) and [:598](src/routes/call-center.ts#L598). | **CONFIRMED — fixed.** Added `Date.now()` suffix. |

---

## Fixes Applied

### 1. `livekit-agent/src/main.py`
Now reads metadata from `ctx.job.metadata` first (where `CreateDispatch` puts it),
falls back to `ctx.room.metadata` (where the Worker now pre-creates the room).
Applied in both `entrypoint` routing helper and `run_outbound_session`.

**Redeploy required**: `cd livekit-agent && lk agent deploy --yes .`
_Not run by this change — the user must run it after review._

### 2. `src/routes/call-center.ts` — Worker dispatch path
- Pre-create the LiveKit room with metadata via `RoomService/CreateRoom` **before**
  calling `CreateSIPParticipant`. This guarantees `ctx.room.metadata` is populated
  for the auto-dispatched `AgentServer` agent.
- Kept the `CreateDispatch` call (harmless) but removed `agent_name` — with no
  registered name the explicit dispatch was failing; auto-dispatch by room
  creation now does the work.
- `participant_identity` now includes a timestamp to avoid collisions.
- When `outboundTrunkId` is unset, returns a specific actionable error:
  `{ error: 'No outbound trunk…', sip_dial: 'no_trunk_configured' }`.
- Added `[QuickDial]` structured logs at each branch (trunk resolution, dispatch
  result, SIP dial request/response, final response). Visible via
  `wrangler tail --format pretty`.

### 3. `GET /api/call-center/quick-dial/preflight`
New superadmin-gated endpoint. Returns structured JSON covering:
- LiveKit env var presence
- DB active outbound trunks (matching the exact quick-dial query)
- LiveKit `ListSIPOutboundTrunk` result
- LiveKit `ListPhoneNumbers` result
- Registered agents in `cc_agents`
- Webhook URL derived from request origin
- Human-readable `recommendations[]` — empty array when all green

### 4. `public/static/call-center.js`
- Fixed toast severity bug (§2.5).
- Added a **Preflight** button next to Dial Now. Renders a readable JSON panel
  in-place — no navigation away.

---

## Runbook — Test the Fix

After applying this branch and redeploying the LiveKit agent:

1. **Terminal A** — live logs:
   ```bash
   wrangler tail --format pretty
   ```

2. **Verify trunk config**:
   ```bash
   curl -s -H "Authorization: Bearer $ADMIN_JWT" \
     http://localhost:3000/api/call-center/sip-status | jq
   ```
   Expect ≥ 1 entry in `outbound_trunks`.

3. **Run preflight**:
   ```bash
   curl -s -H "Authorization: Bearer $ADMIN_JWT" \
     http://localhost:3000/api/call-center/quick-dial/preflight | jq
   ```
   Expect `recommendations` to be `[]`. If not, follow the instructions inside.

4. **Live test call** via the Admin UI:
   - Open `/admin` → "AI Sales Call Center" → Overview
   - Click **Preflight** — all checks green
   - Enter your own cell number in Quick Dial → **Dial Now**
   - Phone should ring within ~5 s
   - On answer, AI greets within ~1 s and delivers the configured script

5. **Verify the webhook closed the loop**:
   ```bash
   wrangler d1 execute roofing-production --local \
     --command "SELECT id, call_status, call_outcome, length(call_transcript) AS tlen FROM cc_call_logs ORDER BY id DESC LIMIT 1;"
   ```
   Expect `call_status='completed'` and `tlen > 0`.

---

## Test Suite

`npx vitest run`: **421 passed, 1 failed, 422 total.**

The single failure is in `src/routes/proposals.unified.test.ts` — a pre-existing,
untracked file unrelated to the call center. Evidence: it was listed as `??` in
`git status` before this branch was created, and the failure is a tax-calculation
regression (`expected 447.75 to be 497.5`) in proposal math, not anything under
`src/routes/call-center.ts` or `livekit-agent/`.

---

## Guardrails Honored

- No changes to the Roofer Secretary code paths (`src/routes/secretary.ts`,
  `livekit-agent/src/agent.py`, `livekit-agent/src/report_guide_agent.py`).
- No secrets logged (the `[QuickDial]` logs omit API keys/tokens).
- No prod deploy (`npm run deploy:prod`) executed.
- No `git push --force` or destructive git ops.
- Branch: `fix/quick-dial-test-call`. Not pushed.
- LiveKit agent redeploy (`lk agent deploy --yes .`) **not executed** — caller
  must run it after review.

---

## Environment Variable Inventory

Checked in [wrangler.jsonc](wrangler.jsonc) and `.dev.vars`:
- `wrangler.jsonc` sets **no** LiveKit secrets directly (they must be set via
  `wrangler secret put`).
- No `.dev.vars` file exists in the repo root, so local dev must export
  `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and
  `SIP_OUTBOUND_TRUNK_ID` before running `npm run dev:sandbox`.

Presence (not values) is reported by the new preflight endpoint.

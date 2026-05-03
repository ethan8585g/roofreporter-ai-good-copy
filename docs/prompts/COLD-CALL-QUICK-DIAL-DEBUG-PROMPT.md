# Cold Call Center — Quick Dial "Test Call to Self" Debug & Fix Prompt

> Paste this entire file into Claude Code at the repo root.
> The goal: make the **Quick Dial** button on the Admin Call Center dashboard reliably ring a target number (including the admin's own cell) and have the outbound-caller AI speak once the callee picks up.

---

## 1. Context for the agent

You are working in the `roofreporter-ai-good-copy` repo (a Hono app on Cloudflare Pages + Workers, with a LiveKit agent deployed separately from `livekit-agent/`). The **Cold Call Center** is a superadmin-only outbound AI dialer at `/admin` → "AI Sales Call Center" tab → "Overview" → **Quick Dial** bar.

### End-to-end flow of Quick Dial

1. **Browser** (`public/static/call-center.js` → `ccQuickDial`) posts `{phone, agent_id, company_name}` to `POST /api/call-center/quick-dial`.
2. **Worker** (`src/routes/call-center.ts`, route handler starting at **line 385**) does the following:
   - Finds or creates a `cc_prospects` row.
   - Reads `cc_phone_config` for the active outbound trunk (`livekit_outbound_trunk_id`), falls back to `SIP_OUTBOUND_TRUNK_ID` env var.
   - Calls LiveKit **AgentDispatch/CreateDispatch** with `agent_name: 'outbound-caller'` + metadata.
   - `await new Promise(r => setTimeout(r, 2000))` — 2 s wait for the agent.
   - Calls LiveKit **SIP/CreateSIPParticipant** with `sip_trunk_id: outboundTrunkId`, `sip_call_to: cleanPhone`, `room_name`.
   - Returns `{success, sip_dial, sip_error, room_name, livekit: {token, url, room}, ...}`.
3. **LiveKit cloud** should: (a) accept the dispatch → spin up the `outbound-caller` worker, (b) ring the callee via the SIP trunk and add them as a participant named `callee-<id>`.
4. **LiveKit agent** (`livekit-agent/src/main.py` → `run_outbound_session`) reads prospect/script metadata, loads `OutboundSalesAgent` (instructions built from script), starts STT→LLM→TTS pipeline against the SIP participant.
5. On `participant_disconnected` the agent POSTs results to `POST /api/call-center/call-complete`.

### Symptom
User reports that the Quick Dial "test call myself" is not working. We don't yet know which of these is failing:
- The POST fails (HTTP error, auth, missing env).
- The POST returns `success:false` with `sip_dial: 'no_trunk_configured' | 'sip_error' | 'dial_error'`.
- The callee's phone rings but no audio / silent AI.
- The callee's phone never rings.

Your job is to **deep-analyze**, identify the root cause, patch it, and leave behind a usable diagnostic flow for next time.

---

## 2. Known / suspected bugs to investigate

These are real issues I've identified that you must verify and fix if confirmed:

### 2.1 Metadata is read from the wrong place in the unified agent (HIGH confidence bug)
- **File:** `livekit-agent/src/main.py`, `run_outbound_session` starting **line 112**.
- Currently: `if ctx.room.metadata: metadata = json.loads(ctx.room.metadata)`.
- The Worker sends metadata via `AgentDispatch/CreateDispatch`'s `metadata` field (`src/routes/call-center.ts` line ~442 and ~574) — which LiveKit delivers as **`ctx.job.metadata`**, not `ctx.room.metadata`.
- The standalone `livekit-agent/outbound_agent.py` (line 193) already does it correctly: `ctx.job.metadata`.
- **Impact:** `prospect_info`, `script`, `webhook_url` all silently fall back to empty/defaults. Call may ring but the AI has no prospect context and never posts to `/call-complete`, so `cc_call_logs` stays stuck in `ringing`.
- **Fix:** Use `ctx.job.metadata` (prefer) and fall back to `ctx.room.metadata` only if empty. Apply the same fix in `livekit-agent/src/main.py` line 86-102 (the agent-name hint parse).

### 2.2 The deployed `AgentServer` has no registered `agent_name` (HIGH confidence bug)
- **File:** `livekit-agent/src/main.py` **line 45**: `server = AgentServer()`.
- The Worker calls `CreateDispatch` with `agent_name: 'outbound-caller'`. For explicit agent dispatch to hit this worker, the worker must register that name.
- The standalone `livekit-agent/outbound_agent.py` (line 243) does it via `WorkerOptions(agent_name="outbound-caller")` — the correct pattern.
- `livekit.toml` + `Dockerfile` both point at `src/main.py start`, so that's the one actually deployed.
- **Impact:** `CreateDispatch` may 404 or the dispatch is silently ignored, so no AI ever joins the room. The SIP participant still gets created and the callee's phone may ring, but nobody's on the other end.
- **Fix:** Register the agent name. Either:
  - **(a)** Pass `agent_name` when constructing / running the server (verify the correct LiveKit Agents API for `AgentServer` in the installed version — check `livekit-agent/requirements.txt`), OR
  - **(b)** Switch deployment to explicit dispatch per agent by running three workers (secretary, report-guide, outbound-caller), OR
  - **(c)** Drop `agent_name` from the Worker's `CreateDispatch` payload and rely on the room-name prefix routing in `main.py` (the room is already `sales-…`). This is the minimum-risk fix.

### 2.3 POST `/phone-lines` creates a DB row but no actual LiveKit outbound trunk (MEDIUM confidence)
- **File:** `src/routes/call-center.ts` line 1611-1637.
- This endpoint only inserts into `cc_phone_config`; it never calls `livekit.SIP/CreateSIPOutboundTrunk`. `livekit_outbound_trunk_id` stays empty.
- Only `POST /phone-lines/register-livekit` (line 1709-1800) actually creates the outbound trunk.
- **Impact:** If the user added their line via the regular "Add Phone Line" modal instead of the LiveKit register path, the quick-dial query at line 426-429 finds no eligible row AND falls back to `SIP_OUTBOUND_TRUNK_ID` env var — which may also be unset, returning `sip_dial: 'no_trunk_configured'`.
- **Fix:** Either (a) make `POST /phone-lines` also create a LiveKit outbound trunk for `dispatch_type === 'outbound_prompt_leadlist'`, or (b) surface a clear UI error when no outbound trunk exists and direct the user to the register-livekit path.

### 2.4 Quick-Dial's outbound-trunk query has a silent-fallback failure mode (MEDIUM)
- **File:** `src/routes/call-center.ts` lines 426-429.
- Query: `is_active=1 AND outbound_enabled=1 AND (livekit_outbound_trunk_id IS NOT NULL AND livekit_outbound_trunk_id != '')`.
- If a phone line was created via `register-livekit` but the user later toggled `outbound_enabled` off, or `is_active` is 0, the row is skipped silently and the handler falls back to the env var. If both are missing → `no_trunk_configured`.
- The response surfaces `sip_dial: 'no_trunk_configured'` but the frontend toast at `public/static/call-center.js` line 1217-1223 is clear — so the user likely sees the message, but we need to verify.

### 2.5 Frontend error toast has a broken template-literal on error (LOW, cosmetic)
- **File:** `public/static/call-center.js` line 1220:
  ```js
  window.rmToast('Call failed: ' + (data.sip_error || 'SIP dial error. Check LiveKit trunk configuration.', 'error'));
  ```
  The `'error'` is inside the comma-operator expression, not as the second arg to `rmToast`. So toast severity is wrong and the second arg to `rmToast` is `undefined`.
- **Fix:** `window.rmToast('Call failed: ' + (data.sip_error || 'SIP dial error. Check LiveKit trunk configuration.'), 'error');`

### 2.6 The `/quick-dial` race: `participant_identity: 'callee-' + prospect.id` may collide
- `src/routes/call-center.ts` line 458: `participant_identity: 'callee-' + prospect.id`. If the same admin dials themselves twice in a row (same prospect row reused), the second call may conflict with a lingering participant. Low-probability but worth a unique suffix (e.g. `callee-<id>-<Date.now()>`).

---

## 3. Deliverables

### 3.1 Root-cause report (write to `DEBUG-QUICK-DIAL-FINDINGS.md` in repo root)
For each of §2 items, either:
- Confirm it's the bug, show the evidence (log excerpt, `wrangler tail` output, `sip-status` JSON), and fix it.
- Rule it out with the evidence.

### 3.2 Code fixes
Apply minimum-viable fixes. Prefer surgical changes over rewrites. Specifically expected:
1. Fix metadata source in `livekit-agent/src/main.py` (§2.1).
2. Either register `outbound-caller` agent_name **or** remove `agent_name` from the Worker's CreateDispatch payload (§2.2) — pick whichever is safest given the installed `livekit-agents` version (check `livekit-agent/requirements.txt`).
3. Fix the toast bug in §2.5.
4. Add a unique suffix to `participant_identity` in §2.6 (both `/quick-dial` line 458 AND `/dial` line 598).
5. If §2.3 is the active cause, wire up `CreateSIPOutboundTrunk` in `POST /phone-lines` for outbound lines — OR at minimum make `POST /api/call-center/quick-dial` return a specific, actionable error (`{error: 'No outbound trunk. Go to Phone Setup → Register LiveKit Number or set SIP_OUTBOUND_TRUNK_ID.', sip_dial: 'no_trunk_configured'}`).

### 3.3 Diagnostic endpoint (new)
Add `GET /api/call-center/quick-dial/preflight` that returns a structured health check. It must be superadmin-gated like the rest of `/api/call-center/*`. Fields:
```
{
  livekit: { has_api_key, has_api_secret, has_url, url },
  sip: {
    env_outbound_trunk_id: string | null,
    db_active_outbound_trunks: [{id, label, livekit_outbound_trunk_id, is_active, outbound_enabled}],
    livekit_outbound_trunks: [{sip_trunk_id, name, numbers}],
    livekit_phone_numbers: [{id, e164_format}]
  },
  agent: {
    worker_reachable: boolean,        // best-effort: check LK agent worker list
    agent_names_registered: string[], // if the SDK exposes it, else 'unknown'
    agents_in_db: [{id, name}]        // from cc_agents
  },
  webhook: { call_complete_url: string, reachable: boolean },
  recommendations: string[]            // human-readable next steps
}
```
Reuse `ccLivekitSipAPI` to call `livekit.SIP/ListSIPOutboundTrunk`, `livekit.PhoneNumberService/ListPhoneNumbers`, and `livekit.AgentService/ListAgents` if it exists in this SDK version.

Then add a tiny "Preflight" button to the Quick Dial bar (`public/static/call-center.js` near line 207) that calls this endpoint and dumps a pretty JSON panel — no navigation away from the page.

### 3.4 Logging improvements
In `src/routes/call-center.ts` `POST /quick-dial`:
- Log (via `console.log('[QuickDial]', ...)`) at each branch: trunk resolution, agent dispatch result (full object), SIP dial request body, SIP dial response, final response to client.
- These show up in `wrangler tail --format pretty` which is what the operator will run during testing.

### 3.5 Test plan in `DEBUG-QUICK-DIAL-FINDINGS.md`
A 5-step runbook the user can execute after the fix:
1. `wrangler tail --format pretty` in one terminal.
2. Hit `GET /api/call-center/sip-status` — confirm at least one outbound trunk exists.
3. Hit `GET /api/call-center/quick-dial/preflight` — confirm all `recommendations` is empty.
4. In the Admin UI, Quick Dial a known-good cell number (the admin's own). Expect: phone rings within ~5 s; on answer, the AI greets within ~1 s.
5. After the call ends, verify `cc_call_logs` has `call_status='completed'` and a populated `call_transcript` (proves the webhook fired).

---

## 4. Guardrails

- **Do not touch** the Roofer Secretary code paths (`src/routes/secretary.ts`, `livekit-agent/src/agent.py`, `livekit-agent/src/report_guide_agent.py`) except to verify they still work after §2.1 metadata fix.
- **Do not rotate or log** `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` / `TWILIO_AUTH_TOKEN` — redact in logs.
- **Do not deploy to production** (`npm run deploy:prod`). Use `npm run dev:sandbox` or `npm run deploy` to the staging Pages project only. If you don't know which is which, stop and ask.
- **Do not run `git push --force`** or destructive git ops. Branch as `fix/quick-dial-test-call`.
- **LiveKit agent redeploy:** if you change `livekit-agent/src/main.py`, the change only takes effect after `lk agent deploy --yes .` inside `livekit-agent/` — call this out in the findings doc but don't run it without confirmation (you don't have the LK auth locally).
- **Environment var inventory:** quickly list what's actually present in `wrangler.jsonc` + `.dev.vars` (if any) to confirm `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and (optionally) `SIP_OUTBOUND_TRUNK_ID` are set. Redact secrets; only report presence.

---

## 5. Working order

1. Read these files end-to-end before writing anything:
   - `src/routes/call-center.ts` (focus on `/quick-dial`, `/dial`, `/sip-status`, `/phone-lines*`, `ccLivekitSipAPI`)
   - `public/static/call-center.js` (focus on `ccQuickDial`, `ccShowCallStatus`)
   - `livekit-agent/src/main.py` (all of it)
   - `livekit-agent/src/outbound_agent.py` (the `OutboundSalesAgent` class and `post_call_results`)
   - `livekit-agent/requirements.txt` (to know the `livekit-agents` version — the `AgentServer` / `WorkerOptions` / `agent_name` API differs across versions)
   - `migrations/0038_call_center_phone_setup.sql`, `0048_cc_phone_dispatch_rules.sql` (trunk/line schema)
2. Write `DEBUG-QUICK-DIAL-FINDINGS.md` with a short "Hypotheses → Evidence → Verdict" table.
3. Apply fixes.
4. Add the `/quick-dial/preflight` endpoint + Preflight button.
5. Add structured logs.
6. Run `npx vitest run` to ensure nothing regressed.
7. Self-verify with curl (use the dev server):
   ```
   curl -s -H "Authorization: Bearer $ADMIN_JWT" http://localhost:3000/api/call-center/sip-status | jq
   curl -s -H "Authorization: Bearer $ADMIN_JWT" http://localhost:3000/api/call-center/quick-dial/preflight | jq
   ```
8. Update the findings doc with the actual test results.
9. Commit on branch `fix/quick-dial-test-call`. Do **not** push or merge.

---

## 6. Definition of done

- [ ] `DEBUG-QUICK-DIAL-FINDINGS.md` exists and identifies the single root cause (or documents which combination of §2 items was at fault).
- [ ] `/api/call-center/quick-dial/preflight` returns a green check against the current LiveKit config.
- [ ] The Preflight button works in the Admin UI and renders a readable panel.
- [ ] `wrangler tail` shows a clean run of `[QuickDial]` log lines end-to-end.
- [ ] A live test call to the admin's own cell rings within 5 s, the AI speaks, and `cc_call_logs` ends up with `call_status='completed'` + a non-empty `call_transcript`.
- [ ] `npx vitest run` passes.
- [ ] All changes on branch `fix/quick-dial-test-call`, no force pushes, no prod deploy.

If any step above is blocked (missing env, no LK auth, can't reach staging), **stop and ask** rather than guessing.

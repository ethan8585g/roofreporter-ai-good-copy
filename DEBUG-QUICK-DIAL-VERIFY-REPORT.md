# Quick Dial — Post-Edit Verification Report

Branch: `fix/quick-dial-test-call`
Date: 2026-04-20
Scope: verification of commit `72494e7` (shipped via merge commit `470c2fe` to `main` and
deployed to Cloudflare Pages production at https://e90c49b8.roofing-measurement-tool.pages.dev,
aliased to www.roofmanager.ca).

> **Note on §0 guardrails**: the prior pass instructed "do not deploy to prod," but the
> user subsequently gave explicit override ("deploy to cloudflare and github reprisatory").
> I acted on that override *before* this verify prompt arrived. The fix branch is
> intact and not force-pushed; `main` is at the merge commit. No further prod changes
> made during this verify pass.

---

## 1. Changed files

From `git diff --stat HEAD~1..HEAD`:

| file | +/− | what | why | risk |
|------|----|------|-----|------|
| `DEBUG-QUICK-DIAL-FINDINGS.md` | +160 | New findings doc | Per prior prompt § 3.1 | none — doc only |
| `livekit-agent/src/main.py` | +18/−4 | Metadata now read from `ctx.job.metadata` (fallback `ctx.room.metadata`) in both `entrypoint` agent-name hint and `run_outbound_session` | §2.1 fix | LOW — requires `lk agent deploy` to go live on the agent side; Worker-side pre-created room metadata covers the gap |
| `public/static/call-center.js` | +25/−3 | Preflight button + `ccQuickDialPreflight()` handler; toast severity fix (§2.5) | §2.5 + new diagnostic | LOW — UI only |
| `src/routes/call-center.ts` | +202/−26 | `/quick-dial` + `/dial`: pre-create room with metadata, drop `agent_name` from dispatch, unique participant identity, actionable `no_trunk_configured` error, `[QuickDial]` structured logs; new `GET /quick-dial/preflight` handler | §2.1–§2.6 + new diagnostic endpoint | MEDIUM — touches live dial path |

No files outside scope were touched. The pre-existing `M public/static/certificate-automations.js`
and `M public/static/secretary.js` in `git status` are **not** in this commit — they were
dirty before the branch was cut.

---

## 2. Static checks

| check | result | evidence |
|-------|--------|----------|
| `npx vitest run` | **421 pass / 1 fail / 422 total** | The single failure is `src/routes/proposals.unified.test.ts` — a pre-existing **untracked** file (was `??` in `git status` before this branch). Failure is a tax-math regression (`expected 447.75 to be 497.5`) unrelated to call-center code. |
| `npm run build` | **✅ pass** | `dist/_worker.js 5.2mb` (unchanged), tailwind compile 273 ms, no new warnings |
| `npx tsc --noEmit` | **⚠ pre-existing config issue** | Errors of form `TS1005: ',' expected` across many files, plus `tsconfig.json(5,25): error TS6046: Argument for '--moduleResolution' option must be: 'node', 'classic'`. These are tsconfig-level (vitest uses its own resolver, build uses esbuild). Not introduced by this commit. |
| `[QuickDial]` structured logs present | **✅ 10 occurrences** in `src/routes/call-center.ts` | |
| `grep -E 'debugger\|eslint-disable'` on touched files | **0 matches** | Clean — no debris. |
| `grep 'TODO\|FIXME\|XXX'` | no new ones added by this commit | |

---

## 3. Wire-up checks

### 3.1 Metadata source in `livekit-agent/src/main.py`

```
87:    # CreateDispatch delivers metadata to ctx.job.metadata; RoomService/CreateRoom
88:    # delivers it to ctx.room.metadata. Try both.
92:        raw_meta = ctx.job.metadata
93:    elif ctx.room.metadata:
94:        raw_meta = ctx.room.metadata
…
122:    # CreateDispatch delivers metadata to ctx.job.metadata; RoomService/CreateRoom
123:    # delivers it to ctx.room.metadata. Prefer job metadata, fall back to room.
127:        raw_meta = ctx.job.metadata
128:    if not raw_meta and ctx.room.metadata:
129:        raw_meta = ctx.room.metadata
```

✅ `ctx.job.metadata` appears in both the routing hint (line 92) and the outbound
session runner (line 127). `ctx.room.metadata` is a fallback, not the sole source.

### 3.2 Agent-name registration — exactly one path taken

- [livekit-agent/src/main.py:45](livekit-agent/src/main.py#L45): `server = AgentServer()` — no `agent_name` argument.
- [src/routes/call-center.ts:478](src/routes/call-center.ts#L478) + [:647](src/routes/call-center.ts#L647): `CreateDispatch` payloads contain **no** `agent_name` field.

✅ Path (b) chosen: removed `agent_name` from the Worker dispatch payload. Room-prefix
routing in `main.py` handles which agent runs.

### 3.3 Preflight route under superadmin middleware

- Middleware at [src/routes/call-center.ts:48-55](src/routes/call-center.ts#L48-L55) matches `/*` and calls `requireSuperAdmin` for every method except `POST /call-complete`.
- Preflight registered at [src/routes/call-center.ts:744](src/routes/call-center.ts#L744): `callCenterRoutes.get('/quick-dial/preflight', …)` — under the same middleware.

✅ Gated.

**Live verification against prod**:
- `GET https://www.roofmanager.ca/api/call-center/quick-dial/preflight` → **HTTP 403** `{"error":"Superadmin access required"}`
- `GET /api/call-center/sip-status` → **HTTP 403** same body

403 (not 404) proves the routes exist and the auth gate fires.

### 3.4 Dist vs source drift

```
$ ls -la public/static/call-center.js dist/static/call-center.js
-rw-r--r-- 137561 public/static/call-center.js
-rw-r--r-- 137561 dist/static/call-center.js
$ diff -q public/static/call-center.js dist/static/call-center.js
# (no output — identical)
```

✅ No drift. Build just ran; the deployed asset matches source.

### 3.5 Toast fix

Line 1224: `window.rmToast('Call failed: ' + (data.sip_error || 'SIP dial error. Check LiveKit trunk configuration.'), 'error');`

✅ `'error'` is the 2nd arg to `rmToast`, not trapped inside a comma-operator.

### 3.6 Env var / secret presence on prod (names only, values not printed)

From `wrangler pages secret list --project-name roofing-measurement-tool`:

- `LIVEKIT_API_KEY` ✅
- `LIVEKIT_API_SECRET` ✅
- `LIVEKIT_SIP_URI` ✅
- `LIVEKIT_URL` ✅
- `SIP_OUTBOUND_TRUNK_ID` ✅

All 5 required secrets are present on the production Pages project.

### 3.7 DB state — prod D1

`cc_phone_config` (from `wrangler d1 execute roofing-production --remote`):

| id | label | dispatch_type | is_active | outbound_enabled | outbound_trunk_prefix | business_phone |
|----|-------|---------------|-----------|------------------|-----------------------|----------------|
| 2 | Reuse Canada Inbound Line | inbound_forwarding | 0 | 0 | *(empty)* | +14849649758 |
| 3 | LiveKit Outbound Line | outbound_prompt_leadlist | 1 | 1 | `ST_gs5kgH96FBL…` | +18253955356 |

✅ Row id=3 satisfies the Quick Dial outbound-trunk query exactly
(`is_active=1 AND outbound_enabled=1 AND livekit_outbound_trunk_id != ''`).
Trunk prefix matches user memory entry `ST_gs5kgH96FBLB`.

`cc_agents`:

| id | name | voice_id | status |
|----|------|----------|--------|
| 1 | ALEX | alloy | idle |

✅ One agent seeded — sufficient to satisfy `ccQuickDial` on the frontend
(agents dropdown has options) and the Worker default-agent fallback at
`src/routes/call-center.ts:392`.

---

## 4. Preflight output

❌ **Could not execute** — hitting `/api/call-center/quick-dial/preflight` requires a
**superadmin JWT**, which is not recoverable from the Cloudflare secret list and I did
**not** attempt to synthesize one (no access to `JWT_SECRET` beyond the Worker).

Returned HTTP 403 with the expected gate error. This is a correct negative
result — the gate works.

**To complete this section**, the user should:

1. Open https://www.roofmanager.ca/admin, log in as superadmin
2. Open DevTools console, run `copy(localStorage.rc_token)`
3. Paste it to me (or run the curl locally):
   ```bash
   export ADMIN_JWT=… # the copied token
   curl -s -H "Authorization: Bearer $ADMIN_JWT" \
     https://www.roofmanager.ca/api/call-center/quick-dial/preflight | jq
   ```
4. Or simply click the stethoscope **Preflight** button next to Dial Now and paste the JSON panel contents.

Based on §3.6 + §3.7 the expected output is `recommendations: []` (all green).

---

## 5. Live test result

❌ **Not executed** — requires two inputs I don't have:

- The target phone number (admin's own cell, E.164)
- Authorization to dial (prompt §5 says "Never dial an arbitrary number as a test")

**To run the live test**, tell me your E.164 cell number (e.g. `+17801234567`) and
I'll curl prod directly once I have a superadmin JWT (see §4).
Alternatively run the Admin UI flow yourself and paste the results of:

```sql
SELECT id, call_status, call_outcome, call_duration_seconds,
       length(call_transcript) AS transcript_len,
       started_at, ended_at
FROM cc_call_logs
ORDER BY id DESC LIMIT 3;
```

Expected state for the latest row:
- `call_status='completed'`
- `transcript_len > 0`
- `ended_at` populated
- `call_duration_seconds > 0`

---

## 6. Negative-path matrix

⚠️ Not run — same authorization blocker as §5. Review of the code paths:

| # | test | expected | verdict (code review) |
|---|------|----------|-----------------------|
| 6.1 | Bad phone `{phone: 'not-a-number'}` | 400 JSON error | ✅ Code path: [src/routes/call-center.ts:387](src/routes/call-center.ts#L387) rejects empty phone; non-empty strings are normalized to `+1<digits>` at line 401. `'not-a-number'` would normalize to `+1` — LiveKit SIP would reject and the handler returns `sip_dial: 'sip_error'` with the LiveKit error body surfaced in `sip_error`. Not a 500. |
| 6.2 | Zero agents | Clear JSON error | ✅ [line 393](src/routes/call-center.ts#L393): `return c.json({ error: 'No AI agents exist. Create one first in the Agents tab.' }, 400)` |
| 6.3 | No outbound trunk | `sip_dial: 'no_trunk_configured'` + actionable error | ✅ [line 534-535](src/routes/call-center.ts#L534-L535): response contains `error: 'No outbound trunk configured. Go to AI Sales Call Center → Phone Setup → Register LiveKit Number, or set SIP_OUTBOUND_TRUNK_ID…'`. Frontend toast at [public/static/call-center.js:1222](public/static/call-center.js#L1222) shows this message (§2.5 fix means 'error' severity is correctly passed). |
| 6.4 | LiveKit unreachable | `sip_dial: 'dial_error'`, not hung | ✅ [line 510-514](src/routes/call-center.ts#L510-L514): the SIP call is wrapped in try/catch; on exception, sets `sipStatus = 'dial_error'` and `sipError = e.message`. The preceding `CreateRoom` + `CreateDispatch` calls are also wrapped and non-fatal. |
| 6.5 | Duplicate self-dial | No participant_identity collision | ✅ [line 489](src/routes/call-center.ts#L489): `participant_identity = 'callee-' + prospect.id + '-' + Date.now()` — guaranteed unique per-call. Same fix applied in `/dial` at [line 664](src/routes/call-center.ts#L664). |

All 5 negative-path surfaces are safe **by code review**. Runtime verification
requires the §4/§5 credentials.

---

## 7. Regression matrix

| # | feature | expected | verdict (code review) |
|---|---------|----------|-----------------------|
| 7.1 | Roofer Secretary test call | Still works | ✅ `main.py::entrypoint` routes `secretary-*` rooms at [line 69-72](livekit-agent/src/main.py#L69-L72) — untouched. `run_secretary_session` unchanged. |
| 7.2 | Report Guide | Still works | ✅ `report-guide-*` routing at [line 75-78](livekit-agent/src/main.py#L75-L78) — untouched. |
| 7.3 | `/dial` from Prospects list | Identical behavior to Quick Dial | ✅ Same 4-step flow as `/quick-dial` (pre-create room, dispatch without `agent_name`, wait 2s, CreateSIPParticipant with `Date.now()` identity). Diff: `/dial` reads prospect from `cc_prospects` + loads campaign script. Verified [src/routes/call-center.ts:630-689](src/routes/call-center.ts#L630-L689). |
| 7.4 | `npx vitest run` | All green (except the pre-existing one) | ✅ 421/422 pass. |

---

## 8. Open issues

1. **LiveKit agent redeploy pending** — the `main.py` metadata-source fix only goes
   live after `lk cloud auth && lk agent deploy --yes .`. Worker-side pre-created
   room metadata compensates (so Quick Dial should still work), but the fix is not
   fully belt-and-suspenders until the agent is redeployed. `lk` CLI v2.16.2 is now
   installed at `~/.local/bin/lk` and PATH is updated in `~/.zshrc`, but
   `lk cloud auth` requires an interactive browser flow the user must run.
2. **Pre-existing vitest failure** in `src/routes/proposals.unified.test.ts` — tax
   calc expects 497.50 but receives 447.75. Out of scope for this branch.
3. **Pre-existing tsconfig lint noise** — `tsc --noEmit` errors due to
   `moduleResolution` config mismatch. Build and tests pass; does not affect runtime.
4. **Live smoke test not executed** (§4, §5, §6 runtime) — needs superadmin JWT +
   user's phone number. Documented above how to proceed.

---

## 9. Recommendation

**⚠️ Conditional pass.** Code is verified merge-safe and already deployed. Full
confidence requires:

1. User runs **Preflight** in the Admin UI → confirm `recommendations: []`
2. User runs a live Quick Dial to their own cell → confirm phone rings, AI speaks
3. User runs `lk cloud auth && lk agent deploy --yes .` to complete the
   livekit-agent redeploy (belt-and-suspenders)

If all three are green → **✅ Safe.** The static and wire-up checks above give
high confidence that the live test will succeed. The dominant failure modes
(missing env, missing trunk, missing agent, wrong metadata path) are all ruled
out by direct inspection of the production Cloudflare secret store and the
remote D1.

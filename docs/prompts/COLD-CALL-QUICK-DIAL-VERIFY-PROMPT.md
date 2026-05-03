# Cold Call Center — Post-Edit Debug & Verification Prompt

> Paste this into Claude Code at the repo root **after** the edits from
> `COLD-CALL-QUICK-DIAL-DEBUG-PROMPT.md` have been applied.
> Goal: independently verify the fixes, catch regressions, and confirm
> Quick Dial actually rings the admin's cell with a talking AI on the other end.

---

## 0. Ground rules

- Read before you write. **Do not re-apply the fixes** — they're already in.
  Your job is **verification, regression-hunting, and a live smoke test**, not another refactor.
- Stay on the current branch (expected: `fix/quick-dial-test-call`). Do **not**
  merge, rebase, force-push, or deploy to prod.
- Do **not** rotate or print secrets. Redact when logging.
- If something is missing or ambiguous, **stop and ask** — don't guess.
- Keep the change footprint tiny: the only files you're allowed to write are:
  - `DEBUG-QUICK-DIAL-VERIFY-REPORT.md` (new — your report)
  - Narrow test-only additions under `src/routes/*.test.ts` if a regression needs coverage
  - Any single-line comment fix if you find a clear typo while reviewing

Anything larger than that → document it in the report and stop.

---

## 1. Scope — the surfaces that were edited

The previous pass was expected to touch (at minimum) these files. Start by
running `git diff main...HEAD --stat` and listing the actual changes.

Expected surfaces:
- `src/routes/call-center.ts` — Quick Dial handler (line ~385), `/dial` handler
  (line ~489), `/phone-lines` handlers (line ~1593-1800), plus a **new**
  `GET /quick-dial/preflight` endpoint.
- `public/static/call-center.js` — `ccQuickDial` (line ~1201), toast fix
  (line ~1220), new Preflight button near line ~207.
- `livekit-agent/src/main.py` — `run_outbound_session` metadata source
  (line ~112-138), agent-name registration at `AgentServer()` (line ~45).
- Possibly: `livekit-agent/outbound_agent.py` (standalone; should match).

For **each** changed file, write a short "What changed / Why / Risk" row in
the report. If anything outside this scope was modified, flag it loudly.

---

## 2. Static checks (no running processes required)

Run these and record pass/fail:

1. **TypeScript compile:** `npx tsc --noEmit` — must be clean on the call-center files.
2. **Build:** `npm run build` — must succeed; note any new warnings.
3. **Tests:** `npx vitest run` — all green. Pay attention to:
   - `src/routes/d2d-appointments.test.ts` (shouldn't be affected but confirms routing still works)
   - any new `call-center.test.ts` the previous pass may have added
4. **Lint/format sanity:** grep for debris the previous pass might have left:
   ```
   console.log('[QuickDial]'     // expected — should be present now
   TODO|FIXME|XXX                // new ones added?
   debugger                      // must be zero
   eslint-disable                // new ones added?
   ```
5. **Dead-code check on the unified agent:**
   ```
   grep -n "ctx.room.metadata" livekit-agent/src/main.py
   grep -n "ctx.job.metadata"  livekit-agent/src/main.py
   ```
   After the fix, `ctx.job.metadata` must appear in the outbound branch.
   `ctx.room.metadata` may still appear as a fallback but **not as the sole source**.
6. **Agent-name registration check:**
   ```
   grep -n "agent_name" livekit-agent/src/main.py
   ```
   Either (a) the server is constructed / run with an `agent_name` argument
   matching `"outbound-caller"`, **or** (b) `agent_name` was removed from the
   Worker's `CreateDispatch` call in `src/routes/call-center.ts`. Confirm
   exactly one of those paths was taken — not neither, not both.
7. **Route-registration check:** confirm `GET /quick-dial/preflight` is mounted
   behind `requireSuperAdmin` (same middleware as the rest of `callCenterRoutes`).
   Look at lines ~48-55 of `src/routes/call-center.ts`.

---

## 3. Wire-up checks

1. **Dist vs source drift.** Cloudflare Pages serves static assets out of
   `dist/` or `public/` depending on the Vite config. Verify that the edited
   `public/static/call-center.js` is what will actually ship:
   ```
   diff -u public/static/call-center.js dist/static/call-center.js || true
   ```
   If `dist/` exists and differs, you need a rebuild before the live test.
2. **Env var presence** (do not print values):
   - In `wrangler.jsonc`: confirm `LIVEKIT_URL` is set in `vars`.
   - Via `wrangler secret list`: confirm `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
     exist. `SIP_OUTBOUND_TRUNK_ID` is optional if DB has an active trunk row.
3. **DB state:** open the local D1 console (`npm run db:console:local`) and run:
   ```sql
   SELECT id, label, is_active, outbound_enabled,
          length(livekit_outbound_trunk_id) > 0 AS has_out_trunk,
          length(livekit_inbound_trunk_id)  > 0 AS has_in_trunk,
          length(livekit_dispatch_rule_id)  > 0 AS has_dispatch
   FROM cc_phone_config
   ORDER BY id;
   ```
   At least one row should have `is_active=1 AND outbound_enabled=1 AND has_out_trunk=1`
   for the Quick Dial SQL at line ~426 to pick it up. If none, the live test
   in §5 will fail with `sip_dial: no_trunk_configured` — which is now an
   informative error, not a mystery.
4. **Agents seeded:** `SELECT id, name, voice_id FROM cc_agents LIMIT 5;` —
   at least one row, else `ccQuickDial` front-end will show "No agents — create one first".

---

## 4. Preflight endpoint sanity

Boot the local sandbox: `npm run dev:sandbox`.

Obtain an admin JWT (superadmin) — either via the UI and reading
`localStorage.rc_token`, or a direct login curl against `/api/admin/login`.
Store as `ADMIN_JWT`.

Run:
```
curl -s -H "Authorization: Bearer $ADMIN_JWT" \
  http://localhost:3000/api/call-center/quick-dial/preflight | jq
```

Assertions:
- HTTP 200.
- `livekit.has_api_key && livekit.has_api_secret && livekit.has_url` → all true.
- `sip.livekit_outbound_trunks` is a non-empty array **OR**
  `sip.env_outbound_trunk_id` is a non-empty string.
- `sip.db_active_outbound_trunks` contains at least one row (matches §3.3).
- `agent.agents_in_db` non-empty.
- `webhook.call_complete_url` ends with `/api/call-center/call-complete`.
- `recommendations` is either empty or contains concrete, actionable items
  (no vague "check your setup" strings).

If any of these fail: do not attempt the live test. Fix the config, then
retry. If a fix requires code changes, **stop and report** — you're not
authorized to refactor here.

---

## 5. Live test — Quick Dial to the admin's own cell

> Only run this once §§2-4 pass. Ask the user for the target phone number
> (their own cell, E.164 preferred). Never dial an arbitrary number as a test.

1. In terminal A: `wrangler tail --format pretty` against whichever
   environment you're pointed at (sandbox or the staging Pages project).
2. In terminal B: `npm run dev:sandbox` (if not already running).
3. In the browser at `/admin` → AI Sales Call Center → Overview:
   - Click **Preflight**. Confirm green panel.
   - Enter the admin's phone into the Quick Dial field.
   - Pick an agent.
   - Click **Dial Now**.
4. Expected within ~5 s: admin's phone rings.
5. Answer. Within ~1 s, the AI should greet.
6. Have a 10-second conversation. Hang up.

Verify in terminal A that you see this sequence of `[QuickDial]` log lines
(or equivalent):
- trunk resolved (trunk id redacted to last 4)
- AgentDispatch response `sip_dispatch_rule_id` / `job_id`
- CreateSIPParticipant response including `participant_id` and `sid`
- final JSON returned to the client with `sip_dial: 'ringing'`, `success: true`

After hang-up, verify the webhook fired:
```sql
SELECT id, call_status, call_outcome,
       call_duration_seconds,
       length(call_transcript) AS transcript_len,
       started_at, ended_at
FROM cc_call_logs
ORDER BY id DESC LIMIT 3;
```
The most recent row must have:
- `call_status='completed'` (not stuck on `ringing` — that would prove the
  agent never called the webhook, i.e. §2.1 or §2.2 of the previous prompt
  was not actually fixed)
- `transcript_len > 0`
- `ended_at` populated
- `call_duration_seconds > 0`

---

## 6. Negative paths — error surfaces must be friendly

Don't skip these. Failures here are the most common field complaints.

### 6.1 Bad phone number
POST with `phone: "not-a-number"`. Expected: `400` with a clear JSON error, not a 500.

### 6.2 Missing agent
Temporarily delete all `cc_agents` rows (in a throwaway DB, NOT prod).
Quick Dial should return `{error: 'No AI agents exist. Create one first in the Agents tab.'}`.

### 6.3 No outbound trunk
Set the one `cc_phone_config` row's `is_active=0` and ensure `SIP_OUTBOUND_TRUNK_ID`
is unset. Quick Dial should return the specific `sip_dial: 'no_trunk_configured'`
with the actionable-error message that the previous pass promised to add.
The **frontend toast** must show the full error, not `undefined` (the §2.5 bug).

### 6.4 LiveKit unreachable
Break `LIVEKIT_URL` (e.g. `wss://definitely-not-real.livekit.cloud`) in `.dev.vars`,
restart. Quick Dial should return `sip_dial: 'dial_error'` with the underlying
network error in `sip_error`, not hang.

### 6.5 Duplicate self-dial
Dial yourself, answer, hang up. Immediately dial yourself again. There must be
no `participant_identity` collision (the fix in §2.6 of the previous prompt was
to suffix with `Date.now()`).

After each negative-path test, restore the config you broke.

---

## 7. Regression checks on adjacent features

Because the previous edits touched shared plumbing (`ccLivekitSipAPI`,
`main.py` routing), smoke-test these too:

- **Roofer Secretary test call.** From the Super Admin → Secretary customer
  panel, hit "Test Call" (`POST /api/admin/superadmin/secretary/:customerId/test-call`).
  It should still work. The metadata-fix should not have disturbed it because
  Secretary uses `ctx.room.metadata` which was left in place.
- **Report Guide.** If you have a test order, open its report-guide room and
  confirm the AI still spawns. Room name prefix `report-guide-*` routes
  correctly in `main.py`.
- **Regular `/dial` from Prospects list.** Pick a prospect, click "Dial".
  Should behave identically to Quick Dial.
- **Existing tests:** `npx vitest run` one more time after everything above.

---

## 8. Deliverable — `DEBUG-QUICK-DIAL-VERIFY-REPORT.md`

Single markdown file in repo root. Sections, in order:

1. **Changed files table** (from §1). Columns: `file | lines changed | what | why | risk`.
2. **Static-check results** (§2) — pass/fail per item with evidence.
3. **Wire-up results** (§3) — pass/fail per item with redacted evidence.
4. **Preflight output** (§4) — the actual JSON, with any secrets masked.
5. **Live test result** (§5) — did the phone ring? did the AI talk? post the
   3 most recent `cc_call_logs` rows (redact phone numbers to last 4 digits).
6. **Negative-path matrix** (§6) — table of 5 rows: test / expected / actual / verdict.
7. **Regression matrix** (§7) — 4 rows.
8. **Open issues** — anything still broken, with a one-line repro.
9. **Recommendation** — `✅ Safe to merge` / `⚠️ Conditional (list conditions)` / `❌ Block (list blockers)`.

---

## 9. Definition of done

- [ ] Report exists at `DEBUG-QUICK-DIAL-VERIFY-REPORT.md`.
- [ ] All §2 static checks green.
- [ ] Preflight returns green against the current environment.
- [ ] Live test rings the admin's cell and produces a completed `cc_call_logs`
      row with a non-empty transcript.
- [ ] All 5 negative-path surfaces return friendly errors (no 500s, no
      `undefined` toasts).
- [ ] Secretary, Report Guide, and Prospect-list dial still work.
- [ ] `npx vitest run` green.
- [ ] Branch unchanged except for the report file (and any narrow test-only
      additions you were explicitly authorized to make in §0).

If anything fails and the fix would exceed the §0 change budget, **stop and
write it up under "Open issues"** rather than expanding scope.

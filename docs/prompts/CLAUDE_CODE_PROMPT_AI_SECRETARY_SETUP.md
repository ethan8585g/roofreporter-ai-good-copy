# Claude Code Prompt — Fix AI Secretary Super Admin Provisioning

> Paste the entire section below (everything between the lines marked `BEGIN` and `END`) into your Claude Code terminal. It contains the full analysis, the file references, and the concrete task list. You do not need to do any additional research first — everything you need is already embedded.

---

## BEGIN CLAUDE CODE PROMPT

You are working in the `roofreporter-ai-good-copy` repo (a Cloudflare Pages + Workers Hono app with a Python LiveKit agent in `livekit-agent/`). I need you to close a major gap in the **super admin** area: right now there is **no single place** where a super admin can set up a new customer as an AI Secretary subscriber end-to-end. All the plumbing exists (DB schema, SIP trunk helper, LiveKit agent Python code, Dockerfile, `livekit.toml`), but the **UI** that orchestrates provisioning does not, and there is **no endpoint/mechanism to deploy the answering-service agent to LiveKit Cloud from inside the admin app.**

Your job is to fill that gap.

---

### 1. Background — what already exists (do not rebuild this)

Before writing any code, read these files in order so you understand the existing surface. Do NOT rewrite them — most of what you need is already done:

- `migrations/0012_*.sql` — creates `secretary_subscriptions`, `secretary_config`, `secretary_directories`, `secretary_call_logs`.
- `migrations/0013_*.sql` — creates `secretary_phone_pool`; extends `secretary_config` with telephony columns: `forwarding_method`, `assigned_phone_number`, `connection_status`, `carrier_name`, `livekit_inbound_trunk_id`, `livekit_dispatch_rule_id`, `livekit_sip_uri`, `sip_username`, `sip_password`, `twilio_trunk_sid`, `last_test_at`, `last_test_result`, `last_test_details`, `agent_voice`, `agent_name`, `agent_language`.
- `migrations/0043_*.sql` — adds `personal_phone`, `agent_phone_number`, `phone_provider`, `provider_account_status` to `onboarded_customers`.
- `src/routes/admin.ts` — contains (already implemented, use as-is):
  - `async function deployLiveKitForCustomer(...)` (around line **1642–1718**) — creates the LiveKit inbound SIP trunk + dispatch rule via `/twirp/livekit.SIP/CreateSIPInboundTrunk` and `/twirp/livekit.SIP/CreateSIPDispatchRule`, persists `livekit_inbound_trunk_id` and `livekit_dispatch_rule_id` into `secretary_config` and `secretary_phone_pool`.
  - `POST /api/admin/superadmin/onboarding/create` (line **1449**) — creates a customer and, if secretary fields are present, calls `deployLiveKitForCustomer`.
  - `POST /api/admin/superadmin/secretary/:customerId/sip-config` (line **1789**).
  - `POST /api/admin/superadmin/secretary/:customerId/test-call` (line **1824**).
  - `POST /api/admin/superadmin/deploy-secretary/:customerId` (line **1876**).
  - `POST /api/admin/superadmin/onboarding/:id/toggle-secretary` (line **1897**).
  - `GET /api/admin/superadmin/phone-numbers/available` (line **1931**) — Twilio number search.
  - `POST /api/admin/superadmin/phone-numbers/purchase` (line **1963**) — Twilio number purchase → adds to pool.
  - `POST /api/admin/superadmin/phone-pool/add` (line **2004**).
  - `POST /api/admin/superadmin/phone-pool/assign` (line **2023**) — assigns pool number to customer, optionally deploys SIP.
  - `POST /api/admin/superadmin/secretary/:customerId/update-phone` (line **2059**).
  - `GET /api/admin/superadmin/secretary/deployment-status` (line **2104**).
  - `GET /api/admin/superadmin/secretary/overview | subscribers | revenue | calls` (lines **1144, 1226, 1268, 1370**).
- `src/routes/secretary.ts` — customer-facing secretary routes (config, subscribe, calls, webhooks).
- `livekit-agent/agent.py` — multi-tenant Python agent. Parses `customer_id` from room name `secretary-{customer_id}-*`, fetches config via `GET {ROOFPORTER_API_URL}/api/agents/agent-config/{customer_id}`, function tools: `take_message`, `schedule_estimate`.
- `livekit-agent/Dockerfile`, `livekit-agent/livekit.toml` (subdomain `roofreporterai-btkwkiwh`, agent id `CA_McGBLzwzRDve`), `livekit-agent/requirements.txt`, `livekit-agent/README.md`.
- `public/static/admin.js` — admin tab definitions (lines ~74–89). There's already a `{ id:'sip', label:'SIP Bridge', icon:'fa-phone-volume' }` tab with **no renderer function**. That is where the new UI must hook in.
- `src/index.tsx` — mounts everything. Contains `getAdminPageHTML()` at line **5014** and `getSuperAdminBiHTML()` at line **16911**.

**What is missing (this is what you must build):**

1. A super admin **"AI Secretary" page** (a full provisioning UI that consumes the APIs above).
2. A **single-button end-to-end provisioning workflow**: create customer → pick or purchase phone number → persist config → create SIP trunk + dispatch rule → mark customer as active → surface deployment status.
3. An **agent deployment endpoint** that triggers a LiveKit Cloud deploy of the Python agent (or at minimum makes it easy for the super admin to trigger one) and records the deployment result.
4. A **status/health dashboard** that shows per-customer: subscription state, phone number assigned, trunk/dispatch IDs, last test result, agent version running, quick actions (Test Call, Redeploy, Disable).

---

### 2. Deliverables

Build the following. Keep the app conventions: Hono + TSX routes, HTML rendered via functions in `src/index.tsx`, vanilla JS in `public/static/`, D1 accessed via `c.env.DB`.

#### 2a. New super admin route & page: `/admin/super/secretary`

- Add a route in `src/index.tsx` next to the existing `/admin/super` route: `app.get('/admin/super/secretary', (c) => c.html(getSuperAdminSecretaryHTML()))`.
- Write `getSuperAdminSecretaryHTML()` as a new function in `src/index.tsx`. Match the existing styling/layout used by `getSuperAdminBiHTML()` (read it first so the new page doesn't look out of place).
- The page has four sections (tabs or stacked cards):
  1. **Provision a new subscriber** — form that calls `POST /api/admin/superadmin/onboarding/create` with fields:
     - Customer: `name`, `email`, `business_phone`, `carrier_name` (dropdown: Rogers / Telus / Bell / Shaw / Koodo / Fido / Other), `personal_phone`.
     - Phone strategy (radio): **(a) Assign from pool**, **(b) Purchase new Twilio number**, **(c) BYO SIP credentials**.
       - (a) loads from `GET /api/admin/superadmin/phone-pool/available` (add this endpoint — see 2b).
       - (b) uses `GET /api/admin/superadmin/phone-numbers/available` (country/area-code inputs) → `POST /api/admin/superadmin/phone-numbers/purchase`.
       - (c) fields `sip_username`, `sip_password`, `twilio_trunk_sid`, raw E.164 number.
     - Secretary config: `agent_name` (default Sarah), `agent_voice` (alloy / echo / fable / onyx / nova / shimmer), `agent_language` (en/fr/es), `greeting_script`, `common_qa`, `general_notes`.
     - Directories: repeater (add/remove rows) for `name`, `phone_or_action`, `special_notes`.
     - Submit button: **Provision + Deploy SIP trunk**. After success, show result block with trunk id, dispatch id, SIP URI, assigned number, connection status, and a **Test Call** button.
  2. **Subscribers** — table populated from `GET /api/admin/superadmin/secretary/subscribers`. Columns: customer, plan, status, phone number, trunk ID, dispatch ID, last test, calls (24h), actions (Edit, Test, Redeploy trunk, Redeploy agent, Disable).
  3. **Phone pool** — table from a new `GET /api/admin/superadmin/phone-pool` endpoint (see 2b). Actions: Add manually, Purchase from Twilio, Assign to customer, Release.
  4. **Agent deployment** — card showing current LiveKit Cloud agent status (subdomain, agent id from `livekit.toml`), last deployment timestamp, and a **Deploy agent to LiveKit Cloud** button. See 2c.
- Front-end code goes into a new file `public/static/admin-secretary.js` (loaded by the new page). Do **not** dump it into the existing `admin.js`.
- Also wire the existing `admin.js` tab `{ id:'sip', label:'SIP Bridge' }` (line ~85) to link out to `/admin/super/secretary` (rename its label to `AI Secretary` and update the icon to something like `fa-robot`). If keeping it inline, at minimum add a `renderSipBridge()` stub that deep-links to `/admin/super/secretary` so that tab stops being a dead end.

#### 2b. Backend API additions to `src/routes/admin.ts`

Add only what's missing — do not duplicate endpoints already listed above.

- `GET /api/admin/superadmin/phone-pool` — returns all rows from `secretary_phone_pool` (with `assigned_to_customer_id` joined to `customers.name` where applicable). Supports `?status=available|assigned|all`.
- `POST /api/admin/superadmin/phone-pool/:id/release` — sets a pool number back to `status='available'`, clears `assigned_to_customer_id`, `assigned_at`, and (if a trunk exists and belongs only to that number) deletes the LiveKit trunk/dispatch rule via `/twirp/livekit.SIP/DeleteSIPTrunk` and `/twirp/livekit.SIP/DeleteSIPDispatchRule`, then clears `sip_trunk_id` / `dispatch_rule_id`.
- `POST /api/admin/superadmin/secretary/:customerId/redeploy-trunk` — delete-then-recreate wrapper around `deployLiveKitForCustomer` (use the existing LiveKit delete calls before recreating). Update `secretary_config.connection_status` during the flow (`pending_forwarding` → `connected` / `failed`). Record result into `last_test_result` and `last_test_details`.
- `POST /api/admin/superadmin/agent/deploy` — kicks off a LiveKit Cloud agent deployment. See 2c for the two implementation options; pick option A unless you already have a deploy worker running.
- `GET /api/admin/superadmin/agent/status` — returns the current deployment metadata recorded in a new table (see 2d).

Every new admin endpoint must use the same auth guard the other `/api/admin/superadmin/*` endpoints use — copy the guard from an existing route (e.g., the one at line **1449**). Do not invent a new auth scheme.

#### 2c. Agent deployment to LiveKit Cloud

You have two viable paths. Implement **Option A** unless the repo already contains Option B scaffolding.

**Option A — webhook to a self-hosted deploy runner (recommended):**

- Add an env var `LIVEKIT_DEPLOY_WEBHOOK_URL` (and optionally `LIVEKIT_DEPLOY_WEBHOOK_SECRET`). Document them in `wrangler.jsonc` comments and `README.md`.
- `POST /api/admin/superadmin/agent/deploy` signs a payload `{ requestedBy, requestedAt, commitSha? }` with an HMAC-SHA256 of the secret and POSTs it to the webhook. The webhook is a tiny runner (e.g., a GitHub Actions `repository_dispatch`, a Render deploy hook, or a small VM cron) that runs `lk agent deploy` against `livekit-agent/`.
- Record the attempt in a new `agent_deployments` table (see 2d).
- If `LIVEKIT_DEPLOY_WEBHOOK_URL` is not set, the endpoint should return `501 Not Implemented` with a clear JSON error message and a hint to configure the secret. Do not silently fail.
- In parallel, add a GitHub Actions workflow at `.github/workflows/livekit-agent-deploy.yml` that: (a) triggers on push to main when `livekit-agent/**` changes, (b) triggers on `workflow_dispatch`, and (c) also responds to `repository_dispatch` with type `deploy-livekit-agent`. The job installs the `lk` CLI, authenticates via `LK_CLOUD_TOKEN` secret, and runs `lk agent deploy --subdomain roofreporterai-btkwkiwh` (pull the subdomain from `livekit-agent/livekit.toml`). The `repository_dispatch` branch is what the webhook can fire.

**Option B — direct LiveKit Cloud API (only if `lk agent` management API is available in this repo already):**

- If there's existing code that calls LiveKit Cloud's agent management API directly with `LIVEKIT_CLOUD_TOKEN`, reuse that. Otherwise default to Option A.

In both cases, the super-admin UI's **Deploy agent to LiveKit Cloud** button must:
- Disable itself and show a spinner.
- Call `POST /api/admin/superadmin/agent/deploy`.
- Poll `GET /api/admin/superadmin/agent/status` every 5 s for up to 10 minutes.
- Render success / failure with the commit SHA, agent id, and the LiveKit `CA_...` id from `livekit.toml`.

#### 2d. New migration: `agent_deployments`

Add `migrations/00NN_agent_deployments.sql` (use the next sequential number after the latest migration in `migrations/`) with:

```sql
CREATE TABLE IF NOT EXISTS agent_deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requested_by_user_id INTEGER,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, succeeded, failed
  commit_sha TEXT,
  agent_id TEXT,                           -- from livekit.toml (CA_...)
  livekit_project TEXT,                    -- subdomain from livekit.toml
  logs TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_deploy_status ON agent_deployments(status);
CREATE INDEX IF NOT EXISTS idx_agent_deploy_requested ON agent_deployments(requested_at);
```

Expose `GET /api/admin/superadmin/agent/deployments` to list the last 50.

#### 2e. Provisioning hardening

Inside `deployLiveKitForCustomer` and the endpoints that call it, make the following improvements (the core logic is fine — these are fixes around the edges):

- Wrap the create-trunk + create-dispatch pair in a **compensating rollback**: if dispatch creation fails after the trunk was created, delete the orphaned trunk. Write to `secretary_config.last_test_details` on each failure.
- Accept and pass through `agent_name`, `agent_voice`, `agent_language` into the trunk metadata (the agent reads from the config API but metadata is useful for debugging).
- Update `connection_status` transitions explicitly: `not_connected` → `pending_forwarding` (trunk creating) → `connected` (trunk + dispatch done) → `failed` (on error, with details). Never leave it in `pending_forwarding` — every path must resolve.
- After successful provisioning, automatically trigger a trunk test via the existing `secretary/:customerId/test-call` logic and record `last_test_result`.

#### 2f. Documentation

- Update `livekit-agent/README.md` with a "Deploying from Super Admin" section that documents the webhook/GitHub Actions path.
- Add a short `docs/AI_SECRETARY_PROVISIONING.md` that explains the super admin workflow, the required env vars (`LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `LIVEKIT_DEPLOY_WEBHOOK_URL`, `LIVEKIT_DEPLOY_WEBHOOK_SECRET`, `LK_CLOUD_TOKEN` for the Action), and a troubleshooting section.

---

### 3. Guardrails — important

- **Do not touch the Python agent behavior** (`livekit-agent/agent.py`). It already works multi-tenant. You are wiring up provisioning and deployment, not changing the agent.
- **Do not change existing API contracts.** The customer-facing `secretary.ts` routes and the existing `/api/admin/superadmin/*` endpoints listed in §1 must continue to behave the same. Additive changes only.
- **Do not invent new auth.** Reuse the existing super-admin guard pattern used by the endpoints at lines 1144, 1449, 1642, 1931. If there's a helper like `requireSuperAdmin(c)`, use it. If not, copy the existing inline check — do not refactor it in this pass.
- **Do not commit secrets.** All LiveKit / Twilio / webhook secrets go through `wrangler secret put` or GitHub Actions secrets. `wrangler.jsonc` may reference them; actual values are out-of-band.
- **Match the style of the codebase.** TSX/Hono routes, D1 via `c.env.DB`, templates as HTML-returning functions in `src/index.tsx`, front-end JS as plain browser scripts in `public/static/`. No React, no bundler changes.
- **Type everything.** Add types to `src/types.ts` where it helps (`SecretaryPhonePool`, `SecretaryProvisioningRequest`, `AgentDeployment`).
- **Tests.** Add at least one `vitest` test that exercises `deployLiveKitForCustomer`'s rollback path (mock the LiveKit API). Existing tests live under `src/**/*.test.ts`. Keep it hermetic.

---

### 4. Acceptance criteria — what "done" looks like

When you're finished, I should be able to:

1. Log in as a super admin, go to `/admin/super/secretary`, and see four sections: Provision, Subscribers, Phone Pool, Agent Deployment.
2. Fill out the Provision form with a new business, pick an available pool number (or buy a new Twilio number), and click **Provision + Deploy SIP trunk**. Within ~15 seconds the UI shows the created trunk id, dispatch rule id, assigned number, and `connection_status = connected`. The customer row appears in the Subscribers table.
3. Click **Test Call** on that row and see the `last_test_result` update to `success` (or a clear failure with `last_test_details`).
4. Click **Deploy agent to LiveKit Cloud** and — assuming `LIVEKIT_DEPLOY_WEBHOOK_URL` is configured — see a pending → running → succeeded deployment record appear. The deployment runs `lk agent deploy` from `livekit-agent/` via GitHub Actions.
5. Call the newly-assigned phone number from a real phone. The inbound call hits LiveKit, lands in room `secretary-{customerId}-{random}`, and the agent answers with the configured greeting. Messages and appointments are recorded via the existing webhooks.
6. All of the above works without ever touching a CLI.

### 5. Work order (suggested)

1. Read `src/routes/admin.ts` lines 1144–2200 and `livekit-agent/README.md` to confirm the surface you're integrating against.
2. Create the migration `agent_deployments` and run `npm run db:migrate:local`.
3. Add the new endpoints in `src/routes/admin.ts` (§2b) + the hardening in `deployLiveKitForCustomer` (§2e). Add vitest coverage for rollback.
4. Add `getSuperAdminSecretaryHTML()` and the `/admin/super/secretary` route in `src/index.tsx`.
5. Write `public/static/admin-secretary.js`.
6. Add the GitHub Actions workflow (§2c).
7. Update the SIP Bridge tab in `public/static/admin.js` to link to the new page.
8. Update `livekit-agent/README.md` and add `docs/AI_SECRETARY_PROVISIONING.md`.
9. Run `npm run build`, `npx vitest run`, and do a manual smoke test against `npm run dev:sandbox`.
10. Open a PR with a short description and screenshots of the new UI.

Before you start coding, print a short plan (max 15 bullets) of what you're about to change and which files, so I can sanity-check it. Then proceed.

## END CLAUDE CODE PROMPT

---

## Why this prompt is structured this way

- It front-loads the existing surface area (with file paths and line numbers) so Claude Code doesn't burn tokens re-exploring what's already been found.
- It explicitly lists what **not** to rebuild — migration tables, `deployLiveKitForCustomer`, the Python agent, customer-facing secretary routes, and the existing admin APIs — so Claude doesn't refactor working code.
- It frames the gap as three concrete deliverables (UI, deployment endpoint, provisioning hardening) instead of the vague "fix the AI secretary setup."
- It gives Claude Code a "suggested work order" at the end so it attacks the problem in a testable sequence rather than writing a giant monolithic change.
- It includes acceptance criteria that map 1:1 to your complaint ("no way to set up a new user, no SIP trunk creation, no agent deploy to LiveKit Cloud").

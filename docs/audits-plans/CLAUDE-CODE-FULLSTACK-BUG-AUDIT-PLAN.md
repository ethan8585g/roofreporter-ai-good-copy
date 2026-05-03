# Roof Manager — Full-Stack Bug & Security Audit Remediation Plan

**Target repo:** `roofreporter-ai-good-copy` (roofmanager.ca)
**Stack:** Hono + Cloudflare Pages/Workers, D1 (SQLite), Hono JSX SSR, embedded client JS
**Audit scope:** Frontend (user + customer portal), Super Admin backend, auth/security, data/services
**Audit date:** 2026-04-20
**Total findings:** 98 (8 Critical, 34 High, 38 Medium, 18 Low/Quality)

---

## How to use this plan in Claude Code

Paste this entire file into Claude Code and run it against the repo. Work the phases in order — **Phase 0 (Critical) must ship before any other work.** For each finding:

1. Open the cited file at the cited line.
2. Read the surrounding function/handler to confirm the finding still applies (some may have been partially fixed since the audit).
3. Implement the fix as described. When in doubt about product behavior, prefer the safer default and add a TODO comment; do not silently change business logic.
4. Run `npx vitest run` after each logical group of fixes.
5. Commit per finding ID (e.g. `git commit -m "fix(security): P0-03 replace plaintext SIP creds with KMS — [P0-03]"`).
6. After each phase, re-run the full test suite + `npm run build` and fix any regressions before moving on.

**Global ground rules:**
- Never introduce `eval`, `new Function`, `dangerouslySetInnerHTML`, or `innerHTML =` with interpolated data.
- Never build SQL by template literal when any token is dynamic — use `.bind()`, or an explicit whitelist for column/table names.
- Always use `.textContent` on DOM injections; use `document.createElement` + `setAttribute` for attribute-bearing markup.
- Currency values must be integers in cents end-to-end — no floats anywhere in `invoices.*`, `pricing-engine.*`, or `commissions.ts`.
- Add a regression test for every Critical or High fix. Prefer `vitest` integration tests that hit the actual handler.

---

## Phase 0 — CRITICAL (ship-blockers, fix this week)

### P0-01  SQL injection in dynamic `UPDATE … SET ${fields.join(',')}` statements
**Files / lines:**
- `src/routes/platform-admin.ts:224` — `UPDATE secretary_config SET ${fields.join(', ')} WHERE customer_id = ?`
- `src/routes/storm-alerts.ts:135` — `UPDATE storm_service_areas SET ${fields.join(', ')} …`
- `src/routes/email-outreach.ts:1073` — identical pattern
- `src/services/storm-ingest.ts:202, 212, 250` — `… WHERE dedupe_key IN (${placeholders})`

**Why:** `fields` is derived from request body keys. Any authenticated caller (incl. non-super admins on platform-admin) can inject SQL.

**Fix:** Introduce `src/utils/sql-safe.ts` exporting `buildUpdate(table, allowedCols: Set<string>, patch: Record<string, unknown>)` that returns `{sql, binds}` using a strict whitelist. Rewrite all 4 call sites to pass an explicit allowlist of column names. For `IN (...)` clauses, build placeholders from `keys.map(() => '?').join(',')` and `.bind(...keys)`; never interpolate the string.

### P0-02  DOM-XSS via `innerHTML` on untrusted data in index.tsx
**Files / lines (src/index.tsx):** 4651, 4815, 4817, 5313, 8537, 13024, 13028, 13114, 14391, 15323, 15648, plus lead-form onsubmit at 4046 and OG meta at 2710.

**Why:** Several paths build HTML strings from server JSON (`data.redirect`, `data.error`, `data.message`, route stats, crew names, report titles). A single `esc()` helper is relied on inconsistently and redefined in ~6 places.

**Fix:**
1. Create `src/utils/html-escape.ts` with `escHtml(s)` and `escAttr(s)` and remove all local redefinitions.
2. Replace every `element.innerHTML = '…' + value + '…'` with either (a) `element.textContent = value` for text-only, or (b) `element.replaceChildren(documentFragmentBuiltWithCreateElement(...))` for structured markup.
3. For the `onsubmit="submitLeadForm(event, '${sourcePage}')"` at 4046, switch to `data-source="${escAttr(sourcePage)}"` and read via `dataset.source`.
4. For OG tags at 2710, escape report `title`/`description`/`image` with `escAttr` before replacement.
5. Add a unit test in `src/utils/html-escape.test.ts` covering `<`, `>`, `"`, `'`, `&`, CRLF, and unicode.

### P0-03  Password hashing: drop SHA-256 and hardcoded salts
**Files / lines:**
- `src/routes/platform-admin.ts:80–82, 116–119` — SHA-256 + hardcoded salt `'roofreporter_salt_2024'` for onboarding + team creation
- `src/routes/auth.ts:13–25`, `src/routes/customer-auth.ts:56–68` — PBKDF2-SHA256 @ 100k iterations, UUID salt

**Why:** The platform-admin path uses single-round SHA-256 with a shared salt (rainbow-table attackable). The main path uses PBKDF2 below NIST 2024 guidance.

**Fix:**
1. Centralize in `src/lib/password.ts`: `hashPassword(plain): Promise<string>` and `verifyPassword(plain, stored): Promise<boolean>` using PBKDF2-SHA512 @ 600,000 iterations with a 32-byte random salt from `crypto.getRandomValues`. Output format: `pbkdf2$sha512$600000$<saltB64>$<hashB64>`.
2. Replace every `crypto.subtle.digest('SHA-256', ...)`-for-password call site with these helpers.
3. On successful login, if stored hash is legacy (SHA-256 or PBKDF2-SHA256), re-hash with the new scheme and UPDATE in place.
4. Add a migration note: existing users keep working via the legacy-detection branch; new signups use the new format.
5. Add `src/lib/password.test.ts` with known-answer tests + legacy-upgrade test.

### P0-04  Hardcoded dev account with plaintext password
**File / lines:** `src/routes/customer-auth.ts:35–41, 723, 729–735, 755`

**Why:** `DEV_ACCOUNT = { email: 'dev@reusecanada.ca', password: 'DevTest2026!' }` is in source. `DEV_MODE` auto-provisions 999,999 credits and gives that account a 365-day session. If `DEV_MODE` ever leaks into prod env (or is already set), this is a pre-auth admin-style backdoor.

**Fix:** Delete the constant. If a dev login is needed, gate behind `c.env.DEV_ACCOUNT_EMAIL_HASH && c.env.DEV_ACCOUNT_PASSWORD_HASH` secrets and require `c.env.ENVIRONMENT === 'development'` AND the hostname to be `localhost`. Never auto-grant credits. Use normal 30-day session.

### P0-05  Session tokens delivered in JSON response body, not HttpOnly cookie
**Files / lines:** `src/routes/auth.ts:232`, `src/routes/customer-auth.ts:826`, `src/index.tsx:702` (stored in `localStorage`)

**Why:** A single reflected/stored XSS anywhere on the domain exfiltrates every admin + customer session.

**Fix:**
1. Issue session via `Set-Cookie: rm_session=<token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=…`.
2. Remove the token from JSON responses (return only `{ ok: true, user: {...} }`).
3. Remove every `localStorage.setItem('rc_customer_token', …)` and every read; switch API client to rely on the cookie.
4. Add CSRF token (double-submit cookie or custom header `X-RM-CSRF`) for all state-changing endpoints that now rely on cookie auth.
5. Update `api-auth.ts` middleware to accept both `Authorization: Bearer` (for public API keys) and the session cookie.

### P0-06  Password reset tokens in URL query string
**Files / lines:** `src/routes/auth.ts:361`, `src/routes/customer-auth.ts:1575`

**Why:** Tokens appear in server logs, browser history, and outbound Referer headers when users click any link on the reset page.

**Fix:** Send a short opaque ID in the URL that maps to a single-use token stored server-side; the reset page POSTs `{id, newPassword}`. Set `Referrer-Policy: no-referrer` on the reset page. Expire tokens in 30 minutes. Invalidate on first use (successful or failed). Add `admin_sessions` / `customer_sessions` DELETE for the user on successful reset (fixes P1-06 too).

### P0-07  Unauthenticated analytics endpoints leak full BI data
**File:** `src/routes/analytics.ts:166, 409, 431, 455, 555, 735, 822, 857`

**Why:** `/analytics/dashboard`, `/analytics/visitor/:id`, `/analytics/clicks`, GA4 reports, realtime, events are mounted without any auth middleware. Competitors can scrape full traffic/visitor telemetry.

**Fix:** Wrap all non-`/track` routes in the admin JWT middleware. `/analytics/track` stays public but rate-limited to 50 req/min per IP via a KV-backed sliding window.

### P0-08  AI admin chat mutation tools without confirmation or allowlist
**File:** `src/routes/ai-admin-chat.ts:229–241, 440–476`

**Why:** `query_database`, `update_setting`, `manage_customer`, blog/content mutation tools can be triggered via prompt-injected system_prompt leakage. No rate limit, no confirmation step, no audit log of tool invocations.

**Fix:**
1. Mark each tool with `requiresConfirmation: true` for mutations. Flow: model proposes tool call → UI asks admin to approve → only then execute.
2. Whitelist `update_setting` to a hardcoded set of allowed keys (no pricing, no feature flags).
3. Per-admin rate limits: 10 tool calls / hour, 1 credit-grant / day.
4. Insert `INTO admin_tool_audit (admin_id, tool, args_json, result, ts)` for every invocation.
5. Add `superadmin`-only check at the entry of the chat endpoint (not just "admin").

---

## Phase 1 — HIGH (fix this sprint)

### Auth, sessions, privilege

- **P1-01** `src/routes/auth.ts:72`, `src/routes/customer-auth.ts:805` — Sessions TTL 30 days; reduce to 7 days + refresh-token rotation.
- **P1-02** `src/routes/auth.ts:448` — Logout `DELETE FROM admin_sessions` is fire-and-forget; `await` and assert `meta.changes === 1`.
- **P1-03** `src/routes/auth.ts:427–439` — Password reset does not invalidate existing sessions; add `DELETE FROM admin_sessions WHERE admin_id = ?` before returning.
- **P1-04** `src/routes/customer-auth.ts` (email/password change paths) — same issue; invalidate all customer sessions on credential change.
- **P1-05** `src/routes/customer-auth.ts:706` — Login rate limit is 10/IP/15min; tighten to 5/IP/15min AND 5/email/15min; add exponential backoff and lockout after 15 failures.
- **P1-06** `src/routes/customer-auth.ts:1558–1560` — Forgot-password rate limit not enforced before send; invert the check.
- **P1-07** `src/routes/customer-auth.ts:1582` — Response reveals "If an admin account with that email exists"; replace with generic "If an account exists, we've sent instructions." Match latency with a random 100–300 ms pad when account missing.
- **P1-08** `src/routes/customer-auth.ts:795–797` — Login timing oracle; run password verify on a dummy hash when email not found.
- **P1-09** `src/routes/customer-auth.ts:116` — 6-digit verification code from `Math.random()`; switch to `crypto.getRandomValues` and store PBKDF2 hash of code, not plaintext.
- **P1-10** `src/routes/customer-auth.ts:360–366` — Per-IP verification throttle is 10/hour; add global 20/IP/hour and 3/email/hour with 1-hour lockout.
- **P1-11** `src/routes/customer-auth.ts:206` — Gmail raw-email builder concatenates subject/body without CRLF filtering; strip `\r\n` from all headers and validate.
- **P1-12** `src/lib/permissions.ts:49, 104` — `can()` returns truthy for unknown roles; default to deny and require explicit grants per role.
- **P1-13** `src/routes/admin.ts:2528` — One handler uses `admin.role !== 'superadmin'` instead of `requireSuperadmin(admin)`; unify via helper, write `permissions.test.ts` case for every admin route.
- **P1-14** `src/routes/admin.ts:87–102, 222–244` — Admin-only endpoints missing explicit superadmin guard; add `if (!requireSuperadmin(admin)) return c.json({error:'forbidden'},403)` on every handler in `admin.ts`.

### OAuth / webhooks / external APIs

- **P1-15** `src/routes/customer-auth.ts:1780, 1834` — Google Calendar OAuth `state` is `${customerId}:${uuid}` but not re-validated against session customer; assert equality.
- **P1-16** `src/routes/customer-auth.ts:1778, 1850` — OAuth `redirect_uri` built from request Host header; hardcode `https://www.roofmanager.ca/oauth/...` per environment.
- **P1-17** `src/routes/square.ts:125` — Webhook signature compared with `===`; use the existing `timingSafeEq()` helper.
- **P1-18** `src/routes/square.ts:683–693` — Ensure HMAC uses the **raw** request body captured before any JSON parse (check `c.req.raw.clone().text()` flow).
- **P1-19** `src/routes/square.ts:780–820` — Webhook idempotency is check-then-write without a lock; add `INSERT OR IGNORE INTO square_webhook_events (square_event_id,…)` at the start and branch on `meta.changes === 0` → already processed.
- **P1-20** `src/routes/square.ts:89` — `.json()` called before `response.ok` check; invert.
- **P1-21** `src/routes/square.ts:340, 356, 248–312` — `success_url` / `cancel_url` from body are open-redirect vectors and lack CSRF; whitelist origins to `roofmanager.ca` subdomains and require CSRF token on checkout POST.
- **P1-22** `src/index.tsx:95–101` — CORS allows `credentials: true` with a list of origins; verify the allowlist is exact-match (no substring/startsWith) and rejects `null` origin.

### Destructive actions / audit

- **P1-23** `src/routes/admin.ts:2898, 2907, 3045, 3059, 3279, 3654` — Delete / refund / revoke endpoints have no confirmation token and no audit log. Introduce `confirm_token` flow (issue one-time token, require matching POST within 5 min) and insert into `admin_audit_log`.
- **P1-24** `src/routes/commissions.ts:104–149` — Commission create/update not audited; log to `admin_audit_log` with before/after JSON.
- **P1-25** `src/routes/admin.ts` (bulk operations) — No transaction wrapping; use `c.env.DB.batch([...])` for atomic groups.

### Data & money

- **P1-26** `src/routes/invoices.ts:89–103` — Float math for subtotals/discounts/taxes. Migrate all invoice math to integer cents; create `src/utils/money.ts` with `toCents()`, `fromCents()`, `addCents()`, `pctOfCents()`. Update `invoices.math.test.ts` with penny-level assertions on 10k-invoice rollups.
- **P1-27** `src/routes/invoices.ts:96` — Document and enforce whether discount is pre-tax or post-tax; add a named constant `DISCOUNT_APPLIED_BEFORE_TAX = true` and assert in tests.
- **P1-28** `src/routes/crm.ts:2390–2400, 2440–2441` — N+1 geocoding and N+1 update loops; batch with a single `Promise.all` chunk (max 20 concurrent) for geocoding and `DB.batch(stmts)` for updates.
- **P1-29** `src/routes/email-outreach.ts:114–118` — Per-list count subqueries; rewrite as one `GROUP BY list_id, status` query and merge client-side.

### Measurement engine

- **P1-30** `src/services/roof-measurement-engine.ts:515–535, 858–870` — Pitch interpolation and `Math.ceil` bundle rounding are untested. Create `src/services/roof-measurement-engine.test.ts` with cases for pitches 0/4/6/8/10/12/16/24, fractional pitches, and bundle counts at 500 / 1000 / 1500 / 2200 sqft against hand-calculated truth.

### Cross-cutting frontend

- **P1-31** `src/index.tsx:8059–8061, 8088–8091, 7215` — PII/AB-test writes to `localStorage` without consent. Gate behind a cookie-consent flag; prefer `sessionStorage` for form drafts; never persist email/phone locally.
- **P1-32** `src/index.tsx:2373` — Blog post `content` rendered directly into SSR HTML. Run through DOMPurify server-side on write (in blog admin handler) and store sanitized.
- **P1-33** `src/routes/lead-capture.ts:83–88, 91–104` — Address fields slice to 300 chars but don't filter CRLF or HTML; reject CRLF and HTML tags; render email body with an auto-escaping template.
- **P1-34** `src/routes/public-api.ts:138–144` — Address length 500 with no content validation; require regex `/^[\p{L}\p{N}\s.,'#\-\/]+$/u` and max 300.

---

## Phase 2 — MEDIUM

### Frontend polish & safety
- `src/index.tsx:4307–4308, 5253–5257, 197–210` — Centralize DOM builders; always null-check `querySelector` results; wrap `JSON.parse(localStorage.getItem(...))` in try/catch.
- `src/index.tsx:5390–5391` — Validate reset token regex client-side before fetch.
- `src/index.tsx:8468–8487` — Disable signup form during redirect; handle `beforeunload`.
- `src/index.tsx:4289` — Extract hardcoded auth URLs to a shared `ROUTES` const.
- `src/index.tsx:3055, 13024, 13028, 13114, 14391, 15323, 15648` — Standardize error-display to a single toast helper using `.textContent`.
- `src/index.tsx:2936, 994, 1028, 4284, 4656` — Delete duplicate `escHtml` copies; import from `utils/html-escape.ts` (pairs with P0-02).
- `src/index.tsx:7027` — Alt-attr escaping incomplete (only `"`); use `escAttr`.
- `src/index.tsx:146–148` — GA4 `SameSite=None;Secure` cookie; enforce Secure via `Strict-Transport-Security` and reject GA events from HTTP.
- `src/index.tsx:4019` — Service-worker `.catch(function(){})` is silent; log.

### Customer portal consistency
- `src/routes/customer-auth.ts:629` — 6-char ref codes too short; move to 10 base-36 chars.
- `src/routes/customer-auth.ts:783–785` — Enforce `LOWER(email)` storage to prevent dual-case accounts.
- `src/routes/customer-auth.ts:822–826` — Login response missing `subscription_status`/`credits`; align with `/me`.
- `src/routes/customer-auth.ts:755` — Dev account 365-day session; unify at 7 days post-P1-01.

### Admin & middleware
- `src/routes/admin.ts:2795, 3093–3100` — Error messages name specific env vars; return generic strings; restrict secret-presence endpoint to superadmin + rate limit.
- `src/routes/admin.ts:2902` — Soft-delete should log `admin_id`, `reason`, `ts`.
- `src/routes/admin.ts:3045–3068` — LiveKit trunks/dispatches need soft-delete.
- `src/middleware/api-auth.ts:154` — Audit all `console.log` for raw `rawKey`; log only `key_prefix`.
- `src/routes/developer-portal.ts:598–612, 662–681, 720–730` — Set `Cache-Control: no-store, no-cache` + `Pragma: no-cache` on all pages that render secrets; change login form `autocomplete="off"` on password.
- `src/routes/platform-admin.ts:90` — Encrypt `sip_username`/`sip_password` at rest using a KMS-derived key stored in Cloudflare secret; add `is_encrypted` flag and decrypt on read.

### Data integrity
- `src/routes/invoices.ts:222, 233, 395, 552, 657, 794, 831, 861, 891, 1162` — Replace silent `.catch(() => {})` with logged errors; fail loudly when the operation is critical (payment writes, email sends, invoice status changes).
- `src/routes/invoices.ts:345–346, 454, 696` — Replace `new Date().setDate(...)` with UTC arithmetic: `new Date(Date.now() + days*86400000).toISOString().slice(0,10)`.
- `src/routes/invoices.ts:539` and all status comparisons — Export `INVOICE_STATUS` const and use in every `WHERE status = ?` and `status === ...` check.
- `src/routes/email-outreach.ts:98–104, 72, 85` — Validate pagination; fail startup on table-create errors instead of swallowing.
- `src/routes/crm.ts:2392–2398` — Guard on empty `property_address` before geocoding.

---

## Phase 3 — LOW / Code-Quality

- `src/routes/lead-capture.ts:77–78` — Log JSON parse errors (don't silently return `{}`).
- `src/index.tsx:1924` — Google Maps embed key is public-by-design; add quota monitoring instead.
- `src/index.tsx:3048, 7146–7147` — Explicit `method` on all fetches; `{passive:true}` on all scroll/touch listeners.
- `src/index.tsx:146–148` — Warn in dev if `Secure` flag missing.
- `src/routes/email-outreach.ts:100–104` — Validate `offset` range (0…1e6) to prevent DoS.
- `src/routes/commissions.ts` — Wrap rule-edit audit entries in same helper as P1-24.
- `src/routes/invoices.math.test.ts:112–121` — Add cumulative rounding assertion: sum of 10,000 invoices equals expected to the cent.
- `src/services/roof-measurement-engine.ts` — Extract pitch table + interpolation to a pure module `pitch.ts` and add tests.

---

## Cross-cutting hardening (do once, applies everywhere)

1. **`src/utils/html-escape.ts`** — single source of truth for escaping.
2. **`src/utils/sql-safe.ts`** — `buildUpdate`, `buildInList` helpers; ESLint rule banning template literals inside `.prepare(`.
3. **`src/lib/password.ts`** — PBKDF2-SHA512/600k; legacy hash detection and auto-upgrade.
4. **`src/lib/csrf.ts`** — double-submit cookie; middleware applied to all `POST|PUT|DELETE|PATCH` under `/api/admin/*` and `/api/customer/*`.
5. **`src/lib/rate-limit.ts`** — KV-backed sliding window, keyed by IP + email + endpoint.
6. **`src/lib/audit-log.ts`** — single `logAdminAction({admin, action, target, before, after})` used by all admin mutations; backed by new table `admin_audit_log` (add migration).
7. **`src/utils/money.ts`** — cents-only math; ESLint rule banning `Number` arithmetic inside `routes/invoices.ts`, `services/pricing-engine.ts`, `routes/commissions.ts`.
8. **CSP header** — add to `index.tsx` response middleware: `default-src 'self'; script-src 'self' https://www.googletagmanager.com https://js.squareup.com https://js.stripe.com 'sha256-…inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; connect-src 'self' https://*.googleapis.com https://api.stripe.com https://connect.squareup.com https://…livekit…; frame-ancestors 'none';` — then stop using inline event handlers (fixes many XSS vectors by default).
9. **`Referrer-Policy: strict-origin-when-cross-origin`**, **`X-Content-Type-Options: nosniff`**, **`Permissions-Policy`**, **`Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`** — add to the root response middleware.
10. **Migration:** add `admin_audit_log`, `admin_tool_audit` tables, add `is_encrypted`, `password_hash_version` columns where referenced above.

---

## Verification checklist (run after each phase)

- [ ] `npx vitest run` — all tests green.
- [ ] `npm run build` — no new TypeScript errors.
- [ ] `npm run dev:sandbox` — manual smoke: admin login, customer login, submit lead form, view report, pay via Square sandbox.
- [ ] New tests: `html-escape.test.ts`, `password.test.ts`, `permissions.test.ts` (expanded), `roof-measurement-engine.test.ts`, `invoices.math.test.ts` (cumulative).
- [ ] Grep proves no regressions:
  - `grep -RnE "innerHTML\s*=\s*['\"].*\$\{" src/` → 0 matches
  - `grep -RnE "\.prepare\(\s*['\"\`].*\$\{" src/` → 0 matches
  - `grep -Rn "Math.random()" src/routes/ src/lib/` → 0 matches in auth paths
  - `grep -Rn "localStorage.setItem" src/index.tsx` → only consent-gated keys remain
  - `grep -RnE "(password\s*===|token\s*===|apiKey\s*===)" src/` → 0 matches
- [ ] Response headers on `/` and `/admin` include CSP, HSTS, X-CTO, Referrer-Policy.
- [ ] All admin routes return 403 for non-superadmin test user.
- [ ] Square webhook replay returns HTTP 200 with "already processed" and makes no DB writes.
- [ ] Dev account no longer authenticates in production environment.

---

## Scorecard

| Phase | Findings | Estimated effort |
|-------|----------|------------------|
| P0 Critical | 8 | 3–5 dev-days |
| P1 High | 34 | 8–12 dev-days |
| P2 Medium | 38 | 5–8 dev-days |
| P3 Low | 18 | 2–3 dev-days |
| Cross-cutting (CSP, money, audit, password lib, CSRF, rate-limit) | 10 | 4–6 dev-days |
| **Total** | **98 + 10** | **~22–34 dev-days** |

Begin at P0-01. Do not merge P1 work until every P0 item has a landed PR with tests.

# Roof Manager — Maximum Registration Funnel (v2, supersedes v1)

**Paste this entire file into Claude Code.** It supersedes `CLAUDE-CODE-UX-FUNNEL-IMPROVEMENTS.md`. The primary KPI is a single number: **% of homepage visitors who complete registration (email verified + 4 free reports activated)**. Every phase in this file is ordered by expected lift on that number.

You may skip to any phase, but do not skip **Phase 0** — without instrumentation, the rest is guesswork.

---

## Context (for Claude Code)

Hono SSR monolith on Cloudflare Pages/Workers. All marketing HTML is returned as strings from `src/index.tsx` (~15k lines). Auth lives in `src/routes/customer-auth.ts`. Widget (address → Solar API → pricing) lives in `src/routes/widget.ts`. Email service in `src/services/email.ts` supports Resend + Gmail OAuth2 + GCP SA.

**What already exists (do NOT rebuild):**
- `POST /api/customer-auth/register` — email/password registration with PBKDF2, 6-digit email verification, 30-day session tokens, grants 4 free trial reports.
- `POST /api/customer-auth/google` — full Google OAuth ID-token flow with audience check. Creates account, grants 4 free reports, auto-verifies email, generates referral code. **This is built but NOT surfaced in the current signup UI — most of the lift below comes from fixing that.**
- `GET /api/widget/public/config/:public_key` and `POST /api/widget/public/estimate` — address input + Solar API measurement + pricing. Used by embeddable contractor widgets.
- Exit-intent modal already redirects to `/register?email=<encoded_email>` (line ~6836 in `src/index.tsx`).
- Referral: `referred_by_code` accepted on signup (line ~633 in customer-auth.ts), `referral_code` auto-generated per customer (line ~629), `referral_earnings` table exists (migration 0057), but **no UI to share a code and no payout/reward logic**.
- DB has `onboarding_completed` and `onboarding_step` on the customers table (lines ~925–926 in customer-auth.ts), but no guided first-report wizard is wired up.
- Email service is plug-and-play via `sendViaResend` / `sendGmailOAuth2` in `src/services/email.ts`.

**What is missing (most lift):**
- Social-sign-in button on register/login pages (Google OAuth endpoint is live; the button is not).
- Password reset / forgot-password.
- Magic-link / passwordless sign-in option.
- Address-first hero ("value before signup").
- Abandoned-signup recovery (capture email on first blur, send recovery email).
- A/B framework, session recording (Clarity), dynamic headline by UTM.
- First-report activation wizard, referral share UI.
- Trust chrome near CTAs, live social proof toasts, mobile sticky bar, phone number in nav, embedded demo page, `/contact` page.

---

## Impact-ranked phase list (execute top-down)

| # | Phase | Expected registration lift | Effort | Risk |
|---|-------|----------------------------|--------|------|
| 0 | Funnel instrumentation (events + Clarity) | enables all measurement | S | low |
| 1 | Surface Google OAuth + `/register` page chrome-strip + multi-step form | 20–40% | M | low |
| 2 | Address-first hero (value-before-signup) | 30–80% on landing traffic | L | medium |
| 3 | Magic-link passwordless auth + password reset | 5–15% | M | low |
| 4 | Abandoned-signup recovery (email on blur + 60-min drip) | 5–15% of abandoners recovered | M | low |
| 5 | Post-registration activation wizard (first report in <5 min) | improves retention, not registration directly, but closes loop | M | low |
| 6 | Live social proof toasts + trust microcopy + mobile sticky CTA + phone in nav | 5–10% | S | low |
| 7 | `/contact` page + embedded `/demo` (no more off-domain Calendar) | recaptures mid-funnel; moves some to registration | M | low |
| 8 | Referral share UI + reward logic (viral coefficient) | compounding; 5–15% of new signups from referrals within 60 days | M | low |
| 9 | Lightweight A/B framework + dynamic headline by UTM/referrer | enables future compounding lifts | S | low |
| 10 | Exit-intent v2 (registration-focused, pre-fills `/register`) | 3–8% of exits recovered | S | low |
| 11 | Performance + a11y + schema + SEO for registration-intent keywords | SEO compounding | S | low |
| 12 | Verification + KPI dashboard + acceptance tests | mandatory before declaring done | S | low |

**Constraints that apply to every phase**
- Do not refactor unrelated code. Keep Hono SSR + Tailwind.
- Do not break existing URLs; add, don't replace.
- One commit per phase. Do not squash. Do not force push. Do not `git amend`.
- After each phase run `npm run build` and `npx vitest run`.

---

## PHASE 0 — Funnel instrumentation (you can't optimize what you can't measure)

**Deliverables**

1. **GA4 event contract.** Add or confirm these events fire with the exact names/params below. Put them in a single module `src/services/analytics-events.ts` exporting a `trackEvent(name, params)` helper that fires both `gtag('event', name, params)` and `rrTrack(name, params)`. Then replace ad-hoc `gtag`/`rrTrack` calls across the homepage, register, login, demo, pricing, and sample-report pages to route through this helper. Keep the existing event names that are already firing; add the missing ones:

   - `page_view_engaged` — fired once per session after 10s on page + any scroll.
   - `hero_cta_click` — params: `{variant: 'signup'|'demo'|'contact'|'sample'|'address_start'}`.
   - `address_entered` — fired when user completes the hero address input (Phase 2 dependency).
   - `preview_rendered` — fired when the hero satellite preview renders (Phase 2 dependency).
   - `signup_started` — fired on first keystroke in the registration form's email field.
   - `signup_field_complete` — params: `{field: 'email'|'password'|'name'|'company'|'phone'}`.
   - `signup_submit_attempt` / `signup_submit_error` (with `{reason}`) / `signup_submit_success`.
   - `verify_email_sent` / `verify_email_verified`.
   - `oauth_click` — params: `{provider: 'google'}`.
   - `oauth_success` / `oauth_error`.
   - `magic_link_requested` / `magic_link_clicked`.
   - `first_report_started` / `first_report_completed` (Phase 5).
   - `exit_intent_shown` / `exit_intent_submitted` (keep existing).

2. **Server-side Measurement Protocol fallback.** In `src/routes/customer-auth.ts`, on successful email/password registration and on successful Google OAuth account creation, call a new helper `trackServerEvent(env, 'sign_up', { method, user_id })` that posts to GA4's Measurement Protocol using a `GA4_API_SECRET` env var. This guarantees conversion fires even if the client gtag didn't load (ad blockers). Add `GA4_API_SECRET` to the list of required env vars in `CLAUDE.md`.

3. **Microsoft Clarity session recording.** Free, privacy-compliant (no PII by default). In the analytics middleware block in `src/index.tsx` (lines ~95–240, where GA4 is injected), add a Clarity snippet gated on a `CLARITY_PROJECT_ID` env var. Inject only on non-admin pages (the existing `isAdminSurface` guard). Mask any input with `data-clarity-mask="true"` — add that attribute to every password field and to any financial fields.

4. **GA4 funnel exploration spec.** Output (print in the final verification message, don't commit a file) the exact event sequence for the funnel: `page_view → page_view_engaged → hero_cta_click{variant:signup} → signup_started → signup_submit_success → verify_email_verified → first_report_started → first_report_completed`. Ethan will paste this into GA4 Explorations.

**Acceptance**
- Every event above fires exactly once per trigger (use `sessionStorage` dedupe for idempotent events like `page_view_engaged`).
- Registering a test account produces a `sign_up` hit in GA4 **Realtime** even with uBlock Origin enabled (server-side MP confirms this).
- Clarity records a session on `/` and `/register` and **masks** password fields.

---

## PHASE 1 — Surface Google OAuth, strip chrome from `/register`, multi-step form

This is the single biggest registration lever in the codebase today, because Google OAuth is already a live backend endpoint with no client button. Industry CRO norm: adding a visible "Continue with Google" button to a registration page lifts completion 20–40% on B2B tools.

**Deliverables**

1. **Standalone `/register` route** (v1 already scoped this; re-confirm and elevate):
   - Add `app.get('/register', ...)` rendering `getCustomerRegisterPageHTML()`.
   - The page must be **chrome-stripped**: no sticky top nav, no mega-menu, no footer links cluster. Keep only a minimal top bar with the logo (linking to `/`) and a single small "Already have an account? Log in" link on the right. Research on B2B SaaS conversion (ConvertKit, Calendly, Notion teardowns) consistently shows 5–15% lift from removing navigation distractions on the signup page.
   - Minimum viewport-height hero. Two-column on ≥md, single-column on <md.
   - **Left column (above the fold):**
     1. H1: "Start with 4 free roof reports"
     2. Sub: "No credit card. 60-second signup. Ready to measure in under 5 minutes."
     3. Large primary button: **"Continue with Google"** — renders the Google Identity Services button (script `https://accounts.google.com/gsi/client`, `g_id_onload` with `data-client_id` set to `GOOGLE_OAUTH_CLIENT_ID` env var, `data-callback` wired to a JS function that POSTs the credential to `/api/customer-auth/google` and on success redirects to `/onboarding` — see Phase 5). Fire `oauth_click` on button click, `oauth_success` on redirect.
     4. Divider: "or continue with email"
     5. Email-only field (name="email", type="email", autocomplete="email", `required`, `data-field="email"`). Single "Continue" button below it.
     6. Microcopy under field: `🔒 No credit card · 🇨🇦 Hosted in Canada · ⚡ Setup in 60 seconds` (use inline SVG icons).
   - **Right column (social proof and reassurance):**
     - Big stat card: "4 free reports, $0" with strikethrough "$32 value" in small text below.
     - Three testimonial cards rendered visibly (Mike D., Sarah K., James R. — reuse the constants already in JSON-LD; move them into a `TESTIMONIALS` export in `src/lib/testimonials.ts` so both JSON-LD and the cards read the same source).
     - Trust strip: "5,000+ contractors · 4.9/5 on 200+ reviews · PBKDF2-hashed passwords · Canadian data residency".
   - On <md, the right column renders below the form.

2. **Multi-step form** (even though the backend endpoint accepts all fields at once, the UI asks for them in sequence):
   - Step 1: Email only → on "Continue", client-side checks email format, fires `signup_field_complete{field:'email'}`, transitions to Step 2. Does NOT hit the backend yet.
   - Step 2: Password (with real-time strength meter and min-length 6 — match backend) + Name (full name) + optional Company. A single "Create account" button. On submit, POST all fields at once to `/api/customer-auth/register`. Fire `signup_submit_attempt` before, `signup_submit_success`/`signup_submit_error` after.
   - Progress indicator at top: "Step 1 of 2" → "Step 2 of 2". Back button between steps.
   - **Persist state to `localStorage.rr_signup_draft`** on every field blur (encrypted is overkill; just don't save the password). On page load, rehydrate. Clear on `signup_submit_success`.
   - On submit success, transition to Step 3 in-place (do not redirect yet): a 6-digit email verification input (matches the existing `/api/customer-auth/verify-email` flow). Pre-focus the first digit input, auto-advance on digit entry, auto-submit on 6th digit. "Resend code" link with 60s cooldown. On success, redirect to `/onboarding` (Phase 5).

3. **Repoint every existing "Sign Up" CTA** to `/register` (announcement bar, nav, hero primary, pricing "Free" plan, final CTA, footer "Get Started" column, exit-intent modal success redirect). Grep for `/signup`, `/customer/login?mode=signup` and update.

4. **The original `/customer/login` page stays** (existing customers), but the "Sign up" link on it now redirects to `/register` instead of flipping modes. Add a "Continue with Google" button there too (same handler).

5. **Add a prominent Google button on the login page** as well — many returning customers will have signed up with Google originally.

**Acceptance**
- Visiting `/register` renders the chrome-stripped, two-column page with a visible Google button.
- Clicking Google produces a successful OAuth round-trip and ends on `/onboarding?welcome=1` with a valid session cookie.
- Email flow: Step 1 → Step 2 → Step 3 (verify) → `/onboarding`. Draft state rehydrates after a hard refresh on Step 2.
- Abandoned email (Step 1 filled, Step 2 abandoned) is captured via Phase 4.
- Every analytics event from Phase 0 fires in the right order (verify in GA4 DebugView).

---

## PHASE 2 — Address-first hero (value before signup)

This is the second-biggest lever. Measurement-tool funnels like Hover, CompanyCam, EagleView all convert 1.5–3× better when visitors see their own roof on satellite **before** the registration wall. You already have the infrastructure (`/api/widget/public/estimate`) — it just needs a public front door.

**Deliverables**

1. **New endpoint** `POST /api/public/preview` in a new file `src/routes/public-preview.ts` (do not touch `widget.ts` — the widget requires a `public_key`, which is contractor-scoped and not appropriate for anonymous homepage traffic):
   - Input: `{ address: string, utm: {...} }`.
   - Resolves address via the existing Google Solar API wrapper in `src/services/solar-api.ts`.
   - Returns: `{ preview_id, lat, lng, footprint_m2, pitch_deg, segment_count, satellite_tile_url, estimated_area_sqft }`. Do **not** return the full measurement report; that's the registration gate.
   - Rate-limit per IP: 10/hour, 30/day (use Cloudflare KV or a simple in-memory LRU in worker — KV preferred for production). Return 429 on exceed.
   - Log to a new `preview_requests` table with IP, address, UTM, and `preview_id`. This becomes a retargeting list.

2. **Migration** `migrations/0042_preview_requests.sql`:
   ```sql
   CREATE TABLE IF NOT EXISTS preview_requests (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     preview_id TEXT NOT NULL UNIQUE,
     address TEXT NOT NULL,
     lat REAL,
     lng REAL,
     ip TEXT,
     user_agent TEXT,
     utm_source TEXT,
     utm_medium TEXT,
     utm_campaign TEXT,
     utm_content TEXT,
     converted_customer_id INTEGER,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX IF NOT EXISTS idx_preview_requests_created_at ON preview_requests(created_at DESC);
   CREATE INDEX IF NOT EXISTS idx_preview_requests_preview_id ON preview_requests(preview_id);
   ```
   (Bump the number to whatever's next in `migrations/`.)

3. **Hero redesign** in `getLandingPageHTML` (~line 5316 in `src/index.tsx`):
   - **Left column:**
     - H1 stays "Measure Any Roof. In 60 Seconds."
     - Sub stays as-is.
     - **New primary affordance: a single wide input "Enter a property address" with Google Places Autocomplete** (`@googlemaps/js-api-loader` or the existing Maps loader the codebase uses) and a primary green button "Measure this roof →".
     - Beneath, small text: "Free sample measurement. Register to download the full report."
     - Below the input, 3 smaller secondary links: `See sample report` / `Book a 20-min demo` / `Talk to us`.
   - **Right column (replaces the existing SVG animation):**
     - By default, shows an idle state with a placeholder satellite illustration and the text "Your roof preview will appear here."
     - After submit, shows the actual satellite tile with overlaid footprint polygons (use the existing geodesic rendering in `src/templates/diagrams/*` or a minimal SVG overlay), plus 3 stats: **Total area · Avg pitch · Segment count**. Below the preview, two stacked CTAs:
       1. Green primary: **"Create account to download the full report →"** linking to `/register?preview_id=<id>&email=` with the preview associated.
       2. Ghost: **"Book a demo instead"** linking to `/demo?preview_id=<id>`.
   - Fire `hero_cta_click{variant:'address_start'}` on submit, `address_entered` on Places selection, `preview_rendered` on preview draw.

4. **Wire the preview to registration.** When `/register` receives a `preview_id` query param, show a tiny banner above the form: "We saved your roof preview — complete signup to download the full report." On `signup_submit_success`, server-side update `preview_requests.converted_customer_id = new_id`. This gives the team attribution: "X% of address-first previews convert to registrations."

5. **Guard against Solar API cost runaway.** Cloudflare Workers KV rate limit per IP AND a daily global budget (read `SOLAR_API_DAILY_CAP` env var; default 500). If cap hit, degrade to a static placeholder + microcopy: "Free previews are rate-limited right now. Create an account for unlimited access." (This is also a conversion trick — scarcity.)

6. **Mobile.** On <md, the left column stacks above the right; the preview renders inline beneath the form. Ensure the preview SVG is responsive.

**Acceptance**
- On desktop, entering a Calgary or Houston address and clicking "Measure this roof" shows a satellite preview within ~3 seconds, with area/pitch/segments.
- Two CTAs appear; clicking the primary goes to `/register?preview_id=...` and the register page shows the banner.
- Rate limit at 11th request in an hour returns 429 + friendly UI state.
- `preview_requests` row is created per submission.
- On mobile, the whole flow works without horizontal scroll.

---

## PHASE 3 — Magic-link passwordless + password reset

Passwords are friction. ~20% of B2B signups that fail do so at the password step (weak password rules, typo-then-forgot-password loop). Offering magic-link as an option — and fixing the missing password-reset gap — removes a permanent hole.

**Deliverables**

1. **New endpoint** `POST /api/customer-auth/magic-link` in `src/routes/customer-auth.ts`:
   - Input: `{ email, referred_by_code? }`. If the email exists, send a sign-in link. If not, send a "create account" link.
   - Link format: `/auth/magic?token=<opaque>` with a 15-minute expiry, single-use.
   - Store tokens in a new `magic_link_tokens` table (migration 0043).
   - Send via `sendViaResend` or `sendGmailOAuth2` with a branded template. Subject: "Your Roof Manager sign-in link". Body: button "Sign in to Roof Manager" + microcopy "This link expires in 15 minutes".
   - Fire `magic_link_requested{email_hash}` (hash email to respect PII).

2. **New endpoint** `GET /auth/magic`:
   - Verify token, consume, create session cookie, redirect to `/onboarding?welcome=1` if account was just created (no password set), or `/customer/dashboard` otherwise.
   - Fire `magic_link_clicked`.

3. **Password reset:**
   - `POST /api/customer-auth/forgot-password` with `{email}` — same token/email mechanism, but the emailed link goes to `/auth/reset?token=...`.
   - `GET /auth/reset?token=...` renders a small chrome-stripped page with "New password" + "Confirm password" fields; on submit POSTs to `POST /api/customer-auth/reset-password` which validates token, hashes new password (PBKDF2 same as existing), consumes token, logs the user in, redirects to dashboard.
   - Add a "Forgot your password?" link to `/customer/login` under the password field.

4. **UI integration in `/register`:**
   - Under the Google button, add a second outline button: **"Email me a sign-in link"** (only if the user is on Step 1 with email already filled; otherwise show inline after email).
   - On `/customer/login`, add "Send me a magic link instead" as a tertiary link.

**Acceptance**
- Requesting a magic link results in an email arriving within 30s and a successful passwordless sign-in.
- Forgot-password end-to-end works and logs the user in after reset.
- Tokens are single-use; replaying a used token returns a friendly error page.

---

## PHASE 4 — Abandoned-signup recovery

Most abandoners are at Step 2 (password) with a valid email already captured. Recovering even 10% of them is meaningful.

**Deliverables**

1. **Capture email on first blur** of Step 1's email input (client-side), POST to `POST /api/customer-auth/signup-started`:
   - Body: `{email, utm, preview_id?}`.
   - Insert into a new `signup_attempts` table (migration 0044): `id, email, utm_*, preview_id, created_at, recovered (0/1), completed (0/1)`.
   - Fire a server-side GA4 event `signup_started` via Measurement Protocol.

2. **Cron job for recovery email.** Add to `src/routes/cron-worker.ts` (or wherever existing crons live — check `ecosystem.config.cjs`): runs every 15 minutes. Finds rows in `signup_attempts` where `created_at` between 60 and 75 minutes ago, `completed=0`, `recovered=0`, and the same email does NOT have a row in `customers`. For each, send a recovery email via `sendViaResend`:
   - Subject: "You left 4 free reports on the table"
   - Body: "Hi — you started creating a Roof Manager account earlier. Your 4 free reports are still waiting. [Complete signup →] (link to `/register?email=<urlencoded>&resume=1`)"
   - Mark `recovered=1` to avoid duplicates.
3. **On `/register?resume=1`**, pre-fill email, skip Step 1, jump to Step 2. Fire `signup_resumed` event.

4. **On `signup_submit_success`**, mark the matching `signup_attempts.completed=1`.

5. **Unsubscribe** — every recovery email must have a List-Unsubscribe header and a one-click unsubscribe link. Add a minimal `signup_recovery_optouts` table.

**Acceptance**
- Starting signup and abandoning for 65+ minutes results in a recovery email in the test inbox.
- Clicking the link returns the user to Step 2 with email pre-filled.
- Completing registration from a recovery link logs a `signup_resumed_conversion` event and marks the attempt as completed.

---

## PHASE 5 — Post-registration activation wizard (first report in <5 min)

The registration KPI is "4 free reports **activated**". A new account that never orders a report is almost worthless. This wizard makes the first report a 3-click outcome.

**Deliverables**

1. **New route** `app.get('/onboarding', ...)` — only accessible to authenticated customers with `onboarding_completed = 0`. Otherwise redirect to `/customer/dashboard`.

2. **Three-step wizard UI:**
   - Step 1 — "Measure your first roof": address input (Google Places Autocomplete). If the signup came from a `preview_id`, this is pre-filled. On submit, server reuses the preview if present, otherwise calls Solar API. Shows the satellite + footprint overlay.
   - Step 2 — "Confirm the roof" — user clicks the correct building on the satellite if multiple candidates. On confirm, server creates a draft `orders` row using the existing `orders` table and routes.
   - Step 3 — "Generate report" — a progress bar for ~30s while the real report runs. On completion, show a "Download PDF" button and a secondary "Invite a coworker" (Phase 8).

3. **Update the customer-auth backend:** on successful first report completion, set `onboarding_completed=1`, `onboarding_step=3` on the customers row. Fire `first_report_completed` event (both client and server-side).

4. **If the customer skips**, keep a persistent yellow banner on the dashboard: "👋 Finish onboarding — generate your first free report →" linking back to `/onboarding`. Add a dismiss button that only hides for 24 hours (stored in a `customer_ui_state` row).

**Acceptance**
- A fresh registration lands on `/onboarding`, completes the 3 steps, and ends on the dashboard with 3 remaining free reports and `onboarding_completed=1`.
- Dismissing the wizard and returning 24h+ later shows the banner again.

---

## PHASE 6 — Chrome improvements carried over from v1, trimmed and prioritized

These are smaller individual lifts but collectively matter.

**Deliverables**

1. **Top nav:** add a visible phone link (`tel:+1...`) on ≥md right side, add a `Contact` menu item, and replace the single "4 Free Reports →" button with two buttons: ghost `[Book Demo]` and filled `[Get 4 Free Reports]`. Track `nav_book_demo` and `nav_signup`.
2. **Mobile sticky CTA bar** for <md: two buttons "Book Demo" + "Start Free". Hide when the hero is in view (IntersectionObserver). Show one impression event per session (`sessionStorage` dedupe). Not shown on `/register`, `/onboarding`, any `/customer/*` authenticated route, or `/admin*`.
3. **Trust microcopy under the hero primary CTA**: `🔒 No credit card · 🇨🇦 Hosted in Canada · ⚡ 60-sec signup`. Use SVG icons, not emoji, if you want to be safe.
4. **Live social-proof toasts** (bottom-left, 3s each, dismiss on click, shown max 3 per session, 12s apart): "Mike in Calgary just started a report", "Sarah in Austin registered", etc. Populate from a `public_activity_stream` view (or a simple endpoint returning synthetic-but-true aggregate events — e.g. pull the last 50 rows from `customers` where `created_at > now()-24h`, strip names to first + city, skip if privacy-flagged; if fewer than 3 rows, fall back to a rotating set of hand-picked real testimonials from `TESTIMONIALS`). Gate behind a `SOCIAL_PROOF_ENABLED` env var so you can turn it off.
5. **Visible testimonials section on homepage** between "How It Works" and pricing. Read from the `TESTIMONIALS` constant (Phase 1) so JSON-LD and UI stay in sync.

**Acceptance**
- Nav shows phone + dual CTAs on desktop, mobile menu includes Contact, phone is click-to-call.
- Mobile sticky bar appears on scroll past hero, hides in hero, fires one impression event per session.
- Social proof toasts throttle correctly and never show the same message twice in a session.

---

## PHASE 7 — `/contact` page + embedded `/demo`

Same as v1 Phases 1 and 2, condensed. Carry over in full — the demo off-domain handoff is attribution suicide and the missing `/contact` is a basic trust failure.

- `/contact` page with real form posting to new `POST /api/contact/lead` → `contact_leads` table → `notifySalesNewLead` → redirect to `/contact/thank-you` (noindex) + GA4 conversion.
- `/demo` gets a two-column layout: qualifying form on the left (posts to existing `/api/demo/lead`), Google Calendar **iframe embedded** on the right (same link already in the codebase). After form submit, reveal the iframe with a confirmation banner. No more external redirects.
- Both pages include a registration upsell at the bottom: "Not ready to talk? Try it free — no credit card required → [Get 4 Free Reports]".

**Acceptance**
- `/contact` and `/contact/thank-you` live; `/api/contact/lead` validates and writes to DB.
- `/demo` never redirects off-domain.
- Both pages render a registration CTA below the fold.

---

## PHASE 8 — Referral share UI + reward logic

The `referred_by_code` plumbing and the `referral_earnings` table already exist. Wire up the last mile so customers actually share.

**Deliverables**

1. **Share widget on the customer dashboard** (and as the final screen of Phase 5's onboarding wizard): a card with the customer's `referral_code`, a share URL (`https://www.roofmanager.ca/r/<code>`), copy-to-clipboard, and pre-filled share buttons for Email, SMS (use `sms:` URL), WhatsApp, LinkedIn.
2. **Public referral landing** `app.get('/r/:code', ...)` — sets a `rr_ref` cookie with the code (30-day expiry), redirects to `/register?ref=<code>`. `/register` reads either the cookie or query param and inserts as `referred_by_code` on submit.
3. **Reward logic:**
   - On every completed paid order by a referred customer, insert a row in `referral_earnings` with `commission_earned = order_total * 0.10` (or read the rate from the existing table default).
   - Also: give 2 bonus free reports to the referrer the first time a referred customer's email is verified (fast gratification > delayed commission for most users). Add columns `bonus_reports_granted` to `referral_earnings` and `bonus_reports_total`, `bonus_reports_used` to `customers` if not present.
   - On order request, consume from `free_trial_used` first, then from `bonus_reports_used`, then paid credits.
4. **Dashboard stats:** show the referrer "You've referred X, Y signed up, Z generated a report, $W earned". Link to a full earnings page with payout history.
5. **Email trigger:** when a referred customer verifies email, send the referrer a notification: "🎉 Lisa just joined via your link — 2 bonus reports added to your account."

**Acceptance**
- Generating a share URL from the dashboard and signing up through `/r/<code>` links the accounts.
- On referred email verification, the referrer has +2 bonus reports and received the notification email.
- Admin dashboard has a view of top referrers.

---

## PHASE 9 — Lightweight A/B + dynamic headline by UTM

**Deliverables**

1. **Minimal A/B helper** in `src/lib/ab.ts`:
   - `getVariant(test_id: string, variants: string[]): string` — reads/writes a single `rr_ab` cookie (`{test_id}={variant}|{test_id2}={variant2}|...`), deterministic per visitor by hashing `visitor_id + test_id` modulo variant count on first exposure, sticky thereafter.
   - `trackExposure(test_id, variant)` — fires `ab_exposure{test, variant}` once per session.
2. **Initial tests** (register these via a central `src/lib/ab-registry.ts`):
   - `hero_h1` — A: current "Measure Any Roof. In 60 Seconds." / B: "The All-in-One Roofing CRM + Measurement Reports" / C: "4 Free Roof Reports. No Card. 60 Seconds."
   - `hero_cta_primary` — A: "Get 4 FREE Reports — No Card Required" / B: "Start Free — 4 Reports on Us" / C: "Measure a Roof in 60 Seconds →"
   - `announcement_bar` — A: current copy → `/register` / B: "Book a free 20-min demo" → `/demo` (v1 already proposed this; use the new framework).
3. **Dynamic headline by UTM source** — if `?utm_source=google&utm_term=xactimate` (or campaign name matches `xactimate`), override the H1 to "Xactimate-ready roof measurements in 60 seconds". Keep the logic in a single `getHeroHeadline(url: URL): string` helper with a small dictionary of `{campaign_keyword: headline}`. Always record which override was shown via `hero_override{source, term}`.
4. **Exposure fires before any click** — fire `ab_exposure` inside `getLandingPageHTML` so even bounces count toward the denominator.

**Acceptance**
- Clearing cookies and hard-reloading 10 times distributes visitors roughly evenly across variants.
- Once assigned, a visitor sees the same variant for 30 days.
- `ab_exposure` fires exactly once per session per test.

---

## PHASE 10 — Exit-intent v2 (registration-focused)

**Deliverables**

1. Redesign the existing exit-intent modal (line ~6800s in `src/index.tsx`). Instead of leading with "Get the sample report", lead with: **"Wait — get 4 free reports in 60 seconds. No credit card."** Primary CTA: Google button (same handler as Phase 1). Secondary: email-only input that pre-populates `/register?email=<x>` on submit.
2. Cap exposure: max 1 per session, suppressed if the user is already on `/register`, `/customer/*`, or `/admin*`. Fire `exit_intent_shown` / `exit_intent_dismissed` / `exit_intent_google_click` / `exit_intent_email_submit`.
3. Add a gentler desktop delay: only show after 20s on page AND at least 30% scroll AND no prior CTA click this session (currently shows on first mouseleave).
4. Mobile trigger: keep the existing 45s + 50% scroll; additionally suppress if the user has filled any input on the page.

**Acceptance**
- Exit-intent fires in the right conditions, never on `/register`, and clicking Google completes OAuth without losing context.

---

## PHASE 11 — Performance, a11y, SEO for registration-intent keywords

**Deliverables**

1. All new pages pass axe-core with zero critical issues. Labels on every input. Landmarks (`<main>`, `<nav>`, `<footer>`, `<section aria-labelledby>`). 4.5:1 contrast on all CTAs. Keyboard-navigable modals with focus trapping.
2. Preload the Solar API + Places script on the homepage (`<link rel="preconnect">` + `<link rel="dns-prefetch">` for `maps.googleapis.com`, `accounts.google.com`, `www.google-analytics.com`, `www.clarity.ms`).
3. Inline the critical CSS for the above-the-fold hero; defer the rest.
4. Schema.org updates:
   - `SoftwareApplication` JSON-LD on `/` with `aggregateRating`, `offers` (free tier), `operatingSystem: "Web"`.
   - `BreadcrumbList` on `/register`, `/contact`, `/demo`, `/pricing`.
   - `FAQPage` ensure it's already present (it is, per v1 audit).
5. Meta titles + descriptions optimized for registration-intent keywords:
   - `/` title: "Roof Manager — Free Roof Measurement Reports, CRM & Solar Tools"
   - `/register` title: "Create Your Free Roof Manager Account — 4 Free Reports"
   - `/pricing` title: "Roof Manager Pricing — Start Free, Pay As You Go"
   - Description templates with the 4-free-reports hook and the "no credit card" reassurance.
6. Open Graph + Twitter cards on `/`, `/register`, `/pricing`, `/contact`, `/demo` with a 1200×630 image that includes the H1 and "4 Free Reports" badge. Generate once, save to `public/static/og/`.

**Acceptance**
- Lighthouse mobile score ≥ 90 for Performance, Accessibility, Best Practices, SEO on `/` and `/register`.
- axe-core: zero critical issues on both pages.
- View-source confirms the schema blocks render.

---

## PHASE 12 — Verification + KPI dashboard + acceptance tests

**Deliverables**

1. **Unit + integration tests:**
   - `src/routes/lead-capture.test.ts` — contact_leads validation.
   - `src/routes/customer-auth.test.ts` — magic link, password reset, Google OAuth audience check, signup_attempts flow.
   - `src/routes/public-preview.test.ts` — rate-limit behaviour.
2. **End-to-end smoke script** (Node/tsx): walk `/` → enter address → preview renders → click "Create account" → `/register` prefilled → Google OAuth stub → `/onboarding` → complete wizard. Expose as `npm run smoke`.
3. **KPI checklist to print in final message** — list all the events from Phase 0, note which GA4 funnel step each maps to, and provide Ethan with a ready-to-paste GA4 Exploration config (JSON or a step-by-step).
4. **Final summary printout:** diff stats (`git diff --stat main...HEAD`), per-phase commit SHAs, `npm run build` output tail, `npx vitest run` tail, a bullet list of env vars Ethan must set in Cloudflare before deploy:
   - `GOOGLE_OAUTH_CLIENT_ID` (if not already set)
   - `GA4_API_SECRET` (server-side MP)
   - `CLARITY_PROJECT_ID`
   - `SOLAR_API_DAILY_CAP` (numeric; default 500)
   - `SOCIAL_PROOF_ENABLED` (true/false)
   - `RECOVERY_EMAIL_ENABLED` (true/false)
5. **Deploy plan:** list in order the Cloudflare D1 migrations to run, then `npm run deploy:prod`. Flag any env var that, if missing, causes a silent degrade (e.g., no Clarity snippet, no server-side MP conversion, no recovery emails).

**Acceptance**
- `npm run build` clean.
- `npx vitest run` green.
- `npm run smoke` green.
- Verification checklist printed as the final message with ☑ per item.

---

## Global non-goals (explicit)

- No new frontend framework. SSR HTML only.
- No chat widget in this pass (separate vendor + privacy review).
- No paid A/B tools (Optimizely, VWO) — the Phase 9 helper is sufficient.
- No change to pricing, product copy beyond what's explicitly specified, or the measurement engine.
- No changes to `/admin`, `/super-admin`, or any staff surface.
- No `--no-verify` on commits. No `--force` pushes. No amending commits across phases.

---

## One more thing

After all phases, print a **one-paragraph plain-English summary for Ethan** of exactly what a user now experiences, start to finish, when they arrive from a Google Ad for "xactimate roof measurement report" — the specific H1 they see, the primary CTA, what happens if they enter an address, what registration looks like, what happens after, and the event fires Ethan can observe in GA4 Realtime.

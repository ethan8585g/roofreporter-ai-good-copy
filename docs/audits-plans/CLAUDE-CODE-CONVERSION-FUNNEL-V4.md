# Roof Manager — Conversion Funnel v4
## Diagnosis + precision implementation prompt for Claude Code

> Paste this entire file into Claude Code in the project root.
> It supersedes v2 and v3 where they conflict.
> The single primary KPI is: **% of homepage visitors at www.roofmanager.ca who complete registration AND order their first report within the same session.**
> Secondary KPI: **% of registered users who order a 2nd report within 14 days.**

---

## PART A — Diagnosis: why we are getting traffic but not signups

You (Claude Code) are walking into a project where SEO and ad traffic is hitting `www.roofmanager.ca` but the "4 free measurement reports" offer is not converting. Before you write a single line of code, internalise the diagnosis below — every phase in Part C is a direct response to one of these failures.

### A1. The free offer is not the message — it is buried.

The hero promises a measurement product, not a free trial. The "4 free reports" line is reduced to a small trust-strip microcopy item beside "No credit card." A first-time visitor scanning for 4 seconds does not see the offer. **A free offer that the visitor never reads cannot convert.**

### A2. The signup buttons take visitors to the wrong page.

Most "Get Started / Sign Up Free / Start Free Trial" CTAs in `src/index.tsx` still point to `/customer/login` (a login form with a tiny "switch to signup" toggle) instead of `/register` (the well-designed two-column page with social proof, Google OAuth, and trust strip). v3 listed the offending lines and the bug was only partially fixed. **A visitor who clicks "Sign up free" and lands on a login page bounces.**

### A3. The Google "Continue with Google" button is invisible.

The backend at `src/routes/customer-auth.ts:454` is a complete Google Identity Services flow — auto-creates accounts, auto-verifies email, grants 4 free reports. The frontend either does not render the button at all, or renders it conditionally on an env var that is not always set. Industry baseline lift from a visible Google OAuth button on a B2B SaaS register page is **+25–40% on completion rate.** We are leaving that lift on the table.

### A4. After signup, the user lands on a broken page.

Both the email/password signup handler and the Google OAuth callback redirect to `/onboarding?welcome=1`. The route exists in `src/index.tsx` but renders effectively nothing. The new user — who just trusted us with their email — sees a blank or 404-style page as their first impression. This is the single highest-leverage fix in the document. **Activation = first report ordered. No activation, no retention, no referrals, no paying customer.**

### A5. The hero "Measure this roof" preview is silently broken.

`<input id="hero-address">` and the "Measure this roof" button exist in the hero, but the `startPreview()` JS handler is not defined in the inline script block. Click does nothing. **A wow-moment that fails is worse than no wow-moment** — visitors interpret a dead button as "this product is broken."

### A6. There is no abandoned-signup recovery.

`/api/customer-auth/signup-started` is called on email-field blur and creates a row in the DB, but no cron, no email, and no resume link ever fires. We are capturing leads and throwing them away. Industry baseline recovery rate on a 60-minute drip is **8–15% of abandoners.**

### A7. Social proof is on the register page but not on the homepage.

Three testimonial cards (Mike D., Sarah K., James R.) live in the right-hand sidebar of `/register`. The homepage has the same content in JSON-LD only — invisible to humans. **Visitors who never see proof of other roofers using the product never trust it enough to give us their email.**

### A8. The phone number is `(XXX) XXX-XXXX`.

Header, footer, and `/contact` page show a placeholder. Roofing buyers — many of whom are 45–65-year-old contractors — call before they buy. A fake phone number is read as "this company isn't real." **Trust signal: zero. Cost to fix: 30 seconds.**

### A9. There is no funnel instrumentation.

GA4 is loaded but events are ad-hoc `rrTrack()` calls scattered through `src/index.tsx`. There is no `signup_field_complete`, no `preview_rendered`, no `oauth_success`, no `first_report_completed`. **We cannot tell which step of the funnel is bleeding because we are not measuring the steps.** Microsoft Clarity (free, GDPR-compliant session recording) is not installed.

### A10. The mental model is wrong.

The current homepage sells "the most accurate roofing measurement tool." Roofing buyers do not search for "accurate measurement tool" — they search for "how much will my roof cost," "free roof measurement," and "who can give me a roof report fast." The hero does not name the visitor's problem in the visitor's words. **We are selling a drill when the customer wants a hole.**

### TL;DR of the diagnosis

We are running a "free 4 reports" promotion behind a locked door. The door's handle is broken (A2), the doorbell rings into a void (A6), the lobby is empty (A4), the receptionist has a fake phone (A8), and the welcome sign promises something the visitor wasn't shopping for (A10). Fixing the lock and the lobby, in that order, is the entire job.

---

## PART B — Current state verified 2026-04-19

The codebase is at `/sessions/brave-wizardly-gates/mnt/roofreporter-ai-good-copy/` (or wherever Claude Code is running). `src/index.tsx` is 16,948 lines — a monolithic Hono router that serves both the marketing site and the API. The homepage is rendered inline in this file.

**Confirmed live (do NOT rebuild):**
- `GET /register` at `src/index.tsx` ~line 601, rendering `getCustomerRegisterPageHTML()` ~line 7331. Two-column layout, multi-step form, sidebar testimonials, trust strip.
- `GET /contact` + `POST /api/contact/lead` (migration 0129).
- `GET /demo` with embedded Google Calendar iframe.
- Mobile sticky CTA bar (IntersectionObserver + sessionStorage throttle).
- `POST /api/customer-auth/signup-started` — captures email on blur into DB.
- `POST /api/customer-auth/google` at `src/routes/customer-auth.ts:454` — full Google ID-token flow, auto-grants 4 free reports.
- `POST /api/public/preview` route exists but the homepage handler that calls it is missing.
- GA4 snippet injected in `<head>`.
- JSON-LD testimonials on the homepage (~line 5886).

**Confirmed broken (fix in this prompt):**
- Phone number is `(XXX) XXX-XXXX` everywhere (`src/index.tsx` ~5767 and ~6098).
- Signup CTAs on the pricing section and final-CTA blocks point to `/customer/login` not `/register`. Suspected lines per v3: `1597, 1635, 1746, 1823, 6475, 6512, 6836, 7224, 10536, 10597, 10675, 10698, 10719, 10736, 10752, 10780, 11283, 11429, 11557, 15250, 15386, 15427`. Verify each before changing.
- Google OAuth button not rendered (or rendered behind unset env var) on `/register`.
- `startPreview()` referenced in homepage hero JS but not defined.
- `GET /onboarding` route exists but renders empty / 404.
- No cron for abandoned-signup recovery.
- No `src/services/analytics-events.ts`.
- No Clarity snippet.
- Testimonials missing from homepage (visible HTML only — JSON-LD doesn't count).

**Next migration file is `0131_*`.** The `0129_*` and `0130_*` migrations are taken.

---

## PART C — Implementation plan (phases, in priority order)

### Constraints that apply to every phase

1. Do not refactor unrelated code. Only touch what each phase specifies.
2. Do not change any URL that already works. Add, do not replace.
3. **One commit per phase. No squashing. No `--no-verify`. No force pushes. No `git commit --amend`.** Commit messages must follow the pattern `funnel-v4 phase N: <short description>`.
4. After every phase: `npm run build` must pass and `npx vitest run` must be green. If a phase introduces a new util, add a vitest file for it.
5. Use inline `style="..."` for one-off color values. Do not use arbitrary Tailwind classes like `bg-[#111]` — those will not appear in the compiled CSS.
6. No new third-party JS dependencies without an explicit justification in the commit body. We are on Cloudflare Workers — every kB matters.
7. Every new event you add to GA4 must also be added to `src/services/analytics-events.ts` (created in Phase 2) so we have one source of truth.
8. Every copy change must be readable by a 9th-grade roofing contractor. Strunk-and-White voice. No "leverage," no "synergy," no "powered by AI."
9. Where a phase says "ask Ethan," leave a `TODO(Ethan):` comment inline. Do not invent values.

---

### PHASE 0 — Stop the bleeding (ship within 1 hour, single commit)

Goal: nothing in this phase is glamorous. Every bullet is a blocker that is silently destroying the funnel right now.

**0A. Repoint signup CTAs to `/register`.**

In `src/index.tsx`, find every anchor or button whose **visible text** is one of: "Get Started Free", "Get 3 Free Reports", "Get 4 Free Reports", "Start Free", "Start Free Trial", "Sign Up Free", "Try It Free", "Start Measuring", "Claim My 4 Free Reports". For each one:
- If `href` is `/customer/login` or `/customer/login?mode=signup` or `/signup`, change it to `/register`.
- If the visible text is "Login", "Sign In", "Customer Login", or "Log In", **leave it alone.**
- After the change, search for any remaining `href="/signup"` and `href="/customer/login?mode=signup"` and report each in the commit body so Ethan can audit.

**0B. Replace placeholder phone with a real number — or leave a loud TODO.**

In `src/index.tsx` ~line 5767 and ~6098, the phone number is `(XXX) XXX-XXXX` and `tel:+1XXXXXXXXXX`. Do not invent a number. Replace with:
```
{/* TODO(Ethan): replace with real sales phone before deploy. Current placeholder will tank trust. */}
<a href="tel:+1XXXXXXXXXX" style="...">(XXX) XXX-XXXX</a>
```
Then add a hard `console.warn` in `src/index.tsx` at the top of the homepage handler that logs `"WARNING: sales phone is still a placeholder"` whenever the page is rendered in production. This makes it impossible to deploy without noticing.

**0C. Make the "4 free reports" offer the headline.**

In the hero (`src/index.tsx` ~line 6160), the current H1 sells "the most accurate measurement tool." Replace the H1 + sub-H1 with copy that puts the offer first. Use this exact copy unless Ethan has overridden it:

> H1: **Get 4 free roof reports — in under 5 minutes.**
> Sub: Property-grade measurements, slope, area, and material take-off. No credit card. No call. Cancel any time.
> CTA button: **Claim My 4 Free Reports →**

The CTA button must be a single-color, high-contrast block (e.g. `style="background:#ff5a1f;color:#fff;font-weight:700;padding:18px 32px;border-radius:8px;font-size:18px;"`). Sub-CTA text directly below in 12px grey: "No credit card. Takes 60 seconds."

**0D. Add visible testimonials to the homepage.**

The three testimonial cards already exist on `/register` (`src/index.tsx` ~line 7906). Extract them to a shared constant (e.g. `const HOMEPAGE_TESTIMONIALS` near the top of the file), then render them as a 3-column section between "How It Works" and pricing. On mobile, stack to 1 column. Each card: photo placeholder (initials in a coloured circle), name, role, company, 5-star row, quote in plain text. **No carousel.** Carousels reduce conversion on mobile.

**0E. Verify the Google OAuth button renders on `/register`.**

The handler exists. In `getCustomerRegisterPageHTML()` (~line 7331), there is conditional logic around `googleClientId`. Check:
- Is `GOOGLE_CLIENT_ID` set in `wrangler.jsonc` `vars` for production? If not, leave a `TODO(Ethan):` comment in `wrangler.jsonc` asking Ethan to set it.
- The button must render unconditionally above the email field, with the standard Google branding (white background, grey border, "G" logo, "Continue with Google" text). Use the official Google Identity Services script.
- Below the Google button, render a divider: a horizontal line with the word **"or"** in the centre.

**Acceptance for Phase 0:**
- `git diff` touches no more than ~80 lines.
- `npm run build` passes, `npx vitest run` is green.
- Every signup CTA on the homepage and pricing section now points to `/register`.
- The hero H1 mentions "4 free reports" within the first 12 words.
- A first-load homepage screenshot (mobile + desktop) shows: visible testimonials, no `(XXX) XXX-XXXX`, the CTA labelled "Claim My 4 Free Reports".

---

### PHASE 1 — Fix `/onboarding` so signed-up users actually activate

This phase is the single highest-leverage change in the document. Every signed-up user lands here. If they don't get a working report in this session, they are gone forever.

**1A. Build the activation wizard.**

Create `src/routes/onboarding.ts`. Mount it in `src/index.tsx` so `GET /onboarding` and `POST /api/onboarding/*` route through this module instead of being inline. The wizard is exactly 3 steps, server-rendered, no SPA, no React.

**Step 1 — "Where is the property?"**
- Single input: address autocomplete (Google Places). Optional second input: "Job nickname (optional)."
- Below the input, a 1-line reassurance: "We'll use this to pull a satellite view. We never share your address."
- Skip link: "I want to look around first" → goes to dashboard with a yellow banner: "Your 4 free reports are waiting. Order one any time."

**Step 2 — "Confirm the roof we found."**
- Server fetches Google Solar `buildingInsights` for the address (use `src/services/solar-api.ts`).
- Renders a square satellite tile with the detected roof outline overlaid (use the existing SVG overlay code from `src/templates/`).
- Two buttons: **"Yes, that's the roof"** (continues) and **"Not quite — let me draw it"** (links to the existing measurement tool with `?from=onboarding`).

**Step 3 — "Generating your first report…"**
- Loading state with 4 sequential check-ticks: "Pulling satellite data ✓", "Computing slope and area ✓", "Calculating material take-off ✓", "Building your PDF ✓". Use a server-sent event stream or simple polling — your call, but it must feel like real work is happening.
- On completion: redirect to `/customer/reports/{id}` with a confetti animation (one-shot, not looping) and a single CTA: **"Order your next free report"** which links back to `/onboarding?step=1`.

**1B. Decrement the free-report counter only on successful PDF generation.**

In whatever table tracks `free_reports_remaining` for a customer (likely `customers` or `customer_companies`), do NOT decrement on signup. Only decrement when a report PDF is successfully generated and emailed. This protects against failed reports counting against the trial.

**1C. Send a "your first report is ready" email.**

Trigger from the existing `src/services/email.ts`. Subject: `"Your roof report for {address} is ready"`. Body: 4 lines. CTA button to view the PDF. Foot mention: "You have 3 free reports left."

**Acceptance for Phase 1:**
- A brand-new test user can sign up via Google OAuth, complete the wizard, and receive a real PDF in their inbox in under 5 minutes.
- The free-reports counter shows `3 left` after the first report.
- vitest covers the counter-decrement logic and the email trigger.
- Manual mobile test: every wizard step renders cleanly on a 375px-wide viewport with no horizontal scroll.

---

### PHASE 2 — Funnel instrumentation (you cannot fix what you cannot measure)

**2A. Create `src/services/analytics-events.ts`.**

Export a single `trackEvent(name, props)` function. It must:
- Push to GA4 via `gtag('event', name, props)` if `window.gtag` exists.
- Mirror the event to a server-side endpoint `POST /api/track` (create it) which forwards to GA4 via the Measurement Protocol. This guarantees the event fires even if the user has an ad blocker.
- Sample 100% of signup-funnel events; sample 10% of low-value events (page views).

**2B. Define the canonical event list.**

Add these and only these events. No ad-hoc strings elsewhere in the codebase.

```
homepage_view
hero_cta_click          {position: 'hero'|'mid'|'final'|'sticky'}
preview_address_entered {has_value: boolean}
preview_rendered        {success: boolean, ms: number}
register_view           {referrer_path: string}
register_email_blur     {has_value: boolean}        // already partially exists
register_oauth_click
register_oauth_success
register_password_submit
register_complete       {method: 'password'|'google'}
onboarding_step_view    {step: 1|2|3}
onboarding_step_complete {step: 1|2|3}
first_report_generated  {ms_since_signup: number}
free_reports_remaining_decremented {remaining: number}
```

**2C. Wire each event in the appropriate handler.** No event may fire from more than one place.

**2D. Install Microsoft Clarity.**

Inject the Clarity snippet in `<head>` of every public page, gated on `CLARITY_PROJECT_ID` env var. Mask password and address inputs with `data-clarity-mask="true"`. Add the env var to `wrangler.jsonc` with a `TODO(Ethan):` to fill in the project ID.

**Acceptance for Phase 2:**
- Open GA4 DebugView. Walk through homepage → register → onboarding → first report. Every event in 2B fires exactly once in the right order.
- Clarity dashboard shows recorded sessions with masked sensitive fields.
- A vitest unit test asserts that `trackEvent` no-ops cleanly when `gtag` is undefined.

---

### PHASE 3 — Fix the hero address preview ("the wow moment")

**3A. Implement the `startPreview()` function.**

In the inline `<script>` block for the homepage, define `startPreview()`. It must:
1. Read the value of `#hero-address`.
2. If empty, focus the input and shake it (CSS keyframe).
3. Call `POST /api/public/preview` with `{address}`. Show a 2-second loading state on the button.
4. On success: render a satellite tile in a `#hero-preview` container directly below the input, with the roof outline drawn over it and three stats: **Total area, Pitch, Estimated material cost.** Below the stats, a single CTA: **"Get the full report — free →"** which links to `/register?preview_id={id}` so the register page can resume the address.
5. Fire `preview_rendered` analytics event.
6. On error: show a small "We couldn't find that address — try again" message in red below the input. Do not reload the page.

**3B. On `/register?preview_id=...`, prepopulate the address field and skip step 1 of `/onboarding` after signup.**

Pass the `preview_id` through the registration POST and store it on the customer row. The wizard reads it and goes straight to step 2.

**3C. Fallback for browsers with JS disabled.**

The "Measure this roof" button must be a real `<form action="/register" method="get">` so the address is preserved even without JS. Wrap the preview JS in a progressive-enhancement check.

**Acceptance for Phase 3:**
- Type a real Canadian address into the hero input, click the button, and see a satellite preview with stats inside 3 seconds on a fresh load.
- Clicking the CTA on the preview lands you on `/register` with the address already filled in.
- Disable JS in DevTools — the button still works (form-based fallback).
- `preview_rendered` event fires in GA4 DebugView.

---

### PHASE 4 — Abandoned-signup recovery

**4A. Add a cron worker.**

Create `src/cron/abandoned-signup-recovery.ts`. Schedule it every 30 minutes via `wrangler-cron.jsonc`. The worker:
1. Selects rows from the `signup_started` table where `created_at` is between 60 and 90 minutes ago AND there is no matching completed `customers` row for that email AND no recovery email has been sent.
2. Sends an email via `src/services/email.ts` with subject `"You're 60 seconds from your first free roof report"`.
3. Body: 3 sentences. CTA: `https://www.roofmanager.ca/register?resume={token}`.
4. Marks the row as `recovery_email_sent_at = NOW()`.

**4B. Implement `/register?resume={token}`.**

Token expires in 7 days. When valid, prefill the email and skip directly to the password field with focus. Fire `register_view` with `referrer_path: 'recovery_email'`.

**4C. Suppress recovery for users who unsubscribe.**

Add `?unsub={token}` link in the footer. Honor it on a `POST /api/email/unsubscribe`.

**Acceptance for Phase 4:**
- Manually insert a row 65 minutes old via `wrangler d1 execute`. Run the cron locally. Confirm one email is sent.
- The resume link works and lands on the password field with email prefilled.
- Re-running the cron does NOT send a second email for the same row.

---

### PHASE 5 — Audience-clarity copy pass

The current homepage copy talks about the product. The new copy talks about the visitor's job. Ethan to confirm before merging — leave the v4 copy in a feature flag.

**5A. Section-by-section rewrite (target voice: 9th-grade reading level, second person).**

Above the fold:
- H1: **Get 4 free roof reports — in under 5 minutes.** (already set in Phase 0C)
- Sub: Insurance-grade measurements, slope, area, material take-off. Drop a pin, get a PDF. No credit card.

"How it works" — three cards, no jargon:
1. **Drop a pin.** Type any North American address.
2. **We measure the roof.** Satellite + AI does the math in seconds.
3. **You get a PDF.** Pitch, area, materials, cost estimate.

"Who it's for" — three cards (insert directly above pricing):
- **Roofing contractors** — quote a job before you drive to the site.
- **Insurance adjusters** — get an objective number you can defend.
- **Homeowners** — know what your roof actually costs before the call.

Pricing — keep but rewrite the free-tier card as the visual focal point (1.2× size, "MOST POPULAR" tag, orange border):
- **Free** — 4 reports / month. Full PDF. No credit card.
- **Pro** — Unlimited reports. CRM. Voice receptionist. $X/mo.
- **Team** — Multiple seats. Branded reports. White-label PDFs. $X/mo.

(Leave the Pro/Team prices as `TODO(Ethan):` if they aren't already set.)

**5B. Add an FAQ section** (collapsed by default, opens on click — pure HTML `<details>` element, no JS):
1. "Do I need a credit card?" → No. Ever.
2. "How long does a report take?" → Under 60 seconds.
3. "Is it accurate enough for insurance?" → Yes. We use Google Solar API + custom geometry engine. Spec sheet available on request.
4. "What happens after my 4 free reports?" → You can keep using the free tier next month, or upgrade. We never auto-charge.
5. "Do you cover my city?" → All of Canada and the US.

**Acceptance for Phase 5:**
- Run a 5-second test on a non-roofer friend: "Tell me what this site does and what I get for free." If they cannot answer both in 5 seconds, the copy fails.

---

### PHASE 6 — Mobile cleanup (do this last, but it matters)

**6A. Hero responsiveness.**

The hero satellite SVG (~line 6234) has hardcoded `viewBox="0 0 400 240"` with no responsive wrapper. Wrap in `<div style="max-width:100%;overflow:hidden;">` and set the SVG to `width:100%;height:auto;`.

**6B. Mobile exit-intent.**

Current exit-intent listens to `mouseleave` on `document` — never fires on touch. Add a second trigger: 50% scroll depth + 30 seconds on page + once-per-session via `sessionStorage`. Show a modal: "Wait — your 4 free reports are still waiting. Want us to email them to you?" Single field: email. Submit calls `/api/customer-auth/signup-started` and shows a thank-you state.

**6C. Tap targets.**

Audit every `<a>` and `<button>` in the homepage and register page. Anything below 44×44 px on mobile gets padding added. Nav menu links specifically.

**6D. Inline form-field validation on `/register`.**

Currently a generic "please fill in all required fields" error shows on submit. Replace with field-level: each invalid field gets a red border, an inline error below it, and the first invalid field is `.focus()`'d and `scrollIntoView({block:'center'})`'d.

**Acceptance for Phase 6:**
- Lighthouse mobile score ≥ 85 for performance, ≥ 95 for accessibility on the homepage and `/register`.
- No horizontal scroll at 320px width.
- Real iPhone test (Ethan) — every tap target is comfortable.

---

## PART D — What NOT to do

- Do not add a chatbot. Roofing contractors hate them.
- Do not add a video autoplay in the hero. Mobile data + bounce.
- Do not gate the pricing page behind email capture.
- Do not add "Sign in with Apple" or "Sign in with Microsoft" — Google is enough for now.
- Do not add a cookie banner unless legally required — they reduce conversion ~3%.
- Do not refactor the routes/services structure. The monolithic `src/index.tsx` is what it is; add to it surgically.
- Do not rename anything — analytics events, route paths, env vars — without grepping the entire codebase first.

---

## PART E — Order of operations and how to commit

```
Phase 0 → commit "funnel-v4 phase 0: stop the bleeding"
Phase 1 → commit "funnel-v4 phase 1: onboarding wizard + first-report activation"
Phase 2 → commit "funnel-v4 phase 2: analytics events + Clarity"
Phase 3 → commit "funnel-v4 phase 3: hero address preview"
Phase 4 → commit "funnel-v4 phase 4: abandoned-signup recovery cron"
Phase 5 → commit "funnel-v4 phase 5: copy rewrite + FAQ"
Phase 6 → commit "funnel-v4 phase 6: mobile cleanup"
```

After every commit:
- `npm run build`
- `npx vitest run`
- `npm run dev:sandbox` and manually walk the funnel end-to-end (homepage → register → onboarding → first PDF) on both desktop and a 375px mobile emulation.
- Push to a preview branch, NOT main, until Ethan has eyes on it.

---

## PART F — Verification checklist (run before declaring "done")

- [ ] Type `(XXX) XXX-XXXX` into the codebase grep — zero results.
- [ ] Click every signup CTA on the homepage and pricing section — every one lands on `/register`.
- [ ] Sign up with a fresh Gmail via Google OAuth. End-to-end time from clicking the hero CTA to receiving a real PDF email: under 5 minutes.
- [ ] Sign up with email + password. Same test. Under 5 minutes.
- [ ] Abandon signup at the password step. Wait 65 minutes. Confirm the recovery email arrives.
- [ ] Open the homepage on a 375px viewport. Scroll the entire page. No horizontal scroll, no clipped CTAs, every tap target ≥ 44px.
- [ ] GA4 DebugView shows every event in 2B firing exactly once for one user journey.
- [ ] Clarity has a recorded session with the password field masked.
- [ ] Lighthouse mobile: performance ≥ 85, accessibility ≥ 95, SEO ≥ 95.
- [ ] Run `git log --oneline` — exactly 7 commits, each prefixed `funnel-v4 phase N:`.

---

## PART G — KPIs to watch in the 14 days after deploy

| Metric | Baseline (today) | 14-day target |
|---|---|---|
| Homepage → register conversion | <0.5% | ≥ 2.5% |
| Register → first-report-completed | <10% | ≥ 60% |
| 14-day return rate (2nd report) | unknown | ≥ 25% |
| Avg time from signup → first PDF | n/a | ≤ 5 min |
| Abandoned-signup recovery rate | 0% | ≥ 8% |
| Mobile bounce rate on homepage | unknown | drop ≥ 15% |

If any of these miss after 14 days, do not blame the code — blame the diagnosis. Re-read Part A and find the assumption that was wrong.

---

## PART H — Questions for Ethan to answer before Phase 0 starts

1. What is the real sales phone number?
2. Is `GOOGLE_CLIENT_ID` set in `wrangler.jsonc` production vars? If not, set it.
3. Is there an existing Microsoft Clarity project? If yes, paste the ID. If no, sign up at clarity.microsoft.com (free, 5 min).
4. What are the real Pro and Team prices?
5. Approve the new H1 copy: "Get 4 free roof reports — in under 5 minutes." — yes / propose alternative?
6. Do we have permission to use the names Mike D., Sarah K., James R. as visible testimonials, or do we need to swap to real customer names with real photos?

Leave each answer inline at the top of this file under a new "Answers" heading before Claude Code starts work.

---

End of prompt. Begin with Phase 0.

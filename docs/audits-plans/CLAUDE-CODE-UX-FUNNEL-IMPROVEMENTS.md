# Roof Manager — UX & Lead Funnel Improvements

**Paste this entire file into Claude Code in your repo root.** It's a ready-to-run prompt with baked-in context, exact file/line targets, acceptance criteria, and a verification checklist. You can run it as one pass or copy each phase separately.

---

## Context (for Claude Code)

You are working in the Roof Manager monorepo (Hono on Cloudflare Pages/Workers). All landing-page HTML is rendered as SSR strings from `src/index.tsx` (~15k lines). The marketing homepage is built by `getLandingPageHTML()` at **~line 5017**, and the root route is at **~line 576**. Analytics is wired through GA4 (`gtag`) and a custom `rrTrack()` helper loaded from `/static/tracker.js`. Lead capture lives in `src/routes/lead-capture.ts`.

**Do not refactor unrelated code. Do not introduce new frameworks.** Keep everything as SSR HTML strings returned from Hono handlers and keep styling in Tailwind utility classes. Preserve existing route names, JSON-LD, and analytics events; only add new ones.

---

## Audit findings (what's good vs. what's broken)

**Working well today**
- Strong hero: "Measure Any Roof. In 60 Seconds." with 4-free-reports offer.
- Sticky nav with mobile hamburger, product tour, pricing, FAQ, footer.
- GA4 + Google Ads conversion + `rrTrack()` wired to CTAs and forms.
- Demo lead endpoint `POST /api/demo/lead` and signup redirect `/signup → /customer/login?mode=signup` already exist.

**Gaps hurting conversion**
1. **No `/contact` page.** Footer only has `mailto:sales@roofmanager.ca`. Prospects who aren't ready to sign up or book a demo have nowhere to go, and there's zero analytics on contact intent.
2. **`/demo` dumps users into an external Google Calendar link.** Funnel breaks — you lose UTM attribution, no confirmation page, no retargeting pixel fire, and trust drops when the user leaves the domain.
3. **Nav has only one primary CTA ("4 Free Reports").** No secondary "Book Demo" button, so prospects who want a conversation first aren't funneled.
4. **No visible phone number in the header** — major trust signal missing for B2B roofing/contractor buyers.
5. **Hero has 2 CTAs, neither is "Book a Demo."** Mid-funnel prospects drop off.
6. **Testimonials exist only in JSON-LD (SEO),** not rendered visibly on the page.
7. **Register path is a mode-toggle on the login page** (`/customer/login?mode=signup`), not a standalone `/register` route with a proper social-proof sidebar. Friction + weaker analytics.
8. **No sticky mobile bottom CTA bar.** On mobile, once users scroll past the hero the CTA disappears.
9. **Final CTA section captures email only** — no secondary "Book Demo" path.
10. **No trust microcopy near CTAs** (no card, 60-sec signup, SOC-style badges).
11. **No exit-intent secondary offer on mobile** (exit-intent only works on desktop mouse-leave today).
12. **Announcement bar and pricing-plan free CTAs all point to the same destination** — no A/B variant split for measurement.

---

## Scope — phases, in order

Do these as separate commits. Do not combine. After each phase run `npm run build` to verify.

---

### PHASE 1 — Ship a dedicated `/contact` page with a real form

**Why:** Fill the biggest funnel hole. Every B2B buyer expects a Contact Us page.

**Tasks**

1. In `src/routes/lead-capture.ts`, add a new endpoint:
   - `POST /api/contact/lead`
   - Body schema (validate with zod if already used in the file; otherwise plain validation): `{ name: string (required, 2-80), email: string (required, valid email), phone?: string, company?: string, employees?: '1-5'|'6-25'|'26-100'|'100+', interest: 'measurements'|'crm'|'solar'|'pricing'|'api'|'other', message: string (required, 10-2000), utm_source?, utm_medium?, utm_campaign?, utm_content? }`
   - Insert into a new table `contact_leads` (create migration — see Phase 1b).
   - Call `notifySalesNewLead(c.env, { source: 'contact_form', ...fields })`.
   - Return `{ success: true }`.

2. **Phase 1b — Migration.** Add a new file `migrations/0041_contact_leads.sql` (auto-increment the number based on current highest migration in `migrations/`):
   ```sql
   CREATE TABLE IF NOT EXISTS contact_leads (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     email TEXT NOT NULL,
     phone TEXT,
     company TEXT,
     employees TEXT,
     interest TEXT,
     message TEXT NOT NULL,
     utm_source TEXT,
     utm_medium TEXT,
     utm_campaign TEXT,
     utm_content TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   );
   CREATE INDEX IF NOT EXISTS idx_contact_leads_created_at ON contact_leads(created_at DESC);
   CREATE INDEX IF NOT EXISTS idx_contact_leads_email ON contact_leads(email);
   ```

3. In `src/index.tsx`, register a new route `app.get('/contact', ...)` that serves `getContactPageHTML()`. Page layout:
   - Reuse the existing sticky nav and footer (call the same helper functions the homepage uses — do NOT copy-paste the nav markup; extract to a helper if needed).
   - Hero band: `<h1>Talk to a roofing software specialist</h1>` with sub "Real humans, usually reply within 2 business hours. We'll match you to the right plan, no pushy sales."
   - Two-column layout: left = form (Name, Work Email, Phone optional, Company, Company Size select, What are you interested in? select [Measurement reports, CRM & Invoicing, Solar design, Pricing & plans, API access, Other], Message textarea), right = sidebar with:
     - Phone link: `tel:+1-XXX-XXX-XXXX` (use the same number displayed in the new nav — see Phase 3; add a `TODO(Ethan): confirm sales phone number` comment).
     - Email link: `mailto:sales@roofmanager.ca`
     - Business hours: "Mon–Fri, 7am–6pm MT"
     - Response SLA: "Average first reply: 1h 42m"
     - Three mini-testimonials (pull the same names already in the JSON-LD: Mike D., Sarah K., James R.)
   - Below the form, a 3-up trust strip: "4.9/5 from 200+ reviews · 5,000+ contractors US & CA · No credit card to start".
   - Submit flow: capture UTM params from the URL on page load (read `location.search`, save to hidden fields), POST to `/api/contact/lead`, on success redirect to `/contact/thank-you?ref=contact`. Fire `rrTrack('lead_capture', { source: 'contact_form', interest })` and `gtag('event', 'generate_lead', { form: 'contact', value: 1 })` before redirect.

4. Add a simple thank-you route: `app.get('/contact/thank-you', ...)` with copy "Got it. We'll be in touch — usually within 2 business hours." A button back to `/` and another to `/pricing`. Fire a `gtag('event','conversion',{send_to:'AW-18080319225/contact_form_submitted'})` on page load. Include `<meta name="robots" content="noindex">`.

5. Footer: replace the current `mailto:sales@roofmanager.ca` link under Resources with an internal link to `/contact` (keep the email visible in the bottom bar for directness).

**Acceptance criteria**
- `GET /contact` returns 200 with the full page.
- `POST /api/contact/lead` with a valid body inserts a row and returns `{success:true}`; with an invalid body returns 400 and a descriptive error.
- Submitting the form redirects to `/contact/thank-you` and fires both `rrTrack` and `gtag` events (verify in devtools Network panel).
- Mobile layout: form stacks above sidebar; sticky nav still works.
- `npm run build` succeeds with no new TS errors.

---

### PHASE 2 — Replace the external Google Calendar demo with an embedded, tracked booking page

**Why:** Stop the funnel bleed. Keep prospects on-domain, capture attribution, fire conversion pixels.

**Tasks**

1. In `src/index.tsx`, rename the existing `/demo` route to `getDemoPageHTML()` v2 (don't break the URL — keep `app.get('/demo', ...)` and `/demo-portal`). Layout:
   - Reuse nav + footer.
   - Hero: `<h1>See Roof Manager live — in 20 minutes</h1>` with sub "Walk through measurements, CRM, invoicing, and the AI secretary on a real roof you pick. No slides."
   - Two-column: left = qualifying form (same fields as `/api/demo/lead` already accepts), right = an `<iframe>` of the Google Calendar booking page (`https://calendar.app.google/KNLFST4CNxViPPN3A` — use the existing link already referenced in the codebase). Iframe height 700px, full width, `loading="lazy"`, `title="Book a demo"`.
   - **Flow:** User submits the left form first → on success, keep them on page, reveal the iframe with a green confirmation banner ("You're in. Pick a time below."), scroll to it, and fire `rrTrack('lead_capture', { source: 'demo_portal', step: 'form_submit' })` and `gtag('event','generate_lead',{form:'demo'})`. If they book, Google will send a calendar invite — also show a static "What happens next?" checklist beneath the iframe.
   - Above-the-fold trust strip: "Free 20-min call · No slides · Bring a real address · Recording + notes sent after".
   - Add a 3-logo/name row (use the 3 existing testimonial authors from JSON-LD).

2. Add a thank-you fallback route `app.get('/demo/booked', ...)` that Google Calendar can redirect to if you control the redirect URL on the booking page. Fire `gtag('event','conversion',{send_to:'AW-18080319225/demo_booked'})` on load. Noindex.

3. Update the **final CTA section** on the homepage (inside `getLandingPageHTML`, the block that posts to `/api/agents/leads`) to show two side-by-side buttons instead of one: `[Start Free]` (existing) + `[Book a 20-min Demo]` (new) linking to `/demo`. Track separately: `rrTrack('cta_click',{location:'final_cta',variant:'start_free'})` vs `{variant:'book_demo'}`.

**Acceptance criteria**
- `/demo` loads the new two-column layout on desktop, stacks on mobile.
- Form submits to `/api/demo/lead` (no change to endpoint) and reveals the calendar iframe without a page reload.
- Both CTAs in the final homepage section track as separate events.
- No regression in `/demo-portal`.

---

### PHASE 3 — Upgrade the nav and hero to a three-CTA funnel

**Why:** Give every visitor a path matching their readiness: buyer-ready → Sign Up, consider-ready → Book Demo, curious → Contact.

**Tasks**

1. **Top nav** (in `getLandingPageHTML`, nav block ~lines 5260–5310):
   - Add a visible phone link on the **right side** of the nav on md+ screens: `<a href="tel:+1XXXXXXXXXX" class="hidden md:inline-flex items-center gap-1 text-sm ..."><PhoneIcon/> (XXX) XXX-XXXX</a>`. Mark with `TODO(Ethan): set real sales phone`.
   - Add `Contact` link to the main menu after `FAQ`.
   - Replace the single "4 Free Reports →" button with a two-button group: ghost/outline `[Book a Demo]` linking to `/demo`, filled primary `[Get 4 Free Reports]` linking to `/signup`. Track as `nav_book_demo` and `nav_signup` respectively.
   - Add `Contact` to the mobile menu panel (the one toggled by `document.getElementById('mobile-menu').classList.toggle('hidden')`).

2. **Hero** (~lines 5316–5451):
   - Keep the current primary button `[Get 4 FREE Reports — No Card Required]`.
   - Change the secondary `[See Sample Report]` into a **three-way mini-row directly under the primary CTA**:
     - `See sample report` → `/sample-report`
     - `Book a 20-min demo` → `/demo`
     - `Talk to us` → `/contact`
     Render these as small inline text links with arrow icons, not big buttons — keeps the primary CTA dominant but gives the three choices. Track each with `rrTrack('cta_click',{location:'hero_tertiary',variant:'<name>'})`.
   - Add a trust microcopy line under the primary CTA: `🔒 No credit card · 🇨🇦 Hosted in Canada · ⚡ 60-sec signup` (use inline SVGs, not emoji, if brand guidelines forbid emoji — there's no project rule against them that I found, but check `tailwind.input.css` for your icon system).

3. **Sticky mobile CTA bar.** Add a new bottom-fixed bar visible only on `<md` breakpoints containing two buttons: `[Book Demo]` and `[Start Free]`. Hide it on scroll up within the hero (IntersectionObserver on the hero section) to avoid double-CTA overlap. Appears on every page except authenticated routes. Track impressions once per session: `rrTrack('sticky_cta_shown',{page: location.pathname})`.

**Acceptance criteria**
- Desktop nav shows phone + two CTAs; mobile hamburger menu lists Contact.
- Hero primary CTA remains visually dominant; the 3 secondary text links all route correctly and fire distinct events.
- Mobile sticky bar appears on scroll past hero, hides inside hero, fires one impression event per session (use `sessionStorage` to dedupe).
- Lighthouse mobile score doesn't drop more than 3 points vs. baseline.

---

### PHASE 4 — Make Register a first-class page (not a mode toggle)

**Why:** Cleaner analytics funnel, lower friction, better SEO, easier to A/B.

**Tasks**

1. Add `app.get('/register', ...)` serving `getCustomerRegisterPageHTML()`. Do **not** remove `/customer/login?mode=signup` (backward compat). Update `/signup` redirect (line ~591) to point to `/register` instead of `/customer/login?mode=signup`.

2. Page layout:
   - Two-column: left = form (Full name, Work email, Password with strength meter, Company name, optional Phone, checkbox "I agree to the Terms and Privacy"), right = social-proof sidebar (a large "4 Free Reports, $0" card, the three testimonials visibly rendered with avatars/initials, and a list of included features).
   - Form posts to the **existing** customer auth endpoint that `/customer/login?mode=signup` already uses. Do not create a new auth endpoint — just a new view.
   - On success, redirect to `/customer/dashboard?welcome=1` (existing dashboard should handle a `welcome=1` query param to show a one-time onboarding modal — add that handling in the dashboard page only if trivial; otherwise just redirect plain and file a TODO).
   - Fire `rrTrack('lead_capture',{source:'register'})` and `gtag('event','sign_up',{method:'email'})` before redirect.

3. Ensure all signup CTAs across the site (announcement bar, nav, hero, pricing Free plan, final CTA, footer) now point to `/register`. Keep the logged-in/out detection unchanged.

**Acceptance criteria**
- `/register` renders the new page and posts to the same backend as before.
- Every previous "Sign Up" CTA now points to `/register` directly (grep for `/signup` and `/customer/login?mode=signup` to verify).
- Existing customers using the old `/customer/login` URL for sign-in still work (login mode untouched).
- A new event `sign_up` fires in GA4 Realtime when you test-register.

---

### PHASE 5 — Measurement, trust, and A/B hooks

**Why:** Convert the improvements into compounding learnings.

**Tasks**

1. **Testimonials, visible.** In `getLandingPageHTML`, add a testimonial section between the "How It Works" section and the pricing section. Render the same three testimonials currently buried in JSON-LD (Mike D., Sarah K., James R.) as cards with avatar initials, 5-star rows, role + company, and a short quote. Keep the JSON-LD block unchanged.

2. **Trust strip, above-the-fold.** Add a thin row immediately under the hero primary CTA (above "How It Works") showing: "Trusted by 5,000+ contractors · 4.9/5 on 200+ reviews · SOC-style security · Canada & US coverage". Style as small muted text with dividers.

3. **A/B variant on the announcement bar.** Today the announcement bar points everyone to `/signup`. Split 50/50 client-side (use a sticky `localStorage.rr_ab_announcement` key with value `A` or `B`):
   - A: existing — "4 FREE Roof Reports on every new account" → `/register`
   - B: new — "Book a free 20-min demo — see it on your own address" → `/demo`
   Fire `rrTrack('ab_exposure',{test:'announcement_bar',variant})` on first render.

4. **Exit intent on mobile.** Today exit intent relies on mouse-leave. Add a time-on-page + scroll-depth trigger for mobile: if the user is on `<md` breakpoint, has been on the page ≥45s, has scrolled past 50% of the document, and has not clicked a primary CTA, show the existing exit-intent modal once per session. Use the existing `rrTrack('exit_intent_shown')` and `_submit` events; add a dimension `{trigger: 'mobile_engagement'}`.

5. **FAQ → schema.** Ensure the FAQ section also emits FAQPage JSON-LD so Google can surface it. If it already does, skip.

**Acceptance criteria**
- Testimonials render visibly and match the JSON-LD content (keep sources of truth aligned — ideally, extract a `TESTIMONIALS` constant at the top of `getLandingPageHTML` and use it for both JSON-LD and the rendered cards).
- Trust strip renders on desktop and mobile.
- A/B cookie persists, variants render, exposure events fire.
- Mobile exit intent fires under the stated conditions and only once per session.

---

### PHASE 6 — Performance, accessibility, and final verification

**Why:** A funnel only works if the page loads fast, renders correctly, and passes a11y.

**Tasks**

1. All new inputs must have explicit `<label for>` (or `aria-label` for the search-style single-input blocks). All new buttons must have accessible names. All CTA buttons must meet ≥4.5:1 contrast on their backgrounds (the existing `#00FF88` on dark works; re-check on white sections).

2. All new sections must have semantic landmarks (`<section aria-labelledby>`, `<main>` wrapping the page content, `<nav aria-label="primary">`, `<footer>`).

3. Lazy-load any new images with `loading="lazy"` and `decoding="async"`. The demo iframe should be `loading="lazy"`.

4. Run:
   - `npm run build`
   - `npx vitest run` — must stay green. If new tests are quick to add for `/api/contact/lead` validation, add them under `src/routes/lead-capture.test.ts` (file may need to be created).
   - Manual smoke: `npm run dev:sandbox` → visit `/`, `/contact`, `/demo`, `/register`, `/pricing`, submit each form once, verify redirects and events in devtools Network and GA4 DebugView.

5. **Final verification checklist — produce a written report at the end:**
   - [ ] `/contact` page live, form submits, thank-you renders.
   - [ ] `/demo` has embedded calendar + form, no external redirect.
   - [ ] Nav shows phone + Book Demo + Sign Up; Contact link present (desktop + mobile).
   - [ ] Hero has 3 tertiary text links; trust microcopy under primary CTA.
   - [ ] Mobile sticky CTA bar behaves correctly.
   - [ ] `/register` is a standalone page; all signup CTAs point there.
   - [ ] Testimonials render visibly on homepage.
   - [ ] A/B announcement bar exposes two variants.
   - [ ] Mobile exit-intent triggers under spec.
   - [ ] `npm run build` clean; `npx vitest run` green.
   - [ ] Screenshot the new homepage at 390px (mobile) and 1440px (desktop) and save to `docs/ux-funnel-after/`.

---

## Commit discipline

One focused commit per phase, with messages in this form:

```
UX: ship /contact page + /api/contact/lead (phase 1)
UX: embed demo calendar on-domain (phase 2)
UX: tri-CTA nav, hero microcopy, mobile sticky bar (phase 3)
UX: standalone /register page (phase 4)
UX: visible testimonials + trust strip + A/B announcement (phase 5)
UX: a11y, perf, and verification (phase 6)
```

Do NOT squash. Do NOT `git push --force`. Do NOT amend prior commits.

---

## Non-goals (explicitly skip)

- Don't redesign the logo, color palette, or typography.
- Don't migrate off SSR / Hono / Tailwind.
- Don't add a chat widget in this pass (that's a separate decision — it requires a vendor and a privacy review).
- Don't change pricing, product copy around features, or the measurement engine.
- Don't touch `/admin`, `/super-admin`, or any authenticated CRM surface.

---

## When you're done

Print the verification checklist as a final message with each item checked ☑ or ☐, the diff stats (`git diff --stat main...HEAD`), and the GA4 event names you wired up so Ethan can build funnels in GA4.

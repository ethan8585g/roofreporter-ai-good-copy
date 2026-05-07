# Roof Manager — Google Ads Conversion Audit

**Date:** 2026-05-03
**Scope:** What changes to the web frontend will increase contractor (B2B) signups from Google Ads spend.
**Method:** Code walkthrough of the live repo + browser inspection of the live site at https://www.roofmanager.ca.

---

## TL;DR — Ship these three things this week

1. **Wire up Google Ads conversion labels for `lead`, `demo`, and `purchase`.** Today only `signup` is live. Smart Bidding has almost nothing to optimize on, so CPA stays high regardless of how good the page is. *(P0 #2 below — a 30-minute change in the Google Ads UI + one redeploy.)*
2. **Fix the broken homepage header.** At any browser viewport between ~768 px and ~1100 px (i.e. half of laptop traffic and all tablet traffic) the logo subtitle wraps into 4 lines and overlaps the desktop nav, and the Log In button is clipped. Live screenshot proves this. Anyone landing from a Google Ad and seeing that thinks the site is broken. *(P0 #1.)*
3. **Send Google Ads traffic to `/lander`, not `/`.** A dedicated, focused landing page already exists (`getLanderFunnelHTML()`, `src/index.tsx:2881`), with a clean header, one offer, two CTAs, and ~1/4 the page length. The homepage is 20,083 px tall with 17 H2 sections — that's a brochure, not a paid-traffic landing page. *(P0 #3.)*

These three alone will likely move signup-per-click conversion 30–80 % in two weeks because the first two are pure-bug fixes and the third drops cognitive load by an order of magnitude.

---

## P0 — Conversion Blockers

### P0-1. The homepage header is visibly broken at common viewport widths

**Where:** `src/index.tsx:7205-7257` — the `<nav id="landing-nav">` block.

**What's happening:** The nav row contains 10 desktop items (How It Works, Tutorials, Features dropdown, Pricing, Blog, Coverage, FAQ, Contact, Log In, Start Free) plus a logo whose subtitle "CRM & Reports for Roofing & Solar Companies" is shown from `sm:block` upward (`src/index.tsx:7211`). Between the `sm` breakpoint (640 px) and roughly 1100 px there is not enough horizontal room — the subtitle wraps to 4 lines and Z-overlaps the first nav links, while the Log In button gets clipped at the right edge.

**Verified live:** The screenshot of `https://www.roofmanager.ca/` at ~794 px viewport shows "Roof Manager" stacked over "Manager", "How It Works" colliding with the subtitle, and the Log In button cut off as "Log…".

**Why this matters for Google Ads:** First-impression damage is brutal on paid traffic. A non-trivial share of laptop visitors browse with non-maximized windows in the 800–1100 px range, and every iPad-class tablet sits dead-center in the broken zone. These users formed the visual judgment "this looks broken" before they read a single word.

**Fix:**
- Drop the subtitle on the homepage. The page H1 already says "The Roof Measurement Report Platform Roofers Actually Trust" — the nav subtitle is redundant on the very page it appears on. Change `hidden sm:block` to `hidden xl:block` at line 7211, or remove it entirely on `/`.
- Cut at least 3 nav items (the dropdown is fine, but Coverage, FAQ, Contact, and Blog can move to the footer or into the Features dropdown). Today every paid visitor sees 10 nav items competing with the hero CTA.
- Bump the desktop nav breakpoint from `md:flex` (768 px) to `lg:flex` (1024 px) at line 7216 so the mobile/hamburger nav covers the danger zone instead of half-rendering the desktop one.

---

### P0-2. Google Ads cannot optimize what it can't measure

**Where:** `src/index.tsx:272-278`.

```js
window.GOOGLE_ADS_CONVERSIONS = {
  lead:         'AW-18080319225/XXX_LEAD_LABEL',         // hero CTAs, exit-intent, gated content
  contact_lead: 'AW-18080319225/XXX_CONTACT_LABEL',      // contact form submission
  demo:         'AW-18080319225/XXX_DEMO_LABEL',         // demo booked
  signup:       'AW-18080319225/26MMCMOgxaYcEPmNr61D',   // account created (LIVE)
  purchase:     'AW-18080319225/XXX_PURCHASE_LABEL'      // paid checkout success
};
```

Four of the five conversion labels are placeholders. The helper at line 344 (`window.trackAdsConversion`) silently no-ops when it sees `XXX_`, so every CTA across the site fires zero data to Google Ads except the bottom-funnel `signup`.

**Why this is the highest-leverage single change in the audit:** Google Ads' Maximize Conversions, Target CPA, and Target ROAS bidding strategies all need ≥30 conversions per 30 days at a campaign level to learn. With only `signup` firing, a slow-rolling free-trial signup is the *only* signal — so the algorithm has thin data, makes wide bid swings, and overpays for clicks that never convert. Wiring up the upper-funnel `lead` event (hero CTA click, address-preview started, exit-intent email captured) gives the bidder a dense, fast feedback loop, lets you import "Lead" as a *secondary* conversion in the campaign, and typically cuts CPA 20–40 % within 2 weeks of accumulated data.

**Fix:**
1. In Google Ads → Tools → Conversions, create four new Conversion actions: Lead, Contact Lead, Demo Booked, Purchase.
2. Copy the conversion labels (`AW-18080319225/...`) into the four placeholders above.
3. Set Lead and Contact Lead to "Secondary" action type with low values ($5 CAD lead, $25 CAD contact); set Signup as Primary; set Purchase as Primary with dynamic value.
4. Redeploy. Verify with Google Tag Assistant by clicking the hero "Start free" CTA on `/` — the existing inline handler at line 7304 already calls `trackAdsConversion('lead', {value:5, currency:'CAD'})`.

The rest of the conversion plumbing is solid (gclid persistence, enhanced conversions with SHA-256 user-data, Square purchase on return URL). Just turn it on.

---

### P0-3. Send Google Ads traffic to `/lander`, not `/`

**Where:** `/lander` route at `src/index.tsx:2881`, served by `getLanderFunnelHTML()`. Today the homepage gets the paid traffic by default (Google Ads' "Final URL" is almost always the apex domain unless changed).

**Live observation:** I loaded `/lander` and `/`. The `/lander` page has:
- A clean header with no overlap bug.
- One bold dual-CTA pair ("Claim Your 4 Free Reports" + "Book a Demo").
- A focused "What's in every $8 report" feature block.
- Three testimonials, then conversion CTA.

The homepage by contrast reports back from the live DOM as `docHeight: 20083 px, h2Count: 17, formCount: 5, inputCount: 11`. That is a marketing-site homepage, not a landing page. Every paid landing-page best practice (single offer, single CTA, ~1 page of length, minimal nav) is violated.

**Why this matters:** Pure attention math. On `/`, the conversion goal competes with: Tutorials, Pricing, Blog, FAQ, Contact, video embed, AI Roofer add-on, condo cheat sheet, the "$299/mo AI Secretary" upsell, etc. Each is a leak. Conversion-rate gains of 2–3× are normal when paid traffic is moved from a homepage to a focused landing page that matches the ad keyword.

**Fix:**
1. In Google Ads, change the Final URL on every campaign that's currently sending to `/` or `/?gclid=...` to `https://www.roofmanager.ca/lander`.
2. Verify gclid persistence still works on `/lander` (it should — the script in `src/index.tsx:290-310` runs in the global scope on every page).
3. If campaigns are keyword-themed (storm/insurance, residential, solar, commercial), spawn dedicated lander variants — the route accepts a slug today (`src/services/attribution.ts:60` parses `/lander/:slug`). Examples: `/lander/storm-damage`, `/lander/solar-design`. Each lander headline and proof block should mirror the ad copy. (This is what raises Google Ads Quality Score from ~5 to ~9, which can drop CPC 30 %.)

---

### P0-4. The hero "free preview" gives away the product without an email

**Where:** `src/index.tsx:7318-7346` (the form), `src/index.tsx:8442-8474` (the JS handler).

A visitor types any address, clicks Preview, and sees satellite image + sloped area + pitch + shingle quantity — *no account required*. The conversion-funnel theory was that the preview ends with a "Create account to download" CTA, which it does, but you've already shown them the answer. Many users will take a screenshot and leave.

**Why this hurts paid traffic specifically:** Paid clicks cost real dollars. Giving away the headline value to anonymous visitors is fine on organic SEO traffic (where the cost is zero) but expensive on paid. You want the paid visitor to either convert or bounce — not to extract value and leave.

**Fix (one of these):**
- **Option A (lighter touch):** Gate the preview behind a one-field email capture. Show the satellite thumbnail blurred + the headline metric blurred until they enter an email. Fire `trackAdsConversion('lead', {value:5})` on email submit.
- **Option B (recommended):** Remove the preview from the homepage hero entirely. Replace with a static animated "demo" GIF/video showing what the report looks like, plus the address-preview link as a secondary CTA *behind* the signup CTA on `/lander/preview`.
- **Option C (test):** A/B test gated vs ungated. The infrastructure already exists at `src/lib/ab.ts:117`.

---

## P1 — High-Leverage Conversion Lifts

### P1-1. The hero has three CTAs of similar weight

**Where:** `src/index.tsx:7303-7307`.

The hero shows: "Start free — 4 roof reports, no card" (primary green button), "Or try a free preview with any address" (text link), "Talk to sales" (text link). The comment `<!-- conv-v5: hero rewritten — one primary CTA -->` at line 7294 says the intent was *one* CTA, but three remain, plus the address-preview form 100 px below, plus the announcement-bar CTA 60 px above. That is 5 competing actions in the first viewport.

**Fix:** Keep only the primary "Start free" CTA. Demote "Talk to sales" to the footer. Remove "Or try a free preview" entirely (or fold into P0-4 above).

### P1-2. The announcement-bar A/B test is testing the wrong thing

**Where:** `src/index.tsx:7198-7203` and `src/index.tsx:8312-8330`.

Variant A says "4 FREE Roof Reports — Start for free →". Variant B says "Book a free 20-min demo — Book demo →". These aren't variants of one offer; they're two different funnels. Whichever wins on click-through tells you nothing about which converts more *contractors per ad dollar*, because the demo path is a different conversion (`demo` placeholder, currently no-op) than the signup path.

**Fix:**
- Pick one offer (recommendation: "Start free — 4 reports, no card" — the demo offer adds friction for a self-serve $7-per-report product).
- Use the A/B framework to test variants of the *same* offer: e.g. urgency ("4 free reports — limited") vs guarantee ("4 free reports — keep them forever") vs specificity ("4 measurement reports for $0 — usually $32").

### P1-3. Demo as a CTA is misaligned with a self-serve $7 product

**Where:** `getDemoLandingPageHTML()` at `/demo`, plus the demo CTA in the announcement bar variant B.

A 20-minute sales demo is appropriate for $500/mo SaaS. For a pay-as-you-go product where a contractor can run their first 4 reports for free in 60 seconds, a demo is friction. It also turns a self-serve signup into a sales-team-touched lead, which costs you $50–$200 in salesperson time per booking.

**Fix:** Drop "Book a demo" entirely from the homepage, lander, and ad copy. Keep `/demo` as a tertiary CTA only for inbound channels where a contractor explicitly asks (Contact form, FAQ).

### P1-4. Trust signals are unverifiable / unconvincing

**Where:**
- `src/index.tsx:7297` — "Trusted by 200+ Contractors — US & Canada"
- `src/index.tsx:7487-7491` — "10,000+ Reports Generated", "98% Measurement Accuracy", "<60s Average Delivery"
- `src/index.tsx:7012-7034` — JSON-LD review schema with first-name + initial only

**Why it hurts:** Roofing contractors are a specifically-skeptical buyer persona — small-business owners who have been pitched by hundreds of vendors. "200+ contractors" is unmemorable; "Mike D." is obviously anonymized; the 4.9/5 aggregateRating with no review platform link is invisible to a buyer comparing tools.

**Fix (in order of leverage):**
1. **Add 1–3 real customer logos** at the top of the lander, even if they're unknown regional brands. Real photographed company logos beat any text claim.
2. **One named, photographed customer + 30-second video testimonial.** "James R., Owner, Prairie Roofing" becomes "James Robertson, Owner, Prairie Roofing — Calgary, AB" with a real headshot and a 30-second clip. This single asset is worth more than every other trust signal combined.
3. **Replace "200+ contractors" with a specific dated number** ("412 contractors as of April 2026"). Specificity reads as truth.
4. **Add G2 / Capterra widgets** if you have profiles there — paid contractors check these. If you don't have profiles, get them.
5. **Drop or substantiate "98% measurement accuracy"**. Either link to a methodology page or remove. Marketing claims without backing erode trust on contractor traffic specifically.

### P1-5. Signup form still asks for password + mobile + company-size + use-case

**Where:** `src/index.tsx:9137-9245` (Step 2 of the signup form).

Step 1 is great — single field (work email). Step 2 then asks for:
- Full Name
- Password (with strength meter)
- Company Name
- Mobile (skippable)
- Company Size (5-option dropdown)
- Primary Use (5-option dropdown)

The Google Sign-In button at line 9080 is properly placed first, so most users will skip the password. But Step 2 has 6 fields total. Each field beyond name + email costs roughly 5–7 % of completion rate.

**Fix:**
- **Drop mobile entirely from signup** — capture it post-activation when the user first opens the dashboard, or when they create their first job. There is zero conversion-value in asking for a phone before activation.
- **Move company size + primary use to a "personalize your dashboard" screen *after* account creation.** This is standard SaaS pattern — qualify *after* you've captured them, not before. The data quality stays the same (90%+ of users complete a 2-question post-signup wizard) but you stop bleeding signups at the form.
- **Drop the password strength meter** when Google SSO is the recommended path. Visual complexity increases perceived form difficulty.

Net: Step 2 goes from 6 fields to 3 (Name, Company, Password — and Password is hidden if they used Google).

---

## P2 — Performance, Page Experience, Quality Score

### P2-1. Homepage is 20 KB tall and loads 40 scripts

**Live measurement:** `docHeight: 20083`, `totalScripts: 40`, `totalIframes: 2` (the YouTube embed auto-loads). The homepage triggers parallel async loads of: GA4 gtag, Google Ads gtag, Google Identity Services, Microsoft Clarity, Meta Pixel, Service Worker, push notifications, Font Awesome from CDN, Google Fonts.

**Why it matters for Google Ads:** Google's Ads Quality Score factors in landing page experience, which is largely Core Web Vitals (LCP, INP, CLS). Slow LCP raises CPC; the same auction-winning bid costs you more. On 4G mobile from a Google Ad click, every 100 ms of LCP is roughly 1 % of conversion.

**Fix:**
- **Lazy-load the YouTube iframe** behind a click-to-play poster. Today it loads on every visit even if no one watches. (Easiest: use `<iframe loading="lazy">` and a placeholder image; or ship a `lite-youtube-embed` style component.)
- **Defer Meta Pixel and MS Clarity until first user interaction** (scroll, click, or 3-second timer). Neither is required for the first paint.
- **Replace Font Awesome CDN with self-hosted, subset-only icons.** You use ~25 icons; the full library is ~75 KB.
- **Move the address-preview's Google Solar API call to client-side fetch** instead of a server roundtrip blocking initial response.
- **Set `loading="lazy"` on every below-the-fold image.** I didn't audit each one but the homepage has 13 images.

### P2-2. Probable CLS from the announcement bar

**Where:** `src/index.tsx:7184-7185` — `.landing-nav { top: 40px }` and `.bar-hidden { top: 0 }`.

When the announcement bar is dismissed, the nav jumps from `top: 40px` to `top: 0`. If the page hasn't fully painted by then, this contributes CLS.

**Fix:** Either remove the dismiss button or animate the transition with `transition: top 0.2s` and reserve space. Run `npx unlighthouse --site https://www.roofmanager.ca/` to confirm.

### P2-3. The H1/H2 structure has 17 H2s on the homepage

**Live measurement:** `h2Count: 17`. Many of those H2s are part of the hero subhead, the video headline, the feature grid, etc. Some are gigantic ("Get a contractor-grade roof measurement report in 60 seconds…" used as an H2). This dilutes SEO signal and can confuse Google's page understanding for ad relevance scoring.

**Fix:** Demote pure-copy "headlines" (subheads, captions) to plain `<p>` with strong styling. Reserve H2 for actual section breaks (~5–7 max).

---

## P3 — Targeting & Funnel Architecture

### P3-1. No keyword-matched landing pages

The infrastructure exists (`src/services/attribution.ts:60` → `/lander/:slug`) but only the bare `/lander` is wired. A campaign targeting "xactimate alternative" sends traffic to a generic page that says "satellite roof measurements" — Google's relevance scoring penalizes the mismatch with a higher CPC.

**Fix:** Spin up 3–6 keyword-matched landers in week 2:
- `/lander/xactimate-alternative` — H1 "Cheaper than Xactimate, faster than EagleView", side-by-side price table.
- `/lander/storm-damage` — H1 "Document storm damage in 60 seconds", insurance-focused proof.
- `/lander/eagleview-alternative` — H1 "Same accuracy, $5–$8 vs $80+", price-anchored.
- `/lander/solar-design` — H1 "Roof reports for solar designers", solar-specific proof.
- `/lander/commercial` — H1 "Commercial flat-roof reports", ties into condo cheat sheet.

Each maps to a single Google Ads ad group. Quality Score will move from ~5 to ~8–9 within 2 weeks.

### P3-2. CAD pricing on a US-targeting page

**Where:** `src/index.tsx:6982-6984` declares `hreflang en-us` and `en-ca`, and the homepage explicitly mentions Dallas, Houston, Miami, etc. But pricing throughout (`src/index.tsx:14463-14518`) is in CAD only. A US contractor sees "$8 CAD" and either does mental math wrong or assumes Canadian-only product.

**Fix:**
- Geo-detect on first request (Cloudflare's `cf.country`) and show USD on `en-us` URLs ($8 CAD ≈ $5.85 USD — a US visitor seeing **$5.85/report** is materially more compelling than $8 CAD).
- Add a USD/CAD toggle on `/pricing` if you don't want to commit to geo-detection.
- Update the JSON-LD `priceCurrency` per geo as well.

### P3-3. The exit-intent modal only captures email — not the gclid

**Where:** `src/index.tsx:8334-8365`.

The modal fires on desktop exit-intent, captures email, and does *something* with it — but the surrounding code says it submits to a "create free account" handler. Mobile users (≥50 % of paid traffic for trades) get no exit-intent at all because of the `no mobile/touch` guard. And if the modal fires before the user fills the gclid into the register form, attribution may be lost.

**Fix:**
- **Replace exit-intent with a 30-second-on-page email-capture popover that also fires on mobile** (via scroll depth ≥ 60 %). Modern conversion playbooks treat exit-intent as a desktop-only relic.
- Verify the captured email is associated with the persisted gclid in `localStorage` so Lead conversion attribution works.

### P3-4. Five forms on the homepage

**Live measurement:** `formCount: 5` on `/`. Address preview, exit-intent modal email, footer subscribe (?), contact link, and the lead-magnet block at the bottom. Each of these is a chance to leak attention without a conversion.

**Fix:** Audit and drop to 1–2: keep the hero address-preview if you go with the gated version (P0-4 Option A), and the exit-intent. Move the rest off the homepage entirely.

### P3-5. No retargeting pool definition

Meta Pixel is loaded but I didn't see a Google Ads remarketing list segment defined for "visited /pricing in last 30 days" or "started signup, did not complete". For a B2B funnel where a contractor needs 3-7 touches before signup, retargeting is what closes the gap.

**Fix:** In Google Ads → Audiences → Remarketing, create:
- "Visited / or /lander" (1-day, 7-day, 30-day windows)
- "Visited /pricing"
- "Started signup, did not complete" (page = `/register`, did not fire `signup` conversion)

Run a cheap retargeting display campaign (~$10/day) targeting these audiences with the "4 free reports" creative. Standard B2B SaaS sees 30–50 % of total signups arrive via retargeting paths.

---

## What's already good (don't change these)

- **The /register flow is well designed.** Step 1 is single-field. Google SSO is featured first. Trust line below the button. Sticky mobile submit. Side-panel testimonials.
- **gclid + UTM persistence to localStorage** (`src/index.tsx:290-310`) — exactly right for offline conversion uploads later.
- **Enhanced Conversions with SHA-256 hashing** (`src/index.tsx:311-343`) — properly normalized, properly hashed, will improve match rate 10–30 % on iOS/Safari/ITP.
- **Square return-URL purchase tracking** (`src/index.tsx:352-361`) — clean and correct.
- **JSON-LD SoftwareApplication, FAQPage, Organization, BreadcrumbList schemas** (`src/index.tsx:6987-7072`) — strong technical SEO foundation.
- **The `/lander` page itself.** Just point traffic at it.

---

## Recommended 2-week ship plan

**Week 1 (P0 only):**
1. Day 1: Fix homepage header (P0-1).
2. Day 1: Wire the four missing Google Ads conversion labels (P0-2).
3. Day 2: Switch all Google Ads campaign Final URLs to `/lander` (P0-3).
4. Day 3: Gate the address preview behind email capture (P0-4 Option A).
5. Day 4-5: Verify each conversion fires in Google Tag Assistant; verify gclid persists from `/lander` to `/register`; baseline CPA in Google Ads.

**Week 2 (P1 + measurement):**
1. Cut hero to one CTA (P1-1).
2. Reduce signup Step 2 to 3 fields (P1-5).
3. Replace generic testimonials with one named, photographed customer (P1-4).
4. Spin up 3 keyword-matched landers: `/lander/xactimate-alternative`, `/lander/storm-damage`, `/lander/eagleview-alternative` (P3-1).
5. Lazy-load YouTube + defer non-critical pixels (P2-1).
6. Set up retargeting audiences (P3-5).

After two weeks, look at: Lead conversions per campaign per week, signup-from-paid CPA, and `/register` step-1 → step-2 completion rate. The first two should drop materially; step-1 → step-2 should rise.

---

## Open questions for the team

1. What's the current Google Ads weekly budget and the campaigns' Final URLs? (If most campaigns already point to `/lander`, P0-3 is a no-op — but I'd guess they don't.)
2. Are there any real customer logos or named-customer videos available that I haven't seen? Highest-leverage P1 fix depends on this.
3. Is geo-IP currency switching acceptable from a billing/tax standpoint, or does Stripe/Square require CAD-only invoicing?

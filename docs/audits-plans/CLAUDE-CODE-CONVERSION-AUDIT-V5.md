# CLAUDE CODE PROMPT — Roof Manager Full-Funnel Conversion Audit (V5)

> **How to use this file:** open your repo in Claude Code (`cd` into `roofreporter-ai-good-copy` and run `claude`). Paste **everything between the fenced block below** as a single prompt. Claude Code already has read/edit access to your files, so it can execute this without further context.
>
> **Audience being targeted:** B2B roofing (and solar) contractors — owners, estimators, office managers. Desktop + mobile.
> **Goal of the changes:** lift `/register` signups AND `/contact` + in-page lead-form submissions.
> **Scope rule:** DO NOT touch the measurement engine, Solar API, admin dashboard, or Python LiveKit agent. Marketing surfaces only (`src/index.tsx`, `src/lib/lead-forms.ts`, `src/routes/lead-capture.ts`, `public/_headers`, `public/static/*`).

---

```text
You are working inside the Roof Manager repo (Hono + Cloudflare Pages/Workers + D1).
Read CLAUDE.md first. Then execute the playbook below top-to-bottom.

Ground rules
------------
1. Public marketing site is 100% SSR from src/index.tsx (~19,867 lines). Do NOT
   split it, rewrite the router, or change build tooling. Edit in place.
2. For every change: (a) show me the file + line range, (b) explain the
   conversion hypothesis in one sentence, (c) leave a trailing comment
   "// conv-v5: <short reason>" so I can grep later.
3. When you touch a form, keep the existing analytics hooks intact
   (rrTrack, gtag 'lead_submit', fireMetaLeadEvent). If a form is missing
   any of those, ADD them — they are the conversion backbone.
4. After each numbered section, run `npx tsc --noEmit` and `npx vitest run`
   and show me the output. Stop if anything breaks.
5. Use small, reviewable commits. Commit message format:
   `conv-v5(<area>): <change>` — e.g. `conv-v5(pricing): fix 3-vs-4 free`.
6. NEVER run `npm run deploy` or `npm run deploy:prod`. I deploy manually.

==========================================================================
SECTION 1 — FIX FACT INCONSISTENCIES (highest ROI, lowest risk)
==========================================================================
The DB grants free_trial_total=4 (src/index.tsx:720) but multiple surfaces
still say "3 free". This is a trust-killer and may also be treated as
misleading advertising schema by Google. Make EVERY surface say 4.

Find every literal occurrence of "3 free", "three free", "3 professional
roof measurement reports", "3 free trial reports" across src/** and
public/** and rewrite to the 4-report number. Known hotspots:

  src/index.tsx:1495   "3 professional reports, full CRM access..."
  src/index.tsx:2067   "$8 per report after 3 free trial reports"
  src/index.tsx:2068   "$8 CAD per report after 3 free trial reports"
  src/index.tsx:2196   "...cost ... after your 3 free trial reports"
  src/index.tsx:9831   "3 free measurement reports. No credit card..."
  src/index.tsx:11423  programmatic city page — "$8 USD per report after 3 free"
  src/index.tsx:11451  programmatic city page Offer.description "Per report after 3 free"
  src/index.tsx:11588  feature/city lander "3 free reports, no credit card"
  src/index.tsx:11634  state page "$8 USD per report after 3 free"
  src/index.tsx:11660  state page Offer.description "Per report after 3 free"
  src/index.tsx:11672  FAQ for state page "Reports cost $8 USD after 3 free"
  src/index.tsx:11812  "3 free reports on signup, no credit card"
  src/index.tsx:12278  "Try 3 free reports — no credit card."
  src/index.tsx:12361  "3 free reports, no credit card, 60-second signup."
  src/index.tsx:13067  "Start with 3 free roof measurement reports..."
  src/index.tsx:13430  JSON-LD Offer description "3 free professional roof measurement reports"
  src/index.tsx:13471  PRICING PAGE visible banner contradicts its own H2 — H2 says
                       "4 Free Reports When You Sign Up" but body text says
                       "get 3 professional roof measurement reports"
  src/index.tsx:13936  "Get 3 free professional roof measurement reports."
  src/index.tsx:14529  "get 3 free professional roof measurement reports"

Grep for more and fix anything I missed:
  - `grep -n "3 free" src/index.tsx`
  - `grep -n "3 professional" src/index.tsx`
  - `grep -n "three free" src`
  - `grep -n "3 free" public`

==========================================================================
SECTION 2 — REMOVE TODO PLACEHOLDERS IN PRODUCTION HTML
==========================================================================
Production HTML contains unresolved TODO(Ethan) comments visible in page
source (bad for SEO trust + leaks internal process):

  src/index.tsx:6791  <!-- TODO(Ethan): Replace +1XXXXXXXXXX with your real sales phone number before going live -->
  src/index.tsx:6792  <!-- TODO(Ethan): confirm sales phone number and replace placeholder below -->
  src/index.tsx:8164  <!-- TODO(Ethan): confirm sales phone number and replace placeholder below -->

Action:
  a) Ask me (the user) for the real sales phone number BEFORE editing. If
     I say "skip" or "no phone yet", REMOVE the phone element entirely
     rather than leaving a placeholder — a missing phone is better than
     a broken one for a B2B contractor audience.
  b) Delete every TODO(Ethan) HTML comment on a public page.
  c) Also update the JSON-LD Organization.contactPoint (around
     src/index.tsx:6629) to include the telephone property if we have one.
  d) If we DO ship a phone number, make it:
       - tel: link on mobile (<a href="tel:+1...">)
       - copy-to-clipboard button on desktop
       - fire rrTrack('phone_click', {location: '<surface>'}) on click
       - fire gtag('event','phone_click',{...}) + fireMetaContactEvent()
         on click for paid-ads attribution

==========================================================================
SECTION 3 — PRICING PAGE: KILL THE "FROM $5" LIE
==========================================================================
src/index.tsx:13402 is getPricingPageHTML.

Current problems:
  - Title (line 13407): "AI Measurements from $5/Report" — cheapest is
    $5.95 (100-pack). Saying "$5" when the price is $5.95 is the single
    biggest trust-credibility hit on the page and likely a Google Ads
    policy risk if it's used in headlines.
  - OG title (13410) says "From $5/Report (100-Pack)".
  - Twitter title (13417) says "From $5/Report".
  - JSON-LD still says "3 free" (13430) — fixed in Section 1 but verify.

Fix:
  a) Rewrite page title to: "Roof Report Pricing — AI Measurements from
     $5.95/Report (100-Pack) | Roof Manager".
  b) Update OG + Twitter titles to match.
  c) Update meta description to mention "4 free reports" (it already
     does — just verify after Section 1).
  d) Above the credit-pack cards, add a 2-line "How pricing works" block:
        Month 1: 4 reports free, no card.
        After: $8 per report, or buy 100 credits for $5.95 each.
     (This removes ambiguity B2B buyers feel when they see 5 prices.)

==========================================================================
SECTION 4 — HOMEPAGE HERO: ONE PRIMARY CTA
==========================================================================
getLandingPageHTML at src/index.tsx:6527. The hero currently has 4+
competing CTAs (try the preview, register, book demo, contact sales,
see pricing). Analysis paralysis drops conversion. We will keep ONE
primary CTA and demote the rest.

Required structure (rewrite the hero section — the block immediately
after getHeadTags() and the JSON-LD, where the first <section> /
"<div class=\"hero\">" begins):

  <h1>  The full sentence, keyword-dense, 10–14 words:
        "Satellite Roof Reports + CRM Built for Roofing &amp; Solar Contractors"
  <h2 / subhead>  One crisp benefit line, <=18 words:
        "Accurate roof measurements in 60 seconds, a full CRM, and an AI
         phone secretary — for less than the cost of a single EagleView."
  <primary CTA>  Big green pill button:
        "Start free — 4 roof reports, no card" -> /register
        Fires rrTrack('cta_click',{location:'hero_primary'}) + gtag conversion.
  <secondary inline text link>  Right next to the primary button, NOT
        another big button:
        "Or try a free preview with any address →"  -> focuses the
        address-preview input (scrollIntoView + focus).
  <tertiary text link>  Under the button, small grey:
        "Talk to sales"  -> /contact
  <trust bar under CTA>  One-line row, 13px grey text:
        "✓ No credit card   ✓ Cancel any time   ✓ Works in all 50 states
         + every Canadian province   ✓ 4.9/5 from 200+ contractors"

Demote "Book a demo" from the hero entirely. The /demo route still
exists and is linked from the nav + pricing page; that is enough.

==========================================================================
SECTION 5 — /register: ADD THE B2B FIELDS THAT ACTUALLY QUALIFY LEADS
==========================================================================
getCustomerRegisterPageHTML at src/index.tsx:8516. Today it is a 2-step
flow: email -> password + name + optional company. For B2B contractor
acquisition this is missing the phone + company-size fields that turn
signups into sales-qualified leads.

Do this carefully — the current form already has progress indicator,
google SSO, honeypot, UTM persistence. Keep ALL of that.

Changes to Step 2 of the form:
  a) ADD required `<input type="tel" name="phone">` with inputmode="tel"
     and autocomplete="tel". Label "Mobile # (so we can help you if you
     hit an issue)". Do NOT make it a gatekeeper — allow skip with a
     smaller "skip for now" link that still submits.
  b) ADD required `<select name="company_size">` with options:
        "Just me (solo)"
        "2–5 crew members"
        "6–15 crew members"
        "16–50 crew members"
        "50+"
     Default unselected. Label "How big is your crew?"
  c) KEEP company field but make it required (was optional).
  d) ADD optional `<select name="primary_use">` with options:
        "Storm / insurance work"
        "Retail / residential"
        "Commercial"
        "Solar"
        "Other"
     Label "What do you mostly do?"
  e) Push every new field through the existing POST handler. Find the
     register POST route (grep for `app.post('/register'` or
     `app.post('/api/customer-auth/register'` etc.) and:
        - Add phone, company_size, primary_use columns to `customers`
          via a NEW migration file (do NOT edit previous migration
          files). Name it
          `migrations/00XX_customers_b2b_qualifying_fields.sql`
          using the next sequential number. All columns nullable.
        - Update the INSERT (currently around src/index.tsx:720) to
          include the new fields.
        - Add a Zod schema in src/utils/* if one doesn't already exist,
          otherwise inline validate with a trimmed/lowercased email +
          phone length >= 7 (soft check — don't reject).
  f) Fire a GA4/Meta 'sign_up' event on successful register with
     {method: 'email'|'google', company_size, primary_use} so we can
     see conversion quality by segment in Google Ads.
  g) Make the Google SSO button visually the PRIMARY option on desktop
     (top of form, pill-shaped) and the email form collapses underneath
     with "or sign up with email" divider. Contractors hate typing.
  h) Mobile: stack the form and make the primary submit a sticky
     bottom button (position:sticky;bottom:0) so users don't have to
     thumb-scroll to find it on iOS.

==========================================================================
SECTION 6 — /contact: OPTIMIZE FOR B2B LEAD QUALITY
==========================================================================
getContactPageHTML at src/index.tsx:8033 (the form posts to
/api/contact/lead which is handled in src/routes/lead-capture.ts).

Keep all fields. Improve conversion + qualification:
  a) Move "Company" and "Employees (company_size)" above "Message".
     Social proof: contractors fill short top fields before
     committing to writing a message.
  b) Replace the free-text "Interest" field with a `<select>`:
        "I want to use Roof Manager for my business"
        "I want a wholesale / reseller account"
        "I want to integrate with an existing CRM"
        "Press / partnership"
        "Other"
  c) Add an inline "Prefer to just try it?" microcopy line directly
     above the submit button:
        Prefer to just try it? <a href="/register">Start free — 4 reports, no card</a>
     This converts high-intent visitors who landed on /contact but
     would rather self-serve.
  d) Verify the lead-capture success path fires:
        gtag('event','generate_lead',{form_location:'contact'})
        fbq('track','Lead')
        rrTrack('lead_submit',{form:'contact'})
     — If any are missing in lead-forms.ts success handler, add them.
  e) After successful submit, show a success card that (i) thanks them,
     (ii) displays calendar-app.google booking link as a PRIMARY button,
     and (iii) shows "Or register and start measuring now →".

==========================================================================
SECTION 7 — LEAD-FORM INFRASTRUCTURE (shared across surfaces)
==========================================================================
src/lib/lead-forms.ts exports inlineQuoteFormHTML, comparisonLeadFormHTML,
damageAssessmentFormHTML, freeMeasurementReportFormHTML, blogLeadMagnetHTML.

Audit each:
  a) Every form must have a visible `<label>` for every input (screen
     readers + higher conversion on mobile where placeholders vanish).
  b) Every form must have `autocomplete` attrs: email, tel, name,
     organization, postal-code as appropriate.
  c) Every form must have `inputmode` set appropriately
     (tel -> "tel", zip -> "numeric", email -> "email").
  d) Every submit path must fire ALL THREE:
        rrTrack('lead_submit', {form: '<form-id>'})
        gtag('event', 'generate_lead', {form_location: '<form-id>'})
        fireMetaLeadEvent(…)
     …and on load:
        rrTrack('form_view', {form: '<form-id>'})
     so we can compute per-form conversion rates.
  e) Add `noValidate` on the <form> and handle validation in JS so we
     can show friendly inline errors without the browser's default
     popover, which kills mobile conversion.

src/routes/lead-capture.ts:
  - Confirm honeypot field is rejected (should already be).
  - Add basic rate-limit per IP (20 submissions / 10 min) using
    Cloudflare's KV or the existing DB — pick whichever pattern the
    repo already uses. If none, use a simple in-memory Map on the
    Worker isolate as a best-effort throttle.
  - Log the UA string + referer so we can debug bot vs human later.

==========================================================================
SECTION 8 — MOBILE-SPECIFIC UX FIXES
==========================================================================
a) Homepage hero: on <=640px, collapse the 4-CTA stack as specified in
   Section 4 (this is the single biggest mobile conversion lever).
b) Every `<input>` on a public page must have font-size >= 16px. iOS
   Safari zooms on focus for anything smaller, which breaks flow.
   Find inputs with font-size:14px in register + contact + lead-forms
   and bump to 16px on mobile via a media query or inline.
c) Every CTA button on public pages: min height 48px, min width 44px
   (WCAG 2.2 + Apple HIG).
d) Sticky mobile CTA bar (fixed bottom, green pill, "Start free →")
   on the HOMEPAGE ONLY, appears after user scrolls past the fold
   (IntersectionObserver on hero). Dismissible, remembers dismissal
   for the session via sessionStorage.
e) The exit-intent modal (already bootstrapped in getHeadTags) should
   NOT fire on mobile — `mouseleave` doesn't map to intent on touch
   devices. Instead trigger on scroll-up after 25% depth, and also
   cap at 1 impression per session. Confirm this in the modal JS
   and fix if it fires on mobile today.

==========================================================================
SECTION 9 — TRUST & SOCIAL PROOF FOR B2B ROOFING CONTRACTORS
==========================================================================
Contractors buy from contractors. Current social proof is light.

a) RatingCount consistency: every JSON-LD aggregateRating across
   src/index.tsx uses ratingCount "200", but marketing copy elsewhere
   says "5,000+ contractors". Either:
        - Lower the marketing copy to "Trusted by 200+ contractors"
          (defensible, matches schema), OR
        - Keep the 5,000+ claim and bump ratingCount to match, but
          ONLY if we can defend it if Google asks.
   Pick option 1 (lower the number) — fewer brand-safety risks.
   Grep for "5,000" and "5000" across src/** and rewrite to 200+.

b) Add a logo bar under the hero: 5 roofing company names in grayscale.
   If I haven't given you logos, use text-only styled as capitalized
   small-caps ("Prairie Roofing · Summit Storm · …") — better than
   empty space. Include a one-line caption "Companies using Roof
   Manager today".

c) Under pricing page + homepage, add a 3-review mini-testimonial row
   sourced FROM THE EXISTING JSON-LD review objects (lines ~13438,
   6577). Render them visibly — right now they're only in schema.
   Visible reviews convert, schema alone does not.

d) Add a small "money-back / refund" line near every primary CTA:
        "No card required. If a report fails, credits refund
         automatically."
   (Codebase already has credit-refund logic — verify before making
   that claim; search for refund/credit logic first.)

==========================================================================
SECTION 10 — ACCESSIBILITY (real a11y, not checkbox a11y)
==========================================================================
a) Every `<img>` on public pages must have meaningful alt text or
   alt="" if decorative. Grep for `<img ` in src/index.tsx — there
   are ~108 img usages. Fix any with empty alt that are NOT decorative
   (logo image gets alt="Roof Manager", screenshots get descriptive
   alt, decorative SVG sprites get alt="").
b) Every `<button>` and icon-only link must have aria-label if there
   is no visible text (FontAwesome icons like <i class="fas fa-xxx">
   inside a link need a sibling aria-label).
c) Focus-visible states: ensure every interactive element has a
   visible :focus-visible outline. The `.reg-input:focus` pattern
   at src/index.tsx:8530 is fine, but many other surfaces rely on
   `outline:none` without a replacement. Add a global
        :focus-visible { outline: 2px solid #00CC70; outline-offset: 2px; }
   inside getHeadTags() CSS.
d) Color contrast: `color:#6b7280` on `#f8fafc` background (used in
   register page subcopy) measures ~4.1:1 which is borderline AA
   for body text. Bump to `#4b5563` where it's body copy (not micro).
e) Every form field must have a programmatically associated label
   (<label for="id"> + matching <input id>). Not just placeholder.

==========================================================================
SECTION 11 — CONVERSION TRACKING VERIFICATION
==========================================================================
Analytics middleware lives around src/index.tsx:260–303 and injects
GA4 + Google Ads (AW-18080319225) + Meta Pixel + Microsoft Clarity.

Verify each of these events fires on EVERY form success path. Create
a table in the response showing: form ID → which events fire today →
which events are missing → files you patched.

Required events on every lead-form or register success:
  GA4:        gtag('event','generate_lead',{form_location:ID})
              gtag('event','sign_up',{method:...}) for register only
  Google Ads: gtag('event','conversion',{send_to:'AW-...'})
              — there should be a distinct conversion label for
                'lead' and 'signup'. If only one exists, add the
                second.
  Meta:       fbq('track','Lead') for lead forms
              fbq('track','CompleteRegistration') for register
  Clarity:    clarity('set','conversion',ID) so we can segment
              session recordings by converted users.

==========================================================================
SECTION 12 — SEO / SCHEMA CLEANUP
==========================================================================
a) Confirm <link rel="canonical"> on every public page. Pricing (13409)
   + homepage (6549) + register (8523) + contact (~8033) all should
   have canonicals pointing at their .ca URL. Fix any missing.
b) hreflang: getHeadTags() injects hreflang — verify en-US, en-CA, and
   x-default exist and point to the same URL (we're one domain).
c) robots.txt (src/index.tsx around line 1206) lists 6 sitemaps.
   Verify each sitemap URL returns 200 and valid XML. Report any 404.
d) Remove any "3 free" text from sitemap-visible pages (Section 1
   already handles this, but sitemaps may reference orphan pages).
e) Page titles: cap at 60 chars, descriptions at 155 chars. Grep
   `<title>` and `<meta name="description"` on public routes and
   flag any that blow past those caps. Fix pricing title specifically
   (it's currently 70+ chars after the fix in Section 3 — tighten to
   "Roof Report Pricing — From $5.95 | Roof Manager").

==========================================================================
SECTION 13 — PERFORMANCE (mobile LCP is conversion)
==========================================================================
a) Preload the hero background image and logo: <link rel="preload"
   as="image" href="/static/logo.png" fetchpriority="high"> inside
   getHeadTags() for the homepage only (pass an arg to getHeadTags
   so it's conditional — don't preload on every page).
b) Defer all analytics scripts. GA4 should use `async`, but the
   Clarity snippet, Meta Pixel, and Google Ads tag should be loaded
   after DOMContentLoaded (or with `defer` where possible). Verify
   the 260–303 middleware uses async/defer correctly; fix any
   blocking script tags.
c) Self-host Inter font if we're not already (look for
   fonts.googleapis.com in getHeadTags). If we are using Google
   Fonts, make sure the <link rel="preconnect"> + display=swap
   are in place — they appear to be, verify.
d) Add <link rel="dns-prefetch" href="//www.googletagmanager.com">
   and //connect.facebook.net for the 3rd-party origins we hit.
e) Image compression: `find public/static -name '*.png' -size +200k`
   and list them. Don't auto-convert — just print the list and
   recommend a CLI command I can run (e.g. sharp / squoosh).

==========================================================================
SECTION 14 — FINAL REVIEW + CHECKLIST
==========================================================================
Produce a final report that includes:
  - Every file touched, with a before/after line count.
  - The commit list (git log --oneline since the start of this task).
  - A Markdown checklist of every numbered section above with [x] or [ ].
  - A "What I did NOT change and why" section.
  - A "What Ethan should test before deploying" section with concrete
    steps (register one account, submit /contact, check GA4 DebugView
    for the events, check Meta Events Manager, mobile Chrome DevTools
    device emulation for iPhone 13 + Pixel 7).
  - A 30-day hypothesis table: change → expected signup lift → how
    to measure.

STOP. Do not deploy. Do not amend old commits. Present the final
report and wait for me to review.
```

---

## Why this prompt ships conversion — the short version

The single highest-ROI item is **Section 1**: every surface advertising "3 free reports" when the DB grants 4 is a live trust leak on the front door. Roofing buyers are pattern-matchers — if the pricing banner contradicts its own headline (which `src/index.tsx:13469` vs `:13471` does today), they assume the pricing is also untrustworthy.

**Section 2** removes the `TODO(Ethan)` comments visible in rendered HTML — anyone who views source sees "replace before going live" and stops trusting the page.

**Section 4** (one primary hero CTA) is the proven single biggest lift you can get on a contractor-targeted SaaS homepage; the current hero has analysis paralysis from 4+ stacked CTAs.

**Section 5** adds the phone + company-size + primary-use fields to `/register`. Today those signups arrive with no way to segment or call — that is the reason paid traffic looks expensive.

**Section 6** adds the "prefer to just try it" escape hatch on `/contact` that recovers high-intent buyers who would rather self-serve.

**Sections 7–13** are the defensible base: working labels, tracking on every form, mobile input sizing, exit-intent not firing on mobile, and visible social proof sourced from the testimonials already sitting in your JSON-LD.

Run the prompt top-to-bottom in Claude Code. Everything is scoped to marketing surfaces — the measurement engine, Solar API, admin dashboard, and LiveKit agent are all explicitly off-limits per the playbook.

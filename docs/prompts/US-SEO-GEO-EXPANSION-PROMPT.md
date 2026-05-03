# Claude Code Prompt: US SEO + GEO Expansion for roofmanager.ca

**Copy everything below the horizontal rule into Claude Code (or `claude` in your terminal) from inside the `roofreporter-ai-good-copy` repo.** The prompt is self-contained: it tells Claude exactly what to audit, fix, and build, and includes every file path, line number, and concrete fact it needs. Work through it in the ordered phases; each phase ends in a commit so you can review before the next one starts.

Context from today's traffic: 560 CA views vs 71 US views on a ~10x larger US population. Signals are pointing the wrong way. We are keeping the `.ca` domain (per product decision) and must compensate with on-page signals, content scale, and GEO (AI-search) optimization. The `.ca` TLD will still cap us at roughly the 70-80th percentile of what a `.com` could do — but the current ratio is far worse than the ceiling, which means most of the gap is fixable in code.

---

# TASK: Fix SEO/GEO signals and launch a US-first content + programmatic-page expansion for Roof Manager

You are working in the Roof Manager monorepo (Cloudflare Pages + Workers + D1, Hono, single-file SSR in `src/index.tsx`). Read `CLAUDE.md` first for architecture. All UI is server-rendered HTML from handlers in `src/index.tsx` and `src/routes/`. Blog posts live in D1 (table `blog_posts`), served by `src/routes/blog.ts` and rendered by `getBlogListingHTML` and `getBlogPostHTML` in `src/index.tsx`.

**Current problem:** roofmanager.ca gets ~8x more Canadian traffic than US traffic despite the US market being ~10x larger and the product working identically in both countries. Audit already done — the root causes are (1) hardcoded Canadian geo signals throughout the HTML, (2) US city pages that literally tell Google they are in Canada, (3) a blog keyword strategy that is 80%+ Canadian cities, and (4) missing programmatic page silos for the US roofing verticals that actually drive traffic (storm/hail, insurance claims, state codes).

**Goal:** within one PR, neutralize the Canadian bias on non-CA pages, establish clean US geo-targeting where appropriate, publish a large batch of US-targeted pages and posts, and implement 2026 GEO (generative-engine optimization) best practices so Roof Manager gets cited by ChatGPT, Perplexity, Google AI Overviews, Claude, and Gemini answers for US roofing queries.

Work through the phases in order. After each phase, run `npm run build`, fix any TS errors, then commit with a descriptive message.

---

## Phase 0 — Ground truth (do this first, no code changes)

Before changing anything, verify the findings below are still accurate in the current HEAD. Print a short "confirmed / not confirmed" line for each.

1. `src/index.tsx` around **line 5039**: homepage sets `<meta property="og:locale" content="en_CA">`.
2. `src/index.tsx` around **line 5100** and **line 5125**: JSON-LD `Organization` / `SoftwareApplication` both set `addressCountry: "CA"` with `addressRegion: "Alberta"` and no alternate address.
3. `src/index.tsx` around **line 1544**: the `/roof-measurement/:city` route *hardcodes* `<meta name="geo.region" content="CA">` even for US cities (Houston, Dallas, Phoenix, Miami, Atlanta, etc. — full list in the `seoCities` object at line 1239).
4. `src/index.tsx` around **line 1555**: the same route hardcodes `addressCountry: "CA"` in the `LocalBusiness` JSON-LD for every city including US cities.
5. `src/index.tsx` around **line 1571** and **line 1647**: the FAQ and visible copy on US city pages says "reports cost **$8 CAD**" — wrong currency signal for US readers.
6. `src/index.tsx` around **line 3170**: `geo.region` is `CA-AB` on another template.
7. `src/index.tsx` at **line 10089-10108**: blog listing HTML uses `<html lang="en">` and carries only a `BreadcrumbList` JSON-LD — no `Blog` or `CollectionPage` schema, no locale alternates.
8. `src/index.tsx` around **line 10319** (`getBlogPostHTML`): hreflang is only emitted for European-language posts via `langMap`. English posts get no hreflang, so nothing tells Google "this is also for US readers."
9. `src/routes/blog.ts` via `src/services/blog-agent.ts` **line 50-75**: `seedDefaultKeywords` is 12 seeds, 10 of which are Canadian cities (Toronto, Calgary, Vancouver, Ottawa, Edmonton, Winnipeg, Mississauga, Hamilton, Montreal).
10. `src/index.tsx` line 826: RSS feed `<language>en-ca</language>`.
11. Sitemaps: `/sitemap.xml` caps blog posts at 100 (`LIMIT 100`, line 697). `/sitemap-blog.xml` caps at 1000 (line 793). There is no paginated sitemap once we cross these.
12. `public/_headers` and `public/_redirects`: no country-based headers, no US CDN considerations.
13. The `seoCountries` map (line 1367) contains `united-states` but US state-level pages do not exist — only city pages.
14. There is no `/us`, `/usa`, `/us/pricing`, or `/pricing-usd` route.
15. US states are not present as slugs at all; only a handful of big US cities share a namespace with Canadian ones.

If any of these 15 are no longer true, note which ones and adjust the phase scope accordingly. Do not fix anything yet.

---

## Phase 1 — Stop lying to Google about US pages (technical geo signals)

This is the highest-leverage phase. Every US-intent page currently tells Google it is a Canadian page. Fix that.

### 1.1 Split `seoCities` into `caCities` and `usCities`

In `src/index.tsx` line 1239, create two separate maps so the template can branch cleanly. Keep the existing slug format. Add `country: 'CA' | 'US'` to every entry. While you're there, add US states to every US city (the current `province` field already holds the state name — rename internally to `region` and keep backward compatibility where referenced).

Add an accessor `getCity(slug)` that returns `{city, country, region, lat, lng, currency: 'CAD' | 'USD'}`.

### 1.2 Fix `/roof-measurement/:city` for US cities (line 1527-1700)

When the resolved city is US:

- `<meta name="geo.region" content="US-{STATE_CODE}">` (e.g. `US-TX` for Houston). Build a `usStateCode` map: Texas→TX, Florida→FL, Arizona→AZ, etc. for all US cities in `seoCities`.
- `addressCountry: "US"` in the `LocalBusiness` JSON-LD.
- `priceRange`: keep `"$5-$500"` but drop "USD" from the string (schema infers from addressCountry).
- Add `<meta property="og:locale" content="en_US">`.
- Add `<link rel="alternate" hreflang="en-US" href="https://www.roofmanager.ca/roof-measurement/{slug}">` and `<link rel="alternate" hreflang="en-CA" href="https://www.roofmanager.ca/roof-measurement/{ca-counterpart-slug-or-home}">` and `<link rel="alternate" hreflang="en" href="https://www.roofmanager.ca/">` and `<link rel="alternate" hreflang="x-default" href="https://www.roofmanager.ca/">`.
- Replace every visible "$8 CAD" string with "$8" (no currency; then add a small note: "Billed in USD for US customers, CAD for Canadian customers").
- Rewrite the FAQ answers to remove "$8 CAD" and "CAD" mentions for US cities. Prices should read as US-native ("$8 per report after 3 free reports"). Add a new FAQ: *"Does Roof Manager work for US roofing contractors?"* with a confident yes and a mention that the platform is priced in USD for US users.
- Update breadcrumb schema to use "Locations" → "United States" → "{State}" → "{City}" (4 levels) instead of the current 3.
- Update `<html lang="en">` to `<html lang="en-US">` on US city pages.
- Add the city to the `LocalBusiness.areaServed` as a `GeoCircle` with a 50-mile radius (US contractors search "roof measurement near me" with big radii).

For CA city pages keep current behavior but:
- Add the corresponding `hreflang` block so CA/US siblings reference each other.
- Update `<html lang="en-CA">`.
- Keep "$8 CAD" visible.

### 1.3 Fix homepage (line 5024 `getLandingPageHTML`)

The homepage will always be multi-country. Make it genuinely neutral:

- Remove `og:locale: en_CA` and replace with `og:locale: en_US` + `og:locale:alternate: en_CA` (en_US as primary because US is the larger market we are going after).
- Change the meta description from "Trusted by contractors big and small across Canada & the US" to "Trusted by roofing and solar contractors across the US and Canada" (put the US first since Canada already ranks for us).
- JSON-LD `SoftwareApplication` `offers.priceCurrency`: keep `USD` (already correct at line 5064).
- JSON-LD `Organization` `address`: replace the single Alberta address with an `address` array containing both `{addressCountry: "US", addressRegion: "..."}` and `{addressCountry: "CA", addressRegion: "Alberta"}`. If that breaks Schema.org validators, use a `hasPOS` array of two `Place` objects instead. **Do not remove Alberta**; additive.
- Add `hreflang` tags pointing en-US→/, en-CA→/, en→/, x-default→/ (all same URL is valid; signals intent).
- Add a new FAQ entry before the existing "Does Roof Manager work in Canada?" FAQ: *"Does Roof Manager work for US roofing contractors?"* — answer confidently, mention Texas/Florida/California/Arizona specifically, mention integration with US insurance workflows (Xactimate-compatible line items, FEMA storm overlays, ICC hail codes).
- Add a second JSON-LD block of `@type: Product` for the measurement report itself with `offers.priceCurrency: USD` and US-native pricing.
- Change the footer "Alberta, Canada" location chip to be *one of* a rotating/cycling indicator OR add "Serving all 50 US states and 10 Canadian provinces" next to it.
- Update `<html lang="en">` to keep `en` (neutral for a multi-country homepage) and rely on hreflang to segment.

### 1.4 Fix `llms.txt` (line 899)

Currently describes Roof Manager as "Headquartered in Alberta, Canada." That's fine to keep (honest) but add an explicit "Market served: United States and Canada" line. Add a new `## United States Coverage` section with state-level bullets for TX, FL, AZ, CO, NV, OK, KS, NE, GA, NC, SC, LA calling out storm/hail/hurricane relevance. The `llms.txt` is specifically for LLMs to cite — they will quote exactly what's there, so bake in the US positioning explicitly.

### 1.5 Fix `robots.txt` (line 855)

Already allows the right AI bots. Add `Sitemap: https://www.roofmanager.ca/sitemap-us.xml` (you will create this sitemap in Phase 3). Also add the newer `Anthropic-Web` and `Perplexity-User` user agents with `Allow: /`. Add `Cohere-AI` and `Gemini-Ground` as Allow too.

### 1.6 Fix RSS feed (line 826)

Change `<language>en-ca</language>` to `<language>en-us</language>` (since most future blog content will be US-targeted) OR split into two feeds at `/feed-us.xml` and `/feed-ca.xml`. Prefer the split: US readers subscribing to an `en-ca` feed is a mild negative signal in some aggregators.

### 1.7 Commit

`git checkout -b us-seo-geo-expansion` then `git commit -am "fix(seo): stop sending CA geo signals from US pages — split city maps, fix hreflang, add en-US locale, correct LocalBusiness schema"`.

---

## Phase 2 — Build US programmatic page silos

US roofing SEO is won by programmatic content — state pages, city pages, vertical pages, tool pages. We have ~40 US cities already; we need states, verticals, and deeper state-city combos.

### 2.1 US State pages (`/us/{state-slug}`)

Create `app.get('/us/:state', ...)` that renders a full-featured state landing page for each of the 50 US states. Use a `usStates` map keyed by slug (`texas`, `florida`, `arizona`, `colorado`, `nevada`, `new-york`, etc.) with:
- Full state name, state code, capital, largest 5 metros, 2025 population, annual storm stats (hail days, hurricane events, tornadoes — pull fixed public numbers into a `US_STATE_WEATHER` constant), typical roofing materials, common building codes (IRC year adopted; Florida FBC; Texas IRC with windstorm appendix; etc.).

Page sections:
- Hero: "Satellite Roof Measurement Software for {State} Roofing Contractors"
- Why {State}-specific: storm/hail/hurricane stats + how Roof Manager handles the workflow
- City grid: 10-20 largest metros in the state each linking to a `/us/{state}/{city}` child page
- Pricing in USD, US units (feet, sq ft — not meters)
- FAQ with 8-10 US-specific Q&As per state
- Internal links to relevant blog posts (see Phase 4)
- LocalBusiness + FAQPage + BreadcrumbList JSON-LD with `addressCountry: "US"`, `addressRegion: "{STATE_CODE}"`
- `<html lang="en-US">`, `og:locale: en_US`, `geo.region: US-{STATE_CODE}`
- `hreflang` for en-US, en, x-default all to the same URL

### 2.2 US City pages scoped by state (`/us/{state}/{city}`)

Replace/augment the current `/roof-measurement/{city-slug}` route for US cities with `/us/{state}/{city}`. Keep the old URL as a 301 redirect to the new canonical so we don't lose existing links. Do this for the ~40 US cities already in `seoCities` plus expand to ~200 by adding the top 5-10 metros per state (fetch from a deterministic list — see suggested seed data below).

Each page:
- Localized H1: "Roof Measurement Software for {City}, {State} Contractors"
- {City} + {State}-specific storm + insurance claim narrative (e.g. Houston → windstorm claims, hurricane season prep; Denver → hail belt, 1-in-3 homeowner claim rate)
- 10 FAQ items (state-level + city-level mix)
- Direct mention of the single largest local insurance carrier + local roofing contractor count from public data (use stable numbers)
- Internal links: parent state page, sibling cities in same state, blog posts tagged that state
- JSON-LD: `LocalBusiness` with `addressCountry: "US"`, `addressRegion: "{STATE_CODE}"`, `addressLocality: "{City}"`, `geo` coordinates; `FAQPage`; 4-level `BreadcrumbList`

### 2.3 US vertical silos

Create these evergreen hub pages, each a programmatic generator:

1. **`/us/insurance-claims/{state}`** — how to use Roof Manager reports for storm/hail insurance claims in {state}. Call out Xactimate line items, Eagle View parity, NICB guidelines. 50 pages.
2. **`/us/storm-damage/{state}`** — 1-in-N-year hail/wind/hurricane reference, Roof Manager storm-scout workflow. Link to existing `/storm-scout` if it exists. 50 pages.
3. **`/us/hail-damage/{state}`** — most valuable for CO/TX/OK/KS/NE/SD/NM. 50 pages; lower-priority states can share a template.
4. **`/us/hurricane-damage/{state}`** — FL/LA/NC/SC/GA/TX/MS/AL. 50 pages, Gulf/Atlantic states content-rich; landlocked states get a short "hurricanes rarely affect {state}" variant.
5. **`/us/roof-replacement-cost/{state}`** — state-level average replacement cost, square-foot math, typical materials. Source numbers from HomeAdvisor / Angi public data; cite in text with "as of 2026."
6. **`/us/roofing-contractors/{state}`** — "Tools roofing contractors in {state} use." Position Roof Manager as the stack of choice, compare to Hover/Roofr/EagleView/RoofSnap/AccuLynx/JobNimbus/CompanyCam.

Total: 6 verticals × 50 states = 300 pages. Each page should be templated but non-identical — include the state-specific data in every section so they're not thin-content doorway pages. Require ≥800 words of state-localized prose per page.

Each vertical hub page also has a clean root: `/us/insurance-claims`, `/us/storm-damage`, etc. with a 50-state directory and a US map SVG if practical.

### 2.4 US comparison page matrix

Reuse the existing `competitorConfigs` mechanism (line 7309) and add US-only entries:

- `/hover-alternative-us` — Hover's pricing, limitations
- `/eagleview-vs-roofmanager-us` — US-specific comparison (EagleView is US-headquartered)
- `/roofr-vs-roofmanager-us` — US-pricing angle
- `/roofsnap-vs-roofmanager-us`
- `/accu-lynx-alternative`
- `/jobnimbus-vs-roofmanager`
- `/companycam-vs-roofmanager`
- `/xactimate-integration`

Each has US-centric framing ("stop paying $49/report for EagleView when you can pay $8"). These rank for very high commercial-intent queries.

### 2.5 Pricing page — serve USD by default for US visitors

Update the pricing page handler to detect country via `c.req.header('CF-IPCountry')` (Cloudflare adds this automatically). If the country is not CA, show USD prices as the primary column with CAD as a small secondary footnote. Update JSON-LD `Offer.priceCurrency` to match. Do **not** do IP-based redirect — just content swap. Keep a visible language/currency switcher.

### 2.6 Commit

`git commit -am "feat(us-seo): add US state + vertical silo pages (300+ new URLs) with proper US geo signals"`.

---

## Phase 3 — Sitemap, indexing, and internal linking at scale

All those new pages are worthless if Google doesn't find them fast.

### 3.1 Segmented sitemaps

Extend `src/index.tsx` around line 706 (`/sitemap-index.xml`) to include:

- `sitemap-core.xml` — already exists
- `sitemap-locations.xml` — already exists (extend with new US state + city pages)
- `sitemap-blog.xml` — already exists (uncap the 100 limit in `/sitemap.xml`; split into paginated sitemaps if > 50k URLs)
- `sitemap-us-states.xml` — new
- `sitemap-us-cities.xml` — new, paginate if > 5000 entries
- `sitemap-us-verticals.xml` — new (insurance/storm/hail/hurricane/cost/contractors × 50 states)
- `sitemap-comparisons.xml` — new

Add `<lastmod>` to every URL based on either DB `updated_at` or build date. Bots weight `lastmod` heavily.

### 3.2 Image sitemap

Already exists at `/image-sitemap.xml`. Extend with the cover images for every new state/city/vertical page. For pages without a unique cover, generate one per state via the existing AI image service (`src/services/ai-image-generation.ts`) — they can be static after first render.

### 3.3 News sitemap

Add `/news-sitemap.xml` following the Google News sitemap format for blog posts published in the last 48 hours. Even if Google News doesn't accept us, Bing + Yandex respect it.

### 3.4 `IndexNow` submission

Implement a helper that pings `https://api.indexnow.org/indexnow` with new/updated URLs on publish. Bing/Yandex/DuckDuckGo all consume IndexNow. Generate a random key, save it at `public/{key}.txt`, and reference it in the ping payload. Wire it into `publishDraft` in `src/services/blog-agent.ts` and into any admin handler that publishes new pages.

### 3.5 Internal linking

The current site has weak internal linking. Implement a link-injection layer:

- **Blog listing page**: section above the grid titled "Browse by State" linking to all 50 US state hub pages. Section "Browse by Topic" linking to the 6 vertical hubs.
- **Every blog post**: after the content, inject an auto-generated "Related by location" box with 3 links (state hub + 2 sibling state posts). Also inject "Related tools" with 3 relevant `/tools/*` links.
- **State hub pages**: cross-link to 3-5 sibling states in the same region.
- **Comparison pages**: mutual links to all other comparison pages.
- **Home page**: add a `<nav aria-label="US markets">` block with 12 top US state links (TX, FL, CA, AZ, CO, GA, NC, NV, OK, TN, SC, LA).

The target: every important page should be reachable in ≤3 clicks from the homepage.

### 3.6 Commit

`git commit -am "feat(seo): segmented sitemaps + IndexNow + internal linking overhaul for US expansion"`.

---

## Phase 4 — Blog content strategy: blow out US keyword coverage

The current blog-agent seeds 12 Canadian-skewed keywords. We need 200+ US-targeted seeds, a refreshed prompt that enforces US framing, and a one-shot batch generation.

### 4.1 Replace `seedDefaultKeywords` in `src/services/blog-agent.ts`

Replace the 12-entry array with 200+ US keyword seeds organized by state, vertical, and intent. Include:

**Commercial intent (~60):**
- `roof replacement cost {STATE}` for all 50 states
- `hail damage roof repair {STATE}` for all hail states (CO, TX, OK, KS, NE, SD, NM, MN, MO, IL, IA, WI)
- `insurance claim roof replacement {STATE}` for all 50

**Informational (~80):**
- `how to file a hurricane roof damage claim in {FL/LA/NC/SC/GA/TX}`
- `what does {insurer} cover for roof damage` (State Farm, Allstate, USAA, Farmers, Progressive, Liberty Mutual, Travelers, Nationwide, Geico, Chubb)
- `{STATE} building code requirements for new roofs`
- `how to read an Xactimate roof estimate`
- `IRC 2024 roofing changes` + `IBC 2024 roofing changes`
- `metal roof vs shingles in {STATE}` for 20 high-variance states
- `solar roof tax credit {STATE} 2026`
- `FEMA hazard mitigation roof grants`

**Comparison (~30):**
- `{COMPETITOR} alternative for US contractors` for Hover/EagleView/Roofr/RoofSnap/AccuLynx/JobNimbus/CompanyCam/Pictometry
- `Roof Manager vs {COMPETITOR} pricing`
- `{COMPETITOR} vs satellite roof measurement`

**Local intent (~30):**
- `best roofing software for {TOP_10_US_METROS_PER_STATE}` × ~10 top states (drives ~100 combos; pick 30 highest-volume metros)

Each seed row carries `geo_modifier` = state name (not city only) so the prompt can localize. Also add a `market: 'us' | 'ca' | 'both'` column to `blog_keyword_queue` (add a migration) and set `market = 'us'` for all new seeds.

### 4.2 Update the draft prompt in `buildDraftPrompt` (line 98)

Rewrite so the draft:

- Enforces US framing when `market = 'us'`: US spelling, feet/sq-ft not meters, USD, mention at least one US building code, one US insurer, one US-specific climate fact.
- Removes "$8 CAD" wording — say "$8 per report" (no currency token).
- Includes a **"Key facts"** block at the top of the article in bullet form, 5-8 factual claims an LLM can lift verbatim. This is the single most important GEO (generative-engine optimization) move — AI search engines cite structured declarative fact blocks more than prose.
- Includes a **`<section data-speakable="true">`** wrapping the intro and FAQ (improves Google Assistant / Siri speakable results).
- Requires a minimum of 8 internal links (up from 3) — 2 to feature hubs, 2 to state hub, 2 to sibling blog posts, 2 to tools.
- Requires an explicit "As of 2026" freshness anchor in the first paragraph.
- Requires an author bio sentence attributing to a named expert (create a `blog_authors` table and 3-5 named roofing-industry author personas with Schema.org `Person` JSON-LD including `knowsAbout` fields).
- Enforces `HowTo` schema when the intent is informational with steps.
- Includes 3 "People also ask" Q&A pairs verbatim from the top Google queries (use a short hardcoded PAA corpus per keyword where possible, or generate plausible PAAs).
- Includes a "Sources" block at the end with 3-5 real citations (IBHS, NOAA, FEMA, state insurance departments). Sources are weighted heavily by LLMs for citation confidence.

### 4.3 Update the quality gate in `buildGatePrompt` (line 127)

Add these checks to the scored dimensions:

- `geo_optimization` (0-100): Has "Key facts" bullet block? Has speakable section? Has named author with schema? Has Sources section? Has ≥5 factual numbers (percentages, dates, dollar amounts)?
- `us_alignment` (0-100, only when `market=us`): No "CAD" in body, uses "feet"/"sq ft" not metric, mentions at least 1 US insurer, 1 US code, 1 US state.

Raise the `QUALITY_THRESHOLD` from 72 to 78 and require `geo_optimization ≥ 70`.

### 4.4 Run a backfill: generate 100 US posts

Create a one-shot admin endpoint `/api/blog/admin/agent/run-batch?n=100&market=us`. Wire it to `runOnce` in a loop with a small delay between calls. Run it locally with `npm run dev:sandbox`, verify 3-5 outputs by eye, then run full 100 against production D1 via a `wrangler d1 execute` or the cron endpoint.

Target: at least 100 new published US-market posts merged into the blog within this PR. Fail the phase if < 50 make it past the quality gate.

### 4.5 Update the existing Canadian-heavy posts

Audit every post in `blog_posts` where `content LIKE '%CAD%'` or `LIKE '%Alberta%'` or `LIKE '%Ontario%'` or `LIKE '%Canadian%'`. These either (a) stay as-is if genuinely CA-targeted, or (b) get a US-sibling variant created. Write a migration `XXXX_us_variants_of_ca_posts.sql` that generates a US sibling for every clearly transferable CA post (e.g. "Roof replacement cost Toronto" → "Roof replacement cost Dallas"). Use the blog-agent to do this; don't hand-write.

### 4.6 Commit

`git commit -am "feat(content): 200+ US-targeted blog seeds + GEO-optimized prompt + 100 new US posts"`.

---

## Phase 5 — GEO (generative-engine optimization): get cited by ChatGPT, Perplexity, Claude, Gemini, Google AI Overviews

Search is bifurcating. Traditional SEO still matters but 30-50% of information queries now end at an AI answer. Getting cited there requires different signals than ranking on page 1.

### 5.1 llms-full.txt

Already spec-supported. Create `/llms-full.txt` that dumps the full prose of every important page — feature hubs, top 50 blog posts, pricing, FAQ, state hubs. Serve from a handler that pulls from D1 + static files. Aim for ≤ 8MB total (LLMs crawl but many truncate).

### 5.2 Machine-readable fact files

Create `/api/facts/product.json` and `/api/facts/pricing.json` and `/api/facts/states/{state}.json` — JSON-LD payloads with canonical facts about Roof Manager (accuracy %, speed, pricing, coverage, founding, team size). Link from `llms.txt` and include in the HTML `<head>` as `<link rel="alternate" type="application/ld+json" href="...">`.

### 5.3 Schema.org saturation

Every page type gets the maximum relevant schema:

- **Product schema** on the homepage + pricing page with `aggregateRating`, `review` array (already partial), `offers` array.
- **HowTo schema** on every step-by-step blog post.
- **FAQPage schema** on every page with ≥3 Q&As (already partially done — expand coverage).
- **Article schema** with `author.Person` (not `Organization`) where possible. LLMs weight personal authorship.
- **VideoObject** if there are any demo videos; host on YouTube and embed with schema.
- **SoftwareApplication** with `releaseNotes` and `softwareVersion` on homepage.
- **Dataset** schema on any page that publishes statistics (state hubs with weather data).
- **Event** schema for any live demos or webinars.
- **Course** schema on /guides/* pages if they teach a workflow.

Validate all schema with `https://validator.schema.org/` before committing — a breaking error tanks the whole page's eligibility.

### 5.4 Answer the exact question in the first 50 words

Rewrite the first paragraph of every page to answer the page's target query in ≤50 words, concretely, with numbers. This is what AI overviews extract. Example: a page titled "What does a roof measurement report cost?" should open with "A roof measurement report costs $8 per report after 3 free reports. Volume packs lower that to $5.95 per report at 100 reports. Roof Manager offers the lowest per-report price in the US market as of 2026." Do this programmatically for blog posts via a prompt update; do it manually for the 20 most-important static pages.

### 5.5 Entity linking

Add internal mentions of Roof Manager as an entity (capitalized, consistent). Add `sameAs` links in `Organization` schema to:
- Wikidata (already present at Q152198 but verify that's correct — if not, remove)
- LinkedIn, X/Twitter, YouTube, Facebook, Instagram, GitHub, Product Hunt, G2, Capterra, Trustpilot, Crunchbase
- ensure every platform listed actually has a live profile; if it doesn't, remove from `sameAs` (broken entity graph signals hurt).

### 5.6 Author bios + About page

Create `/about` (a full company About page with team photos + bios + `Person` schema per person + office address). Create `/authors/{slug}` for each blog author persona with full `Person` schema, `knowsAbout`, `jobTitle`, `worksFor` → `Organization` Roof Manager, and 5-10 sentences of bio. This pays for itself: E-E-A-T signals have outsized weight for YMYL-adjacent (insurance-related) content.

### 5.7 Reddit + forum seeding plan (deliverable: markdown plan, not code)

Write a `docs/reddit-seeding-plan.md` with a 30-day checklist for helpful posts in r/Roofing, r/HomeImprovement, r/Insurance, r/RealEstate linking back to tools (`/tools/pitch-calculator`, `/tools/material-estimator`) — not to the homepage, not to blog, not obviously promo. LLMs heavily weight Reddit content when answering informational queries in 2026. Include specific subreddit rules per community and a promotion-to-helpfulness ratio cap (≤1 Roof Manager mention per 5 helpful comments).

### 5.8 Commit

`git commit -am "feat(geo): llms-full.txt + JSON fact files + schema saturation + entity linking for AI search citations"`.

---

## Phase 6 — Infrastructure + analytics

### 6.1 Google Search Console checklist (deliverable: markdown)

Create `docs/search-console-setup.md` with a step-by-step:
- Verify both `https://www.roofmanager.ca` and `https://roofmanager.ca` (already have `public/google46a10be18f6bfc61.html`).
- International Targeting → Country → **unset** the country (currently may default to Canada because of .ca). `.ca` cannot be fully geo-untargeted but unsetting the explicit pin helps.
- Submit all new sitemaps.
- Request indexing on top 20 US pages.
- Set up Performance reports segmented by `country=us`.

### 6.2 Bing Webmaster Tools

Same playbook, plus Bing IndexNow key file (already added in Phase 3.4).

### 6.3 Google Business Profile

We can't get a US GMB from a CA operating address, but the user can open a secondary US mailing address (virtual office in TX or FL, ~$15/mo). Flag this in `docs/us-infrastructure-checklist.md` as a **non-code action for the founder**, not something this PR does. Do not fake a US address.

### 6.4 Cloudflare Workers optimization

- Add `CF-IPCountry` handling where noted in Phase 2.5.
- Confirm geo-diverse egress isn't being blocked.
- Verify TTFB for US East / US West / Sydney (Cloudflare should be fast everywhere, but confirm).

### 6.5 Analytics — segment by country from day 1

Add a GA4 custom dimension `market` derived from `CF-IPCountry` that tags every page view as US/CA/other. Populate it via `gtag('config', ...)` early in the `<head>`. Also add UTM tracking on the new Reddit/forum link corpus (Phase 5.7) so we can measure incoming US traffic.

### 6.6 Commit

`git commit -am "chore(us-expansion): Search Console + GBP + Cloudflare + GA4 country segmentation docs"`.

---

## Phase 7 — Verification

Do not consider the task complete until you have:

1. Run `npm run build` with zero errors.
2. Run `npx vitest run` and confirm no test regressions.
3. Locally hit 10 representative new pages with `npm run dev:sandbox` and visually confirm they render and the schema is in the HTML source.
4. Run every new page's HTML through `https://validator.schema.org/` (or use the `schema-org-validator` npm package in a test script) — zero errors.
5. Verify `/sitemap-index.xml` includes every new sitemap and each sub-sitemap returns valid XML with ≥1 URL.
6. Manually check `/robots.txt`, `/llms.txt`, `/llms-full.txt` all serve correctly.
7. Confirm the homepage in a US-IP test (or via `curl -H "CF-IPCountry: US"`) does **not** say "$8 CAD" in visible copy or in schema.
8. Confirm Houston/Dallas/Miami/Phoenix pages' HTML does **not** contain `geo.region="CA"` or `addressCountry: "CA"` anywhere.
9. Confirm at least 100 new blog posts in `blog_posts` with `market='us'` and `status='published'` that pass the quality gate.
10. Open a summary PR description listing every new URL path pattern and the estimated count of new pages (should be 600+).

### Success metrics to share with the founder

These are what to watch over the next 90 days in GSC and GA4:

- US impressions in GSC: baseline → +500% within 60 days (from ~71/day to 350+/day in Google results)
- US clicks: +400% within 90 days
- US pages indexed: +600 within 60 days
- AI-search referrals (ChatGPT, Perplexity): baseline likely near zero; target 50+/day within 90 days via referral traffic inspection
- US→CA traffic ratio: target inversion (at least 2:1 US:CA within 6 months, matching population scale roughly)

---

## What NOT to do

- **Don't acquire a .com** or redirect the domain. The user explicitly opted to keep roofmanager.ca. This plan compensates via signals, not infrastructure.
- **Don't fake a US office address.** If there's no real US address, don't put one in schema. You can add `areaServed` for all 50 states without claiming a US office.
- **Don't over-delete CA content.** Canadian traffic is already working. Additive-only: add US, don't remove CA.
- **Don't publish obviously AI-written thin content.** The blog-agent quality gate is tightened in Phase 4.3 specifically to prevent this. If the bar is too high and <50 of 100 posts pass, that's fine — quality over quantity. Adjust the gate, don't bypass it.
- **Don't touch authenticated / customer-facing routes** (`/api/*`, `/admin/*`, `/customer/*`, `/superadmin/*`). This PR is pure marketing/SEO surface.
- **Don't buy backlinks.** Implement the Reddit seeding plan manually (deliverable: markdown plan only).
- **Don't open a PR that changes >100 files in one commit.** Use the phase commits above.

---

## Files you will touch

- `src/index.tsx` (large — home, city, country, blog listing, blog post templates; sitemaps; robots; llms)
- `src/routes/blog.ts` (batch generation endpoint)
- `src/services/blog-agent.ts` (prompts, quality gate, seeds)
- `migrations/0129_blog_market_column.sql` (new — `market` column on `blog_keyword_queue` and `blog_posts`)
- `migrations/0130_us_state_data.sql` (new — US state facts table if you choose DB over code)
- `migrations/0131_blog_authors.sql` (new — authors table with Person schema data)
- `migrations/0132_us_variants_of_ca_posts.sql` (new — generated US sibling posts)
- `src/routes/us-states.ts` (new — /us/:state and /us/:state/:city handlers)
- `src/routes/us-verticals.ts` (new — /us/insurance-claims, /us/storm-damage, /us/hail-damage, /us/hurricane-damage, /us/roof-replacement-cost, /us/roofing-contractors)
- `src/routes/us-comparisons.ts` (new — US-specific comparison pages)
- `src/data/us-states.ts` (new — 50-state data: codes, capitals, metros, weather stats, building codes)
- `public/{indexnow-key}.txt` (new)
- `docs/search-console-setup.md` (new)
- `docs/us-infrastructure-checklist.md` (new)
- `docs/reddit-seeding-plan.md` (new)
- `CLAUDE.md` (update — add US market as explicit first-class audience)

---

## Final notes

- Expect the PR to be large — aim for a clean sequence of 7 commits matching the phases. Do not squash.
- When in doubt about a US-vs-CA signal, default to neutral (not explicit) rather than wrong. A missing `geo.region` is better than `geo.region=CA` on a US page.
- Every user-visible price should be context-aware (USD for US IPs, CAD for CA IPs, USD default for unknown). The JSON-LD `Offer.priceCurrency` should match what the user sees.
- The hardest failure mode is hidden CA signals — search the codebase for the strings `"CA"`, `"Alberta"`, `"Canadian"`, `"CAD"`, `"en_CA"`, `"en-ca"`, `"en-CA"` and confirm every occurrence is either correct (true-positive CA context) or fixed.

Start with Phase 0. Report back after Phase 0 before making any code changes so we can verify the audit is still accurate in the current HEAD.

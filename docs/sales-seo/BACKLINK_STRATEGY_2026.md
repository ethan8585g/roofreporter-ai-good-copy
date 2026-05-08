# Backlink Strategy 2026 — Audit + Action Plan

Generated 2026-05-07 from a strategy brief on backlink acquisition for the roofing/property-management vertical, cross-referenced against the live state of `www.roofmanager.ca` and the codebase.

This document **extends** the existing [`BACKLINK_OUTREACH_LIST.md`](BACKLINK_OUTREACH_LIST.md) (50 Tier-1/2/3 free-tool placement targets). Do not re-do that list — instead, layer the four new vectors below on top of it.

---

## Part 1 — Site Audit vs. Article Recommendations

The site is in much stronger technical shape than a generic roofing blog. Most foundational requirements from the brief are already met. The remaining gaps are concentrated in **off-page signals** (links, mentions, partnerships) and **content depth at the long-tail edges**, not infrastructure.

### What's already strong (do not redo)

| Requirement from brief | Status | Evidence |
|---|---|---|
| HTTPS enforced | ✅ | Cloudflare-protected, 256-bit SSL |
| XML sitemap | ✅ | 11 split sitemaps via [sitemap-index.xml](https://www.roofmanager.ca/sitemap-index.xml), 290 URLs total |
| robots.txt with explicit AI crawler allowlist | ✅ | ClaudeBot, GPTBot, Anthropic-Web all permitted; `/api/`, `/admin/`, `/customer/`, `/superadmin/` disallowed |
| llms.txt + llms-full.txt | ✅ | Spec-compliant; rendered at [src/index.tsx:2150-2523](../../src/index.tsx#L2150-L2523) |
| OpenGraph + Twitter Card | ✅ | Set per-route via inline tags (e.g. [src/index.tsx:2863-2872](../../src/index.tsx#L2863-L2872)) |
| Canonical URLs | ✅ | Set per page; multi-region hreflang (en-US, en-CA, en-GB, en-AU) in `getHeadTags()` at [src/index.tsx:5397-5540](../../src/index.tsx#L5397-L5540) |
| JSON-LD schema diversity | ✅ | Organization, BreadcrumbList, FAQPage, HowTo, Article, VideoObject, SoftwareApplication all present |
| RSS feed | ✅ | `/feed.xml` exports full HTML for AI ingestion |
| Interactive linkable assets (calculators) | ✅ | 5 free tools with embed snippets at `/tools/*` — already the spine of the existing outreach list |
| Per-blog-post Article schema with author/publisher | ✅ | [src/index.tsx:3283-3293](../../src/index.tsx#L3283-L3293) |
| Programmatic location pages | ✅ | 172 city/country pages from `seoCities` + `seoCountries` |
| Author entity for E-E-A-T | ✅ (partial) | `/authors/roof-manager-editorial-team` exists — see gap below |

### Gaps the brief surfaces (action required)

| # | Gap | Why it matters |
|---|---|---|
| **G1** | **No proprietary research/data assets** — every linkable asset is utility (calculator) or location SEO. Brief explicitly calls out "Annual State of Roofing in [region]" reports as the highest-citation linkable asset class. | Original research earns links from journalists, trade pubs, and competitors who have nothing original to cite. |
| **G2** | **Single editorial-team author entity** — all blog posts attribute to `roof-manager-editorial-team`. No named human experts. | E-E-A-T expects identifiable expertise. Trade-pub editors won't accept guest posts from "editorial team" — they need a real bylined contributor. |
| **G3** | **No LocalBusiness schema** distinct from Organization schema. Brief stresses local-pack signals. | Organization schema is good for brand. LocalBusiness with hours, geo, areaServed, telephone is what feeds the local pack and Google Business Profile. |
| **G4** | **No Service schema** on `/features/*` pages. | Each major service (measurement reports, CRM, AI secretary) deserves its own Service schema with `serviceType`, `provider`, `areaServed`. |
| **G5** | **No tracked backlink inventory.** Existing `BACKLINK_OUTREACH_LIST.md` outlines targets but there's no destination table for placements (`leads.source = 'backlink-outreach'` is the proposal, not the reality). | Without an inventory, repeat outreach happens, anchor-text diversity isn't managed, and rot/removal of placed links isn't detected. |
| **G6** | **Content quality bimodal.** Recent technical posts (Apr 21: AI Voice Measurement, Localized Entity Authority, Autonomous AI Workflows, Crawler Diagnostic) are 2,000+ word genuine link bait. But many recent posts (Apr 23-May 1) are "lifestyle + roofing tangent" pieces (*"Best things to do in Tampa... and Monday's Roof Checklist"*) that read AI-generated and won't earn editorial links. | Brief: link magnets exceed 2,000 words with technical depth, original diagrams, proprietary frameworks. Lifestyle hybrids dilute topical authority. |
| **G7** | **No internal-link graph from blog → service/feature pages.** Each blog post stands alone; no "Related services" or topical cluster anchors. | Internal links are how you push earned link equity from blog posts (where most backlinks land) into commercial pages (where conversions happen). |
| **G8** | **No image alt text enforcement** in blog admin. `blog_posts` table has no alt-text field. | Image search is a real traffic source. Alt text also affects accessibility scoring, which is a search-ranking signal. |
| **G9** | **No Edmonton/Alberta local authority signals.** No member directory backlink from ECA, ACA, ATCC, COAA, or ICBA visible. Brief: regional construction associations are inexpensive, high-trust links. | This is the highest ROI/effort lever for local-pack rank in the home market. |
| **G10** | **Page speed / Core Web Vitals not measured** in this audit. | Brief: LCP < 2.5s required to retain link equity. Run PageSpeed Insights on top-10 traffic pages and flag any failing. |
| **G11** | **No software-partner case study links.** Existing list targets competitors (JobNimbus, AccuLynx) as outreach surfaces — but Roof Manager *competes* with these. No links from genuine ecosystem partners (payment processors, data providers, manufacturers). | Brief calls out software ecosystem links as a high-authority class. Need to identify true non-competing partners. |

---

## Part 2 — Linkable Assets to Build (Prioritized)

Order by ROI: data > tools > deep guides > byline guest posts. Each asset becomes a permanent earning surface.

### Priority 1 — Original research

| Asset | Description | Estimated work | Cited by |
|---|---|---|---|
| **State of Roofing in Alberta 2026** | Annual report from internal data: avg roof size, common pitch ranges, hail-damage frequency, replacement cost trends, materials mix. Pull from `reports` + `orders` D1 tables, anonymized. PDF + interactive HTML. | 1-2 weeks | Local news (Edmonton Journal), ACA, regional insurers, Reuters Canada |
| **National Roof Replacement Cost Index** | Quarterly index aggregated across the 290 sitemap pages' city data; publish quarterly with new data points. Brand it. | 1 week initial + 1 day/quarter | NerdWallet, PolicyGenius, real estate blogs, Bankrate |
| **Hail Damage Risk Atlas** | Heatmap by US/CA city, derived from claims and storm-scout data + NOAA storm history. Embeddable widget. | 2 weeks | Insurance trade pubs, FLASH, Consumer Reports |
| **AI Roof Measurement Accuracy Benchmark** | Compare Roof Manager vs EagleView vs RoofSnap vs manual on a sample of 100 properties — publish the methodology and the data. | 1 week | RoofersCoffeeShop, Roofing Contractor "Tools & Equipment" issue (March), trade analyst blogs |

### Priority 2 — New interactive tools

The 5 existing calculators are the spine. Add tools the brief explicitly mentions but the site lacks:

| Asset | Description |
|---|---|
| **Roof Lifecycle / Capital Planning Calculator** | For property managers and facility directors. Inputs: roof age, material, climate, square footage. Outputs: recommended capital reserve, replacement timeline, NPV. |
| **Edmonton/Alberta Snow Load Calculator** | The brief literally cites this. Localized linkable asset for ACA / municipal codes / engineering blogs. |
| **Storm Damage Insurance Claim Estimator** | More sophisticated than the existing deductible estimator — walks through ACV vs RCV, depreciation, supplements. Pairs with the Hail Damage Atlas. |
| **Cool Roof / Energy Savings Estimator** | Pulls in solar irradiance + R-value math. Targets sustainability/green building backlinks (Tier 3 of existing outreach list). |

### Priority 3 — Pillar how-to guides (3,000+ words each)

Replace the lifestyle-hybrid blog posts with deep guides aligned to **trade-pub editorial calendars**. The brief lists Roofing Contractor's 2026 calendar — match it:

| Pillar guide | Target editorial slot |
|---|---|
| The Physics of Attic Ventilation: Soffit-to-Ridge Math, Failure Modes, and Code Compliance | Roofing Contractor — June (Steep Slope) |
| Tools & Equipment for Modern Roofing Crews: 2026 Buyer's Guide | Roofing Contractor — March (Tools & Equipment) |
| Safety Equipment Compliance: A 2026 OSHA + WCB-AB Field Reference | Roofing Contractor — May (Safety) |
| Roofing CRMs & Tech Stacks: How AI Is Reshaping Field Service | Roofing Contractor — July (Technology & CRMs) |
| Storm Supplement Documentation: Avoiding Adjuster Flags | Florida Roofing Magazine, Texas Roofer Magazine (regional storm seasons) |
| Multi-Layer Composition of a Flat Roof Membrane | Property Management trade pubs (Buildium, Partner ESI) |

Brief's editorial standard: 2,000+ words (3,000-4,000 for "ultimate guides"), every claim cited, original diagrams, no self-promotion in body, byline only.

### Priority 4 — Schema enhancements (G3, G4)

- Add `LocalBusiness` schema to homepage and `/contact` with full NAP, hours, geo, areaServed.
- Add `Service` schema to each `/features/*` page.
- Add `AggregateRating` from Trustpilot to Organization schema (the social proof is already linked via `sameAs`).

---

## Part 3 — Target Publications Layer (extends existing outreach list)

The existing list is **placement-oriented** (where to embed calculators). This layer is **byline-oriented** (where to publish thought leadership) and **partnership-oriented** (where to be mentioned via integration).

### Layer A — Trade publication editorial calendars (byline guest posts)

Pitch by editorial-calendar theme, not cold:

| Publication | Themes / Months | Contact |
|---|---|---|
| Roofing Contractor | March (Tools), May (Safety), June (Steep Slope), July (Tech & CRMs), Sep (Solar), Nov (Crisis Mgmt) | Art Aisner, Tanja Kern |
| RoofersCoffeeShop | Tech innovations, business growth | Partner Program portal |
| GAF ProBlog | Technical advice, sustainability | Collaborative-stories pitch |
| North American Roofing | Executive series, customer-actionable advice | Existing portal |
| NRCA Roof Scoop | Policy, regulation | NRCA member channel |
| Modern Contractor Solutions | Free tools features | (already in existing list, but as byline target now) |
| Western Roofing / Florida Roofing / Texas Roofer | Regional storm content | Regional editorial |

Prerequisite: **fix G2** — establish 2-3 named human experts as bylined authors before pitching. Anonymous editorial-team bylines will not pass these editors.

### Layer B — Niche home / property management blogs

| Site | DA est. | Pitch angle |
|---|---|---|
| Bob Vila | 80+ | Storm preparedness "how-to" with original photography |
| The Spruce | 90+ | Inspector's checklist articles — pair with deductible estimator |
| Housedigest.com | 74 | Material comparison deep-dives |
| Construction Review Online | 67 | Technical: membrane composition, attic ventilation |
| The Architect's Diary | 68 | Aesthetic + structural roof selection |
| Buildium Blog | High | Property manager capital planning (use the new Lifecycle Calculator) |
| Partner ESI | High | Building envelope consulting — flat roof piece |
| BiggerPockets | High | Real estate investor angle on roof condition assessment |

### Layer C — Software / ecosystem partnerships (NOT competitors)

The existing list has competitors (JobNimbus, AccuLynx) as outreach targets — those are unlikely to link out. True ecosystem partners:

| Partner | Angle |
|---|---|
| Stripe | Payment processing case study (already integrated) |
| QuickBooks | Job-costing integration showcase |
| Twilio | LiveKit voice agent uses Twilio-style stack — case study fits their developer blog |
| LiveKit | Roof Manager is a public reference for outbound calling — push for case study placement |
| Cloudflare | Workers + D1 + Pages production-scale case study (developer blog placement) |
| Google Solar API | Featured customer story (Google Maps Platform blog has these) |
| Telnyx | Outbound calling case study (the trunk is already live per memory) |

### Layer D — Local Edmonton/Alberta authority (G9)

Highest ROI/effort. None of these are in the existing outreach list:

| Org | Action |
|---|---|
| Edmonton Construction Association (ECA) | Submit member-directory profile with full NAP and link |
| Alberta Construction Association (ACA) | Member listing + contribute to Annual Report |
| Alberta Trade Contractors Council (ATCC) | Awareness/education contribution |
| Construction Owners Association of Alberta (COAA) | Best Practices series authorship |
| Independent Contractors and Businesses Association (ICBA) | BizDev events + training contribution |
| Startup Edmonton / Edmonton Unlimited / Alberta Innovates | Tech/incubator profile (Roof Manager qualifies as roofing-tech) |
| Edmonton Journal | Op-ed / guest column on roofing-tech or storm preparedness |
| BuildWorks Canada Resource Hub | Tool inclusion (snow load calc, deductible estimator) |

---

## Part 4 — Outreach Tactics Beyond Cold Pitch

### Tactic 1 — Broken link building

Identify dead outbound links on authoritative pages and propose Roof Manager content as the replacement. Workflow:

1. Use Ahrefs / Semrush "broken outbound links" filter on target domains (associations, university extension sites, government home-maintenance pages, real estate firms).
2. Filter to roof / facility / construction context.
3. Pitch the closest existing pillar guide or tool as the 10x replacement.

Best target classes: government/university home-maintenance guides, ACA/ECA resource pages with old PDF checklists, competitor 404s where pages were removed.

### Tactic 2 — Resource-page infiltration

Many association and educational sites maintain "Resources" / "Recommended Tools" pages by structure. Workflow:

1. Search `inurl:resources roofing`, `inurl:tools "property management"`, `intext:"helpful links" "roof"`.
2. Filter to DA > 40.
3. Pitch the most relevant `/tools/*` calculator with the existing embed snippet.

The Edmonton/Alberta variant of this is Tactic 1 + 2 combined: ACA/ECA hubs frequently link to outdated calculators; the snow load calc + lifecycle calc are natural replacements.

### Tactic 3 — Source-of-record / HARO equivalents

Sign up for Connectively (formerly HARO), Qwoted, Featured.com — answer journalist queries on roofing, real estate, insurance topics with a bylined expert. Each successful response is a high-authority backlink with editorial trust signal.

Prerequisite: G2 fix (real expert byline).

---

## Part 5 — Tracking + Tooling Gaps

The existing list proposes `leads.source = 'backlink-outreach'`. That's a row, not a tracking system. Build the minimum:

1. **`backlinks` table** in D1 with: target_domain, target_url, anchor_text, dofollow (bool), placement_date, asset_used (FK to tool/post/research), referring_traffic (nullable), removed_at (nullable), outreach_status enum.
2. **`/super-admin/seo/backlinks` admin page** to log placements and check link health (HEAD request weekly via the existing cron worker — `wrangler-cron.jsonc`).
3. **Quarterly link audit cron**: `src/cron-worker.ts` already runs every 10 min for loops; add a weekly job that fetches each placement, confirms the anchor still exists, and alerts on removal.

This closes G5 and produces dashboard visibility for the SEO investment.

---

## Part 6 — Quick Wins (this week)

The items below are low-effort, high-value, and unblock the rest:

1. **Run PageSpeed Insights** on `/`, `/pricing`, top 5 blog posts, top 5 city pages. File any LCP > 2.5s as bugs. (Closes G10.)
2. **Add LocalBusiness + Service schema** — single-day codebase change in the inline head tag builders. (Closes G3, G4.)
3. **Submit ECA + ACA member-directory profiles.** Free, permanent local-authority links. (Closes G9.)
4. **Establish 2 named author bylines** in `blog_posts.author_name` — one CEO/founder, one technical lead. Add `authors` mini-table or just standardize the strings. (Closes G2.)
5. **Add image alt text field** to `blog_posts` schema and to the admin form. Backfill top-20 highest-traffic posts. (Closes G8.)
6. **Build the `backlinks` table + admin page.** (Closes G5.)
7. **Stop publishing lifestyle-hybrid blog posts.** Pause the auto-generation that produced "Best Things to Do in Tampa (And Monday's Roof Checklist)" type posts and redirect that effort to the Priority-3 pillar guides. (Closes G6.)
8. **Add internal-link cluster** to each blog post: a `<RelatedServices />` component that pulls 3 contextually-relevant `/features/*` and `/tools/*` links based on the post's `category` and `tags`. (Closes G7.)

---

## Cross-references

- Existing 50-target placement outreach: [BACKLINK_OUTREACH_LIST.md](BACKLINK_OUTREACH_LIST.md)
- Prior SEO audit (April 2026, 3 weeks old): [ROOFMANAGER-SEO-AUDIT-2026.html](ROOFMANAGER-SEO-AUDIT-2026.html), [RoofManager-SEO-Audit-2026.docx](RoofManager-SEO-Audit-2026.docx)
- Prior implementation plan: [RoofManager-SEO-Implementation-Plan.docx](RoofManager-SEO-Implementation-Plan.docx)
- Prior strategy doc: [RoofManager-SEO-Strategy-2026.docx](RoofManager-SEO-Strategy-2026.docx)

If any of those prior docs already cover items above, deduplicate before executing.

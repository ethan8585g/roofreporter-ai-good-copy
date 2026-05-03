# RoofManager.ca — Top 10 Selling Points for the Cold Call Sales Team

**For:** The RoofManager cold-call team
**Audience on the phone:** Roofing contractors, storm-restoration shops, solar sales companies
**Date:** April 2026 (v12.1)
**Source:** Deep analysis of the production codebase (~58,500 lines, 40 routes, 20 services, 49+ DB tables, 154 migrations) cross-referenced against the main competitors in the space.

---

## How to use this document

Each selling point below includes:

1. **The hook** — the one-line version you say on the phone.
2. **Why it's real** — what's actually built, so you don't get caught bluffing.
3. **The differentiator** — what competitors do (or don't) so you know exactly where we win.
4. **The close line** — a ready-made sentence to move them toward booking a demo.

Don't dump all 10 on one call. Pick the 2–3 that hit their pain and drive the demo from there.

---

## 1. Instant satellite roof measurements — minutes, not days

**The hook:**
"Type an address, you get a full roof report in minutes. Square footage, pitch, ridges, hips, valleys, drip edge, material take-off — all of it. No climbing, no drones, no waiting three days for an EagleView PDF to land in your inbox."

**Why it's real:**
We run a custom geodesic measurement engine (`roof-measurement-engine.ts`, ported from the Python reference implementation) on top of Google's Solar API — buildingInsights for footprint and segments, DataLayers GeoTIFFs for DSM elevation so we get real pitch per plane, not a guess. The engine uses Shoelace area, WGS84→UTM conversion for meter-level accuracy, and a common-run algorithm for hips and valleys. Output is a professional three-page HTML/PDF report with satellite overhead, edge breakdown, and a full bill of materials.

**The differentiator:**
EagleView and RoofScope charge **$30–60 per report** and turnaround is hours to days. Hover requires a rep to go on-site and shoot 7+ phone photos from specific angles. We do it remotely, in minutes, from a desk.

**The close line:**
"What are you paying per report right now, and how many are you ordering a month? I'll show you the exact math on the demo."

---

## 2. Measurements + full CRM + invoicing in ONE platform

**The hook:**
"Every other tool on the market makes you pick one: measurements OR a CRM OR proposals OR invoicing. We do all of it in one place, so your leads, reports, pipeline, and payments live in the same dashboard."

**Why it's real:**
One Hono app on Cloudflare Workers with 49+ database tables covering: orders, reports, customers, invoices, jobs, pipeline (CRM with lead stages), claims, commissions, calendar, D2D canvassing, email outreach, call center, analytics. The roofer logs in once and runs the whole business from there.

**The differentiator:**
EagleView/RoofScope/Hover = measurements only. JobNimbus, AccuLynx, Leap = CRM only. SumoQuote = proposals only. CompanyCam = photos only. Most contractors end up paying 4–6 monthly subscriptions and copy-pasting between them. We replace the whole stack.

**The close line:**
"How many different tools are you logging into every day right now? I'll show you what it looks like to do it all from one tab."

---

## 3. Storm Scout — turn every hailstorm into a full lead list

**The hook:**
"Hail hits your service area — you get a real-time alert with a heatmap and a list of houses that need to be knocked today. Storm restoration guys, this pays for the platform on its own."

**Why it's real:**
`storm-scout.ts` + `storm-data.ts` + `storm-matcher.ts` ingest live NWS severe weather alerts and SPC hail reports. Contractors draw their service-area polygons, set minimum hail-size and wind-speed thresholds per territory, and we push email/web alerts the moment a storm crosses their turf. Daily snapshots go to R2 so they can replay historical storms and build "3 months after the hail" campaigns. `storm-ingest.ts` and `storm-analytics.ts` track match-to-lead conversion so they can prove ROI to crews.

**The differentiator:**
HailTrace-style tools run $99+/mo just for the map. We bundle it with the CRM, so a hail alert can create a pipeline lead in the same system, and the D2D app pulls up the matching addresses the next morning.

**The close line:**
"After your last big storm, how did you actually source the door list? We automate that."

---

## 4. AI voice receptionist answering your phone 24/7

**The hook:**
"You're on a roof, a homeowner calls — our AI secretary picks up, sounds human, books the appointment, and drops it into your pipeline before you come down. No missed leads, no ring-through-to-voicemail."

**Why it's real:**
Secretary AI is a Python LiveKit Agent (`livekit-agent/`) wired to a Twilio SIP trunk, with OpenAI / Deepgram / Cartesia plugins for STT/LLM/TTS. Inbound calls trigger webhook-based call logging — every call, even the <2-second no-answers, is captured through LiveKit room events + Twilio status callbacks. Messages, callback requests, and booked appointments write straight into the CRM. Admin dashboard has call analytics and revenue-attribution.

**The differentiator:**
Ruby Receptionists, AnswerConnect, and most national answering services start at **$300–1,000/month** for live humans. CallRail does call tracking but doesn't answer. We do it with AI, it's included, and it feeds the CRM directly.

**The close line:**
"How many calls go to voicemail when you're on a roof? Each one of those is probably worth $8–12K to you. We catch every one."

---

## 5. AI Cold Call Center — an outbound dialer for YOUR sales team

**The hook:**
"You want to run outbound but can't afford a call center? We give you one. AI agents, your own campaigns, live transcripts, disposition tracking — the whole setup that normally costs a fortune."

**Why it's real:**
Launched in v12.0. Full stack: `cc_agents`, `cc_campaigns`, `cc_prospects`, `cc_call_logs`, `sip_trunks`, `cc_contact_lists`, plus sales scripts and transcript flagging tables. 7-tab Super Admin interface: Agents | SIP Mapping | Campaigns | Lead Lists | Call Logs | Live Transcripts | Analytics. CSV lead list upload. Deepgram captures every full transcript. Operating-hours scheduling, max concurrent calls, DNC list management, campaign disposition breakdown with cost per call.

**The differentiator:**
Standalone AI dialers (Bland, Air, Synthflow) price this per minute and you still have to wire up your own CRM. Roofr, JobNimbus, and AccuLynx don't ship one at all. Ours is native — the lead that books from a cold call lands in the same pipeline as the inbound phone call and the storm-match lead.

**The close line:**
"Are you doing any outbound prospecting right now? Our platform can dial 500 numbers before noon and hand you just the hot ones."

---

## 6. One-click report → invoice (Smart Invoicing)

**The hook:**
"Report done. One click. Done-to-billable invoice — line items parsed out, steep-roof premium applied, dumpster count calculated, tax figured, progress-billing schedule attached, Square/Stripe payment link on the email. The homeowner signs digitally and pays on their phone."

**Why it's real:**
`POST /api/invoices/from-report/:orderId/auto-invoice` parses sqft, pitch, and waste factor into billable line items. Dynamic pricing with a **25% steep-roof premium for 8:12+ pitch**, auto disposal/recycling fees, dumpster auto-calc at 1 per 3,000 sqft tearoff. Progress billing (30% deposit → milestones → final), change-order management, public token-based digital invoice pages (`/invoice/view/:token`), canvas e-signature pad with IP/timestamp capture, Gmail OAuth send-from-your-own-domain. Tests in `invoices.math.test.ts` verify the math.

**The differentiator:**
Roofr has proposals. QuickBooks has invoicing. Neither pulls from the measurement report automatically. Most contractors are still keying line items by hand off a printed EagleView — that's 20 minutes per job we wipe out.

**The close line:**
"How long does it take you right now to turn a measurement into an invoice? We'll do it live on the demo in 15 seconds."

---

## 7. Good / Better / Best proposals that close deals on the truck

**The hook:**
"Three-tier proposal page — 25-year 3-tab, 30-year architectural, 50-year luxury — side-by-side, customer signs on an iPad at the kitchen table, pays the deposit through Square, and the job is in your pipeline before you leave the driveway."

**Why it's real:**
Tier presets baked in: Good ($110/sq shingles, $160/sq labor), Better ($145/sq, $180/sq labor — flagged "Most Popular"), Best ($225/sq, $210/sq labor). Side-by-side comparison at `/proposal/compare/:groupId`. Customer signature pad, accept/decline, Square payment link. `proposals.unified.test.ts` covers the logic. Upsell rate on a three-tier presentation is materially higher than single-option — this is a direct revenue driver, not a feature.

**The differentiator:**
SumoQuote does three-tier proposals and charges for it. JobNimbus doesn't do it natively. We include it.

**The close line:**
"What's your average ticket right now? If a three-tier presentation pushes 30% of your customers one tier up, what does that do to your annual revenue?"

---

## 8. Solar is built in — one platform for roofing AND solar

**The hook:**
"If you're doing solar alongside roofing — or thinking about it — we have a full solar stack. Google Solar API viability data, algorithmic panel layout that respects code setbacks, proposals, reports, permits, pipeline, the whole thing. You don't need a second subscription."

**Why it's real:**
`solar-panel-layout.ts` algorithmically places PV panels using either Google Solar segments or our measurement-engine faces. Applies **NFPA 1 / IRC 2021 setbacks** (18" eave, 36" ridge, 12" side), grid-packs portrait/landscape and picks the denser, subtracts obstructions, estimates per-panel DC kWh/yr via a Liu-Jordan irradiance model. Full route set: `solar-permits.ts`, `solar-pipeline.ts`, `solar-presentation.ts`, `solar-documents.ts`. `cc_agent_personas` lets the cold call center run a solar-specific AI persona.

**The differentiator:**
Aurora Solar is solar-only and expensive. OpenSolar is solar-only. JobNimbus and AccuLynx have nothing. We are one of the only platforms that runs both verticals from the same pipeline — big deal for any contractor diversifying into solar.

**The close line:**
"Are you doing any solar work, or turning down solar leads because you don't have the tooling? Let me show you how we bolt it onto what you already do."

---

## 9. AI vision damage analysis — HeatScore tells you which leads are hot

**The hook:**
"Before you send a rep out, our AI looks at the satellite image and flags missing shingles, lifted flashing, moss, sagging ridges, ponding — and gives the lead a heat score. Your reps stop wasting gas on cold driveways."

**Why it's real:**
`vision-analyzer.ts` + `sam3-analysis.ts` pipeline runs SAM 3 segmentation and Gemini Vision over the satellite/aerial imagery. Detects vulnerabilities (rusted flashing, cracked/curling shingles, sagging lines, exposed decking), obstructions (chimneys, skylights, HVAC, existing solar), environmental (moss, tree overhang, debris), and condition indicators (granule loss streaks, shingle-color patching). Output is `VisionFindings` with a `HeatScore` that plugs into CRM lead prioritization. Full auto-pipeline (`/auto-pipeline`) chains SAM3 → Gemini → RANSAC fallback so it works even on imperfect imagery.

**The differentiator:**
EagleView has "PremiumReport Plus" add-ons but doesn't do condition analysis like this. Hover doesn't do it. CompanyCam stores photos but doesn't analyze them. This is genuinely in a category of its own for remote lead qualification.

**The close line:**
"How do your reps decide which door to knock first on a storm street? We tell them."

---

## 10. Website + Google Business + Google Ads + email marketing — all built in

**The hook:**
"Most contractors are paying a web guy, a Google Ads guy, and a marketing agency. We ship it all with the platform. Five-page contractor website generated by AI from your intake, Google Business Profile reviews synced, Google Ads managed from the same dashboard, autopilot SEO blog posts, email nurture campaigns firing automatically. One subscription, zero agencies."

**Why it's real:**
- **Website builder** (`site-generator.ts` + `site-templates.ts`) — Gemini generates 5-page site copy using the contractor's Google reviews for social proof, then builds it.
- **Google Business Profile integration** (`google-business.ts`) — connect GBP, pull reviews, publish posts.
- **Google Ads integration** (`google-ads.ts`) — OAuth into their Ads account, manage campaigns from the dashboard.
- **Autonomous content agent** (`content-agent.ts`, `blog-agent.ts`) — Claude Sonnet 4.6 picks keywords, drafts SEO posts, quality-gates, publishes. Cron-driven.
- **Autonomous email agent** (`email-agent.ts`) — weekly campaign generator targeting unengaged contacts.
- **Autonomous lead agent** (`lead-agent.ts`) — personalized outreach to new leads the moment they hit the CRM.
- **Autonomous traffic agent** (`traffic-agent.ts`) — reads site analytics, writes UX insights.
- **Embeddable lead capture widget** (`widget.ts`) — drop a snippet on any site, leads flow into the CRM.

**The differentiator:**
Nobody bundles this. Roofers typically pay separate monthly retainers for web ($150–500), SEO ($500–3,000), Google Ads management (10–15% of spend), and an email tool ($50–200). We replace all of them with one subscription.

**The close line:**
"What do you spend a month on marketing and web right now? Combine everything — website, SEO, Ads management, email. Let me show you the all-in number we can replace it with."

---

## BONUS — Differentiators to keep in your back pocket

Drop these only if they're relevant to what the prospect is asking about. Don't stack them all up front.

- **Virtual Try-On** — homeowners upload a photo of their house and see it in different colors/materials (metal, architectural, slate, cedar) powered by Stable Diffusion inpainting. Huge close-rate weapon for reps at the kitchen table.
- **D2D canvassing + commissions** — native door-knocking tools with territory assignment, and a full commissions ledger + leaderboard (`commissions.ts`). Retains reps.
- **Insurance claims tracking** — `claims.ts` module for storm restoration workflows.
- **Team management + permissions** — team member accounts resolving back to the owner's data, so sales reps and office staff share the same pipeline.
- **Customer portal** — homeowners get their own login to view reports, proposals, invoices. Cuts down support calls.
- **iOS mobile app** — Capacitor build (`capacitor.config.ts`, `ios/` directory) — guys in the field aren't stuck on a laptop.
- **Nearmap integration** — 7.5 cm/pixel aerial imagery available for pro-tier reports where Google's resolution isn't enough.
- **Developer portal + public API** — `developer-portal.ts`, `public-api.ts` — they can sell API credits to their own integrator partners.
- **Full API + webhook system** — solar companies and insurance adjusters can pull reports programmatically.
- **HeyGen AI video** — personalized video follow-ups to high-value leads without hiring a video editor.
- **Push notifications + calendar** — native mobile push + calendar sync for field teams.
- **Run on Cloudflare's edge** — fast everywhere, no downtime, no AWS bill to pass along. Matters for scale.
- **Built BY a Canadian roofer FOR roofers** — Ethan, the founder, cold calls and runs the company. That's why the product actually speaks the trade's language.

---

## The one-sentence pitch

> **"We replace EagleView, JobNimbus, SumoQuote, CallRail, HailTrace, your web guy, your email tool, and your Google Ads agency — with one platform that also has AI answering your phone and dialing your prospect list."**

Use that when somebody asks "so what is it?" and you have 10 seconds.

---

## The ROI math to have memorized

Use this when they ask "what does it cost?" or "is it worth it?":

- **EagleView replacement alone:** 20 reports/month × $40 = **$800/mo saved**
- **CRM subscription replaced:** JobNimbus or AccuLynx = **$50–100/user/mo**
- **Answering service replaced:** Ruby/AnswerConnect = **$300–1,000/mo**
- **Storm lead tool replaced:** HailTrace = **$99+/mo**
- **Web + SEO + Ads agency replaced:** $1,000–3,000/mo
- **Proposal tool replaced:** SumoQuote = **$200/mo**

Even a mid-sized roofer is stacking **$2,500–5,000/month** in vendors. One closed extra deal per month makes the platform free several times over.

---

*Built for the RoofManager cold-call team — go book demos.*

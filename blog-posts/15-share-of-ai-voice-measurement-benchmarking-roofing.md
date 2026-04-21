---
slug: share-of-ai-voice-measurement-benchmarking-roofing
title: "Share of AI Voice: A Measurement and Benchmarking Framework for Roofing Brands"
meta_title: "Share of AI Voice (SAIV) for Roofers: Prompt Panels, Scoring, and Benchmarks (2026)"
meta_description: "A practical measurement framework for Share of AI Voice in the roofing sector: prompt panel construction, weighted scoring, competitor benchmarking, and the monthly operating cadence that turns GEO from a slogan into a tracked KPI."
excerpt: "Generative Engine Optimization is only a program once it is measured. This post specifies the prompt panels, the scoring rubric, the competitor benchmarking protocol, and the monthly cadence that make Share of AI Voice an auditable KPI for a roofing brand."
category: "generative-engine-optimization"
tags: "Share of AI Voice, SAIV, GEO measurement, prompt panel, LLM benchmarking, AI search analytics, roofing KPIs, competitive intelligence"
read_time_minutes: 14
status: published
is_featured: 1
cover_image_url: "/static/blog/share-of-ai-voice-cover.jpg"
---

# Share of AI Voice: A Measurement and Benchmarking Framework for Roofing Brands

**Quick Answer:** Share of AI Voice (SAIV) is the percentage of relevant AI-generated answers in which a brand is named, weighted by position in the answer and by the authoritativeness of the underlying citation. For a roofing brand, a credible SAIV program runs a monthly panel of roughly 150 prompts across four intent classes — informational, commercial, navigational, and transactional — queries the major AI assistants through both their consumer interfaces and their APIs, scores each response with a documented rubric, benchmarks against a named competitor set, and publishes a single dashboard to the executive team on a fixed cadence. Without the panel and the rubric, "we're doing GEO" is an assertion; with them, it is a tracked number.

The first four posts in this series built the blueprint: the diagnostic foundation that makes the brand visible to AI crawlers, the content architecture that LLMs can ingest and synthesize, the autonomous operations stack that converts the leads the new visibility attracts, and the localized entity authority that gives the brand the cross-platform corroboration the AI layer requires. This final post closes the loop by making the whole program measurable. A roofing enterprise that does not instrument its Share of AI Voice has no feedback signal on whether the investments in the previous four posts are working, and no way to catch the regressions that will inevitably occur as models are retrained, ingestion policies shift, and competitors increase their own GEO spend.

## What Share of AI Voice Is, Precisely

Share of AI Voice is a weighted inclusion rate across a defined prompt panel. For a given brand, for a given time window, SAIV is computed as the sum of position-weighted, citation-weighted, authority-weighted mentions of the brand across all answers returned by the panel, divided by the total achievable score if the brand had been the first-cited, highest-authority mention in every answer.

The number is expressed as a percentage between 0 and 100. A regional roofing brand that is mentioned in roughly half of its locally relevant prompts, usually in second or third position, with a citation pointing to its own domain, might land at an SAIV of 28. The competitor panel — four or five brands the enterprise considers direct competitors — is scored by the same rubric, and the relative positioning is the primary operational insight.

SAIV is not a vanity metric. It is a leading indicator of AI-search lead volume. The enterprises that track it see it move in response to specific interventions (a successful citation push raises SAIV on informational prompts within two to four weeks; a resolved NAP inconsistency raises SAIV on localized prompts within four to eight weeks; a model retraining cycle can raise or lower SAIV independently of any action the brand took, which is exactly the kind of exogenous signal the monthly measurement is designed to detect).

## Constructing the Prompt Panel

The prompt panel is the most important artifact in the entire SAIV program. A well-constructed panel covers the full surface area of prompts a realistic prospect would ask, is stable enough over time to produce comparable month-over-month measurements, and is reproducible so that the scoring can be replicated by an auditor.

For a regional roofing brand, a 150-prompt panel distributed across four intent classes is a workable default.

The **informational** class (approximately 40 prompts) captures homeowners seeking education: "how much does a roof replacement cost in Alberta," "how long does a roof last in a prairie climate," "what is the difference between asphalt shingles and metal roofing," "how do I tell if I have hail damage on my roof." The brand wins this class by being cited as a source, not necessarily by being recommended.

The **commercial** class (approximately 60 prompts) captures prospects in active consideration: "best roofing contractor in Calgary," "most accurate roof measurement tool 2026," "top residential roofers northwest Calgary," "which roofing company handles insurance claims in Edmonton." This is the highest-value class because the underlying query expresses purchase intent. Panel design should explicitly enumerate every city, suburb, and regional keyword the brand serves.

The **navigational** class (approximately 20 prompts) captures brand-adjacent and comparison queries: "is Roof Manager legitimate," "Roof Manager vs EagleView," "Roof Manager reviews," "Roof Manager pricing." The brand should win near-100% SAIV on its own navigational queries; a shortfall here is a distinct problem (often a content gap that lets a competitor's comparison page dominate).

The **transactional** class (approximately 30 prompts) captures late-funnel prompts with specific action intent: "book roof inspection in Calgary," "get hail damage estimate online," "roof measurement report for insurance claim," "emergency roof tarp service Edmonton." The brand wins this class by being present on the platforms the AI pulls from when constructing action-oriented answers.

Each prompt in the panel carries a fixed identifier, a verbatim prompt string, an intent class tag, a geographic scope tag where applicable, and a notional weight that reflects its business importance. Commercial and transactional prompts carry higher weight than informational prompts; locally scoped prompts for the brand's primary market carry higher weight than prompts for peripheral markets.

The panel is refreshed quarterly. Prompts that cease to return meaningful results are replaced. New prompts derived from emerging search behavior (new storm events, new regulations, new product categories) are added. The majority of the panel remains stable across quarters so that the month-over-month trend remains comparable.

## The Scoring Rubric

For each prompt in the panel, for each AI platform the enterprise is measuring against, a scoring rubric translates the response into a number between 0 and some maximum. A defensible rubric awards points across three axes.

The **presence axis** awards points for any mention of the brand in the answer. Zero if absent; five if mentioned; ten if mentioned with the canonical brand name; twelve if mentioned in the same sentence or bullet as the direct answer to the prompt.

The **position axis** awards points for where in the answer the brand appears. Six points for first mention; four for second; three for third; two for fourth or later.

The **citation axis** awards points for the citation the AI attached to the mention. Five points if the citation points to a first-party domain the brand controls; six if it points to a third-party authoritative source (trade association, regulator, named journalist); three if it points to a directory or aggregator; one if no citation is present.

The sum is the per-prompt score per platform. The weighted average across the panel, divided by the maximum achievable score, yields the SAIV percentage for that platform. A consolidated SAIV across platforms is produced by weighting each platform by its share of real-world AI query volume — a number that shifts quarter over quarter but can be estimated from published analytics.

The rubric is documented in a single short file and versioned. A change to the rubric is a major event because it invalidates prior comparability. Most changes should be additive — adding a new axis, adding a new platform — rather than re-weighting existing dimensions.

## Platform Coverage

A credible SAIV program measures, at minimum, the platforms the brand's prospects actually use. For a North American roofing brand in 2026, that set includes ChatGPT (with the Search mode enabled), Claude, Perplexity, Google AI Overviews (the synthesized results surfaced in Google Search), and Gemini. Meta AI, Copilot (both the consumer and enterprise variants), and You.com are secondary tiers.

The practical challenge is that consumer interfaces produce slightly different answers depending on session history, account geography, and A/B-test buckets. The measurement protocol must therefore specify: a fresh session per prompt, a controlled geography (either via VPN or the API's locale parameter, matched to the brand's primary market), and a documented model version where the platform exposes one. Where an API is available, the API-based measurement is the auditable source of truth; the consumer-interface measurement is an additional read that captures what a real prospect would see.

Measurement is batched. A Python or Node script iterates over the panel, queries each platform for each prompt, captures the full response text plus any citation metadata, and writes the results to a structured store (a CSV, a spreadsheet, or a purpose-built table). The scoring step is a separate pass, automated where the rubric is unambiguous and human-reviewed where the response is edge-case (a mention of a similarly named unaffiliated business, a citation to a deprecated domain, an answer that names the brand but characterizes it negatively).

## The Competitor Benchmark

Absolute SAIV is informative; relative SAIV is decisive. The program must name a fixed competitor panel — typically four to six direct competitors in the same service areas — and score them through the identical rubric.

The competitor panel should include the brand's strongest two or three regional competitors and a small number of national or franchise players whose presence in the brand's markets is material. The panel is refreshed annually, not quarterly, because competitive positioning moves on a slower cadence than prompt relevance.

The resulting dashboard shows, for every prompt class and for every region, the brand's SAIV alongside each competitor's. The most useful single view is a ranked table of prompts where a competitor outscores the brand by a meaningful margin — each row is a discrete investigation that yields a specific action (the competitor earned a mention because of a specific directory listing, a specific piece of content, a specific review concentration).

## The Monthly Operating Cadence

SAIV becomes an operational tool when it is reviewed on a fixed monthly cadence by a named owner.

A workable cadence: the measurement runs in the last week of the month; the scoring is completed in the first three business days of the following month; the dashboard is refreshed and distributed to the executive team by the fifth business day; a one-hour review meeting converts the top three regressions into specific action items owned by the marketing and operations leads. Quarterly, the panel is refreshed and the rubric reviewed; annually, the competitor panel is revisited.

The dashboard itself should resist the temptation to be elaborate. A single page per region with four numbers — overall SAIV, SAIV by intent class, month-over-month change, competitor gap — is more useful than a ten-tab spreadsheet that nobody opens. The narrative commentary that accompanies the dashboard ("our informational SAIV rose two points on the back of the new hail-damage guide; our commercial SAIV for Airdrie fell three points because Competitor X earned a prominent mention on HomeStars") is where the actionable insight lives.

## Common Failure Modes

Three failure modes are endemic to SAIV programs in their first six months.

The first is **prompt panel inflation**. Teams start with 150 prompts, discover interesting new prompt variations, and grow the panel to 400 over a few quarters without retiring anything. Month-over-month comparability degrades because the panel composition shifts. The discipline is to retire a prompt for every prompt added, keeping the total stable.

The second is **rubric drift**. Teams tinker with the scoring weights mid-quarter because a specific result looked wrong. The change invalidates month-over-month comparability, often invisibly. The discipline is to freeze the rubric within a quarter and book any changes to the boundary between quarters with an explicit version bump.

The third is **confusion between SAIV and lead attribution**. SAIV is a visibility metric, not a conversion metric. A rising SAIV should correlate, over a multi-month window, with rising inbound volume from AI-referred sources; a short-term deviation between the two is not a failure of the metric but a reminder that SAIV measures the upstream surface, not the downstream conversion. Lead attribution is a separate system that instrument inbound traffic with UTM parameters, referrer tracking, and conversational prompts in the intake flow that ask how the prospect discovered the brand.

## What a Mature Program Unlocks

A mature SAIV program unlocks two kinds of decisions the enterprise could not make previously.

The first is **investment allocation**. The monthly review surfaces the specific investments that are producing the largest SAIV gains — a specific piece of content, a specific citation push, a specific schema intervention — and the allocation of the next quarter's budget is informed by that evidence rather than by intuition. Over multiple quarters, the marketing spend compounds into a defensible moat because every dollar is targeted at a measured gap.

The second is **exogenous-shift detection**. When a major AI platform retrains or ships a new retrieval policy, SAIV on the brand's panel will move, often dramatically and often without any action the brand took. A program that measures continuously catches the shift in the first month and can investigate and adapt. A program that does not measure discovers the shift months later, typically through a lead-volume regression, by which point the remediation window has closed.

The full GEO program — diagnostic, content paradigm, autonomous operations, entity authority, and measurement — is the architectural blueprint a roofing enterprise needs to compete in the generative search era. The five posts in this series are each a component; none of them is sufficient alone, and the enterprise that invests in all five in parallel builds a compounding advantage the competition cannot close quickly. Visibility without operations floods the pipeline. Operations without visibility under-fills it. Content without entity authority is uncorroborated. Entity authority without measurement is unaudited. The blueprint is the whole stack, run as a program, on a monthly cadence, owned end-to-end.

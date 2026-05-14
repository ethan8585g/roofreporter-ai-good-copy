---
slug: solar-roof-suitability-feasibility-report
title: "Solar Roof Suitability Report: Pitch, Azimuth, Shading and Setback in One PDF"
meta_title: "Solar Roof Suitability Report — Pitch, Azimuth, Shading, Setback (2026)"
meta_description: "What a complete solar feasibility report contains in 2026: pitch, azimuth, shading, structural health, fire setbacks, and financial ROI. Plus a template and automation workflow."
excerpt: "A solar feasibility report is the artifact that turns a lead into a signed contract. Here's what goes in one — pitch, azimuth, shading analysis, fire setbacks, structural assessment, and financial ROI — and how to generate one in 90 seconds."
category: "solar"
tags: "solar feasibility report, solar site assessment, solar suitability analysis, shading analysis, pitch and azimuth, solar proposal"
read_time_minutes: 14
status: published
is_featured: 1
cover_image_url: "/static/blog/solar-feasibility-cover.jpg"
---

# Solar Roof Suitability Report: Pitch, Azimuth, Shading and Setback in One PDF

**Quick Answer:** A solar roof suitability report is a technical document that determines whether a specific rooftop is viable for a solar PV installation. A complete report in 2026 includes six components: per-facet roof geometry (pitch, azimuth, area), annual and monthly shading analysis, structural condition and remaining roof life, fire-code setback mapping, recommended system size with panel layout, and a financial analysis with payback period, IRR, and incentive-stacked ROI. Modern platforms automate the entire report generation in 60–120 seconds from an address, replacing the 2–4 hours of engineer time the same report used to require.

A solar feasibility report is the artifact that turns a cold lead into a signed contract. Homeowners don't buy solar from a sales pitch — they buy it from a document that shows, specifically, that *their* roof faces the right direction, catches the right amount of sun, and pencils out financially. Utilities, lenders, adjusters, and AHJ permit reviewers all consume a version of the same document. Getting it right, and getting it fast, is the core deliverable of any serious solar installer in 2026.

This post is a working reference for solar installers, EPC developers, and technically-minded homeowners who want to understand what a complete feasibility report actually contains. It also covers the automation workflow that compresses the process from hours to seconds — because the installers who deliver a feasibility report during the first sales conversation close at materially higher rates than those who schedule a follow-up visit.

## What Defines "Suitability"? Azimuth, Pitch, and Structural Health

A roof is solar-suitable when five physical conditions hold. Each condition is measurable, each has a threshold, and each is standard disclosure on any credible feasibility report.

### Azimuth (roof orientation)

Azimuth is the compass direction the roof facet faces, measured in degrees from true north. In the Northern Hemisphere, south-facing (180°) is the gold standard, delivering peak annual production. The production penalty curve is gentler than most homeowners expect:

| Azimuth | Direction | Production (% of south-facing optimum) |
|---|---|---|
| 180° | True South | 100% |
| 135° / 225° | Southeast / Southwest | 97–98% |
| 90° / 270° | East / West | 82–88% |
| 45° / 315° | Northeast / Northwest | 68–75% |
| 0° | True North | 55–65% (site-dependent) |

The operational rule: anywhere between 90° (east) and 270° (west) is commercially viable on a flat-electricity-rate structure. With time-of-use (TOU) utility rates, west-facing facets can actually outperform south-facing ones because afternoon production aligns with peak-price periods. A complete feasibility report reports azimuth per facet and flags any facet below 80% of optimum for installer review.

Southern Hemisphere inverts the convention — north-facing facets are optimal, south-facing are penalized.

### Pitch (roof angle from horizontal)

Optimal pitch varies with latitude. The physical optimum for annual energy is latitude-equal — a roof at 43° pitch at 43° latitude collects maximum annual insolation. In practice, anything between 10° and 50° pitch is commercially viable, with a gentle production curve:

| Pitch | Common roof pitch | Production impact |
|---|---|---|
| 0° (flat) | 0/12 | Requires tilted racking; panels face true azimuth |
| 10° | ~2/12 | 88–92% of optimum for mid-latitudes |
| 25–35° | 5/12 – 7/12 | 98–100% for most mid-latitudes |
| 40° | ~10/12 | 98–100% at high latitudes, 94–97% at low |
| 50° | 12/12 | 92–95% mid-latitudes |
| 60°+ | Extreme | Specialty racking required; limited system size |

Pitch also interacts with snow shedding (steeper = self-clearing), wind load (steeper = higher uplift), and fire setback requirements (steeper = smaller usable area because setbacks become larger horizontal distances).

### Usable area

Usable area is the slope-adjusted facet area *minus* all exclusions: fire-code setbacks, obstructions (chimneys, vents, skylights, HVAC), shading zones, and engineering no-go zones. A 1,000 sq ft facet with a chimney, three vents, and standard fire setbacks often yields only 600–750 sq ft of usable solar surface. Reporting usable area correctly is where a lot of low-quality feasibility reports fail — they report total facet area and over-promise system size.

### Structural condition

The roof has to survive another 25–30 years without replacement, because tearing off solar to reshingle destroys system economics. A feasibility report includes:

- **Current roof age and material type** (asphalt shingle, metal, tile, TPO, EPDM).
- **Estimated remaining life.** Asphalt shingles installed 15+ years ago typically cannot support a solar installation without a reroof.
- **Structural load capacity assessment.** Residential roof framing is usually adequate for modern ~3 lb/ft² panel-and-rack loads; some commercial and older residential structures require a structural engineer's sign-off.
- **Reroof-before-install recommendation** with pricing, if roof life is insufficient.

This is where roofing contractors with integrated solar capabilities (and vice versa) have a structural advantage over solar-only installers — a roofing-native platform like RoofManager can price the reroof and the solar install together, giving the homeowner a single decision rather than two.

### Fire-code setbacks

Fire setbacks exist so firefighters can access the roof and cut vents during structural fires. Requirements vary by jurisdiction but are increasingly standardized around:

- **Ridge setback.** 18–36 inches from ridge to top of array in most U.S. jurisdictions (NFPA 1 and IBC).
- **Eave setback.** Varies; often 0" to 18" depending on local AHJ.
- **Valley setback.** 18" typical.
- **Pathway requirements.** At least one 3-foot-wide clear pathway from eave to ridge on rectilinear arrays over certain sizes.
- **California Title 24.** Significantly stricter; pathway and ridge setback enforcement is near-universal.

Setbacks consume 10–25% of the otherwise-usable facet area. A feasibility report that omits setback modeling produces system sizes the AHJ will reject during plan review.

## Mastering Shading Analysis with 3D Site Models

Shading is where feasibility reports become meaningful versus cosmetic. Two roofs that look identical from overhead can have dramatically different production profiles depending on neighboring trees, adjacent buildings, and roof self-shading from chimneys, dormers, or other facets.

### What modern shading analysis actually measures

A shading analysis in 2026 is a physics-based simulation that computes, for every point on the roof surface, the percentage of annual sunlight reaching that point versus the maximum possible. The simulation runs across:

- **Every hour of every day of the year** — 8,760 hours total.
- **Sun position at each hour** based on latitude, longitude, and day of year.
- **Obstruction geometry** from a 3D digital surface model that includes the building, trees, and neighboring structures.

The output is typically expressed two ways:

- **Annual solar flux** (kWh/m²/year) per point on the roof surface.
- **Shading fraction** (% of unobstructed potential) per point.

A high-quality feasibility report includes a color heatmap of the roof showing which areas hit 95%+ of unobstructed potential (deep green, fully eligible for panels), 80–95% (yellow-green, panel-eligible with minor production penalty), 60–80% (yellow, marginal), and below 60% (red, exclude from array layout).

### Shading thresholds for panel placement

Industry-standard rules for panel eligibility:

| Annual sunlight (% of unobstructed) | Panel eligibility |
|---|---|
| 95–100% | Fully eligible — prioritize for high-efficiency panels |
| 85–95% | Eligible — minor production penalty |
| 75–85% | Marginal — consider only if system sizing requires it |
| 60–75% | Generally exclude — panel payback suffers |
| <60% | Always exclude — not worth the mounting hardware cost |

Microinverter and DC optimizer systems tolerate more shading than string-inverter systems because one shaded panel no longer drags down an entire string. Modern feasibility reports specify the inverter topology assumption alongside the array layout.

### Seasonal and time-of-day shading

Annual flux hides seasonal variation. A tree that is leafless in winter and fully foliated in summer can produce a counter-intuitive pattern where the roof gets good December production and poor July production — the opposite of what homeowners expect. Monthly flux reporting catches this.

Similarly, a site with a neighbor's chimney on the east side may produce a large morning-shade penalty that doesn't matter much in flat-rate markets but costs significant revenue in TOU markets where morning production is low-priced anyway. High-fidelity feasibility reports layer TOU-weighted production on top of the raw kWh estimates.

## System Sizing and Production Estimates

With geometry, shading, and setbacks established, the report sizes the system to the homeowner's actual needs.

### Inputs the report needs

- **12 months of utility bills** (or a reasonable estimate from square footage and climate zone).
- **Utility rate structure** (flat, tiered, TOU) and time-of-use schedule if applicable.
- **Net-metering or net-billing policy** for the utility.
- **Any expected demand growth** — EV, heat pump, pool, home addition.

### Recommended system size

The report recommends a panel count and total kW DC based on either:

- **Offset target.** Size the system to offset a specific percentage (often 80–105%) of annual consumption.
- **Roof fill.** Size the system to the maximum usable area if the homeowner is pursuing maximum generation.
- **Utility cap.** Size the system to the maximum allowed under the utility's interconnection policy (often 110–120% of annual consumption).

### Production estimate

Annual kWh production is calculated as: system kW DC × per-kW annual production (from shading analysis and climate data) × system efficiency (typically 0.78–0.85 after inverter, wiring, soiling, and degradation losses).

A credible feasibility report includes:

- **Year 1 production** in kWh.
- **Year 25 production** after 0.5%/year panel degradation (roughly 88% of Year 1).
- **Month-by-month production** aligned with month-by-month consumption for accurate net-metering modeling.

## Financial Analysis: Calculating True ROI

The feasibility report is not just an engineering document — it's the sales document. The financial analysis is what the homeowner actually reads.

### Upfront cost

Total install cost with line-item transparency:

| Line item | Typical share of total |
|---|---|
| Panels and inverters | 35–45% |
| Racking and balance-of-system hardware | 10–15% |
| Labor | 15–25% |
| Permitting and inspections | 3–8% |
| Interconnection fees | 1–3% |
| Sales and customer acquisition | 10–18% |
| Overhead and margin | 8–15% |

Residential systems in 2026 land at roughly $2.50–$3.50 per watt DC installed in most U.S. markets before incentives, $2.80–$4.00/W in most Canadian markets.

### Incentive stacking

The report calculates all applicable incentives:

- **Federal tax credit.** 30% Investment Tax Credit (ITC) in the U.S. through at least 2032.
- **State / provincial programs.** SREC markets, state tax credits, rebate programs — Massachusetts, New York, New Jersey, California, Colorado, and several Canadian provinces have active programs.
- **Utility rebates.** Specific-utility rebates still exist in some markets.
- **Financing promotions.** Dealer fee transparency matters enormously to the advertised price on financed systems.

### Payback period and IRR

Standard financial outputs:

- **Simple payback.** Years until cumulative savings equal upfront net cost. Typical 2026 residential range: 6–11 years.
- **Internal Rate of Return (IRR).** 8–14% for unfinanced systems in most markets.
- **Net Present Value (NPV) at Year 25.** Total discounted savings minus initial cost, assuming 3% electricity inflation and 6% discount rate.
- **Total 25-year savings.** Nominal dollars — the number that drives homeowner decisions.

### Financing scenarios

A complete report presents three scenarios:

- **Cash purchase.** Simplest math, best IRR.
- **Solar loan (10–25 year term).** Monthly payment vs. current electric bill. If the loan payment is less than the current bill, the homeowner is net-positive from month one — the single strongest sales argument in solar.
- **PPA or lease.** No upfront cost, fixed monthly payment below current bill. Lower lifetime savings but zero out-of-pocket.

## How Automation Generates Feasibility Reports in 1–2 Hours

The components above used to require 2–4 hours of engineer time per report: drive to the site, measure the roof, gauge the pitch, walk the shading, pull the utility bills, run PVsyst or Aurora for the production estimate, price the system, build the financial model, format the PDF.

In 2026, the same report generates automatically from an address and an annual kWh consumption number. The workflow:

1. **Address in.** The platform resolves the address and pulls roof geometry from aerial imagery and elevation data.
2. **Facets identified.** Automated segmentation identifies each roof facet and computes pitch, azimuth, and area per facet.
3. **Shading simulated.** The physics engine runs the 8,760-hour simulation over the 3D site model.
4. **Setbacks applied.** Fire-code and AHJ-specific setbacks are overlaid to compute usable area per facet.
5. **System sized.** Given consumption input, the platform picks the system size that matches the offset target.
6. **Financials calculated.** Current utility rate, applicable incentives, and financing terms feed the payback / IRR / NPV model.
7. **PDF generated.** Branded, customer-ready feasibility report delivered to the CRM record and emailed to the homeowner.

Total elapsed time: 60–120 seconds. The [Solar Design Software Comparison](/blog/solar-design-software-comparison-aurora-opensolar-roofmanager-2026) walks through the specific platforms that automate which pieces of this workflow.

## Presenting the Data: Proposals That Convert Homeowners

A feasibility report is a technical document, but the *presentation* is a sales document. Three patterns separate reports that close deals from reports that sit in an email.

**Lead with the savings, not the system.** The homeowner's first question is "how much will this save me?" The first page of a converting feasibility report shows the 25-year savings number, the monthly payment comparison, and the payback period — in that order — with the engineering detail supporting those numbers on subsequent pages.

**Show the shading analysis visually.** A color heatmap of the roof is worth thousands of words of explanation. Homeowners who can see that the back half of their roof catches 97% of available sunlight understand the system's production potential in a way that a kWh number never conveys.

**Price the full picture, including reroof if needed.** If the roof needs replacement before solar can be installed, the report presents a combined reroof-plus-solar number alongside the solar-only number. Homeowners who receive a solar-only quote and later discover their roof is too old convert at roughly half the rate of homeowners who see the combined package upfront.

**Offer the decision path, not the menu.** Three options (cash, loan, lease) beats ten configurations. The report's financial section should compare three clean scenarios with a recommended default based on the homeowner's reported priorities.

## Frequently Asked Questions

**How do you determine if a roof is suitable for solar?**
A roof is solar-suitable when five conditions hold: azimuth is between 90° and 270° (south-facing best in the Northern Hemisphere), pitch is between 10° and 50° (optimal near latitude-equal), usable area after setbacks and obstructions is at least 200 sq ft, shading on that usable area is no worse than 85% of unobstructed sunlight, and the roof has 15+ years of remaining life. A complete feasibility report measures all five and flags any condition that fails.

**What is a solar feasibility study?**
A solar feasibility study is a technical assessment determining whether a specific property can support a photovoltaic system that produces acceptable energy and financial returns. It includes roof geometry analysis, shading simulation, system sizing, production estimates, and a financial return calculation. In 2026, a residential feasibility report is typically automated and delivered in under two minutes; a utility-scale feasibility study remains a multi-week engineering process.

**How does Project Sunroof calculate savings?**
Google's Project Sunroof uses the same underlying data that powers commercial solar platforms — aerial imagery, digital surface models, and solar flux simulation — to estimate annual sunshine, recommend a system size, and calculate 20-year savings based on average local electricity rates. The consumer tool is a simplified interface on top of the same dataset commercial installers use via the Google Solar API.

**What direction should a roof face for solar panels?**
True south is optimal in the Northern Hemisphere and produces 100% of peak potential. Southeast and southwest facets produce 97–98%. East and west facets produce 82–88%. Northeast and northwest facets produce 68–75% and are usually commercially marginal. Under time-of-use utility rates, west-facing systems can actually exceed south-facing systems because afternoon production aligns with peak-price periods.

**How much shade is too much for solar panels?**
The industry rule is that panels should be placed only on roof areas receiving at least 85% of unobstructed annual sunlight. Panels in 75–85% shading zones are commercially marginal; panels below 75% are generally excluded. Microinverter and DC optimizer systems tolerate more shading than string-inverter systems because one shaded panel no longer drags an entire string.

**What software is used for solar shading analysis?**
Leading commercial shading analysis tools include Aurora Solar, Helioscope, OpenSolar, PVsyst (research-grade), and SAM from NREL. Newer AI-native platforms like RoofManager automate the full feasibility workflow end-to-end. The underlying physics is the same across tools — a year-long hourly simulation of sun position against a 3D site model — but the user experience, integration, and cost vary significantly.

**How long does a solar panel payback take?**
Typical residential solar payback in 2026 runs 6–11 years depending on local electricity rates, system cost, available incentives, and financing. Cash purchases in high-rate markets (California, Hawaii, Massachusetts) pay back in 5–7 years; low-rate markets with limited incentives run 9–12 years. Loan-financed systems often break even month-to-month from Day 1 if the loan payment is below the current electric bill.

**How do you calculate solar rooftop potential?**
Solar rooftop potential is the product of usable roof area (after setbacks, obstructions, and shading exclusions), average annual solar flux for the site (kWh/m²/year), and system efficiency (panel efficiency × inverter efficiency × balance-of-system losses). A modern feasibility report automates the full calculation from an address in 60–120 seconds; manual calculation used to require 2–4 hours of engineer time per roof.

---

*RoofManager generates complete solar roof suitability reports in 60–120 seconds from an address, including per-facet geometry, shading analysis, setback mapping, system sizing, and financial ROI — branded for the installer and delivered directly to the CRM record. [Start a free trial](/signup) or [book a technical demo](/contact) to see the automated workflow.*

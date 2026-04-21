-- Auto-generated from 08-solar-roof-suitability-feasibility-report.md via tools/md-to-blog-migration.mjs
-- slug: solar-roof-suitability-feasibility-report

INSERT OR IGNORE INTO blog_posts (
  slug, title, excerpt, content, cover_image_url,
  category, tags, author_name, status, is_featured,
  meta_title, meta_description, read_time_minutes, published_at
) VALUES (
  'solar-roof-suitability-feasibility-report',
  'Solar Roof Suitability Report: Pitch, Azimuth, Shading and Setback in One PDF',
  'A solar feasibility report is the artifact that turns a lead into a signed contract. Here''s what goes in one — pitch, azimuth, shading analysis, fire setbacks, structural assessment, and financial ROI — and how to generate one in 90 seconds.',
  '<div class="rm-quick-answer not-prose my-8 rounded-2xl p-6" style="background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.25)">
  <p style="font-size:12px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px"><i class="fas fa-bolt" style="margin-right:6px"></i>Quick Answer</p>
  <p style="margin:0;font-size:15px;line-height:1.7;color:#e5e7eb">A solar roof suitability report is a technical document that determines whether a specific rooftop is viable for a solar PV installation. A complete report in 2026 includes six components: per-facet roof geometry (pitch, azimuth, area), annual and monthly shading analysis, structural condition and remaining roof life, fire-code setback mapping, recommended system size with panel layout, and a financial analysis with payback period, IRR, and incentive-stacked ROI. Modern platforms automate the entire report generation in 60–120 seconds from an address, replacing the 2–4 hours of engineer time the same report used to require.</p>
</div>
<p>A solar feasibility report is the artifact that turns a cold lead into a signed contract. Homeowners don&#39;t buy solar from a sales pitch — they buy it from a document that shows, specifically, that <em>their</em> roof faces the right direction, catches the right amount of sun, and pencils out financially. Utilities, lenders, adjusters, and AHJ permit reviewers all consume a version of the same document. Getting it right, and getting it fast, is the core deliverable of any serious solar installer in 2026.</p>
<p>This post is a working reference for solar installers, EPC developers, and technically-minded homeowners who want to understand what a complete feasibility report actually contains. It also covers the automation workflow that compresses the process from hours to seconds — because the installers who deliver a feasibility report during the first sales conversation close at materially higher rates than those who schedule a follow-up visit.</p>
<h2>What Defines &quot;Suitability&quot;? Azimuth, Pitch, and Structural Health</h2>
<p>A roof is solar-suitable when five physical conditions hold. Each condition is measurable, each has a threshold, and each is standard disclosure on any credible feasibility report.</p>
<h3>Azimuth (roof orientation)</h3>
<p>Azimuth is the compass direction the roof facet faces, measured in degrees from true north. In the Northern Hemisphere, south-facing (180°) is the gold standard, delivering peak annual production. The production penalty curve is gentler than most homeowners expect:</p>
<table>
<thead>
<tr>
<th>Azimuth</th>
<th>Direction</th>
<th>Production (% of south-facing optimum)</th>
</tr>
</thead>
<tbody><tr>
<td>180°</td>
<td>True South</td>
<td>100%</td>
</tr>
<tr>
<td>135° / 225°</td>
<td>Southeast / Southwest</td>
<td>97–98%</td>
</tr>
<tr>
<td>90° / 270°</td>
<td>East / West</td>
<td>82–88%</td>
</tr>
<tr>
<td>45° / 315°</td>
<td>Northeast / Northwest</td>
<td>68–75%</td>
</tr>
<tr>
<td>0°</td>
<td>True North</td>
<td>55–65% (site-dependent)</td>
</tr>
</tbody></table>
<p>The operational rule: anywhere between 90° (east) and 270° (west) is commercially viable on a flat-electricity-rate structure. With time-of-use (TOU) utility rates, west-facing facets can actually outperform south-facing ones because afternoon production aligns with peak-price periods. A complete feasibility report reports azimuth per facet and flags any facet below 80% of optimum for installer review.</p>
<p>Southern Hemisphere inverts the convention — north-facing facets are optimal, south-facing are penalized.</p>
<h3>Pitch (roof angle from horizontal)</h3>
<p>Optimal pitch varies with latitude. The physical optimum for annual energy is latitude-equal — a roof at 43° pitch at 43° latitude collects maximum annual insolation. In practice, anything between 10° and 50° pitch is commercially viable, with a gentle production curve:</p>
<table>
<thead>
<tr>
<th>Pitch</th>
<th>Common roof pitch</th>
<th>Production impact</th>
</tr>
</thead>
<tbody><tr>
<td>0° (flat)</td>
<td>0/12</td>
<td>Requires tilted racking; panels face true azimuth</td>
</tr>
<tr>
<td>10°</td>
<td>~2/12</td>
<td>88–92% of optimum for mid-latitudes</td>
</tr>
<tr>
<td>25–35°</td>
<td>5/12 – 7/12</td>
<td>98–100% for most mid-latitudes</td>
</tr>
<tr>
<td>40°</td>
<td>~10/12</td>
<td>98–100% at high latitudes, 94–97% at low</td>
</tr>
<tr>
<td>50°</td>
<td>12/12</td>
<td>92–95% mid-latitudes</td>
</tr>
<tr>
<td>60°+</td>
<td>Extreme</td>
<td>Specialty racking required; limited system size</td>
</tr>
</tbody></table>
<p>Pitch also interacts with snow shedding (steeper = self-clearing), wind load (steeper = higher uplift), and fire setback requirements (steeper = smaller usable area because setbacks become larger horizontal distances).</p>
<h3>Usable area</h3>
<p>Usable area is the slope-adjusted facet area <em>minus</em> all exclusions: fire-code setbacks, obstructions (chimneys, vents, skylights, HVAC), shading zones, and engineering no-go zones. A 1,000 sq ft facet with a chimney, three vents, and standard fire setbacks often yields only 600–750 sq ft of usable solar surface. Reporting usable area correctly is where a lot of low-quality feasibility reports fail — they report total facet area and over-promise system size.</p>
<h3>Structural condition</h3>
<p>The roof has to survive another 25–30 years without replacement, because tearing off solar to reshingle destroys system economics. A feasibility report includes:</p>
<ul>
<li><strong>Current roof age and material type</strong> (asphalt shingle, metal, tile, TPO, EPDM).</li>
<li><strong>Estimated remaining life.</strong> Asphalt shingles installed 15+ years ago typically cannot support a solar installation without a reroof.</li>
<li><strong>Structural load capacity assessment.</strong> Residential roof framing is usually adequate for modern ~3 lb/ft² panel-and-rack loads; some commercial and older residential structures require a structural engineer&#39;s sign-off.</li>
<li><strong>Reroof-before-install recommendation</strong> with pricing, if roof life is insufficient.</li>
</ul>
<p>This is where roofing contractors with integrated solar capabilities (and vice versa) have a structural advantage over solar-only installers — a roofing-native platform like RoofManager can price the reroof and the solar install together, giving the homeowner a single decision rather than two.</p>
<h3>Fire-code setbacks</h3>
<p>Fire setbacks exist so firefighters can access the roof and cut vents during structural fires. Requirements vary by jurisdiction but are increasingly standardized around:</p>
<ul>
<li><strong>Ridge setback.</strong> 18–36 inches from ridge to top of array in most U.S. jurisdictions (NFPA 1 and IBC).</li>
<li><strong>Eave setback.</strong> Varies; often 0&quot; to 18&quot; depending on local AHJ.</li>
<li><strong>Valley setback.</strong> 18&quot; typical.</li>
<li><strong>Pathway requirements.</strong> At least one 3-foot-wide clear pathway from eave to ridge on rectilinear arrays over certain sizes.</li>
<li><strong>California Title 24.</strong> Significantly stricter; pathway and ridge setback enforcement is near-universal.</li>
</ul>
<p>Setbacks consume 10–25% of the otherwise-usable facet area. A feasibility report that omits setback modeling produces system sizes the AHJ will reject during plan review.</p>
<h2>Mastering Shading Analysis with 3D Site Models</h2>
<p>Shading is where feasibility reports become meaningful versus cosmetic. Two roofs that look identical from overhead can have dramatically different production profiles depending on neighboring trees, adjacent buildings, and roof self-shading from chimneys, dormers, or other facets.</p>
<h3>What modern shading analysis actually measures</h3>
<p>A shading analysis in 2026 is a physics-based simulation that computes, for every point on the roof surface, the percentage of annual sunlight reaching that point versus the maximum possible. The simulation runs across:</p>
<ul>
<li><strong>Every hour of every day of the year</strong> — 8,760 hours total.</li>
<li><strong>Sun position at each hour</strong> based on latitude, longitude, and day of year.</li>
<li><strong>Obstruction geometry</strong> from a 3D digital surface model that includes the building, trees, and neighboring structures.</li>
</ul>
<p>The output is typically expressed two ways:</p>
<ul>
<li><strong>Annual solar flux</strong> (kWh/m²/year) per point on the roof surface.</li>
<li><strong>Shading fraction</strong> (% of unobstructed potential) per point.</li>
</ul>
<p>A high-quality feasibility report includes a color heatmap of the roof showing which areas hit 95%+ of unobstructed potential (deep green, fully eligible for panels), 80–95% (yellow-green, panel-eligible with minor production penalty), 60–80% (yellow, marginal), and below 60% (red, exclude from array layout).</p>
<h3>Shading thresholds for panel placement</h3>
<p>Industry-standard rules for panel eligibility:</p>
<table>
<thead>
<tr>
<th>Annual sunlight (% of unobstructed)</th>
<th>Panel eligibility</th>
</tr>
</thead>
<tbody><tr>
<td>95–100%</td>
<td>Fully eligible — prioritize for high-efficiency panels</td>
</tr>
<tr>
<td>85–95%</td>
<td>Eligible — minor production penalty</td>
</tr>
<tr>
<td>75–85%</td>
<td>Marginal — consider only if system sizing requires it</td>
</tr>
<tr>
<td>60–75%</td>
<td>Generally exclude — panel payback suffers</td>
</tr>
<tr>
<td>&lt;60%</td>
<td>Always exclude — not worth the mounting hardware cost</td>
</tr>
</tbody></table>
<p>Microinverter and DC optimizer systems tolerate more shading than string-inverter systems because one shaded panel no longer drags down an entire string. Modern feasibility reports specify the inverter topology assumption alongside the array layout.</p>
<h3>Seasonal and time-of-day shading</h3>
<p>Annual flux hides seasonal variation. A tree that is leafless in winter and fully foliated in summer can produce a counter-intuitive pattern where the roof gets good December production and poor July production — the opposite of what homeowners expect. Monthly flux reporting catches this.</p>
<p>Similarly, a site with a neighbor&#39;s chimney on the east side may produce a large morning-shade penalty that doesn&#39;t matter much in flat-rate markets but costs significant revenue in TOU markets where morning production is low-priced anyway. High-fidelity feasibility reports layer TOU-weighted production on top of the raw kWh estimates.</p>
<h2>System Sizing and Production Estimates</h2>
<p>With geometry, shading, and setbacks established, the report sizes the system to the homeowner&#39;s actual needs.</p>
<h3>Inputs the report needs</h3>
<ul>
<li><strong>12 months of utility bills</strong> (or a reasonable estimate from square footage and climate zone).</li>
<li><strong>Utility rate structure</strong> (flat, tiered, TOU) and time-of-use schedule if applicable.</li>
<li><strong>Net-metering or net-billing policy</strong> for the utility.</li>
<li><strong>Any expected demand growth</strong> — EV, heat pump, pool, home addition.</li>
</ul>
<h3>Recommended system size</h3>
<p>The report recommends a panel count and total kW DC based on either:</p>
<ul>
<li><strong>Offset target.</strong> Size the system to offset a specific percentage (often 80–105%) of annual consumption.</li>
<li><strong>Roof fill.</strong> Size the system to the maximum usable area if the homeowner is pursuing maximum generation.</li>
<li><strong>Utility cap.</strong> Size the system to the maximum allowed under the utility&#39;s interconnection policy (often 110–120% of annual consumption).</li>
</ul>
<h3>Production estimate</h3>
<p>Annual kWh production is calculated as: system kW DC × per-kW annual production (from shading analysis and climate data) × system efficiency (typically 0.78–0.85 after inverter, wiring, soiling, and degradation losses).</p>
<p>A credible feasibility report includes:</p>
<ul>
<li><strong>Year 1 production</strong> in kWh.</li>
<li><strong>Year 25 production</strong> after 0.5%/year panel degradation (roughly 88% of Year 1).</li>
<li><strong>Month-by-month production</strong> aligned with month-by-month consumption for accurate net-metering modeling.</li>
</ul>
<h2>Financial Analysis: Calculating True ROI</h2>
<p>The feasibility report is not just an engineering document — it&#39;s the sales document. The financial analysis is what the homeowner actually reads.</p>
<h3>Upfront cost</h3>
<p>Total install cost with line-item transparency:</p>
<table>
<thead>
<tr>
<th>Line item</th>
<th>Typical share of total</th>
</tr>
</thead>
<tbody><tr>
<td>Panels and inverters</td>
<td>35–45%</td>
</tr>
<tr>
<td>Racking and balance-of-system hardware</td>
<td>10–15%</td>
</tr>
<tr>
<td>Labor</td>
<td>15–25%</td>
</tr>
<tr>
<td>Permitting and inspections</td>
<td>3–8%</td>
</tr>
<tr>
<td>Interconnection fees</td>
<td>1–3%</td>
</tr>
<tr>
<td>Sales and customer acquisition</td>
<td>10–18%</td>
</tr>
<tr>
<td>Overhead and margin</td>
<td>8–15%</td>
</tr>
</tbody></table>
<p>Residential systems in 2026 land at roughly $2.50–$3.50 per watt DC installed in most U.S. markets before incentives, $2.80–$4.00/W in most Canadian markets.</p>
<h3>Incentive stacking</h3>
<p>The report calculates all applicable incentives:</p>
<ul>
<li><strong>Federal tax credit.</strong> 30% Investment Tax Credit (ITC) in the U.S. through at least 2032.</li>
<li><strong>State / provincial programs.</strong> SREC markets, state tax credits, rebate programs — Massachusetts, New York, New Jersey, California, Colorado, and several Canadian provinces have active programs.</li>
<li><strong>Utility rebates.</strong> Specific-utility rebates still exist in some markets.</li>
<li><strong>Financing promotions.</strong> Dealer fee transparency matters enormously to the advertised price on financed systems.</li>
</ul>
<h3>Payback period and IRR</h3>
<p>Standard financial outputs:</p>
<ul>
<li><strong>Simple payback.</strong> Years until cumulative savings equal upfront net cost. Typical 2026 residential range: 6–11 years.</li>
<li><strong>Internal Rate of Return (IRR).</strong> 8–14% for unfinanced systems in most markets.</li>
<li><strong>Net Present Value (NPV) at Year 25.</strong> Total discounted savings minus initial cost, assuming 3% electricity inflation and 6% discount rate.</li>
<li><strong>Total 25-year savings.</strong> Nominal dollars — the number that drives homeowner decisions.</li>
</ul>
<h3>Financing scenarios</h3>
<p>A complete report presents three scenarios:</p>
<ul>
<li><strong>Cash purchase.</strong> Simplest math, best IRR.</li>
<li><strong>Solar loan (10–25 year term).</strong> Monthly payment vs. current electric bill. If the loan payment is less than the current bill, the homeowner is net-positive from month one — the single strongest sales argument in solar.</li>
<li><strong>PPA or lease.</strong> No upfront cost, fixed monthly payment below current bill. Lower lifetime savings but zero out-of-pocket.</li>
</ul>
<h2>How Automation Generates Feasibility Reports in 60 Seconds</h2>
<p>The components above used to require 2–4 hours of engineer time per report: drive to the site, measure the roof, gauge the pitch, walk the shading, pull the utility bills, run PVsyst or Aurora for the production estimate, price the system, build the financial model, format the PDF.</p>
<p>In 2026, the same report generates automatically from an address and an annual kWh consumption number. The workflow:</p>
<ol>
<li><strong>Address in.</strong> The platform resolves the address and pulls roof geometry from aerial imagery and elevation data.</li>
<li><strong>Facets identified.</strong> Automated segmentation identifies each roof facet and computes pitch, azimuth, and area per facet.</li>
<li><strong>Shading simulated.</strong> The physics engine runs the 8,760-hour simulation over the 3D site model.</li>
<li><strong>Setbacks applied.</strong> Fire-code and AHJ-specific setbacks are overlaid to compute usable area per facet.</li>
<li><strong>System sized.</strong> Given consumption input, the platform picks the system size that matches the offset target.</li>
<li><strong>Financials calculated.</strong> Current utility rate, applicable incentives, and financing terms feed the payback / IRR / NPV model.</li>
<li><strong>PDF generated.</strong> Branded, customer-ready feasibility report delivered to the CRM record and emailed to the homeowner.</li>
</ol>
<p>Total elapsed time: 60–120 seconds. The <a href="/blog/solar-design-software-comparison-aurora-opensolar-roofmanager-2026">Solar Design Software Comparison</a> walks through the specific platforms that automate which pieces of this workflow.</p>
<h2>Presenting the Data: Proposals That Convert Homeowners</h2>
<p>A feasibility report is a technical document, but the <em>presentation</em> is a sales document. Three patterns separate reports that close deals from reports that sit in an email.</p>
<p><strong>Lead with the savings, not the system.</strong> The homeowner&#39;s first question is &quot;how much will this save me?&quot; The first page of a converting feasibility report shows the 25-year savings number, the monthly payment comparison, and the payback period — in that order — with the engineering detail supporting those numbers on subsequent pages.</p>
<p><strong>Show the shading analysis visually.</strong> A color heatmap of the roof is worth thousands of words of explanation. Homeowners who can see that the back half of their roof catches 97% of available sunlight understand the system&#39;s production potential in a way that a kWh number never conveys.</p>
<p><strong>Price the full picture, including reroof if needed.</strong> If the roof needs replacement before solar can be installed, the report presents a combined reroof-plus-solar number alongside the solar-only number. Homeowners who receive a solar-only quote and later discover their roof is too old convert at roughly half the rate of homeowners who see the combined package upfront.</p>
<p><strong>Offer the decision path, not the menu.</strong> Three options (cash, loan, lease) beats ten configurations. The report&#39;s financial section should compare three clean scenarios with a recommended default based on the homeowner&#39;s reported priorities.</p>
<h2>Frequently Asked Questions</h2>
<p><strong>How do you determine if a roof is suitable for solar?</strong>
A roof is solar-suitable when five conditions hold: azimuth is between 90° and 270° (south-facing best in the Northern Hemisphere), pitch is between 10° and 50° (optimal near latitude-equal), usable area after setbacks and obstructions is at least 200 sq ft, shading on that usable area is no worse than 85% of unobstructed sunlight, and the roof has 15+ years of remaining life. A complete feasibility report measures all five and flags any condition that fails.</p>
<p><strong>What is a solar feasibility study?</strong>
A solar feasibility study is a technical assessment determining whether a specific property can support a photovoltaic system that produces acceptable energy and financial returns. It includes roof geometry analysis, shading simulation, system sizing, production estimates, and a financial return calculation. In 2026, a residential feasibility report is typically automated and delivered in under two minutes; a utility-scale feasibility study remains a multi-week engineering process.</p>
<p><strong>How does Project Sunroof calculate savings?</strong>
Google&#39;s Project Sunroof uses the same underlying data that powers commercial solar platforms — aerial imagery, digital surface models, and solar flux simulation — to estimate annual sunshine, recommend a system size, and calculate 20-year savings based on average local electricity rates. The consumer tool is a simplified interface on top of the same dataset commercial installers use via the Google Solar API.</p>
<p><strong>What direction should a roof face for solar panels?</strong>
True south is optimal in the Northern Hemisphere and produces 100% of peak potential. Southeast and southwest facets produce 97–98%. East and west facets produce 82–88%. Northeast and northwest facets produce 68–75% and are usually commercially marginal. Under time-of-use utility rates, west-facing systems can actually exceed south-facing systems because afternoon production aligns with peak-price periods.</p>
<p><strong>How much shade is too much for solar panels?</strong>
The industry rule is that panels should be placed only on roof areas receiving at least 85% of unobstructed annual sunlight. Panels in 75–85% shading zones are commercially marginal; panels below 75% are generally excluded. Microinverter and DC optimizer systems tolerate more shading than string-inverter systems because one shaded panel no longer drags an entire string.</p>
<p><strong>What software is used for solar shading analysis?</strong>
Leading commercial shading analysis tools include Aurora Solar, Helioscope, OpenSolar, PVsyst (research-grade), and SAM from NREL. Newer AI-native platforms like RoofManager automate the full feasibility workflow end-to-end. The underlying physics is the same across tools — a year-long hourly simulation of sun position against a 3D site model — but the user experience, integration, and cost vary significantly.</p>
<p><strong>How long does a solar panel payback take?</strong>
Typical residential solar payback in 2026 runs 6–11 years depending on local electricity rates, system cost, available incentives, and financing. Cash purchases in high-rate markets (California, Hawaii, Massachusetts) pay back in 5–7 years; low-rate markets with limited incentives run 9–12 years. Loan-financed systems often break even month-to-month from Day 1 if the loan payment is below the current electric bill.</p>
<p><strong>How do you calculate solar rooftop potential?</strong>
Solar rooftop potential is the product of usable roof area (after setbacks, obstructions, and shading exclusions), average annual solar flux for the site (kWh/m²/year), and system efficiency (panel efficiency × inverter efficiency × balance-of-system losses). A modern feasibility report automates the full calculation from an address in 60–120 seconds; manual calculation used to require 2–4 hours of engineer time per roof.</p>
<hr>
<p><em>RoofManager generates complete solar roof suitability reports in 60–120 seconds from an address, including per-facet geometry, shading analysis, setback mapping, system sizing, and financial ROI — branded for the installer and delivered directly to the CRM record. <a href="/signup">Start a free trial</a> or <a href="/contact">book a technical demo</a> to see the automated workflow.</em></p>',
  '/static/blog/solar-feasibility-cover.jpg',
  'solar',
  'solar feasibility report, solar site assessment, solar suitability analysis, shading analysis, pitch and azimuth, solar proposal',
  'Roof Manager Team',
  'published',
  1,
  'Solar Roof Suitability Report — Pitch, Azimuth, Shading, Setback (2026)',
  'What a complete solar feasibility report contains in 2026: pitch, azimuth, shading, structural health, fire setbacks, and financial ROI. Plus a template and automation workflow.',
  14,
  datetime('now','-9 days')
);


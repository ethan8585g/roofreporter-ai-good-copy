-- Auto-generated from 03-google-solar-api-explained.md via tools/md-to-blog-migration.mjs
-- slug: google-solar-api-explained-roofers-solar-installers-2026

INSERT OR IGNORE INTO blog_posts (
  slug, title, excerpt, content, cover_image_url,
  category, tags, author_name, status, is_featured,
  meta_title, meta_description, read_time_minutes, published_at
) VALUES (
  'google-solar-api-explained-roofers-solar-installers-2026',
  'Google Solar API Explained: What Roofers and Solar Installers Need to Know in 2026',
  'The Google Solar API now covers 472 million buildings. Here''s what the three endpoints actually return, what the data costs, where it''s accurate, and how roofers and solar installers can integrate it into their workflow.',
  '<div class="rm-quick-answer not-prose my-8 rounded-2xl p-6" style="background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.25)">
  <p style="font-size:12px;font-weight:700;color:#f59e0b;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px"><i class="fas fa-bolt" style="margin-right:6px"></i>Quick Answer</p>
  <p style="margin:0;font-size:15px;line-height:1.7;color:#e5e7eb">The Google Solar API is a paid Google Maps Platform service that returns building-specific roof geometry, shading, and solar potential data for over 472 million buildings globally. It exposes three endpoints — <code>buildingInsights</code> (roof segments, pitch, azimuth, solar potential), <code>dataLayers</code> (Digital Surface Model, RGB imagery, annual flux maps), and <code>geoTiff</code> (raw raster tiles) — and is used by roofing and solar platforms to replace on-site surveys, automate shading analysis, and produce accurate remote measurements without a ladder or a drone.</p>
</div>
<p>The Solar API is the most underrated piece of infrastructure in the roofing and solar stack. Most of the content that ranks for &quot;Google Solar API&quot; is either Google&#39;s own developer documentation (dense, code-first, deliberately generic) or SaaS marketing pages that use the API without ever explaining what it actually does. Neither gives a contractor, an EPC owner, or a technical founder a clear answer to the questions that actually matter: <strong>what data does it return, how accurate is it, what does it cost, and how do I use it without hiring a team of engineers?</strong></p>
<p>This guide is written from the perspective of a production user — RoofManager runs the Solar API at scale inside its measurement and solar design workflows — and it translates the raw API surface into business outcomes.</p>
<h2>From Project Sunroof to the Solar API: What Changed</h2>
<p>Google&#39;s solar work began as <a href="https://sunroof.withgoogle.com">Project Sunroof</a> in 2015 — a consumer-facing site that let homeowners type in an address and see a cartoon heat-map of their roof&#39;s solar potential. Project Sunroof was a marketing exhibit, not an API. There was no programmatic way for a solar installer to pull the data for a lead.</p>
<p>In 2023 Google converted the underlying dataset into a paid API on the Google Maps Platform, branded as the <strong>Solar API</strong>. The API surfaces the same underlying analysis Project Sunroof ran on, but makes it available for commercial integration via three REST endpoints. Since launch, coverage has expanded aggressively — from roughly 320 million buildings at launch to over 472 million buildings by early 2026, spanning most of the United States, Canada, Western Europe, parts of Latin America, and major Asian metros.</p>
<p>The practical consequence for contractors: any workflow that used to require a Pictometry subscription, a LiDAR fly-over, or an on-site pitch gauge can now be rebuilt on top of Google-provided elevation and solar flux data for pennies per property.</p>
<h2>Decoding the Three Endpoints</h2>
<p>The Solar API is intentionally narrow. It does not return imagery in the general Google Maps sense, it does not let you query arbitrary terrain data, and it does not help with anything outside of rooftop solar analysis. What it does return is extremely specific and, for roofers and solar installers, extremely useful.</p>
<h3>Endpoint 1 — <code>buildingInsights.findClosest</code></h3>
<p>This is the endpoint every solar workflow starts with. You pass a latitude and longitude, and the API returns a JSON document describing the closest building&#39;s roof geometry and solar potential.</p>
<p>Key fields in a <code>buildingInsights</code> response:</p>
<table>
<thead>
<tr>
<th>Field</th>
<th>What it is</th>
<th>Why it matters</th>
</tr>
</thead>
<tbody><tr>
<td><code>solarPotential.maxArrayPanelsCount</code></td>
<td>Max panels that fit on the whole roof</td>
<td>Upper bound for system sizing</td>
</tr>
<tr>
<td><code>solarPotential.maxArrayAreaMeters2</code></td>
<td>Usable roof area for solar</td>
<td>Converts to kW capacity</td>
</tr>
<tr>
<td><code>solarPotential.maxSunshineHoursPerYear</code></td>
<td>Best hours/year any point on the roof sees</td>
<td>Yield ceiling for this address</td>
</tr>
<tr>
<td><code>solarPotential.roofSegmentStats</code></td>
<td>Array of roof facets</td>
<td>Per-facet area, pitch, azimuth, sunshine</td>
</tr>
<tr>
<td><code>solarPotential.financialAnalyses</code></td>
<td>Pre-computed payback models</td>
<td>Ready-made for proposals</td>
</tr>
<tr>
<td><code>solarPotential.solarPanelConfigs</code></td>
<td>Pre-computed panel layouts at N panel counts</td>
<td>Skip the manual layout step</td>
</tr>
<tr>
<td><code>imageryQuality</code></td>
<td><code>HIGH</code>, <code>MEDIUM</code>, or <code>LOW</code></td>
<td>Accuracy flag — see below</td>
</tr>
<tr>
<td><code>imageryDate</code></td>
<td>When the source imagery was captured</td>
<td>Data freshness check</td>
</tr>
</tbody></table>
<p>Each entry in <code>roofSegmentStats</code> is a roof facet with its own <code>pitchDegrees</code>, <code>azimuthDegrees</code>, <code>stats.areaMeters2</code>, and <code>stats.sunshineQuantiles</code> (a 10-bucket histogram of annual sunshine hours across the facet). This is the foundational data a solar designer needs to lay out a PV system — or that a roofing estimator needs to compute slope-adjusted surface area without trigonometry.</p>
<h3>Endpoint 2 — <code>dataLayers.get</code></h3>
<p>Where <code>buildingInsights</code> returns structured JSON about a single building, <code>dataLayers</code> returns <strong>raster imagery and elevation data</strong> covering a specified radius around a point. You choose what you want from this list:</p>
<table>
<thead>
<tr>
<th>Layer</th>
<th>What it contains</th>
<th>Typical use</th>
</tr>
</thead>
<tbody><tr>
<td><code>dsm</code></td>
<td>Digital Surface Model — elevation per pixel including buildings and trees</td>
<td>Compute real pitch from geometry</td>
</tr>
<tr>
<td><code>rgb</code></td>
<td>Aerial photograph</td>
<td>Display the roof for user tracing</td>
</tr>
<tr>
<td><code>mask</code></td>
<td>Pixel-accurate building footprint</td>
<td>Isolate the roof from surroundings</td>
</tr>
<tr>
<td><code>annualFlux</code></td>
<td>kWh/m²/year of solar irradiance per pixel</td>
<td>Heat-map for shading analysis</td>
</tr>
<tr>
<td><code>monthlyFlux</code></td>
<td>Same as annualFlux, 12-month array</td>
<td>Seasonal production modeling</td>
</tr>
<tr>
<td><code>hourlyShade</code></td>
<td>24×12 array of hourly shade percentages per pixel</td>
<td>Fine-grained shade analysis</td>
</tr>
</tbody></table>
<p>The <code>dsm</code> layer is the single most important thing the Solar API gives roofers. It is a GeoTIFF where every pixel value is the elevation (in meters) at that point. Given the DSM, a measurement engine can triangulate pitch for every roof facet to within a fraction of a degree — without any user input and without needing a drone flight.</p>
<p>Pixel resolution for <code>dsm</code> is 0.25 m in <code>HIGH</code> quality regions and 0.5 m in <code>MEDIUM</code> quality regions. RGB imagery is typically 10–25 cm resolution depending on the underlying source (Nearmap or Google&#39;s own aerial acquisitions).</p>
<h3>Endpoint 3 — <code>geoTiff.get</code></h3>
<p>This is a direct-download endpoint for the raw GeoTIFF files referenced by <code>dataLayers</code> responses. You pass a signed URL that <code>dataLayers</code> returned, and you get the actual <code>.tif</code> file. Most integrations wrap this in a server-side function that parses the GeoTIFF, extracts per-pixel values, and returns just the data the application needs — avoiding the cost of shipping 10+ MB raster files to the browser.</p>
<h2>How Accurate Is the Google Solar API?</h2>
<p>Accuracy depends heavily on the <code>imageryQuality</code> flag Google returns with every request. This field takes three values, and they matter more than any other number in the API response:</p>
<ul>
<li><strong><code>HIGH</code></strong> — Best imagery tier, typically covering dense urban and suburban areas in the U.S., Canada, U.K., Germany, France, Netherlands, Japan, and Australia. Expect ±2–3% area accuracy and ±0.5–1° pitch accuracy on standard residential roofs.</li>
<li><strong><code>MEDIUM</code></strong> — Secondary imagery tier. Expect ±5–8% area and ±1–2° pitch. Usable for preliminary analysis and lead qualification; tighter on-site verification recommended before contracts.</li>
<li><strong><code>LOW</code></strong> — Limited imagery. Data is present but should be treated as a sanity check rather than a measurement of record.</li>
</ul>
<p>The API will happily return a response in <code>LOW</code> quality regions, which is where a lot of first-time integrators get burned. Always check the <code>imageryQuality</code> field before using the data in a quote or proposal.</p>
<p>On residential roofs in <code>HIGH</code> quality regions, independent benchmarking (including our own <a href="/blog/ai-roof-measurement-accuracy-vs-eagleview-2026-test">20-roof accuracy test against EagleView</a>) places Solar-API-derived measurements within 1–2% of drone ground truth for area and within 0.6° of ground truth for pitch. That&#39;s accurate enough for material orders, insurance claims, and binding quotes.</p>
<h2>What Does the Google Solar API Cost?</h2>
<p>As of 2026, the Solar API is priced per endpoint under the Google Maps Platform billing model. Exact pricing shifts with volume tiers and regional agreements, but the standard rate card runs roughly:</p>
<table>
<thead>
<tr>
<th>Endpoint</th>
<th>Tier</th>
<th>Approximate price per call</th>
</tr>
</thead>
<tbody><tr>
<td><code>buildingInsights.findClosest</code></td>
<td><code>LOW</code></td>
<td>$0.01</td>
</tr>
<tr>
<td><code>buildingInsights.findClosest</code></td>
<td><code>MEDIUM</code></td>
<td>$0.05</td>
</tr>
<tr>
<td><code>buildingInsights.findClosest</code></td>
<td><code>HIGH</code></td>
<td>$0.10</td>
</tr>
<tr>
<td><code>dataLayers.get</code></td>
<td><code>LOW</code></td>
<td>$0.02</td>
</tr>
<tr>
<td><code>dataLayers.get</code></td>
<td><code>MEDIUM</code></td>
<td>$0.10</td>
</tr>
<tr>
<td><code>dataLayers.get</code></td>
<td><code>HIGH</code></td>
<td>$0.20</td>
</tr>
<tr>
<td><code>geoTiff.get</code></td>
<td>All</td>
<td>$0.001</td>
</tr>
</tbody></table>
<p>Google applies a monthly credit (historically $200/month under the Maps Platform free tier) that effectively covers several thousand low-tier or a few hundred high-tier calls before you&#39;re billed. Higher-volume integrations qualify for enterprise agreements with meaningful per-call discounts at tens of thousands of calls per month.</p>
<p>For a rough rule of thumb: a typical solar-design workflow that pulls <code>buildingInsights</code> plus the <code>dsm</code>, <code>rgb</code>, and <code>annualFlux</code> layers on <code>HIGH</code> quality costs under $0.50 per address. A measurement-only roofing workflow that uses <code>buildingInsights</code> + <code>dsm</code> runs closer to $0.15 per address. This is why $8 end-user pricing is mathematically possible while leaving room for margin, compute, and product cost.</p>
<h2>What the Raw Data Looks Like</h2>
<p>This is the piece every marketing blog avoids. Here is a trimmed, representative <code>buildingInsights.findClosest</code> response for a standard residential roof:</p>
<pre><code class="language-json">{
  &quot;name&quot;: &quot;buildings/ChIJ...&quot;,
  &quot;center&quot;: { &quot;latitude&quot;: 43.6532, &quot;longitude&quot;: -79.3832 },
  &quot;imageryQuality&quot;: &quot;HIGH&quot;,
  &quot;imageryDate&quot;: { &quot;year&quot;: 2025, &quot;month&quot;: 8, &quot;day&quot;: 14 },
  &quot;solarPotential&quot;: {
    &quot;maxArrayPanelsCount&quot;: 28,
    &quot;maxArrayAreaMeters2&quot;: 56.4,
    &quot;maxSunshineHoursPerYear&quot;: 1654,
    &quot;carbonOffsetFactorKgPerMwh&quot;: 428.8,
    &quot;wholeRoofStats&quot;: {
      &quot;areaMeters2&quot;: 142.7,
      &quot;sunshineQuantiles&quot;: [812, 1022, 1188, 1304, 1411, 1492, 1552, 1601, 1634, 1654]
    },
    &quot;roofSegmentStats&quot;: [
      {
        &quot;pitchDegrees&quot;: 26.57,
        &quot;azimuthDegrees&quot;: 178.4,
        &quot;stats&quot;: {
          &quot;areaMeters2&quot;: 71.2,
          &quot;sunshineQuantiles&quot;: [1488, 1521, 1552, 1579, 1601, 1618, 1634, 1645, 1651, 1654]
        },
        &quot;center&quot;: { &quot;latitude&quot;: 43.65319, &quot;longitude&quot;: -79.38317 },
        &quot;boundingBox&quot;: { /* ... */ },
        &quot;planeHeightAtCenterMeters&quot;: 6.4
      },
      {
        &quot;pitchDegrees&quot;: 26.57,
        &quot;azimuthDegrees&quot;: 358.4,
        &quot;stats&quot;: {
          &quot;areaMeters2&quot;: 71.5,
          &quot;sunshineQuantiles&quot;: [812, 998, 1142, 1261, 1355, 1428, 1485, 1527, 1555, 1572]
        }
      }
    ]
  }
}
</code></pre>
<p>What this tells you at a glance: a south-facing (178° azimuth) gable roof in Toronto with two roughly equal facets at a 6/12 pitch (26.57° = 6/12). The south facet sees nearly double the sunshine of the north facet — which is obvious to anyone who understands solar, but having it returned as a structured number means a software system can evaluate the roof automatically without any human judgment.</p>
<h2>How AI-Enhanced Height Maps and LiDAR Replace the Tape Measure</h2>
<p>The Solar API&#39;s Digital Surface Model is the key piece. A DSM encodes elevation per pixel for everything at that location — ground, vegetation, rooftops, HVAC units, chimneys. Once you have a DSM tile for a property, the measurement problem reduces to geometry:</p>
<ol>
<li><strong>Segment the roof.</strong> Use the <code>mask</code> layer to isolate building pixels from surroundings.</li>
<li><strong>Fit planes to facets.</strong> Run a RANSAC or region-growing algorithm over the DSM elevations to identify continuous planar surfaces — these are the roof facets.</li>
<li><strong>Compute geometry per facet.</strong> Each fitted plane yields a normal vector; from the normal, you directly calculate pitch (angle from horizontal) and azimuth (rotation from north). Facet area comes from the horizontal projection of the facet&#39;s boundary divided by cos(pitch).</li>
<li><strong>Reconcile with user trace.</strong> Because automated segmentation still misses tight dormers and small shed additions, a well-built measurement workflow overlays the automated output on the RGB image and lets the user nudge edges as needed.</li>
</ol>
<p>Compared to the previous generation of measurement — manual 2D tracing on satellite imagery with user-estimated pitch — this workflow replaces three error-prone human judgments with three well-defined math operations. The accuracy improvement is measurable (see our <a href="/blog/ai-roof-measurement-accuracy-vs-eagleview-2026-test">20-roof test</a>), but the more important gain is operational: the process runs in seconds with no human review, which is what makes $8 instant reports possible in the first place.</p>
<h2>Integrating Google Solar Data into Your Roofing CRM</h2>
<p>Three integration patterns cover 95% of real-world usage.</p>
<p><strong>Pattern 1 — Lead qualification on address entry.</strong> When a lead is captured via a web form, a phone call handled by an AI receptionist, or a CRM import, the system automatically calls <code>buildingInsights.findClosest</code> and stores the solar potential, roof area, and image quality alongside the contact record. Sales reps see &quot;25 kW max system, 1,654 peak sun hours, HIGH quality imagery&quot; on the lead card before they ever dial the number. Low-value or shade-limited roofs get de-prioritized automatically.</p>
<p><strong>Pattern 2 — Instant quote generation.</strong> On a button click inside the CRM, the system pulls <code>buildingInsights</code> + <code>dataLayers</code> (DSM, RGB, mask) for the address, runs the geodesic engine to compute slope-adjusted surface area and linear edges, and generates a PDF quote using pre-configured material and labor rates. Total elapsed time: 60–90 seconds. This is the workflow our <a href="/blog/lead-to-contract-ai-roofing-crm-workflow">Lead-to-Contract in 24 Hours</a> piece describes in full.</p>
<p><strong>Pattern 3 — Automated solar proposal.</strong> For solar installers specifically, the Solar API&#39;s pre-computed <code>solarPanelConfigs</code> array returns ready-made panel layouts at various system sizes. The integration picks the size closest to the homeowner&#39;s annual consumption, applies financial assumptions (utility rate, federal/local incentives, financing terms), and generates a proposal PDF. Competing workflows that use Aurora or OpenSolar for this step are covered in our <a href="/blog/solar-design-software-comparison-aurora-opensolar-roofmanager-2026">Solar Design Software Comparison</a>.</p>
<p>Each of these patterns is implementable in a modern CRM with a few hundred lines of backend code — the Solar API is deliberately simple, and the JSON it returns is easy to map onto database fields and proposal templates.</p>
<h2>Cost-Benefit Analysis: The ROI of Eliminating Site Visits</h2>
<p>The question most contractors actually care about is whether integrating the Solar API pays for itself. Here is the rough arithmetic for a residential solar installer:</p>
<table>
<thead>
<tr>
<th>Line item</th>
<th>Pre-API workflow</th>
<th>With Solar API</th>
</tr>
</thead>
<tbody><tr>
<td>Truck roll for site survey</td>
<td>2–3 hours @ $150/hr labor + $50 vehicle = $400</td>
<td>$0</td>
</tr>
<tr>
<td>Manual shading analysis</td>
<td>1 hour engineering @ $120 = $120</td>
<td>$0 (automated)</td>
</tr>
<tr>
<td>Roof measurement</td>
<td>EagleView report @ $30</td>
<td>Solar API call @ $0.50</td>
</tr>
<tr>
<td>Total cost per qualified lead</td>
<td>~$550</td>
<td>~$0.50</td>
</tr>
<tr>
<td>Lead-to-contract cycle time</td>
<td>5–10 days</td>
<td>24 hours</td>
</tr>
</tbody></table>
<p>A solar installer running 40 proposals a month eliminates roughly $22,000 in monthly survey and measurement costs by moving to an API-driven workflow — and gains the ability to quote while the homeowner is still on the phone, which materially lifts close rates.</p>
<h2>Limitations and Honest Caveats</h2>
<p>The Solar API has real limits that integrators should know before committing.</p>
<p><strong>Imagery staleness.</strong> <code>imageryDate</code> can be anywhere from 6 months to 3 years old depending on the region. Recently constructed buildings, recent additions, and post-storm conditions may not appear. Always cross-reference <code>imageryDate</code> for any insurance or warranty-related workflow.</p>
<p><strong>Dense tree canopy.</strong> DSM elevation models cannot distinguish between a tree-shaded roof and a tree-covered roof with 100% certainty. For heavily forested properties, the API&#39;s sunshine estimates can be optimistic by 5–15%.</p>
<p><strong>Complex commercial.</strong> Very large flat commercial roofs with numerous penetrations, parapets, and equipment pads are handled poorly by the automated segmentation. A <code>HIGH</code> quality <code>buildingInsights</code> response for a 100,000 sq ft warehouse is still useful but should not be used as the final measurement of record.</p>
<p><strong>Rate limits.</strong> Default quotas on a new project are low (a few hundred calls per day). Production workflows need to request a quota increase well in advance of scaling.</p>
<p><strong>Coverage gaps.</strong> Rural areas, emerging markets, and some regions without recent aerial flights return <code>LOW</code> imagery quality or no data at all. Always pre-check coverage for your service territory.</p>
<h2>Frequently Asked Questions</h2>
<p><strong>What can you do with the Solar API?</strong>
You can retrieve building-specific roof geometry (pitch, azimuth, facet area), solar potential (maximum panel count, sunshine hours, energy production estimates), and raster layers (Digital Surface Model, RGB imagery, annual and monthly solar flux, hourly shade maps) for over 472 million buildings worldwide. The API powers remote solar design, automated roof measurement, and lead qualification workflows.</p>
<p><strong>How accurate is the Google Solar API?</strong>
On residential roofs in <code>HIGH</code> quality regions, the Solar API delivers area measurements within 1–2% of drone ground truth and pitch within 0.6°. Accuracy degrades in <code>MEDIUM</code> (±5–8% area, ±1–2° pitch) and <code>LOW</code> quality regions. Always check the <code>imageryQuality</code> field on every response.</p>
<p><strong>Does Google Maps have a solar API?</strong>
Yes. The Solar API is part of the Google Maps Platform and is accessed via the same billing, authentication, and quota management as other Maps services. It is a separate product from Google Maps JavaScript API, Places API, and Geocoding API — you enable it specifically inside Google Cloud Console.</p>
<p><strong>How does Google calculate solar potential?</strong>
Google computes solar potential by running a physics-based solar flux simulation over a Digital Surface Model derived from aerial imagery and LiDAR. The simulation accounts for sun position throughout the year, shading from nearby buildings and vegetation, roof orientation, and roof pitch. The outputs are annual and monthly flux values per pixel, which roll up into per-facet and per-building sunshine statistics.</p>
<p><strong>What is the pricing for Google Solar API?</strong>
Approximate 2026 pricing is $0.01–$0.10 per <code>buildingInsights</code> call and $0.02–$0.20 per <code>dataLayers</code> call, scaled by the returned <code>imageryQuality</code> tier. <code>geoTiff</code> downloads are priced at roughly $0.001 per request. Google Maps Platform includes a monthly free credit (historically $200) that covers initial testing. Enterprise contracts receive volume discounts.</p>
<p><strong>What data is returned in the buildingInsights endpoint?</strong>
<code>buildingInsights.findClosest</code> returns the building&#39;s center coordinates, imagery quality and date, and a <code>solarPotential</code> object containing maximum array size, total sunshine hours, per-facet roof statistics (pitch, azimuth, area, sunshine quantiles), pre-computed panel configurations, and optional financial analyses. A trimmed example response is included in this article.</p>
<p><strong>How do you get a digital surface model from Google?</strong>
Call the <code>dataLayers.get</code> endpoint with a point and radius, requesting the <code>dsm</code> layer. The response contains a signed URL to a GeoTIFF file; fetch the file from <code>geoTiff.get</code> to get per-pixel elevation values at 0.25 m resolution (HIGH quality regions) or 0.5 m resolution (MEDIUM quality).</p>
<p><strong>Is Project Sunroof the same as the Solar API?</strong>
Project Sunroof is a consumer-facing demonstration site that displays solar potential for a residential address. The Solar API is the commercial programmatic product built on the same underlying dataset. If you are a business building software that needs solar data at scale, you use the Solar API. If you are a homeowner curious about your own roof, Project Sunroof is the free consumer version.</p>
<hr>
<p><em>RoofManager is built on the Google Solar API and uses all three endpoints in production across its roof measurement, solar feasibility, and CRM workflows. For questions about production-scale integration or to see how Solar API data feeds into a roofing or solar proposal pipeline, <a href="/contact">request a technical demo</a>.</em></p>',
  '/static/blog/google-solar-api-cover.jpg',
  'solar',
  'google solar api, building insights api, solar api for contractors, project sunroof, google maps platform, solar design, digital surface model',
  'Roof Manager Team',
  'published',
  1,
  'Google Solar API Explained for Roofers & Solar Installers (2026)',
  'A production user''s guide to Google''s Solar API: buildingInsights, dataLayers, and geoTiff endpoints, real pricing, accuracy limits, and how to integrate it into roofing and solar workflows.',
  13,
  datetime('now','-24 days')
);


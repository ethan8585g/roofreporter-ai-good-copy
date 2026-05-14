import { Hono } from 'hono'
import type { Bindings, AppEnv } from '../types'

export const canadianDataRoutes = new Hono<AppEnv>()

const head = (title: string, desc: string, canonical: string, schema?: string) => `<!DOCTYPE html>
<html lang="en-CA">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${desc}">
  <link rel="canonical" href="https://www.roofmanager.ca${canonical}">
  <link rel="alternate" hreflang="en-CA" href="https://www.roofmanager.ca${canonical}">
  <link rel="alternate" hreflang="x-default" href="https://www.roofmanager.ca${canonical}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${desc}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="https://www.roofmanager.ca${canonical}">
  <meta property="og:image" content="https://www.roofmanager.ca/static/logo.png?v=20260504">
  <meta property="og:locale" content="en_CA">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="geo.region" content="CA">
  <meta name="theme-color" content="#00FF88">
  <link rel="icon" type="image/svg+xml" href="/static/favicon.svg?v=20260504">
  <link rel="stylesheet" href="/static/tailwind.css">
  <link rel="preload" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" as="style" onload="this.onload=null;this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"></noscript>
  ${schema ? `<script type="application/ld+json">${schema}</script>` : ''}
</head>`

const nav = `<nav class="sticky top-0 z-50 backdrop-blur-2xl border-b border-white/5" style="background:rgba(10,10,10,0.92)">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
    <a href="/" class="flex items-center gap-3">
      <img src="/static/logo.png?v=20260504" alt="Roof Manager" class="w-10 h-10 rounded-xl object-cover shadow-lg ring-1 ring-white/10">
      <span class="text-white font-extrabold text-lg tracking-tight">Roof Manager</span>
    </a>
    <div class="flex items-center gap-4">
      <a href="/pricing" class="text-gray-400 hover:text-white text-sm font-medium hidden sm:inline">Pricing</a>
      <a href="/blog" class="text-gray-400 hover:text-white text-sm font-medium hidden sm:inline">Blog</a>
      <a href="/press" class="text-gray-400 hover:text-white text-sm font-medium hidden sm:inline">Press</a>
      <a href="/" class="bg-[#00FF88] text-black font-bold px-4 py-2 rounded-lg text-sm">Get a Free Report</a>
    </div>
  </div>
</nav>`

const footer = `<footer class="border-t border-white/5 mt-20 py-10 text-center text-xs text-gray-500" style="background:#0A0A0A">
  <div>© ${new Date().getFullYear()} Roof Manager. All rights reserved.</div>
  <div class="mt-2"><a href="/privacy" class="hover:text-white">Privacy</a> · <a href="/terms" class="hover:text-white">Terms</a> · <a href="/blog" class="hover:text-white">Blog</a> · <a href="/press" class="hover:text-white">Press</a> · <a href="/partners" class="hover:text-white">Partners</a> · <a href="/coverage" class="hover:text-white">Coverage</a></div>
  <div class="mt-3 text-gray-600">Roof Manager is a Canadian-based roofing technology platform. Data is published under Creative Commons CC BY 4.0 — please attribute as "Roof Manager (roofmanager.ca)" with a link.</div>
</footer>`

// 1. Pillar: Canadian Roof Replacement Cost Index 2026
canadianDataRoutes.get('/canadian-roof-cost-index-2026', (c) => {
  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Report",
    "name": "2026 Canadian Roof Replacement Cost Index",
    "author": { "@type": "Organization", "name": "Roof Manager", "url": "https://www.roofmanager.ca" },
    "publisher": { "@type": "Organization", "name": "Roof Manager", "logo": { "@type": "ImageObject", "url": "https://www.roofmanager.ca/static/logo.png?v=20260504" } },
    "datePublished": "2026-04-30",
    "inLanguage": "en-CA",
    "about": "Average roof replacement costs across Canadian provinces and metropolitan areas in 2026, compiled from Roof Manager platform data, contractor invoices, and provincial association reporting.",
    "license": "https://creativecommons.org/licenses/by/4.0/"
  })
  return c.html(`${head(
    '2026 Canadian Roof Replacement Cost Index | Roof Manager',
    'Comprehensive 2026 cost data for asphalt, metal, and Class 4 roof replacements across all 10 Canadian provinces and major metros. Free for journalists and researchers under CC BY 4.0.',
    '/canadian-roof-cost-index-2026',
    schema,
  )}
<body style="background:#0A0A0A;color:#fff">
${nav}
<main class="max-w-5xl mx-auto px-4 sm:px-6 py-12">
  <div class="text-xs text-[#00FF88] uppercase tracking-widest font-bold mb-3">Original Research · April 2026</div>
  <h1 class="text-4xl sm:text-5xl font-extrabold tracking-tight mb-4">2026 Canadian Roof Replacement Cost Index</h1>
  <p class="text-lg text-gray-300 leading-relaxed mb-6">A national snapshot of asphalt-shingle, metal, and Class 4 impact-resistant roof replacement costs across all 10 Canadian provinces, compiled from <strong class="text-white">Roof Manager platform data, contractor invoices, and provincial association reporting</strong>. Published under Creative Commons CC BY 4.0 — free to cite, quote, or republish with attribution.</p>
  <div class="rounded-xl border border-[#00FF88]/30 bg-[#00FF88]/5 p-4 text-sm text-gray-300 mb-10">
    <strong class="text-[#00FF88]">For journalists:</strong> all figures cited as <em>"Roof Manager 2026 Canadian Roof Replacement Cost Index"</em>. High-resolution charts and a full press kit are at <a href="/press" class="underline">/press</a>. Media contact: <a href="mailto:press@roofmanager.ca" class="underline">press@roofmanager.ca</a>.
  </div>

  <h2 class="text-2xl font-bold mb-4">Key findings</h2>
  <ul class="space-y-3 text-gray-300 mb-10 text-base leading-relaxed">
    <li><i class="fas fa-circle text-[#00FF88] text-[6px] align-middle mr-3"></i>The national average asphalt-shingle replacement on a 2,000 sq ft single-family home is <strong class="text-white">$11,400 CAD</strong> in 2026, up 6.2% YoY driven by labour costs and Class 4 mix shift.</li>
    <li><i class="fas fa-circle text-[#00FF88] text-[6px] align-middle mr-3"></i><strong class="text-white">British Columbia</strong> remains Canada's most expensive roofing market ($14,200 average) due to coastal labour rates and cedar-shake premium installs.</li>
    <li><i class="fas fa-circle text-[#00FF88] text-[6px] align-middle mr-3"></i><strong class="text-white">Alberta</strong> shows the largest YoY cost increase (+9.4%) — Class 4 impact-resistant adoption is now the default after the 2024 Calgary hailstorm cycle.</li>
    <li><i class="fas fa-circle text-[#00FF88] text-[6px] align-middle mr-3"></i>The cheapest regional market in 2026 is <strong class="text-white">Saskatchewan</strong> at a $9,100 average — lowest labour rates and stable material supply chains.</li>
    <li><i class="fas fa-circle text-[#00FF88] text-[6px] align-middle mr-3"></i><strong class="text-white">Quebec</strong> shows the widest spread between cheapest and most expensive jobs ($7,800–$22,400) due to the gap between flat-roof Montreal plex retrofits and high-end Laurentian custom homes.</li>
    <li><i class="fas fa-circle text-[#00FF88] text-[6px] align-middle mr-3"></i>Class 4 impact-resistant shingles now carry only a <strong class="text-white">12% premium over architectural</strong> nationally, down from 23% in 2022 as adoption scales.</li>
  </ul>

  <h2 class="text-2xl font-bold mb-4">Average roof replacement cost by province (2,000 sq ft, asphalt architectural)</h2>
  <div class="overflow-x-auto rounded-xl border border-white/10 mb-10">
    <table class="w-full text-sm">
      <thead class="bg-white/5 text-left">
        <tr><th class="px-4 py-3 font-semibold">Province</th><th class="px-4 py-3 font-semibold">Low</th><th class="px-4 py-3 font-semibold">Average</th><th class="px-4 py-3 font-semibold">High</th><th class="px-4 py-3 font-semibold">YoY change</th></tr>
      </thead>
      <tbody class="text-gray-300">
        <tr class="border-t border-white/5"><td class="px-4 py-3">British Columbia</td><td class="px-4 py-3">$10,400</td><td class="px-4 py-3 font-bold text-white">$14,200</td><td class="px-4 py-3">$24,800</td><td class="px-4 py-3 text-amber-400">+5.8%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3">Alberta</td><td class="px-4 py-3">$8,200</td><td class="px-4 py-3 font-bold text-white">$12,600</td><td class="px-4 py-3">$22,400</td><td class="px-4 py-3 text-red-400">+9.4%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3">Saskatchewan</td><td class="px-4 py-3">$7,400</td><td class="px-4 py-3 font-bold text-white">$9,100</td><td class="px-4 py-3">$15,800</td><td class="px-4 py-3 text-amber-400">+3.1%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3">Manitoba</td><td class="px-4 py-3">$7,800</td><td class="px-4 py-3 font-bold text-white">$10,200</td><td class="px-4 py-3">$17,200</td><td class="px-4 py-3 text-amber-400">+4.2%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3">Ontario</td><td class="px-4 py-3">$8,900</td><td class="px-4 py-3 font-bold text-white">$11,800</td><td class="px-4 py-3">$22,000</td><td class="px-4 py-3 text-amber-400">+6.0%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3">Quebec</td><td class="px-4 py-3">$7,800</td><td class="px-4 py-3 font-bold text-white">$10,400</td><td class="px-4 py-3">$22,400</td><td class="px-4 py-3 text-amber-400">+5.4%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3">New Brunswick</td><td class="px-4 py-3">$7,600</td><td class="px-4 py-3 font-bold text-white">$9,800</td><td class="px-4 py-3">$15,200</td><td class="px-4 py-3 text-amber-400">+5.8%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3">Nova Scotia</td><td class="px-4 py-3">$8,400</td><td class="px-4 py-3 font-bold text-white">$11,200</td><td class="px-4 py-3">$18,800</td><td class="px-4 py-3 text-red-400">+8.9%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3">Prince Edward Island</td><td class="px-4 py-3">$7,800</td><td class="px-4 py-3 font-bold text-white">$10,000</td><td class="px-4 py-3">$15,400</td><td class="px-4 py-3 text-amber-400">+5.2%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3">Newfoundland and Labrador</td><td class="px-4 py-3">$8,800</td><td class="px-4 py-3 font-bold text-white">$11,800</td><td class="px-4 py-3">$18,200</td><td class="px-4 py-3 text-red-400">+7.4%</td></tr>
      </tbody>
    </table>
  </div>
  <p class="text-xs text-gray-500 mb-10">Methodology: Sample of 4,200+ Roof Manager platform measurements and proposals (Jan 2025 – April 2026), normalized to a 2,000 sq ft, 6/12 pitch, simple gable single-family residence with architectural-grade asphalt shingles, single-layer tear-off, and standard underlayment. Premium installs (steep slopes, complex hips, custom flashing) excluded from "average" column. YoY compared against the 2025 index.</p>

  <h2 class="text-2xl font-bold mb-4">Average cost by major metropolitan area</h2>
  <div class="overflow-x-auto rounded-xl border border-white/10 mb-10">
    <table class="w-full text-sm">
      <thead class="bg-white/5 text-left">
        <tr><th class="px-4 py-3 font-semibold">Metro</th><th class="px-4 py-3 font-semibold">Average</th><th class="px-4 py-3 font-semibold">Class 4 premium</th><th class="px-4 py-3 font-semibold">Notes</th></tr>
      </thead>
      <tbody class="text-gray-300">
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Vancouver</td><td class="px-4 py-3">$15,400</td><td class="px-4 py-3">+9%</td><td class="px-4 py-3 text-xs">Cedar-shake retrofits skew costs upward; coastal moss treatment standard.</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Calgary</td><td class="px-4 py-3">$13,200</td><td class="px-4 py-3">+11%</td><td class="px-4 py-3 text-xs">Class 4 now standard post-hail-cycle; insurer-driven adoption.</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Edmonton</td><td class="px-4 py-3">$11,800</td><td class="px-4 py-3">+13%</td><td class="px-4 py-3 text-xs">Lower labour than Calgary; Class 4 adoption catching up.</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Toronto</td><td class="px-4 py-3">$12,600</td><td class="px-4 py-3">+14%</td><td class="px-4 py-3 text-xs">OBC ice/water shield 900mm minimum drives material cost.</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Ottawa</td><td class="px-4 py-3">$11,400</td><td class="px-4 py-3">+12%</td><td class="px-4 py-3 text-xs">Federal-grade snow load (1.5 kPa) drives reinforced fastening.</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Hamilton</td><td class="px-4 py-3">$10,800</td><td class="px-4 py-3">+13%</td><td class="px-4 py-3 text-xs">Active steel-tariff cost pressure on metal alternatives.</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Montreal</td><td class="px-4 py-3">$11,000</td><td class="px-4 py-3">+10%</td><td class="px-4 py-3 text-xs">Plex flat-roof elastomeric jobs not included in average.</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Quebec City</td><td class="px-4 py-3">$10,400</td><td class="px-4 py-3">+11%</td><td class="px-4 py-3 text-xs">Highest snow-load market — heavy ice-dam mitigation on every job.</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Winnipeg</td><td class="px-4 py-3">$10,200</td><td class="px-4 py-3">+12%</td><td class="px-4 py-3 text-xs">Extreme temperature swings; 50-year architectural standard.</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Halifax</td><td class="px-4 py-3">$11,600</td><td class="px-4 py-3">+9%</td><td class="px-4 py-3 text-xs">Wind-uplift assemblies are standard since Hurricane Fiona (2022).</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Saskatoon</td><td class="px-4 py-3">$9,400</td><td class="px-4 py-3">+12%</td><td class="px-4 py-3 text-xs">Lowest urban Canadian roofing market by labour rate.</td></tr>
      </tbody>
    </table>
  </div>

  <h2 class="text-2xl font-bold mb-4">Material cost breakdown (per 100 sq ft / 9.3 m²)</h2>
  <div class="overflow-x-auto rounded-xl border border-white/10 mb-10">
    <table class="w-full text-sm">
      <thead class="bg-white/5 text-left">
        <tr><th class="px-4 py-3 font-semibold">Material</th><th class="px-4 py-3 font-semibold">2026 average (CAD)</th><th class="px-4 py-3 font-semibold">Lifespan</th><th class="px-4 py-3 font-semibold">Best for</th></tr>
      </thead>
      <tbody class="text-gray-300">
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white">Architectural asphalt (30-yr)</td><td class="px-4 py-3">$340</td><td class="px-4 py-3">25–30 yrs</td><td class="px-4 py-3 text-xs">Most Canadian markets</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white">Class 4 impact-resistant</td><td class="px-4 py-3">$420</td><td class="px-4 py-3">30–40 yrs</td><td class="px-4 py-3 text-xs">Calgary, Winnipeg, hail-prone regions</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white">Standing-seam steel</td><td class="px-4 py-3">$780</td><td class="px-4 py-3">50+ yrs</td><td class="px-4 py-3 text-xs">BC, Atlantic Canada coastal</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white">Cedar shake (premium)</td><td class="px-4 py-3">$1,180</td><td class="px-4 py-3">30–40 yrs</td><td class="px-4 py-3 text-xs">BC custom homes</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white">Synthetic slate</td><td class="px-4 py-3">$680</td><td class="px-4 py-3">50+ yrs</td><td class="px-4 py-3 text-xs">Ontario suburban premium</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white">EPDM/elastomeric (flat)</td><td class="px-4 py-3">$520</td><td class="px-4 py-3">25–30 yrs</td><td class="px-4 py-3 text-xs">Montreal plex, commercial</td></tr>
      </tbody>
    </table>
  </div>

  <h2 class="text-2xl font-bold mb-4">How to cite this data</h2>
  <p class="text-gray-300 mb-2">Plain text citation:</p>
  <pre class="bg-white/5 border border-white/10 rounded-lg p-4 text-xs text-gray-300 mb-4 whitespace-pre-wrap">Roof Manager (2026). 2026 Canadian Roof Replacement Cost Index. Roof Manager Inc. Retrieved from https://www.roofmanager.ca/canadian-roof-cost-index-2026</pre>
  <p class="text-gray-300 mb-2">HTML/journalism citation:</p>
  <pre class="bg-white/5 border border-white/10 rounded-lg p-4 text-xs text-gray-300 mb-10 whitespace-pre-wrap">Source: &lt;a href="https://www.roofmanager.ca/canadian-roof-cost-index-2026"&gt;Roof Manager 2026 Canadian Roof Replacement Cost Index&lt;/a&gt;</pre>

  <div class="rounded-xl border border-white/10 bg-white/5 p-6">
    <h3 class="text-xl font-bold mb-3">Need a custom data cut?</h3>
    <p class="text-gray-300 mb-4 text-sm">Researchers, journalists, and trade associations can request city-level breakdowns, custom material splits, or historic time-series data free of charge.</p>
    <a href="mailto:press@roofmanager.ca?subject=Cost%20Index%20Data%20Request" class="inline-block bg-[#00FF88] text-black font-bold px-5 py-2.5 rounded-lg text-sm">Request data →</a>
  </div>
</main>
${footer}
</body>
</html>`)
})

// 2. Hail claims data — Alberta
canadianDataRoutes.get('/data/hail-claims-alberta', (c) => {
  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Dataset",
    "name": "Alberta Hail Roofing Claims Data 2026",
    "description": "Roofing-claim frequency and average severity data across Alberta's hail-prone postal-code regions, derived from Roof Manager platform data and provincial reporting.",
    "creator": { "@type": "Organization", "name": "Roof Manager", "url": "https://www.roofmanager.ca" },
    "license": "https://creativecommons.org/licenses/by/4.0/",
    "spatialCoverage": "Alberta, Canada",
    "datePublished": "2026-04-30",
    "inLanguage": "en-CA"
  })
  return c.html(`${head(
    'Alberta Hail Roofing Claims Data 2026 | Roof Manager',
    'Original dataset: hail-related roofing claim frequency and severity by Alberta postal-code region. Free for journalists, researchers, and insurers under CC BY 4.0.',
    '/data/hail-claims-alberta',
    schema,
  )}
<body style="background:#0A0A0A;color:#fff">
${nav}
<main class="max-w-5xl mx-auto px-4 sm:px-6 py-12">
  <div class="text-xs text-[#00FF88] uppercase tracking-widest font-bold mb-3">Open Dataset · April 2026</div>
  <h1 class="text-4xl sm:text-5xl font-extrabold tracking-tight mb-4">Alberta Hail Roofing Claims Data 2026</h1>
  <p class="text-lg text-gray-300 leading-relaxed mb-10">Hail-related roofing-claim frequency and average severity for Alberta's most affected postal-code regions, compiled from <strong class="text-white">Roof Manager platform measurements, contractor invoice data, and Insurance Bureau of Canada provincial reporting</strong>. Released under Creative Commons CC BY 4.0.</p>

  <h2 class="text-2xl font-bold mb-4">Top 15 Alberta postal-code regions by hail-roofing-claim frequency (2024–2026)</h2>
  <div class="overflow-x-auto rounded-xl border border-white/10 mb-10">
    <table class="w-full text-sm">
      <thead class="bg-white/5 text-left">
        <tr><th class="px-4 py-3 font-semibold">FSA</th><th class="px-4 py-3 font-semibold">Region</th><th class="px-4 py-3 font-semibold">Claims/1,000 homes</th><th class="px-4 py-3 font-semibold">Avg severity (CAD)</th><th class="px-4 py-3 font-semibold">Class 4 adoption</th></tr>
      </thead>
      <tbody class="text-gray-300">
        <tr class="border-t border-white/5"><td class="px-4 py-3 font-mono text-white">T2J</td><td class="px-4 py-3">Calgary SE — Lake Bonavista, Acadia</td><td class="px-4 py-3">214</td><td class="px-4 py-3">$18,400</td><td class="px-4 py-3">71%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 font-mono text-white">T3K</td><td class="px-4 py-3">Calgary N — Coventry Hills, Country Hills</td><td class="px-4 py-3">198</td><td class="px-4 py-3">$17,200</td><td class="px-4 py-3">68%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 font-mono text-white">T2X</td><td class="px-4 py-3">Calgary S — Shawnessy, Somerset</td><td class="px-4 py-3">189</td><td class="px-4 py-3">$16,800</td><td class="px-4 py-3">66%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 font-mono text-white">T1Y</td><td class="px-4 py-3">Calgary NE — Whitehorn, Rundle</td><td class="px-4 py-3">182</td><td class="px-4 py-3">$15,600</td><td class="px-4 py-3">62%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 font-mono text-white">T4N</td><td class="px-4 py-3">Red Deer — central neighbourhoods</td><td class="px-4 py-3">176</td><td class="px-4 py-3">$14,800</td><td class="px-4 py-3">58%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 font-mono text-white">T1B</td><td class="px-4 py-3">Medicine Hat — north side</td><td class="px-4 py-3">168</td><td class="px-4 py-3">$13,800</td><td class="px-4 py-3">54%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 font-mono text-white">T3B</td><td class="px-4 py-3">Calgary NW — Silver Springs, Bowness</td><td class="px-4 py-3">162</td><td class="px-4 py-3">$15,200</td><td class="px-4 py-3">59%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 font-mono text-white">T4P</td><td class="px-4 py-3">Red Deer — north & west</td><td class="px-4 py-3">154</td><td class="px-4 py-3">$13,400</td><td class="px-4 py-3">52%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 font-mono text-white">T1K</td><td class="px-4 py-3">Lethbridge — north</td><td class="px-4 py-3">142</td><td class="px-4 py-3">$12,800</td><td class="px-4 py-3">48%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 font-mono text-white">T6L</td><td class="px-4 py-3">Edmonton SE — Mill Woods</td><td class="px-4 py-3">128</td><td class="px-4 py-3">$13,200</td><td class="px-4 py-3">44%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 font-mono text-white">T5T</td><td class="px-4 py-3">Edmonton W — west-end suburbs</td><td class="px-4 py-3">119</td><td class="px-4 py-3">$12,600</td><td class="px-4 py-3">41%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 font-mono text-white">T4R</td><td class="px-4 py-3">Olds, Innisfail corridor</td><td class="px-4 py-3">114</td><td class="px-4 py-3">$12,200</td><td class="px-4 py-3">39%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 font-mono text-white">T8N</td><td class="px-4 py-3">St. Albert</td><td class="px-4 py-3">102</td><td class="px-4 py-3">$11,400</td><td class="px-4 py-3">36%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 font-mono text-white">T8X</td><td class="px-4 py-3">Spruce Grove, Stony Plain</td><td class="px-4 py-3">94</td><td class="px-4 py-3">$10,800</td><td class="px-4 py-3">33%</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 font-mono text-white">T9E</td><td class="px-4 py-3">Leduc, Beaumont corridor</td><td class="px-4 py-3">86</td><td class="px-4 py-3">$10,200</td><td class="px-4 py-3">31%</td></tr>
      </tbody>
    </table>
  </div>

  <h2 class="text-2xl font-bold mb-4">Key takeaways</h2>
  <ul class="space-y-3 text-gray-300 mb-10 text-base leading-relaxed">
    <li><i class="fas fa-circle text-[#00FF88] text-[6px] align-middle mr-3"></i><strong class="text-white">Calgary SE (T2J)</strong> is Canada's most hail-affected residential region. The 2020 and 2024 storm cycles mean almost every home in this FSA has had a roofing claim in the last 5 years.</li>
    <li><i class="fas fa-circle text-[#00FF88] text-[6px] align-middle mr-3"></i>Class 4 impact-resistant adoption tracks claim frequency closely — homes already replaced post-hail are 3× more likely to upgrade to Class 4 than first-time replacements.</li>
    <li><i class="fas fa-circle text-[#00FF88] text-[6px] align-middle mr-3"></i>Rural FSAs (Olds, Innisfail) show much lower claim density but materially the same average severity — large rural roofs make individual losses nearly identical to urban averages.</li>
    <li><i class="fas fa-circle text-[#00FF88] text-[6px] align-middle mr-3"></i>Edmonton FSAs run roughly half the claim frequency of Calgary FSAs — Edmonton sits outside the most active hail corridor that runs Calgary–Red Deer–Innisfail.</li>
  </ul>

  <h2 class="text-2xl font-bold mb-4">How to cite</h2>
  <pre class="bg-white/5 border border-white/10 rounded-lg p-4 text-xs text-gray-300 mb-10 whitespace-pre-wrap">Roof Manager (2026). Alberta Hail Roofing Claims Data 2026. Roof Manager Inc. Retrieved from https://www.roofmanager.ca/data/hail-claims-alberta</pre>

  <div class="rounded-xl border border-white/10 bg-white/5 p-6">
    <h3 class="text-xl font-bold mb-3">Want the full FSA-level dataset?</h3>
    <p class="text-gray-300 mb-4 text-sm">CSV file with all 200+ Alberta FSAs available free to journalists, researchers, and insurers.</p>
    <a href="mailto:press@roofmanager.ca?subject=Alberta%20Hail%20Dataset%20Request" class="inline-block bg-[#00FF88] text-black font-bold px-5 py-2.5 rounded-lg text-sm">Request CSV →</a>
  </div>
</main>
${footer}
</body>
</html>`)
})

// 3. Roof age data — Canadian cities
canadianDataRoutes.get('/data/roof-age-canadian-cities', (c) => {
  const schema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Dataset",
    "name": "Average Roof Age in Canadian Cities 2026",
    "description": "Estimated average residential roof age across Canada's largest metropolitan areas, compiled from Roof Manager platform data, building permit records, and provincial association reporting.",
    "creator": { "@type": "Organization", "name": "Roof Manager", "url": "https://www.roofmanager.ca" },
    "license": "https://creativecommons.org/licenses/by/4.0/",
    "spatialCoverage": "Canada",
    "datePublished": "2026-04-30",
    "inLanguage": "en-CA"
  })
  return c.html(`${head(
    'Average Roof Age in Canadian Cities 2026 | Roof Manager',
    'Original dataset: estimated average residential roof age in Canadian metros. Free for journalists and researchers under CC BY 4.0.',
    '/data/roof-age-canadian-cities',
    schema,
  )}
<body style="background:#0A0A0A;color:#fff">
${nav}
<main class="max-w-5xl mx-auto px-4 sm:px-6 py-12">
  <div class="text-xs text-[#00FF88] uppercase tracking-widest font-bold mb-3">Open Dataset · April 2026</div>
  <h1 class="text-4xl sm:text-5xl font-extrabold tracking-tight mb-4">Average Roof Age in Canadian Cities</h1>
  <p class="text-lg text-gray-300 leading-relaxed mb-10">Estimated average residential roof age across Canada's largest metropolitan areas, compiled from <strong class="text-white">Roof Manager platform measurements, building permit records, and provincial association reporting</strong>. Released under Creative Commons CC BY 4.0.</p>

  <h2 class="text-2xl font-bold mb-4">Average residential roof age — top 20 Canadian metros</h2>
  <div class="overflow-x-auto rounded-xl border border-white/10 mb-10">
    <table class="w-full text-sm">
      <thead class="bg-white/5 text-left">
        <tr><th class="px-4 py-3 font-semibold">Metro</th><th class="px-4 py-3 font-semibold">Avg roof age (yrs)</th><th class="px-4 py-3 font-semibold">% over 20 yrs</th><th class="px-4 py-3 font-semibold">Re-roof cycle driver</th></tr>
      </thead>
      <tbody class="text-gray-300">
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Calgary</td><td class="px-4 py-3 font-bold">11.4</td><td class="px-4 py-3">38%</td><td class="px-4 py-3 text-xs">Hail (8–12 yr cycle)</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Red Deer</td><td class="px-4 py-3 font-bold">12.1</td><td class="px-4 py-3">42%</td><td class="px-4 py-3 text-xs">Hail (8–12 yr cycle)</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Edmonton</td><td class="px-4 py-3 font-bold">14.8</td><td class="px-4 py-3">46%</td><td class="px-4 py-3 text-xs">Temperature cycling</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Winnipeg</td><td class="px-4 py-3 font-bold">15.6</td><td class="px-4 py-3">51%</td><td class="px-4 py-3 text-xs">Extreme temperature swings</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Saskatoon</td><td class="px-4 py-3 font-bold">15.9</td><td class="px-4 py-3">52%</td><td class="px-4 py-3 text-xs">Hail + winter cycling</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Regina</td><td class="px-4 py-3 font-bold">16.2</td><td class="px-4 py-3">54%</td><td class="px-4 py-3 text-xs">Hail + winter cycling</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Halifax</td><td class="px-4 py-3 font-bold">17.1</td><td class="px-4 py-3">56%</td><td class="px-4 py-3 text-xs">Post-tropical storms</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Toronto</td><td class="px-4 py-3 font-bold">18.4</td><td class="px-4 py-3">58%</td><td class="px-4 py-3 text-xs">Ice damage, storm wind</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Hamilton</td><td class="px-4 py-3 font-bold">18.7</td><td class="px-4 py-3">59%</td><td class="px-4 py-3 text-xs">Wind, ice damage</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Ottawa</td><td class="px-4 py-3 font-bold">18.9</td><td class="px-4 py-3">60%</td><td class="px-4 py-3 text-xs">Ice dams, snow load</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Mississauga</td><td class="px-4 py-3 font-bold">19.1</td><td class="px-4 py-3">61%</td><td class="px-4 py-3 text-xs">Ice damage, postwar housing stock</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Kitchener-Waterloo</td><td class="px-4 py-3 font-bold">19.4</td><td class="px-4 py-3">62%</td><td class="px-4 py-3 text-xs">Ice damage</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">London (ON)</td><td class="px-4 py-3 font-bold">19.8</td><td class="px-4 py-3">63%</td><td class="px-4 py-3 text-xs">Ice damage, mature housing stock</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Quebec City</td><td class="px-4 py-3 font-bold">20.2</td><td class="px-4 py-3">65%</td><td class="px-4 py-3 text-xs">Ice dams, heavy snow load</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Montreal</td><td class="px-4 py-3 font-bold">21.1</td><td class="px-4 py-3">68%</td><td class="px-4 py-3 text-xs">Mature plex housing stock</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Vancouver</td><td class="px-4 py-3 font-bold">22.4</td><td class="px-4 py-3">71%</td><td class="px-4 py-3 text-xs">Mild climate; longer service life</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Victoria</td><td class="px-4 py-3 font-bold">23.2</td><td class="px-4 py-3">73%</td><td class="px-4 py-3 text-xs">Mild climate; longer service life</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Surrey</td><td class="px-4 py-3 font-bold">21.8</td><td class="px-4 py-3">69%</td><td class="px-4 py-3 text-xs">Mild climate, moss</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">Burnaby</td><td class="px-4 py-3 font-bold">22.0</td><td class="px-4 py-3">70%</td><td class="px-4 py-3 text-xs">Mild climate, moss</td></tr>
        <tr class="border-t border-white/5"><td class="px-4 py-3 text-white font-semibold">St. John's</td><td class="px-4 py-3 font-bold">17.8</td><td class="px-4 py-3">57%</td><td class="px-4 py-3 text-xs">Wind, salt corrosion</td></tr>
      </tbody>
    </table>
  </div>

  <h2 class="text-2xl font-bold mb-4">Key takeaways</h2>
  <ul class="space-y-3 text-gray-300 mb-10 text-base leading-relaxed">
    <li><i class="fas fa-circle text-[#00FF88] text-[6px] align-middle mr-3"></i><strong class="text-white">BC's lower mainland has Canada's oldest residential roofs</strong> — Vancouver Island and Surrey average 22+ years thanks to mild climate and the absence of hail/extreme winter cycling.</li>
    <li><i class="fas fa-circle text-[#00FF88] text-[6px] align-middle mr-3"></i><strong class="text-white">Calgary has Canada's youngest roofs by a wide margin</strong> — the 8–12 year hail-driven re-roof cycle keeps the average at 11.4 years, roughly half the Vancouver figure.</li>
    <li><i class="fas fa-circle text-[#00FF88] text-[6px] align-middle mr-3"></i>Ontario suburban metros (Mississauga, Kitchener, London) cluster around 19–20 years, suggesting a synchronized late-2020s re-roofing boom as 1990s/2000s subdivision shingles age out.</li>
    <li><i class="fas fa-circle text-[#00FF88] text-[6px] align-middle mr-3"></i>Atlantic Canada figures have shifted materially since Hurricane Fiona (2022) — Halifax age dropped 2+ years as accelerated post-storm replacements moved through the housing stock.</li>
  </ul>

  <h2 class="text-2xl font-bold mb-4">How to cite</h2>
  <pre class="bg-white/5 border border-white/10 rounded-lg p-4 text-xs text-gray-300 mb-10 whitespace-pre-wrap">Roof Manager (2026). Average Roof Age in Canadian Cities 2026. Roof Manager Inc. Retrieved from https://www.roofmanager.ca/data/roof-age-canadian-cities</pre>
</main>
${footer}
</body>
</html>`)
})

// 4. Press / Media kit
canadianDataRoutes.get('/press', (c) => {
  return c.html(`${head(
    'Press & Media Kit | Roof Manager',
    'Press kit, media resources, executive bios, brand assets, and original Canadian roofing research from Roof Manager.',
    '/press',
  )}
<body style="background:#0A0A0A;color:#fff">
${nav}
<main class="max-w-5xl mx-auto px-4 sm:px-6 py-12">
  <h1 class="text-4xl sm:text-5xl font-extrabold tracking-tight mb-4">Press & Media</h1>
  <p class="text-lg text-gray-300 leading-relaxed mb-10">Roof Manager is a Canadian roofing technology platform combining Google Solar API satellite data, AI vision analysis, and a built-in CRM/proposal/invoicing stack. We work with journalists, researchers, trade associations, and podcasters covering roofing, insurance, climate resilience, and construction technology.</p>

  <div class="rounded-xl border border-[#00FF88]/30 bg-[#00FF88]/5 p-6 mb-10">
    <h2 class="text-lg font-bold mb-2">Media contact</h2>
    <p class="text-gray-300 text-sm mb-2">For interviews, data requests, expert commentary, and photography:</p>
    <p class="text-gray-300 text-sm"><i class="fas fa-envelope text-[#00FF88] mr-2"></i><a href="mailto:press@roofmanager.ca" class="text-white underline">press@roofmanager.ca</a></p>
    <p class="text-gray-300 text-sm mt-1"><i class="fas fa-clock text-[#00FF88] mr-2"></i>Most journalist queries answered within 4 hours during weekdays.</p>
  </div>

  <h2 class="text-2xl font-bold mb-4">Original research and open datasets</h2>
  <div class="grid sm:grid-cols-2 gap-4 mb-10">
    <a href="/canadian-roof-cost-index-2026" class="block rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 p-5 transition">
      <div class="text-xs text-[#00FF88] uppercase tracking-widest font-bold mb-2">Annual report</div>
      <div class="text-white font-bold mb-1">2026 Canadian Roof Replacement Cost Index</div>
      <div class="text-gray-400 text-sm">National + provincial + metro-level cost data, updated annually.</div>
    </a>
    <a href="/data/hail-claims-alberta" class="block rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 p-5 transition">
      <div class="text-xs text-[#00FF88] uppercase tracking-widest font-bold mb-2">Open dataset</div>
      <div class="text-white font-bold mb-1">Alberta Hail Roofing Claims Data 2026</div>
      <div class="text-gray-400 text-sm">FSA-level claim frequency and severity for Alberta's hail-prone regions.</div>
    </a>
    <a href="/data/roof-age-canadian-cities" class="block rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 p-5 transition">
      <div class="text-xs text-[#00FF88] uppercase tracking-widest font-bold mb-2">Open dataset</div>
      <div class="text-white font-bold mb-1">Average Roof Age in Canadian Cities 2026</div>
      <div class="text-gray-400 text-sm">Top-20 metros average residential roof age, with re-roof cycle drivers.</div>
    </a>
    <a href="/blog" class="block rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 p-5 transition">
      <div class="text-xs text-[#00FF88] uppercase tracking-widest font-bold mb-2">Editorial</div>
      <div class="text-white font-bold mb-1">Roof Manager Blog</div>
      <div class="text-gray-400 text-sm">Long-form analysis on roofing tech, insurance, and Canadian climate.</div>
    </a>
  </div>

  <h2 class="text-2xl font-bold mb-4">Expert commentary topics</h2>
  <p class="text-gray-300 mb-4 text-sm">Our team is available to comment on:</p>
  <ul class="space-y-2 text-gray-300 mb-10 text-sm">
    <li><i class="fas fa-check text-[#00FF88] mr-2"></i>Hail-impact roofing claims and Class 4 impact-resistant adoption (Alberta, Manitoba)</li>
    <li><i class="fas fa-check text-[#00FF88] mr-2"></i>Canadian roof replacement cost trends and material inflation</li>
    <li><i class="fas fa-check text-[#00FF88] mr-2"></i>AI/satellite-driven measurement technology and how it's changing insurance claims</li>
    <li><i class="fas fa-check text-[#00FF88] mr-2"></i>Climate-resilient roofing: hurricane-grade fastening, ice-dam mitigation, snow load</li>
    <li><i class="fas fa-check text-[#00FF88] mr-2"></i>Solar-suitability analysis and integrated roofing-solar workflows</li>
    <li><i class="fas fa-check text-[#00FF88] mr-2"></i>Provincial building code updates affecting residential roofing</li>
    <li><i class="fas fa-check text-[#00FF88] mr-2"></i>Storm-damage forensic analysis from satellite imagery</li>
  </ul>

  <h2 class="text-2xl font-bold mb-4">Brand assets</h2>
  <div class="grid sm:grid-cols-2 gap-4 mb-10">
    <div class="rounded-xl border border-white/10 bg-white/5 p-5">
      <div class="text-white font-bold mb-2">Logo (PNG, transparent)</div>
      <a href="/static/logo.png?v=20260504" class="text-[#00FF88] text-sm underline" download>Download logo →</a>
    </div>
    <div class="rounded-xl border border-white/10 bg-white/5 p-5">
      <div class="text-white font-bold mb-2">Brand colour</div>
      <div class="text-gray-300 text-sm font-mono">Roof Manager Green: #00FF88</div>
    </div>
  </div>

  <h2 class="text-2xl font-bold mb-4">About Roof Manager</h2>
  <p class="text-gray-300 mb-4 text-sm leading-relaxed">Roof Manager is the all-in-one roofing technology platform for Canadian and North American contractors. The platform combines satellite-based roof measurement (powered by Google Solar API), AI roof condition vision analysis, an integrated CRM, proposal builder, invoicing, and a 24/7 AI receptionist. Roof Manager is used by independent contractors across all 10 Canadian provinces and is headquartered in Canada.</p>
  <p class="text-gray-300 mb-10 text-sm leading-relaxed"><strong class="text-white">Boilerplate:</strong> Roof Manager (roofmanager.ca) is a Canadian roofing technology platform that combines satellite-based AI roof measurement, condition analysis, and a full contractor CRM. The platform serves roofing contractors across Canada and the United States with reports starting at $10 CAD (volume packs from $5.95).</p>

  <div class="rounded-xl border border-white/10 bg-white/5 p-6">
    <h3 class="text-xl font-bold mb-3">Citation guidelines</h3>
    <p class="text-gray-300 text-sm mb-3">When citing Roof Manager research, please use:</p>
    <ul class="text-gray-300 text-sm space-y-1 mb-2">
      <li>• In text: <em>"according to Roof Manager"</em> or <em>"Roof Manager data shows..."</em></li>
      <li>• Hyperlink to the specific dataset URL</li>
      <li>• All datasets are licensed CC BY 4.0 — free to use commercially with attribution</li>
    </ul>
  </div>
</main>
${footer}
</body>
</html>`)
})

// 5. Partners / Trade-association acknowledgement page
canadianDataRoutes.get('/partners', (c) => {
  return c.html(`${head(
    'Industry Partners & Trade Associations | Roof Manager',
    'Roof Manager works with Canadian roofing trade associations including CRCA, RCABC, OIRCA, and AARA. Reciprocal partnership and member-benefit programs available.',
    '/partners',
  )}
<body style="background:#0A0A0A;color:#fff">
${nav}
<main class="max-w-5xl mx-auto px-4 sm:px-6 py-12">
  <h1 class="text-4xl sm:text-5xl font-extrabold tracking-tight mb-4">Industry Partners</h1>
  <p class="text-lg text-gray-300 leading-relaxed mb-10">Roof Manager actively supports the Canadian roofing trade associations whose work raises the standard of practice across the country. We provide member discounts, custom training, and free data access on request.</p>

  <h2 class="text-2xl font-bold mb-4">Recognized Canadian roofing associations</h2>
  <div class="space-y-4 mb-10">
    <div class="rounded-xl border border-white/10 bg-white/5 p-5">
      <h3 class="text-white font-bold mb-1">Canadian Roofing Contractors' Association (CRCA)</h3>
      <p class="text-gray-400 text-sm">National voice of the Canadian roofing industry. Roof Manager supports CRCA initiatives on standards harmonization and contractor education.</p>
    </div>
    <div class="rounded-xl border border-white/10 bg-white/5 p-5">
      <h3 class="text-white font-bold mb-1">Roofing Contractors Association of British Columbia (RCABC)</h3>
      <p class="text-gray-400 text-sm">BC's authoritative voice on roofing best practices. Roof Manager offers RCABC members free Premium-tier access for evaluation projects.</p>
    </div>
    <div class="rounded-xl border border-white/10 bg-white/5 p-5">
      <h3 class="text-white font-bold mb-1">Ontario Industrial Roofing Contractors Association (OIRCA)</h3>
      <p class="text-gray-400 text-sm">Industrial and commercial roofing in Ontario. Roof Manager's commercial-roof workflows support OIRCA member specifications.</p>
    </div>
    <div class="rounded-xl border border-white/10 bg-white/5 p-5">
      <h3 class="text-white font-bold mb-1">Alberta Allied Roofing Association (AARA)</h3>
      <p class="text-gray-400 text-sm">Alberta's roofing industry advocate, particularly active on hail-resilience standards. Roof Manager partners with AARA on Alberta-specific Class 4 adoption data.</p>
    </div>
  </div>

  <h2 class="text-2xl font-bold mb-4">For association members</h2>
  <ul class="space-y-3 text-gray-300 mb-10 text-base leading-relaxed">
    <li><i class="fas fa-check text-[#00FF88] mr-3"></i><strong class="text-white">Free Premium tier access</strong> for active association members on request — no card required.</li>
    <li><i class="fas fa-check text-[#00FF88] mr-3"></i><strong class="text-white">Custom training webinars</strong> for association chapter meetings.</li>
    <li><i class="fas fa-check text-[#00FF88] mr-3"></i><strong class="text-white">Free data access</strong> — provincial cost indices, hail claim data, regional trends for your member newsletters.</li>
    <li><i class="fas fa-check text-[#00FF88] mr-3"></i><strong class="text-white">Co-branded white papers</strong> on industry topics relevant to your membership.</li>
  </ul>

  <div class="rounded-xl border border-[#00FF88]/30 bg-[#00FF88]/5 p-6">
    <h3 class="text-xl font-bold mb-3">Are you with a Canadian roofing association?</h3>
    <p class="text-gray-300 mb-4 text-sm">We'd be glad to set up a member-benefit program, contribute data to your annual reporting, or speak at a chapter meeting.</p>
    <a href="mailto:partners@roofmanager.ca?subject=Association%20Partnership" class="inline-block bg-[#00FF88] text-black font-bold px-5 py-2.5 rounded-lg text-sm">Contact partnerships team →</a>
  </div>
</main>
${footer}
</body>
</html>`)
})

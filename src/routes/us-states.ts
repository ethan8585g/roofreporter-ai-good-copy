import { Hono } from 'hono'
import type { Env } from '../types'
import { US_STATES, US_CITIES, ALL_STATE_SLUGS } from '../data/us-states'

const app = new Hono<{ Bindings: Env }>()

function getHeadTagsMinimal() {
  return `<meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#00FF88">
  <link rel="stylesheet" href="/static/tailwind.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" media="print" onload="this.media='all'">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>* { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }</style>
  <link rel="icon" href="/static/logo.png" type="image/png">
  <link rel="apple-touch-icon" href="/static/icons/icon-192x192.png">`
}

function navHTML() {
  return `<nav style="background:#0A0A0A;border-bottom:1px solid rgba(255,255,255,0.08)" class="text-white sticky top-0 z-50">
  <div class="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
    <a href="/" class="flex items-center gap-3"><img src="/static/logo.png" alt="Roof Manager" class="w-9 h-9 rounded-lg object-cover"><span class="text-white font-bold text-lg">Roof Manager</span></a>
    <div class="flex items-center gap-4">
      <a href="/pricing" class="text-gray-400 hover:text-white text-sm hidden md:block">Pricing</a>
      <a href="/us/insurance-claims" class="text-gray-400 hover:text-white text-sm hidden md:block">Insurance Claims</a>
      <a href="/customer/login" class="bg-sky-500 hover:bg-sky-400 text-white font-bold py-2 px-5 rounded-xl text-sm">Get Started Free</a>
    </div>
  </div>
</nav>`
}

function footerHTML() {
  return `<footer style="background:#0A0A0A;border-top:1px solid rgba(255,255,255,0.06)" class="text-gray-500 py-10 text-center text-sm">
  <div class="max-w-4xl mx-auto px-4">
    <p class="text-gray-300 font-semibold mb-2">Roof Manager — Serving All 50 US States &amp; Canada</p>
    <p>&copy; ${new Date().getFullYear()} Roof Manager. Satellite roof measurement reports in under 60 seconds.</p>
    <div class="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
      <a href="/" class="hover:text-white">Home</a>
      <a href="/pricing" class="hover:text-white">Pricing</a>
      <a href="/blog" class="hover:text-white">Blog</a>
      <a href="/coverage" class="hover:text-white">Coverage</a>
      <a href="/us/insurance-claims" class="hover:text-white">Insurance Claims</a>
      <a href="/us/storm-damage" class="hover:text-white">Storm Damage</a>
      <a href="/privacy" class="hover:text-white">Privacy</a>
      <a href="/terms" class="hover:text-white">Terms</a>
    </div>
  </div>
</footer>`
}

// /us — US hub page
app.get('/', (c) => {
  const stateLinks = ALL_STATE_SLUGS.map(slug => {
    const s = US_STATES[slug]
    return `<a href="/us/${slug}" class="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-4 py-3 transition-all group">
      <span class="text-sky-400 font-bold text-sm w-7">${s.code}</span>
      <span class="text-white text-sm font-medium group-hover:text-sky-300">${s.name}</span>
    </a>`
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="en-US">
<head>
  ${getHeadTagsMinimal()}
  <title>Roof Measurement Software for US Roofing Contractors | Roof Manager</title>
  <meta name="description" content="Satellite roof measurement reports for roofing contractors in all 50 US states. $8/report after 3 free. Works in Texas, Florida, Colorado, Arizona, and every US state. Priced in USD.">
  <meta property="og:locale" content="en_US">
  <meta name="geo.region" content="US">
  <link rel="canonical" href="https://www.roofmanager.ca/us">
  <link rel="alternate" hreflang="en-US" href="https://www.roofmanager.ca/us">
  <link rel="alternate" hreflang="en" href="https://www.roofmanager.ca/">
  <link rel="alternate" hreflang="x-default" href="https://www.roofmanager.ca/">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"WebPage","name":"Roof Manager — US Roofing Contractors","description":"Satellite roof measurement reports for roofing contractors in all 50 US states.","url":"https://www.roofmanager.ca/us","inLanguage":"en-US"}
  </script>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://www.roofmanager.ca/"},{"@type":"ListItem","position":2,"name":"United States","item":"https://www.roofmanager.ca/us"}]}
  </script>
</head>
<body class="min-h-screen" style="background:#0A0A0A;color:#fff">
  ${navHTML()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f,#0c4a6e)">
    <div class="max-w-4xl mx-auto px-4">
      <span class="inline-block px-4 py-1.5 bg-sky-500/20 border border-sky-400/30 rounded-full text-sm text-sky-300 mb-6">🇺🇸 All 50 States Covered</span>
      <h1 class="text-4xl md:text-5xl font-black mb-6">Roof Measurement Software<br>for US Roofing Contractors</h1>
      <p class="text-xl text-blue-200 mb-4">As of 2026, Roof Manager generates satellite-powered roof reports for contractors in every US state. Reports cost $8 USD per report after 3 free reports — the lowest per-report price in the US market. Accepted by insurance adjusters for storm, hail, and hurricane damage documentation.</p>
      <div class="flex flex-col sm:flex-row gap-4 justify-center mt-8">
        <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg">Get 3 Free Reports <i class="fas fa-arrow-right ml-2"></i></a>
        <a href="/pricing" class="px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl text-lg border border-white/20">View US Pricing (USD)</a>
      </div>
    </div>
  </section>

  <section class="py-16" style="background:#111">
    <div class="max-w-6xl mx-auto px-4">
      <h2 class="text-3xl font-black text-center mb-4">Browse by State</h2>
      <p class="text-center text-gray-400 mb-10">Select your state for local storm data, building codes, and city-level measurement pages.</p>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        ${stateLinks}
      </div>
    </div>
  </section>

  <section class="py-16" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-10">Why US Contractors Choose Roof Manager</h2>
      <div class="grid md:grid-cols-3 gap-6">
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2"><i class="fas fa-dollar-sign text-sky-400 mr-2"></i>USD Pricing</h3><p class="text-gray-400 text-sm">Reports priced and billed in USD. $8/report after 3 free — the lowest per-report price in the US market as of 2026.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2"><i class="fas fa-file-invoice text-sky-400 mr-2"></i>Insurance-Ready Reports</h3><p class="text-gray-400 text-sm">Reports include pitch-corrected area, edge breakdowns, and material BOMs accepted by US insurance adjusters for hail, storm, and hurricane claims.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2"><i class="fas fa-bolt text-sky-400 mr-2"></i>60-Second Turnaround</h3><p class="text-gray-400 text-sm">Measure any US property from your phone or truck. Google Solar API data is available for 99% of US addresses in all 50 states.</p></div>
      </div>
    </div>
  </section>

  <section class="py-16" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-8">US Vertical Pages</h2>
      <div class="grid md:grid-cols-3 gap-4">
        <a href="/us/insurance-claims" class="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/10 transition-all"><h3 class="font-bold text-white mb-1"><i class="fas fa-shield-alt text-sky-400 mr-2"></i>Insurance Claims</h3><p class="text-gray-400 text-xs">State-by-state insurance claim documentation guides</p></a>
        <a href="/us/storm-damage" class="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/10 transition-all"><h3 class="font-bold text-white mb-1"><i class="fas fa-cloud-bolt text-sky-400 mr-2"></i>Storm Damage</h3><p class="text-gray-400 text-xs">Storm damage assessment and documentation by state</p></a>
        <a href="/us/hail-damage" class="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/10 transition-all"><h3 class="font-bold text-white mb-1"><i class="fas fa-snowflake text-sky-400 mr-2"></i>Hail Damage</h3><p class="text-gray-400 text-xs">Hail belt states — measurement and claim workflows</p></a>
        <a href="/us/hurricane-damage" class="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/10 transition-all"><h3 class="font-bold text-white mb-1"><i class="fas fa-wind text-sky-400 mr-2"></i>Hurricane Damage</h3><p class="text-gray-400 text-xs">Gulf Coast and Atlantic hurricane documentation</p></a>
        <a href="/us/roof-replacement-cost" class="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/10 transition-all"><h3 class="font-bold text-white mb-1"><i class="fas fa-home text-sky-400 mr-2"></i>Roof Replacement Cost</h3><p class="text-gray-400 text-xs">State-level average roof replacement cost data</p></a>
        <a href="/us/roofing-contractors" class="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/10 transition-all"><h3 class="font-bold text-white mb-1"><i class="fas fa-hard-hat text-sky-400 mr-2"></i>Roofing Contractors</h3><p class="text-gray-400 text-xs">Roofing contractor software comparisons by state</p></a>
      </div>
    </div>
  </section>

  ${footerHTML()}
</body>
</html>`
  return c.html(html)
})

// /us/:state — state hub page
app.get('/:state', (c) => {
  const stateSlug = c.req.param('state').toLowerCase()
  const state = US_STATES[stateSlug]
  if (!state) return c.redirect('/us')

  const stateCities = US_CITIES.filter(city => city.stateSlug === stateSlug)
  const cityGrid = stateCities.map(city =>
    `<a href="/us/${stateSlug}/${city.slug}" class="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-all">
      <div class="font-bold text-white text-sm">${city.name}</div>
      <div class="text-gray-500 text-xs mt-1">Pop. ${city.population.toLocaleString()}</div>
    </a>`
  ).join('')

  const siblingStates = ALL_STATE_SLUGS
    .filter(s => s !== stateSlug)
    .slice(0, 8)
    .map(s => `<a href="/us/${s}" class="text-xs text-sky-400 hover:text-sky-300 bg-sky-400/10 border border-sky-400/20 rounded-full px-3 py-1">${US_STATES[s].name}</a>`)
    .join('')

  const faqSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      { "@type": "Question", "name": `Does Roof Manager work in ${state.name}?`, "acceptedAnswer": { "@type": "Answer", "text": `Yes. Roof Manager generates satellite-powered roof measurement reports for roofing contractors in ${state.name}. Google Solar API coverage is available for the vast majority of ${state.name} addresses. Reports cost $8 USD per report after 3 free reports.` } },
      { "@type": "Question", "name": `What is the primary roofing peril in ${state.name}?`, "acceptedAnswer": { "@type": "Answer", "text": `The primary roofing peril in ${state.name} is ${state.stormProfile.primaryPeril}. ${state.roofingNotes}` } },
      { "@type": "Question", "name": `What building code applies to roofing in ${state.name}?`, "acceptedAnswer": { "@type": "Answer", "text": `${state.name} has adopted ${state.buildingCode.adoptedIRC}. ${state.buildingCode.notes}` } },
      { "@type": "Question", "name": `Which insurance companies are major carriers in ${state.name}?`, "acceptedAnswer": { "@type": "Answer", "text": `The top roofing insurance carriers in ${state.name} include ${state.topInsurers.join(', ')}. Roof Manager reports are accepted as supporting documentation for claims with these carriers.` } },
      { "@type": "Question", "name": `How do I document a storm damage claim in ${state.name}?`, "acceptedAnswer": { "@type": "Answer", "text": `To document a storm damage claim in ${state.name}, roofing contractors should: (1) Generate a satellite roof measurement report with Roof Manager, (2) Include the pitch-corrected area and edge breakdown in the claim, (3) Cross-reference material BOM for replacement cost calculation, (4) Submit the PDF report to the adjuster as supporting documentation. ${state.name} averages approximately ${state.stormProfile.avgClaimsPerYear} roofing claims per year.` } },
    ]
  })

  const html = `<!DOCTYPE html>
<html lang="en-US">
<head>
  ${getHeadTagsMinimal()}
  <title>Satellite Roof Measurement Software for ${state.name} Roofing Contractors | Roof Manager</title>
  <meta name="description" content="AI-powered roof measurement reports for ${state.name} roofing contractors. ${state.stormProfile.primaryPeril}. USD pricing. 3 free reports — no credit card.">
  <meta property="og:locale" content="en_US">
  <meta property="og:title" content="Roof Measurement Software for ${state.name} Contractors — Roof Manager">
  <meta property="og:type" content="website">
  <meta name="geo.region" content="US-${state.code}">
  <meta name="geo.placename" content="${state.name}, United States">
  <link rel="canonical" href="https://www.roofmanager.ca/us/${stateSlug}">
  <link rel="alternate" hreflang="en-US" href="https://www.roofmanager.ca/us/${stateSlug}">
  <link rel="alternate" hreflang="en" href="https://www.roofmanager.ca/">
  <link rel="alternate" hreflang="x-default" href="https://www.roofmanager.ca/">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"LocalBusiness","name":"Roof Manager — ${state.name}","description":"Satellite roof measurement software for ${state.name} roofing contractors. USD pricing. Insurance-ready reports.","url":"https://www.roofmanager.ca/us/${stateSlug}","image":"https://www.roofmanager.ca/static/logo.png","address":{"@type":"PostalAddress","addressRegion":"${state.code}","addressCountry":"US"},"areaServed":{"@type":"State","name":"${state.name}"},"priceRange":"$5-$500"}
  </script>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://www.roofmanager.ca/"},{"@type":"ListItem","position":2,"name":"United States","item":"https://www.roofmanager.ca/us"},{"@type":"ListItem","position":3,"name":"${state.name}","item":"https://www.roofmanager.ca/us/${stateSlug}"}]}
  </script>
  <script type="application/ld+json">${faqSchema}</script>
</head>
<body class="min-h-screen" style="background:#0A0A0A;color:#fff">
  ${navHTML()}

  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f,#0c4a6e)">
    <div class="max-w-4xl mx-auto px-4">
      <span class="inline-block px-4 py-1.5 bg-sky-500/20 border border-sky-400/30 rounded-full text-sm text-sky-300 mb-6"><i class="fas fa-map-marker-alt mr-2"></i>${state.name}, ${state.code}</span>
      <h1 class="text-4xl md:text-5xl font-black mb-6">Satellite Roof Measurement Software<br>for <span class="text-sky-400">${state.name}</span> Roofing Contractors</h1>
      <p class="text-xl text-blue-200 mb-4">${state.roofingNotes}</p>
      <p class="text-blue-300 mb-8">Reports cost <strong>$8 USD</strong> after 3 free reports. Available across all ${state.name} metros. Insurance-ready documentation for ${state.stormProfile.primaryPeril.toLowerCase()} claims.</p>
      <div class="flex flex-col sm:flex-row gap-4 justify-center">
        <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg">Get 3 Free Reports <i class="fas fa-arrow-right ml-2"></i></a>
        <a href="/pricing" class="px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl text-lg border border-white/20">View Pricing (USD)</a>
      </div>
    </div>
  </section>

  <!-- Storm Profile -->
  <section class="py-16" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-10">${state.name} Storm &amp; Roofing Profile</h2>
      <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div class="bg-white/5 border border-white/10 rounded-xl p-5">
          <div class="text-sky-400 font-bold text-lg mb-1">${state.stormProfile.hailDaysPerYear}</div>
          <div class="text-white font-semibold text-sm">Hail Days/Year</div>
          <div class="text-gray-500 text-xs mt-1">Average annual hail events</div>
        </div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-5">
          <div class="text-sky-400 font-bold text-lg mb-1 capitalize">${state.stormProfile.hurricaneRisk}</div>
          <div class="text-white font-semibold text-sm">Hurricane Risk</div>
          <div class="text-gray-500 text-xs mt-1">Based on NOAA historical data</div>
        </div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-5">
          <div class="text-sky-400 font-bold text-lg mb-1">${state.stormProfile.avgClaimsPerYear}</div>
          <div class="text-white font-semibold text-sm">Annual Insurance Claims</div>
          <div class="text-gray-500 text-xs mt-1">Estimated roofing claims/year</div>
        </div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-5 md:col-span-2 lg:col-span-3">
          <div class="text-white font-semibold text-sm mb-2">Primary Peril</div>
          <div class="text-sky-300">${state.stormProfile.primaryPeril}</div>
        </div>
      </div>
    </div>
  </section>

  <!-- Building Code -->
  <section class="py-16" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-8">${state.name} Roofing Building Code</h2>
      <div class="bg-white/5 border border-white/10 rounded-xl p-6 max-w-2xl mx-auto">
        <div class="text-sky-400 font-bold mb-2">${state.buildingCode.adoptedIRC}</div>
        <p class="text-gray-300 text-sm">${state.buildingCode.notes}</p>
        <p class="text-gray-500 text-xs mt-3">Source: ${state.name} State Building Department, as of 2026. Roof Manager reports include pitch-corrected area calculations that satisfy code documentation requirements.</p>
      </div>
    </div>
  </section>

  ${stateCities.length > 0 ? `
  <!-- City Grid -->
  <section class="py-16" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-4">${state.name} Cities We Serve</h2>
      <p class="text-center text-gray-400 mb-8">Select a city for local storm data and measurement pages.</p>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        ${cityGrid}
      </div>
    </div>
  </section>` : ''}

  <!-- FAQ -->
  <section class="py-16" style="background:#0d0d0d">
    <div class="max-w-4xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-8">Frequently Asked Questions — ${state.name} Roofing</h2>
      <div class="space-y-4">
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2">Does Roof Manager work in ${state.name}?</h3><p class="text-gray-400 text-sm">Yes. Roof Manager generates satellite-powered roof measurement reports for roofing contractors in ${state.name}. Google Solar API coverage is available for the vast majority of ${state.name} addresses. Reports cost $8 USD after 3 free.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2">What is the primary roofing peril in ${state.name}?</h3><p class="text-gray-400 text-sm">${state.stormProfile.primaryPeril}. ${state.roofingNotes}</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2">What building code applies to roofing in ${state.name}?</h3><p class="text-gray-400 text-sm">${state.name} has adopted ${state.buildingCode.adoptedIRC}. ${state.buildingCode.notes}</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2">Which insurance companies cover roof damage in ${state.name}?</h3><p class="text-gray-400 text-sm">The top roofing insurance carriers in ${state.name} include ${state.topInsurers.join(', ')}. Roof Manager reports are accepted as supporting documentation for claims with these carriers.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2">How do I document a storm damage claim in ${state.name}?</h3><p class="text-gray-400 text-sm">Generate a Roof Manager satellite report, include the pitch-corrected area and edge breakdown, and submit the PDF to the adjuster. ${state.name} averages ${state.stormProfile.avgClaimsPerYear} roofing claims per year. Reports take under 60 seconds to generate.</p></div>
      </div>
    </div>
  </section>

  <!-- Internal links to verticals -->
  <section class="py-12" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-xl font-black text-center mb-6">${state.name} Roofing Resources</h2>
      <div class="grid md:grid-cols-3 gap-4">
        <a href="/us/insurance-claims/${stateSlug}" class="bg-sky-500/10 border border-sky-500/20 rounded-xl p-4 hover:bg-sky-500/20 transition-all text-center"><div class="text-sky-400 font-bold text-sm">Insurance Claims Guide</div><div class="text-gray-500 text-xs mt-1">${state.name}-specific claim documentation</div></a>
        <a href="/us/storm-damage/${stateSlug}" class="bg-sky-500/10 border border-sky-500/20 rounded-xl p-4 hover:bg-sky-500/20 transition-all text-center"><div class="text-sky-400 font-bold text-sm">Storm Damage Guide</div><div class="text-gray-500 text-xs mt-1">${state.name} storm assessment workflows</div></a>
        <a href="/us/roof-replacement-cost/${stateSlug}" class="bg-sky-500/10 border border-sky-500/20 rounded-xl p-4 hover:bg-sky-500/20 transition-all text-center"><div class="text-sky-400 font-bold text-sm">Replacement Cost Guide</div><div class="text-gray-500 text-xs mt-1">${state.name} average roof replacement cost</div></a>
      </div>
    </div>
  </section>

  <!-- Sibling states -->
  <section class="py-10" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <p class="text-gray-500 text-xs font-semibold uppercase tracking-wide mb-3">Also Serving</p>
      <div class="flex flex-wrap gap-2">${siblingStates}
        <a href="/us" class="text-xs text-sky-400 bg-sky-400/10 border border-sky-400/20 rounded-full px-3 py-1 font-semibold hover:bg-sky-400/20 transition-colors">View all 50 states →</a>
      </div>
    </div>
  </section>

  <section class="py-16 text-center" style="background:linear-gradient(135deg,#0c4a6e,#1e3a5f)">
    <div class="max-w-3xl mx-auto px-4">
      <h2 class="text-3xl font-black mb-4">Ready to Measure Faster in ${state.name}?</h2>
      <p class="text-blue-200 mb-8">Join ${state.name} roofing contractors who use Roof Manager to win more jobs and document claims faster.</p>
      <a href="/customer/login" class="inline-block px-10 py-4 bg-white text-blue-700 font-black rounded-xl text-lg shadow-xl hover:bg-blue-50">Start Free — 3 Reports on Us</a>
    </div>
  </section>

  ${footerHTML()}
</body>
</html>`
  return c.html(html)
})

// /us/:state/:city — US city page scoped by state
app.get('/:state/:city', (c) => {
  const stateSlug = c.req.param('state').toLowerCase()
  const citySlug = c.req.param('city').toLowerCase()
  const state = US_STATES[stateSlug]
  if (!state) return c.redirect('/us')

  const cityData = US_CITIES.find(city => city.slug === citySlug && city.stateSlug === stateSlug)
  if (!cityData) return c.redirect(`/us/${stateSlug}`)

  const siblingCities = US_CITIES
    .filter(c2 => c2.stateSlug === stateSlug && c2.slug !== citySlug)
    .slice(0, 6)
    .map(c2 => `<a href="/us/${stateSlug}/${c2.slug}" class="text-xs text-sky-400 hover:text-sky-300 bg-sky-400/10 border border-sky-400/20 rounded-full px-3 py-1">${c2.name}</a>`)
    .join('')

  const faqSchema = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      { "@type": "Question", "name": `Does Roof Manager work in ${cityData.name}, ${state.name}?`, "acceptedAnswer": { "@type": "Answer", "text": `Yes. Roof Manager generates satellite roof measurement reports for roofing contractors in ${cityData.name}, ${state.name}. Reports cost $8 USD after 3 free reports. Google Solar API coverage is excellent for ${cityData.name} addresses.` } },
      { "@type": "Question", "name": `What roofing insurance carriers operate in ${cityData.name}?`, "acceptedAnswer": { "@type": "Answer", "text": `${cityData.insuranceNote} Roof Manager reports are accepted as supporting documentation by all major ${state.name} carriers.` } },
      { "@type": "Question", "name": `What is the storm risk for roofing contractors in ${cityData.name}?`, "acceptedAnswer": { "@type": "Answer", "text": cityData.stormNarrative } },
      { "@type": "Question", "name": `How much does a roof measurement report cost in ${cityData.name}?`, "acceptedAnswer": { "@type": "Answer", "text": `Roof measurement reports for ${cityData.name}, ${state.name} properties cost $8 USD per report after your 3 free trial reports. Volume discounts are available — 25-packs at $7/report and 100-packs at $5.95/report. All prices in USD.` } },
      { "@type": "Question", "name": `Does Roof Manager work for insurance claims in ${cityData.name}?`, "acceptedAnswer": { "@type": "Answer", "text": `Yes. Roof Manager reports include pitch-corrected area calculations, edge breakdowns, and material estimates that are accepted by insurance adjusters in ${cityData.name} for storm, hail, and weather damage documentation. ${cityData.insuranceNote}` } },
    ]
  })

  const html = `<!DOCTYPE html>
<html lang="en-US">
<head>
  ${getHeadTagsMinimal()}
  <title>Roof Measurement Software for ${cityData.name}, ${state.name} Contractors | Roof Manager</title>
  <meta name="description" content="AI-powered satellite roof measurement reports for roofing contractors in ${cityData.name}, ${state.name}. $8 USD/report after 3 free. ${state.stormProfile.primaryPeril}. Insurance-ready documentation.">
  <meta property="og:locale" content="en_US">
  <meta property="og:title" content="Roof Measurement Software for ${cityData.name}, ${state.code} | Roof Manager">
  <meta property="og:type" content="website">
  <meta name="geo.region" content="US-${state.code}">
  <meta name="geo.placename" content="${cityData.name}, ${state.name}, United States">
  <meta name="geo.position" content="${cityData.lat};${cityData.lng}">
  <link rel="canonical" href="https://www.roofmanager.ca/us/${stateSlug}/${citySlug}">
  <link rel="alternate" hreflang="en-US" href="https://www.roofmanager.ca/us/${stateSlug}/${citySlug}">
  <link rel="alternate" hreflang="en" href="https://www.roofmanager.ca/">
  <link rel="alternate" hreflang="x-default" href="https://www.roofmanager.ca/">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"LocalBusiness","name":"Roof Manager — ${cityData.name}","description":"Satellite roof measurement reports and CRM for roofing contractors in ${cityData.name}, ${state.name}.","url":"https://www.roofmanager.ca/us/${stateSlug}/${citySlug}","image":"https://www.roofmanager.ca/static/logo.png","address":{"@type":"PostalAddress","addressLocality":"${cityData.name}","addressRegion":"${state.code}","addressCountry":"US"},"geo":{"@type":"GeoCoordinates","latitude":"${cityData.lat}","longitude":"${cityData.lng}"},"areaServed":[{"@type":"City","name":"${cityData.name}"},{"@type":"GeoCircle","geoMidpoint":{"@type":"GeoCoordinates","latitude":"${cityData.lat}","longitude":"${cityData.lng}"},"geoRadius":"80000"}],"priceRange":"$5-$500"}
  </script>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://www.roofmanager.ca/"},{"@type":"ListItem","position":2,"name":"United States","item":"https://www.roofmanager.ca/us"},{"@type":"ListItem","position":3,"name":"${state.name}","item":"https://www.roofmanager.ca/us/${stateSlug}"},{"@type":"ListItem","position":4,"name":"${cityData.name}","item":"https://www.roofmanager.ca/us/${stateSlug}/${citySlug}"}]}
  </script>
  <script type="application/ld+json">${faqSchema}</script>
</head>
<body class="min-h-screen" style="background:#0A0A0A;color:#fff">
  ${navHTML()}

  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f,#0c4a6e)">
    <div class="max-w-4xl mx-auto px-4">
      <span class="inline-block px-4 py-1.5 bg-sky-500/20 border border-sky-400/30 rounded-full text-sm text-sky-300 mb-6"><i class="fas fa-map-marker-alt mr-2"></i>${cityData.name}, ${state.name}</span>
      <h1 class="text-4xl md:text-5xl font-black mb-6">Roof Measurement Software for<br><span class="text-sky-400">${cityData.name}, ${state.code}</span> Contractors</h1>
      <p class="text-xl text-blue-200 mb-4">${cityData.stormNarrative}</p>
      <p class="text-blue-300 mb-8">Reports cost <strong>$8 USD</strong> after 3 free reports. Insurance-ready documentation in under 60 seconds.</p>
      <div class="flex flex-col sm:flex-row gap-4 justify-center">
        <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg">Get 3 Free Reports <i class="fas fa-arrow-right ml-2"></i></a>
        <a href="/pricing" class="px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl text-lg border border-white/20">View Pricing (USD)</a>
      </div>
    </div>
  </section>

  <!-- Features -->
  <section class="py-16" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-10">What ${cityData.name} Roofers Get With Every Report</h2>
      <div class="grid md:grid-cols-3 gap-6">
        <div class="bg-white/5 border border-white/10 rounded-xl p-6 text-center"><div class="w-12 h-12 bg-sky-500/20 rounded-xl flex items-center justify-center mx-auto mb-3"><i class="fas fa-ruler-combined text-sky-400"></i></div><h3 class="font-bold text-white mb-2">Precise Measurements</h3><p class="text-gray-400 text-sm">Total roof area (footprint + sloped), pitch analysis per facet, and area multiplier from satellite imagery.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6 text-center"><div class="w-12 h-12 bg-sky-500/20 rounded-xl flex items-center justify-center mx-auto mb-3"><i class="fas fa-draw-polygon text-sky-400"></i></div><h3 class="font-bold text-white mb-2">Edge Breakdowns</h3><p class="text-gray-400 text-sm">Ridge, hip, valley, eave, and rake lengths — everything needed for accurate material takeoff and insurance claims.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6 text-center"><div class="w-12 h-12 bg-sky-500/20 rounded-xl flex items-center justify-center mx-auto mb-3"><i class="fas fa-file-invoice-dollar text-sky-400"></i></div><h3 class="font-bold text-white mb-2">Insurance-Ready PDF</h3><p class="text-gray-400 text-sm">Professional PDF accepted by adjusters. Pitch-corrected area matches Xactimate line items for ${cityData.name} claims.</p></div>
      </div>
    </div>
  </section>

  <!-- Insurance note -->
  <section class="py-16" style="background:#0d0d0d">
    <div class="max-w-4xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-6">Insurance Claims in ${cityData.name}, ${state.code}</h2>
      <div class="bg-white/5 border border-white/10 rounded-xl p-6">
        <p class="text-gray-300 leading-relaxed">${cityData.insuranceNote}</p>
        <p class="text-gray-400 text-sm mt-3">Roof Manager reports include all measurements required for ${state.name} insurance claim documentation. Generate a report in under 60 seconds and submit the PDF directly to the adjuster.</p>
      </div>
    </div>
  </section>

  <!-- FAQ -->
  <section class="py-16" style="background:#111">
    <div class="max-w-4xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-8">FAQ — ${cityData.name} Roofing</h2>
      <div class="space-y-4">
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2">Does Roof Manager work in ${cityData.name}?</h3><p class="text-gray-400 text-sm">Yes. Reports cost $8 USD after 3 free. Google Solar API coverage is excellent for ${cityData.name} addresses. Insurance-ready PDF in under 60 seconds.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2">What roofing insurance carriers operate in ${cityData.name}?</h3><p class="text-gray-400 text-sm">${cityData.insuranceNote}</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2">How much does a roof measurement report cost in ${cityData.name}?</h3><p class="text-gray-400 text-sm">$8 USD per report after your 3 free trial reports. Volume packs: 25 for $175 ($7/report) and 100 for $595 ($5.95/report). All prices in USD.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2">Does Roof Manager work for insurance claims in ${cityData.name}?</h3><p class="text-gray-400 text-sm">Yes. Roof Manager reports include pitch-corrected area, edge breakdowns, and material BOMs accepted by ${state.name} insurance adjusters for storm and weather damage documentation.</p></div>
      </div>
    </div>
  </section>

  ${siblingCities ? `
  <section class="py-8" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <p class="text-gray-500 text-xs font-semibold uppercase tracking-wide mb-3">Other Cities in ${state.name}</p>
      <div class="flex flex-wrap gap-2">${siblingCities}
        <a href="/us/${stateSlug}" class="text-xs text-sky-400 bg-sky-400/10 border border-sky-400/20 rounded-full px-3 py-1 font-semibold">All ${state.name} cities →</a>
      </div>
    </div>
  </section>` : ''}

  <section class="py-16 text-center" style="background:linear-gradient(135deg,#0c4a6e,#1e3a5f)">
    <div class="max-w-3xl mx-auto px-4">
      <h2 class="text-3xl font-black mb-4">Ready to Measure Faster in ${cityData.name}?</h2>
      <p class="text-blue-200 mb-8">Join ${cityData.name} roofing contractors using Roof Manager to document claims and win more bids.</p>
      <a href="/customer/login" class="inline-block px-10 py-4 bg-white text-blue-700 font-black rounded-xl text-lg">Start Free — 3 Reports on Us</a>
    </div>
  </section>

  ${footerHTML()}
</body>
</html>`
  return c.html(html)
})

export default app

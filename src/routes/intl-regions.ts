// International SEO/GEO expansion — UK + AU.
// Parallels src/routes/us-states.ts and src/routes/ca-provinces.ts. Mounted
// at /uk and /au from src/index.tsx. Each mount exposes a hub page +
// a /:region detail page.

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { UK_REGIONS, ALL_UK_REGION_SLUGS } from '../data/uk-regions'
import { AU_REGIONS, ALL_AU_REGION_SLUGS } from '../data/au-regions'
import { inlineQuoteFormHTML } from '../lib/lead-forms'

function head(title: string, desc: string, canonical: string, locale: string) {
  return `<meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#00FF88">
  <link rel="stylesheet" href="/static/tailwind.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" media="print" onload="this.media='all'">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>* { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }</style>
  <link rel="icon" href="/static/logo.png" type="image/png">
  <title>${title}</title>
  <meta name="description" content="${desc}">
  <meta property="og:locale" content="${locale}">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" hreflang="${locale.replace('_', '-')}" href="${canonical}">
  <link rel="alternate" hreflang="en" href="https://www.roofmanager.ca/">
  <link rel="alternate" hreflang="x-default" href="https://www.roofmanager.ca/">`
}

function nav(activeHref: string) {
  return `<nav style="background:#0A0A0A;border-bottom:1px solid rgba(255,255,255,0.08)" class="text-white sticky top-0 z-50">
  <div class="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
    <a href="/" class="flex items-center gap-3"><img src="/static/logo.png" alt="Roof Manager" class="w-9 h-9 rounded-lg object-cover" width="36" height="36" loading="eager"><span class="text-white font-bold text-lg">Roof Manager</span></a>
    <div class="flex items-center gap-4">
      <a href="/pricing" class="text-gray-400 hover:text-white text-sm hidden md:block">Pricing</a>
      <a href="${activeHref}" class="text-[#00FF88] text-sm font-semibold hidden md:block border-b-2 border-[#00FF88] pb-0.5">${activeHref.replace('/', '').toUpperCase()}</a>
      <a href="/register" class="bg-[#00FF88] hover:bg-[#00e67a] text-[#0A0A0A] font-bold py-2 px-5 rounded-xl text-sm">Get Started Free</a>
    </div>
  </div>
</nav>`
}

function footer(hubLabel: string) {
  return `<footer style="background:#0A0A0A;border-top:1px solid rgba(255,255,255,0.06)" class="text-gray-500 py-10 text-center text-sm">
  <div class="max-w-4xl mx-auto px-4">
    <p class="text-gray-300 font-semibold mb-2">Roof Manager &mdash; Serving the ${hubLabel}, US + Canada</p>
    <p>&copy; ${new Date().getFullYear()} Roof Manager. Satellite roof measurement reports for contractors worldwide.</p>
    <div class="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
      <a href="/" class="hover:text-white">Home</a>
      <a href="/pricing" class="hover:text-white">Pricing</a>
      <a href="/blog" class="hover:text-white">Blog</a>
      <a href="/about" class="hover:text-white">About</a>
      <a href="/us" class="hover:text-white">United States</a>
      <a href="/ca" class="hover:text-white">Canada</a>
      <a href="/uk" class="hover:text-white">United Kingdom</a>
      <a href="/au" class="hover:text-white">Australia</a>
    </div>
  </div>
</footer>`
}

// -------- UK --------

export const ukApp = new Hono<{ Bindings: Bindings }>()

ukApp.get('/', (c) => {
  const base = 'https://www.roofmanager.ca'
  const links = ALL_UK_REGION_SLUGS.map(slug => {
    const r = UK_REGIONS[slug]
    return `<a href="/uk/${slug}" class="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-4 py-3 transition-all group">
      <span class="text-[#00FF88] font-bold text-sm w-9">${r.code}</span>
      <span class="text-white text-sm font-medium group-hover:text-[#00FF88]">${r.name}</span>
    </a>`
  }).join('')
  return c.html(`<!DOCTYPE html>
<html lang="en-GB">
<head>
  ${head('Roof Measurement Software for UK Roofing Contractors | Roof Manager', 'Satellite roof measurement reports for roofing contractors across England, Scotland, Wales, and Northern Ireland. First 4 reports free, then flat per-report pricing. Hosted in Canada; GBP billing available.', `${base}/uk`, 'en_GB')}
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"WebPage","name":"Roof Manager — UK Roofing Contractors","url":"${base}/uk","inLanguage":"en-GB","description":"Satellite roof measurement reports for UK roofing contractors across all four home nations."}
  </script>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"${base}/"},{"@type":"ListItem","position":2,"name":"United Kingdom","item":"${base}/uk"}]}
  </script>
</head>
<body class="min-h-screen" style="background:#0A0A0A;color:#fff">
  ${nav('/uk')}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0A0A0A,#1e293b,#0c4a6e)">
    <div class="max-w-4xl mx-auto px-4">
      <span class="inline-block px-4 py-1.5 bg-[#00FF88]/20 border border-[#00FF88]/30 rounded-full text-sm text-[#00FF88] mb-6">&#127468;&#127463; All four home nations covered</span>
      <h1 class="text-4xl md:text-5xl font-black mb-6">Roof Measurement Software<br>for UK Roofing Contractors</h1>
      <p class="text-xl text-gray-300 mb-4">Satellite-powered roof reports tuned to BS 5534 slating &amp; tiling conventions, Approved Document L 2022, and the Scottish Technical Handbook. Projected and sloped area, tile-gauge take-off, eave-to-ridge fixings, and storm-loss documentation.</p>
      <p class="text-gray-400 mb-8">First 4 reports free. Pay-as-you-go pricing after. Insurance-ready output accepted by Aviva, Direct Line, Admiral, LV=, and all major UK carriers.</p>
      <div class="flex flex-col sm:flex-row gap-4 justify-center mt-8">
        <a href="/register" class="px-8 py-4 bg-[#00FF88] hover:bg-[#00e67a] text-[#0A0A0A] font-bold rounded-xl text-lg">Get 4 Free Reports <i class="fas fa-arrow-right ml-2"></i></a>
        <a href="/pricing" class="px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl text-lg border border-white/20">View Pricing</a>
      </div>
    </div>
  </section>

  <section class="py-16" style="background:#111">
    <div class="max-w-6xl mx-auto px-4">
      <h2 class="text-3xl font-black text-center mb-4">Browse by home nation</h2>
      <p class="text-center text-gray-400 mb-10">Select your region for local climate, building-reg references, and carrier details.</p>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">${links}</div>
    </div>
  </section>

  <div class="max-w-5xl mx-auto px-4 py-8">${inlineQuoteFormHTML('uk-hub')}</div>

  <section class="py-16" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-10">Why UK contractors choose Roof Manager</h2>
      <div class="grid md:grid-cols-3 gap-6">
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2"><i class="fas fa-ruler-combined text-[#00FF88] mr-2"></i>BS 5534-aware outputs</h3><p class="text-gray-400 text-sm">Tile-gauge and lap-specific quantities. Pitched-tile take-off slots straight into a UK slater&rsquo;s schedule.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2"><i class="fas fa-cloud-bolt text-[#00FF88] mr-2"></i>Storm-loss documentation</h3><p class="text-gray-400 text-sm">Reports include pre-storm imagery, projected vs. sloped area, and fixings schedules for insurer supplement claims.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2"><i class="fas fa-bolt text-[#00FF88] mr-2"></i>Measure from anywhere</h3><p class="text-gray-400 text-sm">Measure from desk or van. No climbing, no cherry-picker. Google Solar API imagery covers England, Scotland, Wales, and NI.</p></div>
      </div>
    </div>
  </section>

  ${footer('United Kingdom')}
</body>
</html>`)
})

ukApp.get('/:region', (c) => {
  const slug = c.req.param('region').toLowerCase()
  const r = UK_REGIONS[slug]
  if (!r) return c.redirect('/uk')
  const base = 'https://www.roofmanager.ca'
  const siblings = ALL_UK_REGION_SLUGS.filter(s => s !== slug)
    .map(s => `<a href="/uk/${s}" class="text-xs text-[#00FF88] hover:text-[#00e67a] bg-[#00FF88]/10 border border-[#00FF88]/20 rounded-full px-3 py-1">${UK_REGIONS[s].name}</a>`)
    .join('')
  const metros = r.metros.map(m => `<div class="bg-white/5 border border-white/10 rounded-xl p-4"><div class="font-bold text-white text-sm">${m}</div><div class="text-gray-500 text-xs mt-1">${r.name}</div></div>`).join('')
  const carriers = r.topInsurers.map(i => `<span class="bg-[#00FF88]/10 border border-[#00FF88]/20 rounded-full px-3 py-1 text-[#00FF88] text-xs">${i}</span>`).join('')
  const faqSchema = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: [
      { '@type': 'Question', name: `Does Roof Manager work in ${r.name}?`, acceptedAnswer: { '@type': 'Answer', text: `Yes. Roof Manager generates satellite-powered roof measurement reports for roofing contractors across ${r.name}. Google Solar API coverage is broadly available for the vast majority of ${r.name} urban and suburban addresses. Reports are sold on a per-report basis with 4 free reports for new accounts.` } },
      { '@type': 'Question', name: `What is the primary roofing peril in ${r.name}?`, acceptedAnswer: { '@type': 'Answer', text: `${r.weatherProfile.primaryPeril}. ${r.roofingNotes}` } },
      { '@type': 'Question', name: `Which building regulations apply in ${r.name}?`, acceptedAnswer: { '@type': 'Answer', text: `${r.name} operates under ${r.buildingCode.adopted}. ${r.buildingCode.notes}` } },
      { '@type': 'Question', name: `Which insurers accept Roof Manager reports in ${r.name}?`, acceptedAnswer: { '@type': 'Answer', text: `Major UK carriers active in ${r.name} &mdash; ${r.topInsurers.join(', ')} &mdash; accept Roof Manager reports as supporting documentation for storm and other weather-event roof claims.` } },
    ],
  })
  return c.html(`<!DOCTYPE html>
<html lang="en-GB">
<head>
  ${head(`Satellite Roof Measurement Software for ${r.name} Roofing Contractors | Roof Manager`, `AI-powered satellite roof measurement reports for ${r.name} roofing contractors. ${r.weatherProfile.primaryPeril}. First 4 reports free — no credit card.`, `${base}/uk/${slug}`, 'en_GB')}
  <meta name="geo.region" content="GB-${r.code}">
  <meta name="geo.placename" content="${r.name}, United Kingdom">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"LocalBusiness","name":"Roof Manager — ${r.name}","url":"${base}/uk/${slug}","image":"${base}/static/logo.png","address":{"@type":"PostalAddress","addressRegion":"${r.code}","addressCountry":"GB"},"areaServed":{"@type":"AdministrativeArea","name":"${r.name}"},"priceRange":"£5-£400"}
  </script>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"${base}/"},{"@type":"ListItem","position":2,"name":"United Kingdom","item":"${base}/uk"},{"@type":"ListItem","position":3,"name":"${r.name}","item":"${base}/uk/${slug}"}]}
  </script>
  <script type="application/ld+json">${faqSchema}</script>
</head>
<body class="min-h-screen" style="background:#0A0A0A;color:#fff">
  ${nav('/uk')}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0A0A0A,#1e293b,#0c4a6e)">
    <div class="max-w-4xl mx-auto px-4">
      <span class="inline-block px-4 py-1.5 bg-[#00FF88]/20 border border-[#00FF88]/30 rounded-full text-sm text-[#00FF88] mb-6"><i class="fas fa-map-marker-alt mr-2"></i>${r.name}</span>
      <h1 class="text-4xl md:text-5xl font-black mb-6">Satellite Roof Measurement Software<br>for <span class="text-[#00FF88]">${r.name}</span> Contractors</h1>
      <p class="text-xl text-gray-300 mb-4">${r.roofingNotes}</p>
      <p class="text-gray-400 mb-8">First 4 reports free, then flat per-report pricing. Insurance-ready documentation for ${r.weatherProfile.primaryPeril.toLowerCase()}.</p>
      <div class="flex flex-col sm:flex-row gap-4 justify-center">
        <a href="/register" class="px-8 py-4 bg-[#00FF88] hover:bg-[#00e67a] text-[#0A0A0A] font-bold rounded-xl text-lg">Get 4 Free Reports <i class="fas fa-arrow-right ml-2"></i></a>
        <a href="/pricing" class="px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl text-lg border border-white/20">View Pricing</a>
      </div>
    </div>
  </section>

  <section class="py-16" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-10">${r.name} Weather &amp; Roofing Profile</h2>
      <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div class="bg-white/5 border border-white/10 rounded-xl p-5"><div class="text-[#00FF88] font-bold text-lg mb-1">${r.weatherProfile.rainDaysPerYear}</div><div class="text-white font-semibold text-sm">Rain days / year</div></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-5"><div class="text-[#00FF88] font-bold text-lg mb-1 capitalize">${r.weatherProfile.stormRisk}</div><div class="text-white font-semibold text-sm">Storm risk</div></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-5"><div class="text-[#00FF88] font-bold text-lg mb-1 capitalize">${r.weatherProfile.flooding}</div><div class="text-white font-semibold text-sm">Flood risk</div></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-5 md:col-span-2 lg:col-span-3"><div class="text-white font-semibold text-sm mb-2">Primary peril</div><div class="text-[#00FF88]">${r.weatherProfile.primaryPeril}</div></div>
      </div>
    </div>
  </section>

  <div class="max-w-5xl mx-auto px-4 py-8">${inlineQuoteFormHTML('uk-' + slug)}</div>

  <section class="py-16" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-8">${r.name} Building Regulations</h2>
      <div class="bg-white/5 border border-white/10 rounded-xl p-6 max-w-2xl mx-auto">
        <div class="text-[#00FF88] font-bold mb-2">${r.buildingCode.adopted}</div>
        <p class="text-gray-300 text-sm">${r.buildingCode.notes}</p>
      </div>
    </div>
  </section>

  <section class="py-16" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-4">${r.name} major cities</h2>
      <p class="text-center text-gray-400 mb-8">Capital: ${r.capital} &middot; Population: ${r.population.toLocaleString()}</p>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">${metros}</div>
    </div>
  </section>

  <section class="py-16" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-8">Top carriers &mdash; ${r.name}</h2>
      <div class="bg-white/5 border border-white/10 rounded-xl p-6 max-w-3xl mx-auto">
        <p class="text-gray-300 mb-3 text-sm leading-relaxed">Roof Manager reports are accepted as supporting documentation by the major UK carriers active in ${r.name}:</p>
        <div class="flex flex-wrap gap-2">${carriers}</div>
      </div>
    </div>
  </section>

  <section class="py-10" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <p class="text-gray-500 text-xs font-semibold uppercase tracking-wide mb-3">Also serving</p>
      <div class="flex flex-wrap gap-2">${siblings}
        <a href="/uk" class="text-xs text-[#00FF88] bg-[#00FF88]/10 border border-[#00FF88]/20 rounded-full px-3 py-1 font-semibold">View all UK regions &rarr;</a>
      </div>
    </div>
  </section>

  ${footer('United Kingdom')}
</body>
</html>`)
})

// -------- AU --------

export const auApp = new Hono<{ Bindings: Bindings }>()

auApp.get('/', (c) => {
  const base = 'https://www.roofmanager.ca'
  const links = ALL_AU_REGION_SLUGS.map(slug => {
    const r = AU_REGIONS[slug]
    return `<a href="/au/${slug}" class="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-4 py-3 transition-all group">
      <span class="text-[#00FF88] font-bold text-sm w-10">${r.code}</span>
      <span class="text-white text-sm font-medium group-hover:text-[#00FF88]">${r.name}</span>
    </a>`
  }).join('')
  return c.html(`<!DOCTYPE html>
<html lang="en-AU">
<head>
  ${head('Roof Measurement Software for Australian Roofing Contractors | Roof Manager', 'Satellite-powered roof measurement reports for Australian roofing contractors across all states and territories. NCC 2022 compliant outputs, cyclone-region-aware take-off, hailstorm claim documentation.', `${base}/au`, 'en_AU')}
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"WebPage","name":"Roof Manager — Australian Roofing Contractors","url":"${base}/au","inLanguage":"en-AU","description":"Satellite roof measurement reports for Australian roofing contractors across all states and territories."}
  </script>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"${base}/"},{"@type":"ListItem","position":2,"name":"Australia","item":"${base}/au"}]}
  </script>
</head>
<body class="min-h-screen" style="background:#0A0A0A;color:#fff">
  ${nav('/au')}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0A0A0A,#1e293b,#14532d)">
    <div class="max-w-4xl mx-auto px-4">
      <span class="inline-block px-4 py-1.5 bg-[#00FF88]/20 border border-[#00FF88]/30 rounded-full text-sm text-[#00FF88] mb-6">&#127462;&#127482; All states + territories covered</span>
      <h1 class="text-4xl md:text-5xl font-black mb-6">Roof Measurement Software<br>for Australian Roofing Contractors</h1>
      <p class="text-xl text-gray-300 mb-4">Satellite-powered roof reports compliant with NCC 2022 Volume Two, AS/NZS 1170.2 wind regions, and BAL-rated bushfire zones. Hail damage, cyclone-region fixings, and ember-attack replacement take-off all covered.</p>
      <p class="text-gray-400 mb-8">First 4 reports free. Pay-as-you-go pricing. Insurance-ready for Suncorp AAMI, NRMA, Allianz, QBE, and every major Australian carrier.</p>
      <div class="flex flex-col sm:flex-row gap-4 justify-center mt-8">
        <a href="/register" class="px-8 py-4 bg-[#00FF88] hover:bg-[#00e67a] text-[#0A0A0A] font-bold rounded-xl text-lg">Get 4 Free Reports <i class="fas fa-arrow-right ml-2"></i></a>
        <a href="/pricing" class="px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl text-lg border border-white/20">View Pricing</a>
      </div>
    </div>
  </section>

  <section class="py-16" style="background:#111">
    <div class="max-w-6xl mx-auto px-4">
      <h2 class="text-3xl font-black text-center mb-4">Browse by state or territory</h2>
      <p class="text-center text-gray-400 mb-10">Select your region for local climate data, NCC references, and carrier details.</p>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">${links}</div>
    </div>
  </section>

  <div class="max-w-5xl mx-auto px-4 py-8">${inlineQuoteFormHTML('au-hub')}</div>

  <section class="py-16" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-10">Why Australian contractors choose Roof Manager</h2>
      <div class="grid md:grid-cols-3 gap-6">
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2"><i class="fas fa-wind text-[#00FF88] mr-2"></i>Cyclone-region aware</h3><p class="text-gray-400 text-sm">Reports flag wind regions C and D (North QLD, Pilbara, Kimberley) so remote-site measurement stays anchored to AS/NZS 1170.2.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2"><i class="fas fa-fire text-[#00FF88] mr-2"></i>BAL + bushfire ready</h3><p class="text-gray-400 text-sm">Ember-attack roof replacements in BAL-29/40/FZ zones need documented vent and gutter compliance. Our reports attach cleanly to the builder&rsquo;s DA/CDC.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2"><i class="fas fa-bolt text-[#00FF88] mr-2"></i>Measure from anywhere</h3><p class="text-gray-400 text-sm">Measure from Sydney, Melbourne, or a Pilbara mine site. Google Solar API imagery coverage spans every populated zone in Australia.</p></div>
      </div>
    </div>
  </section>

  ${footer('Australia')}
</body>
</html>`)
})

auApp.get('/:region', (c) => {
  const slug = c.req.param('region').toLowerCase()
  const r = AU_REGIONS[slug]
  if (!r) return c.redirect('/au')
  const base = 'https://www.roofmanager.ca'
  const siblings = ALL_AU_REGION_SLUGS.filter(s => s !== slug)
    .map(s => `<a href="/au/${s}" class="text-xs text-[#00FF88] hover:text-[#00e67a] bg-[#00FF88]/10 border border-[#00FF88]/20 rounded-full px-3 py-1">${AU_REGIONS[s].name}</a>`)
    .join('')
  const metros = r.metros.map(m => `<div class="bg-white/5 border border-white/10 rounded-xl p-4"><div class="font-bold text-white text-sm">${m}</div><div class="text-gray-500 text-xs mt-1">${r.name}</div></div>`).join('')
  const carriers = r.topInsurers.map(i => `<span class="bg-[#00FF88]/10 border border-[#00FF88]/20 rounded-full px-3 py-1 text-[#00FF88] text-xs">${i}</span>`).join('')
  const faqSchema = JSON.stringify({
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: [
      { '@type': 'Question', name: `Does Roof Manager work in ${r.name}?`, acceptedAnswer: { '@type': 'Answer', text: `Yes. Roof Manager generates satellite-powered roof measurement reports for roofing contractors across ${r.name}, including Darwin and the Top End cyclone regions where applicable. Google Solar API imagery is available for the overwhelming majority of ${r.name} addresses.` } },
      { '@type': 'Question', name: `What is the primary roofing peril in ${r.name}?`, acceptedAnswer: { '@type': 'Answer', text: `${r.weatherProfile.primaryPeril}. ${r.roofingNotes}` } },
      { '@type': 'Question', name: `What does NCC 2022 require for re-roofing in ${r.name}?`, acceptedAnswer: { '@type': 'Answer', text: `${r.buildingCode.adopted} applies. Wind region: ${r.buildingCode.windRegion}. ${r.buildingCode.notes}` } },
      { '@type': 'Question', name: `Which insurers accept Roof Manager reports in ${r.name}?`, acceptedAnswer: { '@type': 'Answer', text: `Major Australian carriers serving ${r.name} — ${r.topInsurers.join(', ')} — accept Roof Manager reports as supporting documentation for hail, storm, cyclone, and bushfire roof claims.` } },
    ],
  })
  return c.html(`<!DOCTYPE html>
<html lang="en-AU">
<head>
  ${head(`Satellite Roof Measurement Software for ${r.name} Roofing Contractors | Roof Manager`, `Satellite roof measurement reports for ${r.name} roofing contractors. ${r.weatherProfile.primaryPeril}. Wind region ${r.buildingCode.windRegion}. First 4 reports free — no card.`, `${base}/au/${slug}`, 'en_AU')}
  <meta name="geo.region" content="AU-${r.code}">
  <meta name="geo.placename" content="${r.name}, Australia">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"LocalBusiness","name":"Roof Manager — ${r.name}","url":"${base}/au/${slug}","image":"${base}/static/logo.png","address":{"@type":"PostalAddress","addressRegion":"${r.code}","addressCountry":"AU"},"areaServed":{"@type":"AdministrativeArea","name":"${r.name}"},"priceRange":"A$5-A$500"}
  </script>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"${base}/"},{"@type":"ListItem","position":2,"name":"Australia","item":"${base}/au"},{"@type":"ListItem","position":3,"name":"${r.name}","item":"${base}/au/${slug}"}]}
  </script>
  <script type="application/ld+json">${faqSchema}</script>
</head>
<body class="min-h-screen" style="background:#0A0A0A;color:#fff">
  ${nav('/au')}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0A0A0A,#1e293b,#14532d)">
    <div class="max-w-4xl mx-auto px-4">
      <span class="inline-block px-4 py-1.5 bg-[#00FF88]/20 border border-[#00FF88]/30 rounded-full text-sm text-[#00FF88] mb-6"><i class="fas fa-map-marker-alt mr-2"></i>${r.name}, ${r.code}</span>
      <h1 class="text-4xl md:text-5xl font-black mb-6">Satellite Roof Measurement Software<br>for <span class="text-[#00FF88]">${r.name}</span> Contractors</h1>
      <p class="text-xl text-gray-300 mb-4">${r.roofingNotes}</p>
      <p class="text-gray-400 mb-8">NCC 2022 compliant outputs. Wind region <strong>${r.buildingCode.windRegion}</strong>. First 4 reports free, then flat per-report pricing.</p>
      <div class="flex flex-col sm:flex-row gap-4 justify-center">
        <a href="/register" class="px-8 py-4 bg-[#00FF88] hover:bg-[#00e67a] text-[#0A0A0A] font-bold rounded-xl text-lg">Get 4 Free Reports <i class="fas fa-arrow-right ml-2"></i></a>
        <a href="/pricing" class="px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl text-lg border border-white/20">View Pricing</a>
      </div>
    </div>
  </section>

  <section class="py-16" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-10">${r.name} weather &amp; roofing profile</h2>
      <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div class="bg-white/5 border border-white/10 rounded-xl p-5"><div class="text-[#00FF88] font-bold text-lg mb-1">${r.weatherProfile.hailDaysPerYear}</div><div class="text-white font-semibold text-sm">Hail days / year</div></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-5"><div class="text-[#00FF88] font-bold text-lg mb-1 capitalize">${r.weatherProfile.cycloneRisk}</div><div class="text-white font-semibold text-sm">Cyclone risk</div></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-5"><div class="text-[#00FF88] font-bold text-lg mb-1 capitalize">${r.weatherProfile.bushfireRisk}</div><div class="text-white font-semibold text-sm">Bushfire risk</div></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-5 md:col-span-2 lg:col-span-3"><div class="text-white font-semibold text-sm mb-2">Primary peril</div><div class="text-[#00FF88]">${r.weatherProfile.primaryPeril}</div></div>
      </div>
    </div>
  </section>

  <div class="max-w-5xl mx-auto px-4 py-8">${inlineQuoteFormHTML('au-' + slug)}</div>

  <section class="py-16" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-8">NCC 2022 + ${r.name} amendments</h2>
      <div class="bg-white/5 border border-white/10 rounded-xl p-6 max-w-2xl mx-auto">
        <div class="text-[#00FF88] font-bold mb-2">${r.buildingCode.adopted}</div>
        <p class="text-gray-400 text-sm mb-2"><strong>Wind region:</strong> ${r.buildingCode.windRegion}</p>
        <p class="text-gray-300 text-sm">${r.buildingCode.notes}</p>
      </div>
    </div>
  </section>

  <section class="py-16" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-4">Major ${r.name} metros</h2>
      <p class="text-center text-gray-400 mb-8">Capital: ${r.capital} &middot; Population: ${r.population.toLocaleString()}</p>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">${metros}</div>
    </div>
  </section>

  <section class="py-16" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-8">Top carriers &mdash; ${r.name}</h2>
      <div class="bg-white/5 border border-white/10 rounded-xl p-6 max-w-3xl mx-auto">
        <p class="text-gray-300 mb-3 text-sm leading-relaxed">Roof Manager reports are accepted as supporting documentation by the major Australian carriers operating in ${r.name}:</p>
        <div class="flex flex-wrap gap-2">${carriers}</div>
      </div>
    </div>
  </section>

  <section class="py-10" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <p class="text-gray-500 text-xs font-semibold uppercase tracking-wide mb-3">Also serving</p>
      <div class="flex flex-wrap gap-2">${siblings}
        <a href="/au" class="text-xs text-[#00FF88] bg-[#00FF88]/10 border border-[#00FF88]/20 rounded-full px-3 py-1 font-semibold">View all Australian regions &rarr;</a>
      </div>
    </div>
  </section>

  ${footer('Australia')}
</body>
</html>`)
})

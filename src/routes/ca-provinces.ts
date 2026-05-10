import { Hono } from 'hono'
import type { Env } from '../types'
import { CA_PROVINCES, ALL_PROVINCE_SLUGS } from '../data/ca-provinces'
import { inlineQuoteFormHTML } from '../lib/lead-forms'

const app = new Hono<{ Bindings: Env }>()

// Mirrors the minimal head-tag pattern used by us-states.ts so CA pages
// render with the same tooling without going through the heavier
// getHeadTags() helper in index.tsx. Keeps this route module standalone.
function getHeadTagsMinimal() {
  return `<meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#00FF88">
  <link rel="stylesheet" href="/static/tailwind.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" media="print" onload="this.media='all'">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>* { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }</style>
  <link rel="icon" href="/static/logo.png?v=20260504" type="image/png">
  <link rel="apple-touch-icon" href="/static/icons/icon-192x192.png?v=20260504">`
}

function navHTML() {
  return `<nav style="background:#0A0A0A;border-bottom:1px solid rgba(255,255,255,0.08)" class="text-white sticky top-0 z-50">
  <div class="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
    <a href="/" class="flex items-center gap-3"><img src="/static/logo.png?v=20260504" alt="Roof Manager" class="w-9 h-9 rounded-lg object-cover"><span class="text-white font-bold text-lg">Roof Manager</span></a>
    <div class="flex items-center gap-4">
      <a href="/pricing" class="text-gray-400 hover:text-white text-sm hidden md:block">Pricing</a>
      <a href="/ca" class="text-gray-400 hover:text-white text-sm hidden md:block">Canada</a>
      <a href="/customer/login" class="bg-[#00FF88] hover:bg-[#00e67a] text-[#0A0A0A] font-bold py-2 px-5 rounded-xl text-sm">Get Started Free</a>
    </div>
  </div>
</nav>`
}

function contactCTAHTML(source: string) {
  return `<section style="background:#0A0A0A" class="py-16 border-t border-white/5">
  <div class="max-w-2xl mx-auto px-4 text-center">
    <span style="display:inline-block;background:rgba(0,255,136,0.1);color:#00FF88;font-size:12px;font-weight:700;padding:6px 16px;border-radius:999px;margin-bottom:16px"><i class="fas fa-envelope" style="margin-right:6px"></i>CONTACT US</span>
    <h2 style="font-size:28px;font-weight:900;color:#fff;margin-bottom:8px">Questions? We're Here to Help</h2>
    <p style="color:#9ca3af;margin-bottom:24px;font-size:15px">Tell us about your roofing business and we'll get you set up in minutes.</p>
    <div style="background:#111;border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:24px;text-align:left">
      <form onsubmit="return (async function(e){e.preventDefault();var b=e.target.querySelector('button');b.disabled=true;b.textContent='Sending...';try{var r=await fetch('/api/agents/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:e.target.n.value,email:e.target.e.value,message:e.target.m.value,source_page:'${source}'})});var d=await r.json();if(d.success){e.target.innerHTML='<p style=\\'color:#00FF88;font-weight:700;text-align:center;padding:20px\\'>✓ Thank you! We\\'ll be in touch shortly.</p>';return}b.disabled=false;b.textContent='Send Message'}catch(x){b.disabled=false;b.textContent='Send Message'}return false})(event)">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <input name="n" required placeholder="Your name" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none">
          <input name="e" type="email" required placeholder="Email address" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none">
        </div>
        <textarea name="m" rows="2" placeholder="How can we help?" style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;resize:none;margin-bottom:12px;box-sizing:border-box"></textarea>
        <button type="submit" style="width:100%;background:#00FF88;color:#0A0A0A;font-weight:800;padding:14px;border:none;border-radius:10px;font-size:15px;cursor:pointer">Send Message</button>
      </form>
      <p style="text-align:center;color:#6b7280;font-size:11px;margin-top:8px"><i class="fas fa-envelope" style="color:#00FF88;margin-right:4px"></i>Email us: <a href="mailto:sales@roofmanager.ca" style="color:#00FF88">sales@roofmanager.ca</a></p>
    </div>
  </div>
</section>`
}

function footerHTML(source: string = 'ca-page') {
  return `${contactCTAHTML(source)}
<footer style="background:#0A0A0A;border-top:1px solid rgba(255,255,255,0.06)" class="text-gray-500 py-10 text-center text-sm">
  <div class="max-w-4xl mx-auto px-4">
    <p class="text-gray-300 font-semibold mb-2">Roof Manager &mdash; Serving All 10 Provinces &amp; 3 Territories</p>
    <p>&copy; ${new Date().getFullYear()} Roof Manager. Satellite roof measurement reports for Canadian contractors.</p>
    <div class="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
      <a href="/" class="hover:text-white">Home</a>
      <a href="/pricing" class="hover:text-white">Pricing</a>
      <a href="/blog" class="hover:text-white">Blog</a>
      <a href="/contact" class="hover:text-white">Contact</a>
      <a href="/about" class="hover:text-white">About</a>
      <a href="/us" class="hover:text-white">United States</a>
      <a href="/privacy" class="hover:text-white">Privacy</a>
      <a href="/terms" class="hover:text-white">Terms</a>
    </div>
  </div>
</footer>`
}

// /ca — Canada hub page
app.get('/', (c) => {
  const provinceLinks = ALL_PROVINCE_SLUGS.map(slug => {
    const p = CA_PROVINCES[slug]
    return `<a href="/ca/${slug}" class="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl px-4 py-3 transition-all group">
      <span class="text-[#00FF88] font-bold text-sm w-8">${p.code}</span>
      <span class="text-white text-sm font-medium group-hover:text-[#00FF88]">${p.name}</span>
    </a>`
  }).join('')

  const html = `<!DOCTYPE html>
<html lang="en-CA">
<head>
  ${getHeadTagsMinimal()}
  <title>Roof Measurement Software for Canadian Roofing Contractors | Roof Manager</title>
  <meta name="description" content="Satellite roof measurement reports for roofing contractors in every Canadian province and territory. $8 CAD/report after 4 free. Works in Alberta, Ontario, BC, Quebec, and everywhere in between.">
  <meta property="og:locale" content="en_CA">
  <meta name="geo.region" content="CA">
  <link rel="canonical" href="https://www.roofmanager.ca/ca">
  <link rel="alternate" hreflang="en-CA" href="https://www.roofmanager.ca/ca">
  <link rel="alternate" hreflang="en-US" href="https://www.roofmanager.ca/us">
  <link rel="alternate" hreflang="en" href="https://www.roofmanager.ca/">
  <link rel="alternate" hreflang="x-default" href="https://www.roofmanager.ca/">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"WebPage","name":"Roof Manager — Canadian Roofing Contractors","description":"Satellite roof measurement reports for roofing contractors in all Canadian provinces and territories.","url":"https://www.roofmanager.ca/ca","inLanguage":"en-CA"}
  </script>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://www.roofmanager.ca/"},{"@type":"ListItem","position":2,"name":"Canada","item":"https://www.roofmanager.ca/ca"}]}
  </script>
</head>
<body class="min-h-screen" style="background:#0A0A0A;color:#fff">
  ${navHTML()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#052e16,#14532d)">
    <div class="max-w-4xl mx-auto px-4">
      <span class="inline-block px-4 py-1.5 bg-[#00FF88]/20 border border-[#00FF88]/30 rounded-full text-sm text-[#00FF88] mb-6">&#127464;&#127462; All 10 Provinces &amp; 3 Territories Covered</span>
      <h1 class="text-4xl md:text-5xl font-black mb-6">Roof Measurement Software<br>for Canadian Roofing Contractors</h1>
      <p class="text-xl text-gray-300 mb-4">Roof Manager generates satellite-powered roof reports for contractors in every Canadian province and territory. Reports cost $8 CAD per report after 4 free reports &mdash; and the platform is hosted in Canada.</p>
      <p class="text-gray-400 mb-8">Insurance-ready documentation accepted by Intact, Aviva, Desjardins, Co-operators, and every major Canadian carrier.</p>
      <div class="flex flex-col sm:flex-row gap-4 justify-center mt-8">
        <a href="/register" class="px-8 py-4 bg-[#00FF88] hover:bg-[#00e67a] text-[#0A0A0A] font-bold rounded-xl text-lg">Get 4 Free Reports <i class="fas fa-arrow-right ml-2"></i></a>
        <a href="/pricing" class="px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl text-lg border border-white/20">View Pricing (CAD)</a>
      </div>
    </div>
  </section>

  <section class="py-16" style="background:#111">
    <div class="max-w-6xl mx-auto px-4">
      <h2 class="text-3xl font-black text-center mb-4">Browse by Province or Territory</h2>
      <p class="text-center text-gray-400 mb-10">Select your region for local hail and storm data, building code references, and top insurance carriers.</p>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        ${provinceLinks}
      </div>
    </div>
  </section>

  <div class="max-w-5xl mx-auto px-4 py-8">${inlineQuoteFormHTML('ca-hub')}</div>

  <section class="py-16" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-10">Why Canadian Contractors Choose Roof Manager</h2>
      <div class="grid md:grid-cols-3 gap-6">
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2"><i class="fas fa-maple-leaf text-[#00FF88] mr-2"></i>Built &amp; hosted in Canada</h3><p class="text-gray-400 text-sm">We&#39;re an Alberta company. Data stays on Canadian infrastructure. CAD pricing, bilingual support, and direct familiarity with provincial building codes.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2"><i class="fas fa-shield-alt text-[#00FF88] mr-2"></i>Insurance-Ready Reports</h3><p class="text-gray-400 text-sm">Reports include pitch-corrected area, edge breakdowns, and material BOMs accepted by every major Canadian carrier for hail, wind, ice, and post-tropical storm claims.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2"><i class="fas fa-bolt text-[#00FF88] mr-2"></i>Nationwide Coverage</h3><p class="text-gray-400 text-sm">Google Solar API coverage is available for the vast majority of Canadian urban and suburban addresses. Measure from your phone, truck, or office.</p></div>
      </div>
    </div>
  </section>

  <section class="py-16" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-8">Popular Regional Markets</h2>
      <div class="grid md:grid-cols-3 gap-4">
        <a href="/ca/alberta" class="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/10 transition-all"><h3 class="font-bold text-white mb-1"><i class="fas fa-cloud-showers-heavy text-[#00FF88] mr-2"></i>Alberta</h3><p class="text-gray-400 text-xs">Canada&#39;s hail capital &mdash; Calgary and Red Deer corridor</p></a>
        <a href="/ca/ontario" class="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/10 transition-all"><h3 class="font-bold text-white mb-1"><i class="fas fa-snowflake text-[#00FF88] mr-2"></i>Ontario</h3><p class="text-gray-400 text-xs">Largest roofing market &mdash; ice storms and freeze-thaw</p></a>
        <a href="/ca/british-columbia" class="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/10 transition-all"><h3 class="font-bold text-white mb-1"><i class="fas fa-cloud-rain text-[#00FF88] mr-2"></i>British Columbia</h3><p class="text-gray-400 text-xs">Atmospheric rivers and wet-weather roofing</p></a>
        <a href="/ca/quebec" class="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/10 transition-all"><h3 class="font-bold text-white mb-1"><i class="fas fa-icicles text-[#00FF88] mr-2"></i>Quebec</h3><p class="text-gray-400 text-xs">Extreme winter &mdash; ice dam mitigation workflows</p></a>
        <a href="/ca/nova-scotia" class="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/10 transition-all"><h3 class="font-bold text-white mb-1"><i class="fas fa-wind text-[#00FF88] mr-2"></i>Nova Scotia</h3><p class="text-gray-400 text-xs">Post-tropical storm wind uplift compliance</p></a>
        <a href="/ca/saskatchewan" class="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/10 transition-all"><h3 class="font-bold text-white mb-1"><i class="fas fa-cloud-bolt text-[#00FF88] mr-2"></i>Saskatchewan</h3><p class="text-gray-400 text-xs">Prairie hail belt &mdash; SGI-mapped claim zones</p></a>
      </div>
    </div>
  </section>

  ${footerHTML()}
</body>
</html>`
  return c.html(html)
})

// /ca/:province — province hub page
app.get('/:province', (c) => {
  const provinceSlug = c.req.param('province').toLowerCase()
  const province = CA_PROVINCES[provinceSlug]
  if (!province) return c.redirect('/ca')

  const metroList = province.metros.map(m =>
    `<div class="bg-white/5 border border-white/10 rounded-xl p-4">
      <div class="font-bold text-white text-sm">${m}</div>
      <div class="text-gray-500 text-xs mt-1">${province.name}</div>
    </div>`
  ).join('')

  const siblingProvinces = ALL_PROVINCE_SLUGS
    .filter(s => s !== provinceSlug)
    .slice(0, 10)
    .map(s => `<a href="/ca/${s}" class="text-xs text-[#00FF88] hover:text-[#00e67a] bg-[#00FF88]/10 border border-[#00FF88]/20 rounded-full px-3 py-1">${CA_PROVINCES[s].name}</a>`)
    .join('')

  const faqSchema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      { '@type': 'Question', name: `Does Roof Manager work in ${province.name}?`, acceptedAnswer: { '@type': 'Answer', text: `Yes. Roof Manager generates satellite-powered roof measurement reports for roofing contractors across ${province.name}. Google Solar API coverage is available for the vast majority of ${province.name} urban and suburban addresses. Reports cost $8 CAD per report after 4 free trial reports.` } },
      { '@type': 'Question', name: `What is the primary roofing peril in ${province.name}?`, acceptedAnswer: { '@type': 'Answer', text: `The primary roofing peril in ${province.name} is: ${province.stormProfile.primaryPeril}. ${province.roofingNotes}` } },
      { '@type': 'Question', name: `What building code applies to roofing in ${province.name}?`, acceptedAnswer: { '@type': 'Answer', text: `${province.name} operates under the ${province.buildingCode.adopted}. ${province.buildingCode.notes}` } },
      { '@type': 'Question', name: `Which insurance carriers cover roof damage in ${province.name}?`, acceptedAnswer: { '@type': 'Answer', text: `Major Canadian carriers serving ${province.name} include ${province.topInsurers.join(', ')}. Roof Manager reports are accepted as supporting documentation for claims with each of these carriers.` } },
      { '@type': 'Question', name: `How do I document a storm or hail claim in ${province.name}?`, acceptedAnswer: { '@type': 'Answer', text: `To document a storm or hail claim in ${province.name}, roofing contractors should: (1) Generate a satellite roof measurement report with Roof Manager, (2) Include the pitch-corrected area and edge breakdown in the claim, (3) Cross-reference material BOM for replacement cost calculation, (4) Submit the PDF report to the adjuster as supporting documentation. ${province.name} sees approximately ${province.stormProfile.avgClaimsPerYear} roofing claims per year.` } },
    ],
  })

  const html = `<!DOCTYPE html>
<html lang="en-CA">
<head>
  ${getHeadTagsMinimal()}
  <title>Satellite Roof Measurement Software for ${province.name} Roofing Contractors | Roof Manager</title>
  <meta name="description" content="AI-powered roof measurement reports for ${province.name} roofing contractors. ${province.stormProfile.primaryPeril}. CAD pricing. 4 free reports &mdash; no credit card.">
  <meta property="og:locale" content="en_CA">
  <meta property="og:title" content="Roof Measurement Software for ${province.name} Contractors &mdash; Roof Manager">
  <meta property="og:type" content="website">
  <meta name="geo.region" content="CA-${province.code}">
  <meta name="geo.placename" content="${province.name}, Canada">
  <link rel="canonical" href="https://www.roofmanager.ca/ca/${provinceSlug}">
  <link rel="alternate" hreflang="en-CA" href="https://www.roofmanager.ca/ca/${provinceSlug}">
  <link rel="alternate" hreflang="en" href="https://www.roofmanager.ca/">
  <link rel="alternate" hreflang="x-default" href="https://www.roofmanager.ca/">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"LocalBusiness","name":"Roof Manager — ${province.name}","description":"Satellite roof measurement software for ${province.name} roofing contractors. CAD pricing. Insurance-ready reports.","url":"https://www.roofmanager.ca/ca/${provinceSlug}","image":"https://www.roofmanager.ca/static/logo.png?v=20260504","address":{"@type":"PostalAddress","addressRegion":"${province.code}","addressCountry":"CA"},"areaServed":{"@type":"AdministrativeArea","name":"${province.name}"},"priceRange":"$5-$500 CAD"}
  </script>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://www.roofmanager.ca/"},{"@type":"ListItem","position":2,"name":"Canada","item":"https://www.roofmanager.ca/ca"},{"@type":"ListItem","position":3,"name":"${province.name}","item":"https://www.roofmanager.ca/ca/${provinceSlug}"}]}
  </script>
  <script type="application/ld+json">${faqSchema}</script>
</head>
<body class="min-h-screen" style="background:#0A0A0A;color:#fff">
  ${navHTML()}

  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#052e16,#14532d)">
    <div class="max-w-4xl mx-auto px-4">
      <span class="inline-block px-4 py-1.5 bg-[#00FF88]/20 border border-[#00FF88]/30 rounded-full text-sm text-[#00FF88] mb-6"><i class="fas fa-map-marker-alt mr-2"></i>${province.name}, ${province.code}</span>
      <h1 class="text-4xl md:text-5xl font-black mb-6">Satellite Roof Measurement Software<br>for <span class="text-[#00FF88]">${province.name}</span> Roofing Contractors</h1>
      <p class="text-xl text-gray-300 mb-4">${province.roofingNotes}</p>
      <p class="text-gray-400 mb-8">Reports cost <strong>$8 CAD</strong> after 4 free reports. Available across every ${province.name} metro. Insurance-ready documentation for ${province.stormProfile.primaryPeril.toLowerCase()} claims.</p>
      <div class="flex flex-col sm:flex-row gap-4 justify-center">
        <a href="/register" class="px-8 py-4 bg-[#00FF88] hover:bg-[#00e67a] text-[#0A0A0A] font-bold rounded-xl text-lg">Get 4 Free Reports <i class="fas fa-arrow-right ml-2"></i></a>
        <a href="/pricing" class="px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl text-lg border border-white/20">View Pricing (CAD)</a>
      </div>
    </div>
  </section>

  <section class="py-16" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-10">${province.name} Storm &amp; Roofing Profile</h2>
      <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div class="bg-white/5 border border-white/10 rounded-xl p-5">
          <div class="text-[#00FF88] font-bold text-lg mb-1">${province.stormProfile.hailDaysPerYear}</div>
          <div class="text-white font-semibold text-sm">Hail Days/Year</div>
          <div class="text-gray-500 text-xs mt-1">Average annual hail events</div>
        </div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-5">
          <div class="text-[#00FF88] font-bold text-lg mb-1 capitalize">${province.stormProfile.winterSeverity}</div>
          <div class="text-white font-semibold text-sm">Winter Severity</div>
          <div class="text-gray-500 text-xs mt-1">Ice, snow load, freeze-thaw</div>
        </div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-5">
          <div class="text-[#00FF88] font-bold text-lg mb-1 capitalize">${province.stormProfile.coastalRisk}</div>
          <div class="text-white font-semibold text-sm">Coastal Exposure</div>
          <div class="text-gray-500 text-xs mt-1">Wind-driven rain, salt load</div>
        </div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-5">
          <div class="text-[#00FF88] font-bold text-lg mb-1">${province.stormProfile.avgClaimsPerYear}</div>
          <div class="text-white font-semibold text-sm">Annual Insurance Claims</div>
          <div class="text-gray-500 text-xs mt-1">Estimated roofing claims/year</div>
        </div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-5 md:col-span-2">
          <div class="text-white font-semibold text-sm mb-2">Primary Peril</div>
          <div class="text-[#00FF88]">${province.stormProfile.primaryPeril}</div>
        </div>
      </div>
    </div>
  </section>

  <div class="max-w-5xl mx-auto px-4 py-8">${inlineQuoteFormHTML('ca-' + provinceSlug)}</div>

  <section class="py-16" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-8">${province.name} Roofing Building Code</h2>
      <div class="bg-white/5 border border-white/10 rounded-xl p-6 max-w-2xl mx-auto">
        <div class="text-[#00FF88] font-bold mb-2">${province.buildingCode.adopted}</div>
        <p class="text-gray-300 text-sm">${province.buildingCode.notes}</p>
        <p class="text-gray-500 text-xs mt-3">Reference: National Research Council of Canada and the ${province.name} provincial building authority, as of 2026. Roof Manager reports include pitch-corrected area calculations that satisfy code documentation requirements.</p>
      </div>
    </div>
  </section>

  <section class="py-16" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-4">Major ${province.name} Metros We Serve</h2>
      <p class="text-center text-gray-400 mb-8">Capital: ${province.capital} &middot; Population: ${province.population.toLocaleString()}</p>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        ${metroList}
      </div>
    </div>
  </section>

  <section class="py-16" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-8">Top Insurance Carriers &mdash; ${province.name}</h2>
      <div class="bg-white/5 border border-white/10 rounded-xl p-6 max-w-3xl mx-auto">
        <p class="text-gray-300 mb-3 text-sm leading-relaxed">Roof Manager reports are accepted as supporting documentation by all major Canadian carriers operating in ${province.name}:</p>
        <div class="flex flex-wrap gap-2">
          ${province.topInsurers.map(carrier => `<span class="bg-[#00FF88]/10 border border-[#00FF88]/20 rounded-full px-3 py-1 text-[#00FF88] text-xs">${carrier}</span>`).join('')}
        </div>
      </div>
    </div>
  </section>

  <section class="py-16" style="background:#111">
    <div class="max-w-4xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-8">Frequently Asked Questions &mdash; ${province.name} Roofing</h2>
      <div class="space-y-4">
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2">Does Roof Manager work in ${province.name}?</h3><p class="text-gray-400 text-sm">Yes. Roof Manager generates satellite-powered roof measurement reports for roofing contractors across ${province.name}. Google Solar API coverage is available for the vast majority of urban and suburban addresses. Reports cost $8 CAD after 4 free.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2">What is the primary roofing peril in ${province.name}?</h3><p class="text-gray-400 text-sm">${province.stormProfile.primaryPeril}. ${province.roofingNotes}</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2">What building code applies to roofing in ${province.name}?</h3><p class="text-gray-400 text-sm">${province.name} operates under the ${province.buildingCode.adopted}. ${province.buildingCode.notes}</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2">Which carriers do Roof Manager reports work with?</h3><p class="text-gray-400 text-sm">Every major Canadian carrier serving ${province.name}, including ${province.topInsurers.join(', ')}. Reports include pitch-corrected area, edge breakdowns, and material BOMs accepted as supporting documentation for storm, hail, wind, ice, and post-tropical claim types.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2">How do I document a claim in ${province.name}?</h3><p class="text-gray-400 text-sm">Generate a Roof Manager satellite report, include the pitch-corrected area and edge breakdown, and submit the PDF to the adjuster. ${province.name} averages ${province.stormProfile.avgClaimsPerYear} roofing claims per year.</p></div>
      </div>
    </div>
  </section>

  <section class="py-10" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <p class="text-gray-500 text-xs font-semibold uppercase tracking-wide mb-3">Also Serving</p>
      <div class="flex flex-wrap gap-2">${siblingProvinces}
        <a href="/ca" class="text-xs text-[#00FF88] bg-[#00FF88]/10 border border-[#00FF88]/20 rounded-full px-3 py-1 font-semibold hover:bg-[#00FF88]/20 transition-colors">View all provinces &rarr;</a>
      </div>
    </div>
  </section>

  <section class="py-16 text-center" style="background:linear-gradient(135deg,#14532d,#052e16)">
    <div class="max-w-3xl mx-auto px-4">
      <h2 class="text-3xl font-black mb-4">Ready to Measure Faster in ${province.name}?</h2>
      <p class="text-gray-300 mb-8">Join ${province.name} roofing contractors who use Roof Manager to win more jobs and document claims faster.</p>
      <a href="/register" class="inline-block px-10 py-4 bg-[#00FF88] text-[#0A0A0A] font-black rounded-xl text-lg shadow-xl hover:bg-[#00e67a]">Start Free &mdash; 4 Reports on Us</a>
    </div>
  </section>

  ${footerHTML('ca-' + provinceSlug)}
</body>
</html>`
  return c.html(html)
})

export default app

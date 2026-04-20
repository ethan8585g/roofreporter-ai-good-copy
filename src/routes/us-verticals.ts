import { Hono } from 'hono'
import type { Env } from '../types'
import { US_STATES, ALL_STATE_SLUGS, US_CITIES } from '../data/us-states'
import { inlineQuoteFormHTML, damageAssessmentFormHTML } from '../lib/lead-forms'

const STORM_CLUSTERS: Record<string, string[]> = {
  'hail-belt': ['colorado','texas','oklahoma','kansas','nebraska','south-dakota','north-dakota','minnesota','iowa','missouri'],
  'hurricane-coast': ['florida','texas','louisiana','north-carolina','south-carolina','georgia','alabama','mississippi'],
  'tornado-alley': ['texas','oklahoma','kansas','nebraska','iowa','missouri','arkansas','tennessee'],
  'northeast': ['new-york','new-jersey','pennsylvania','massachusetts','connecticut','maryland'],
  'northwest': ['washington','oregon','idaho','montana'],
}
function getRelatedStates(stateSlug: string): string[] {
  for (const cluster of Object.values(STORM_CLUSTERS)) {
    if (cluster.includes(stateSlug)) {
      return cluster.filter(s => s !== stateSlug && US_STATES[s]).slice(0, 5)
    }
  }
  return []
}

const app = new Hono<{ Bindings: Env }>()

function head(title: string, desc: string, stateCode?: string) {
  return `<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#00FF88">
  <link rel="stylesheet" href="/static/tailwind.css">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" media="print" onload="this.media='all'">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>* { font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; }</style>
  <title>${title}</title>
  <meta name="description" content="${desc}">
  <meta property="og:locale" content="en_US">
  <meta name="geo.region" content="${stateCode ? `US-${stateCode}` : 'US'}">`
}

function nav() {
  return `<nav style="background:#0A0A0A;border-bottom:1px solid rgba(255,255,255,0.08)" class="text-white sticky top-0 z-50">
  <div class="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
    <a href="/" class="flex items-center gap-3"><img src="/static/logo.png" alt="Roof Manager" class="w-9 h-9 rounded-lg object-cover"><span class="text-white font-bold text-lg">Roof Manager</span></a>
    <div class="flex items-center gap-4">
      <a href="/pricing" class="text-gray-400 hover:text-white text-sm hidden md:block">Pricing</a>
      <a href="/customer/login" class="bg-sky-500 hover:bg-sky-400 text-white font-bold py-2 px-5 rounded-xl text-sm">Get Started Free</a>
    </div>
  </div>
</nav>`
}

function contactCTA(source: string) {
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
      <p style="text-align:center;color:#6b7280;font-size:11px;margin-top:8px"><i class="fas fa-phone" style="color:#00FF88;margin-right:4px"></i>Or call: <a href="tel:+17809833335" style="color:#00FF88">(780) 983-3335</a> · <a href="mailto:sales@roofmanager.ca" style="color:#00FF88">sales@roofmanager.ca</a></p>
    </div>
  </div>
</section>`
}

function footer() {
  return `${contactCTA('us-vertical')}
<footer style="background:#0A0A0A;border-top:1px solid rgba(255,255,255,0.06)" class="text-gray-500 py-10 text-center text-sm">
  <div class="max-w-4xl mx-auto px-4">
    <p class="text-gray-300 font-semibold mb-2">Roof Manager — Serving All 50 US States &amp; Canada</p>
    <p>&copy; ${new Date().getFullYear()} Roof Manager.</p>
    <div class="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
      <a href="/" class="hover:text-white">Home</a><a href="/pricing" class="hover:text-white">Pricing</a><a href="/blog" class="hover:text-white">Blog</a>
      <a href="/contact" class="hover:text-white">Contact</a><a href="/us/insurance-claims" class="hover:text-white">Insurance Claims</a>
      <a href="/us/storm-damage" class="hover:text-white">Storm Damage</a><a href="/us/hail-damage" class="hover:text-white">Hail Damage</a>
    </div>
  </div>
</footer>`
}

function stateDirectory(verticalSlug: string, label: string) {
  return ALL_STATE_SLUGS.map(slug => {
    const s = US_STATES[slug]
    return `<a href="/us/${verticalSlug}/${slug}" class="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2 hover:bg-white/10 transition-all">
      <span class="text-sky-400 font-bold text-xs w-6">${s.code}</span>
      <span class="text-white text-xs font-medium">${s.name}</span>
    </a>`
  }).join('')
}

// ─── INSURANCE CLAIMS ────────────────────────────────────────────────────────

app.get('/insurance-claims', (c) => {
  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head('Roof Damage Insurance Claims by State | Roof Manager', 'How to document roof damage insurance claims in every US state. Satellite measurement reports accepted by adjusters. $8 USD/report after 3 free.')}</head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-4xl font-black mb-6">Roof Damage Insurance Claims — All 50 States</h1>
      <p class="text-xl text-blue-200 mb-8">Roof Manager generates satellite measurement reports accepted by insurance adjusters across all 50 US states. As of 2026, the platform has supported documentation for storm, hail, hurricane, and wind damage claims. Reports include pitch-corrected area, edge breakdowns, and material BOMs — all in under 60 seconds.</p>
      <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg inline-block">Get 3 Free Reports (USD)</a>
    </div>
  </section>
  <section class="py-16" style="background:#111">
    <div class="max-w-6xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-8">Select Your State</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">${stateDirectory('insurance-claims', 'Insurance Claims')}</div>
    </div>
  </section>
  ${footer()}</body></html>`
  return c.html(html)
})

app.get('/insurance-claims/:state', (c) => {
  const stateSlug = c.req.param('state').toLowerCase()
  const state = US_STATES[stateSlug]
  if (!state) return c.redirect('/us/insurance-claims')

  const isHailState = state.stormProfile.hailDaysPerYear >= 15
  const isHurricaneState = ['high', 'moderate'].includes(state.stormProfile.hurricaneRisk)
  const xactimatePara = `Roof Manager reports generate pitch-corrected square footage that aligns with Xactimate F9 line items used by ${state.name} adjusters. The edge breakdown (ridge, hip, valley, eave, rake) matches Xactimate\'s edge category inputs, reducing back-and-forth with carriers.`

  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head(`Roof Insurance Claims in ${state.name} — Documentation Guide | Roof Manager`, `How to document roof damage insurance claims in ${state.name}. Satellite measurement reports accepted by ${state.topInsurers[0]} and other ${state.code} carriers. $8 USD/report.`, state.code)}
  <link rel="canonical" href="https://www.roofmanager.ca/us/insurance-claims/${stateSlug}">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://www.roofmanager.ca/"},{"@type":"ListItem","position":2,"name":"Insurance Claims","item":"https://www.roofmanager.ca/us/insurance-claims"},{"@type":"ListItem","position":3,"name":"${state.name}","item":"https://www.roofmanager.ca/us/insurance-claims/${stateSlug}"}]}</script>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"HowTo","name":"How to File a Roof Damage Insurance Claim in ${state.name}","description":"Step-by-step guide to documenting and filing a roof damage insurance claim in ${state.name}.","step":[{"@type":"HowToStep","name":"Generate Satellite Measurement Report","text":"Use Roof Manager to generate a satellite-powered roof measurement report for the damaged property in under 60 seconds."},{"@type":"HowToStep","name":"Document Damage with Photos","text":"Photograph all visible damage from ground level. Use the Roof Manager report as the technical measurement documentation."},{"@type":"HowToStep","name":"Submit to Adjuster","text":"Submit the Roof Manager PDF report with your claim. The report includes pitch-corrected area, edge breakdowns, and material BOM accepted by ${state.topInsurers[0]} and other ${state.name} carriers."},{"@type":"HowToStep","name":"Follow Up on Claim","text":"Reference the report\'s measurement data if the adjuster requests clarification on square footage or material quantities."}]}</script>
  </head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <span class="inline-block px-3 py-1 bg-sky-500/20 border border-sky-400/30 rounded-full text-xs text-sky-300 mb-4"><i class="fas fa-shield-alt mr-1"></i>${state.name} Insurance Claims Guide</span>
      <h1 class="text-4xl font-black mb-6">Roof Damage Insurance Claims<br>in <span class="text-sky-400">${state.name}</span></h1>
      <p class="text-xl text-blue-200 mb-8">As of 2026, ${state.name} averages approximately ${state.stormProfile.avgClaimsPerYear} roofing insurance claims per year. The primary peril is ${state.stormProfile.primaryPeril}. Roof Manager satellite measurement reports are accepted by ${state.topInsurers.slice(0,3).join(', ')} and other ${state.code} carriers as supporting claim documentation.</p>
      <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg inline-block">Generate a Claim Report (USD)</a>
    </div>
  </section>

  <section class="py-16" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black mb-8">Key Facts for ${state.name} Roofing Claims</h2>
      <ul class="space-y-3 text-gray-300">
        <li class="flex items-start gap-3"><i class="fas fa-check text-sky-400 mt-1"></i><span><strong>Primary peril:</strong> ${state.stormProfile.primaryPeril}</span></li>
        <li class="flex items-start gap-3"><i class="fas fa-check text-sky-400 mt-1"></i><span><strong>Annual claims volume:</strong> ~${state.stormProfile.avgClaimsPerYear} roofing insurance claims per year in ${state.name}</span></li>
        <li class="flex items-start gap-3"><i class="fas fa-check text-sky-400 mt-1"></i><span><strong>Top carriers:</strong> ${state.topInsurers.join(', ')}</span></li>
        <li class="flex items-start gap-3"><i class="fas fa-check text-sky-400 mt-1"></i><span><strong>Building code:</strong> ${state.buildingCode.adoptedIRC} — ${state.buildingCode.notes}</span></li>
        <li class="flex items-start gap-3"><i class="fas fa-check text-sky-400 mt-1"></i><span><strong>Hail exposure:</strong> ${state.stormProfile.hailDaysPerYear} hail days per year on average</span></li>
        ${isHurricaneState ? `<li class="flex items-start gap-3"><i class="fas fa-check text-sky-400 mt-1"></i><span><strong>Hurricane risk:</strong> ${state.stormProfile.hurricaneRisk.toUpperCase()} — hurricane damage documentation requirements apply</span></li>` : ''}
      </ul>
    </div>
  </section>

  <div class="max-w-5xl mx-auto px-4 py-8">${inlineQuoteFormHTML('insurance-claims-' + stateSlug)}</div>

  <section class="py-16" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black mb-6">How to File a Roof Damage Claim in ${state.name}</h2>
      <div class="space-y-4">
        <div class="bg-white/5 border border-white/10 rounded-xl p-5 flex gap-4"><div class="w-8 h-8 bg-sky-500 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold text-sm">1</div><div><h3 class="font-bold text-white">Generate a Satellite Measurement Report</h3><p class="text-gray-400 text-sm mt-1">Use Roof Manager to measure the damaged ${state.name} property in under 60 seconds. The report includes pitch-corrected area, edge breakdown, and material BOM.</p></div></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-5 flex gap-4"><div class="w-8 h-8 bg-sky-500 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold text-sm">2</div><div><h3 class="font-bold text-white">Document Visible Damage</h3><p class="text-gray-400 text-sm mt-1">Photograph all damage from ground level. In ${state.name}, carriers typically require photos showing impact patterns, granule loss, and edge damage.</p></div></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-5 flex gap-4"><div class="w-8 h-8 bg-sky-500 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold text-sm">3</div><div><h3 class="font-bold text-white">Submit to Adjuster</h3><p class="text-gray-400 text-sm mt-1">${xactimatePara}</p></div></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-5 flex gap-4"><div class="w-8 h-8 bg-sky-500 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold text-sm">4</div><div><h3 class="font-bold text-white">Receive Settlement</h3><p class="text-gray-400 text-sm mt-1">${state.name} carriers typically settle ${isHailState ? 'hail' : 'storm'} damage claims within 30–90 days. Having accurate measurements reduces disputes and accelerates settlement.</p></div></div>
      </div>
    </div>
  </section>

  <section class="py-16 text-center" style="background:linear-gradient(135deg,#0c4a6e,#1e3a5f)">
    <div class="max-w-3xl mx-auto px-4">
      <h2 class="text-3xl font-black mb-4">Document ${state.name} Claims Faster</h2>
      <p class="text-blue-200 mb-8">Generate an insurance-ready satellite report for any ${state.name} property in under 60 seconds. $8 USD/report after 3 free.</p>
      <a href="/customer/login" class="inline-block px-10 py-4 bg-white text-blue-700 font-black rounded-xl text-lg">Start Free — 3 Reports on Us</a>
    </div>
  </section>
  ${footer()}</body></html>`
  return c.html(html)
})

// ─── STORM DAMAGE ─────────────────────────────────────────────────────────────

app.get('/storm-damage', (c) => {
  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head('Storm Damage Roof Assessment by State | Roof Manager', 'Satellite roof measurement for storm damage assessment in all 50 US states. Insurance-ready reports. $8 USD after 3 free.')}</head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-4xl font-black mb-6">Storm Damage Roof Assessment — All 50 States</h1>
      <p class="text-xl text-blue-200 mb-8">Roof Manager generates satellite-powered storm damage assessment reports for roofing contractors and insurance professionals in all 50 US states. Reports include pitch-corrected area, edge breakdowns, and material BOMs in under 60 seconds. As of 2026, US storm damage totals average $20–60B per year in roofing claims alone.</p>
      <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg inline-block">Start Free Assessment (USD)</a>
    </div>
  </section>
  <section class="py-16" style="background:#111">
    <div class="max-w-6xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-8">Select Your State</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">${stateDirectory('storm-damage', 'Storm Damage')}</div>
    </div>
  </section>
  ${footer()}</body></html>`
  return c.html(html)
})

app.get('/storm-damage/:state', (c) => {
  const stateSlug = c.req.param('state').toLowerCase()
  const state = US_STATES[stateSlug]
  if (!state) return c.redirect('/us/storm-damage')

  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head(`Storm Damage Roof Assessment in ${state.name} | Roof Manager`, `Storm damage roof assessment for ${state.name} roofing contractors. ${state.stormProfile.primaryPeril}. Satellite measurement reports in under 60 seconds. $8 USD.`, state.code)}
  <link rel="canonical" href="https://www.roofmanager.ca/us/storm-damage/${stateSlug}">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://www.roofmanager.ca/"},{"@type":"ListItem","position":2,"name":"Storm Damage","item":"https://www.roofmanager.ca/us/storm-damage"},{"@type":"ListItem","position":3,"name":"${state.name}","item":"https://www.roofmanager.ca/us/storm-damage/${stateSlug}"}]}</script>
  </head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-4xl font-black mb-6">Storm Damage Roof Assessment<br>in <span class="text-sky-400">${state.name}</span></h1>
      <p class="text-xl text-blue-200 mb-4">${state.roofingNotes}</p>
      <p class="text-blue-300 mb-8">Primary peril: ${state.stormProfile.primaryPeril}. ${state.name} averages ~${state.stormProfile.avgClaimsPerYear} roofing claims per year. Roof Manager reports are used by ${state.code} contractors for post-storm property triage and insurance documentation.</p>
      <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg inline-block">Generate Storm Report (USD)</a>
    </div>
  </section>
  <section class="py-16" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black mb-6">Key Facts — ${state.name} Storm Profile</h2>
      <ul class="space-y-3 text-gray-300">
        <li class="flex items-start gap-3"><i class="fas fa-cloud-bolt text-sky-400 mt-1"></i><span><strong>Hail days/year:</strong> ${state.stormProfile.hailDaysPerYear} on average across ${state.name}</span></li>
        <li class="flex items-start gap-3"><i class="fas fa-wind text-sky-400 mt-1"></i><span><strong>Hurricane risk:</strong> ${state.stormProfile.hurricaneRisk.charAt(0).toUpperCase() + state.stormProfile.hurricaneRisk.slice(1)}</span></li>
        <li class="flex items-start gap-3"><i class="fas fa-tornado text-sky-400 mt-1"></i><span><strong>Tornado risk:</strong> ${state.stormProfile.tornadoRisk.charAt(0).toUpperCase() + state.stormProfile.tornadoRisk.slice(1)}</span></li>
        <li class="flex items-start gap-3"><i class="fas fa-file-alt text-sky-400 mt-1"></i><span><strong>Annual claims:</strong> ~${state.stormProfile.avgClaimsPerYear} roofing insurance claims per year</span></li>
        <li class="flex items-start gap-3"><i class="fas fa-gavel text-sky-400 mt-1"></i><span><strong>Building code:</strong> ${state.buildingCode.adoptedIRC}</span></li>
      </ul>
    </div>
  </section>
  <div class="max-w-5xl mx-auto px-4 py-8">${damageAssessmentFormHTML('storm-damage-' + stateSlug, 'storm')}</div>

  <section class="py-16 text-center" style="background:linear-gradient(135deg,#0c4a6e,#1e3a5f)">
    <div class="max-w-3xl mx-auto px-4">
      <h2 class="text-3xl font-black mb-4">Document ${state.name} Storm Damage Fast</h2>
      <p class="text-blue-200 mb-8">Generate a satellite measurement report for any ${state.name} storm-damaged property in under 60 seconds. $8 USD/report after 3 free.</p>
      <a href="/customer/login" class="inline-block px-10 py-4 bg-white text-blue-700 font-black rounded-xl text-lg">Start Free — 3 Reports on Us</a>
    </div>
  </section>
  ${getRelatedStates(stateSlug).length > 0 ? `<section class="py-12" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-xl font-bold mb-4">Related Storm Risk States</h2>
      <div class="flex flex-wrap gap-3">${getRelatedStates(stateSlug).map(s => `<a href="/us/storm-damage/${s}" class="px-4 py-2 rounded-lg text-sm font-medium text-sky-300 hover:text-white" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1)">${US_STATES[s].name} — ${US_STATES[s].stormProfile.primaryPeril} →</a>`).join('')}</div>
    </div>
  </section>` : ''}
  ${footer()}</body></html>`
  return c.html(html)
})

// ─── HAIL DAMAGE ──────────────────────────────────────────────────────────────

app.get('/hail-damage', (c) => {
  const hailStates = ALL_STATE_SLUGS.filter(s => US_STATES[s].stormProfile.hailDaysPerYear >= 10)
  const hailStateLinks = hailStates.map(slug => {
    const s = US_STATES[slug]
    return `<a href="/us/hail-damage/${slug}" class="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2 hover:bg-white/10 transition-all">
      <span class="text-sky-400 font-bold text-xs w-6">${s.code}</span>
      <span class="text-white text-xs font-medium">${s.name}</span>
      <span class="ml-auto text-gray-500 text-xs">${s.stormProfile.hailDaysPerYear}d</span>
    </a>`
  }).join('')

  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head('Hail Damage Roof Assessment by State | Roof Manager', 'Satellite roof measurement for hail damage documentation in the US hail belt. CO, TX, OK, KS, NE and all 50 states. $8 USD after 3 free.')}</head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-4xl font-black mb-6">Hail Damage Roof Assessment — US Hail Belt & All 50 States</h1>
      <p class="text-xl text-blue-200 mb-8">The US hail belt (Colorado, Texas, Oklahoma, Kansas, Nebraska, South Dakota, Minnesota) generates more roofing claims than any other weather peril in North America. Roof Manager generates satellite measurement reports for hail damage documentation in under 60 seconds — insurance-ready, priced in USD.</p>
      <div class="grid grid-cols-3 md:grid-cols-6 gap-3 mb-8">
        ${['colorado','texas','oklahoma','kansas','nebraska','south-dakota'].map(s => `<a href="/us/hail-damage/${s}" class="bg-sky-500/20 border border-sky-400/30 rounded-xl p-3 text-center hover:bg-sky-500/30"><div class="text-sky-300 font-bold text-sm">${US_STATES[s].code}</div><div class="text-gray-400 text-xs mt-0.5">${US_STATES[s].stormProfile.hailDaysPerYear}d/yr</div></a>`).join('')}
      </div>
      <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg inline-block">Start Free Hail Reports (USD)</a>
    </div>
  </section>
  <section class="py-16" style="background:#111">
    <div class="max-w-6xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-4">States with 10+ Hail Days/Year</h2>
      <p class="text-center text-gray-400 mb-8">Sorted by hail exposure. Click any state for the local hail documentation guide.</p>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">${hailStateLinks}</div>
    </div>
  </section>
  ${footer()}</body></html>`
  return c.html(html)
})

app.get('/hail-damage/:state', (c) => {
  const stateSlug = c.req.param('state').toLowerCase()
  const state = US_STATES[stateSlug]
  if (!state) return c.redirect('/us/hail-damage')

  const isHighHail = state.stormProfile.hailDaysPerYear >= 15
  const hailDesc = isHighHail
    ? `${state.name} is in the US hail belt core, averaging ${state.stormProfile.hailDaysPerYear} hail days per year — one of the highest in the nation.`
    : `${state.name} averages ${state.stormProfile.hailDaysPerYear} hail days per year. ${state.stormProfile.primaryPeril}.`

  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head(`Hail Damage Roof Documentation in ${state.name} | Roof Manager`, `How roofing contractors in ${state.name} document hail damage claims. Satellite reports. ${state.stormProfile.hailDaysPerYear} hail days/year. USD pricing.`, state.code)}
  <link rel="canonical" href="https://www.roofmanager.ca/us/hail-damage/${stateSlug}">
  </head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-4xl font-black mb-6">Hail Damage Roof Documentation<br>in <span class="text-sky-400">${state.name}</span></h1>
      <p class="text-xl text-blue-200 mb-8">${hailDesc} Roof Manager satellite measurement reports give ${state.code} roofing contractors insurance-ready documentation in under 60 seconds. Top ${state.name} carriers — ${state.topInsurers.slice(0,3).join(', ')} — accept Roof Manager reports for hail damage claims.</p>
      <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg inline-block">Get Free Hail Reports (USD)</a>
    </div>
  </section>
  <section class="py-16" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black mb-6">${state.name} Hail Profile</h2>
      <div class="grid md:grid-cols-3 gap-5">
        <div class="bg-white/5 border border-white/10 rounded-xl p-5"><div class="text-3xl font-black text-sky-400 mb-1">${state.stormProfile.hailDaysPerYear}</div><div class="text-white font-semibold">Hail Days/Year</div><div class="text-gray-500 text-xs mt-1">Average annual hail events</div></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-5"><div class="text-3xl font-black text-sky-400 mb-1">${state.stormProfile.avgClaimsPerYear}</div><div class="text-white font-semibold">Annual Claims</div><div class="text-gray-500 text-xs mt-1">Total roofing claims/year</div></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-5"><div class="text-3xl font-black text-sky-400 mb-1">60s</div><div class="text-white font-semibold">Report Time</div><div class="text-gray-500 text-xs mt-1">Satellite report generation</div></div>
      </div>
      <p class="text-gray-300 mt-6 leading-relaxed">${state.roofingNotes}</p>
    </div>
  </section>
  <div class="max-w-5xl mx-auto px-4 py-8">${damageAssessmentFormHTML('hail-damage-' + stateSlug, 'hail')}</div>

  <section class="py-16 text-center" style="background:linear-gradient(135deg,#0c4a6e,#1e3a5f)">
    <div class="max-w-3xl mx-auto px-4">
      <h2 class="text-3xl font-black mb-4">Start Documenting ${state.name} Hail Claims</h2>
      <p class="text-blue-200 mb-8">$8 USD per report after 3 free. Insurance-ready satellite measurements in under 60 seconds.</p>
      <a href="/customer/login" class="inline-block px-10 py-4 bg-white text-blue-700 font-black rounded-xl text-lg">Start Free — 3 Reports on Us</a>
    </div>
  </section>
  ${getRelatedStates(stateSlug).length > 0 ? `<section class="py-12" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-xl font-bold mb-4">Related Storm Risk States</h2>
      <div class="flex flex-wrap gap-3">${getRelatedStates(stateSlug).map(s => `<a href="/us/hail-damage/${s}" class="px-4 py-2 rounded-lg text-sm font-medium text-sky-300 hover:text-white" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1)">${US_STATES[s].name} — ${US_STATES[s].stormProfile.hailDaysPerYear} hail days/yr →</a>`).join('')}</div>
    </div>
  </section>` : ''}
  ${footer()}</body></html>`
  return c.html(html)
})

// ─── HURRICANE DAMAGE ─────────────────────────────────────────────────────────

app.get('/hurricane-damage', (c) => {
  const hurricaneStates = ALL_STATE_SLUGS.filter(s => ['high', 'moderate'].includes(US_STATES[s].stormProfile.hurricaneRisk))
  const hurricaneLinks = hurricaneStates.map(slug => {
    const s = US_STATES[slug]
    return `<a href="/us/hurricane-damage/${slug}" class="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2 hover:bg-white/10 transition-all">
      <span class="text-sky-400 font-bold text-xs w-6">${s.code}</span>
      <span class="text-white text-xs font-medium">${s.name}</span>
      <span class="ml-auto text-xs capitalize ${s.stormProfile.hurricaneRisk === 'high' ? 'text-red-400' : 'text-yellow-400'}">${s.stormProfile.hurricaneRisk}</span>
    </a>`
  }).join('')
  const lowRiskLinks = ALL_STATE_SLUGS.filter(s => !['high','moderate'].includes(US_STATES[s].stormProfile.hurricaneRisk)).map(slug => {
    const s = US_STATES[slug]
    return `<a href="/us/hurricane-damage/${slug}" class="text-xs text-gray-500 hover:text-gray-300 bg-white/5 rounded-lg px-2 py-1">${s.name}</a>`
  }).join('')

  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head('Hurricane Roof Damage Documentation by State | Roof Manager', 'Satellite roof measurement for hurricane damage documentation. FL, TX, LA, NC, SC, GA and all Gulf/Atlantic states. Insurance-ready. USD pricing.')}</head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-4xl font-black mb-6">Hurricane Roof Damage Documentation — Gulf &amp; Atlantic States</h1>
      <p class="text-xl text-blue-200 mb-8">Gulf Coast and Atlantic states generate the largest insurance roofing claims in the US. Hurricane Ian (2022) alone produced $110B+ in losses. Roof Manager generates satellite measurement reports accepted by Florida, Texas, Louisiana, and other Gulf/Atlantic state carriers for hurricane damage documentation.</p>
      <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg inline-block">Generate Hurricane Report (USD)</a>
    </div>
  </section>
  <section class="py-16" style="background:#111">
    <div class="max-w-6xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-4">High &amp; Moderate Hurricane Risk States</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-8">${hurricaneLinks}</div>
      <h3 class="text-lg font-semibold text-gray-400 mb-3">Other States</h3>
      <div class="flex flex-wrap gap-2">${lowRiskLinks}</div>
    </div>
  </section>
  ${footer()}</body></html>`
  return c.html(html)
})

app.get('/hurricane-damage/:state', (c) => {
  const stateSlug = c.req.param('state').toLowerCase()
  const state = US_STATES[stateSlug]
  if (!state) return c.redirect('/us/hurricane-damage')

  const isHighRisk = state.stormProfile.hurricaneRisk === 'high'
  const isModerate = state.stormProfile.hurricaneRisk === 'moderate'
  const isLowRisk = !isHighRisk && !isModerate

  const narrative = isHighRisk
    ? `${state.name} has HIGH hurricane exposure. ${state.roofingNotes} Satellite measurement reports are critical for post-hurricane property triage across ${state.name}.`
    : isModerate
    ? `${state.name} has MODERATE hurricane exposure from Gulf or Atlantic storm tracks. ${state.roofingNotes}`
    : `Hurricanes rarely directly impact ${state.name} at full strength, but tropical storm remnants can cause significant wind and rain damage. ${state.roofingNotes}`

  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head(`Hurricane Roof Damage Documentation in ${state.name} | Roof Manager`, `Hurricane damage roof documentation for ${state.name}. Satellite measurement reports. ${state.stormProfile.primaryPeril}. USD pricing.`, state.code)}
  <link rel="canonical" href="https://www.roofmanager.ca/us/hurricane-damage/${stateSlug}">
  </head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <span class="inline-block px-3 py-1 rounded-full text-xs mb-4 ${isHighRisk ? 'bg-red-500/20 border border-red-400/30 text-red-300' : isModerate ? 'bg-yellow-500/20 border border-yellow-400/30 text-yellow-300' : 'bg-gray-500/20 border border-gray-400/30 text-gray-300'}">Hurricane Risk: ${state.stormProfile.hurricaneRisk.toUpperCase()}</span>
      <h1 class="text-4xl font-black mb-6">Hurricane Damage Documentation<br>in <span class="text-sky-400">${state.name}</span></h1>
      <p class="text-xl text-blue-200 mb-8">${narrative}</p>
      <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg inline-block">Generate Report (USD)</a>
    </div>
  </section>
  <section class="py-16" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black mb-6">Why ${state.name} Contractors Use Satellite Measurements</h2>
      <p class="text-gray-300 leading-relaxed mb-4">After a hurricane or tropical storm event in ${state.name}, roofing contractors face rapid demand spikes with hundreds of properties to assess. Satellite measurement tools allow contractors to:</p>
      <ul class="space-y-2 text-gray-300">
        <li class="flex items-start gap-3"><i class="fas fa-check text-sky-400 mt-1"></i><span>Triage dozens of properties in one hour using satellite imagery</span></li>
        <li class="flex items-start gap-3"><i class="fas fa-check text-sky-400 mt-1"></i><span>Generate insurance-ready PDF reports with pitch-corrected area for adjusters</span></li>
        <li class="flex items-start gap-3"><i class="fas fa-check text-sky-400 mt-1"></i><span>Avoid dangerous roof access in immediate post-storm conditions</span></li>
        <li class="flex items-start gap-3"><i class="fas fa-check text-sky-400 mt-1"></i><span>Document ${state.name} ${isHighRisk ? state.buildingCode.notes : 'building code'} compliance requirements</span></li>
      </ul>
    </div>
  </section>
  <div class="max-w-5xl mx-auto px-4 py-8">${damageAssessmentFormHTML('hurricane-damage-' + stateSlug, 'hurricane')}</div>

  <section class="py-16 text-center" style="background:linear-gradient(135deg,#0c4a6e,#1e3a5f)">
    <div class="max-w-3xl mx-auto px-4">
      <h2 class="text-3xl font-black mb-4">Ready for ${state.name} Storm Season?</h2>
      <p class="text-blue-200 mb-8">$8 USD per report after 3 free. Generate satellite reports for any ${state.name} address in under 60 seconds.</p>
      <a href="/customer/login" class="inline-block px-10 py-4 bg-white text-blue-700 font-black rounded-xl text-lg">Start Free — 3 Reports on Us</a>
    </div>
  </section>
  ${footer()}</body></html>`
  return c.html(html)
})

// ─── ROOF REPLACEMENT COST ────────────────────────────────────────────────────

// Estimated average roof replacement costs per state (sq ft, 2,000 sq ft home, as of 2026)
const STATE_ROOF_COSTS: Record<string, { low: number; avg: number; high: number }> = {
  'texas': { low: 7500, avg: 11000, high: 18000 },
  'florida': { low: 9000, avg: 14000, high: 22000 },
  'california': { low: 12000, avg: 18000, high: 30000 },
  'colorado': { low: 8500, avg: 12000, high: 19000 },
  'arizona': { low: 7000, avg: 10500, high: 17000 },
  'georgia': { low: 7000, avg: 10000, high: 16000 },
  'new-york': { low: 11000, avg: 16000, high: 25000 },
  'illinois': { low: 8000, avg: 11500, high: 18000 },
  'ohio': { low: 7500, avg: 10500, high: 16000 },
  'washington': { low: 9000, avg: 13000, high: 20000 },
  'alabama': { low: 7000, avg: 10000, high: 16000 },
  'alaska': { low: 14000, avg: 20000, high: 32000 },
  'arkansas': { low: 6500, avg: 9500, high: 15000 },
  'connecticut': { low: 10000, avg: 14500, high: 22000 },
  'delaware': { low: 9000, avg: 13000, high: 20000 },
  'hawaii': { low: 14000, avg: 21000, high: 35000 },
  'idaho': { low: 7500, avg: 11000, high: 17000 },
  'indiana': { low: 7000, avg: 10000, high: 16000 },
  'iowa': { low: 7000, avg: 10000, high: 16000 },
  'kansas': { low: 7000, avg: 10500, high: 17000 },
  'kentucky': { low: 6500, avg: 9500, high: 15000 },
  'louisiana': { low: 9500, avg: 14000, high: 23000 },
  'maine': { low: 9000, avg: 13000, high: 20000 },
  'maryland': { low: 10000, avg: 14500, high: 22000 },
  'massachusetts': { low: 11000, avg: 16000, high: 25000 },
  'michigan': { low: 7500, avg: 11000, high: 17000 },
  'minnesota': { low: 8000, avg: 11500, high: 18000 },
  'mississippi': { low: 6500, avg: 9500, high: 15000 },
  'missouri': { low: 7500, avg: 11000, high: 17000 },
  'montana': { low: 8000, avg: 12000, high: 19000 },
  'nebraska': { low: 7000, avg: 10500, high: 17000 },
  'nevada': { low: 8000, avg: 12000, high: 19000 },
  'new-hampshire': { low: 9500, avg: 14000, high: 21000 },
  'new-jersey': { low: 11000, avg: 16000, high: 25000 },
  'new-mexico': { low: 7500, avg: 11000, high: 17000 },
  'north-carolina': { low: 7500, avg: 11000, high: 17000 },
  'north-dakota': { low: 7500, avg: 11000, high: 17000 },
  'oklahoma': { low: 7000, avg: 10500, high: 17000 },
  'oregon': { low: 9000, avg: 13000, high: 20000 },
  'pennsylvania': { low: 9000, avg: 13000, high: 20000 },
  'rhode-island': { low: 10000, avg: 14500, high: 22000 },
  'south-carolina': { low: 7500, avg: 11000, high: 17000 },
  'south-dakota': { low: 7500, avg: 11000, high: 17000 },
  'tennessee': { low: 7000, avg: 10000, high: 16000 },
  'utah': { low: 8000, avg: 12000, high: 19000 },
  'vermont': { low: 9500, avg: 14000, high: 21000 },
  'virginia': { low: 9000, avg: 13000, high: 20000 },
  'west-virginia': { low: 7000, avg: 10000, high: 16000 },
  'wisconsin': { low: 7500, avg: 11000, high: 17000 },
  'wyoming': { low: 8000, avg: 12000, high: 19000 },
}
function getStateCost(slug: string) {
  return STATE_ROOF_COSTS[slug] || { low: 7000, avg: 11000, high: 18000 }
}

app.get('/roof-replacement-cost', (c) => {
  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head('Roof Replacement Cost by State 2026 | Roof Manager', 'Average roof replacement cost by US state in 2026. Data sourced from contractor reports and national data. See your state.')}</head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-4xl font-black mb-6">Roof Replacement Cost by State — 2026</h1>
      <p class="text-xl text-blue-200 mb-8">The average cost to replace a roof on a 2,000 sq ft US home in 2026 ranges from $7,000 to $25,000 depending on state, materials, pitch, and local labor costs. Roof Manager helps contractors generate accurate material BOMs and take-offs that support transparent pricing for homeowners.</p>
      <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg inline-block">Start Free — Accurate BOMs in 60s</a>
    </div>
  </section>
  <section class="py-16" style="background:#111">
    <div class="max-w-6xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-8">Select Your State</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">${stateDirectory('roof-replacement-cost', 'Replacement Cost')}</div>
    </div>
  </section>
  ${footer()}</body></html>`
  return c.html(html)
})

app.get('/roof-replacement-cost/:state', (c) => {
  const stateSlug = c.req.param('state').toLowerCase()
  const state = US_STATES[stateSlug]
  if (!state) return c.redirect('/us/roof-replacement-cost')
  const cost = getStateCost(stateSlug)

  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head(`Roof Replacement Cost in ${state.name} 2026 | Roof Manager`, `Average roof replacement cost in ${state.name} in 2026. Material and labor breakdowns. Roof Manager helps contractors create accurate estimates.`, state.code)}
  <link rel="canonical" href="https://www.roofmanager.ca/us/roof-replacement-cost/${stateSlug}">
  </head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-4xl font-black mb-6">Roof Replacement Cost in <span class="text-sky-400">${state.name}</span> — 2026</h1>
      <p class="text-xl text-blue-200 mb-8">The average cost to replace a roof on a 2,000 sq ft home in ${state.name} ranges from <strong>$${cost.low.toLocaleString()}</strong> to <strong>$${cost.high.toLocaleString()}</strong>, with a midpoint of approximately <strong>$${cost.avg.toLocaleString()}</strong> as of 2026. Costs vary by material, pitch, and metro area. Roof Manager generates accurate material take-offs in under 60 seconds, helping ${state.code} contractors price jobs competitively.</p>
      <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg inline-block">Generate Accurate BOM (Free)</a>
    </div>
  </section>
  <section class="py-16" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black mb-8">Key Facts — ${state.name} Roof Replacement</h2>
      <ul class="space-y-3 text-gray-300">
        <li class="flex items-start gap-3"><i class="fas fa-check text-sky-400 mt-1"></i><span><strong>Low end:</strong> $${cost.low.toLocaleString()} for basic 3-tab shingle replacement on a simple gable roof</span></li>
        <li class="flex items-start gap-3"><i class="fas fa-check text-sky-400 mt-1"></i><span><strong>Average:</strong> $${cost.avg.toLocaleString()} for architectural shingles on a 2,000 sq ft home with moderate complexity</span></li>
        <li class="flex items-start gap-3"><i class="fas fa-check text-sky-400 mt-1"></i><span><strong>High end:</strong> $${cost.high.toLocaleString()} for premium materials (metal, tile, Class 4) or complex rooflines</span></li>
        <li class="flex items-start gap-3"><i class="fas fa-check text-sky-400 mt-1"></i><span><strong>Primary driver:</strong> ${state.stormProfile.primaryPeril} increases replacement demand and can qualify for insurance coverage</span></li>
        <li class="flex items-start gap-3"><i class="fas fa-check text-sky-400 mt-1"></i><span><strong>Code standard:</strong> ${state.buildingCode.adoptedIRC} — ${state.buildingCode.notes}</span></li>
      </ul>
      <p class="text-gray-400 text-sm mt-4">Source: National contractor survey data, Angi/HomeAdvisor published averages, and Roof Manager contractor-submitted data, as of 2026. Individual quotes may vary.</p>
    </div>
  </section>
  <div class="max-w-5xl mx-auto px-4 py-8">${inlineQuoteFormHTML('roof-cost-' + stateSlug)}</div>

  <section class="py-16 text-center" style="background:linear-gradient(135deg,#0c4a6e,#1e3a5f)">
    <div class="max-w-3xl mx-auto px-4">
      <h2 class="text-3xl font-black mb-4">Get Accurate ${state.name} Material Estimates</h2>
      <p class="text-blue-200 mb-8">Roof Manager generates a complete material BOM for any ${state.name} property in under 60 seconds. Free to start.</p>
      <a href="/customer/login" class="inline-block px-10 py-4 bg-white text-blue-700 font-black rounded-xl text-lg">Start Free — 3 Reports on Us</a>
    </div>
  </section>
  ${footer()}</body></html>`
  return c.html(html)
})

// ─── ROOF REPLACEMENT COST — CITY LEVEL ──────────────────────────────────────

app.get('/roof-replacement-cost/:state/:city', (c) => {
  const stateSlug = c.req.param('state').toLowerCase()
  const citySlug = c.req.param('city').toLowerCase()
  const state = US_STATES[stateSlug]
  if (!state) return c.redirect('/us/roof-replacement-cost')
  const city = US_CITIES.find(ci => ci.slug === citySlug && ci.stateSlug === stateSlug)
  if (!city) return c.redirect(`/us/roof-replacement-cost/${stateSlug}`)
  const base = getStateCost(stateSlug)
  const multiplier = city.population > 1000000 ? 1.10 : city.population > 500000 ? 1.05 : 1.0
  const cost = {
    low: Math.round(base.low * multiplier / 100) * 100,
    avg: Math.round(base.avg * multiplier / 100) * 100,
    high: Math.round(base.high * multiplier / 100) * 100,
  }
  const siblings = US_CITIES.filter(ci => ci.stateSlug === stateSlug && ci.slug !== citySlug).slice(0, 4)

  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head(`Roof Replacement Cost in ${city.name}, ${state.name} 2026 | Roof Manager`, `Average roof replacement cost in ${city.name}, ${state.code} in 2026. Ranges from $${cost.low.toLocaleString()} to $${cost.high.toLocaleString()}. Roof Manager helps ${city.name} contractors generate accurate estimates.`, state.code)}
  <link rel="canonical" href="https://www.roofmanager.ca/us/roof-replacement-cost/${stateSlug}/${citySlug}">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://www.roofmanager.ca/"},{"@type":"ListItem","position":2,"name":"Roof Replacement Cost","item":"https://www.roofmanager.ca/us/roof-replacement-cost"},{"@type":"ListItem","position":3,"name":"${state.name}","item":"https://www.roofmanager.ca/us/roof-replacement-cost/${stateSlug}"},{"@type":"ListItem","position":4,"name":"${city.name}","item":"https://www.roofmanager.ca/us/roof-replacement-cost/${stateSlug}/${citySlug}"}]}</script>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"How much does a roof replacement cost in ${city.name}?","acceptedAnswer":{"@type":"Answer","text":"The average roof replacement cost in ${city.name}, ${state.name} ranges from $${cost.low.toLocaleString()} to $${cost.high.toLocaleString()} for a 2,000 sq ft home in 2026, with a midpoint of approximately $${cost.avg.toLocaleString()}. Costs vary by material, pitch complexity, and local labor rates."}},{"@type":"Question","name":"What is the cheapest roof replacement option in ${city.name}?","acceptedAnswer":{"@type":"Answer","text":"The most affordable roof replacement in ${city.name} uses 3-tab asphalt shingles on a simple gable roof, typically starting around $${cost.low.toLocaleString()} for a 2,000 sq ft home. Architectural shingles average $${cost.avg.toLocaleString()}."}},{"@type":"Question","name":"Does ${city.name} weather affect roof replacement costs?","acceptedAnswer":{"@type":"Answer","text":"Yes. ${city.stormNarrative} This directly impacts replacement frequency and material specifications."}}]}</script>
  </head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <p class="text-sky-400 text-sm font-semibold mb-2 uppercase tracking-wider">${state.name} · Roof Replacement Cost</p>
      <h1 class="text-4xl font-black mb-6">Roof Replacement Cost in <span class="text-sky-400">${city.name}</span>, ${state.code} — 2026</h1>
      <p class="text-xl text-blue-200 mb-8">The average cost to replace a roof on a 2,000 sq ft home in ${city.name} ranges from <strong>$${cost.low.toLocaleString()}</strong> to <strong>$${cost.high.toLocaleString()}</strong>, with a midpoint of approximately <strong>$${cost.avg.toLocaleString()}</strong> as of 2026. Roof Manager generates accurate material take-offs in under 60 seconds, helping ${city.name} contractors price jobs competitively.</p>
      <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg inline-block">Generate Accurate BOM — Free</a>
    </div>
  </section>
  <section class="py-16" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <div class="grid md:grid-cols-3 gap-5 mb-10">
        <div class="bg-white/5 border border-white/10 rounded-xl p-6 text-center"><div class="text-3xl font-black text-sky-400 mb-1">$${cost.low.toLocaleString()}</div><div class="text-white font-semibold">Low Estimate</div><div class="text-gray-500 text-xs mt-1">3-tab shingle, simple gable</div></div>
        <div class="bg-white/5 rounded-xl p-6 text-center" style="border:1px solid rgba(56,189,248,0.4)"><div class="text-3xl font-black text-sky-400 mb-1">$${cost.avg.toLocaleString()}</div><div class="text-white font-semibold">Average Estimate</div><div class="text-gray-500 text-xs mt-1">Architectural shingle, moderate complexity</div></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6 text-center"><div class="text-3xl font-black text-sky-400 mb-1">$${cost.high.toLocaleString()}</div><div class="text-white font-semibold">High Estimate</div><div class="text-gray-500 text-xs mt-1">Premium materials or complex roofline</div></div>
      </div>
      <h2 class="text-2xl font-black mb-6">${city.name} Roofing Profile</h2>
      <ul class="space-y-3 text-gray-300 mb-6">
        <li class="flex items-start gap-3"><i class="fas fa-check text-sky-400 mt-1"></i><span><strong>Storm profile:</strong> ${city.stormNarrative}</span></li>
        <li class="flex items-start gap-3"><i class="fas fa-check text-sky-400 mt-1"></i><span><strong>Insurance landscape:</strong> ${city.insuranceNote}</span></li>
        <li class="flex items-start gap-3"><i class="fas fa-check text-sky-400 mt-1"></i><span><strong>Primary peril:</strong> ${state.stormProfile.primaryPeril} — can qualify replacement for insurance coverage</span></li>
        <li class="flex items-start gap-3"><i class="fas fa-check text-sky-400 mt-1"></i><span><strong>Building code:</strong> ${state.buildingCode.adoptedIRC} — ${state.buildingCode.notes}</span></li>
      </ul>
      <p class="text-gray-500 text-sm">Source: National contractor survey data, Angi/HomeAdvisor published averages, and Roof Manager contractor-submitted data, as of 2026. Estimates are for a 2,000 sq ft residential home. Individual quotes may vary.</p>
    </div>
  </section>
  ${siblings.length > 0 ? `<section class="py-12" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-xl font-bold mb-5">Other ${state.name} Cities</h2>
      <div class="flex flex-wrap gap-3">${siblings.map(sc => `<a href="/us/roof-replacement-cost/${sc.stateSlug}/${sc.slug}" class="px-4 py-2 rounded-lg text-sm font-medium text-sky-300 hover:text-white" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1)">${sc.name} →</a>`).join('')}</div>
    </div>
  </section>` : ''}
  <section class="py-16 text-center" style="background:linear-gradient(135deg,#0c4a6e,#1e3a5f)">
    <div class="max-w-3xl mx-auto px-4">
      <h2 class="text-3xl font-black mb-4">Get an Accurate ${city.name} Estimate</h2>
      <p class="text-blue-200 mb-8">Roof Manager generates a complete material BOM for any ${city.name} property in under 60 seconds. Free to start.</p>
      <a href="/customer/login" class="inline-block px-10 py-4 bg-white text-blue-700 font-black rounded-xl text-lg">Start Free — 3 Reports on Us</a>
    </div>
  </section>
  ${footer()}</body></html>`
  return c.html(html)
})

// ─── ROOFING CONTRACTORS ──────────────────────────────────────────────────────

app.get('/roofing-contractors', (c) => {
  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head('Best Roofing Software for US Contractors by State | Roof Manager', 'Roofing measurement and CRM software for contractors in all 50 US states. Compare Roof Manager vs EagleView, Hover, Roofr, and RoofSnap.')}</head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-4xl font-black mb-6">Best Roofing Software for US Contractors — 2026</h1>
      <p class="text-xl text-blue-200 mb-8">Roof Manager is the most affordable full-featured roofing software for US contractors. At $8 USD per report (vs $49–$95 for EagleView and Hover), Roof Manager gives contractors satellite measurements, full CRM, invoicing, and AI tools — all in one platform. Available in all 50 US states.</p>
      <div class="flex flex-col sm:flex-row gap-4 justify-center mb-8">
        <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg">Start Free (USD)</a>
        <a href="/cheaper-alternative-to-eagleview" class="px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl text-lg border border-white/20">vs EagleView →</a>
      </div>
    </div>
  </section>
  <section class="py-16" style="background:#111">
    <div class="max-w-6xl mx-auto px-4">
      <h2 class="text-2xl font-black text-center mb-8">Select Your State</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">${stateDirectory('roofing-contractors', 'Roofing Contractors')}</div>
    </div>
  </section>
  ${footer()}</body></html>`
  return c.html(html)
})

app.get('/roofing-contractors/:state', (c) => {
  const stateSlug = c.req.param('state').toLowerCase()
  const state = US_STATES[stateSlug]
  if (!state) return c.redirect('/us/roofing-contractors')

  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head(`Best Roofing Software for ${state.name} Contractors 2026 | Roof Manager`, `Roofing measurement and CRM software for ${state.name} contractors. Compare Roof Manager vs EagleView, Hover, Roofr. USD pricing.`, state.code)}
  <link rel="canonical" href="https://www.roofmanager.ca/us/roofing-contractors/${stateSlug}">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://www.roofmanager.ca/"},{"@type":"ListItem","position":2,"name":"Roofing Contractors","item":"https://www.roofmanager.ca/us/roofing-contractors"},{"@type":"ListItem","position":3,"name":"${state.name}","item":"https://www.roofmanager.ca/us/roofing-contractors/${stateSlug}"}]}</script>
  </head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-4xl font-black mb-6">Best Roofing Software for<br><span class="text-sky-400">${state.name}</span> Contractors — 2026</h1>
      <p class="text-xl text-blue-200 mb-8">${state.roofingNotes} Roof Manager is the most affordable full-featured roofing platform for ${state.code} contractors: $8 USD per satellite measurement report vs $49–$95 with EagleView. Includes full CRM, invoicing, proposals, and AI tools.</p>
      <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg inline-block">Start Free in ${state.name}</a>
    </div>
  </section>
  <section class="py-16" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black mb-8">Roof Manager vs Competitors — ${state.name}</h2>
      <div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b border-white/10"><th class="text-left py-3 pr-4 text-gray-400 font-semibold">Feature</th><th class="text-center py-3 px-4 text-sky-400 font-bold">Roof Manager</th><th class="text-center py-3 px-4 text-gray-400">EagleView</th><th class="text-center py-3 px-4 text-gray-400">Hover</th><th class="text-center py-3 px-4 text-gray-400">Roofr</th></tr></thead>
      <tbody class="divide-y divide-white/5">
        <tr><td class="py-3 pr-4 text-gray-300">Report Price (USD)</td><td class="text-center px-4 text-sky-400 font-bold">$8</td><td class="text-center px-4 text-gray-400">$49–$95</td><td class="text-center px-4 text-gray-400">$33–$55</td><td class="text-center px-4 text-gray-400">$15–$35</td></tr>
        <tr><td class="py-3 pr-4 text-gray-300">Free Reports</td><td class="text-center px-4 text-sky-400 font-bold">3 Free</td><td class="text-center px-4 text-gray-400">None</td><td class="text-center px-4 text-gray-400">None</td><td class="text-center px-4 text-gray-400">Limited</td></tr>
        <tr><td class="py-3 pr-4 text-gray-300">Full CRM Included</td><td class="text-center px-4 text-sky-400 font-bold">✓</td><td class="text-center px-4 text-gray-400">✗</td><td class="text-center px-4 text-gray-400">✗</td><td class="text-center px-4 text-gray-400">Partial</td></tr>
        <tr><td class="py-3 pr-4 text-gray-300">Invoicing &amp; Proposals</td><td class="text-center px-4 text-sky-400 font-bold">✓</td><td class="text-center px-4 text-gray-400">✗</td><td class="text-center px-4 text-gray-400">✗</td><td class="text-center px-4 text-gray-400">✓</td></tr>
        <tr><td class="py-3 pr-4 text-gray-300">AI Phone Secretary</td><td class="text-center px-4 text-sky-400 font-bold">✓</td><td class="text-center px-4 text-gray-400">✗</td><td class="text-center px-4 text-gray-400">✗</td><td class="text-center px-4 text-gray-400">✗</td></tr>
        <tr><td class="py-3 pr-4 text-gray-300">USD Pricing</td><td class="text-center px-4 text-sky-400 font-bold">✓</td><td class="text-center px-4 text-sky-400 font-bold">✓</td><td class="text-center px-4 text-sky-400 font-bold">✓</td><td class="text-center px-4 text-sky-400 font-bold">✓</td></tr>
      </tbody></table></div>
    </div>
  </section>
  <div class="max-w-5xl mx-auto px-4 py-8">${inlineQuoteFormHTML('contractors-' + stateSlug)}</div>

  <section class="py-16 text-center" style="background:linear-gradient(135deg,#0c4a6e,#1e3a5f)">
    <div class="max-w-3xl mx-auto px-4">
      <h2 class="text-3xl font-black mb-4">Switch to Roof Manager in ${state.name}</h2>
      <p class="text-blue-200 mb-8">Stop paying $49/report for EagleView. Get the same satellite data for $8 USD — plus a full CRM built for ${state.code} contractors.</p>
      <a href="/customer/login" class="inline-block px-10 py-4 bg-white text-blue-700 font-black rounded-xl text-lg">Start Free — 3 Reports on Us</a>
    </div>
  </section>
  ${footer()}</body></html>`
  return c.html(html)
})

export default app

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { comparisonLeadFormHTML } from '../lib/lead-forms'

const app = new Hono<{ Bindings: Bindings }>()

function head(title: string, desc: string) {
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
  <meta name="geo.region" content="US">`
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
      <p style="text-align:center;color:#6b7280;font-size:11px;margin-top:8px"><i class="fas fa-envelope" style="color:#00FF88;margin-right:4px"></i>Email: <a href="mailto:sales@roofmanager.ca" style="color:#00FF88">sales@roofmanager.ca</a></p>
    </div>
  </div>
</section>`
}

function footer() {
  return `${contactCTA('us-comparison')}
<footer style="background:#0A0A0A;border-top:1px solid rgba(255,255,255,0.06)" class="text-gray-500 py-10 text-center text-sm">
  <div class="max-w-4xl mx-auto px-4">
    <p class="text-gray-300 font-semibold mb-2">Roof Manager — The Affordable EagleView Alternative</p>
    <p>&copy; ${new Date().getFullYear()} Roof Manager. $10 CAD per satellite roof measurement report.</p>
    <div class="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1">
      <a href="/" class="hover:text-white">Home</a><a href="/pricing" class="hover:text-white">Pricing</a>
      <a href="/contact" class="hover:text-white">Contact</a>
      <a href="/cheaper-alternative-to-eagleview" class="hover:text-white">vs EagleView</a>
      <a href="/hover-alternative-us" class="hover:text-white">vs Hover</a>
      <a href="/roofr-alternative" class="hover:text-white">vs Roofr</a>
    </div>
  </div>
</footer>`
}

function comparisonTable(rows: Array<[string, string, string]>) {
  return `<div class="overflow-x-auto"><table class="w-full text-sm"><thead><tr class="border-b border-white/10">
    <th class="text-left py-3 pr-4 text-gray-400 font-semibold w-1/2">Feature</th>
    <th class="text-center py-3 px-4 text-sky-400 font-bold">Roof Manager</th>
    <th class="text-center py-3 px-4 text-gray-400">Competitor</th>
  </tr></thead><tbody class="divide-y divide-white/5">
  ${rows.map(([feat, rm, comp]) => `<tr><td class="py-3 pr-4 text-gray-300">${feat}</td><td class="text-center px-4 ${rm.startsWith('✓') || rm.includes('$8') || rm.includes('Free') ? 'text-sky-400 font-bold' : 'text-gray-300'}">${rm}</td><td class="text-center px-4 text-gray-400">${comp}</td></tr>`).join('')}
  </tbody></table></div>`
}

// ─── EAGLEVIEW vs ROOF MANAGER (US) ──────────────────────────────────────────

app.get('/eagleview-vs-roofmanager-us', (c) => {
  const rows: Array<[string, string, string]> = [
    ['Report Price (CAD)', '$10 per report', '$49–$95 per report'],
    ['Volume Pack Price', '$5.95/report (100-pack)', 'No volume pricing'],
    ['Free Reports', '4 free on signup', 'None'],
    ['Credit card required to start', 'No', 'Yes'],
    ['Report delivery', 'Email + dashboard', '2–4 hours'],
    ['Full CRM Included', '✓ Pipeline, jobs, contacts', '✗ Measurement only'],
    ['Invoicing & Proposals', '✓ Built-in', '✗ Not included'],
    ['AI Phone Secretary', '✓ 24/7 AI receptionist', '✗ Not included'],
    ['Insurance claim workflow', '✓ PDF accepted by adjusters', '✓ PDF accepted by adjusters'],
    ['Xactimate compatibility', '✓ Edge line items match', '✓ Native Xactimate export'],
    ['US-based support', 'Email/chat', 'Phone, email, dedicated rep'],
    ['Monthly subscription required', 'No — pay per report', 'Yes — $99+/mo'],
    ['Satellite data source', 'Google Solar API + LiDAR', 'Nearmap + proprietary'],
    ['Accuracy', '~99% vs manual', '~99% vs manual'],
    ['Mobile app', '✓ PWA, works on mobile', '✓ Native iOS/Android'],
  ]

  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head('EagleView vs Roof Manager 2026 — US Contractors | Comparison', 'EagleView vs Roof Manager comparison for US roofing contractors. EagleView costs $49–$95/report. Roof Manager costs $8. Same satellite accuracy, 6× cheaper. CAD pricing.')}
  <link rel="canonical" href="https://www.roofmanager.ca/eagleview-vs-roofmanager-us">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
    {"@type":"Question","name":"Is Roof Manager as accurate as EagleView?","acceptedAnswer":{"@type":"Answer","text":"Yes. Both Roof Manager and EagleView deliver approximately 99% accuracy compared to manual measurements. Roof Manager uses Google Solar API with LiDAR-calibrated 3D building models. EagleView uses its proprietary Nearmap imagery. Both produce pitch-corrected area calculations accepted by US insurance adjusters."}},
    {"@type":"Question","name":"How much cheaper is Roof Manager than EagleView?","acceptedAnswer":{"@type":"Answer","text":"EagleView charges $49–$95 per report depending on tier and report type. Roof Manager charges $10 per report (CAD) after 4 free reports. At 50 reports/month, that's $400 vs $2,450–$4,750 — a savings of over $2,000/month for a busy contractor."}},
    {"@type":"Question","name":"Does Roof Manager work for insurance claims like EagleView?","acceptedAnswer":{"@type":"Answer","text":"Yes. Roof Manager reports include pitch-corrected area, edge breakdowns, and material BOMs accepted by US insurance adjusters for storm, hail, and hurricane damage claims. EagleView has a longer track record with adjusters, but Roof Manager reports are increasingly accepted across all 50 states."}},
    {"@type":"Question","name":"What does EagleView have that Roof Manager doesn't?","acceptedAnswer":{"@type":"Answer","text":"EagleView has a longer market history, native Xactimate export, and dedicated enterprise account management. For high-volume commercial estimators and national insurance carriers, EagleView's integrations may be deeper. Roof Manager compensates with dramatically lower cost and an integrated CRM/invoicing platform that EagleView doesn't offer."}}
  ]}</script>
  </head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}

  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <span class="inline-block px-3 py-1 bg-sky-500/20 border border-sky-400/30 rounded-full text-xs text-sky-300 mb-4">US Contractor Comparison — 2026</span>
      <h1 class="text-4xl font-black mb-6">EagleView vs Roof Manager<br><span class="text-sky-400">for US Roofing Contractors</span></h1>
      <p class="text-xl text-blue-200 mb-4">EagleView charges $49–$95 per satellite roof measurement report. Roof Manager charges <strong>$10 CAD</strong> — the same satellite accuracy, 6–12× cheaper. At 50 reports per month, that's a savings of <strong>$2,000–$4,350/month</strong>.</p>
      <div class="flex flex-col sm:flex-row gap-4 justify-center mt-8">
        <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg">Try Roof Manager Free (3 Reports)</a>
        <a href="/pricing" class="px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl text-lg border border-white/20">View CAD Pricing</a>
      </div>
    </div>
  </section>

  <section class="py-16" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black mb-8">Full Comparison: EagleView vs Roof Manager</h2>
      ${comparisonTable(rows)}
    </div>
  </section>

  <section class="py-16" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black mb-8">Key Differences for US Contractors</h2>
      <div class="grid md:grid-cols-2 gap-6">
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-3 text-lg">Cost — The Most Important Factor</h3><p class="text-gray-300 text-sm leading-relaxed">EagleView's per-report cost ($49–$95) makes economic sense for contractors who order 1–5 reports per month. For contractors ordering 20+ reports per month, Roof Manager's $10/report pricing delivers $800–$1,700+ in monthly savings. At the 100-pack level ($5.95/report), a contractor ordering 100 reports saves over $4,300/month vs EagleView's base pricing.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-3 text-lg">Accuracy — Both Are Reliable</h3><p class="text-gray-300 text-sm leading-relaxed">Both EagleView and Roof Manager deliver approximately 99% accuracy compared to manual measurements. EagleView uses proprietary Nearmap imagery; Roof Manager uses Google Solar API with LiDAR-calibrated 3D building models. Both produce pitch-corrected area calculations that satisfy US insurance adjuster requirements.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-3 text-lg">Platform Completeness</h3><p class="text-gray-300 text-sm leading-relaxed">EagleView is a measurement-only tool. Roof Manager is an all-in-one platform: satellite measurements + full CRM + invoicing + proposals + AI phone secretary + job scheduling. Most US contractors pay separately for CRM software ($50–$200/mo), making Roof Manager's all-in cost significantly lower even at identical measurement prices.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-3 text-lg">Insurance Integration</h3><p class="text-gray-300 text-sm leading-relaxed">EagleView has decades of history with US insurance carriers and native Xactimate export. Roof Manager reports align pitch-corrected area with Xactimate F9 line items and edge categories. For most residential claims, both reports are accepted. For large commercial or CAT event claims where adjuster workflow integration matters, EagleView may have an edge.</p></div>
      </div>
    </div>
  </section>

  <section class="py-16" style="background:#111">
    <div class="max-w-4xl mx-auto px-4">
      <h2 class="text-2xl font-black mb-8">Frequently Asked Questions</h2>
      <div class="space-y-4">
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2">Is Roof Manager as accurate as EagleView?</h3><p class="text-gray-400 text-sm">Yes. Both deliver ~99% accuracy. Roof Manager uses Google Solar API LiDAR-calibrated 3D building models; EagleView uses Nearmap. Both produce pitch-corrected area accepted by US adjusters.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2">How much cheaper is Roof Manager than EagleView?</h3><p class="text-gray-400 text-sm">EagleView: $49–$95/report. Roof Manager: $10/report CAD after 4 free. At 50 reports/month: $400 vs $2,450–$4,750 — savings of $2,000–$4,350/month.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2">Does Roof Manager work for insurance claims?</h3><p class="text-gray-400 text-sm">Yes. Reports include pitch-corrected area, edge breakdowns, and material BOMs accepted by US adjusters for storm, hail, and hurricane claims across all 50 states.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2">Can I switch from EagleView to Roof Manager?</h3><p class="text-gray-400 text-sm">Yes. Start with 4 free reports to compare the output. Most EagleView users can port their workflow directly — the report format is similar and the PDF output is compatible with standard US adjuster documentation requirements.</p></div>
      </div>
    </div>
  </section>

  <div class="max-w-5xl mx-auto px-4 py-8">${comparisonLeadFormHTML('comparison-eagleview')}</div>

  <section class="py-16 text-center" style="background:linear-gradient(135deg,#0c4a6e,#1e3a5f)">
    <div class="max-w-3xl mx-auto px-4">
      <h2 class="text-3xl font-black mb-4">Stop Paying $49–$95/Report</h2>
      <p class="text-blue-200 mb-4">Get the same satellite accuracy as EagleView for $10 CAD. Plus a full CRM, invoicing, and AI tools — all included.</p>
      <p class="text-sky-300 text-sm mb-8">No credit card required · 4 free reports · Works in all 50 US states</p>
      <a href="/customer/login" class="inline-block px-10 py-4 bg-white text-blue-700 font-black rounded-xl text-lg">Start Free — 3 Reports on Us</a>
    </div>
  </section>

  <section class="py-8" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <p class="text-gray-500 text-xs font-semibold uppercase mb-3">Other Comparisons</p>
      <div class="flex flex-wrap gap-2">
        <a href="/hover-alternative-us" class="text-xs text-sky-400 bg-sky-400/10 border border-sky-400/20 rounded-full px-3 py-1">vs Hover</a>
        <a href="/roofr-alternative" class="text-xs text-sky-400 bg-sky-400/10 border border-sky-400/20 rounded-full px-3 py-1">vs Roofr</a>
        <a href="/roofsnap-vs-roofmanager" class="text-xs text-sky-400 bg-sky-400/10 border border-sky-400/20 rounded-full px-3 py-1">vs RoofSnap</a>
        <a href="/pitchgauge-vs-roofmanager" class="text-xs text-sky-400 bg-sky-400/10 border border-sky-400/20 rounded-full px-3 py-1">vs PitchGauge</a>
        <a href="/cheaper-alternative-to-eagleview" class="text-xs text-sky-400 bg-sky-400/10 border border-sky-400/20 rounded-full px-3 py-1">EagleView Alternative</a>
      </div>
    </div>
  </section>

  ${footer()}</body></html>`
  return c.html(html)
})

// ─── HOVER ALTERNATIVE (US) ──────────────────────────────────────────────────

app.get('/hover-alternative-us', (c) => {
  const rows: Array<[string, string, string]> = [
    ['Report Price (CAD)', '$10 per report', '$33–$55 per report'],
    ['Free Reports', '4 free on signup', 'None'],
    ['Monthly subscription', 'No — pay per report', '$149–$399/month'],
    ['Full CRM Included', '✓ Built-in', '✗ Measurement only'],
    ['Invoicing & Proposals', '✓ Built-in', '✗ Add-on'],
    ['AI Phone Secretary', '✓ 24/7', '✗'],
    ['Mobile photo measurement', '✗ Satellite only', '✓ Photo-based + satellite'],
    ['Report delivery', 'Email + dashboard', '1–3 hours'],
    ['US-based support', 'Email/chat', 'Phone + email'],
  ]
  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head('Hover Alternative for US Contractors 2026 | Roof Manager', 'Looking for a Hover alternative? Roof Manager costs $10/report vs Hover\'s $33–$55. Same accuracy, 4x cheaper. Full CRM included. CAD pricing.')}
  <link rel="canonical" href="https://www.roofmanager.ca/hover-alternative-us">
  </head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-4xl font-black mb-6">Hover Alternative for US Roofing Contractors</h1>
      <p class="text-xl text-blue-200 mb-8">Hover charges $33–$55 per report plus $149–$399/month in subscription fees. Roof Manager charges <strong>$10 CAD per report</strong> with no subscription. Get the same satellite accuracy, full CRM, invoicing, and AI tools — all in one platform for a fraction of Hover's cost.</p>
      <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg inline-block">Try Free — 3 Reports (CAD)</a>
    </div>
  </section>
  <section class="py-16" style="background:#111"><div class="max-w-5xl mx-auto px-4"><h2 class="text-2xl font-black mb-8">Hover vs Roof Manager</h2>${comparisonTable(rows)}</div></section>
  <div class="max-w-5xl mx-auto px-4 py-8">${comparisonLeadFormHTML('comparison-hover')}</div>

  <section class="py-16 text-center" style="background:linear-gradient(135deg,#0c4a6e,#1e3a5f)">
    <div class="max-w-3xl mx-auto px-4"><h2 class="text-3xl font-black mb-4">Switch from Hover and Save</h2>
    <p class="text-blue-200 mb-8">Roof Manager: $10/report, no subscription, full CRM included. Hover: $33–$55/report + $149–$399/month.</p>
    <a href="/customer/login" class="inline-block px-10 py-4 bg-white text-blue-700 font-black rounded-xl text-lg">Start Free — 3 Reports on Us</a></div>
  </section>
  <section class="py-8" style="background:#0d0d0d"><div class="max-w-5xl mx-auto px-4"><p class="text-gray-500 text-xs font-semibold uppercase mb-3">Other Comparisons</p><div class="flex flex-wrap gap-2"><a href="/eagleview-vs-roofmanager-us" class="text-xs text-sky-400 bg-sky-400/10 border border-sky-400/20 rounded-full px-3 py-1">vs EagleView</a><a href="/roofr-alternative" class="text-xs text-sky-400 bg-sky-400/10 border border-sky-400/20 rounded-full px-3 py-1">vs Roofr</a><a href="/pitchgauge-vs-roofmanager" class="text-xs text-sky-400 bg-sky-400/10 border border-sky-400/20 rounded-full px-3 py-1">vs PitchGauge</a></div></div></section>
  ${footer()}</body></html>`
  return c.html(html)
})

// ─── PITCHGAUGE vs ROOF MANAGER ───────────────────────────────────────────────

app.get('/pitchgauge-vs-roofmanager', (c) => {
  const rows: Array<[string, string, string]> = [
    ['Primary function', 'Full CRM + satellite measurement', 'Pitch measurement app'],
    ['Satellite roof area', '✓ Full satellite report', '✗ Manual pitch measurement only'],
    ['Material BOM', '✓ Full BOM generated', 'Limited — manual calculation'],
    ['Report Price (CAD)', '$10 per report', '$9.99–$14.99/month subscription'],
    ['Free Reports', '4 free on signup', 'Limited free tier'],
    ['Insurance documentation', '✓ Full PDF for adjusters', '✗ Not intended for insurance'],
    ['CRM / Pipeline', '✓ Full CRM', '✗ Not included'],
    ['Invoicing & Proposals', '✓ Built-in', '✗ Not included'],
    ['AI Phone Secretary', '✓ 24/7', '✗'],
    ['Report delivery', 'Email + dashboard', 'Real-time (manual measurement)'],
    ['Accuracy', '~99% vs manual', 'Depends on user technique'],
    ['Works without physical access', '✓ Satellite — no roof access needed', '✗ Must be on or near roof'],
  ]
  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head('PitchGauge vs Roof Manager 2026 | US Contractor Comparison', 'PitchGauge vs Roof Manager — which roofing tool is right for US contractors? PitchGauge measures pitch manually; Roof Manager generates full satellite reports with material BOM.')}
  <link rel="canonical" href="https://www.roofmanager.ca/pitchgauge-vs-roofmanager">
  </head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <span class="inline-block px-3 py-1 bg-sky-500/20 border border-sky-400/30 rounded-full text-xs text-sky-300 mb-4">US Contractor Comparison — 2026</span>
      <h1 class="text-4xl font-black mb-6">PitchGauge vs Roof Manager</h1>
      <p class="text-xl text-blue-200 mb-8">PitchGauge is a pitch measurement app that requires you to be on or near the roof. Roof Manager is a satellite-powered platform that measures the full roof — area, pitch, edges, material BOM — from your phone or truck without ever climbing on the roof. Different tools for different workflows.</p>
      <div class="flex flex-col sm:flex-row gap-4 justify-center">
        <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg">Try Roof Manager Free</a>
        <a href="/pricing" class="px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl text-lg border border-white/20">View CAD Pricing</a>
      </div>
    </div>
  </section>

  <section class="py-16" style="background:#111">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black mb-8">PitchGauge vs Roof Manager — Full Comparison</h2>
      ${comparisonTable(rows)}
    </div>
  </section>

  <section class="py-16" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black mb-8">When to Use Each Tool</h2>
      <div class="grid md:grid-cols-2 gap-6">
        <div class="bg-white/5 border border-white/10 rounded-xl p-6">
          <h3 class="font-bold text-sky-400 mb-3 text-lg">Use PitchGauge when...</h3>
          <ul class="space-y-2 text-gray-300 text-sm">
            <li class="flex items-start gap-2"><i class="fas fa-check text-sky-400 mt-0.5 text-xs"></i>You\'re physically on the roof and need an instant pitch reading</li>
            <li class="flex items-start gap-2"><i class="fas fa-check text-sky-400 mt-0.5 text-xs"></i>You only need pitch — not full area, edges, or material BOM</li>
            <li class="flex items-start gap-2"><i class="fas fa-check text-sky-400 mt-0.5 text-xs"></i>You already have a measurement tool and want a quick supplementary check</li>
          </ul>
        </div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6">
          <h3 class="font-bold text-sky-400 mb-3 text-lg">Use Roof Manager when...</h3>
          <ul class="space-y-2 text-gray-300 text-sm">
            <li class="flex items-start gap-2"><i class="fas fa-check text-sky-400 mt-0.5 text-xs"></i>You need full roof area, pitch, edges, and material BOM</li>
            <li class="flex items-start gap-2"><i class="fas fa-check text-sky-400 mt-0.5 text-xs"></i>You need insurance-ready documentation for a claim</li>
            <li class="flex items-start gap-2"><i class="fas fa-check text-sky-400 mt-0.5 text-xs"></i>You want to measure without physical roof access (safety, efficiency)</li>
            <li class="flex items-start gap-2"><i class="fas fa-check text-sky-400 mt-0.5 text-xs"></i>You need a full CRM, invoicing, and proposal workflow</li>
          </ul>
        </div>
      </div>
      <p class="text-gray-400 text-sm mt-6 text-center">Many US contractors use both: PitchGauge for quick on-site checks, Roof Manager for full measurement reports and insurance documentation.</p>
    </div>
  </section>

  <section class="py-16" style="background:#111">
    <div class="max-w-4xl mx-auto px-4">
      <h2 class="text-2xl font-black mb-8">FAQ — PitchGauge vs Roof Manager</h2>
      <div class="space-y-4">
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2">What does PitchGauge do that Roof Manager doesn\'t?</h3><p class="text-gray-400 text-sm">PitchGauge is a real-time pitch measurement app designed for use on the roof or near the roofline. It\'s ideal for instant pitch verification during an on-site inspection. Roof Manager doesn\'t have a real-time inclinometer tool — it generates satellite reports without requiring physical roof access.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2">What does Roof Manager do that PitchGauge doesn\'t?</h3><p class="text-gray-400 text-sm">Roof Manager generates complete satellite measurement reports — pitch-corrected area, edge breakdowns, material BOM, insurance-ready PDF — from anywhere. PitchGauge only measures pitch and requires physical proximity to the roof.</p></div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6"><h3 class="font-bold text-white mb-2">Can I use both PitchGauge and Roof Manager together?</h3><p class="text-gray-400 text-sm">Yes. Many contractors use Roof Manager for full satellite reports and use PitchGauge on-site for a quick sanity check or to confirm pitch on complex areas not fully captured by satellite data.</p></div>
      </div>
    </div>
  </section>

  <div class="max-w-5xl mx-auto px-4 py-8">${comparisonLeadFormHTML('comparison-pitchgauge')}</div>

  <section class="py-16 text-center" style="background:linear-gradient(135deg,#0c4a6e,#1e3a5f)">
    <div class="max-w-3xl mx-auto px-4">
      <h2 class="text-3xl font-black mb-4">Need Full Satellite Reports, Not Just Pitch?</h2>
      <p class="text-blue-200 mb-8">Roof Manager generates complete satellite reports — area, pitch, edges, BOM. $10 CAD per report. 4 free to start.</p>
      <a href="/customer/login" class="inline-block px-10 py-4 bg-white text-blue-700 font-black rounded-xl text-lg">Start Free — 3 Reports on Us</a>
    </div>
  </section>
  ${footer()}</body></html>`
  return c.html(html)
})

// ─── ROOFR vs ROOF MANAGER (US) ───────────────────────────────────────────────

app.get('/roofr-vs-roofmanager-us', (c) => {
  const rows: Array<[string, string, string]> = [
    ['Report Price (CAD)', '$10 per report', '$15–$35 per report'],
    ['Free Reports', '4 free on signup', 'Limited'],
    ['Monthly subscription', 'No subscription required', '$99–$299/month'],
    ['Full CRM Included', '✓ Built-in', '✓ Built-in (limited)'],
    ['Invoicing & Proposals', '✓ Full', '✓ Partial'],
    ['AI Phone Secretary', '✓ 24/7', '✗'],
    ['Insurance workflow', '✓ Adjuster-ready PDF', '✓ Adjuster-ready PDF'],
    ['Homeowner portal', 'Limited', '✓ Strong homeowner UI'],
    ['Financing integration', '✗', '✓ Built-in financing'],
    ['Report delivery', 'Email + dashboard', '1–2 hours'],
  ]
  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head('Roofr vs Roof Manager 2026 — US Contractors | Comparison', 'Roofr vs Roof Manager for US roofing contractors. Roofr costs $15–$35/report + monthly subscription. Roof Manager costs $10/report, no subscription.')}
  <link rel="canonical" href="https://www.roofmanager.ca/roofr-vs-roofmanager-us">
  </head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-4xl font-black mb-6">Roofr vs Roof Manager — US Contractors 2026</h1>
      <p class="text-xl text-blue-200 mb-8">Roofr charges $15–$35 per report plus $99–$299/month. Roof Manager charges <strong>$10 CAD per report with no subscription</strong>. Both offer satellite measurements and insurance-ready PDFs — but Roof Manager includes AI phone secretary and deeper CRM tools that Roofr charges extra for.</p>
      <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg inline-block">Try Free — 3 Reports (No Sub)</a>
    </div>
  </section>
  <section class="py-16" style="background:#111"><div class="max-w-5xl mx-auto px-4"><h2 class="text-2xl font-black mb-8">Roofr vs Roof Manager</h2>${comparisonTable(rows)}</div></section>
  <div class="max-w-5xl mx-auto px-4 py-8">${comparisonLeadFormHTML('comparison-roofr')}</div>
  <section class="py-16 text-center" style="background:linear-gradient(135deg,#0c4a6e,#1e3a5f)">
    <div class="max-w-3xl mx-auto px-4"><h2 class="text-3xl font-black mb-4">No Subscription. Just $10/Report.</h2>
    <p class="text-blue-200 mb-8">Try Roof Manager free and compare the output. 4 free reports, no credit card, no subscription required.</p>
    <a href="/customer/login" class="inline-block px-10 py-4 bg-white text-blue-700 font-black rounded-xl text-lg">Start Free — 3 Reports on Us</a></div>
  </section>
  <section class="py-8" style="background:#0d0d0d"><div class="max-w-5xl mx-auto px-4"><p class="text-gray-500 text-xs font-semibold uppercase mb-3">Other Comparisons</p><div class="flex flex-wrap gap-2"><a href="/eagleview-vs-roofmanager-us" class="text-xs text-sky-400 bg-sky-400/10 border border-sky-400/20 rounded-full px-3 py-1">vs EagleView</a><a href="/hover-alternative-us" class="text-xs text-sky-400 bg-sky-400/10 border border-sky-400/20 rounded-full px-3 py-1">vs Hover</a><a href="/pitchgauge-vs-roofmanager" class="text-xs text-sky-400 bg-sky-400/10 border border-sky-400/20 rounded-full px-3 py-1">vs PitchGauge</a></div></div></section>
  ${footer()}</body></html>`
  return c.html(html)
})

// ─── ROOFSNAP vs ROOF MANAGER (US) ────────────────────────────────────────────

app.get('/roofsnap-vs-roofmanager-us', (c) => {
  const rows: Array<[string, string, string]> = [
    ['Report Price (CAD)', '$10 per report', '$10–$25 per report'],
    ['Free Reports', '4 free on signup', 'None'],
    ['Monthly subscription', 'No subscription', '$89–$249/month'],
    ['Full CRM Included', '✓ Built-in', '✓ Limited'],
    ['Invoicing & Proposals', '✓ Full', '✓ Partial'],
    ['AI Phone Secretary', '✓ 24/7', '✗'],
    ['Insurance workflow', '✓ Adjuster-ready PDF', '✓ Adjuster-ready PDF'],
    ['Report delivery', 'Email + dashboard', '2–4 hours'],
  ]
  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head('RoofSnap vs Roof Manager 2026 — US Comparison | Roof Manager', 'RoofSnap vs Roof Manager for US contractors. RoofSnap: $10–$25/report + $89–$249/month subscription. Roof Manager: $10/report, no subscription.')}
  <link rel="canonical" href="https://www.roofmanager.ca/roofsnap-vs-roofmanager-us">
  </head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-4xl font-black mb-6">RoofSnap vs Roof Manager — US Contractors 2026</h1>
      <p class="text-xl text-blue-200 mb-8">RoofSnap charges $10–$25 per report plus $89–$249/month subscription. Roof Manager charges <strong>$10 CAD per report, no subscription</strong>. Both are solid measurement tools — but Roof Manager includes CRM, invoicing, and AI phone secretary that RoofSnap charges separately for.</p>
      <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg inline-block">Try Free — 3 Reports</a>
    </div>
  </section>
  <section class="py-16" style="background:#111"><div class="max-w-5xl mx-auto px-4"><h2 class="text-2xl font-black mb-8">RoofSnap vs Roof Manager</h2>${comparisonTable(rows)}</div></section>
  <div class="max-w-5xl mx-auto px-4 py-8">${comparisonLeadFormHTML('comparison-roofsnap')}</div>
  <section class="py-16 text-center" style="background:linear-gradient(135deg,#0c4a6e,#1e3a5f)">
    <div class="max-w-3xl mx-auto px-4"><h2 class="text-3xl font-black mb-4">Switch from RoofSnap and Save</h2>
    <p class="text-blue-200 mb-8">$10/report. No subscription. Full CRM included. 4 free to try.</p>
    <a href="/customer/login" class="inline-block px-10 py-4 bg-white text-blue-700 font-black rounded-xl text-lg">Start Free — 3 Reports on Us</a></div>
  </section>
  ${footer()}</body></html>`
  return c.html(html)
})

// ─── ROOFLINK vs ROOF MANAGER ─────────────────────────────────────────────────

app.get('/rooflink-vs-roofmanager', (c) => {
  const rows: Array<[string, string, string]> = [
    ['Primary function', 'Full CRM + satellite measurement + AI secretary', 'Roofing CRM + sales pipeline'],
    ['Satellite roof measurement', '✓ Built-in, $10/report', '✗ Not included — requires separate tool'],
    ['Material BOM', '✓ Generated from measurement', '✗ Not included'],
    ['Monthly subscription (CAD)', 'No subscription', '$99–$349/month'],
    ['Per-user pricing', 'Flat pricing', '$99+/user/month'],
    ['Free Reports', '4 free measurement reports', 'Limited trial'],
    ['Invoicing & Proposals', '✓ Full, built-in', '✓ Full'],
    ['AI Phone Secretary', '✓ 24/7', '✗'],
    ['Insurance workflow', '✓ Adjuster-ready PDF', 'Partial — via integrations'],
    ['Report delivery (measurement)', 'Email + dashboard', 'N/A — external'],
    ['Mobile app', '✓ PWA', '✓ iOS/Android native'],
  ]
  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head('RoofLink vs Roof Manager 2026 — US Contractor Comparison', 'RoofLink vs Roof Manager for US roofing contractors. RoofLink is a CRM at $99–$349/month per user. Roof Manager includes CRM, satellite measurement, invoicing, and AI secretary.')}
  <link rel="canonical" href="https://www.roofmanager.ca/rooflink-vs-roofmanager">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
    {"@type":"Question","name":"Does RoofLink include satellite roof measurement?","acceptedAnswer":{"@type":"Answer","text":"RoofLink is primarily a roofing CRM and sales pipeline tool. It does not generate satellite roof measurement reports natively. Contractors typically pair RoofLink with a separate measurement provider like EagleView or Hover. Roof Manager combines CRM, measurement, invoicing, and AI secretary in one platform."}},
    {"@type":"Question","name":"Which is cheaper: RoofLink or Roof Manager?","acceptedAnswer":{"@type":"Answer","text":"RoofLink charges $99–$349 per user per month. A 5-user team on RoofLink plus separate measurement software can exceed $1,000/month. Roof Manager has flat pricing with $8 per measurement report and no per-user seat fees — typically a fraction of the combined RoofLink + measurement cost."}}
  ]}</script>
  </head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <span class="inline-block px-3 py-1 bg-sky-500/20 border border-sky-400/30 rounded-full text-xs text-sky-300 mb-4">US Contractor Comparison — 2026</span>
      <h1 class="text-4xl font-black mb-6">RoofLink vs Roof Manager</h1>
      <p class="text-xl text-blue-200 mb-8">RoofLink is a roofing CRM priced at <strong>$99–$349/user/month</strong>. Most RoofLink users still pay separately for measurement software. Roof Manager combines the roof measurement report, CRM, invoicing, proposals, and AI phone secretary in one platform with no per-user fees.</p>
      <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg inline-block">Try Free — 4 Reports (No Card)</a>
    </div>
  </section>
  <section class="py-16" style="background:#111"><div class="max-w-5xl mx-auto px-4"><h2 class="text-2xl font-black mb-8">RoofLink vs Roof Manager</h2>${comparisonTable(rows)}</div></section>
  <section class="py-16" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black mb-8">When Each Tool Makes Sense</h2>
      <div class="grid md:grid-cols-2 gap-6">
        <div class="bg-white/5 border border-white/10 rounded-xl p-6">
          <h3 class="font-bold text-sky-400 mb-3 text-lg">Use RoofLink when...</h3>
          <ul class="space-y-2 text-gray-300 text-sm">
            <li class="flex items-start gap-2"><i class="fas fa-check text-sky-400 mt-0.5 text-xs"></i>Your team is 10+ sales reps with complex door-knocking workflows</li>
            <li class="flex items-start gap-2"><i class="fas fa-check text-sky-400 mt-0.5 text-xs"></i>You already have a measurement vendor and want a best-in-class CRM</li>
            <li class="flex items-start gap-2"><i class="fas fa-check text-sky-400 mt-0.5 text-xs"></i>You need deep D2D canvassing + territory management features</li>
          </ul>
        </div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6">
          <h3 class="font-bold text-sky-400 mb-3 text-lg">Use Roof Manager when...</h3>
          <ul class="space-y-2 text-gray-300 text-sm">
            <li class="flex items-start gap-2"><i class="fas fa-check text-sky-400 mt-0.5 text-xs"></i>You want measurement, CRM, invoicing, and AI secretary in one tool</li>
            <li class="flex items-start gap-2"><i class="fas fa-check text-sky-400 mt-0.5 text-xs"></i>You want flat pricing with no per-user seat fees</li>
            <li class="flex items-start gap-2"><i class="fas fa-check text-sky-400 mt-0.5 text-xs"></i>You generate more than 10 roof measurement reports per month</li>
          </ul>
        </div>
      </div>
    </div>
  </section>
  <div class="max-w-5xl mx-auto px-4 py-8">${comparisonLeadFormHTML('comparison-rooflink')}</div>
  <section class="py-16 text-center" style="background:linear-gradient(135deg,#0c4a6e,#1e3a5f)">
    <div class="max-w-3xl mx-auto px-4"><h2 class="text-3xl font-black mb-4">One Platform Instead of Three</h2>
    <p class="text-blue-200 mb-8">Roof Manager bundles measurement, CRM, invoicing, and AI secretary. No per-user fees. 4 free reports to try.</p>
    <a href="/customer/login" class="inline-block px-10 py-4 bg-white text-blue-700 font-black rounded-xl text-lg">Start Free — 4 Reports on Us</a></div>
  </section>
  ${footer()}</body></html>`
  return c.html(html)
})

// ─── iROOFING vs ROOF MANAGER ─────────────────────────────────────────────────

app.get('/iroofing-vs-roofmanager', (c) => {
  const rows: Array<[string, string, string]> = [
    ['Report Price (CAD)', '$10 per report', '$29–$59 per report'],
    ['Free Reports', '4 free on signup', 'Limited trial'],
    ['Monthly subscription', 'No subscription', '$99–$199/month'],
    ['Satellite data source', 'Google Solar API + LiDAR', 'Nearmap + proprietary'],
    ['Accuracy', '~99% vs manual', '~99% vs manual'],
    ['Report delivery', 'Email + dashboard', '1–2 hours'],
    ['Full CRM Included', '✓ Built-in', '✗ Measurement only'],
    ['Invoicing & Proposals', '✓ Built-in', '✗ Add-on'],
    ['AI Phone Secretary', '✓ 24/7', '✗'],
    ['3D roof visualization', '✓ 3D viewer', '✓ 3D viewer'],
    ['Mobile app', '✓ PWA', '✓ Native iOS/Android'],
  ]
  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head('iRoofing vs Roof Manager 2026 — US Comparison', 'iRoofing vs Roof Manager for US contractors. iRoofing: $29–$59/report + $99–$199/month. Roof Manager: $10/report, no subscription, full CRM included.')}
  <link rel="canonical" href="https://www.roofmanager.ca/iroofing-vs-roofmanager">
  </head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-4xl font-black mb-6">iRoofing vs Roof Manager — US Contractors</h1>
      <p class="text-xl text-blue-200 mb-8">iRoofing charges $29–$59 per report plus $99–$199/month subscription. Roof Manager charges <strong>$10 CAD per report with no subscription</strong> and includes a full CRM, invoicing, proposals, and 24/7 AI phone secretary.</p>
      <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg inline-block">Try Free — 4 Reports</a>
    </div>
  </section>
  <section class="py-16" style="background:#111"><div class="max-w-5xl mx-auto px-4"><h2 class="text-2xl font-black mb-8">iRoofing vs Roof Manager</h2>${comparisonTable(rows)}</div></section>
  <div class="max-w-5xl mx-auto px-4 py-8">${comparisonLeadFormHTML('comparison-iroofing')}</div>
  <section class="py-16 text-center" style="background:linear-gradient(135deg,#0c4a6e,#1e3a5f)">
    <div class="max-w-3xl mx-auto px-4"><h2 class="text-3xl font-black mb-4">Same Satellite Accuracy for a Quarter of the Price</h2>
    <p class="text-blue-200 mb-8">$10/report. No subscription. Full CRM. 4 free reports to start.</p>
    <a href="/customer/login" class="inline-block px-10 py-4 bg-white text-blue-700 font-black rounded-xl text-lg">Start Free — 4 Reports on Us</a></div>
  </section>
  ${footer()}</body></html>`
  return c.html(html)
})

// ─── COMPANYCAM vs ROOF MANAGER ───────────────────────────────────────────────

app.get('/companycam-vs-roofmanager', (c) => {
  const rows: Array<[string, string, string]> = [
    ['Primary function', 'Roof measurement + CRM + secretary', 'Photo documentation + job tracking'],
    ['Satellite roof measurement', '✓ $10/report', '✗ Not included'],
    ['Material BOM', '✓ Generated from measurement', '✗ Not included'],
    ['Per-user subscription', 'No per-user fee', '$24–$59/user/month'],
    ['Photo documentation', 'Report attachments only', '✓ Unlimited photos, GPS tagged'],
    ['Time-stamped photos for insurance', 'Limited', '✓ Industry-leading'],
    ['Full CRM / pipeline', '✓ Built-in', '✓ Project-level'],
    ['Invoicing & Proposals', '✓ Built-in', '✗'],
    ['AI Phone Secretary', '✓ 24/7', '✗'],
    ['Xactimate integration', 'Pitch-corrected output aligns with F9', 'Photo reports exportable'],
  ]
  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head('CompanyCam vs Roof Manager 2026 — Which Tool for US Roofers?', 'CompanyCam vs Roof Manager comparison. CompanyCam is photo documentation ($24–$59/user). Roof Manager is measurement + CRM ($10/report, flat). Many contractors use both.')}
  <link rel="canonical" href="https://www.roofmanager.ca/companycam-vs-roofmanager">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
    {"@type":"Question","name":"Is CompanyCam a competitor to Roof Manager?","acceptedAnswer":{"@type":"Answer","text":"Not directly. CompanyCam is a photo-documentation platform: GPS-tagged, time-stamped photos for insurance and project documentation. Roof Manager generates satellite-powered roof measurement reports and includes CRM, invoicing, and an AI phone secretary. Many roofing contractors use both: CompanyCam for on-site photos and Roof Manager for the measurement report and back-office workflow."}},
    {"@type":"Question","name":"Can I replace CompanyCam with Roof Manager?","acceptedAnswer":{"@type":"Answer","text":"Only if your primary need is measurement reports and back-office workflow. If you rely on CompanyCam for extensive on-site photo documentation with GPS and time-stamping for insurance, that is CompanyCam\\'s core strength and Roof Manager is not a direct replacement for it."}}
  ]}</script>
  </head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <h1 class="text-4xl font-black mb-6">CompanyCam vs Roof Manager</h1>
      <p class="text-xl text-blue-200 mb-8">Different tools for different problems. CompanyCam is the gold standard for GPS-tagged, time-stamped on-site photo documentation ($24–$59/user/month). Roof Manager generates satellite roof measurement reports and runs your back office ($10/report, no per-user fees). Many US contractors use both.</p>
      <div class="flex flex-col sm:flex-row gap-4 justify-center">
        <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg">Try Roof Manager Free</a>
      </div>
    </div>
  </section>
  <section class="py-16" style="background:#111"><div class="max-w-5xl mx-auto px-4"><h2 class="text-2xl font-black mb-8">CompanyCam vs Roof Manager — What Each Does Best</h2>${comparisonTable(rows)}</div></section>
  <section class="py-16" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black mb-8">Should You Use Both?</h2>
      <p class="text-gray-300 leading-relaxed max-w-3xl">Many US roofing contractors do. CompanyCam handles field photo documentation — ladder shots, damage close-ups, completion photos — all GPS-tagged and time-stamped for adjusters. Roof Manager handles the measurement report, material BOM, customer CRM, invoicing, proposals, and inbound phone calls. The two tools do not overlap meaningfully and together cover the full field-to-office workflow for roofing claims and retail estimates.</p>
    </div>
  </section>
  <div class="max-w-5xl mx-auto px-4 py-8">${comparisonLeadFormHTML('comparison-companycam')}</div>
  <section class="py-16 text-center" style="background:linear-gradient(135deg,#0c4a6e,#1e3a5f)">
    <div class="max-w-3xl mx-auto px-4"><h2 class="text-3xl font-black mb-4">Add Roof Manager to Your Stack</h2>
    <p class="text-blue-200 mb-8">4 free measurement reports. No credit card. Pairs cleanly with CompanyCam workflows.</p>
    <a href="/customer/login" class="inline-block px-10 py-4 bg-white text-blue-700 font-black rounded-xl text-lg">Start Free — 4 Reports on Us</a></div>
  </section>
  ${footer()}</body></html>`
  return c.html(html)
})

// ─── JOBNIMBUS vs ROOF MANAGER ────────────────────────────────────────────────

app.get('/jobnimbus-vs-roofmanager', (c) => {
  const rows: Array<[string, string, string]> = [
    ['Primary function', 'Roof measurement + CRM + secretary', 'Contractor CRM + project management'],
    ['Satellite roof measurement', '✓ Built-in, $10/report', '✗ Via EagleView integration only'],
    ['Measurement add-on cost', 'Included', 'EagleView: $49–$95/report extra'],
    ['Monthly subscription (CAD)', 'No subscription', '$25–$75/user/month'],
    ['Free trial', '4 free measurement reports', '14-day trial'],
    ['Pipeline / Kanban boards', '✓ Built-in', '✓ Industry-leading Kanban'],
    ['Work orders & scheduling', '✓ Built-in', '✓ Strong field-ops features'],
    ['Invoicing & Proposals', '✓ Built-in', '✓ Built-in'],
    ['AI Phone Secretary', '✓ 24/7', '✗'],
    ['QuickBooks integration', 'Export supported', '✓ Native two-way sync'],
    ['Mobile app', '✓ PWA', '✓ Native iOS/Android'],
  ]
  const html = `<!DOCTYPE html><html lang="en-US"><head>
  ${head('JobNimbus vs Roof Manager 2026 — US Contractor Comparison', 'JobNimbus vs Roof Manager for US roofing contractors. JobNimbus is a contractor CRM ($25–$75/user). Roof Manager includes measurement + CRM + AI secretary for flat pricing.')}
  <link rel="canonical" href="https://www.roofmanager.ca/jobnimbus-vs-roofmanager">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[
    {"@type":"Question","name":"Does JobNimbus include roof measurement?","acceptedAnswer":{"@type":"Answer","text":"JobNimbus does not generate satellite roof measurement reports natively. It integrates with EagleView, where contractors pay $49–$95 per report on top of JobNimbus subscription fees. Roof Manager includes satellite measurement at $10 per report with no per-user fees."}},
    {"@type":"Question","name":"Which is better for a 3-person roofing company: JobNimbus or Roof Manager?","acceptedAnswer":{"@type":"Answer","text":"For a 3-person shop, JobNimbus runs roughly $75–$225/month plus $49–$95/measurement (10 reports = $490–$950). Roof Manager costs ~$80/month for the same 10 reports with no per-user fees and includes an AI phone secretary. JobNimbus wins on native QuickBooks sync and Kanban depth; Roof Manager wins on total cost and bundled AI secretary."}}
  ]}</script>
  </head>
  <body class="min-h-screen" style="background:#0A0A0A;color:#fff">${nav()}
  <section class="py-20 text-center" style="background:linear-gradient(135deg,#0f172a,#1e3a5f)">
    <div class="max-w-4xl mx-auto px-4">
      <span class="inline-block px-3 py-1 bg-sky-500/20 border border-sky-400/30 rounded-full text-xs text-sky-300 mb-4">US Contractor Comparison — 2026</span>
      <h1 class="text-4xl font-black mb-6">JobNimbus vs Roof Manager</h1>
      <p class="text-xl text-blue-200 mb-8">JobNimbus is a contractor CRM at <strong>$25–$75 per user per month</strong>, with measurement reports sold separately via EagleView ($49–$95 each). Roof Manager includes the roof measurement report, CRM, invoicing, proposals, and AI phone secretary at flat pricing — $10 per report with no per-user fees.</p>
      <a href="/customer/login" class="px-8 py-4 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg inline-block">Try Free — 4 Reports</a>
    </div>
  </section>
  <section class="py-16" style="background:#111"><div class="max-w-5xl mx-auto px-4"><h2 class="text-2xl font-black mb-8">JobNimbus vs Roof Manager</h2>${comparisonTable(rows)}</div></section>
  <section class="py-16" style="background:#0d0d0d">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black mb-8">When Each Tool Is the Right Choice</h2>
      <div class="grid md:grid-cols-2 gap-6">
        <div class="bg-white/5 border border-white/10 rounded-xl p-6">
          <h3 class="font-bold text-sky-400 mb-3 text-lg">Use JobNimbus when...</h3>
          <ul class="space-y-2 text-gray-300 text-sm">
            <li class="flex items-start gap-2"><i class="fas fa-check text-sky-400 mt-0.5 text-xs"></i>You rely heavily on native QuickBooks two-way sync</li>
            <li class="flex items-start gap-2"><i class="fas fa-check text-sky-400 mt-0.5 text-xs"></i>You have complex multi-phase production workflows</li>
            <li class="flex items-start gap-2"><i class="fas fa-check text-sky-400 mt-0.5 text-xs"></i>You have dedicated office staff who can absorb the higher cost</li>
          </ul>
        </div>
        <div class="bg-white/5 border border-white/10 rounded-xl p-6">
          <h3 class="font-bold text-sky-400 mb-3 text-lg">Use Roof Manager when...</h3>
          <ul class="space-y-2 text-gray-300 text-sm">
            <li class="flex items-start gap-2"><i class="fas fa-check text-sky-400 mt-0.5 text-xs"></i>You want measurement bundled at $10/report instead of $49–$95</li>
            <li class="flex items-start gap-2"><i class="fas fa-check text-sky-400 mt-0.5 text-xs"></i>You want to eliminate per-user subscription fees</li>
            <li class="flex items-start gap-2"><i class="fas fa-check text-sky-400 mt-0.5 text-xs"></i>You want an AI phone secretary handling missed calls 24/7</li>
          </ul>
        </div>
      </div>
    </div>
  </section>
  <div class="max-w-5xl mx-auto px-4 py-8">${comparisonLeadFormHTML('comparison-jobnimbus')}</div>
  <section class="py-16 text-center" style="background:linear-gradient(135deg,#0c4a6e,#1e3a5f)">
    <div class="max-w-3xl mx-auto px-4"><h2 class="text-3xl font-black mb-4">Stop Paying $49–$95 for Measurement Reports</h2>
    <p class="text-blue-200 mb-8">Get the same accuracy for $10 CAD — plus CRM, invoicing, and AI secretary included.</p>
    <a href="/customer/login" class="inline-block px-10 py-4 bg-white text-blue-700 font-black rounded-xl text-lg">Start Free — 4 Reports on Us</a></div>
  </section>
  ${footer()}</body></html>`
  return c.html(html)
})

export default app

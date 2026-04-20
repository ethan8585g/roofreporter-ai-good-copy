// ============================================================
// Shared Lead Capture Form HTML Helpers
// Used across US state/city pages, comparison pages, verticals
// All forms POST to /api/agents/leads with source tracking
// ============================================================

/** Inline form submission JS — shared by all lead forms. Returns a self-executing async handler string. */
function formSubmitJS(formId: string): string {
  return `return (async function(e){e.preventDefault();if(e.target.querySelector('[name=website]').value)return false;var b=e.target.querySelector('button[type=submit]');b.disabled=true;b.innerHTML='<i class=\"fas fa-spinner fa-spin\"></i> Sending...';try{var utm=new URLSearchParams(location.search).get('utm_source')||sessionStorage.getItem('_rm_utm_source')||'';var r=await fetch('/api/agents/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:e.target.n?e.target.n.value:'',email:e.target.e.value,phone:e.target.p?e.target.p.value:'',address:e.target.a?e.target.a.value:'',message:e.target.m?e.target.m.value:'',source_page:e.target.src.value,utm_source:utm})});var d=await r.json();if(d.success||r.ok){e.target.innerHTML='<div style=\"text-align:center;padding:24px\"><div style=\"width:48px;height:48px;background:#00FF88;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px\"><i class=\"fas fa-check\" style=\"color:#0A0A0A;font-size:20px\"></i></div><p style=\"color:#00FF88;font-weight:700;font-size:16px;margin:0 0 4px\">Thank you!</p><p style=\"color:#9ca3af;font-size:13px;margin:0\">We\\'ll be in touch shortly.</p></div>';if(typeof window.fireMetaLeadEvent==='function')window.fireMetaLeadEvent({content_name:e.target.src.value});return}b.disabled=false;b.textContent='Send'}catch(x){b.disabled=false;b.textContent='Send'}return false})(event)`
}

/** Honeypot field — hidden from humans, catches bots */
const honeypot = `<input name="website" style="position:absolute;left:-9999px;opacity:0" tabindex="-1" autocomplete="off">`

/**
 * Inline quote form — 4 fields (name, email, phone, address)
 * Used on US state/city pages and non-storm vertical pages
 */
export function inlineQuoteFormHTML(source: string): string {
  const fid = 'iqf-' + source.replace(/[^a-z0-9]/gi, '')
  return `<section style="background:linear-gradient(135deg,#0d1117,#111827);border:1px solid rgba(0,255,136,0.15);border-radius:20px;padding:32px;margin:32px auto;max-width:640px">
  <div style="text-align:center;margin-bottom:20px">
    <span style="display:inline-block;background:rgba(0,255,136,0.1);color:#00FF88;font-size:11px;font-weight:700;padding:5px 14px;border-radius:999px;letter-spacing:0.5px"><i class="fas fa-satellite" style="margin-right:6px"></i>FREE ROOF QUOTE</span>
    <h3 style="color:#fff;font-size:22px;font-weight:800;margin:10px 0 4px">Get Your Free Roof Measurement</h3>
    <p style="color:#9ca3af;font-size:13px;margin:0">Satellite-powered report in under 60 seconds. No site visit needed.</p>
  </div>
  <form id="${fid}" onsubmit="${formSubmitJS(fid)}" style="position:relative">
    <input type="hidden" name="src" value="${source}">
    ${honeypot}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <input name="n" required placeholder="Your name" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;width:100%;box-sizing:border-box">
      <input name="e" type="email" required placeholder="Email address" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;width:100%;box-sizing:border-box">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <input name="p" type="tel" placeholder="Phone (optional)" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;width:100%;box-sizing:border-box">
      <input name="a" placeholder="Property address" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;width:100%;box-sizing:border-box">
    </div>
    <button type="submit" style="width:100%;background:#00FF88;color:#0A0A0A;font-weight:800;padding:14px;border:none;border-radius:10px;font-size:15px;cursor:pointer;transition:background 0.2s" onmouseover="this.style.background='#00e67a'" onmouseout="this.style.background='#00FF88'"><i class="fas fa-bolt" style="margin-right:6px"></i>Get Free Quote</button>
  </form>
  <p style="text-align:center;color:#6b7280;font-size:11px;margin-top:8px"><i class="fas fa-lock" style="color:#00FF88;margin-right:4px"></i>No credit card required &middot; Results in 60 seconds</p>
</section>`
}

/**
 * Comparison page lead form — email, phone, address
 * "See how your roof compares" messaging
 */
export function comparisonLeadFormHTML(source: string): string {
  const fid = 'clf-' + source.replace(/[^a-z0-9]/gi, '')
  return `<section style="background:linear-gradient(135deg,#0d1117,#0f172a);border:1px solid rgba(56,189,248,0.15);border-radius:20px;padding:32px;margin:48px auto;max-width:600px">
  <div style="text-align:center;margin-bottom:20px">
    <span style="display:inline-block;background:rgba(56,189,248,0.1);color:#38bdf8;font-size:11px;font-weight:700;padding:5px 14px;border-radius:999px;letter-spacing:0.5px"><i class="fas fa-chart-bar" style="margin-right:6px"></i>FREE COMPARISON</span>
    <h3 style="color:#fff;font-size:22px;font-weight:800;margin:10px 0 4px">See How Your Roof Compares</h3>
    <p style="color:#9ca3af;font-size:13px;margin:0">Enter your property address for a free satellite measurement report.</p>
  </div>
  <form id="${fid}" onsubmit="${formSubmitJS(fid)}" style="position:relative">
    <input type="hidden" name="src" value="${source}">
    ${honeypot}
    <input name="e" type="email" required placeholder="Email address" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;width:100%;box-sizing:border-box;margin-bottom:10px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <input name="p" type="tel" placeholder="Phone (optional)" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;width:100%;box-sizing:border-box">
      <input name="a" placeholder="Property address" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;width:100%;box-sizing:border-box">
    </div>
    <button type="submit" style="width:100%;background:#38bdf8;color:#0A0A0A;font-weight:800;padding:14px;border:none;border-radius:10px;font-size:15px;cursor:pointer;transition:background 0.2s" onmouseover="this.style.background='#7dd3fc'" onmouseout="this.style.background='#38bdf8'"><i class="fas fa-satellite-dish" style="margin-right:6px"></i>Get Free Report</button>
  </form>
  <p style="text-align:center;color:#6b7280;font-size:11px;margin-top:8px"><i class="fas fa-clock" style="color:#38bdf8;margin-right:4px"></i>Results delivered in under 60 seconds</p>
</section>`
}

/**
 * Damage assessment form — urgent styling for storm/hail/hurricane pages
 * Orange/red gradient with urgency messaging
 */
export function damageAssessmentFormHTML(source: string, perilType: string): string {
  const fid = 'daf-' + source.replace(/[^a-z0-9]/gi, '')
  const perilLabels: Record<string, { title: string; sub: string; icon: string }> = {
    storm: { title: 'Get Your Storm Damage Assessment', sub: 'Document damage fast — most insurance policies require claims within 60 days.', icon: 'fa-cloud-showers-heavy' },
    hail: { title: 'Get Your Hail Damage Assessment', sub: 'Hail damage is often invisible from the ground. Get a satellite assessment now.', icon: 'fa-cloud-meatball' },
    hurricane: { title: 'Get Your Hurricane Damage Assessment', sub: 'Act fast — insurance adjusters are already in your area. Get your report first.', icon: 'fa-hurricane' },
  }
  const p = perilLabels[perilType] || perilLabels.storm
  return `<section style="background:linear-gradient(135deg,#451a03,#7c2d12,#431407);border:2px solid rgba(251,146,60,0.3);border-radius:20px;padding:32px;margin:32px auto;max-width:640px">
  <div style="text-align:center;margin-bottom:20px">
    <span style="display:inline-block;background:rgba(251,146,60,0.15);color:#fb923c;font-size:11px;font-weight:700;padding:5px 14px;border-radius:999px;letter-spacing:0.5px;animation:pulse 2s infinite"><i class="fas fa-exclamation-triangle" style="margin-right:6px"></i>ACT NOW</span>
    <h3 style="color:#fff;font-size:22px;font-weight:800;margin:10px 0 4px"><i class="fas ${p.icon}" style="color:#fb923c;margin-right:8px"></i>${p.title}</h3>
    <p style="color:#fdba74;font-size:13px;margin:0">${p.sub}</p>
  </div>
  <form id="${fid}" onsubmit="${formSubmitJS(fid)}" style="position:relative">
    <input type="hidden" name="src" value="${source}">
    ${honeypot}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <input name="n" required placeholder="Your name" style="background:rgba(255,255,255,0.08);border:1px solid rgba(251,146,60,0.2);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;width:100%;box-sizing:border-box">
      <input name="e" type="email" required placeholder="Email address" style="background:rgba(255,255,255,0.08);border:1px solid rgba(251,146,60,0.2);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;width:100%;box-sizing:border-box">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <input name="p" type="tel" placeholder="Phone number" style="background:rgba(255,255,255,0.08);border:1px solid rgba(251,146,60,0.2);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;width:100%;box-sizing:border-box">
      <input name="a" required placeholder="Property address" style="background:rgba(255,255,255,0.08);border:1px solid rgba(251,146,60,0.2);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;width:100%;box-sizing:border-box">
    </div>
    <button type="submit" style="width:100%;background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;font-weight:800;padding:14px;border:none;border-radius:10px;font-size:15px;cursor:pointer;transition:opacity 0.2s;box-shadow:0 4px 20px rgba(249,115,22,0.3)" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'"><i class="fas fa-bolt" style="margin-right:6px"></i>Get Free Damage Assessment</button>
  </form>
  <p style="text-align:center;color:#fdba74;font-size:11px;margin-top:8px"><i class="fas fa-shield-alt" style="margin-right:4px"></i>Free &middot; No credit card &middot; Insurance-ready report</p>
  <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.7}}</style>
</section>`
}

/**
 * Blog lead magnet form — compact email + address for sample report
 * Posts to /api/asset-report/lead instead of /api/agents/leads
 */
export function blogLeadMagnetHTML(): string {
  return `<section style="background:linear-gradient(135deg,#0d1117,#111827);border:1px solid rgba(0,255,136,0.12);border-radius:20px;padding:28px;margin:40px 0;max-width:100%">
  <div style="text-align:center;margin-bottom:16px">
    <span style="display:inline-block;background:rgba(0,255,136,0.1);color:#00FF88;font-size:11px;font-weight:700;padding:5px 14px;border-radius:999px;letter-spacing:0.5px"><i class="fas fa-file-pdf" style="margin-right:6px"></i>FREE SAMPLE REPORT</span>
    <h3 style="color:#fff;font-size:20px;font-weight:800;margin:10px 0 4px">Get a Free Sample Roof Report</h3>
    <p style="color:#9ca3af;font-size:13px;margin:0">See exactly what your clients receive — full PDF with 3D area, pitch, and material BOM.</p>
  </div>
  <form onsubmit="return (async function(e){e.preventDefault();if(e.target.querySelector('[name=website]').value)return false;var b=e.target.querySelector('button[type=submit]');b.disabled=true;b.innerHTML='<i class=\\'fas fa-spinner fa-spin\\'></i> Sending...';try{var r=await fetch('/api/asset-report/lead',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e.target.e.value,address:e.target.a?e.target.a.value:'',source:'blog_lead_magnet'})});if(r.ok){e.target.innerHTML='<div style=\\'text-align:center;padding:20px\\'><div style=\\'width:44px;height:44px;background:#00FF88;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px\\'><i class=\\'fas fa-check\\' style=\\'color:#0A0A0A;font-size:18px\\'></i></div><p style=\\'color:#00FF88;font-weight:700;font-size:15px;margin:0 0 4px\\'>Check your email!</p><p style=\\'color:#9ca3af;font-size:12px;margin:0\\'>We\\'ve sent your free sample report.</p></div>';if(typeof window.fireMetaLeadEvent===\\'function\\')window.fireMetaLeadEvent({content_name:\\'blog_lead_magnet\\'});return}b.disabled=false;b.textContent='Get Report'}catch(x){b.disabled=false;b.textContent='Get Report'}return false})(event)" style="position:relative">
    ${honeypot}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <input name="e" type="email" required placeholder="Email address" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;width:100%;box-sizing:border-box">
      <input name="a" placeholder="Property address (optional)" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;color:#fff;font-size:14px;outline:none;width:100%;box-sizing:border-box">
    </div>
    <button type="submit" style="width:100%;background:#00FF88;color:#0A0A0A;font-weight:800;padding:13px;border:none;border-radius:10px;font-size:14px;cursor:pointer;transition:background 0.2s" onmouseover="this.style.background='#00e67a'" onmouseout="this.style.background='#00FF88'"><i class="fas fa-download" style="margin-right:6px"></i>Get Free Sample Report</button>
  </form>
  <p style="text-align:center;color:#6b7280;font-size:11px;margin-top:8px"><i class="fas fa-envelope" style="color:#00FF88;margin-right:4px"></i>Delivered instantly to your inbox</p>
</section>`
}

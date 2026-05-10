// ============================================================
// Shared Lead Capture Form HTML Helpers
// Used across US state/city pages, comparison pages, verticals
// All forms POST to /api/agents/leads with source tracking
// conv-v5: hardened per V5 Section 7 (labels, autocomplete, inputmode,
// tracking trio, noValidate + inline JS validation, a11y sizes)
// ============================================================

/**
 * Shared inline submission JS — hardened per V5 Section 7.
 * - Client-side validation (required, email, phone >=7 digits)
 * - Fires all three tracking events on success (rrTrack + gtag generate_lead + Meta)
 * - Fires rrTrack('form_view') once when attached
 * - Displays inline field errors (no native browser popovers)
 */
function formSubmitJS(formId: string, successHTML?: string): string {
  const successBlock = successHTML || `<div style="text-align:center;padding:24px"><div style="width:48px;height:48px;background:#00FF88;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:12px"><i class="fas fa-check" style="color:#0A0A0A;font-size:20px"></i></div><p style="color:#00FF88;font-weight:700;font-size:16px;margin:0 0 4px">Thank you!</p><p style="color:#9ca3af;font-size:13px;margin:0">We\\'ll be in touch shortly.</p></div>`
  return `return (async function(e){e.preventDefault();var f=e.target;if(f.querySelector('[name=website]').value)return false;function clearErr(){try{f.querySelectorAll('[data-rr-err]').forEach(function(el){el.remove()});f.querySelectorAll('input,textarea').forEach(function(el){el.style.borderColor=''})}catch(_){}}function setErr(el,msg){try{if(!el)return;el.style.borderColor='#f87171';var err=document.createElement('div');err.setAttribute('data-rr-err','1');err.style.cssText='color:#fca5a5;font-size:12px;margin:4px 0 8px 2px;font-weight:600';err.textContent=msg;el.insertAdjacentElement('afterend',err)}catch(_){}}clearErr();var bad=false;f.querySelectorAll('input,textarea').forEach(function(el){if(el.hasAttribute('required')&&!String(el.value||'').trim()){setErr(el,(el.getAttribute('data-label')||'This field')+' is required');bad=true}});var eEl=f.querySelector('[name=e]');if(eEl&&String(eEl.value||'').trim()&&!/[^@]+@[^@]+\\\\.[^@]+/.test(eEl.value)){setErr(eEl,'Please enter a valid email');bad=true}var pEl=f.querySelector('[name=p]');if(pEl&&String(pEl.value||'').trim()){var digits=String(pEl.value).replace(/\\\\D/g,'');if(digits.length<7){setErr(pEl,'Phone must be at least 7 digits');bad=true}}if(bad)return false;var b=f.querySelector('button[type=submit]');var origLabel=b.innerHTML;b.disabled=true;b.innerHTML='<i class=\"fas fa-spinner fa-spin\"></i> Sending...';try{var ss=window.sessionStorage;var q=new URLSearchParams(location.search);function pick(k){return q.get(k)||(ss&&ss.getItem('_rm_'+k))||''}var landingPage='';try{landingPage=(ss&&ss.getItem('_rm_landing'))||(location.pathname+location.search)||''}catch(_){landingPage=location.pathname||''}var ltEl=f.querySelector('[name=lt]');var firstName=(f.n&&f.n.value?String(f.n.value).trim().split(' ')[0]:'');var r=await fetch('/api/agents/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.n?f.n.value:'',email:f.e.value,phone:f.p?f.p.value:'',address:f.a?f.a.value:'',message:f.m?f.m.value:'',source_page:f.src.value,lead_type:ltEl?ltEl.value:'',utm_source:pick('utm_source'),utm_medium:pick('utm_medium'),utm_campaign:pick('utm_campaign'),utm_content:pick('utm_content'),utm_term:pick('utm_term'),referrer:(ss&&ss.getItem('_rm_referrer'))||document.referrer||'',landing_page:landingPage})});var d={};try{d=await r.json()}catch(_){}if(r.ok&&(d.success!==false)){try{if(ss)ss.setItem('rm_lead_captured','1')}catch(_){}var html='${successBlock.replace(/'/g, "\\'")}'.replace('{firstName}',firstName||'there');f.innerHTML=html;try{if(typeof window.rrTrack==='function')window.rrTrack('lead_submit',{form:'${formId}'})}catch(_){}try{if(typeof window.gtag==='function')window.gtag('event','generate_lead',{form_location:'${formId}'})}catch(_){}try{if(typeof window.fbq==='function'){if(d&&d.meta_event_id){window.fbq('track','Lead',{content_name:'${formId}'},{eventID:d.meta_event_id})}else if(typeof window.fireMetaLeadEvent==='function'){window.fireMetaLeadEvent({content_name:'${formId}'})}else{window.fbq('track','Lead')}}}catch(_){}return}var serverErr=(d&&d.error)?String(d.error):'Something went wrong. Please try again.';var box=document.createElement('div');box.setAttribute('data-rr-err','1');box.style.cssText='color:#fca5a5;font-size:13px;margin:8px 0;font-weight:600;padding:10px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px';box.textContent=serverErr;f.insertBefore(box,b);b.disabled=false;b.innerHTML=origLabel}catch(x){var box2=document.createElement('div');box2.setAttribute('data-rr-err','1');box2.style.cssText='color:#fca5a5;font-size:13px;margin:8px 0;font-weight:600;padding:10px 12px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:8px';box2.textContent='Network error — please try again.';f.insertBefore(box2,b);b.disabled=false;b.innerHTML=origLabel}return false})(event)`
}

/** HTML-attribute-escape a JS handler string so embedded " chars don't terminate the onsubmit="..." attribute. */
function attrEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/** Fire rrTrack('form_view') once when the form is attached. Kept as inline <script>. */
function formViewScript(formId: string): string {
  return `<script>(function(){try{var ss=window.sessionStorage;if(ss&&!ss.getItem('_rm_landing')){ss.setItem('_rm_landing',location.pathname+location.search)}if(ss&&!ss.getItem('_rm_referrer')&&document.referrer){ss.setItem('_rm_referrer',document.referrer)}}catch(_){}try{var f=document.getElementById('${formId}');if(!f)return;if(f.getAttribute('data-rr-view'))return;f.setAttribute('data-rr-view','1');if(typeof window.rrTrack==='function'){window.rrTrack('form_view',{form:'${formId}'})}else{document.addEventListener('rrtrack:ready',function(){try{window.rrTrack&&window.rrTrack('form_view',{form:'${formId}'})}catch(_){}},{once:true})}}catch(_){}})();</script>`
}

/** Honeypot field — hidden from humans, catches bots */
const honeypot = `<input name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;top:-9999px;opacity:0;height:0;width:0">`

/** Visible label helper (small, top-left, subtle). font-size 12px but input font-size stays >=16px. */
function lbl(forId: string, text: string, color = '#cbd5e1'): string {
  return `<label for="${forId}" style="display:block;color:${color};font-size:12px;font-weight:600;margin:0 0 4px 2px;letter-spacing:0.2px">${text}</label>`
}

/**
 * Inline quote form — 4 fields (name, email, phone, address)
 * Used on US state/city pages and non-storm vertical pages
 * conv-v5: hardened per V5 Section 7
 */
export function inlineQuoteFormHTML(source: string): string {
  const fid = 'iqf-' + source.replace(/[^a-z0-9]/gi, '')
  const baseInput = 'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:13px 14px;color:#fff;font-size:16px;outline:none;width:100%;box-sizing:border-box'
  return `<section style="background:linear-gradient(135deg,#0d1117,#111827);border:1px solid rgba(0,255,136,0.15);border-radius:20px;padding:32px;margin:32px auto;max-width:640px">
  <div style="text-align:center;margin-bottom:20px">
    <span style="display:inline-block;background:rgba(0,255,136,0.1);color:#00FF88;font-size:11px;font-weight:700;padding:5px 14px;border-radius:999px;letter-spacing:0.5px"><i class="fas fa-satellite" style="margin-right:6px"></i>FREE ROOF QUOTE</span>
    <h3 style="color:#fff;font-size:22px;font-weight:800;margin:10px 0 4px">Get Your Free Roof Measurement</h3>
    <p style="color:#9ca3af;font-size:13px;margin:0">Satellite-powered report in under 60 seconds. No site visit needed.</p>
  </div>
  <form id="${fid}" novalidate onsubmit="${attrEscape(formSubmitJS(fid))}" style="position:relative">
    <input type="hidden" name="src" value="${source}">
    ${honeypot}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div>
        ${lbl(`${fid}-n`, 'Full name')}
        <input id="${fid}-n" name="n" data-label="Name" required autocomplete="name" inputmode="text" placeholder="Jane Smith" style="${baseInput}">
      </div>
      <div>
        ${lbl(`${fid}-e`, 'Email address')}
        <input id="${fid}-e" name="e" type="email" data-label="Email" required autocomplete="email" inputmode="email" placeholder="you@example.com" style="${baseInput}">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div>
        ${lbl(`${fid}-p`, 'Phone (optional)')}
        <input id="${fid}-p" name="p" type="tel" data-label="Phone" autocomplete="tel" inputmode="tel" placeholder="(555) 555-5555" style="${baseInput}">
      </div>
      <div>
        ${lbl(`${fid}-a`, 'Property address')}
        <input id="${fid}-a" name="a" data-label="Address" autocomplete="street-address" inputmode="text" placeholder="123 Main St, City, ST" style="${baseInput}">
      </div>
    </div>
    <button type="submit" style="width:100%;min-height:52px;background:#00FF88;color:#0A0A0A;font-weight:800;padding:14px;border:none;border-radius:10px;font-size:16px;cursor:pointer;transition:background 0.2s" onmouseover="this.style.background='#00e67a'" onmouseout="this.style.background='#00FF88'"><i class="fas fa-bolt" style="margin-right:6px"></i>Get Free Quote</button>
  </form>
  <p style="text-align:center;color:#6b7280;font-size:11px;margin-top:8px"><i class="fas fa-lock" style="color:#00FF88;margin-right:4px"></i>No credit card required &middot; Results in 60 seconds</p>
  ${formViewScript(fid)}
</section>`
}

/**
 * Comparison page lead form — email, phone, address
 * "See how your roof compares" messaging
 * conv-v5: hardened per V5 Section 7
 */
export function comparisonLeadFormHTML(source: string): string {
  const fid = 'clf-' + source.replace(/[^a-z0-9]/gi, '')
  const baseInput = 'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:13px 14px;color:#fff;font-size:16px;outline:none;width:100%;box-sizing:border-box'
  return `<section style="background:linear-gradient(135deg,#0d1117,#0f172a);border:1px solid rgba(56,189,248,0.15);border-radius:20px;padding:32px;margin:48px auto;max-width:600px">
  <div style="text-align:center;margin-bottom:20px">
    <span style="display:inline-block;background:rgba(56,189,248,0.1);color:#38bdf8;font-size:11px;font-weight:700;padding:5px 14px;border-radius:999px;letter-spacing:0.5px"><i class="fas fa-chart-bar" style="margin-right:6px"></i>FREE COMPARISON</span>
    <h3 style="color:#fff;font-size:22px;font-weight:800;margin:10px 0 4px">See How Your Roof Compares</h3>
    <p style="color:#9ca3af;font-size:13px;margin:0">Enter your property address for a free satellite measurement report.</p>
  </div>
  <form id="${fid}" novalidate onsubmit="${attrEscape(formSubmitJS(fid))}" style="position:relative">
    <input type="hidden" name="src" value="${source}">
    ${honeypot}
    <div style="margin-bottom:10px">
      ${lbl(`${fid}-e`, 'Email address')}
      <input id="${fid}-e" name="e" type="email" data-label="Email" required autocomplete="email" inputmode="email" placeholder="you@example.com" style="${baseInput}">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div>
        ${lbl(`${fid}-p`, 'Phone (optional)')}
        <input id="${fid}-p" name="p" type="tel" data-label="Phone" autocomplete="tel" inputmode="tel" placeholder="(555) 555-5555" style="${baseInput}">
      </div>
      <div>
        ${lbl(`${fid}-a`, 'Property address')}
        <input id="${fid}-a" name="a" data-label="Address" autocomplete="street-address" inputmode="text" placeholder="123 Main St, City, ST" style="${baseInput}">
      </div>
    </div>
    <button type="submit" style="width:100%;min-height:52px;background:#38bdf8;color:#0A0A0A;font-weight:800;padding:14px;border:none;border-radius:10px;font-size:16px;cursor:pointer;transition:background 0.2s" onmouseover="this.style.background='#7dd3fc'" onmouseout="this.style.background='#38bdf8'"><i class="fas fa-satellite-dish" style="margin-right:6px"></i>Get Free Report</button>
  </form>
  <p style="text-align:center;color:#6b7280;font-size:11px;margin-top:8px"><i class="fas fa-clock" style="color:#38bdf8;margin-right:4px"></i>Results delivered in under 60 seconds</p>
  ${formViewScript(fid)}
</section>`
}

/**
 * Damage assessment form — urgent styling for storm/hail/hurricane pages
 * Orange/red gradient with urgency messaging
 * conv-v5: hardened per V5 Section 7
 */
export function damageAssessmentFormHTML(source: string, perilType: string): string {
  const fid = 'daf-' + source.replace(/[^a-z0-9]/gi, '')
  const perilLabels: Record<string, { title: string; sub: string; icon: string }> = {
    storm: { title: 'Get Your Storm Damage Assessment', sub: 'Document damage fast — most insurance policies require claims within 60 days.', icon: 'fa-cloud-showers-heavy' },
    hail: { title: 'Get Your Hail Damage Assessment', sub: 'Hail damage is often invisible from the ground. Get a satellite assessment now.', icon: 'fa-cloud-meatball' },
    hurricane: { title: 'Get Your Hurricane Damage Assessment', sub: 'Act fast — insurance adjusters are already in your area. Get your report first.', icon: 'fa-hurricane' },
  }
  const p = perilLabels[perilType] || perilLabels.storm
  const baseInput = 'background:rgba(255,255,255,0.08);border:1px solid rgba(251,146,60,0.2);border-radius:10px;padding:13px 14px;color:#fff;font-size:16px;outline:none;width:100%;box-sizing:border-box'
  return `<section style="background:linear-gradient(135deg,#451a03,#7c2d12,#431407);border:2px solid rgba(251,146,60,0.3);border-radius:20px;padding:32px;margin:32px auto;max-width:640px">
  <div style="text-align:center;margin-bottom:20px">
    <span style="display:inline-block;background:rgba(251,146,60,0.15);color:#fb923c;font-size:11px;font-weight:700;padding:5px 14px;border-radius:999px;letter-spacing:0.5px;animation:pulse 2s infinite"><i class="fas fa-exclamation-triangle" style="margin-right:6px"></i>ACT NOW</span>
    <h3 style="color:#fff;font-size:22px;font-weight:800;margin:10px 0 4px"><i class="fas ${p.icon}" style="color:#fb923c;margin-right:8px"></i>${p.title}</h3>
    <p style="color:#fdba74;font-size:13px;margin:0">${p.sub}</p>
  </div>
  <form id="${fid}" novalidate onsubmit="${attrEscape(formSubmitJS(fid))}" style="position:relative">
    <input type="hidden" name="src" value="${source}">
    ${honeypot}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
      <div>
        ${lbl(`${fid}-n`, 'Full name', '#fde68a')}
        <input id="${fid}-n" name="n" data-label="Name" required autocomplete="name" inputmode="text" placeholder="Jane Smith" style="${baseInput}">
      </div>
      <div>
        ${lbl(`${fid}-e`, 'Email address', '#fde68a')}
        <input id="${fid}-e" name="e" type="email" data-label="Email" required autocomplete="email" inputmode="email" placeholder="you@example.com" style="${baseInput}">
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div>
        ${lbl(`${fid}-p`, 'Phone number', '#fde68a')}
        <input id="${fid}-p" name="p" type="tel" data-label="Phone" autocomplete="tel" inputmode="tel" placeholder="(555) 555-5555" style="${baseInput}">
      </div>
      <div>
        ${lbl(`${fid}-a`, 'Property address', '#fde68a')}
        <input id="${fid}-a" name="a" data-label="Address" required autocomplete="street-address" inputmode="text" placeholder="123 Main St, City, ST" style="${baseInput}">
      </div>
    </div>
    <button type="submit" style="width:100%;min-height:52px;background:linear-gradient(135deg,#f97316,#ea580c);color:#fff;font-weight:800;padding:14px;border:none;border-radius:10px;font-size:16px;cursor:pointer;transition:opacity 0.2s;box-shadow:0 4px 20px rgba(249,115,22,0.3)" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'"><i class="fas fa-bolt" style="margin-right:6px"></i>Get Free Damage Assessment</button>
  </form>
  <p style="text-align:center;color:#fdba74;font-size:11px;margin-top:8px"><i class="fas fa-shield-alt" style="margin-right:4px"></i>Free &middot; No credit card &middot; Insurance-ready report</p>
  <style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.7}}</style>
  ${formViewScript(fid)}
</section>`
}

/**
 * Free Measurement Report — primary lead-magnet form for high-intent surfaces.
 * Posts to /api/agents/leads with lead_type='free_measurement_report'.
 * Variants:
 *   'hero'   — dark glassmorphism, green CTA, 640px card for homepage hero
 *   'inline' — neutral dark card for mid-page placement (pricing/features)
 *   'modal'  — compact form body for exit-intent modal (no outer gradient)
 * conv-v5: hardened per V5 Section 7
 */
export function freeMeasurementReportFormHTML(source: string, variant: 'hero' | 'inline' | 'modal' = 'inline'): string {
  const fid = 'fmr-' + source.replace(/[^a-z0-9]/gi, '')
  const successHTML = `<div style="text-align:center;padding:28px 20px"><div style="width:56px;height:56px;background:#00FF88;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:14px"><i class="fas fa-check" style="color:#0A0A0A;font-size:24px"></i></div><p style="color:#00FF88;font-weight:800;font-size:17px;margin:0 0 6px">Got it, {firstName}.</p><p style="color:#d1d5db;font-size:13px;line-height:1.5;margin:0 0 4px">Check your inbox — we\\'ve sent a confirmation and your report is being prepared.</p><p style="color:#9ca3af;font-size:12px;margin:0">Expected delivery within 2 business hours.</p></div>`
  const submitHandler = formSubmitJS(fid, successHTML)

  const inputStyle = 'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:14px;color:#fff;font-size:16px;outline:none;width:100%;box-sizing:border-box'
  const btnStyle = 'width:100%;min-height:52px;background:#00FF88;color:#0A0A0A;font-weight:800;padding:15px;border:none;border-radius:10px;font-size:16px;cursor:pointer;transition:background 0.2s'
  const btnHover = "onmouseover=\"this.style.background='#00e67a'\" onmouseout=\"this.style.background='#00FF88'\""

  const headline = `<span style="display:inline-block;background:rgba(0,255,136,0.1);color:#00FF88;font-size:11px;font-weight:700;padding:5px 14px;border-radius:999px;letter-spacing:0.5px;margin-bottom:10px"><i class="fas fa-satellite" style="margin-right:6px"></i>FREE REPORT — NO CREDIT CARD</span>
    <h3 style="color:#fff;font-size:${variant === 'hero' ? '24px' : '20px'};font-weight:800;margin:4px 0 6px;line-height:1.25">Get a Free Roof Measurement Report — Emailed to You in Hours</h3>
    <p style="color:#9ca3af;font-size:13px;margin:0 0 18px;line-height:1.5">Enter your address. We\u2019ll send satellite-accurate measurements to your inbox. No credit card. No sales call unless you want one.</p>`

  const formBody = `<form id="${fid}" novalidate onsubmit="${attrEscape(submitHandler)}" style="position:relative">
      <input type="hidden" name="src" value="${source}">
      <input type="hidden" name="lt" value="free_measurement_report">
      ${honeypot}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div>
          ${lbl(`${fid}-n`, 'Full name')}
          <input id="${fid}-n" name="n" data-label="Name" required autocomplete="name" inputmode="text" placeholder="Jane Smith" style="${inputStyle}">
        </div>
        <div>
          ${lbl(`${fid}-e`, 'Email address')}
          <input id="${fid}-e" name="e" type="email" data-label="Email" required autocomplete="email" inputmode="email" placeholder="you@example.com" style="${inputStyle}">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
        <div>
          ${lbl(`${fid}-a`, 'Property address')}
          <input id="${fid}-a" name="a" data-label="Address" required autocomplete="street-address" inputmode="text" placeholder="123 Main St, City, ST" style="${inputStyle}">
        </div>
        <div>
          ${lbl(`${fid}-p`, 'Phone (optional)')}
          <input id="${fid}-p" name="p" type="tel" data-label="Phone" autocomplete="tel" inputmode="tel" placeholder="(555) 555-5555" style="${inputStyle}">
        </div>
      </div>
      <button type="submit" style="${btnStyle}" ${btnHover}><i class="fas fa-satellite-dish" style="margin-right:6px"></i>Send My Free Report</button>
    </form>
    <p style="text-align:center;color:#6b7280;font-size:11px;margin-top:10px"><i class="fas fa-lock" style="color:#00FF88;margin-right:4px"></i>No credit card &middot; Delivered in 2 business hours &middot; No spam</p>
    ${formViewScript(fid)}`

  if (variant === 'modal') {
    return `<div style="max-width:520px;margin:0 auto">${headline}${formBody}</div>`
  }
  if (variant === 'hero') {
    return `<section style="background:linear-gradient(135deg,rgba(13,17,23,0.95),rgba(17,24,39,0.98));border:1px solid rgba(0,255,136,0.25);border-radius:20px;padding:28px;margin:24px 0;max-width:640px;backdrop-filter:blur(12px);box-shadow:0 20px 50px rgba(0,255,136,0.08)">
    ${headline}${formBody}
  </section>`
  }
  // inline
  return `<section style="background:linear-gradient(135deg,#0d1117,#111827);border:1px solid rgba(0,255,136,0.15);border-radius:20px;padding:32px;margin:48px auto;max-width:640px">
    ${headline}${formBody}
  </section>`
}

/**
 * Blog lead magnet form — compact email + address for sample report
 * Posts to /api/asset-report/lead instead of /api/agents/leads
 * conv-v5: hardened per V5 Section 7
 */
export function blogLeadMagnetHTML(): string {
  const fid = 'blog-lead-magnet-form'
  const baseInput = 'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:13px 14px;color:#fff;font-size:16px;outline:none;width:100%;box-sizing:border-box'
  return `<section style="background:linear-gradient(135deg,#0d1117,#111827);border:1px solid rgba(0,255,136,0.12);border-radius:20px;padding:28px;margin:40px 0;max-width:100%">
  <div style="text-align:center;margin-bottom:16px">
    <span style="display:inline-block;background:rgba(0,255,136,0.1);color:#00FF88;font-size:11px;font-weight:700;padding:5px 14px;border-radius:999px;letter-spacing:0.5px"><i class="fas fa-file-pdf" style="margin-right:6px"></i>FREE SAMPLE REPORT</span>
    <h3 style="color:#fff;font-size:20px;font-weight:800;margin:10px 0 4px">Get a Free Sample Roof Report</h3>
    <p style="color:#9ca3af;font-size:13px;margin:0">See exactly what your clients receive — full PDF with 3D area, pitch, and material BOM.</p>
  </div>
  <form id="${fid}" novalidate onsubmit="return rmBlogLeadMagnetSubmit(event)" style="position:relative">
    ${honeypot}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div>
        ${lbl(`${fid}-e`, 'Email address')}
        <input id="${fid}-e" name="e" type="email" data-label="Email" required autocomplete="email" inputmode="email" placeholder="you@example.com" style="${baseInput}">
      </div>
      <div>
        ${lbl(`${fid}-a`, 'Property address (optional)')}
        <input id="${fid}-a" name="a" data-label="Address" autocomplete="street-address" inputmode="text" placeholder="123 Main St" style="${baseInput}">
      </div>
    </div>
    <div data-lead-msg style="display:none;margin-bottom:10px;padding:10px 12px;border-radius:8px;font-size:13px;font-weight:600"></div>
    <button type="submit" style="width:100%;min-height:52px;background:#00FF88;color:#0A0A0A;font-weight:800;padding:14px;border:none;border-radius:10px;font-size:16px;cursor:pointer;transition:background 0.2s" onmouseover="this.style.background='#00e67a'" onmouseout="this.style.background='#00FF88'"><i class="fas fa-download" style="margin-right:6px"></i>Get Free Sample Report</button>
  </form>
  <script>
  (function(){try{var ss=window.sessionStorage;if(ss){ss.setItem('_rm_landing',location.pathname+location.search);if(!ss.getItem('_rm_referrer')&&document.referrer){ss.setItem('_rm_referrer',document.referrer)}}}catch(_){}try{var f=document.getElementById('${fid}');if(f&&!f.getAttribute('data-rr-view')){f.setAttribute('data-rr-view','1');if(typeof window.rrTrack==='function'){window.rrTrack('form_view',{form:'${fid}'})}}}catch(_){}})();
  if (typeof window.rmBlogLeadMagnetSubmit !== 'function') {
    window.rmBlogLeadMagnetSubmit = async function(e) {
      e.preventDefault();
      var form = e.target;
      var hp = form.querySelector('[name=website]');
      if (hp && hp.value) return false;
      var btn = form.querySelector('button[type=submit]');
      var msg = form.querySelector('[data-lead-msg]');
      function showMsg(text, isErr) {
        if (!msg) return;
        msg.style.display = 'block';
        msg.style.background = isErr ? 'rgba(239,68,68,0.15)' : 'rgba(0,255,136,0.15)';
        msg.style.color = isErr ? '#fca5a5' : '#00FF88';
        msg.style.border = '1px solid ' + (isErr ? 'rgba(239,68,68,0.3)' : 'rgba(0,255,136,0.3)');
        msg.textContent = text;
      }
      // conv-v5: inline validation
      var emailEl = form.e;
      var emailVal = emailEl ? String(emailEl.value||'').trim() : '';
      if (!emailVal || !/[^@]+@[^@]+\\.[^@]+/.test(emailVal)) { showMsg('Please enter a valid email address.', true); emailEl && (emailEl.style.borderColor = '#f87171'); return false; }
      if (emailEl) emailEl.style.borderColor = '';
      btn.disabled = true;
      var originalLabel = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
      try {
        var ss = window.sessionStorage;
        var q = new URLSearchParams(location.search);
        function pick(k){return q.get(k)||(ss&&ss.getItem('_rm_'+k))||''}
        var landingPage = (ss&&ss.getItem('_rm_landing'))||(location.pathname+location.search)||'';
        var res = await fetch('/api/asset-report/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: emailVal,
            address: form.a ? form.a.value.trim() : '',
            source: 'blog_lead_magnet',
            landing_page: landingPage,
            referrer: (ss&&ss.getItem('_rm_referrer'))||document.referrer||'',
            utm_source: pick('utm_source'),
            utm_medium: pick('utm_medium'),
            utm_campaign: pick('utm_campaign')
          })
        });
        var data = {};
        try { data = await res.json(); } catch (_) {}
        if (res.ok && data && data.success !== false) {
          form.innerHTML = '<div style="text-align:center;padding:20px"><div style="width:44px;height:44px;background:#00FF88;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px"><i class="fas fa-check" style="color:#0A0A0A;font-size:18px"></i></div><p style="color:#00FF88;font-weight:700;font-size:15px;margin:0 0 4px">Check your email!</p><p style="color:#9ca3af;font-size:12px;margin:0">We\\'ve sent your free sample report. If you don\\'t see it in 5 minutes, check spam.</p></div>';
          try { if (typeof window.rrTrack === 'function') window.rrTrack('lead_submit', { form: '${fid}' }); } catch(_) {}
          try { if (typeof window.gtag === 'function') window.gtag('event', 'generate_lead', { form_location: '${fid}' }); } catch(_) {}
          // Dedup with server-side CAPI by passing eventID. Without this, Meta
          // counts the lead twice — once from this fbq fire, once from the
          // server-side sendMetaConversion('Lead',...) fire. Skip
          // fireMetaLeadEvent helper because it doesn't support eventID arg.
          try {
            if (typeof window.fbq === 'function') {
              if (data && data.meta_event_id) {
                window.fbq('track', 'Lead', { content_name: '${fid}' }, { eventID: data.meta_event_id });
              } else if (typeof window.fireMetaLeadEvent === 'function') {
                window.fireMetaLeadEvent({ content_name: '${fid}' });
              } else {
                window.fbq('track', 'Lead');
              }
            }
          } catch(_) {}
          return false;
        }
        var errText = (data && data.error) ? String(data.error) : 'Something went wrong. Please try again or email sales@roofmanager.ca directly.';
        showMsg(errText, true);
        btn.disabled = false;
        btn.innerHTML = originalLabel;
      } catch (err) {
        showMsg('Network error — please check your connection and try again.', true);
        btn.disabled = false;
        btn.innerHTML = originalLabel;
      }
      return false;
    };
  }
  </script>
  <p style="text-align:center;color:#6b7280;font-size:11px;margin-top:8px"><i class="fas fa-envelope" style="color:#00FF88;margin-right:4px"></i>Delivered instantly to your inbox</p>
</section>`
}

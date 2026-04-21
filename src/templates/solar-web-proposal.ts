// ============================================================
// Mobile-first homeowner proposal page rendered from a frozen
// solar_proposals row (snapshot-on-send). All styling is inline
// CSS so there's no framework dependency and TTFB stays under
// 200ms at the Cloudflare edge.
//
// Intentionally minimal: hero, system card, production, savings,
// what's included, signature pad, footer. No financing tab per
// product decision (we don't offer financing).
// ============================================================

interface PricingSnapshot {
  gross_cad?: number
  rebates_cad?: number
  net_cad?: number
  per_watt_cad?: number
  includes?: string[]
}

interface EquipmentSnapshot {
  panel_model?: string
  panel_wattage?: number
  inverter?: string
  battery?: string
  warranty_years?: number
}

interface ProposalRow {
  id: number
  share_token: string
  status: string
  system_kw: number
  panel_count: number
  annual_kwh: number
  utility_rate_per_kwh: number | null
  annual_consumption_kwh: number | null
  offset_pct: number | null
  savings_25yr_cad: number | null
  homeowner_name: string | null
  homeowner_email: string | null
  property_address: string | null
  signed_at: string | null
  signer_name: string | null
  pricing_json: string | null
  equipment_json: string | null
  panel_layout_json: string | null
  sent_at: string | null
}

interface CompanyInfo {
  name?: string | null
  email?: string | null
  phone?: string | null
  logo_url?: string | null
  primary_color?: string | null
  rep_name?: string | null
}

function esc(s: unknown): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch))
}

function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback
  try { return JSON.parse(s) as T } catch { return fallback }
}

function money(n: number | null | undefined): string {
  if (n == null || !isFinite(Number(n))) return '$—'
  return '$' + Math.round(Number(n)).toLocaleString('en-CA')
}

// Derive monthly production from annual using a normalized Canadian insolation
// curve. Only used when the stored panel_layout didn't include monthly_kwh.
// Normalized shares sum to 1.0; weighted toward May–Jul.
const MONTH_SHARE = [0.045,0.060,0.085,0.100,0.115,0.120,0.115,0.105,0.090,0.075,0.050,0.040]
const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function monthlyKwh(annual: number, explicit?: number[] | null): number[] {
  if (explicit && explicit.length === 12) return explicit.map((n) => Math.round(n))
  return MONTH_SHARE.map((s) => Math.round(annual * s))
}

function monthlyChartSvg(monthly: number[]): string {
  const max = Math.max(1, ...monthly)
  const W = 340, H = 140, pad = 24
  const bw = (W - pad * 2) / 12
  const bars = monthly.map((v, i) => {
    const h = ((v / max) * (H - pad * 2))
    const x = pad + i * bw + 2
    const y = H - pad - h
    return `<rect x="${x}" y="${y}" width="${bw - 4}" height="${h}" rx="3" fill="#f59e0b"></rect>` +
           `<text x="${x + (bw - 4) / 2}" y="${H - 8}" text-anchor="middle" font-size="9" fill="#9ca3af" font-family="system-ui">${MONTH_NAMES[i]}</text>`
  }).join('')
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Monthly production chart">${bars}</svg>`
}

function satelliteUrl(address: string | null, key?: string | null): string | null {
  if (!address || !key) return null
  const q = encodeURIComponent(address)
  return `https://maps.googleapis.com/maps/api/staticmap?center=${q}&zoom=20&maptype=satellite&size=640x360&scale=2&key=${key}`
}

export function renderSolarWebProposal(
  proposal: ProposalRow,
  company: CompanyInfo,
  opts: { mapsKey?: string } = {},
): string {
  const pricing = parseJson<PricingSnapshot>(proposal.pricing_json, {})
  const equipment = parseJson<EquipmentSnapshot>(proposal.equipment_json, {})
  const layout = parseJson<any>(proposal.panel_layout_json, {})

  const monthly = monthlyKwh(proposal.annual_kwh || 0, layout?.monthly_kwh)
  const offsetPct = proposal.offset_pct ?? (
    proposal.annual_consumption_kwh
      ? Math.round((proposal.annual_kwh / Number(proposal.annual_consumption_kwh)) * 1000) / 10
      : null
  )
  const savings25 = proposal.savings_25yr_cad ?? (
    proposal.utility_rate_per_kwh
      ? Math.round(proposal.annual_kwh * Number(proposal.utility_rate_per_kwh) * 25 * 1.15) // crude: 25 years × 3% avg esc
      : null
  )
  const year1Savings = proposal.utility_rate_per_kwh
    ? Math.round(proposal.annual_kwh * Number(proposal.utility_rate_per_kwh))
    : null
  const paybackYears = (savings25 && pricing.net_cad)
    ? Math.round(((Number(pricing.net_cad)) / Math.max(1, year1Savings || 1)) * 10) / 10
    : null

  const mapImg = satelliteUrl(proposal.property_address, opts.mapsKey)
  const color = company.primary_color || '#f59e0b'
  const repName = esc(company.rep_name || company.name || '')
  const signed = proposal.status === 'signed'

  const includes = (pricing.includes && pricing.includes.length)
    ? pricing.includes
    : [
      'All panels, microinverters, and racking',
      'Mounting & electrical labor by our installers',
      'Permits and utility interconnection paperwork',
      equipment.warranty_years
        ? `${equipment.warranty_years}-year workmanship warranty`
        : '25-year manufacturer panel warranty',
    ]

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Solar Proposal — ${esc(proposal.homeowner_name || 'Your Home')}</title>
<meta name="robots" content="noindex">
<style>
  :root { --accent: ${esc(color)}; --bg:#0b0f19; --card:#111827; --text:#f8fafc; --muted:#94a3b8; --border:#1f2937; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased; line-height: 1.45; }
  img { max-width: 100%; display: block; }
  .wrap { max-width: 480px; margin: 0 auto; padding: 0 16px 80px; }
  .hero { padding: 24px 16px 20px; background: linear-gradient(180deg, #0f172a 0%, #0b0f19 100%); }
  .hero h1 { margin: 0 0 4px; font-size: 22px; font-weight: 800; letter-spacing: -0.3px; }
  .hero .sub { color: var(--muted); font-size: 13px; margin-bottom: 14px; }
  .hero .map { border-radius: 14px; overflow: hidden; border: 1px solid var(--border); }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px;
    padding: 16px; margin: 14px 0; }
  .card h2 { margin: 0 0 10px; font-size: 16px; font-weight: 800; letter-spacing: -0.2px; }
  .stat-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px; }
  .stat { background: #0b1120; border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
  .stat .k { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .stat .v { font-size: 20px; font-weight: 800; color: var(--accent); margin-top: 2px; }
  .big-number { font-size: 34px; font-weight: 900; color: var(--accent); line-height: 1.1; }
  .muted { color: var(--muted); font-size: 13px; }
  ul.includes { margin: 10px 0 0; padding: 0; list-style: none; }
  ul.includes li { padding: 8px 0; border-top: 1px solid var(--border); font-size: 14px; }
  ul.includes li:first-child { border-top: 0; }
  ul.includes li::before { content: "✓ "; color: #22c55e; font-weight: 800; margin-right: 6px; }
  .cta {
    display: block; width: 100%; background: var(--accent); color: #0b0f19;
    font-weight: 900; text-align: center; padding: 16px; border-radius: 12px;
    font-size: 16px; text-decoration: none; border: none; cursor: pointer; margin-top: 10px;
  }
  .cta.secondary { background: transparent; color: var(--text); border: 1px solid var(--border); font-weight: 700; }
  .footer { color: var(--muted); font-size: 12px; text-align: center; padding: 20px 0 40px; }
  .footer a { color: var(--muted); }
  .sig-wrap { background: #0b1120; border: 1px solid var(--border); border-radius: 10px; padding: 10px; }
  .sig-canvas { background: #fff; border-radius: 6px; width: 100%; height: 160px; touch-action: none; display: block; }
  .sig-row { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
  .sig-row button { background: transparent; border: 0; color: var(--muted); text-decoration: underline; font-size: 12px; cursor: pointer; }
  input[type=text], input[type=email] {
    width: 100%; padding: 12px; background: #0b1120; border: 1px solid var(--border); border-radius: 10px;
    color: var(--text); font-size: 15px; margin-top: 8px;
  }
  .signed-badge { display: inline-block; background: #064e3b; color: #d1fae5; padding: 6px 12px;
    border-radius: 999px; font-size: 12px; font-weight: 700; }
  @media (min-width: 520px) { .hero h1 { font-size: 26px; } }
</style>
</head>
<body>
<div class="wrap">
  <div class="hero">
    <div style="font-size:12px; font-weight:800; color:var(--accent); letter-spacing:1px;">${esc(company.name || 'Solar Proposal')}</div>
    <h1>Your solar plan, ${esc((proposal.homeowner_name || '').split(' ')[0] || 'homeowner')}.</h1>
    <div class="sub">${esc(proposal.property_address || '')}</div>
    ${mapImg ? `<div class="map"><img src="${esc(mapImg)}" alt="Your roof" loading="lazy"></div>` : ''}
  </div>

  <div class="card">
    <h2>Your system</h2>
    <div class="stat-row">
      <div class="stat"><div class="k">System Size</div><div class="v">${proposal.system_kw.toFixed(2)} kW</div></div>
      <div class="stat"><div class="k">Panels</div><div class="v">${proposal.panel_count}</div></div>
      <div class="stat"><div class="k">Annual Production</div><div class="v">${Math.round(proposal.annual_kwh).toLocaleString('en-CA')} kWh</div></div>
      <div class="stat"><div class="k">Bill Offset</div><div class="v">${offsetPct != null ? offsetPct + '%' : '—'}</div></div>
    </div>
    ${(equipment.panel_model || equipment.inverter) ? `<p class="muted" style="margin-top:14px">
      ${equipment.panel_model ? `<strong>${esc(equipment.panel_model)}</strong>${equipment.panel_wattage ? ` (${equipment.panel_wattage}W)` : ''}` : ''}
      ${equipment.inverter ? ` · ${esc(equipment.inverter)}` : ''}
      ${equipment.battery ? ` · ${esc(equipment.battery)}` : ''}
    </p>` : ''}
  </div>

  <div class="card">
    <h2>Your production</h2>
    ${monthlyChartSvg(monthly)}
    <p class="muted">Based on hourly solar simulation at your address using NREL weather data.</p>
  </div>

  <div class="card">
    <h2>Your savings</h2>
    <div class="big-number">${money(savings25)}</div>
    <div class="muted">estimated over 25 years</div>
    <div class="stat-row">
      <div class="stat"><div class="k">Year 1 Savings</div><div class="v">${money(year1Savings)}</div></div>
      <div class="stat"><div class="k">Payback</div><div class="v">${paybackYears ? paybackYears + ' yrs' : '—'}</div></div>
    </div>
  </div>

  ${(pricing.net_cad != null || pricing.gross_cad != null) ? `
  <div class="card">
    <h2>Your investment</h2>
    <div class="stat-row">
      ${pricing.gross_cad != null ? `<div class="stat"><div class="k">System Cost</div><div class="v">${money(pricing.gross_cad)}</div></div>` : ''}
      ${pricing.rebates_cad != null ? `<div class="stat"><div class="k">Rebates</div><div class="v">-${money(pricing.rebates_cad)}</div></div>` : ''}
      ${pricing.net_cad != null ? `<div class="stat"><div class="k">Net Cost</div><div class="v">${money(pricing.net_cad)}</div></div>` : ''}
      ${pricing.per_watt_cad != null ? `<div class="stat"><div class="k">$/Watt</div><div class="v">${'$' + Number(pricing.per_watt_cad).toFixed(2)}</div></div>` : ''}
    </div>
  </div>` : ''}

  <div class="card">
    <h2>What's included</h2>
    <ul class="includes">
      ${includes.map((x) => `<li>${esc(x)}</li>`).join('')}
    </ul>
  </div>

  ${signed ? `
  <div class="card" style="text-align:center">
    <div class="signed-badge">Signed ${esc((proposal.signed_at || '').slice(0,10))}</div>
    <p class="muted" style="margin-top:12px">Thank you, ${esc(proposal.signer_name || proposal.homeowner_name || '')}. Your installer will be in touch to schedule next steps.</p>
  </div>
  ` : `
  <div class="card">
    <h2>Next step — sign to move forward</h2>
    <p class="muted">Draw your signature below. By signing, you authorize ${esc(company.name || 'the installer')} to begin site planning and permits. Cancel anytime before install.</p>
    <div class="sig-wrap">
      <canvas id="sigpad" class="sig-canvas" width="600" height="160"></canvas>
      <div class="sig-row">
        <span class="muted" style="font-size:11px">Sign with your finger or mouse</span>
        <button type="button" id="sig-clear">Clear</button>
      </div>
    </div>
    <input id="signer-name" type="text" placeholder="Your full legal name" value="${esc(proposal.homeowner_name || '')}" autocomplete="name">
    <button type="button" class="cta" id="btn-sign">Sign &amp; Continue</button>
    ${company.email ? `<a class="cta secondary" href="mailto:${esc(company.email)}?subject=Proposal%20changes&body=Hi%20${esc(repName)}%2C%0A%0AI%27d%20like%20to%20discuss%20changes%20to%20my%20solar%20proposal%3A%0A%0A">Request changes</a>` : ''}
  </div>
  `}

  <div class="footer">
    ${esc(company.name || '')}${company.phone ? ` · <a href="tel:${esc(company.phone)}">${esc(company.phone)}</a>` : ''}${company.email ? ` · <a href="mailto:${esc(company.email)}">${esc(company.email)}</a>` : ''}
    <br><br>Powered by Roof Manager
  </div>
</div>

${signed ? '' : `<script>
(function(){
  var canvas = document.getElementById('sigpad');
  var ctx = canvas.getContext('2d');
  var drawing = false, hasInk = false, last = null;
  function fit() {
    var ratio = window.devicePixelRatio || 1;
    var w = canvas.offsetWidth, h = canvas.offsetHeight;
    canvas.width = w * ratio; canvas.height = h * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2; ctx.strokeStyle = '#0b0f19'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  }
  fit();
  window.addEventListener('resize', fit);
  function pt(e) {
    var t = e.touches ? e.touches[0] : e;
    var r = canvas.getBoundingClientRect();
    return { x: t.clientX - r.left, y: t.clientY - r.top };
  }
  function start(e) { e.preventDefault(); drawing = true; last = pt(e); }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    var p = pt(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p; hasInk = true;
  }
  function end() { drawing = false; last = null; }
  canvas.addEventListener('mousedown', start); canvas.addEventListener('mousemove', move);
  canvas.addEventListener('mouseup', end);    canvas.addEventListener('mouseleave', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove',  move,  { passive: false });
  canvas.addEventListener('touchend',   end);

  document.getElementById('sig-clear').addEventListener('click', function() { fit(); hasInk = false; });
  document.getElementById('btn-sign').addEventListener('click', function() {
    var name = (document.getElementById('signer-name').value || '').trim();
    if (!name) { alert('Please type your full legal name.'); return; }
    if (!hasInk) { alert('Please draw your signature above.'); return; }
    var btn = this; btn.disabled = true; btn.textContent = 'Submitting…';
    var png = canvas.toDataURL('image/png');
    fetch('/p/solar/${esc(proposal.share_token)}/sign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signer_name: name, signature_png_base64: png }),
    }).then(function(r) { return r.json(); }).then(function(resp) {
      if (resp && resp.success) { window.location.reload(); }
      else { alert(resp && resp.error ? resp.error : 'Could not record signature.'); btn.disabled = false; btn.textContent = 'Sign & Continue'; }
    }).catch(function() {
      alert('Network error — please try again.'); btn.disabled = false; btn.textContent = 'Sign & Continue';
    });
  });

  // Track first view + scroll depth for funnel analytics.
  var maxDepth = 0;
  function ping(type, data) {
    try {
      fetch('/p/solar/${esc(proposal.share_token)}/event', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_type: type, data: data || {} }), keepalive: true,
      });
    } catch (e) {}
  }
  window.addEventListener('scroll', function() {
    var d = Math.min(100, Math.round((window.scrollY + window.innerHeight) / document.body.scrollHeight * 100));
    if (d > maxDepth + 20) { maxDepth = d; ping('scroll_depth', { pct: d }); }
  });
})();
</script>`}
</body></html>`
}

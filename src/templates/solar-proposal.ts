// ============================================================
// Branded Solar Proposal — kitchen-table close kit
// Multi-page HTML (print-ready) pulling customer branding +
// variants from solar_panel_layout. One page per variant +
// a cover page.
// ============================================================

interface ProposalBrand {
  business_name?: string | null
  logo_url?: string | null
  primary_color?: string | null
  secondary_color?: string | null
  tagline?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  license_number?: string | null
}

interface ProposalOrder {
  id: number | string
  property_address?: string | null
  property_city?: string | null
  property_province?: string | null
  property_postal_code?: string | null
  homeowner_name?: string | null
  requester_name?: string | null          // sales rep
  requester_company?: string | null
  latitude?: number | null
  longitude?: number | null
}

interface ProposalLayout {
  variants?: any[]
  active_variant_index?: number
  suggested_panels?: any[]
  obstructions?: any[]
  inverter_config?: any
  battery_config?: any
  panel_capacity_watts: number
  panel_height_meters: number
  panel_width_meters: number
  image_center: { lat: number; lng: number }
  image_zoom: number
  image_size_px: number
  yearly_energy_kwh: number
  segments?: any[]
}

function hex(c?: string | null, fallback = '#f59e0b') {
  if (!c || typeof c !== 'string') return fallback
  return c.startsWith('#') ? c : '#' + c
}

// Web Mercator lat/lng → pixel at image_center/zoom/size
function project(lat: number, lng: number, cLat: number, cLng: number, zoom: number, sizePx: number) {
  const scale = Math.pow(2, zoom)
  const clip = (v: number) => Math.max(-0.9999, Math.min(0.9999, v))
  const p = { x: 256 * (0.5 + lng / 360), y: 256 * (0.5 - Math.log((1 + clip(Math.sin(lat * Math.PI / 180))) / (1 - clip(Math.sin(lat * Math.PI / 180)))) / (4 * Math.PI)) }
  const c = { x: 256 * (0.5 + cLng / 360), y: 256 * (0.5 - Math.log((1 + clip(Math.sin(cLat * Math.PI / 180))) / (1 - clip(Math.sin(cLat * Math.PI / 180)))) / (4 * Math.PI)) }
  return { x: (p.x - c.x) * scale + sizePx / 2, y: (p.y - c.y) * scale + sizePx / 2 }
}

function renderVariantPage(
  variant: any,
  layout: ProposalLayout,
  satUrl: string,
  accent: string,
  accent2: string,
  logoHtml: string,
  addr: string,
  footer: string,
): string {
  const panels = variant.panels || []
  const panelCount = panels.length
  const watts = layout.panel_capacity_watts || 400
  const systemKwDc = (panelCount * watts) / 1000
  // Scale yearly_energy_kwh proportionally to panel count vs. suggested.
  const suggestedCount = (layout.suggested_panels || []).length || panelCount || 1
  const annualKwh = Math.round(((layout.yearly_energy_kwh || 0) / suggestedCount) * panelCount)
  const co2Tons = (annualKwh * 0.0004).toFixed(1)
  const lifetimeKwh = annualKwh * 25

  // Panel overlay
  const cLat = layout.image_center?.lat
  const cLng = layout.image_center?.lng
  const zoom = layout.image_zoom || 20
  // Use logical pixel size (physical image_size_px is scale=2, so logical = physical/2)
  const sizePx = (layout.image_size_px || 1600) / 2
  const metersPerPx = cLat ? (156543.03392 * Math.cos(cLat * Math.PI / 180)) / Math.pow(2, zoom) : 0.1
  const panelWpx = (layout.panel_width_meters || 1.045) / metersPerPx
  const panelHpx = (layout.panel_height_meters || 1.879) / metersPerPx

  const panelRects = (cLat && cLng) ? panels.map((p: any) => {
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return ''
    const xy = project(p.lat, p.lng, cLat, cLng, zoom, sizePx)
    const isLandscape = (p.orientation || 'PORTRAIT') === 'LANDSCAPE'
    const w = isLandscape ? panelHpx : panelWpx
    const h = isLandscape ? panelWpx : panelHpx
    return `<rect x="${xy.x - w/2}" y="${xy.y - h/2}" width="${w}" height="${h}" fill="rgba(59,130,246,0.6)" stroke="rgba(255,255,255,0.95)" stroke-width="4"/>`
  }).join('') : ''

  const obsRects = (cLat && cLng) ? (variant.obstructions || []).map((o: any) => {
    if (typeof o.lat !== 'number' || typeof o.lng !== 'number') return ''
    const xy = project(o.lat, o.lng, cLat, cLng, zoom, sizePx)
    const sz = (o.size_meters || 0.3048) / metersPerPx
    return `<rect x="${xy.x - sz/2}" y="${xy.y - sz/2}" width="${sz}" height="${sz}" fill="rgba(220,38,38,0.5)" stroke="rgba(254,202,202,0.9)" stroke-width="3"/>`
  }).join('') : ''

  // Equipment strings
  const inv = variant.inverter_config || layout.inverter_config
  const bat = variant.battery_config || layout.battery_config
  const invLine = inv ? (inv.type === 'micro'
    ? `${panelCount}× Enphase ${inv.sku} microinverters`
    : `1× SolarEdge ${inv.sku} string inverter`) : 'Inverter: to be selected'
  const batLine = bat && bat.sku ? `${bat.count}× ${bat.sku === 'PW3' ? 'Tesla Powerwall 3' : 'Enphase IQ Battery 5P'} storage` : 'Battery: not included'

  // Rough savings: $0.14/kWh grid rate × annual kWh, with 3%/yr escalation
  const gridRate = 0.14
  const year1 = annualKwh * gridRate
  const yr25Nominal = (() => { let s = 0; for (let y = 0; y < 25; y++) s += year1 * Math.pow(1.03, y); return Math.round(s) })()

  return `
<div class="page">
  <div style="height:6px;background:linear-gradient(90deg,${accent},${accent2})"></div>
  <div style="padding:18px 32px 10px;display:flex;justify-content:space-between;align-items:center">
    <div>
      <div style="font-size:18px;font-weight:900;color:#111">${variant.name || 'Proposal'} <span style="font-size:11px;font-weight:600;color:#64748b;margin-left:6px">${panelCount} panels &middot; ${systemKwDc.toFixed(2)} kW</span></div>
      <div style="font-size:10px;color:#555">${addr}</div>
    </div>
    ${logoHtml}
  </div>

  <div style="padding:0 32px 10px;display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:8px;font-weight:700;color:#92400e;text-transform:uppercase">System Size</div>
      <div style="font-size:22px;font-weight:900;color:#b45309">${systemKwDc.toFixed(2)} kW</div>
    </div>
    <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:8px;font-weight:700;color:#065f46;text-transform:uppercase">Year 1 Production</div>
      <div style="font-size:22px;font-weight:900;color:#047857">${annualKwh.toLocaleString()} kWh</div>
    </div>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:8px;font-weight:700;color:#1e40af;text-transform:uppercase">25-Year Savings</div>
      <div style="font-size:22px;font-weight:900;color:#1d4ed8">$${yr25Nominal.toLocaleString()}</div>
    </div>
    <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;padding:12px;text-align:center">
      <div style="font-size:8px;font-weight:700;color:#5b21b6;text-transform:uppercase">CO&#8322; Offset</div>
      <div style="font-size:22px;font-weight:900;color:#7c3aed">${co2Tons} t/yr</div>
    </div>
  </div>

  <div style="padding:0 32px 10px">
    <div style="font-size:12px;font-weight:800;color:${accent};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;border-bottom:2px solid ${accent};padding-bottom:3px">Panel Layout</div>
    <div style="position:relative;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;background:#000">
      ${satUrl ? `<img src="${satUrl}" style="display:block;width:100%;height:auto" />` : '<div style="padding:80px;color:#94a3b8;text-align:center">No satellite image</div>'}
      <svg viewBox="0 0 ${sizePx} ${sizePx}" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none">
        ${panelRects}
        ${obsRects}
      </svg>
    </div>
  </div>

  <div style="padding:0 32px 10px;display:grid;grid-template-columns:1fr 1fr;gap:14px">
    <div>
      <div style="font-size:11px;font-weight:800;color:${accent};text-transform:uppercase;margin-bottom:6px">Equipment</div>
      <div style="font-size:10px;color:#334155;line-height:1.8">
        <div>&#9679; ${panelCount}× ${watts}W solar panels</div>
        <div>&#9679; ${invLine}</div>
        <div>&#9679; ${batLine}</div>
        <div>&#9679; 25-yr panel &amp; 12-yr inverter warranty</div>
      </div>
    </div>
    <div>
      <div style="font-size:11px;font-weight:800;color:${accent};text-transform:uppercase;margin-bottom:6px">Production &amp; Savings</div>
      <div style="font-size:10px;color:#334155;line-height:1.8">
        <div>&#9679; Year 1: ${annualKwh.toLocaleString()} kWh &rarr; ~$${Math.round(year1).toLocaleString()} saved</div>
        <div>&#9679; 25-yr total: ${lifetimeKwh.toLocaleString()} kWh</div>
        <div>&#9679; Grid rate assumed: $${gridRate.toFixed(2)}/kWh + 3%/yr</div>
        <div>&#9679; CO&#8322; offset: ${(Number(co2Tons) * 25).toFixed(0)} t over 25 yrs</div>
      </div>
    </div>
  </div>

  <div style="position:absolute;bottom:0;left:0;right:0;background:${accent};padding:6px 14px">
    <span style="color:white;font-size:8px;font-weight:600">${footer}</span>
  </div>
</div>`
}

export function generateSolarProposalHTML(args: {
  brand: ProposalBrand
  order: ProposalOrder
  layout: ProposalLayout
  satelliteUrl: string | null
}): string {
  const { brand, order, layout, satelliteUrl } = args
  const accent = hex(brand.primary_color, '#f59e0b')
  const accent2 = hex(brand.secondary_color, '#d97706')
  const addr = [order.property_address, order.property_city, order.property_province, order.property_postal_code].filter(Boolean).join(', ')
  const homeowner = order.homeowner_name || 'Homeowner'
  const rep = order.requester_name || brand.business_name || ''
  const biz = brand.business_name || order.requester_company || 'Solar Proposal'

  const logoHtml = brand.logo_url
    ? `<img src="${brand.logo_url}" alt="${biz}" style="max-height:56px;max-width:180px;object-fit:contain" />`
    : `<div style="font-size:18px;font-weight:900;color:${accent}">${biz}</div>`

  const variants: any[] = (Array.isArray(layout.variants) && layout.variants.length > 0)
    ? layout.variants
    : [{
        name: 'Proposed System',
        panels: (layout.suggested_panels || []).map((p: any) => ({ lat: p.lat, lng: p.lng, orientation: p.orientation })),
        obstructions: layout.obstructions || [],
        inverter_config: layout.inverter_config,
        battery_config: layout.battery_config,
      }]

  const footer = `Prepared for ${homeowner} by ${rep || biz} &middot; ${new Date().toLocaleDateString('en-CA')} &middot; ${biz}${brand.license_number ? ' &middot; Lic ' + brand.license_number : ''}`

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Solar Proposal — ${homeowner}</title>
<style>
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111; background: #f1f5f9; }
  .page { width: 8.5in; min-height: 11in; background: white; position: relative; margin: 24px auto; box-shadow: 0 4px 24px rgba(0,0,0,0.08); page-break-after: always; overflow: hidden; }
  @media print { body { background: white; } .page { margin: 0; box-shadow: none; page-break-after: always; } }
  .cover-hero { height: 3.5in; background: linear-gradient(135deg, ${accent}, ${accent2}); display: flex; align-items: center; justify-content: center; color: white; text-align: center; padding: 0 40px; }
  .cta { display: inline-block; background: ${accent}; color: white; padding: 14px 28px; border-radius: 12px; font-weight: 800; text-decoration: none; margin-top: 16px; }
</style>
</head><body>

<!-- COVER -->
<div class="page">
  <div class="cover-hero">
    <div>
      <div style="font-size:14px;font-weight:700;opacity:0.9;letter-spacing:3px;text-transform:uppercase;margin-bottom:12px">${biz}</div>
      <div style="font-size:44px;font-weight:900;line-height:1.1;margin-bottom:14px">Your Custom Solar Proposal</div>
      <div style="font-size:18px;opacity:0.95">Prepared for <strong>${homeowner}</strong></div>
      <div style="font-size:14px;opacity:0.9;margin-top:6px">${addr}</div>
    </div>
  </div>
  <div style="padding:28px 40px">
    <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1px solid #e2e8f0;padding-bottom:16px;margin-bottom:20px">
      <div>
        <div style="font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase">Sales Representative</div>
        <div style="font-size:18px;font-weight:800;color:#111">${rep || '—'}</div>
        ${brand.phone ? `<div style="font-size:12px;color:#334155;margin-top:4px"><i>&#9743;</i> ${brand.phone}</div>` : ''}
        ${brand.email ? `<div style="font-size:12px;color:#334155"><i>&#9993;</i> ${brand.email}</div>` : ''}
      </div>
      ${logoHtml}
    </div>

    <div style="font-size:13px;color:#334155;line-height:1.7">
      <p>Dear ${homeowner},</p>
      <p>Thank you for the opportunity to design a solar energy system for your home. This proposal presents <strong>${variants.length} custom design option${variants.length > 1 ? 's' : ''}</strong> engineered from detailed satellite imagery of your roof — each sized to your roof geometry, shading, and orientation.</p>
      <p>Every design below includes the real panel layout, projected annual production, 25-year savings, and recommended equipment. Compare the options on the pages that follow, and let me know which one is right for your home.</p>
      <p style="margin-top:20px">Regards,<br/><strong>${rep || biz}</strong></p>
    </div>

    ${variants.length > 1 ? `<div style="margin-top:28px;padding-top:18px;border-top:1px solid #e2e8f0">
      <div style="font-size:12px;font-weight:800;color:${accent};text-transform:uppercase;margin-bottom:10px">Design Options in This Proposal</div>
      <div style="display:grid;grid-template-columns:repeat(${Math.min(variants.length, 3)},1fr);gap:12px">
        ${variants.map((v: any) => {
          const pc = (v.panels || []).length
          const sz = ((pc * (layout.panel_capacity_watts || 400)) / 1000).toFixed(2)
          return `<div style="border:1px solid #e2e8f0;border-radius:10px;padding:14px;background:#fafafa">
            <div style="font-size:13px;font-weight:800;color:#111">${v.name}</div>
            <div style="font-size:20px;font-weight:900;color:${accent};margin-top:4px">${sz} kW</div>
            <div style="font-size:10px;color:#64748b;margin-top:2px">${pc} panels</div>
          </div>`
        }).join('')}
      </div>
    </div>` : ''}
  </div>
  <div style="position:absolute;bottom:0;left:0;right:0;background:${accent};padding:10px 14px;color:white;font-size:10px;font-weight:700;text-align:center">
    ${footer}
  </div>
</div>

${variants.map(v => renderVariantPage(v, layout, satelliteUrl || '', accent, accent2, logoHtml, addr, footer)).join('\n')}

<!-- CLOSING / CALL TO ACTION -->
<div class="page">
  <div style="height:6px;background:linear-gradient(90deg,${accent},${accent2})"></div>
  <div style="padding:48px 40px">
    <div style="font-size:28px;font-weight:900;color:#111;margin-bottom:14px">Ready to move forward?</div>
    <div style="font-size:13px;color:#334155;line-height:1.7;max-width:560px">
      <p>Once you've selected the design that fits your goals, we'll schedule a final site review, submit your permit packet, and coordinate installation — typically 4–8 weeks from signing.</p>
      <p><strong>What's included in every install:</strong></p>
      <ul>
        <li>Licensed electrician + permit filing (structural letter included)</li>
        <li>25-year panel performance warranty</li>
        <li>12-year inverter warranty (25-year on Enphase microinverters)</li>
        <li>10-year workmanship warranty from ${biz}</li>
        <li>System monitoring app + production guarantee</li>
      </ul>
    </div>
    <div style="margin-top:32px;text-align:center">
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700;letter-spacing:1px;margin-bottom:10px">Contact your representative</div>
      <div style="font-size:20px;font-weight:900;color:#111">${rep || biz}</div>
      ${brand.phone ? `<div style="font-size:14px;color:#334155;margin-top:4px">${brand.phone}</div>` : ''}
      ${brand.email ? `<div style="font-size:14px;color:#334155">${brand.email}</div>` : ''}
    </div>
    <div style="margin-top:40px;padding-top:18px;border-top:1px solid #e2e8f0;font-size:9px;color:#94a3b8;line-height:1.6">
      <p>Production estimates based on Google Solar API data + panel layout shown. Actual production may vary due to weather, shading, and equipment performance. Savings calculations assume a grid rate of $0.14/kWh escalating at 3%/yr. All pricing and incentives are subject to final utility and jurisdictional approval.</p>
    </div>
  </div>
  <div style="position:absolute;bottom:0;left:0;right:0;background:${accent};padding:10px 14px;color:white;font-size:10px;font-weight:700;text-align:center">
    ${footer}
  </div>
</div>

</body></html>`
}

// ============================================================
// Phase 2 — Insurance-grade additive template sections.
//
// Every render function returns '' when its data is null/empty so historical
// reports without populated rows render exactly as before. Sections are
// inserted into the existing report HTML by the route handler; the legacy
// generateProfessionalReportHTML signature is unchanged.
// ============================================================
import { escHtml as escapeHtml } from '../utils/html-escape'
import type {
  ClaimMetadata, Penetrations, Flashing, ReportPhoto,
  ExistingMaterial, Decking, Drainage,
} from '../repositories/insurance'

const TEAL = '#00897B'
const TEAL_DARK = '#00695C'
const TEAL_LIGHT = '#E0F2F1'

const fmt = (v: any, suffix = '') => v == null || v === '' ? '—' : `${v}${suffix}`
const num = (v: any, suffix = '') => v == null || v === '' || isNaN(+v) ? '—' : `${(+v).toLocaleString()}${suffix}`
const yn = (v: any) => v ? 'Yes' : 'No'

/** Section: Claim & Adjuster Cover Block */
export function renderClaimBlock(c: ClaimMetadata | null): string {
  if (!c) return ''
  const anyField = c.claim_number || c.policy_number || c.carrier_name || c.adjuster_name
                  || c.date_of_loss || c.peril || c.inspector_name
  if (!anyField) return ''
  return `
<div class="page" style="page-break-before:always">
  <div style="height:6px;background:linear-gradient(90deg,${TEAL},${TEAL_DARK})"></div>
  <div style="padding:18px 28px 8px">
    <div style="font-size:18px;font-weight:900;color:#111">Insurance Claim Cover</div>
    <div style="font-size:9px;color:#666;margin-top:2px">For adjuster review &mdash; matched to property report below.</div>
  </div>
  <div style="padding:8px 28px 0;display:grid;grid-template-columns:1fr 1fr;gap:10px">
    <div style="border:1px solid ${TEAL};background:${TEAL_LIGHT};border-radius:6px;padding:10px 12px">
      <div style="font-size:8px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Carrier &amp; Claim</div>
      <div style="font-size:10px;line-height:1.7">
        <div><span style="color:#555">Carrier:</span> <strong>${escapeHtml(c.carrier_name ?? '—')}</strong></div>
        <div><span style="color:#555">Claim #:</span> <strong>${escapeHtml(c.claim_number ?? '—')}</strong></div>
        <div><span style="color:#555">Policy #:</span> <strong>${escapeHtml(c.policy_number ?? '—')}</strong></div>
        <div><span style="color:#555">Date of Loss:</span> <strong>${escapeHtml(c.date_of_loss ?? '—')}</strong></div>
        <div><span style="color:#555">Peril:</span> <strong>${escapeHtml(c.peril ?? '—')}</strong></div>
      </div>
    </div>
    <div style="border:1px solid ${TEAL};background:${TEAL_LIGHT};border-radius:6px;padding:10px 12px">
      <div style="font-size:8px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Adjuster &amp; Inspector</div>
      <div style="font-size:10px;line-height:1.7">
        <div><span style="color:#555">Adjuster:</span> <strong>${escapeHtml(c.adjuster_name ?? '—')}</strong></div>
        <div><span style="color:#555">Email:</span> <strong>${escapeHtml(c.adjuster_email ?? '—')}</strong></div>
        <div><span style="color:#555">Phone:</span> <strong>${escapeHtml(c.adjuster_phone ?? '—')}</strong></div>
        <div><span style="color:#555">Inspection date:</span> <strong>${escapeHtml(c.inspection_date ?? '—')}</strong></div>
        <div><span style="color:#555">Inspector:</span> <strong>${escapeHtml(c.inspector_name ?? '—')}${c.inspector_license ? ` &middot; Lic. ${escapeHtml(c.inspector_license)}` : ''}</strong></div>
      </div>
    </div>
  </div>
  <div style="padding:14px 28px 0">
    <div style="border-top:1px solid #ddd;padding-top:14px;display:flex;align-items:center;gap:24px">
      <div style="flex:1">
        <div style="font-size:8px;color:#666;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Inspector signature</div>
        <div style="border-bottom:1.5px solid #333;height:36px"></div>
        <div style="font-size:8px;color:#888;margin-top:3px">${c.signed_at ? `Signed ${escapeHtml(c.signed_at)}` : 'Sign on print or in CRM'}</div>
      </div>
      <div style="flex:1">
        <div style="font-size:8px;color:#666;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Insurance-ready status</div>
        <div style="font-size:14px;font-weight:900;color:${c.insurance_ready ? '#0f766e' : '#9a3412'}">
          ${c.insurance_ready ? '&#10003; Adjuster-Ready' : 'Draft &mdash; pending QA'}
        </div>
      </div>
    </div>
  </div>
</div>`
}

/** Section: Inspection Photos gallery */
export function renderPhotosSection(photos: ReportPhoto[]): string {
  if (!photos || photos.length === 0) return ''
  const cells = photos.map(p => `
    <div style="border:1px solid #ddd;border-radius:4px;overflow:hidden;background:#fafafa;page-break-inside:avoid">
      <img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.caption ?? '')}" style="width:100%;height:160px;object-fit:cover;display:block"/>
      <div style="padding:6px 8px;font-size:8px;color:#444;line-height:1.4">
        ${p.caption ? `<div style="font-weight:700;color:#222">${escapeHtml(p.caption)}</div>` : ''}
        <div style="color:#777">${p.category ? escapeHtml(p.category) : 'photo'}${p.taken_at ? ` &middot; ${escapeHtml(p.taken_at)}` : ''}${p.gps_lat != null && p.gps_lng != null ? ` &middot; ${p.gps_lat.toFixed(5)}, ${p.gps_lng.toFixed(5)}` : ''}</div>
      </div>
    </div>`).join('')
  return `
<div class="page" style="page-break-before:always">
  <div style="height:6px;background:linear-gradient(90deg,${TEAL},${TEAL_DARK})"></div>
  <div style="padding:18px 28px 6px">
    <div style="font-size:16px;font-weight:900;color:#111">Inspection Photos</div>
    <div style="font-size:9px;color:#666">Numbered, captioned, dated, GPS-stamped where available. ${photos.length} photo${photos.length === 1 ? '' : 's'}.</div>
  </div>
  <div style="padding:6px 28px 18px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
    ${cells}
  </div>
</div>`
}

/** Section: Penetrations */
export function renderPenetrations(p: Penetrations | null): string {
  if (!p) return ''
  const has = (
    p.pipe_boots_15in || p.pipe_boots_2in || p.pipe_boots_3in || p.pipe_boots_4in
    || p.vents_turtle || p.vents_box || p.vents_ridge || p.vents_turbine || p.vents_power
    || p.skylights_count || p.chimneys_count
  )
  if (!has) return ''
  return `
<div style="padding:14px 28px 0;page-break-inside:avoid">
  <div style="font-size:13px;font-weight:800;color:#111;margin-bottom:6px">Roof Penetrations</div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
    <div style="border:1px solid #ddd;border-radius:4px;padding:8px 10px">
      <div style="font-size:7.5px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;margin-bottom:4px">Pipe Boots</div>
      <table style="font-size:9px;width:100%">
        <tr><td>1.5&quot;</td><td style="text-align:right;font-weight:700">${num(p.pipe_boots_15in)}</td></tr>
        <tr><td>2&quot;</td><td style="text-align:right;font-weight:700">${num(p.pipe_boots_2in)}</td></tr>
        <tr><td>3&quot;</td><td style="text-align:right;font-weight:700">${num(p.pipe_boots_3in)}</td></tr>
        <tr><td>4&quot;</td><td style="text-align:right;font-weight:700">${num(p.pipe_boots_4in)}</td></tr>
      </table>
      <div style="font-size:7px;color:#777;margin-top:4px;font-family:monospace">RFG PIPEJ</div>
    </div>
    <div style="border:1px solid #ddd;border-radius:4px;padding:8px 10px">
      <div style="font-size:7.5px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;margin-bottom:4px">Vents</div>
      <table style="font-size:9px;width:100%">
        <tr><td>Turtle</td><td style="text-align:right;font-weight:700">${num(p.vents_turtle)}</td></tr>
        <tr><td>Box</td><td style="text-align:right;font-weight:700">${num(p.vents_box)}</td></tr>
        <tr><td>Ridge</td><td style="text-align:right;font-weight:700">${num(p.vents_ridge)}</td></tr>
        <tr><td>Turbine</td><td style="text-align:right;font-weight:700">${num(p.vents_turbine)}</td></tr>
        <tr><td>Power</td><td style="text-align:right;font-weight:700">${num(p.vents_power)}</td></tr>
      </table>
      <div style="font-size:7px;color:#777;margin-top:4px;font-family:monospace">RFG VENTH / VENTRC / VENTT</div>
    </div>
    <div style="border:1px solid #ddd;border-radius:4px;padding:8px 10px">
      <div style="font-size:7.5px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;margin-bottom:4px">Skylights / Chimneys</div>
      <table style="font-size:9px;width:100%">
        <tr><td>Skylights</td><td style="text-align:right;font-weight:700">${num(p.skylights_count)}</td></tr>
        <tr><td>Chimneys</td><td style="text-align:right;font-weight:700">${num(p.chimneys_count)}</td></tr>
      </table>
      <div style="font-size:7px;color:#777;margin-top:4px;font-family:monospace">RFG SKY / RFG CHM*</div>
    </div>
  </div>
  ${p.notes ? `<div style="margin-top:6px;font-size:8px;color:#555"><strong>Notes:</strong> ${escapeHtml(p.notes)}</div>` : ''}
</div>`
}

/** Section: Flashing breakdown by type */
export function renderFlashing(f: Flashing | null): string {
  if (!f) return ''
  const has = (f.step_lf || f.headwall_lf || f.sidewall_lf || f.counter_lf
    || f.chimney_apron_lf || f.chimney_step_lf || f.chimney_counter_lf || f.chimney_cricket_lf
    || f.skylight_kits || f.kickout_count)
  if (!has) return ''
  return `
<div style="padding:14px 28px 0;page-break-inside:avoid">
  <div style="font-size:13px;font-weight:800;color:#111;margin-bottom:6px">Flashing Detail</div>
  <table style="width:100%;border-collapse:collapse;font-size:9px">
    <thead>
      <tr style="background:#1a1a2e;color:#fff">
        <th style="padding:5px 8px;text-align:left;font-size:7.5px;width:30%">Type</th>
        <th style="padding:5px 8px;text-align:right;font-size:7.5px;width:14%">Quantity</th>
        <th style="padding:5px 8px;text-align:left;font-size:7.5px;width:14%">Unit</th>
        <th style="padding:5px 8px;text-align:left;font-size:7.5px;width:18%;font-family:monospace">Xactimate</th>
        <th style="padding:5px 8px;text-align:left;font-size:7.5px;width:24%">Notes</th>
      </tr>
    </thead>
    <tbody>
      ${row('Step Flashing', f.step_lf, 'LF', 'RFG STPFL')}
      ${row('Headwall Flashing', f.headwall_lf, 'LF', 'RFG HWALL')}
      ${row('Sidewall Flashing', f.sidewall_lf, 'LF', 'RFG SWALL')}
      ${row('Counter Flashing', f.counter_lf, 'LF', 'RFG CTRFL')}
      ${row('Chimney — Apron', f.chimney_apron_lf, 'LF', 'RFG CHMAP')}
      ${row('Chimney — Step', f.chimney_step_lf, 'LF', 'RFG CHMST')}
      ${row('Chimney — Counter', f.chimney_counter_lf, 'LF', 'RFG CHMCT')}
      ${row('Chimney — Cricket', f.chimney_cricket_lf, 'LF', 'RFG CHMCK')}
      ${row('Skylight Kits', f.skylight_kits, 'kits', 'RFG SKYFL')}
      ${row('Kickout Flashings', f.kickout_count, 'ea', 'RFG KICKO')}
    </tbody>
  </table>
  ${f.notes ? `<div style="margin-top:6px;font-size:8px;color:#555"><strong>Notes:</strong> ${escapeHtml(f.notes)}</div>` : ''}
</div>`
  function row(label: string, qty: any, unit: string, code: string) {
    if (qty == null || qty === '' || +qty === 0) return ''
    return `<tr style="border-bottom:1px solid #eee">
      <td style="padding:4px 8px;font-weight:700">${escapeHtml(label)}</td>
      <td style="padding:4px 8px;text-align:right;font-weight:700;color:${TEAL_DARK}">${num(qty)}</td>
      <td style="padding:4px 8px;color:#666">${unit}</td>
      <td style="padding:4px 8px;font-family:monospace;font-size:8px;color:#1a1a2e">${code}</td>
      <td style="padding:4px 8px;color:#777"></td>
    </tr>`
  }
}

/** Section: Existing material survey & condition */
export function renderExistingMaterial(e: ExistingMaterial | null): string {
  if (!e) return ''
  const any = e.material_type || e.manufacturer || e.color || e.age_years != null
              || e.layers_count != null || e.test_squares_count != null
              || e.damage_hail || e.damage_wind_lift || e.damage_granule_loss
              || e.damage_blistering || e.damage_nail_pops || e.damage_sealant_failure
              || e.damage_other
  if (!any) return ''
  const damages: string[] = []
  if (e.damage_hail) damages.push('Hail')
  if (e.damage_wind_lift) damages.push('Wind lift')
  if (e.damage_granule_loss) damages.push('Granule loss')
  if (e.damage_blistering) damages.push('Blistering')
  if (e.damage_nail_pops) damages.push('Nail pops')
  if (e.damage_sealant_failure) damages.push('Sealant failure')
  if (e.damage_other) damages.push(escapeHtml(e.damage_other))
  return `
<div style="padding:14px 28px 0;page-break-inside:avoid">
  <div style="font-size:13px;font-weight:800;color:#111;margin-bottom:6px">Existing Material &amp; Condition</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
    <div style="border:1px solid #ddd;border-radius:4px;padding:8px 10px">
      <div style="font-size:7.5px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;margin-bottom:4px">Material</div>
      <div style="font-size:9.5px;line-height:1.7">
        <div><span style="color:#555">Type:</span> <strong>${escapeHtml(e.material_type ?? '—')}</strong></div>
        <div><span style="color:#555">Manufacturer:</span> <strong>${escapeHtml(e.manufacturer ?? '—')}</strong></div>
        <div><span style="color:#555">Color:</span> <strong>${escapeHtml(e.color ?? '—')}</strong></div>
        <div><span style="color:#555">Age:</span> <strong>${e.age_years != null ? e.age_years + ' yrs' : '—'}</strong></div>
        <div><span style="color:#555">Layers:</span> <strong>${fmt(e.layers_count)}</strong></div>
        <div><span style="color:#555">Test squares:</span> <strong>${fmt(e.test_squares_count)}</strong></div>
        <div><span style="color:#555">ITEL recommended:</span> <strong>${e.itel_match_recommended ? 'Yes' : 'No'}</strong></div>
      </div>
    </div>
    <div style="border:1px solid #ddd;border-radius:4px;padding:8px 10px">
      <div style="font-size:7.5px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;margin-bottom:4px">Damage observed</div>
      <div style="font-size:9.5px">${damages.length ? damages.map(d => `<span style="display:inline-block;margin:2px 4px 2px 0;padding:2px 8px;background:#fef3c7;color:#92400e;border-radius:3px;font-weight:700;font-size:8px">${d}</span>`).join('') : '<span style="color:#666">None observed</span>'}</div>
    </div>
  </div>
  ${e.notes ? `<div style="margin-top:6px;font-size:8px;color:#555"><strong>Notes:</strong> ${escapeHtml(e.notes)}</div>` : ''}
</div>`
}

/** Section: Decking & ventilation */
export function renderDecking(d: Decking | null): string {
  if (!d) return ''
  const any = d.sheathing_type || d.sheathing_thickness_in != null
              || d.underlayment_layers != null || d.ventilation_type || d.ventilation_nfa_in2 != null
  if (!any) return ''
  return `
<div style="padding:14px 28px 0;page-break-inside:avoid">
  <div style="font-size:13px;font-weight:800;color:#111;margin-bottom:6px">Decking &amp; Ventilation</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
    <div style="border:1px solid #ddd;border-radius:4px;padding:8px 10px">
      <div style="font-size:7.5px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;margin-bottom:4px">Sheathing</div>
      <div style="font-size:9.5px;line-height:1.7">
        <div><span style="color:#555">Type:</span> <strong>${escapeHtml(d.sheathing_type ?? '—')}</strong></div>
        <div><span style="color:#555">Thickness:</span> <strong>${d.sheathing_thickness_in != null ? d.sheathing_thickness_in + '&quot;' : '—'}</strong></div>
        <div><span style="color:#555">Existing underlayment layers:</span> <strong>${fmt(d.underlayment_layers)}</strong></div>
      </div>
    </div>
    <div style="border:1px solid #ddd;border-radius:4px;padding:8px 10px">
      <div style="font-size:7.5px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;margin-bottom:4px">Ventilation (IRC 806)</div>
      <div style="font-size:9.5px;line-height:1.7">
        <div><span style="color:#555">Type:</span> <strong>${escapeHtml(d.ventilation_type ?? '—')}</strong></div>
        <div><span style="color:#555">Net Free Area:</span> <strong>${d.ventilation_nfa_in2 != null ? d.ventilation_nfa_in2 + ' in²' : '—'}</strong></div>
      </div>
    </div>
  </div>
  ${d.notes ? `<div style="margin-top:6px;font-size:8px;color:#555"><strong>Notes:</strong> ${escapeHtml(d.notes)}</div>` : ''}
</div>`
}

/** Section: Drainage (low-slope only) */
export function renderDrainage(dr: Drainage | null): string {
  if (!dr) return ''
  const any = dr.scuppers_count != null || dr.drains_count != null || dr.parapet_lf != null || dr.coping_lf != null
  if (!any) return ''
  return `
<div style="padding:14px 28px 0;page-break-inside:avoid">
  <div style="font-size:13px;font-weight:800;color:#111;margin-bottom:6px">Drainage &amp; Perimeter (Low-Slope)</div>
  <table style="width:100%;border-collapse:collapse;font-size:9px">
    <thead>
      <tr style="background:#1a1a2e;color:#fff">
        <th style="padding:5px 8px;text-align:left;font-size:7.5px">Item</th>
        <th style="padding:5px 8px;text-align:right;font-size:7.5px">Quantity</th>
        <th style="padding:5px 8px;text-align:left;font-size:7.5px">Unit</th>
        <th style="padding:5px 8px;text-align:left;font-size:7.5px;font-family:monospace">Xactimate</th>
      </tr>
    </thead>
    <tbody>
      ${dr.scuppers_count ? `<tr><td style="padding:4px 8px;font-weight:700">Scuppers</td><td style="padding:4px 8px;text-align:right;font-weight:700;color:${TEAL_DARK}">${num(dr.scuppers_count)}</td><td style="padding:4px 8px">ea</td><td style="padding:4px 8px;font-family:monospace;font-size:8px">RFG SCUPP</td></tr>` : ''}
      ${dr.drains_count ? `<tr><td style="padding:4px 8px;font-weight:700">Roof Drains</td><td style="padding:4px 8px;text-align:right;font-weight:700;color:${TEAL_DARK}">${num(dr.drains_count)}</td><td style="padding:4px 8px">ea</td><td style="padding:4px 8px;font-family:monospace;font-size:8px">RFG DRAIN</td></tr>` : ''}
      ${dr.parapet_lf ? `<tr><td style="padding:4px 8px;font-weight:700">Parapet Wall</td><td style="padding:4px 8px;text-align:right;font-weight:700;color:${TEAL_DARK}">${num(dr.parapet_lf)}</td><td style="padding:4px 8px">LF</td><td style="padding:4px 8px;font-family:monospace;font-size:8px">RFG PARAP</td></tr>` : ''}
      ${dr.coping_lf ? `<tr><td style="padding:4px 8px;font-weight:700">Coping</td><td style="padding:4px 8px;text-align:right;font-weight:700;color:${TEAL_DARK}">${num(dr.coping_lf)}</td><td style="padding:4px 8px">LF</td><td style="padding:4px 8px;font-family:monospace;font-size:8px">RFG COPNG</td></tr>` : ''}
    </tbody>
  </table>
  ${dr.notes ? `<div style="margin-top:6px;font-size:8px;color:#555"><strong>Notes:</strong> ${escapeHtml(dr.notes)}</div>` : ''}
</div>`
}

/** Status badge for the existing report (top-right corner). Visible only when claim metadata exists. */
export function renderStatusBadge(c: ClaimMetadata | null): string {
  if (!c) return ''
  const ready = !!c.insurance_ready
  return `<div style="position:absolute;top:10px;right:14px;z-index:10;padding:4px 10px;background:${ready ? '#0f766e' : '#9a3412'};color:#fff;border-radius:3px;font-size:8px;font-weight:800;letter-spacing:0.4px;text-transform:uppercase">${ready ? '&#10003; Adjuster-Ready' : 'Draft'}</div>`
}

/** All insurance sections appended to the report HTML in adjuster order. */
export function renderInsuranceAppendix(ext: {
  claim: ClaimMetadata | null
  penetrations: Penetrations | null
  flashing: Flashing | null
  photos: ReportPhoto[]
  existing: ExistingMaterial | null
  decking: Decking | null
  drainage: Drainage | null
}): string {
  const parts: string[] = []
  // Cover page first
  const cover = renderClaimBlock(ext.claim)
  if (cover) parts.push(cover)
  const photos = renderPhotosSection(ext.photos)
  if (photos) parts.push(photos)
  // Field-detail block (penetrations + flashing + existing material + decking + drainage)
  const fieldChunks = [
    renderPenetrations(ext.penetrations),
    renderFlashing(ext.flashing),
    renderExistingMaterial(ext.existing),
    renderDecking(ext.decking),
    renderDrainage(ext.drainage),
  ].filter(Boolean)
  if (fieldChunks.length) {
    parts.push(`<div class="page" style="page-break-before:always"><div style="height:6px;background:linear-gradient(90deg,${TEAL},${TEAL_DARK})"></div><div style="padding:18px 28px 6px"><div style="font-size:16px;font-weight:900;color:#111">Field Detail</div><div style="font-size:9px;color:#666">Adjuster-grade detail captured during inspection.</div></div>${fieldChunks.join('')}</div>`)
  }
  return parts.join('\n')
}

// ============================================================
// Roof Manager — CUSTOMER-FACING report (no measurements)
// Built alongside the regular report. Shows ONLY:
//   1) The aerial / satellite image of the property
//   2) The 2D top-down roof diagram (no labels)
// No areas, lengths, pitches, edge counts, or material totals appear
// anywhere in the document or its embedded SVGs. The intent is that
// the homeowner can see what was measured without being able to hand
// the measurements themselves to a competing roofer.
// ============================================================

import type { RoofReport } from '../types'
import {
  generateTraceBasedDiagramSVG,
  generateLengthDiagramSVG, generatePitchDiagramSVG2,
  generateAreaDiagramSVG, generateNotesDiagramSVG,
} from './svg-diagrams'

const escapeHtml = (s: string): string =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

export function generateCustomerReportHTML(report: RoofReport): string {
  const property = report.property || ({} as any)
  const address = property.address || property.formatted_address || 'Property'
  const homeowner = property.homeowner_name || ''
  const orderNumber = property.order_number || ''
  const reportDate = property.report_date || new Date().toISOString().slice(0, 10)

  const satUrl =
    (report as any).imagery?.oblique_3d_url ||
    report.imagery?.satellite_overhead_url ||
    report.imagery?.satellite_url ||
    null

  // 2D — re-render from the raw trace with hideMeasurements:true so no
  // dimension labels appear. The route stashes the parsed trace on
  // reportData.customer_trace_input before calling this template. We
  // generate the 4-page EagleView-style sequence (Length / Pitch / Area /
  // Notes), all with hideMeasurements:true so no quantitative info leaks.
  let twoDSVG = ''
  let lengthSVG = '', pitchSVG = '', areaSVG = '', notesSVG = ''
  try {
    const trace = (report as any).customer_trace_input || null
    if (trace) {
      const traceInput = {
        eaves: trace.eaves || [],
        eaves_sections: trace.eaves_sections || undefined,
        eaves_section_pitches: trace.eaves_section_pitches || undefined,
        eaves_section_kinds: trace.eaves_section_kinds || undefined,
        ridges: trace.ridges || [],
        hips: trace.hips || [],
        valleys: trace.valleys || [],
        walls: trace.walls,
        dormers: trace.dormers || undefined,
        cutouts: trace.cutouts || undefined,
        annotations: trace.annotations || {},
      }
      const baseEdge = { total_ridge_ft: 0, total_hip_ft: 0, total_valley_ft: 0, total_eave_ft: 0, total_rake_ft: 0 }
      const opts = { hideMeasurements: true }
      twoDSVG   = generateTraceBasedDiagramSVG(traceInput, baseEdge, 0, 0, '', 0, 0, opts)
      lengthSVG = generateLengthDiagramSVG(traceInput, baseEdge, 0, 0, '', 0, 0, opts)
      pitchSVG  = generatePitchDiagramSVG2(traceInput, baseEdge, 0, 0, '', 0, 0, opts)
      areaSVG   = generateAreaDiagramSVG(traceInput, baseEdge, 0, 0, '', 0, 0, opts)
      notesSVG  = generateNotesDiagramSVG(traceInput, baseEdge, 0, 0, '', 0, 0, opts)
    }
  } catch {
    twoDSVG = ''
  }

  const css = `
    *,*::before,*::after{box-sizing:border-box}
    html,body{margin:0;padding:0;background:#f1f5f9;color:#0f172a;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased}
    .page{max-width:880px;margin:0 auto;padding:32px 28px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.06);border-radius:8px}
    .page+.page{margin-top:24px}
    .brand{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #0f172a;padding-bottom:14px;margin-bottom:20px}
    .brand .logo{font-size:18px;font-weight:800;letter-spacing:.4px;color:#0f172a}
    .brand .meta{font-size:12px;color:#475569;text-align:right;line-height:1.5}
    h1{font-size:22px;margin:0 0 6px;font-weight:800;color:#0f172a}
    .addr{font-size:14px;color:#334155;margin:0 0 18px}
    h2{font-size:16px;margin:0 0 12px;font-weight:700;color:#0f172a;letter-spacing:.3px;text-transform:uppercase}
    .frame{border:1px solid #e2e8f0;border-radius:6px;background:#fff;padding:8px;display:flex;justify-content:center;align-items:center}
    .frame img{max-width:100%;height:auto;display:block;border-radius:4px}
    .frame svg{max-width:100%;height:auto;display:block}
    .note{font-size:12px;color:#64748b;margin-top:10px;line-height:1.5}
    .footer{margin-top:28px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b;display:flex;justify-content:space-between;align-items:center}
    .stamp{display:inline-block;background:#0f172a;color:#fff;padding:4px 10px;border-radius:999px;font-size:10px;letter-spacing:1px;font-weight:700}
    @media print{body{background:#fff}.page{box-shadow:none;border-radius:0;margin:0;max-width:100%}}
  `

  const sectionSatellite = satUrl
    ? `
    <section class="page">
      <h2>Property Aerial</h2>
      <div class="frame"><img src="${escapeHtml(satUrl)}" alt="Property aerial view"/></div>
      <p class="note">Aerial imagery of the property used as the reference for this measurement order.</p>
    </section>`
    : ''

  const section2D = twoDSVG
    ? `
    <section class="page">
      <h2>2D Roof Diagram</h2>
      <div class="frame">${twoDSVG}</div>
      <p class="note">Top-down diagram of the roof outline and ridge / hip / valley layout.</p>
    </section>`
    : ''

  // EagleView-style 4-page sequence — each page focuses on one aspect of the
  // roof. All measurements suppressed (hideMeasurements:true) so the customer
  // sees what was traced without exposing quantitative data.
  const sectionLength = lengthSVG ? `
    <section class="page">
      <h2>Length Diagram</h2>
      <div class="frame">${lengthSVG}</div>
      <p class="note">Roof edges color-coded by type (eaves, rakes, ridges, hips, valleys).</p>
    </section>` : ''
  const sectionPitch = pitchSVG ? `
    <section class="page">
      <h2>Pitch Diagram</h2>
      <div class="frame">${pitchSVG}</div>
      <p class="note">Each facet shaded by pitch class. Arrows point downslope.</p>
    </section>` : ''
  const sectionArea = areaSVG ? `
    <section class="page">
      <h2>Area Diagram</h2>
      <div class="frame">${areaSVG}</div>
      <p class="note">Per-facet roof areas with a 10ft × 10ft squares grid for scale.</p>
    </section>` : ''
  const sectionNotes = notesSVG ? `
    <section class="page">
      <h2>Notes Diagram</h2>
      <div class="frame">${notesSVG}</div>
      <p class="note">Roof penetrations: chimneys, vents, skylights, pipe boots, downspouts.</p>
    </section>` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Roof Report — ${escapeHtml(address)}</title>
  <style>${css}</style>
</head>
<body>
  <section class="page">
    <div class="brand">
      <div class="logo"><img src="https://www.roofmanager.ca/static/logo.png?v=20260504" alt="Roof Manager" style="height:48px;width:auto;display:block"/></div>
      <div class="meta">
        ${orderNumber ? `Report #${escapeHtml(orderNumber)}<br/>` : ''}
        ${escapeHtml(reportDate)}
      </div>
    </div>
    <h1>Customer Roof Report</h1>
    <p class="addr">${escapeHtml(address)}${homeowner ? ` &middot; ${escapeHtml(homeowner)}` : ''}</p>
    <p class="note"><span class="stamp">CUSTOMER COPY</span> &nbsp; This summary shows the property aerial and the roof diagrams produced for this order. Detailed measurements, edge lengths and material take-off are provided to your roofing contractor in a separate document.</p>
  </section>
  ${sectionSatellite}
  ${sectionLength}
  ${sectionPitch}
  ${sectionArea}
  ${sectionNotes}
  <section class="page">
    <div class="footer">
      <div>Generated by Roof Manager &middot; roofmanager.ca</div>
      <div>${escapeHtml(reportDate)}</div>
    </div>
  </section>
</body>
</html>`
}

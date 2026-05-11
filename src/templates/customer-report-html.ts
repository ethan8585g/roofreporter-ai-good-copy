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
import { generateTraceBasedDiagramSVG } from './svg-diagrams'
import { generateAllStructureSVGs } from './svg-3d-diagram'

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

  // Per-structure 3D + 2D diagrams. The 3D axo is rendered with
  // showDimensions:false so no edge-length callouts appear, and the 2D
  // plan view uses hideMeasurements:true. Customer sees the geometry,
  // never the numbers.
  type StructureSvgs = { label: string; axo: string; plan: string }
  const perStructure: StructureSvgs[] = []
  try {
    const structureDiagrams = generateAllStructureSVGs(report, { showDimensions: false })
    for (const { partition, svg: axoSvg } of structureDiagrams) {
      const planSvg = generateTraceBasedDiagramSVG(
        {
          eaves: partition.eaves,
          eaves_sections: [partition.eaves],
          ridges: partition.ridges,
          hips: partition.hips,
          valleys: partition.valleys,
        },
        { total_ridge_ft: 0, total_hip_ft: 0, total_valley_ft: 0, total_eave_ft: 0, total_rake_ft: 0 },
        0, 0, '', 0, 0,
        { hideMeasurements: true },
      )
      perStructure.push({ label: partition.label, axo: axoSvg, plan: planSvg })
    }
  } catch {
    /* fall through to legacy single-2D below */
  }

  // Legacy single-2D fallback — only used when structure splitting fails
  // (e.g. no roof_trace on the report). Re-renders from customer_trace_input
  // with hideMeasurements:true so no dimension labels appear.
  let fallback2DSVG = ''
  if (perStructure.length === 0) {
    try {
      const trace = (report as any).customer_trace_input || null
      if (trace) {
        fallback2DSVG = generateTraceBasedDiagramSVG(
          {
            eaves: trace.eaves || [],
            eaves_sections: trace.eaves_sections || undefined,
            eaves_section_pitches: trace.eaves_section_pitches || undefined,
            eaves_section_kinds: trace.eaves_section_kinds || undefined,
            ridges: trace.ridges || [],
            hips: trace.hips || [],
            valleys: trace.valleys || [],
            dormers: trace.dormers || undefined,
            cutouts: trace.cutouts || undefined,
          },
          { total_ridge_ft: 0, total_hip_ft: 0, total_valley_ft: 0, total_eave_ft: 0, total_rake_ft: 0 },
          0, 0, '', 0, 0,
          { hideMeasurements: true },
        )
      }
    } catch {
      fallback2DSVG = ''
    }
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
    /* Cap per-structure diagrams so each section fits on screen and prints
       cleanly. Without these, the axo (1200×750) renders ~4.7in tall and
       the 2D plan (700×700) renders ~7.5in tall — too dominant. */
    .frame-axo{height:320px;overflow:hidden}
    .frame-axo svg{max-height:320px !important;width:auto !important;height:auto !important}
    .frame-plan{height:360px;overflow:hidden}
    .frame-plan svg{max-height:360px !important;width:auto !important;height:auto !important}
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

  const sectionsPerStructure = perStructure.length > 0
    ? perStructure.map(s => `
    <section class="page">
      <h2>${escapeHtml(s.label)} &mdash; 3D View</h2>
      <div class="frame frame-axo">${s.axo}</div>
      <p class="note">Three-dimensional view of the roof geometry with pitch-shaded facets.</p>
      <h2 style="margin-top:24px">${escapeHtml(s.label)} &mdash; 2D Plan View</h2>
      <div class="frame frame-plan">${s.plan}</div>
      <p class="note">Top-down outline showing ridge, hip and valley layout.</p>
    </section>`).join('')
    : ''

  const sectionFallback2D = fallback2DSVG
    ? `
    <section class="page">
      <h2>2D Roof Diagram</h2>
      <div class="frame">${fallback2DSVG}</div>
      <p class="note">Top-down diagram of the roof outline and ridge / hip / valley layout.</p>
    </section>`
    : ''

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
  ${sectionsPerStructure}
  ${sectionFallback2D}
  <section class="page">
    <div class="footer">
      <div>Generated by Roof Manager &middot; roofmanager.ca</div>
      <div>${escapeHtml(reportDate)}</div>
    </div>
  </section>
</body>
</html>`
}

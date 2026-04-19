// ============================================================
// Roof Manager — Professional Report HTML Templates v6.0
// Simple 2-page measurement report (RoofScope / EagleView style)
// Page 1: Project Totals + Aerial Image + Waste Factor Table
// Page 2: Roof Area Analysis Diagram + Edge/Area Tables
// ============================================================

import type {
  RoofReport, RoofSegment, EdgeMeasurement, AIMeasurementAnalysis,
  PerimeterPoint, VisionFindings
} from '../types'
import {
  pitchToRatio, feetToFeetInches, smartEdgeFootage, SEGMENT_COLORS
} from '../utils/geo-math'
import {
  generateSatelliteOverlaySVG, generateOverlayLegend, generateBlueprintSVG,
  generateArchitecturalDiagramSVG, generatePreciseAIOverlaySVG,
  generateSquaresGridDiagramSVG
} from './svg-diagrams'

export function generateProfessionalReportHTML(report: RoofReport): string {
  // ── Safe defaults ──
  const prop = report.property || { address: 'Unknown' } as any
  const mat = report.materials || { net_area_sqft: 0, gross_squares: 0, bundle_count: 0, line_items: [], waste_table: [], waste_pct: 15, gross_area_sqft: 0, total_material_cost_cad: 0, complexity_class: 'simple', complexity_factor: 1, shingle_type: 'architectural' } as any
  const es = report.edge_summary || { total_ridge_ft: 0, total_hip_ft: 0, total_valley_ft: 0, total_eave_ft: 0, total_rake_ft: 0, total_linear_ft: 0, total_step_flashing_ft: 0, total_wall_flashing_ft: 0, total_transition_ft: 0, total_parapet_ft: 0 } as any
  if (!report.total_true_area_sqft) report.total_true_area_sqft = report.total_footprint_sqft || 1
  if (!report.total_footprint_sqft) report.total_footprint_sqft = report.total_true_area_sqft || 1
  if (!report.area_multiplier) report.area_multiplier = report.total_true_area_sqft / (report.total_footprint_sqft || 1)
  if (!report.generated_at) report.generated_at = new Date().toISOString() as any
  if (!report.segments) report.segments = []
  if (!report.edges) report.edges = []

  // ── Computed values ──
  const reportNum = `${String(report.order_id).padStart(8, '0')}`
  const reportDate = new Date(report.generated_at).toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })
  const fullAddress = [prop.address, prop.city, prop.province, prop.postal_code].filter(Boolean).join(', ')
  // All areas in square feet (no roofing squares)
  const netAreaSF = Math.round(report.total_true_area_sqft)
  const grossAreaSF = Math.round(report.total_true_area_sqft * (1 + (mat.waste_pct || 15) / 100))
  const totalPerimeter = es.total_eave_ft + es.total_rake_ft
  const ridgeHipFt = es.total_ridge_ft + es.total_hip_ft
  const totalLinearFt = es.total_ridge_ft + es.total_hip_ft + es.total_valley_ft + es.total_eave_ft + es.total_rake_ft
  const stepFlashingFt = es.total_step_flashing_ft || 0
  const wallFlashingFt = es.total_wall_flashing_ft || 0
  const slopeChangeFt = es.total_transition_ft || 0

  // Predominant pitch
  const largestSeg = [...report.segments].sort((a, b) => b.true_area_sqft - a.true_area_sqft)[0]
  const predominantPitch = largestSeg?.pitch_ratio || report.roof_pitch_ratio || '0:12'
  const predominantPitchDeg = largestSeg?.pitch_degrees || report.roof_pitch_degrees || 0

  // Slope classification by segment — in square feet
  // Industry-standard ranges: Flat 0-2:12, Low 2-4:12, Standard 4-9:12, Steep 9:12+
  const slopeClasses = { standard: 0, flat: 0, low: 0, steep: 0, high_roof: 0 }
  const segFaceLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  report.segments.forEach(seg => {
    const pitchDeg = seg.pitch_degrees || 0
    const rise = 12 * Math.tan(pitchDeg * Math.PI / 180)
    const sf = Math.round(seg.true_area_sqft)
    if (isNaN(rise) || rise <= 2) slopeClasses.flat += sf
    else if (rise <= 4) slopeClasses.low += sf
    else if (rise <= 9) slopeClasses.standard += sf
    else slopeClasses.steep += sf
    if ((seg.plane_height_meters || 0) > 3.5) slopeClasses.high_roof += sf
  })

  // IWB (Ice & Water Barrier) — eave-line × 3ft depth
  const iwbSqFt = Math.round(es.total_eave_ft * 3 * 10) / 10

  // Satellite image — prefer eagle-view if available, then enhanced satellite, then standard
  const eagleViewUrl = (report as any).eagle_view_image?.data_url
    || (report as any).report_showcase_images?.enhanced_satellite
    || ''
  const satelliteUrl = report.imagery?.satellite_url || ''
  const overheadUrl = eagleViewUrl || report.imagery?.satellite_overhead_url || satelliteUrl

  // ── Per-structure breakdown (house + detached garage/shed/etc.) ──
  // Computed from roof_trace GPS coordinates so each traced building gets its own measurement row.
  const rt: any = (report as any).roof_trace
  const structuresBreakdown: { label: string; footprint_sf: number; true_area_sf: number; perimeter_ft: number; squares: number }[] = []
  if (rt && Array.isArray(rt.eaves_sections) && rt.eaves_sections.length >= 1) {
    const allSections: { lat: number; lng: number }[][] = rt.eaves_sections.filter((s: any) => Array.isArray(s) && s.length >= 3)
    if (allSections.length >= 2) {
      const meanLat = allSections[0].reduce((s, p) => s + p.lat, 0) / allSections[0].length
      const FT_PER_DEG_LAT = 364000
      const ftPerDegLng = FT_PER_DEG_LAT * Math.cos(meanLat * Math.PI / 180)
      const slopeMult = report.area_multiplier && report.area_multiplier > 0 ? report.area_multiplier : 1
      const sorted = allSections
        .map(pts => {
          const xy = pts.map(p => ({ x: (p.lng - allSections[0][0].lng) * ftPerDegLng, y: (p.lat - meanLat) * FT_PER_DEG_LAT }))
          let a = 0, perim = 0
          for (let i = 0; i < xy.length; i++) {
            const j = (i + 1) % xy.length
            a += xy[i].x * xy[j].y - xy[j].x * xy[i].y
            perim += Math.hypot(xy[j].x - xy[i].x, xy[j].y - xy[i].y)
          }
          return { footprint: Math.abs(a) / 2, perim }
        })
        .sort((a, b) => b.footprint - a.footprint)
      const structureNames = ['Main House', 'Detached Structure', 'Additional Structure', 'Additional Structure', 'Additional Structure']
      sorted.forEach((s, i) => {
        const trueArea = s.footprint * slopeMult
        structuresBreakdown.push({
          label: `Structure ${i + 1} — ${structureNames[i] || 'Additional Structure'}`,
          footprint_sf: Math.round(s.footprint),
          true_area_sf: Math.round(trueArea),
          perimeter_ft: Math.round(s.perim * 10) / 10,
          squares: Math.round(trueArea / 100 * 10) / 10,
        })
      })
    }
  }

  // ── Waste factor table (4% through 15%) — in square feet ──
  const wastePercentages = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
  const wasteTable = wastePercentages.map(pct => ({
    pct,
    sf: Math.round(report.total_true_area_sqft * (1 + pct / 100)).toLocaleString()
  }))

  // ── Architectural Diagram SVG ──
  const facetColors = ['#E84393', '#4A90D9', '#5CB85C', '#F5A623', '#9B59B6', '#E8634A', '#2ECC71', '#F39C12', '#3498DB', '#8E44AD', '#E67E22', '#27AE60']
  let architecturalDiagramSVG: string
  if ((report as any).trace_diagram_svg) {
    architecturalDiagramSVG = (report as any).trace_diagram_svg
  } else {
    architecturalDiagramSVG = generateArchitecturalDiagramSVG(
      report.ai_geometry, report.segments, report.edges, es,
      report.total_footprint_sqft, report.roof_pitch_degrees || predominantPitchDeg || 20,
      predominantPitch, grossAreaSF
    )
  }

  // ── Edge summary by type for Page 2 table ──
  const edgesByType: Record<string, { count: number; totalFt: number }> = {}
  report.edges.forEach(e => {
    if (!edgesByType[e.edge_type]) edgesByType[e.edge_type] = { count: 0, totalFt: 0 }
    edgesByType[e.edge_type].count++
    edgesByType[e.edge_type].totalFt += e.true_length_ft
  })

  // Edge type display config — Industry Standard Color Coding
  // Red = Ridge, Green = Eave, Blue = Valley, Orange = Hip, Purple = Rake
  const edgeTypeConfig: Record<string, { label: string; color: string }> = {
    eave: { label: 'Eaves', color: '#16A34A' },
    ridge: { label: 'Ridges', color: '#DC2626' },
    hip: { label: 'Hips', color: '#EA580C' },
    valley: { label: 'Valleys', color: '#2563EB' },
    rake: { label: 'Rake Edges', color: '#7C3AED' },
    step_flashing: { label: 'Step Flashing', color: '#F59E0B' },
    wall_flashing: { label: 'Wall Flashing', color: '#8B5CF6' },
    transition: { label: 'Slope Change', color: '#0891B2' },
    parapet: { label: 'Parapet', color: '#78716C' }
  }

  // ── TEAL accent color (from template Page 1) ──
  const TEAL = '#00897B'
  const TEAL_DARK = '#00695C'
  const TEAL_LIGHT = '#E0F2F1'
  // RED accent (from template Page 2)
  const RED = '#B71C1C'
  const RED_LIGHT = '#FFEBEE'

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Roof Manager Roof Report | ${fullAddress}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:#fff;color:#1a1a2e;font-size:9.5pt;line-height:1.4;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:8.5in;min-height:11in;margin:0 auto;background:#fff;position:relative;overflow:hidden;page-break-after:always}
.page:last-child{page-break-after:auto}
@media print{.page{page-break-after:always;min-height:auto;box-shadow:none;margin:0}body{background:#fff}}
@media screen{.page{box-shadow:0 2px 16px rgba(0,0,0,0.10);margin:20px auto}}

/* ===== Project Totals table ===== */
.pt-row{display:flex;justify-content:space-between;padding:5px 12px;font-size:10px;border-bottom:1px solid #e0e0e0}
.pt-row:nth-child(even){background:#fafafa}
.pt-label{color:#333;font-weight:500}
.pt-sub{font-size:8px;color:#888;margin-left:4px}
.pt-value{font-weight:700;color:#1a1a2e;text-align:right}
.pt-hl{background:${TEAL} !important;color:#fff !important}
.pt-hl .pt-label,.pt-hl .pt-value,.pt-hl .pt-sub{color:#fff !important}

/* ===== Waste factor grid ===== */
.wf-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:0;border:1px solid #ccc}
.wf-cell{padding:5px 6px;font-size:8.5px;text-align:center;border:1px solid #e0e0e0;background:#fafafa}
.wf-cell-pct{font-weight:700;color:#333}
.wf-cell-val{color:#555}
</style>
</head>
<body>

<!-- ==================== PAGE 1: PROJECT TOTALS + AERIAL IMAGE ==================== -->
<div class="page">
  <!-- Top teal gradient bar -->
  <div style="height:4px;background:linear-gradient(90deg,${TEAL},${TEAL_DARK})"></div>

  <!-- Header: Logo + Address -->
  <div style="padding:12px 28px 10px;display:flex;align-items:center;gap:14px">
    <!-- Logo -->
    <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
      <div style="width:36px;height:36px;background:${TEAL};border-radius:6px;display:flex;align-items:center;justify-content:center">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 21V10L12 3L21 10V21H15V14H9V21H3Z" fill="white"/>
          <path d="M10 8.5C10 8.5 11 7 12 7C13 7 14 8.5 14 8.5" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
      <div>
        <div style="font-size:16px;font-weight:900;color:${TEAL};letter-spacing:0.5px;line-height:1">ROOF REPORTER</div>
        <div style="font-size:9px;font-weight:500;color:#888;letter-spacing:1px">AI</div>
      </div>
    </div>
    <!-- Address -->
    <div style="flex:1;text-align:right">
      <div style="font-size:15px;font-weight:700;color:#222">${fullAddress}</div>
      <div style="font-size:9px;color:#888;margin-top:2px">${[prop.homeowner_name ? 'Homeowner: ' + prop.homeowner_name : '', prop.requester_name ? 'For: ' + prop.requester_name : '', prop.requester_company || ''].filter(Boolean).join(' · ') || 'Residential Property'}</div>
    </div>
  </div>

  <!-- Two-column layout: Left = Project Totals, Right = Aerial Image -->
  <div style="display:flex;padding:0 28px;gap:16px">
    <!-- LEFT COLUMN: Project Totals (~42%) -->
    <div style="width:42%;flex-shrink:0">
      <div style="font-size:12px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;border-bottom:2px solid ${TEAL};padding-bottom:4px">Project Totals</div>

      <!-- Total Roof Area (highlighted) -->
      <div class="pt-row pt-hl" style="border-radius:4px 4px 0 0">
        <span class="pt-label" style="font-weight:800;font-size:11px">Total Roof Area</span>
        <span class="pt-value" style="font-size:12px">${netAreaSF.toLocaleString()} SF</span>
      </div>

      <div class="pt-row">
        <span class="pt-label">Predominant Pitch</span>
        <span class="pt-value">${predominantPitch} <span class="pt-sub">(${predominantPitchDeg.toFixed(1)}°)</span></span>
      </div>
      <div class="pt-row">
        <span class="pt-label">Gross Area<span class="pt-sub">(w/${mat.waste_pct || 15}% waste)</span></span>
        <span class="pt-value">${grossAreaSF.toLocaleString()} SF</span>
      </div>
      <div class="pt-row">
        <span class="pt-label">IWB<span class="pt-sub">(Ice &amp; Water Barrier)</span></span>
        <span class="pt-value">${iwbSqFt} SF</span>
      </div>

      <!-- Sub section: Roof Planes / Structures -->
      <div style="display:flex;gap:0;margin-top:6px;border:1px solid #e0e0e0;border-radius:4px;overflow:hidden">
        <div style="flex:1;padding:5px 10px;text-align:center;border-right:1px solid #e0e0e0">
          <div style="font-size:8px;color:#888;font-weight:600;text-transform:uppercase">Roof Planes</div>
          <div style="font-size:16px;font-weight:900;color:${TEAL_DARK}">${report.segments.length}</div>
        </div>
        <div style="flex:1;padding:5px 10px;text-align:center">
          <div style="font-size:8px;color:#888;font-weight:600;text-transform:uppercase">Structures</div>
          <div style="font-size:16px;font-weight:900;color:${TEAL_DARK}">1</div>
        </div>
      </div>

      <!-- Edge lengths section -->
      <div style="font-size:10px;font-weight:700;color:${TEAL_DARK};margin-top:10px;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px">Edge Lengths</div>
      <div class="pt-row" style="background:#f0f9f7"><span class="pt-label" style="font-weight:700">Eave</span><span class="pt-value">${es.total_eave_ft} LF</span></div>
      <div class="pt-row"><span class="pt-label" style="font-weight:700">Rake Edge</span><span class="pt-value">${es.total_rake_ft} LF</span></div>
      <div class="pt-row" style="background:${TEAL_LIGHT}"><span class="pt-label" style="font-weight:800">Total Perimeter</span><span class="pt-value" style="font-weight:900">${totalPerimeter} LF</span></div>

      <div style="height:6px"></div>

      <div class="pt-row"><span class="pt-label" style="font-weight:700">Ridge</span><span class="pt-value">${es.total_ridge_ft} LF</span></div>
      <div class="pt-row"><span class="pt-label" style="font-weight:700">Hip</span><span class="pt-value">${es.total_hip_ft} LF</span></div>
      <div class="pt-row"><span class="pt-label" style="font-weight:700">Valley</span><span class="pt-value">${es.total_valley_ft} LF</span></div>
      ${slopeChangeFt > 0 ? `<div class="pt-row"><span class="pt-label" style="font-weight:700">Slope Change</span><span class="pt-value">${slopeChangeFt} LF</span></div>` : ''}
      ${stepFlashingFt > 0 ? `<div class="pt-row"><span class="pt-label" style="font-weight:700">Step Flashing</span><span class="pt-value">${stepFlashingFt} LF</span></div>` : ''}
      ${wallFlashingFt > 0 ? `<div class="pt-row"><span class="pt-label" style="font-weight:700">Headwall Flashing</span><span class="pt-value">${wallFlashingFt} LF</span></div>` : ''}
    </div>

    <!-- RIGHT COLUMN: Aerial Satellite Image -->
    <div style="flex:1;display:flex;flex-direction:column">
      <div style="border:1px solid #ccc;border-radius:4px;overflow:hidden;background:#1a2332;height:480px;display:flex;align-items:center;justify-content:center">
        ${overheadUrl
          ? `<img src="${overheadUrl}" alt="Aerial View" style="max-width:100%;max-height:100%;object-fit:contain;display:block" onerror="this.parentElement.innerHTML='<div style=\\'display:flex;align-items:center;justify-content:center;color:#999;font-size:13px;width:100%;height:100%\\'>Satellite imagery not available</div>'">`
          : '<div style="display:flex;align-items:center;justify-content:center;color:#999;font-size:13px;width:100%;height:100%">Satellite imagery not available</div>'}
      </div>
      <div style="font-size:7px;color:#888;text-align:right;margin-top:2px">&copy; Google Maps &mdash; Imagery for reference</div>
    </div>
  </div>

  <!-- Waste Factor Table (full width, bottom) -->
  <div style="padding:10px 28px 0">
    <div style="font-size:10px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.8px;text-align:center;margin-bottom:6px;border-bottom:1px solid #ccc;padding-bottom:4px">Waste Factor (Total Roof Area)</div>
    <div class="wf-grid">
      ${wasteTable.map(w => `<div class="wf-cell"><span class="wf-cell-pct">${w.pct}%</span> — <span class="wf-cell-val">${w.sf} SF</span></div>`).join('')}
    </div>
  </div>

  <!-- Disclaimer -->
  <div style="padding:8px 28px 0;font-size:7px;color:#888;line-height:1.5;text-align:center">
    REPORT IS PROVIDED FOR ESTIMATION PURPOSES ONLY. ACTUAL MEASUREMENTS MAY VARY.
    &copy; ${new Date().getFullYear()} Roof Manager. All imagery &copy; Google.
  </div>

  <!-- Footer bar -->
  <div style="position:absolute;bottom:0;left:0;right:0;height:28px;background:linear-gradient(90deg,${TEAL},${TEAL_DARK});display:flex;align-items:center;justify-content:space-between;padding:0 28px">
    <span style="color:#fff;font-size:9px;font-weight:700">Roof Manager</span>
    <span style="color:#E0F2F1;font-size:7.5px">roofmanager.ca &bull; Report: ${reportNum} &bull; ${reportDate} &bull; p.1</span>
  </div>
</div>

<!-- ==================== PAGE 2: ROOF AREA ANALYSIS ==================== -->
<div class="page">
  <!-- Top red bar -->
  <div style="height:4px;background:${RED}"></div>

  <!-- Title -->
  <div style="padding:10px 28px 6px">
    <div style="font-size:14px;font-weight:800;color:#222">Roof Area Analysis${structuresBreakdown.length >= 2 ? ` — All Structures (${structuresBreakdown.length})` : ''}</div>
  </div>

  <!-- Main diagram area -->
  <div style="padding:0 28px;margin-bottom:8px">
    <div style="border:1px solid #d5dae3;border-radius:4px;background:#fff;text-align:center">
      ${architecturalDiagramSVG}
    </div>
    <div style="text-align:center;font-size:6.5px;color:#999;margin-top:2px">AI-Generated Roof Diagram — All dimensions in feet. Pitch multiplier applied for true 3D area.</div>
  </div>

  <!-- Drawing Key / Legend — Industry Standard Color Coding -->
  <div style="padding:0 28px;margin-bottom:8px">
    <div style="display:flex;flex-wrap:wrap;gap:12px;padding:5px 10px;background:#f5f5f5;border:1px solid #ddd;border-radius:4px;font-size:8px;font-weight:600">
      <div style="display:flex;align-items:center;gap:4px"><span style="width:18px;height:3px;background:#DC2626;display:inline-block;border-radius:1px"></span>Ridge</div>
      <div style="display:flex;align-items:center;gap:4px"><span style="width:18px;height:3px;background:#16A34A;display:inline-block;border-radius:1px"></span>Eave</div>
      <div style="display:flex;align-items:center;gap:4px"><span style="width:18px;height:3px;background:#2563EB;display:inline-block;border-radius:1px"></span>Valley</div>
      <div style="display:flex;align-items:center;gap:4px"><span style="width:18px;height:3px;background:#EA580C;display:inline-block;border-radius:1px"></span>Hip</div>
      <div style="display:flex;align-items:center;gap:4px"><span style="width:18px;height:3px;background:#7C3AED;display:inline-block;border-radius:1px"></span>Rake Edge</div>
      <div style="display:flex;align-items:center;gap:4px"><span style="width:18px;height:3px;background:#0891B2;display:inline-block;border-radius:1px"></span>Drip Edge</div>
    </div>
  </div>

  <!-- Two tables side by side: Length Summary + Area by Roof Plane -->
  <div style="display:flex;gap:12px;padding:0 28px;margin-bottom:6px">
    <!-- LEFT TABLE: Length Summary (Standardized) -->
    <div style="flex:1">
      <div style="font-size:9px;font-weight:800;color:#333;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Length Summary</div>
      <div style="font-size:7.5px;color:#888;margin-bottom:4px;font-weight:600">MEASUREMENT TOTALS BY EDGE TYPE</div>
      <table style="width:100%;border-collapse:collapse;font-size:8px">
        <thead>
          <tr style="background:#1a1a2e;color:#fff">
            <th style="padding:4px 6px;text-align:left;font-size:7px;font-weight:700">Edge Type</th>
            <th style="padding:4px 6px;text-align:center;font-size:7px;font-weight:700">Count</th>
            <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">Length (LF)</th>
          </tr>
        </thead>
        <tbody>
          ${Object.entries(edgesByType).map(([type, data], idx) => {
            const cfg = edgeTypeConfig[type] || { label: type, color: '#333' }
            return `<tr style="${idx % 2 === 0 ? 'background:#fafafa' : ''}">
              <td style="padding:3px 6px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:3px;background:${cfg.color};border-radius:1px;margin-right:4px;vertical-align:middle"></span><span style="font-weight:600">${cfg.label}</span></td>
              <td style="padding:3px 6px;border-bottom:1px solid #eee;text-align:center">${data.count}</td>
              <td style="padding:3px 6px;border-bottom:1px solid #eee;text-align:right;font-weight:700">${Math.round(data.totalFt * 10) / 10}</td>
            </tr>`
          }).join('')}
          <tr style="background:#eee;font-weight:800">
            <td style="padding:4px 6px;border-top:2px solid #333;font-size:8px">Total Linear</td>
            <td style="padding:4px 6px;border-top:2px solid #333;text-align:center">${report.edges.length}</td>
            <td style="padding:4px 6px;border-top:2px solid #333;text-align:right">${Math.round(totalLinearFt * 10) / 10} LF</td>
          </tr>
        </tbody>
      </table>

      <!-- Total Area Summary consolidated into Page 1 Project Totals -->
    </div>

    <!-- RIGHT TABLE: Area by Roof Plane + Area by Pitch -->
    <div style="flex:1">
      <div style="font-size:9px;font-weight:800;color:#333;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Area by Roof Plane</div>
      <div style="font-size:7.5px;color:#888;margin-bottom:4px;font-weight:600">SURFACE AREA, PITCH &amp; DIRECTION BY FACET</div>
      <table style="width:100%;border-collapse:collapse;font-size:8px">
        <thead>
          <tr style="background:#1a1a2e;color:#fff">
            <th style="padding:4px 5px;text-align:left;font-size:7px;font-weight:700">Plane</th>
            <th style="padding:4px 5px;text-align:right;font-size:7px;font-weight:700">Area (SF)</th>
            <th style="padding:4px 5px;text-align:center;font-size:7px;font-weight:700">Pitch</th>
            <th style="padding:4px 5px;text-align:right;font-size:7px;font-weight:700">% Total</th>
          </tr>
        </thead>
        <tbody>
          ${report.segments.slice(0, 10).map((seg, idx) => {
            const pctOfTotal = Math.round(seg.true_area_sqft / report.total_true_area_sqft * 1000) / 10
            return `<tr style="${idx % 2 === 0 ? 'background:#fafafa' : ''}">
              <td style="padding:3px 5px;border-bottom:1px solid #eee;font-weight:600">${segFaceLetters[idx]} <span style="font-weight:400;font-size:6.5px;color:#888">${seg.azimuth_direction || ''}</span></td>
              <td style="padding:3px 5px;border-bottom:1px solid #eee;text-align:right">${Math.round(seg.true_area_sqft).toLocaleString()}</td>
              <td style="padding:3px 5px;border-bottom:1px solid #eee;text-align:center">${seg.pitch_ratio || (seg.pitch_degrees ? `${Math.round(12 * Math.tan(seg.pitch_degrees * Math.PI / 180) * 10) / 10}:12` : '—')}</td>
              <td style="padding:3px 5px;border-bottom:1px solid #eee;text-align:right;color:#555">${pctOfTotal}%</td>
            </tr>`
          }).join('')}
          ${report.segments.length > 10 ? `<tr><td colspan="4" style="padding:3px 5px;font-size:7px;color:#888;text-align:center">+ ${report.segments.length - 10} more planes</td></tr>` : ''}
          <tr style="background:#eee;font-weight:800">
            <td style="padding:4px 5px;border-top:2px solid #333;font-size:8px">Total</td>
            <td style="padding:4px 5px;border-top:2px solid #333;text-align:right;font-size:8px">${report.total_true_area_sqft.toLocaleString()} SF</td>
            <td style="padding:4px 5px;border-top:2px solid #333;text-align:center;font-size:8px">${predominantPitch}</td>
            <td style="padding:4px 5px;border-top:2px solid #333;text-align:right;font-size:8px">100%</td>
          </tr>
        </tbody>
      </table>

      <!-- Area by Pitch Breakdown -->
      <div style="margin-top:6px;font-size:8px;font-weight:800;color:#333;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px">Area by Pitch</div>
      <table style="width:100%;border-collapse:collapse;font-size:7.5px">
        <thead>
          <tr style="background:#f1f5f9;border-bottom:1.5px solid #cbd5e1">
            <th style="padding:3px 6px;text-align:left;font-weight:700;color:#475569">Pitch Range</th>
            <th style="padding:3px 6px;text-align:right;font-weight:700;color:#475569">Roof Area (SF)</th>
            <th style="padding:3px 6px;text-align:right;font-weight:700;color:#475569">% of Total</th>
          </tr>
        </thead>
        <tbody>
          ${slopeClasses.flat > 0 ? `<tr style="border-bottom:1px solid #eee"><td style="padding:3px 6px">Flat (0:12\u20132:12)</td><td style="padding:3px 6px;text-align:right;font-weight:600">${slopeClasses.flat.toLocaleString()} SF</td><td style="padding:3px 6px;text-align:right;color:#555">${Math.round(slopeClasses.flat / netAreaSF * 1000) / 10}%</td></tr>` : ''}
          ${slopeClasses.low > 0 ? `<tr style="border-bottom:1px solid #eee"><td style="padding:3px 6px">Low (2:12\u20134:12)</td><td style="padding:3px 6px;text-align:right;font-weight:600">${slopeClasses.low.toLocaleString()} SF</td><td style="padding:3px 6px;text-align:right;color:#555">${Math.round(slopeClasses.low / netAreaSF * 1000) / 10}%</td></tr>` : ''}
          ${slopeClasses.standard > 0 ? `<tr style="border-bottom:1px solid #eee;background:#f0fdf4"><td style="padding:3px 6px;font-weight:600;color:#166534">Standard (4:12\u20139:12)</td><td style="padding:3px 6px;text-align:right;font-weight:700;color:#166534">${slopeClasses.standard.toLocaleString()} SF</td><td style="padding:3px 6px;text-align:right;color:#166534;font-weight:600">${Math.round(slopeClasses.standard / netAreaSF * 1000) / 10}%</td></tr>` : ''}
          ${slopeClasses.steep > 0 ? `<tr style="border-bottom:1px solid #eee;background:#fef2f2"><td style="padding:3px 6px;font-weight:600;color:#991b1b">Steep (9:12+)</td><td style="padding:3px 6px;text-align:right;font-weight:700;color:#991b1b">${slopeClasses.steep.toLocaleString()} SF</td><td style="padding:3px 6px;text-align:right;color:#991b1b;font-weight:600">${Math.round(slopeClasses.steep / netAreaSF * 1000) / 10}%</td></tr>` : ''}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Edge totals consolidated into Page 1 Project Totals -->

  <!-- Per-Structure Measurement Breakdown (house + detached garage, etc.) -->
  ${structuresBreakdown.length >= 2 ? `
  <div style="padding:6px 28px 0">
    <div style="font-size:10px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;border-bottom:1.5px solid ${TEAL};padding-bottom:3px">Per-Structure Breakdown — ${structuresBreakdown.length} Buildings</div>
    <table style="width:100%;border-collapse:collapse;font-size:8px">
      <thead>
        <tr style="background:#1a1a2e;color:#fff">
          <th style="padding:4px 8px;text-align:left;font-size:7.5px;font-weight:700">Structure</th>
          <th style="padding:4px 8px;text-align:right;font-size:7.5px;font-weight:700">Footprint (SF)</th>
          <th style="padding:4px 8px;text-align:right;font-size:7.5px;font-weight:700">Roof Area (SF)</th>
          <th style="padding:4px 8px;text-align:right;font-size:7.5px;font-weight:700">Squares</th>
          <th style="padding:4px 8px;text-align:right;font-size:7.5px;font-weight:700">Perimeter (LF)</th>
        </tr>
      </thead>
      <tbody>
        ${structuresBreakdown.map((s, i) => `<tr style="${i % 2 === 0 ? 'background:#fafafa' : ''}">
          <td style="padding:4px 8px;border-bottom:1px solid #eee;font-weight:700">${s.label}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${s.footprint_sf.toLocaleString()}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:700;color:${TEAL_DARK}">${s.true_area_sf.toLocaleString()}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${s.squares}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${s.perimeter_ft.toLocaleString()}</td>
        </tr>`).join('')}
        <tr style="background:#eee;font-weight:800">
          <td style="padding:5px 8px;border-top:2px solid #333">Combined Total</td>
          <td style="padding:5px 8px;border-top:2px solid #333;text-align:right">${structuresBreakdown.reduce((s, x) => s + x.footprint_sf, 0).toLocaleString()}</td>
          <td style="padding:5px 8px;border-top:2px solid #333;text-align:right;color:${TEAL_DARK}">${structuresBreakdown.reduce((s, x) => s + x.true_area_sf, 0).toLocaleString()}</td>
          <td style="padding:5px 8px;border-top:2px solid #333;text-align:right">${Math.round(structuresBreakdown.reduce((s, x) => s + x.squares, 0) * 10) / 10}</td>
          <td style="padding:5px 8px;border-top:2px solid #333;text-align:right">${Math.round(structuresBreakdown.reduce((s, x) => s + x.perimeter_ft, 0) * 10) / 10}</td>
        </tr>
      </tbody>
    </table>
    <div style="font-size:6.5px;color:#888;margin-top:3px;font-style:italic">Per-structure areas derived from individual traced eave polygons; dominant pitch multiplier applied for sloped area.</div>
  </div>` : ''}

  <!-- Roof Annotations (vents, skylights, chimneys) from trace -->
  ${(() => {
    const rt = (report as any).roof_trace
    const ventCt = rt?.annotations?.vents?.length || 0
    const skylightCt = rt?.annotations?.skylights?.length || 0
    const chimneyCt = rt?.annotations?.chimneys?.length || 0
    if (ventCt === 0 && skylightCt === 0 && chimneyCt === 0) return ''
    return `<div style="padding:4px 28px 0">
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:7px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.5px">Roof Penetrations:</span>
        ${ventCt > 0 ? `<span style="padding:2px 7px;background:#f3e8ff;color:#7c3aed;border:1px solid #ddd6fe;border-radius:3px;font-size:7px;font-weight:700">&#9679; Vents: ${ventCt}</span>` : ''}
        ${skylightCt > 0 ? `<span style="padding:2px 7px;background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;border-radius:3px;font-size:7px;font-weight:700">&#9830; Skylights: ${skylightCt}</span>` : ''}
        ${chimneyCt > 0 ? `<span style="padding:2px 7px;background:#fef3c7;color:#92400e;border:1px solid #fde68a;border-radius:3px;font-size:7px;font-weight:700">&#9632; Chimneys: ${chimneyCt}</span>` : ''}
      </div>
    </div>`
  })()}

  <!-- Methodology note -->
  <div style="padding:6px 28px 0">
    <div style="padding:4px 8px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:3px;font-size:6.5px;color:#0369a1;line-height:1.4">
      <strong>Methodology:</strong> Measurements from ${(report as any).roof_trace ? 'user-traced GPS coordinates (UTM projection, Shoelace formula)' : 'AI vision analysis of satellite imagery'}. Pitch multiplier &radic;(rise&sup2;+12&sup2;)/12 applied for true 3D surface area. Engine v6.0 &mdash; Industry-standard multipliers per GAF/CertainTeed/IKO/EagleView.
    </div>
  </div>

  <!-- Footer bar -->
  <div style="position:absolute;bottom:0;left:0;right:0;height:28px;background:${RED};display:flex;align-items:center;justify-content:space-between;padding:0 28px">
    <span style="color:#fff;font-size:9px;font-weight:700">Roof Manager</span>
    <span style="color:#ffcdd2;font-size:7.5px">roofmanager.ca &bull; Report: ${reportNum} &bull; ${reportDate} &bull; p.2</span>
  </div>
</div>



<!-- Pitch Analysis data consolidated into Page 2 Area by Pitch table -->

${report.customer_price_per_bundle ? buildCustomerPricingHTML(report) : ''}

${buildMaterialTakeoffPage(report, reportNum, reportDate, fullAddress)}

${buildEdgeBreakdownPage(report, reportNum, reportDate, fullAddress)}

${buildCrossCheckAndAdvisoryPage(report, reportNum, reportDate, fullAddress)}

${report.solar_panel_layout ? buildSolarProposalPage(report, reportNum, reportDate, fullAddress) : ''}

${report.vision_findings ? buildVisionFindingsHTML(report.vision_findings) : ''}

</body>
</html>`
}

// ============================================================
// HELPER: Build Vision Findings HTML section for professional report
// Renders the multimodal AI inspection results as a styled page
// ============================================================

// ============================================================
// HELPER: Build Vision Findings HTML section for professional report
// ============================================================
export function buildVisionFindingsHTML(vf: VisionFindings): string {
  if (!vf || !vf.findings || vf.findings.length === 0) return ''

  const hs = vf.heat_score
  const heatColor = hs.total >= 75 ? '#dc2626' : hs.total >= 50 ? '#ea580c' : hs.total >= 25 ? '#d97706' : '#059669'
  const heatBg = hs.total >= 75 ? '#fef2f2' : hs.total >= 50 ? '#fff7ed' : hs.total >= 25 ? '#fffbeb' : '#ecfdf5'
  const condColor: Record<string, string> = { excellent: '#059669', good: '#16a34a', fair: '#d97706', poor: '#ea580c', critical: '#dc2626' }

  const severityBadge = (sev: string) => {
    const c: Record<string, [string, string]> = { low: ['#ecfdf5', '#059669'], moderate: ['#fffbeb', '#d97706'], high: ['#fff7ed', '#ea580c'], critical: ['#fef2f2', '#dc2626'] }
    const [bg, fg] = c[sev] || ['#f1f5f9', '#475569']
    return `<span style="padding:2px 6px;border-radius:2px;font-size:7px;font-weight:700;background:${bg};color:${fg};text-transform:uppercase">${sev}</span>`
  }

  const catIcon: Record<string, string> = { vulnerability: '&#9888;', obstruction: '&#9899;', environmental: '&#127795;', condition: '&#128269;' }

  const findingsRows = vf.findings.slice(0, 12).map(f =>
    `<tr>
      <td style="padding:4px 6px;font-size:8px">${catIcon[f.category] || '&#8226;'} ${f.label}</td>
      <td style="padding:4px 6px;font-size:8px;text-align:center">${severityBadge(f.severity)}</td>
      <td style="padding:4px 6px;font-size:8px;text-align:center">${f.confidence}%</td>
      <td style="padding:4px 6px;font-size:7.5px;color:#475569">${f.description.substring(0, 80)}${f.description.length > 80 ? '...' : ''}</td>
    </tr>`
  ).join('')

  const gaugeWidth = Math.max(5, hs.total)

  return `
<!-- ==================== VISION INSPECTION PAGE ==================== -->
<div class="page" style="page-break-before:always">
  <div style="background:#002244;padding:10px 32px;display:flex;justify-content:space-between;align-items:center">
    <div style="color:#fff;font-size:13px;font-weight:700;letter-spacing:1px">&#128065; AI VISION INSPECTION</div>
    <div style="color:#7eafd4;font-size:9px;text-align:right">Multimodal Roof Condition Analysis &bull; ${vf.model}</div>
  </div>
  <div style="padding:16px 32px 50px">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
      <div style="background:${heatBg};border:1px solid ${heatColor}33;border-radius:6px;padding:14px">
        <div style="font-size:9px;font-weight:700;color:${heatColor};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">&#128293; CRM Heat Score</div>
        <div style="display:flex;align-items:baseline;gap:8px">
          <span style="font-size:32px;font-weight:900;color:${heatColor}">${hs.total}</span>
          <span style="font-size:14px;color:${heatColor};font-weight:600">/100</span>
          <span style="padding:3px 10px;border-radius:3px;font-size:9px;font-weight:700;background:${heatColor};color:#fff;text-transform:uppercase;margin-left:8px">${hs.classification.replace('_', ' ')}</span>
        </div>
        <div style="background:#e2e8f0;border-radius:4px;height:8px;margin:8px 0;overflow:hidden">
          <div style="width:${gaugeWidth}%;height:100%;background:${heatColor};border-radius:4px"></div>
        </div>
        <div style="font-size:7.5px;color:#64748b">${hs.summary}</div>
      </div>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:14px">
        <div style="font-size:9px;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px">Score Components</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:8px">
          <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Age & Wear</span><span style="font-weight:700">${hs.components.age_wear}/30</span></div>
          <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Structural</span><span style="font-weight:700">${hs.components.structural}/25</span></div>
          <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Environmental</span><span style="font-weight:700">${hs.components.environmental}/20</span></div>
          <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Obstructions</span><span style="font-weight:700">${hs.components.obstruction_complexity}/15</span></div>
          <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Urgency</span><span style="font-weight:700">${hs.components.urgency_bonus}/10</span></div>
          <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Condition</span><span style="font-weight:700;color:${condColor[vf.overall_condition] || '#475569'};text-transform:uppercase">${vf.overall_condition}</span></div>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <div style="flex:1;text-align:center;padding:6px;background:#fef2f2;border-radius:4px;border:1px solid #fecaca">
        <div style="font-size:18px;font-weight:900;color:#dc2626">${vf.findings.filter(f => f.category === 'vulnerability').length}</div>
        <div style="font-size:7px;color:#991b1b;font-weight:600">Vulnerabilities</div>
      </div>
      <div style="flex:1;text-align:center;padding:6px;background:#f0f9ff;border-radius:4px;border:1px solid #bae6fd">
        <div style="font-size:18px;font-weight:900;color:#0369a1">${vf.findings.filter(f => f.category === 'obstruction').length}</div>
        <div style="font-size:7px;color:#0c4a6e;font-weight:600">Obstructions</div>
      </div>
      <div style="flex:1;text-align:center;padding:6px;background:#ecfdf5;border-radius:4px;border:1px solid #a7f3d0">
        <div style="font-size:18px;font-weight:900;color:#059669">${vf.findings.filter(f => f.category === 'environmental').length}</div>
        <div style="font-size:7px;color:#065f46;font-weight:600">Environmental</div>
      </div>
      <div style="flex:1;text-align:center;padding:6px;background:#f5f3ff;border-radius:4px;border:1px solid #c4b5fd">
        <div style="font-size:18px;font-weight:900;color:#7c3aed">${vf.findings.filter(f => f.category === 'condition').length}</div>
        <div style="font-size:7px;color:#5b21b6;font-weight:600">Condition</div>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;font-size:8.5px;margin-top:4px">
      <thead>
        <tr style="background:#003366;color:#fff">
          <th style="padding:5px 6px;text-align:left;font-size:7.5px;font-weight:700">Finding</th>
          <th style="padding:5px 6px;text-align:center;font-size:7.5px;font-weight:700;width:70px">Severity</th>
          <th style="padding:5px 6px;text-align:center;font-size:7.5px;font-weight:700;width:45px">Conf.</th>
          <th style="padding:5px 6px;text-align:left;font-size:7.5px;font-weight:700">Description</th>
        </tr>
      </thead>
      <tbody>${findingsRows}</tbody>
    </table>
    ${vf.findings.length > 12 ? `<div style="font-size:7px;color:#94a3b8;text-align:center;margin-top:4px">... and ${vf.findings.length - 12} more findings</div>` : ''}
    <div style="margin-top:12px;padding:8px 12px;background:#eff6ff;border-radius:4px;border-left:3px solid #3b82f6;font-size:7.5px;color:#1e40af">
      <strong>AI Vision Note:</strong> ${vf.summary} &mdash; Inspected ${new Date(vf.inspected_at).toLocaleDateString('en-CA')} using ${vf.model}. Duration: ${vf.duration_ms}ms.
      ${vf.heat_score.total >= 50 ? '<br><strong>&#9888; Field verification strongly recommended.</strong>' : ''}
    </div>
  </div>
</div>`
}

// ============================================================
// HELPER: Generate perimeter side data for HTML table
// ============================================================
interface PerimeterSide { type: string; ft: number; ftInches: string }

export function generatePerimeterSideData(
  aiGeometry: AIMeasurementAnalysis | null | undefined,
  edgeSummary: { total_ridge_ft: number; total_hip_ft: number; total_valley_ft: number; total_eave_ft: number; total_rake_ft: number }
): { sides: PerimeterSide[]; totalFt: number } {
  if (!aiGeometry?.perimeter || aiGeometry.perimeter.length < 3) {
    return { sides: [], totalFt: 0 }
  }

  const perim = aiGeometry.perimeter
  const n = perim.length
  const measuredByType = smartEdgeFootage(edgeSummary)

  interface SideInfo { pxLen: number; type: string }
  const sideInfos: SideInfo[] = []
  for (let i = 0; i < n; i++) {
    const p1 = perim[i]
    const p2 = perim[(i + 1) % n]
    const pxLen = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2)
    sideInfos.push({ pxLen, type: p1.edge_to_next || 'EAVE' })
  }

  const byType: Record<string, number[]> = {}
  sideInfos.forEach((s, i) => {
    if (!byType[s.type]) byType[s.type] = []
    byType[s.type].push(i)
  })

  const sideFt = new Array(n).fill(0)
  for (const [type, indices] of Object.entries(byType)) {
    const totalPxLen = indices.reduce((s, i) => s + sideInfos[i].pxLen, 0)
    const totalFt = measuredByType[type] || 0
    if (totalPxLen > 0 && totalFt > 0) {
      indices.forEach(i => { sideFt[i] = (sideInfos[i].pxLen / totalPxLen) * totalFt })
    }
  }

  const sides: PerimeterSide[] = sideInfos.map((s, i) => ({
    type: s.type,
    ft: Math.round(sideFt[i] * 10) / 10,
    ftInches: feetToFeetInches(sideFt[i])
  }))

  const totalFt = Math.round(sides.reduce((s, side) => s + side.ft, 0) * 10) / 10
  return { sides, totalFt }
}

// ============================================================
// SIMPLE TWO-PAGE MEASUREMENT REPORT
// Page 1: Roof Area Analysis — diagram + measurement tables (Portrait)
// Page 2: Project Totals Summary — slope breakdown, measurements,
//         satellite image, waste factor table (Landscape)
// Matches the Roof Manager / RoofScope template style
// ============================================================
export function generateSimpleTwoPageReport(report: RoofReport): string {
  const prop = report.property || { address: 'Unknown' } as any
  const mat = report.materials || { net_area_sqft: 0, gross_squares: 0, bundle_count: 0, line_items: [], waste_table: [], waste_pct: 15, gross_area_sqft: 0, total_material_cost_cad: 0, complexity_class: 'simple', complexity_factor: 1, shingle_type: 'architectural' } as any
  const es = report.edge_summary || { total_ridge_ft: 0, total_hip_ft: 0, total_valley_ft: 0, total_eave_ft: 0, total_rake_ft: 0, total_linear_ft: 0 } as any

  // Safe defaults
  if (!report.total_true_area_sqft) report.total_true_area_sqft = report.total_footprint_sqft || 1
  if (!report.total_footprint_sqft) report.total_footprint_sqft = report.total_true_area_sqft || 1
  if (!report.area_multiplier) report.area_multiplier = report.total_true_area_sqft / (report.total_footprint_sqft || 1)
  if (!report.generated_at) report.generated_at = new Date().toISOString()
  if (!report.segments) report.segments = []
  if (!report.edges) report.edges = []

  const fullAddress = [prop.address, prop.city, prop.province, prop.postal_code].filter(Boolean).join(', ')
  const reportDate = new Date(report.generated_at).toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })
  const netAreaSF = Math.round(report.total_true_area_sqft)
  const grossAreaSF = Math.round(report.total_true_area_sqft * (1 + (mat.waste_pct || 15) / 100))

  // Predominant pitch from largest segment
  const largestSeg = [...report.segments].sort((a, b) => b.true_area_sqft - a.true_area_sqft)[0]
  const predominantPitch = largestSeg?.pitch_ratio || report.roof_pitch_ratio || '5:12'
  const predominantPitchDeg = largestSeg?.pitch_degrees || report.roof_pitch_degrees || 22.6

  // Total linear
  const totalLinearFt = Math.round(es.total_ridge_ft + es.total_hip_ft + es.total_valley_ft + es.total_eave_ft + es.total_rake_ft)
  const totalPerimeter = Math.round(es.total_eave_ft + es.total_rake_ft)

  // Satellite imagery
  const overheadUrl = report.imagery?.satellite_overhead_url || report.imagery?.satellite_url || ''

  // Slope breakdown (classify segments)
  // Industry-standard ranges: Flat 0-2:12, Low 2-4:12, Standard 4-9:12, Steep 9:12+
  let standardSlopeArea = 0, flatSlopeArea = 0, lowSlopeArea = 0, steepSlopeArea = 0, highRoofArea = 0
  report.segments.forEach(seg => {
    const pitchRise = Math.tan(seg.pitch_degrees * Math.PI / 180) * 12
    if (pitchRise <= 2) flatSlopeArea += seg.true_area_sqft
    else if (pitchRise <= 4) lowSlopeArea += seg.true_area_sqft
    else if (pitchRise <= 9) standardSlopeArea += seg.true_area_sqft
    else steepSlopeArea += seg.true_area_sqft
    // high roof heuristic: plane height > 1 story (~3.5m)
    if (seg.plane_height_meters && seg.plane_height_meters > 3.5) highRoofArea += seg.true_area_sqft
  })

  // IWB (Ice & Water Barrier) — 3ft up from eave on each side
  const iwbSqft = Math.round(es.total_eave_ft * 3)

  // Facet colors for diagram
  const facetColors = ['#4A90D9','#E8634A','#5CB85C','#F5A623','#9B59B6','#E84393','#2ECC71','#F39C12','#3498DB','#8E44AD','#E67E22','#27AE60']

  // Generate diagram SVG (reuse architectural diagram)
  let diagramSVG: string
  const hasTraceDiagram = !!(report as any).trace_diagram_svg
  if (hasTraceDiagram) {
    diagramSVG = (report as any).trace_diagram_svg
  } else {
    diagramSVG = generateArchitecturalDiagramSVG(
      report.ai_geometry, report.segments, report.edges, es,
      report.total_footprint_sqft, predominantPitchDeg,
      predominantPitch, grossAreaSF
    )
  }

  // Edge summary for the measurement table
  const edgeRows: { type: string; color: string; count: number; totalFt: number }[] = []
  const edgeTypeMap: Record<string, { color: string; count: number; totalFt: number }> = {}
  report.edges.forEach(e => {
    const key = e.edge_type
    if (!edgeTypeMap[key]) edgeTypeMap[key] = { color: '#333', count: 0, totalFt: 0 }
    edgeTypeMap[key].count++
    edgeTypeMap[key].totalFt += e.true_length_ft
  })
  // Edge color map — Industry Standard: Red=Ridge, Green=Eave, Blue=Valley, Orange=Hip, Purple=Rake
  const edgeColorMap: Record<string, string> = {
    eave: '#16A34A', ridge: '#DC2626', hip: '#EA580C', valley: '#2563EB',
    rake: '#7C3AED', step_flashing: '#F59E0B', wall_flashing: '#8B5CF6',
    transition: '#0891B2', parapet: '#78716C', gable: '#7C3AED', flashing: '#F59E0B'
  }
  Object.entries(edgeTypeMap).forEach(([type, data]) => {
    edgeRows.push({ type, color: edgeColorMap[type] || '#555', count: data.count, totalFt: Math.round(data.totalFt * 10) / 10 })
  })

  // Segment area table rows
  const segAreaRows = report.segments.map((seg, i) => ({
    label: String.fromCharCode(65 + i), // A, B, C...
    area: Math.round(seg.true_area_sqft * 10) / 10,
    pitch: seg.pitch_ratio,
    multiplier: Math.round(report.area_multiplier * 10000) / 10000
  }))

  // Waste factor table: 4%-15% — in square feet
  const wasteTableEntries = []
  for (let pct = 4; pct <= 15; pct++) {
    const sf = Math.round(report.total_true_area_sqft * (1 + pct / 100))
    wasteTableEntries.push({ pct, sf })
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Roof Measurement Report | ${fullAddress}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:#fff;color:#1a1a2e;font-size:9pt;line-height:1.35;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@media print{.page{page-break-after:always;min-height:auto;box-shadow:none;margin:0}body{background:#fff}}
@media screen{.page{box-shadow:0 2px 16px rgba(0,0,0,0.10);margin:20px auto}}
.page{background:#fff;position:relative;overflow:hidden;page-break-after:always}
.page:last-child{page-break-after:auto}
.page-portrait{width:8.5in;min-height:11in}
.page-landscape{width:11in;min-height:8.5in}
</style>
</head>
<body>

<!-- ==================== PAGE 1: ROOF AREA ANALYSIS (Portrait 8.5×11) ==================== -->
<div class="page page-portrait">
  <!-- Red top accent bar -->
  <div style="height:6px;background:linear-gradient(90deg,#CC0000,#E60000)"></div>

  <!-- Title + Address -->
  <div style="padding:14px 28px 8px">
    <div style="font-size:17px;font-weight:800;color:#1a1a1a;letter-spacing:0.3px">Roof Area Analysis<span style="font-weight:400;color:#555"> &mdash; Structure 1</span></div>
    <div style="font-size:10px;color:#444;margin-top:2px;font-weight:500">${fullAddress}</div>
  </div>

  <!-- Main Diagram Section (~58% of page) -->
  <div style="padding:0 22px">
    <div style="border:1px solid #ddd;border-radius:4px;background:#fff">
      ${diagramSVG}
    </div>
  </div>

  <!-- ESTIMATED ROOFER MEASUREMENTS header -->
  <div style="text-align:center;padding:8px 28px 4px">
    <div style="font-size:10px;font-weight:800;color:#1a1a1a;text-transform:uppercase;letter-spacing:1.5px;border-top:1.5px solid #ccc;border-bottom:1.5px solid #ccc;padding:5px 0">Roof Measurement Summary</div>
  </div>

  <!-- Two-column tables: Length Summary + Area by Roof Plane -->
  <div style="padding:0 22px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
    <!-- LEFT TABLE: Length Summary -->
    <div>
      <div style="font-size:7.5px;font-weight:700;color:#555;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.5px">Length Summary</div>
      <table style="width:100%;border-collapse:collapse;font-size:7.5px">
        <thead>
          <tr style="background:#001a44;color:#fff">
            <th style="padding:4px 6px;text-align:left;font-size:7px;font-weight:700">Edge Type</th>
            <th style="padding:4px 6px;text-align:center;font-size:7px;font-weight:700">Count</th>
            <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">Length (LF)</th>
          </tr>
        </thead>
        <tbody>
          ${edgeRows.map((r, i) => `
          <tr style="border-bottom:1px solid #eee;${i % 2 === 0 ? '' : 'background:#f9fafb'}">
            <td style="padding:3px 6px;font-size:7.5px"><span style="display:inline-block;width:10px;height:3px;background:${r.color};border-radius:1px;margin-right:4px;vertical-align:middle"></span><span style="font-weight:600;text-transform:capitalize">${r.type.replace(/_/g, ' ')}</span></td>
            <td style="padding:3px 6px;text-align:center;font-size:7.5px">${r.count}</td>
            <td style="padding:3px 6px;text-align:right;font-weight:700;font-size:7.5px">${r.totalFt}</td>
          </tr>`).join('')}
          <tr style="border-top:2px solid #001a44;background:#f0f3f7">
            <td style="padding:4px 6px;font-weight:800;font-size:7.5px">Total Linear</td>
            <td style="padding:4px 6px;text-align:center">${report.edges.length}</td>
            <td style="padding:4px 6px;text-align:right;font-weight:900;font-size:8px;color:#001a44">${totalLinearFt} LF</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- RIGHT TABLE: Area by Roof Plane -->
    <div>
      <div style="font-size:7.5px;font-weight:700;color:#555;margin-bottom:3px;text-transform:uppercase;letter-spacing:0.5px">Area by Roof Plane</div>
      <table style="width:100%;border-collapse:collapse;font-size:7.5px">
        <thead>
          <tr style="background:#001a44;color:#fff">
            <th style="padding:4px 6px;text-align:left;font-size:7px;font-weight:700">Plane</th>
            <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">Area (SF)</th>
            <th style="padding:4px 6px;text-align:center;font-size:7px;font-weight:700">Pitch</th>
            <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">% Total</th>
          </tr>
        </thead>
        <tbody>
          ${segAreaRows.map((r, i) => {
            const pctOfTotal = Math.round(r.area / report.total_true_area_sqft * 1000) / 10
            return `
          <tr style="border-bottom:1px solid #eee;${i % 2 === 0 ? '' : 'background:#f9fafb'}">
            <td style="padding:3px 6px;font-weight:600;font-size:7.5px">${r.label} <span style="font-size:6px;color:#999">${report.segments[i]?.azimuth_direction || ''}</span></td>
            <td style="padding:3px 6px;text-align:right;font-size:7.5px">${r.area.toLocaleString()}</td>
            <td style="padding:3px 6px;text-align:center;font-size:7.5px;font-weight:600">${r.pitch}</td>
            <td style="padding:3px 6px;text-align:right;font-size:7.5px;color:#555">${pctOfTotal}%</td>
          </tr>`}).join('')}
          <tr style="border-top:1px solid #ccc;background:#f0f3f7">
            <td style="padding:3px 6px;font-weight:700;font-size:7.5px">Total Field Area</td>
            <td style="padding:3px 6px;text-align:right;font-weight:800;font-size:8px;color:#001a44">${report.total_true_area_sqft.toLocaleString()} SF</td>
            <td style="padding:3px 6px;text-align:center;font-size:7px;font-weight:600">${predominantPitch}</td>
            <td style="padding:3px 6px;text-align:right;font-size:7px">100%</td>
          </tr>
          <tr style="border-top:2px solid #001a44;background:#e6edf5">
            <td style="padding:4px 6px;font-weight:800;font-size:8px;color:#001a44">Total (w/${mat.waste_pct || 15}% waste)</td>
            <td colspan="3" style="padding:4px 6px;text-align:right;font-weight:900;font-size:9px;color:#001a44">${grossAreaSF.toLocaleString()} SF</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Total Area Summary strip + Area by Pitch (compact row) -->
  <div style="padding:6px 22px 0">
    <div style="display:flex;gap:0;border:1px solid #ccc;border-radius:4px;overflow:hidden;font-size:7px">
      <div style="flex:1;text-align:center;padding:4px;background:#f5f5f5;border-right:1px solid #ddd">
        <div style="font-size:6px;color:#888;font-weight:700;text-transform:uppercase">Ridge</div>
        <div style="font-size:10px;font-weight:900;color:#DC2626">${es.total_ridge_ft} <span style="font-size:6px">LF</span></div>
      </div>
      <div style="flex:1;text-align:center;padding:4px;background:#f5f5f5;border-right:1px solid #ddd">
        <div style="font-size:6px;color:#888;font-weight:700;text-transform:uppercase">Eave</div>
        <div style="font-size:10px;font-weight:900;color:#16A34A">${es.total_eave_ft} <span style="font-size:6px">LF</span></div>
      </div>
      <div style="flex:1;text-align:center;padding:4px;background:#f5f5f5;border-right:1px solid #ddd">
        <div style="font-size:6px;color:#888;font-weight:700;text-transform:uppercase">Valley</div>
        <div style="font-size:10px;font-weight:900;color:#2563EB">${es.total_valley_ft} <span style="font-size:6px">LF</span></div>
      </div>
      <div style="flex:1;text-align:center;padding:4px;background:#f5f5f5;border-right:1px solid #ddd">
        <div style="font-size:6px;color:#888;font-weight:700;text-transform:uppercase">Hip</div>
        <div style="font-size:10px;font-weight:900;color:#EA580C">${es.total_hip_ft} <span style="font-size:6px">LF</span></div>
      </div>
      <div style="flex:1;text-align:center;padding:4px;background:#f5f5f5;border-right:1px solid #ddd">
        <div style="font-size:6px;color:#888;font-weight:700;text-transform:uppercase">Perimeter</div>
        <div style="font-size:10px;font-weight:900;color:#001a44">${totalPerimeter} <span style="font-size:6px">LF</span></div>
      </div>
      <div style="flex:1;text-align:center;padding:4px;background:#e0f7fa">
        <div style="font-size:6px;color:#00695C;font-weight:700;text-transform:uppercase">Gross Area</div>
        <div style="font-size:10px;font-weight:900;color:#00695C">${grossAreaSF.toLocaleString()} <span style="font-size:6px">SF</span></div>
      </div>
    </div>
  </div>

  <!-- Drawing Key -->
  <div style="padding:4px 22px 6px">
    <div style="font-size:8px;font-weight:700;color:#333;margin-bottom:3px">Drawing Key &mdash; Industry Standard Color Coding</div>
    <div style="display:flex;gap:14px;flex-wrap:wrap;font-size:7.5px;color:#444">
      <div style="display:flex;align-items:center;gap:4px"><span style="width:16px;height:3px;background:#DC2626;display:inline-block;border-radius:1px"></span>Ridge</div>
      <div style="display:flex;align-items:center;gap:4px"><span style="width:16px;height:3px;background:#16A34A;display:inline-block;border-radius:1px"></span>Eave</div>
      <div style="display:flex;align-items:center;gap:4px"><span style="width:16px;height:3px;background:#2563EB;display:inline-block;border-radius:1px"></span>Valley</div>
      <div style="display:flex;align-items:center;gap:4px"><span style="width:16px;height:3px;background:#EA580C;display:inline-block;border-radius:1px"></span>Hip</div>
      <div style="display:flex;align-items:center;gap:4px"><span style="width:16px;height:3px;background:#7C3AED;display:inline-block;border-radius:1px"></span>Rake Edge</div>
      ${es.total_parapet_ft ? `<div style="display:flex;align-items:center;gap:4px"><span style="width:16px;height:3px;background:#78716C;display:inline-block;border-radius:1px"></span>Parapet</div>` : ''}
      ${(es.total_step_flashing_ft || 0) > 0 ? `<div style="display:flex;align-items:center;gap:4px"><span style="width:16px;height:3px;background:#F59E0B;display:inline-block;border-radius:1px"></span>Step Flashing</div>` : ''}
    </div>
  </div>

  <!-- Page 1 Footer -->
  <div style="position:absolute;bottom:0;left:0;right:0;padding:6px 22px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid #eee;background:#fff">
    <div style="display:flex;align-items:center;gap:6px">
      <div style="width:16px;height:16px;background:#00838F;border-radius:3px;display:flex;align-items:center;justify-content:center">
        <div style="width:8px;height:8px;border:1.5px solid #fff;border-radius:1px"></div>
      </div>
      <span style="font-size:9px;font-weight:800;color:#00838F">ROOF REPORTER AI</span>
    </div>
    <div style="font-size:6.5px;color:#999">&copy; Roof Manager &bull; ${reportDate} &bull; p.1/2</div>
  </div>
</div>

<!-- ==================== PAGE 2: PROJECT TOTALS SUMMARY (Landscape 11×8.5) ==================== -->
<div class="page page-landscape">
  <!-- Top teal accent bar -->
  <div style="height:5px;background:linear-gradient(90deg,#00838F,#00BCD4,#00838F)"></div>

  <!-- Logo + Address -->
  <div style="padding:10px 28px 6px;display:flex;justify-content:space-between;align-items:flex-start">
    <div style="display:flex;align-items:center;gap:10px">
      <div style="width:48px;height:48px;background:linear-gradient(135deg,#00838F,#00BCD4);border-radius:8px;display:flex;align-items:center;justify-content:center;position:relative">
        <div style="width:20px;height:16px;border:2.5px solid #fff;border-radius:2px;position:relative">
          <div style="position:absolute;top:-6px;left:50%;transform:translateX(-50%);width:0;height:0;border-left:12px solid transparent;border-right:12px solid transparent;border-bottom:8px solid #fff"></div>
        </div>
      </div>
      <div>
        <div style="font-size:22px;font-weight:900;color:#00838F;letter-spacing:0.5px;line-height:1.1">ROOF</div>
        <div style="font-size:12px;font-weight:600;color:#00838F;letter-spacing:2px">REPORTER AI</div>
      </div>
    </div>
    <div style="text-align:right">
      <div style="font-size:14px;font-weight:700;color:#1a1a1a">${fullAddress}</div>
      <div style="font-size:9px;color:#777;margin-top:2px">${prop.homeowner_name ? 'Homeowner: ' + prop.homeowner_name + ' &bull; ' : ''}Report Date: ${reportDate}</div>
    </div>
  </div>

  <!-- Two-column layout: Left=data, Right=satellite -->
  <div style="padding:0 22px;display:grid;grid-template-columns:42% 56%;gap:16px">
    <!-- LEFT COLUMN: Project Totals -->
    <div>
      <div style="font-size:12px;font-weight:800;color:#00696B;margin-bottom:6px;letter-spacing:0.5px">Project Totals</div>

      <!-- Total Roof Area highlight box -->
      <div style="background:linear-gradient(135deg,#00838F,#00ACC1);border-radius:5px;padding:8px 14px;display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:11px;font-weight:700;color:#fff">Total Roof Area</span>
        <span style="font-size:16px;font-weight:900;color:#fff">${netAreaSF.toLocaleString()} SF</span>
      </div>

      <!-- Slope breakdown -->
      <div style="font-size:8px;color:#666;margin-bottom:2px;font-weight:600">Slope Breakdown &mdash; Predominant ${predominantPitch}</div>
      <div style="border:1px solid #e5e5e5;border-radius:4px;overflow:hidden;margin-bottom:6px">
        ${standardSlopeArea > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 10px;font-size:8px;border-bottom:1px solid #eee"><span style="color:#555">Standard Slope (4:12–9:12)</span><span style="font-weight:700;color:#1a1a1a">${Math.round(standardSlopeArea).toLocaleString()} SF</span></div>` : ''}
        ${flatSlopeArea > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 10px;font-size:8px;border-bottom:1px solid #eee"><span style="color:#555">Flat Slope (0:12–2:12)</span><span style="font-weight:700;color:#1a1a1a">${Math.round(flatSlopeArea).toLocaleString()} SF</span></div>` : ''}
        ${lowSlopeArea > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 10px;font-size:8px;border-bottom:1px solid #eee"><span style="color:#555">Low Slope (2:12–4:12)</span><span style="font-weight:700;color:#1a1a1a">${Math.round(lowSlopeArea).toLocaleString()} SF</span></div>` : ''}
        ${steepSlopeArea > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 10px;font-size:8px;border-bottom:1px solid #eee;background:#e0f7fa"><span style="color:#00695C;font-weight:600">Steep Slope (9:12 or greater)</span><span style="font-weight:800;color:#00695C">${Math.round(steepSlopeArea).toLocaleString()} SF</span></div>` : ''}
        ${highRoofArea > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 10px;font-size:8px;border-bottom:1px solid #eee"><span style="color:#555">High Roof (over 1 story)</span><span style="font-weight:700;color:#1a1a1a">${Math.round(highRoofArea).toLocaleString()} SF</span></div>` : ''}
        ${iwbSqft > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 10px;font-size:8px"><span style="color:#555">IWB (Ice &amp; Water Barrier)</span><span style="font-weight:700;color:#1a1a1a">${iwbSqft.toLocaleString()} SF</span></div>` : ''}
      </div>

      <!-- Roof Planes & Structures -->
      <div style="border:1px solid #e5e5e5;border-radius:4px;overflow:hidden;margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;padding:4px 10px;font-size:8px;border-bottom:1px solid #eee"><span style="color:#555">Roof Planes</span><span style="font-weight:700">${report.segments.length}</span></div>
        <div style="display:flex;justify-content:space-between;padding:4px 10px;font-size:8px"><span style="color:#555">Structures</span><span style="font-weight:700">1</span></div>
      </div>

      <!-- Perimeter measurements -->
      <div style="font-size:8px;color:#666;margin-bottom:2px;font-weight:600">Perimeter</div>
      <div style="border:1px solid #e5e5e5;border-radius:4px;overflow:hidden;margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;padding:4px 10px;font-size:8px;border-bottom:1px solid #eee"><span style="color:#555">Eave</span><span style="font-weight:700">${es.total_eave_ft} LF</span></div>
        <div style="display:flex;justify-content:space-between;padding:4px 10px;font-size:8px;border-bottom:1px solid #eee"><span style="color:#555">Rake Edge</span><span style="font-weight:700">${es.total_rake_ft} LF</span></div>
        <div style="display:flex;justify-content:space-between;padding:4px 10px;font-size:8px;background:#e0f7fa"><span style="color:#00695C;font-weight:600">Total Perimeter</span><span style="font-weight:800;color:#00695C">${totalPerimeter} LF</span></div>
      </div>

      <!-- Linear measurements -->
      <div style="font-size:8px;color:#666;margin-bottom:2px;font-weight:600">Linear Measurements</div>
      <div style="border:1px solid #e5e5e5;border-radius:4px;overflow:hidden;margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;padding:4px 10px;font-size:8px;border-bottom:1px solid #eee"><span style="color:#555">Ridge</span><span style="font-weight:700">${es.total_ridge_ft} LF</span></div>
        ${es.total_hip_ft > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 10px;font-size:8px;border-bottom:1px solid #eee"><span style="color:#555">Hip</span><span style="font-weight:700">${es.total_hip_ft} LF</span></div>` : ''}
        ${es.total_valley_ft > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 10px;font-size:8px;border-bottom:1px solid #eee"><span style="color:#555">Valley</span><span style="font-weight:700">${es.total_valley_ft} LF</span></div>` : ''}
        ${(es.total_transition_ft || 0) > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 10px;font-size:8px;border-bottom:1px solid #eee"><span style="color:#555">Slope Change</span><span style="font-weight:700">${es.total_transition_ft} LF</span></div>` : ''}
        ${(es.total_step_flashing_ft || 0) > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 10px;font-size:8px;border-bottom:1px solid #eee"><span style="color:#555">Step Flashing</span><span style="font-weight:700">${es.total_step_flashing_ft} LF</span></div>` : ''}
        ${(es.total_wall_flashing_ft || 0) > 0 ? `<div style="display:flex;justify-content:space-between;padding:4px 10px;font-size:8px"><span style="color:#555">Headwall Flashing</span><span style="font-weight:700">${es.total_wall_flashing_ft} LF</span></div>` : ''}
      </div>
    </div>

    <!-- RIGHT COLUMN: Satellite Image -->
    <div>
      <div style="border:1px solid #ddd;border-radius:4px;overflow:hidden;background:#1a2332;height:380px;display:flex;align-items:center;justify-content:center">
        ${overheadUrl
          ? `<img src="${overheadUrl}" alt="Aerial View" style="max-width:100%;max-height:100%;object-fit:contain;display:block" onerror="this.style.display='none'">`
          : `<div style="background:#e8ecf1;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;width:100%;height:100%">Satellite imagery not available</div>`
        }
      </div>
      <div style="font-size:7px;color:#999;text-align:right;margin-top:2px">Imagery &copy; Google Maps</div>
    </div>
  </div>

  <!-- Waste Factor Table (full width) -->
  <div style="padding:8px 22px 0">
    <div style="font-size:9px;font-weight:800;color:#333;text-align:center;margin-bottom:4px">Waste Factor (Total Roof Area)</div>
    <table style="width:100%;border-collapse:collapse;font-size:7.5px;border:1px solid #ddd">
      <tbody>
        <tr>
          ${wasteTableEntries.slice(0, 6).map(w => `
          <td style="padding:4px 6px;border:1px solid #ddd;text-align:center;${w.pct === (mat.waste_pct || 15) ? 'background:#e0f7fa;font-weight:800' : ''}">
            <div style="font-weight:700;color:#555">${w.pct}%</div>
            <div style="font-weight:600;color:#1a1a1a;margin-top:1px">${w.sf.toLocaleString()} SF</div>
          </td>`).join('')}
        </tr>
        <tr>
          ${wasteTableEntries.slice(6).map(w => `
          <td style="padding:4px 6px;border:1px solid #ddd;text-align:center;${w.pct === (mat.waste_pct || 15) ? 'background:#e0f7fa;font-weight:800' : ''}">
            <div style="font-weight:700;color:#555">${w.pct}%</div>
            <div style="font-weight:600;color:#1a1a1a;margin-top:1px">${w.sf.toLocaleString()} SF</div>
          </td>`).join('')}
        </tr>
      </tbody>
    </table>
  </div>

  <!-- Disclaimer bar -->
  <div style="margin:8px 22px 0;background:#FFC107;border-radius:3px;padding:5px 12px">
    <div style="font-size:6.5px;font-weight:700;color:#333;text-align:center;text-transform:uppercase;line-height:1.5">
      THIS REPORT IS FOR ESTIMATION PURPOSES ONLY. VERIFY ALL DIMENSIONS AND TOTALS BEFORE PURCHASING MATERIALS.<br>
      THIS REPORT IS THE PROPERTY OF ROOF REPORTER AI AND MAY NOT BE REPRODUCED WITHOUT WRITTEN CONSENT.
    </div>
  </div>

  <!-- Page 2 Footer -->
  <div style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(135deg,#00696B,#00838F);padding:8px 22px;display:flex;justify-content:space-between;align-items:center">
    <span style="font-size:9px;font-weight:700;color:#fff">Roof Manager</span>
    <span style="font-size:7px;color:rgba(255,255,255,0.7)">&copy; Roof Manager &bull; ${fullAddress} &bull; ${reportDate} &bull; p.2/2</span>
  </div>
</div>

</body>
</html>`
}

// ============================================================
// MATERIAL TAKE-OFF PAGE — Complete material quantities
// Shingles, underlayment, ice shield, ridge cap, starter,
// drip edge, valley flashing, nails, caulk
// ============================================================
function buildMaterialTakeoffPage(report: RoofReport, reportNum: string, reportDate: string, fullAddress: string): string {
  const traceMat = (report as any).trace_measurement?.materials_estimate
  const mat = report.materials || {} as any
  if (!traceMat && !mat.line_items?.length) return ''

  const TEAL = '#00897B'
  const TEAL_DARK = '#00695C'
  const TEAL_LIGHT = '#E0F2F1'
  const netArea = Math.round(report.total_true_area_sqft || 0)
  const wastePct = mat.waste_pct || 15
  const grossArea = Math.round(netArea * (1 + wastePct / 100))

  // Use trace materials if available, otherwise calculate from report.materials
  const m = traceMat || {
    shingles_squares_net: Math.round(netArea / 100 * 10) / 10,
    shingles_squares_gross: Math.round(grossArea / 100 * 10) / 10,
    shingles_bundles: Math.ceil(grossArea / 100 * 3),
    underlayment_rolls: Math.ceil(netArea / 400),
    ice_water_shield_sqft: Math.round((report.edge_summary?.total_eave_ft || 0) * 3),
    ice_water_shield_rolls_2sq: Math.ceil((report.edge_summary?.total_eave_ft || 0) * 3 / 200),
    ridge_cap_lf: Math.round((report.edge_summary?.total_ridge_ft || 0) + (report.edge_summary?.total_hip_ft || 0)),
    ridge_cap_bundles: Math.ceil(((report.edge_summary?.total_ridge_ft || 0) + (report.edge_summary?.total_hip_ft || 0)) / 20),
    starter_strip_lf: Math.round((report.edge_summary?.total_eave_ft || 0) + (report.edge_summary?.total_rake_ft || 0)),
    drip_edge_eave_lf: Math.round(report.edge_summary?.total_eave_ft || 0),
    drip_edge_rake_lf: Math.round(report.edge_summary?.total_rake_ft || 0),
    drip_edge_total_lf: Math.round((report.edge_summary?.total_eave_ft || 0) + (report.edge_summary?.total_rake_ft || 0)),
    valley_flashing_lf: Math.round(report.edge_summary?.total_valley_ft || 0),
    roofing_nails_lbs: Math.ceil(grossArea / 100 * 2.5),
    caulk_tubes: Math.max(2, Math.ceil(netArea / 1000))
  }

  // Resolve shingle name from the materials line_items if available
  const shingleLine = mat.line_items?.find((li: any) => li.category === 'shingles')
  const shingleName = shingleLine?.description?.replace(' Shingles', '') || 'Architectural (Laminate)'
  const shingleNote = shingleLine?.notes
  // Extract warranty/wind from notes like "IKO Cambridge... | 30-year warranty | Wind: 210 km/h | Class A"
  const warrantyMatch = shingleNote?.match(/(\d+[-\s]?year|Ltd\.\s*Lifetime|Lifetime|Limited Lifetime)/i)
  const windMatch = shingleNote?.match(/Wind:\s*(\d+)\s*km\/h/i)
  const shingleWarranty = warrantyMatch ? warrantyMatch[1] : ''
  const shingleWind = windMatch ? windMatch[1] + ' km/h' : ''
  const shingleSpec = [shingleWarranty ? shingleWarranty + ' warranty' : '', shingleWind ? 'Wind: ' + shingleWind : ''].filter(Boolean).join(' | ')

  const items = [
    { cat: 'Field Shingles', desc: shingleName + ' shingles', qty: m.shingles_bundles, unit: 'bundles', note: `${m.shingles_squares_gross} sq gross (${m.shingles_squares_net} net + ${wastePct}% waste)${shingleSpec ? ' | ' + shingleSpec : ''}`, icon: '&#9632;', color: '#0891b2' },
    { cat: 'Underlayment', desc: 'Synthetic roof underlayment (15 sq/roll)', qty: m.underlayment_rolls, unit: 'rolls', note: `Covers ${netArea.toLocaleString()} SF net roof area`, icon: '&#9632;', color: '#6366f1' },
    { cat: 'Ice &amp; Water Shield', desc: 'Self-adhering membrane (eave line × 3ft)', qty: m.ice_water_shield_rolls_2sq, unit: 'rolls (2 sq)', note: `${m.ice_water_shield_sqft.toLocaleString()} SF total IWB area`, icon: '&#10052;', color: '#2563eb' },
    { cat: 'Ridge Cap', desc: 'Hip &amp; ridge cap shingles', qty: m.ridge_cap_bundles, unit: 'bundles', note: `${m.ridge_cap_lf} LF total ridge + hip`, icon: '&#9650;', color: '#dc2626' },
    { cat: 'Starter Strip', desc: 'Starter shingles (eave + rake perimeter)', qty: Math.ceil(m.starter_strip_lf / 100), unit: 'rolls', note: `${m.starter_strip_lf} LF perimeter`, icon: '&#9644;', color: '#16a34a' },
    { cat: 'Drip Edge — Eave', desc: 'Metal drip edge, eave profile (10.5ft sticks)', qty: Math.ceil(m.drip_edge_eave_lf / 10.5), unit: 'sticks', note: `${m.drip_edge_eave_lf} LF`, icon: '&#9472;', color: '#16a34a' },
    { cat: 'Drip Edge — Rake', desc: 'Metal drip edge, rake profile (10.5ft sticks)', qty: Math.ceil(m.drip_edge_rake_lf / 10.5), unit: 'sticks', note: `${m.drip_edge_rake_lf} LF`, icon: '&#9472;', color: '#7c3aed' },
    { cat: 'Valley Flashing', desc: 'Pre-bent W-valley metal or roll valley', qty: Math.ceil(m.valley_flashing_lf / 10), unit: 'pcs', note: `${m.valley_flashing_lf} LF total valley`, icon: '&#9660;', color: '#2563eb' },
    { cat: 'Roofing Nails', desc: '1.25″ galvanized coil nails', qty: m.roofing_nails_lbs, unit: 'lbs', note: 'Approx 2.5 lbs per square', icon: '&#9733;', color: '#64748b' },
    { cat: 'Caulk / Sealant', desc: 'Roofing sealant tubes', qty: m.caulk_tubes, unit: 'tubes', note: 'Flashings, vents, and penetrations', icon: '&#9679;', color: '#f59e0b' }
  ]

  return `
<!-- ==================== MATERIAL TAKE-OFF PAGE ==================== -->
<div class="page">
  <div style="height:4px;background:linear-gradient(90deg,${TEAL},#26a69a)"></div>
  <div style="padding:12px 28px 8px">
    <div style="font-size:14px;font-weight:800;color:#222">Complete Material Take-Off</div>
    <div style="font-size:10px;color:#555">${fullAddress}</div>
  </div>

  <!-- Summary strip -->
  <div style="margin:0 28px 10px;display:flex;gap:8px">
    <div style="flex:1;background:linear-gradient(135deg,${TEAL},#26a69a);border-radius:6px;padding:10px;text-align:center;color:#fff">
      <div style="font-size:7px;font-weight:700;text-transform:uppercase;opacity:0.8;letter-spacing:0.5px">Net Roof Area</div>
      <div style="font-size:18px;font-weight:900">${netArea.toLocaleString()} SF</div>
    </div>
    <div style="flex:1;background:linear-gradient(135deg,#0891b2,#06b6d4);border-radius:6px;padding:10px;text-align:center;color:#fff">
      <div style="font-size:7px;font-weight:700;text-transform:uppercase;opacity:0.8;letter-spacing:0.5px">Gross w/${wastePct}% Waste</div>
      <div style="font-size:18px;font-weight:900">${grossArea.toLocaleString()} SF</div>
    </div>
    <div style="flex:1;background:linear-gradient(135deg,#4338ca,#6366f1);border-radius:6px;padding:10px;text-align:center;color:#fff">
      <div style="font-size:7px;font-weight:700;text-transform:uppercase;opacity:0.8;letter-spacing:0.5px">Total Bundles</div>
      <div style="font-size:18px;font-weight:900">${m.shingles_bundles}</div>
    </div>
    <div style="flex:1;background:linear-gradient(135deg,#dc2626,#ef4444);border-radius:6px;padding:10px;text-align:center;color:#fff">
      <div style="font-size:7px;font-weight:700;text-transform:uppercase;opacity:0.8;letter-spacing:0.5px">Ridge Cap</div>
      <div style="font-size:18px;font-weight:900">${m.ridge_cap_lf} LF</div>
    </div>
  </div>

  <!-- Material Table -->
  <div style="padding:0 28px">
    <table style="width:100%;border-collapse:collapse;font-size:8.5px">
      <thead>
        <tr style="background:#1a1a2e;color:#fff">
          <th style="padding:5px 8px;text-align:left;font-size:7.5px;font-weight:700;width:28%">Material</th>
          <th style="padding:5px 8px;text-align:left;font-size:7.5px;font-weight:700;width:28%">Description</th>
          <th style="padding:5px 8px;text-align:center;font-size:7.5px;font-weight:700;width:10%">Quantity</th>
          <th style="padding:5px 8px;text-align:center;font-size:7.5px;font-weight:700;width:8%">Unit</th>
          <th style="padding:5px 8px;text-align:left;font-size:7.5px;font-weight:700;width:26%">Notes</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item, i) => `
        <tr style="${i % 2 === 0 ? '' : 'background:#f8fafc'};border-bottom:1px solid #eee">
          <td style="padding:5px 8px;font-weight:700"><span style="color:${item.color};margin-right:3px">${item.icon}</span>${item.cat}</td>
          <td style="padding:5px 8px;color:#555">${item.desc}</td>
          <td style="padding:5px 8px;text-align:center;font-weight:800;font-size:10px;color:${item.color}">${item.qty}</td>
          <td style="padding:5px 8px;text-align:center;font-size:7.5px;color:#777">${item.unit}</td>
          <td style="padding:5px 8px;font-size:7.5px;color:#666">${item.note}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <!-- Waste factor table on Page 1 — not duplicated here -->

  <!-- Notes -->
  <div style="padding:10px 28px 0">
    <div style="padding:6px 10px;background:#fffbeb;border:1px solid #fde68a;border-radius:4px;font-size:7px;color:#92400e;line-height:1.5">
      <strong>Material Notes:</strong> Quantities include standard waste factor. Verify quantities with your supplier before purchasing. Material availability and prices may vary by region. Bundle counts based on 3 bundles per roofing square for architectural shingles. Underlayment based on 15-square rolls. IWB (Ice &amp; Water Barrier) calculated at 3ft depth from eave edge per building code requirements.
    </div>
  </div>

  <!-- Footer bar -->
  <div style="position:absolute;bottom:0;left:0;right:0;height:28px;background:linear-gradient(90deg,${TEAL},#26a69a);display:flex;align-items:center;justify-content:space-between;padding:0 28px">
    <span style="color:#fff;font-size:9px;font-weight:700">Roof Manager</span>
    <span style="color:#E0F2F1;font-size:7.5px">roofmanager.ca &bull; Report: ${reportNum} &bull; ${reportDate} &bull; Material Take-Off</span>
  </div>
</div>`
}

// ============================================================
// EDGE BREAKDOWN PAGE — Individual edge-by-edge detail
// Eave edges with lengths, ridges, hips, valleys, rakes
// ============================================================
function buildEdgeBreakdownPage(report: RoofReport, reportNum: string, reportDate: string, fullAddress: string): string {
  const tm = (report as any).trace_measurement as any
  if (!tm) return '' // Only show for trace-measured reports

  const AMBER = '#d97706'
  const AMBER_DARK = '#92400e'

  // Edge type row builder
  const edgeTypeRows = (details: any[], type: string, label: string, color: string, totalFt: number) => {
    if (!details || details.length === 0) return ''
    return `
    <tr style="background:${color}10;border-top:2px solid ${color}">
      <td colspan="5" style="padding:5px 8px;font-weight:800;font-size:9px;color:${color}"><span style="display:inline-block;width:14px;height:3px;background:${color};border-radius:1px;margin-right:6px;vertical-align:middle"></span>${label} — ${details.length} segments, ${totalFt} LF total</td>
    </tr>
    ${details.map((d: any, i: number) => `
    <tr style="${i % 2 === 0 ? '' : 'background:#f8fafc'};border-bottom:1px solid #f1f5f9">
      <td style="padding:3px 8px;font-weight:600;font-size:8px">${d.id || d.edge_num || (i + 1)}</td>
      <td style="padding:3px 8px;font-size:8px;color:#555">${type}</td>
      <td style="padding:3px 8px;text-align:right;font-weight:700;font-size:8px">${Math.round((d.horiz_length_ft || d.length_2d_ft || 0) * 10) / 10}</td>
      <td style="padding:3px 8px;text-align:right;font-size:8px;color:#555">${Math.round((d.sloped_length_ft || d.length_3d_ft || d.horiz_length_ft || d.length_2d_ft || 0) * 10) / 10}</td>
      <td style="padding:3px 8px;text-align:center;font-size:7px;color:#888">${d.slope_factor ? d.slope_factor.toFixed(3) : d.bearing_deg ? Math.round(d.bearing_deg) + '°' : '—'}</td>
    </tr>`).join('')}`
  }

  return `
<!-- ==================== EDGE BREAKDOWN PAGE ==================== -->
<div class="page">
  <div style="height:4px;background:linear-gradient(90deg,${AMBER},#f59e0b)"></div>
  <div style="padding:12px 28px 8px">
    <div style="font-size:14px;font-weight:800;color:#222">Detailed Edge Breakdown</div>
    <div style="font-size:10px;color:#555">${fullAddress}</div>
  </div>

  <!-- Summary strip -->
  <div style="margin:0 28px 10px;display:flex;gap:6px;font-size:8px">
    <div style="flex:1;text-align:center;padding:6px;background:#fef2f2;border-radius:4px;border:1px solid #fecaca">
      <div style="font-size:14px;font-weight:900;color:#dc2626">${tm.linear_measurements.ridges_total_ft} <span style="font-size:7px">LF</span></div>
      <div style="font-size:6.5px;color:#991b1b;font-weight:700">${tm.key_measurements.num_ridges} Ridges</div>
    </div>
    <div style="flex:1;text-align:center;padding:6px;background:#f0fdf4;border-radius:4px;border:1px solid #bbf7d0">
      <div style="font-size:14px;font-weight:900;color:#16a34a">${tm.linear_measurements.eaves_total_ft} <span style="font-size:7px">LF</span></div>
      <div style="font-size:6.5px;color:#166534;font-weight:700">${tm.key_measurements.num_eave_points} Eave Pts</div>
    </div>
    <div style="flex:1;text-align:center;padding:6px;background:#eff6ff;border-radius:4px;border:1px solid #bfdbfe">
      <div style="font-size:14px;font-weight:900;color:#2563eb">${tm.linear_measurements.valleys_total_ft} <span style="font-size:7px">LF</span></div>
      <div style="font-size:6.5px;color:#1e40af;font-weight:700">${tm.key_measurements.num_valleys} Valleys</div>
    </div>
    <div style="flex:1;text-align:center;padding:6px;background:#fff7ed;border-radius:4px;border:1px solid #fed7aa">
      <div style="font-size:14px;font-weight:900;color:#ea580c">${tm.linear_measurements.hips_total_ft} <span style="font-size:7px">LF</span></div>
      <div style="font-size:6.5px;color:#9a3412;font-weight:700">${tm.key_measurements.num_hips} Hips</div>
    </div>
    <div style="flex:1;text-align:center;padding:6px;background:#faf5ff;border-radius:4px;border:1px solid #e9d5ff">
      <div style="font-size:14px;font-weight:900;color:#7c3aed">${tm.linear_measurements.rakes_total_ft} <span style="font-size:7px">LF</span></div>
      <div style="font-size:6.5px;color:#5b21b6;font-weight:700">${tm.key_measurements.num_rakes} Rakes</div>
    </div>
  </div>

  <!-- Edge Detail Table -->
  <div style="padding:0 28px">
    <table style="width:100%;border-collapse:collapse;font-size:8px">
      <thead>
        <tr style="background:#1a1a2e;color:#fff">
          <th style="padding:4px 8px;text-align:left;font-size:7px;font-weight:700">ID</th>
          <th style="padding:4px 8px;text-align:left;font-size:7px;font-weight:700">Type</th>
          <th style="padding:4px 8px;text-align:right;font-size:7px;font-weight:700">Horiz. Length</th>
          <th style="padding:4px 8px;text-align:right;font-size:7px;font-weight:700">True Length</th>
          <th style="padding:4px 8px;text-align:center;font-size:7px;font-weight:700">Factor/Bearing</th>
        </tr>
      </thead>
      <tbody>
        ${edgeTypeRows(tm.eave_edge_breakdown, 'Eave', 'Eave Edges', '#16a34a', tm.linear_measurements.eaves_total_ft)}
        ${edgeTypeRows(tm.ridge_details, 'Ridge', 'Ridge Lines', '#dc2626', tm.linear_measurements.ridges_total_ft)}
        ${edgeTypeRows(tm.hip_details, 'Hip', 'Hip Lines', '#ea580c', tm.linear_measurements.hips_total_ft)}
        ${edgeTypeRows(tm.valley_details, 'Valley', 'Valley Lines', '#2563eb', tm.linear_measurements.valleys_total_ft)}
        ${edgeTypeRows(tm.rake_details, 'Rake', 'Rake Edges', '#7c3aed', tm.linear_measurements.rakes_total_ft)}
        <tr style="background:#f1f5f9;font-weight:800;border-top:2px solid #1a1a2e">
          <td colspan="2" style="padding:5px 8px;font-size:9px">TOTAL ALL EDGES</td>
          <td style="padding:5px 8px;text-align:right;font-size:9px">${Math.round(tm.linear_measurements.eaves_total_ft + tm.linear_measurements.ridges_total_ft + tm.linear_measurements.hips_total_ft + tm.linear_measurements.valleys_total_ft + tm.linear_measurements.rakes_total_ft)} LF</td>
          <td colspan="2"></td>
        </tr>
      </tbody>
    </table>
  </div>

  ${tm.face_details && tm.face_details.length > 0 ? `
  <!-- Face Details -->
  <div style="padding:10px 28px 0">
    <div style="font-size:10px;font-weight:800;color:#333;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;border-bottom:2px solid ${AMBER};padding-bottom:3px">Roof Face Details</div>
    <table style="width:100%;border-collapse:collapse;font-size:8px">
      <thead>
        <tr style="background:#fef3c7">
          <th style="padding:4px 8px;text-align:left;font-size:7px;font-weight:700;color:#92400e">Face</th>
          <th style="padding:4px 8px;text-align:center;font-size:7px;font-weight:700;color:#92400e">Pitch</th>
          <th style="padding:4px 8px;text-align:right;font-size:7px;font-weight:700;color:#92400e">Projected Area</th>
          <th style="padding:4px 8px;text-align:right;font-size:7px;font-weight:700;color:#92400e">Sloped Area</th>
          <th style="padding:4px 8px;text-align:right;font-size:7px;font-weight:700;color:#92400e">Squares</th>
          <th style="padding:4px 8px;text-align:center;font-size:7px;font-weight:700;color:#92400e">Slope Factor</th>
        </tr>
      </thead>
      <tbody>
        ${tm.face_details.map((f: any, i: number) => `
        <tr style="${i % 2 === 0 ? '' : 'background:#fffbeb'};border-bottom:1px solid #fde68a">
          <td style="padding:3px 8px;font-weight:700">${f.face_id}</td>
          <td style="padding:3px 8px;text-align:center;font-weight:600">${f.pitch_label}</td>
          <td style="padding:3px 8px;text-align:right">${Math.round(f.projected_area_ft2).toLocaleString()} SF</td>
          <td style="padding:3px 8px;text-align:right;font-weight:700">${Math.round(f.sloped_area_ft2).toLocaleString()} SF</td>
          <td style="padding:3px 8px;text-align:right">${f.squares.toFixed(1)}</td>
          <td style="padding:3px 8px;text-align:center;color:#555">×${f.slope_factor.toFixed(4)}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : ''}

  <!-- Footer bar -->
  <div style="position:absolute;bottom:0;left:0;right:0;height:28px;background:linear-gradient(90deg,${AMBER},#f59e0b);display:flex;align-items:center;justify-content:space-between;padding:0 28px">
    <span style="color:#fff;font-size:9px;font-weight:700">Roof Manager</span>
    <span style="color:#fef3c7;font-size:7.5px">roofmanager.ca &bull; Report: ${reportNum} &bull; ${reportDate} &bull; Edge Breakdown</span>
  </div>
</div>`
}

// ============================================================
// CROSS-CHECK & ADVISORY PAGE
// Shows Solar API cross-check data and advisory notes
// ============================================================
function buildCrossCheckAndAdvisoryPage(report: RoofReport, reportNum: string, reportDate: string, fullAddress: string): string {
  const tm = (report as any).trace_measurement as any
  const crossChecks = (report as any).quality?.notes || []
  const advisoryNotes = tm?.advisory_notes || []
  const hasContent = crossChecks.length > 0 || advisoryNotes.length > 0

  if (!hasContent) return ''

  const NAVY = '#1e3a5f'

  return `
<!-- ==================== CROSS-CHECK & ADVISORY PAGE ==================== -->
<div class="page">
  <div style="height:4px;background:linear-gradient(90deg,${NAVY},#334155)"></div>
  <div style="padding:12px 28px 8px">
    <div style="font-size:14px;font-weight:800;color:#222">Cross-Checks &amp; Advisory Notes</div>
  </div>

  ${crossChecks.length > 0 ? `
  <!-- Cross-Check with Solar API -->
  <div style="padding:0 28px 10px">
    <div style="font-size:11px;font-weight:800;color:${NAVY};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;border-bottom:2px solid ${NAVY};padding-bottom:3px">
      <span style="margin-right:6px">&#128269;</span>Quality &amp; Validation Notes
    </div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden">
      ${crossChecks.map((note: string, i: number) => `
      <div style="padding:8px 12px;border-bottom:1px solid #e2e8f0;font-size:8.5px;color:#334155;${i % 2 === 0 ? '' : 'background:#f1f5f9'}">
        <span style="color:#3b82f6;font-weight:700;margin-right:6px">&#9679;</span>${note}
      </div>`).join('')}
    </div>
  </div>` : ''}

  <!-- Measurement summary consolidated into Page 1 Project Totals -->

  ${(() => {
    const cc = tm?.cross_check
    const wb = tm?.key_measurements?.waste_breakdown
    const le = tm?.key_measurements?.labor_estimate
    const gw: string[] = tm?.geometry_warnings || []
    if (!cc && !wb && !le && gw.length === 0) return ''
    const ccPill = cc && (cc.verdict === 'aligned'
      ? { bg: '#dcfce7', fg: '#166534', label: 'Aligned' }
      : cc.verdict === 'minor_variance'
      ? { bg: '#fef3c7', fg: '#92400e', label: 'Minor' }
      : { bg: '#fee2e2', fg: '#991b1b', label: '>8%' })
    const sourceLabel = cc ? (cc.source === 'google_solar' ? 'Google Solar' : cc.source) : ''
    const cols = [cc && '1.3fr', wb && '1fr', le && '1fr'].filter(Boolean).join(' ')
    return `
  <div style="padding:0 28px 6px">
    <div style="display:grid;grid-template-columns:${cols};gap:6px">
      ${cc ? `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:5px;padding:6px 8px">
        <div style="font-size:7px;font-weight:800;color:${NAVY};text-transform:uppercase;letter-spacing:0.4px;margin-bottom:2px">Cross-check vs ${sourceLabel}</div>
        <div style="display:flex;align-items:center;gap:6px;font-size:8.5px;color:#0f172a;flex-wrap:wrap">
          <span><b>${Math.round(cc.engine_footprint_ft2).toLocaleString()}</b> ours</span>
          <span style="color:#94a3b8">vs</span>
          <span><b>${Math.round(cc.external_footprint_ft2).toLocaleString()}</b> ${sourceLabel}</span>
          <span style="margin-left:auto;background:${ccPill!.bg};color:${ccPill!.fg};padding:1px 5px;border-radius:3px;font-weight:800;font-size:8px">${cc.variance_pct}% ${ccPill!.label}</span>
        </div>
      </div>` : ''}
      ${wb ? `<div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:5px;padding:6px 8px">
        <div style="font-size:7px;font-weight:800;color:#5b21b6;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:2px">Waste ${wb.total_pct}% — drivers</div>
        <div style="font-size:8px;color:#4c1d95;line-height:1.35">${wb.drivers.map((d: any) => `${d.label} <b>+${d.pct}%</b>`).join(' &middot; ')}</div>
      </div>` : ''}
      ${le ? `<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:5px;padding:6px 8px">
        <div style="font-size:7px;font-weight:800;color:#065f46;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:2px">Labor est.</div>
        <div style="font-size:8.5px;color:#065f46;line-height:1.35">Crew ${le.crew_size} &middot; <b>${le.est_days_min}&ndash;${le.est_days_max} days</b> &middot; ${le.total_crew_hours} crew-hrs &middot; pitch ×${le.pitch_multiplier}</div>
      </div>` : ''}
    </div>
    ${gw.length > 0 ? `<div style="margin-top:4px;background:#fef2f2;border:1px solid #fca5a5;border-radius:5px;padding:4px 8px;font-size:8px;color:#7f1d1d;line-height:1.35"><b style="color:#b91c1c">&#9888; Geometry:</b> ${gw.join(' &middot; ')}</div>` : ''}
  </div>`
  })()}

  ${advisoryNotes.length > 0 ? `
  <!-- Advisory Notes -->
  <div style="padding:0 28px">
    <div style="font-size:11px;font-weight:800;color:#dc2626;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;border-bottom:2px solid #dc2626;padding-bottom:3px">
      <span style="margin-right:6px">&#9888;</span>Advisory Notes (${advisoryNotes.length})
    </div>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;overflow:hidden">
      ${advisoryNotes.map((note: string, i: number) => `
      <div style="padding:8px 12px;border-bottom:1px solid #fecaca;font-size:8.5px;color:#7f1d1d;${i % 2 === 0 ? '' : 'background:#fff5f5'}">
        <span style="color:#dc2626;font-weight:900;margin-right:6px">${i + 1}.</span>${note}
      </div>`).join('')}
    </div>
    <div style="padding:6px 0;font-size:7px;color:#94a3b8">
      Advisory notes are generated by the measurement engine based on geometric analysis. Review these items before finalizing material orders.
    </div>
  </div>` : ''}

  ${tm?.report_meta ? `
  <div style="padding:10px 28px 0">
    <div style="padding:5px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:3px;font-size:6.5px;color:#64748b;line-height:1.4">
      <strong>Engine:</strong> ${tm.report_meta.engine_version} &mdash; ${tm.report_meta.powered_by} &mdash; Generated: ${new Date(tm.report_meta.generated).toLocaleDateString('en-CA')}
    </div>
  </div>` : ''}

  <!-- Footer bar -->
  <div style="position:absolute;bottom:0;left:0;right:0;height:28px;background:linear-gradient(90deg,${NAVY},#334155);display:flex;align-items:center;justify-content:space-between;padding:0 28px">
    <span style="color:#fff;font-size:9px;font-weight:700">Roof Manager</span>
    <span style="color:#94a3b8;font-size:7.5px">roofmanager.ca &bull; Report: ${reportNum} &bull; ${reportDate} &bull; Cross-Check &amp; Advisory</span>
  </div>
</div>`
}

// ============================================================
// Customer Pricing Estimate — Page Section
// Shows cost estimate based on customer-provided price per bundle
// ============================================================
function buildCustomerPricingHTML(report: RoofReport): string {
  const pricePerBundle = report.customer_price_per_bundle || 0
  const grossSquares = report.customer_gross_squares || 0
  const totalCost = report.customer_total_cost_estimate || 0
  const trueArea = report.total_true_area_sqft || 0
  const netSquares = Math.round(trueArea / 100 * 10) / 10
  const wasteArea = Math.round(trueArea * 0.15)

  return `
<div style="page-break-before:always;max-width:1050px;margin:0 auto;padding:35px 40px;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:#fff">
  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;padding-bottom:16px;border-bottom:3px solid #f59e0b">
    <div>
      <div style="font-size:18px;font-weight:900;color:#92400e;letter-spacing:0.3px">
        <span style="display:inline-block;width:28px;height:28px;background:#f59e0b;color:white;text-align:center;line-height:28px;border-radius:4px;font-size:14px;margin-right:8px">$</span>
        CUSTOMER COST ESTIMATE
      </div>
      <div style="font-size:10px;color:#92400e;margin-top:4px;font-weight:500">Roof Replacement Pricing — Based on Client-Provided Rate</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:9px;color:#6b7a8d;text-transform:uppercase;letter-spacing:0.5px">Property</div>
      <div style="font-size:11px;font-weight:700;color:#003366">${report.property?.address || ''}</div>
    </div>
  </div>

  <!-- Summary Cards -->
  <div style="display:flex;gap:16px;margin-bottom:24px">
    <!-- Net Roof Area -->
    <div style="flex:1;background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:10px;padding:18px;text-align:center;border:1px solid #f59e0b30">
      <div style="font-size:9px;color:#92400e;font-weight:700;text-transform:uppercase;letter-spacing:0.8px">Net Roof Area</div>
      <div style="font-size:26px;font-weight:900;color:#92400e;margin:6px 0">${trueArea.toLocaleString()}</div>
      <div style="font-size:10px;color:#b45309">sq ft</div>
    </div>
    <!-- Waste Allowance -->
    <div style="flex:1;background:linear-gradient(135deg,#fff7ed,#fed7aa);border-radius:10px;padding:18px;text-align:center;border:1px solid #f59e0b30">
      <div style="font-size:9px;color:#92400e;font-weight:700;text-transform:uppercase;letter-spacing:0.8px">15% Waste Allowance</div>
      <div style="font-size:26px;font-weight:900;color:#ea580c;margin:6px 0">+${wasteArea.toLocaleString()}</div>
      <div style="font-size:10px;color:#b45309">sq ft</div>
    </div>
    <!-- Gross Squares -->
    <div style="flex:1;background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:10px;padding:18px;text-align:center;color:white">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;opacity:0.85">Total Squares</div>
      <div style="font-size:26px;font-weight:900;margin:6px 0">${grossSquares}</div>
      <div style="font-size:10px;opacity:0.85">(with 15% waste)</div>
    </div>
    <!-- Price Per Square -->
    <div style="flex:1;background:linear-gradient(135deg,#eef2ff,#c7d2fe);border-radius:10px;padding:18px;text-align:center;border:1px solid #818cf830">
      <div style="font-size:9px;color:#3730a3;font-weight:700;text-transform:uppercase;letter-spacing:0.8px">Rate Per Square</div>
      <div style="font-size:26px;font-weight:900;color:#4338ca;margin:6px 0">$${pricePerBundle.toLocaleString()}</div>
      <div style="font-size:10px;color:#6366f1">CAD</div>
    </div>
  </div>

  <!-- Total Cost Estimate -->
  <div style="background:linear-gradient(135deg,#1e3a5f,#0f172a);border-radius:12px;padding:28px 32px;color:white;text-align:center;margin-bottom:24px;position:relative;overflow:hidden">
    <div style="position:absolute;top:-20px;right:-20px;width:120px;height:120px;background:rgba(245,158,11,0.15);border-radius:50%"></div>
    <div style="position:absolute;bottom:-30px;left:-10px;width:80px;height:80px;background:rgba(245,158,11,0.1);border-radius:50%"></div>
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;opacity:0.7;margin-bottom:8px">Estimated Roof Replacement Cost</div>
    <div style="font-size:48px;font-weight:900;color:#fbbf24;text-shadow:0 2px 8px rgba(0,0,0,0.3)">$${totalCost.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
    <div style="font-size:12px;margin-top:6px;opacity:0.6">Canadian Dollars (CAD)</div>
  </div>

  <!-- Calculation Breakdown -->
  <div style="background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;padding:20px;margin-bottom:20px">
    <div style="font-size:12px;font-weight:700;color:#334155;margin-bottom:12px">
      <span style="display:inline-block;width:18px;height:18px;background:#f59e0b;color:white;text-align:center;line-height:18px;border-radius:3px;font-size:10px;margin-right:6px">&#8614;</span>
      Calculation Breakdown
    </div>
    <table style="width:100%;font-size:11px;border-collapse:collapse">
      <tr style="border-bottom:1px solid #e2e8f0">
        <td style="padding:8px 0;color:#64748b">Net Roof Area (3D true area)</td>
        <td style="padding:8px 0;text-align:right;font-weight:700;color:#334155">${trueArea.toLocaleString()} sq ft</td>
      </tr>
      <tr style="border-bottom:1px solid #e2e8f0">
        <td style="padding:8px 0;color:#64748b">Net Squares (area \u00F7 100)</td>
        <td style="padding:8px 0;text-align:right;font-weight:700;color:#334155">${netSquares}</td>
      </tr>
      <tr style="border-bottom:1px solid #e2e8f0">
        <td style="padding:8px 0;color:#64748b">Waste Factor</td>
        <td style="padding:8px 0;text-align:right;font-weight:700;color:#ea580c">+15%</td>
      </tr>
      <tr style="border-bottom:1px solid #e2e8f0">
        <td style="padding:8px 0;color:#64748b">Gross Squares (with waste)</td>
        <td style="padding:8px 0;text-align:right;font-weight:700;color:#334155">${grossSquares}</td>
      </tr>
      <tr style="border-bottom:1px solid #e2e8f0">
        <td style="padding:8px 0;color:#64748b">Price Per Square (client rate)</td>
        <td style="padding:8px 0;text-align:right;font-weight:700;color:#4338ca">$${pricePerBundle.toLocaleString()} CAD</td>
      </tr>
      <tr style="background:#f1f5f9">
        <td style="padding:10px 0;font-weight:800;color:#0f172a;font-size:12px">TOTAL ESTIMATED COST</td>
        <td style="padding:10px 0;text-align:right;font-weight:900;color:#d97706;font-size:14px">$${totalCost.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CAD</td>
      </tr>
    </table>
  </div>

  <!-- Disclaimer -->
  <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;font-size:9px;color:#92400e;line-height:1.6">
    <strong style="font-size:10px">ESTIMATE DISCLAIMER:</strong> This cost estimate is based on the client-provided rate of $${pricePerBundle}/square and AI-measured roof area with 15% waste factor. Actual costs may vary depending on: roof complexity, existing material removal, structural repairs, flashing details, code requirements, and regional pricing. This estimate does not include additional materials (underlayment, flashing, vents, etc.). A professional on-site assessment is recommended for a final quote.
  </div>
</div>`
}

// ============================================================
// SOLAR PROPOSAL PAGE — Renders user-edited (or suggested) panel layout
// over the satellite image, plus system size, annual production, savings.
// ============================================================
function buildSolarProposalPage(report: RoofReport, reportNum: string, reportDate: string, fullAddress: string): string {
  const layout = report.solar_panel_layout!
  const panels = (layout.user_panels && layout.user_panels.length ? layout.user_panels : layout.suggested_panels) || []
  const panelCount = panels.length
  const watts = layout.panel_capacity_watts || 400
  const systemKw = (panelCount * watts / 1000)
  const annualKwh = layout.yearly_energy_kwh || (panelCount * watts * 1.4)  // rough fallback
  const co2TonsPerYear = (annualKwh * 0.0004).toFixed(1)  // ~0.4 kg CO2/kWh grid avg

  // Project lat/lng → pixel on the satellite image overlay (SVG, viewBox=image_size_px)
  const cLat = layout.image_center?.lat
  const cLng = layout.image_center?.lng
  const zoom = layout.image_zoom || 20
  // Use logical pixel size (physical image_size_px is scale=2, so logical = physical/2)
  const sizePx = (layout.image_size_px || 1600) / 2
  const project = (lat: number, lng: number) => {
    const scale = Math.pow(2, zoom)
    const sin = Math.max(-0.9999, Math.min(0.9999, Math.sin(lat * Math.PI / 180)))
    const px = 256 * (0.5 + lng / 360)
    const py = 256 * (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI))
    const sin2 = Math.max(-0.9999, Math.min(0.9999, Math.sin(cLat * Math.PI / 180)))
    const cx = 256 * (0.5 + cLng / 360)
    const cy = 256 * (0.5 - Math.log((1 + sin2) / (1 - sin2)) / (4 * Math.PI))
    return { x: (px - cx) * scale + sizePx / 2, y: (py - cy) * scale + sizePx / 2 }
  }

  // Panel rectangle size in logical pixels (Web Mercator: meters/logical_px varies with lat)
  const metersPerPx = (156543.03392 * Math.cos((cLat || 0) * Math.PI / 180)) / Math.pow(2, zoom)
  const panelWpx = (layout.panel_width_meters || 1.045) / metersPerPx
  const panelHpx = (layout.panel_height_meters || 1.879) / metersPerPx

  const satUrl = report.imagery?.satellite_overhead_url || ''
  const panelRects = (cLat && cLng) ? panels.map((p: any) => {
    const xy = project(p.lat, p.lng)
    const isLandscape = (p.orientation || 'PORTRAIT') === 'LANDSCAPE'
    const w = isLandscape ? panelHpx : panelWpx
    const h = isLandscape ? panelWpx : panelHpx
    return `<rect x="${xy.x - w/2}" y="${xy.y - h/2}" width="${w}" height="${h}" fill="rgba(59,130,246,0.55)" stroke="rgba(255,255,255,0.95)" stroke-width="3"/>`
  }).join('') : ''

  const NAVY = '#1e3a5f'
  return `
<!-- ==================== SOLAR PROPOSAL PAGE ==================== -->
<div class="page">
  <div style="height:4px;background:linear-gradient(90deg,#f59e0b,#d97706)"></div>
  <div style="padding:12px 28px 8px">
    <div style="font-size:14px;font-weight:800;color:#222"><span style="color:#f59e0b">&#9728;</span> Solar Proposal</div>
    <div style="font-size:10px;color:#555">${fullAddress}</div>
  </div>

  <div style="padding:0 28px 10px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px;text-align:center">
      <div style="font-size:7px;font-weight:700;color:#92400e;text-transform:uppercase">Panels</div>
      <div style="font-size:20px;font-weight:900;color:#b45309">${panelCount}</div>
    </div>
    <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:10px;text-align:center">
      <div style="font-size:7px;font-weight:700;color:#92400e;text-transform:uppercase">System Size</div>
      <div style="font-size:20px;font-weight:900;color:#b45309">${systemKw.toFixed(2)} kW</div>
    </div>
    <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:6px;padding:10px;text-align:center">
      <div style="font-size:7px;font-weight:700;color:#065f46;text-transform:uppercase">Annual Production</div>
      <div style="font-size:20px;font-weight:900;color:#047857">${Math.round(annualKwh).toLocaleString()} kWh</div>
    </div>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:10px;text-align:center">
      <div style="font-size:7px;font-weight:700;color:#1e40af;text-transform:uppercase">CO&#8322; Offset</div>
      <div style="font-size:20px;font-weight:900;color:#1d4ed8">${co2TonsPerYear} t/yr</div>
    </div>
  </div>

  <div style="padding:0 28px 10px">
    <div style="font-size:11px;font-weight:800;color:${NAVY};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;border-bottom:2px solid #f59e0b;padding-bottom:3px">
      Panel Layout
    </div>
    <div style="position:relative;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;background:#000">
      ${satUrl ? `<img src="${satUrl}" style="display:block;width:100%;height:auto" />` : ''}
      <svg viewBox="0 0 ${sizePx} ${sizePx}" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none">
        ${panelRects}
      </svg>
    </div>
    <div style="font-size:8px;color:#64748b;margin-top:4px">
      ${layout.user_panels && layout.user_panels.length ? 'User-designed layout' : 'Google Solar API suggested layout'} &middot; Panel: ${watts}W &middot; Source: Google Solar API
    </div>
  </div>

  <div style="position:absolute;bottom:0;left:0;right:0;background:#1e3a5f;padding:6px 14px">
    <span style="color:#fef3c7;font-size:7.5px">roofmanager.ca &bull; Report: ${reportNum} &bull; ${reportDate} &bull; Solar Proposal</span>
  </div>
</div>`
}

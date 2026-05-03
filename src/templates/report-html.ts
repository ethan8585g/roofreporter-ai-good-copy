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
  generateSquaresGridDiagramSVG, generateTraceBasedDiagramSVG
} from './svg-diagrams'
import {
  generateAllStructureSVGs, splitStructures, allocateMaterialsToStructures,
  type StructurePartition,
} from './svg-3d-diagram'
import { estimateShingleAgeYears, regionalReplacementBandCad } from '../services/report-pro'
import {
  RoofMeasurementEngine, traceUiToEnginePayload, type TraceReport,
} from '../services/roof-measurement-engine'

// ============================================================
// Per-structure breakdown helper — derives footprint/true-area/
// perimeter for each traced building from roof_trace.eaves_sections.
// Returns [] for single-structure reports so callers can skip rendering.
// ============================================================
export interface StructureBreakdownRow {
  label: string
  footprint_sf: number
  true_area_sf: number
  perimeter_ft: number
  squares: number
}

export function computeStructuresBreakdown(report: RoofReport): StructureBreakdownRow[] {
  const rt: any = (report as any).roof_trace
  const out: StructureBreakdownRow[] = []
  if (!rt || !Array.isArray(rt.eaves_sections) || rt.eaves_sections.length < 1) return out
  const allSections: { lat: number; lng: number }[][] = rt.eaves_sections.filter((s: any) => Array.isArray(s) && s.length >= 3)
  if (allSections.length < 2) return out

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
    out.push({
      label: `Structure ${i + 1} — ${structureNames[i] || 'Additional Structure'}`,
      footprint_sf: Math.round(s.footprint),
      true_area_sf: Math.round(trueArea),
      perimeter_ft: Math.round(s.perim * 10) / 10,
      squares: Math.round(trueArea / 100 * 10) / 10,
    })
  })
  return out
}

// ============================================================
// PRO-TIER REPORT SECTIONS
// ============================================================

/** Renders the green/red diff banner shown only on report version >=2. */
function renderVersionDiffBanner(report: RoofReport): string {
  const versionNum = Number((report as any).current_version_num) || 1
  const diff = (report as any).diff_summary
  if (versionNum < 2 || !diff) return ''
  const positiveDelta = diff.area_delta_ft2 > 0
  const noChange = diff.area_delta_ft2 === 0 && diff.edges_added === 0 && diff.edges_removed === 0 && !diff.pitch_changed
  // High-contrast palette: green for upward revisions, red for downward, slate for "no change"
  const palette = noChange
    ? { bg: '#F1F5F9', border: '#94A3B8', fg: '#1F2937', icon: '&#8635;' }
    : positiveDelta
      ? { bg: '#DCFCE7', border: '#16A34A', fg: '#14532D', icon: '&#8593;' }
      : { bg: '#FEE2E2', border: '#DC2626', fg: '#7F1D1D', icon: '&#8595;' }
  return `
  <div style="margin:0 28px 6px;padding:8px 12px;background:${palette.bg};border:1px solid ${palette.border};border-radius:6px;display:flex;align-items:flex-start;gap:8px;font-size:8px;color:${palette.fg};line-height:1.4">
    <span style="font-size:12px;line-height:1;flex-shrink:0;font-weight:700">${palette.icon}</span>
    <div>
      <strong style="display:block;font-size:8.5px;text-transform:uppercase;letter-spacing:0.4px">Re-analysis &mdash; v${versionNum} (was v${diff.prior_version_num})</strong>
      <span>${diff.message}</span>
    </div>
  </div>`
}

/** Per-section confidence ratings (Pitch / Area / Edges). */
function renderConfidenceBreakdown(report: RoofReport): string {
  const cb = (report as any).confidence_breakdown
  if (!cb) return ''
  const tierColor = (t: string) => t === 'high' ? '#16A34A' : t === 'medium' ? '#D97706' : '#DC2626'
  const tierBg    = (t: string) => t === 'high' ? '#DCFCE7' : t === 'medium' ? '#FEF3C7' : '#FEE2E2'
  const row = (label: string, tier: string, basis: string) => `
    <tr style="border-bottom:1px solid #f1f5f9">
      <td style="padding:5px 8px;font-weight:700;font-size:8px;color:#333;width:18%">${label}</td>
      <td style="padding:5px 8px;width:18%">
        <span style="display:inline-block;padding:2px 8px;background:${tierBg(tier)};color:${tierColor(tier)};border:1px solid ${tierColor(tier)};border-radius:3px;font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px">${tier}</span>
      </td>
      <td style="padding:5px 8px;font-size:7.5px;color:#555">${basis}</td>
    </tr>`
  return `
  <div style="margin:6px 28px 4px;padding:0">
    <div style="font-size:9px;font-weight:800;color:#333;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px;border-bottom:1px solid #00897B;padding-bottom:2px">Confidence Source Breakdown</div>
    <table style="width:100%;border-collapse:collapse;background:#FAFAFA;border:1px solid #E5E7EB;border-radius:4px;overflow:hidden">
      <tbody>
        ${row('Pitch', cb.pitch, cb.pitch_basis)}
        ${row('Area',  cb.area,  cb.area_basis)}
        ${row('Edges', cb.edges, cb.edges_basis)}
      </tbody>
    </table>
  </div>`
}

/** Imagery date / shingle age / regional replacement-cost band. */
function renderInsuranceExtras(report: RoofReport): string {
  const imgDate = report.quality?.imagery_date || null
  const wr = (report as any).weather_risk
  const shingleAge = estimateShingleAgeYears(imgDate || undefined)
  const band = regionalReplacementBandCad(report)

  const sloped = Number(report.total_true_area_sqft || 0)
  const squares = sloped > 0 ? sloped / 100 : 0
  const costLow  = band ? Math.round(squares * band.low)  : null
  const costMid  = band ? Math.round(squares * band.mid)  : null
  const costHigh = band ? Math.round(squares * band.high) : null

  const tile = (label: string, value: string, sub?: string) => `
    <div style="flex:1;padding:8px 10px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;text-align:center">
      <div style="font-size:6.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#475569">${label}</div>
      <div style="font-size:11px;font-weight:900;color:#0F172A;margin-top:2px">${value}</div>
      ${sub ? `<div style="font-size:6.5px;color:#64748B;margin-top:1px">${sub}</div>` : ''}
    </div>`

  const tiles: string[] = []
  if (band && costMid != null) tiles.push(tile('Replacement (CAD)', `$${costMid.toLocaleString()}`, `range $${costLow!.toLocaleString()}–$${costHigh!.toLocaleString()}`))

  if (tiles.length === 0) return ''
  return `
  <div style="margin:8px 28px 0">
    <div style="font-size:9px;font-weight:800;color:#333;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;border-bottom:1px solid #00897B;padding-bottom:2px">Insurance Extras</div>
    <div style="display:flex;gap:6px">${tiles.join('')}</div>
  </div>`
}

/**
 * Renders an orange "Needs review" banner above the accuracy stamp when the
 * engine's reconciliation gate flagged a footprint mismatch >10 % between the
 * traced polygon and the external (Solar API) footprint. Returns empty string
 * when no flag is set.
 */
function renderNeedsReviewBanner(report: RoofReport): string {
  const flag = (report as any).review_flag || (report as any).needs_review_flag
  const needs = (report as any).needs_review === true || flag != null
  if (!needs) return ''
  const traced = flag?.traced_ft2 != null ? Math.round(flag.traced_ft2).toLocaleString() : '—'
  const external = flag?.external_ft2 != null ? Math.round(flag.external_ft2).toLocaleString() : '—'
  const delta = flag?.delta_pct != null ? `${flag.delta_pct.toFixed(1)}%` : '>10%'
  const source = flag?.external_source || 'Google Solar'
  const message = flag?.message || `Traced footprint differs from ${source} by ${delta}. Field-verify before ordering materials.`
  return `
  <div style="margin:0 28px 6px;padding:8px 12px;background:#FFF4E5;border:1px solid #F5A524;border-radius:6px;display:flex;align-items:flex-start;gap:8px;font-size:8px;color:#7A4A05;line-height:1.4">
    <span style="font-size:11px;line-height:1;flex-shrink:0">&#9888;</span>
    <div>
      <strong style="display:block;font-size:8.5px;color:#5C3704;text-transform:uppercase;letter-spacing:0.4px">Needs review</strong>
      <span>${message} (Traced: ${traced} ft&sup2; vs ${source}: ${external} ft&sup2;.)</span>
    </div>
  </div>`
}

// ============================================================
// MULTI-STRUCTURE: re-run the engine on each traced building so each
// structure gets its own complete 5-page report. The trace UI lets a
// super-admin click "+ Add another building" to record a second
// (or third…) eaves polygon — when present, we render the entire
// report once per structure instead of a single combined doc.
// ============================================================
function runEngineForPartition(
  partition: StructurePartition,
  origTrace: any,
  defaultPitchRise: number,
  orderInfo: { property_address?: string; homeowner_name?: string; order_number?: string },
): TraceReport | null {
  try {
    const perStructTrace = {
      eaves: partition.eaves,
      eaves_sections: [partition.eaves],
      ridges: partition.ridges,
      hips: partition.hips,
      valleys: partition.valleys,
      annotations: origTrace?.annotations || {},
      traced_at: origTrace?.traced_at || new Date().toISOString(),
    }
    const payload = traceUiToEnginePayload(perStructTrace as any, orderInfo, defaultPitchRise, undefined)
    return new RoofMeasurementEngine(payload).run()
  } catch (e) {
    console.warn('[multi-structure] engine re-run failed for partition:', e)
    return null
  }
}

function buildPerStructureSynthReport(
  report: RoofReport,
  partition: StructurePartition,
  engineResult: TraceReport,
  partitionIdx: number,
  partitionCount: number,
): RoofReport {
  const synth: any = { ...report }
  const km = engineResult.key_measurements
  const lm = engineResult.linear_measurements

  synth.total_footprint_sqft = Math.round(km.total_projected_footprint_ft2)
  synth.total_true_area_sqft = Math.round(km.total_roof_area_sloped_ft2)
  synth.total_footprint_sqm = Math.round(km.total_projected_footprint_ft2 * 0.0929 * 10) / 10
  synth.total_true_area_sqm = Math.round(km.total_roof_area_sloped_ft2 * 0.0929 * 10) / 10
  synth.area_multiplier = km.total_roof_area_sloped_ft2 / Math.max(km.total_projected_footprint_ft2, 1)
  synth.roof_pitch_degrees = Math.round(km.dominant_pitch_angle_deg * 10) / 10
  synth.roof_pitch_ratio = km.dominant_pitch_label

  synth.edge_summary = {
    total_eave_ft: Math.round(lm.eaves_total_ft),
    total_ridge_ft: Math.round(lm.ridges_total_ft),
    total_hip_ft: Math.round(lm.hips_total_ft),
    total_valley_ft: Math.round(lm.valleys_total_ft),
    total_rake_ft: Math.round(lm.rakes_total_ft),
    total_step_flashing_ft: 0,
    total_wall_flashing_ft: 0,
    total_transition_ft: 0,
    total_parapet_ft: 0,
    total_linear_ft: Math.round(lm.eaves_total_ft + lm.ridges_total_ft + lm.hips_total_ft + lm.valleys_total_ft + lm.rakes_total_ft),
    total_flashing_ft: 0,
  }

  const origRt: any = (report as any).roof_trace || {}
  synth.roof_trace = {
    ...origRt,
    eaves: partition.eaves,
    eaves_sections: [partition.eaves],
    ridges: partition.ridges,
    hips: partition.hips,
    valleys: partition.valleys,
    traced_at: origRt.traced_at || new Date().toISOString(),
  }

  const wastePct = (report.materials as any)?.waste_pct || 5
  const me = engineResult.materials_estimate
  synth.materials = {
    ...((report.materials as any) || {}),
    net_area_sqft: synth.total_true_area_sqft,
    gross_area_sqft: Math.round(synth.total_true_area_sqft * (1 + wastePct / 100)),
    gross_squares: Math.round((synth.total_true_area_sqft / 100) * (1 + wastePct / 100) * 10) / 10,
    bundle_count: me.shingles_bundles,
    waste_pct: wastePct,
  }

  synth.trace_measurement = engineResult

  synth.segments = engineResult.face_details.length > 0
    ? engineResult.face_details.map((face, i) => ({
        name: face.face_id || `Face ${i + 1}`,
        footprint_area_sqft: Math.round(face.projected_area_ft2),
        true_area_sqft: Math.round(face.sloped_area_ft2),
        true_area_sqm: Math.round(face.sloped_area_ft2 * 0.0929 * 10) / 10,
        pitch_degrees: Math.round(face.pitch_angle_deg * 10) / 10,
        pitch_ratio: face.pitch_label,
        azimuth_degrees: face.azimuth_deg != null ? Math.round(face.azimuth_deg * 10) / 10 : 0,
        azimuth_direction: '',
      }))
    : [{
        name: 'Total Roof (Traced)',
        footprint_area_sqft: synth.total_footprint_sqft,
        true_area_sqft: synth.total_true_area_sqft,
        true_area_sqm: synth.total_true_area_sqm,
        pitch_degrees: synth.roof_pitch_degrees,
        pitch_ratio: synth.roof_pitch_ratio,
        azimuth_degrees: 0,
        azimuth_direction: '',
      }]

  synth.edges = []
  for (const e of engineResult.eave_edge_breakdown) {
    synth.edges.push({
      edge_type: 'eave', label: `Eave ${e.edge_num}`,
      plan_length_ft: Math.round(e.length_2d_ft),
      true_length_ft: Math.round(e.length_2d_ft), pitch_factor: 1.0,
    })
  }
  for (const seg of engineResult.ridge_details) {
    synth.edges.push({
      edge_type: 'ridge', label: seg.id,
      plan_length_ft: Math.round(seg.horiz_length_ft),
      true_length_ft: Math.round(seg.sloped_length_ft), pitch_factor: seg.slope_factor,
    })
  }
  for (const seg of engineResult.hip_details) {
    synth.edges.push({
      edge_type: 'hip', label: seg.id,
      plan_length_ft: Math.round(seg.horiz_length_ft),
      true_length_ft: Math.round(seg.sloped_length_ft), pitch_factor: seg.slope_factor,
    })
  }
  for (const seg of engineResult.valley_details) {
    synth.edges.push({
      edge_type: 'valley', label: seg.id,
      plan_length_ft: Math.round(seg.horiz_length_ft),
      true_length_ft: Math.round(seg.sloped_length_ft), pitch_factor: seg.slope_factor,
    })
  }
  for (const seg of engineResult.rake_details) {
    synth.edges.push({
      edge_type: 'rake', label: seg.id,
      plan_length_ft: Math.round(seg.horiz_length_ft),
      true_length_ft: Math.round(seg.sloped_length_ft), pitch_factor: seg.slope_factor,
    })
  }

  ;(synth as any).__per_structure_render = true
  ;(synth as any).__structure_label = `Structure ${partitionIdx} of ${partitionCount} — ${partition.label}`
  return synth as RoofReport
}

function renderMultiStructureReport(report: RoofReport): string {
  const partitions = splitStructures(report)
  if (partitions.length < 2) {
    ;(report as any).__per_structure_render = true
    return generateProfessionalReportHTML(report)
  }
  const origTrace: any = (report as any).roof_trace || {}
  const defaultPitchRise = report.roof_pitch_degrees
    ? 12 * Math.tan(report.roof_pitch_degrees * Math.PI / 180)
    : 4.4
  const orderInfo = {
    property_address: (report.property as any)?.address || '',
    homeowner_name: (report.property as any)?.homeowner_name || '',
    order_number: String(report.order_id || ''),
  }

  const synthReports: RoofReport[] = []
  for (let i = 0; i < partitions.length; i++) {
    const engineResult = runEngineForPartition(partitions[i], origTrace, defaultPitchRise, orderInfo)
    if (!engineResult) {
      // Engine failure on any partition → fall back to combined
      ;(report as any).__per_structure_render = true
      return generateProfessionalReportHTML(report)
    }
    synthReports.push(buildPerStructureSynthReport(report, partitions[i], engineResult, i + 1, partitions.length))
  }

  // Render each per-structure report and stitch their <body> contents
  // together inside the first one's outer wrapper.
  const htmls = synthReports.map(r => generateProfessionalReportHTML(r))
  const bodyRe = /<body[^>]*>([\s\S]*?)<\/body>/i
  const bodies: string[] = []
  for (let i = 0; i < htmls.length; i++) {
    const m = htmls[i].match(bodyRe)
    const inner = m ? m[1] : htmls[i]
    const label = (synthReports[i] as any).__structure_label || `Structure ${i + 1}`
    bodies.push(`
<div class="page" style="${i > 0 ? 'page-break-before:always;' : ''}padding:0;min-height:auto">
  <div style="background:linear-gradient(90deg,#00897B,#00695C);color:#fff;padding:18px 28px;text-align:center">
    <div style="font-size:10px;font-weight:600;letter-spacing:2px;text-transform:uppercase;opacity:0.85">Multi-Structure Report &mdash; ${i + 1} of ${synthReports.length}</div>
    <div style="font-size:22px;font-weight:900;margin-top:4px;letter-spacing:0.5px">${label}</div>
  </div>
</div>
${inner}`)
  }
  return htmls[0].replace(bodyRe, `<body>${bodies.join('\n')}</body>`)
}

export function generateProfessionalReportHTML(report: RoofReport): string {
  // ── Multi-structure: render full report per traced building ──
  // (Skipped when called recursively; the flag is set on synth reports.)
  if (!(report as any).__per_structure_render) {
    const rt: any = (report as any).roof_trace
    const sections = Array.isArray(rt?.eaves_sections)
      ? rt.eaves_sections.filter((s: any) => Array.isArray(s) && s.length >= 3)
      : []
    if (sections.length >= 2) {
      try {
        return renderMultiStructureReport(report)
      } catch (e) {
        console.warn('[multi-structure] falling back to combined render:', e)
      }
    }
  }

  // ── Safe defaults ──
  const prop = report.property || { address: 'Unknown' } as any
  const mat = report.materials || { net_area_sqft: 0, gross_squares: 0, bundle_count: 0, line_items: [], waste_table: [], waste_pct: 5, gross_area_sqft: 0, total_material_cost_cad: 0, complexity_class: 'simple', complexity_factor: 1, shingle_type: 'architectural' } as any
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
  const netAreaSF = Math.round(report.total_true_area_sqft || report.total_footprint_sqft)
  const grossAreaSF = Math.round(netAreaSF * (1 + (mat.waste_pct || 5) / 100))
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

  // IWB (Ice & Water Barrier) — IRC R905.1.2 / NBC trigger:
  // low-slope (rise < 2:12) → full sloped-area coverage,
  // standard pitch → eave strip + 3ft each side of valleys.
  const tmIwb = (report as any).trace_measurement?.materials_estimate?.ice_water_shield_sqft
  const lowSlopeSqftPg1 = report.segments.reduce((sum, s) => {
    const r = 12 * Math.tan(((s.pitch_degrees || 0) * Math.PI) / 180)
    return r > 0 && r < 2.0 ? sum + (s.true_area_sqft || 0) : sum
  }, 0)
  const iwbSqFt = typeof tmIwb === 'number'
    ? Math.round(tmIwb * 10) / 10
    : Math.round((lowSlopeSqftPg1 + (es.total_eave_ft || 0) * 3 + (es.total_valley_ft || 0) * 3 * 2) * 10) / 10

  // Satellite image — prefer eagle-view if available, then enhanced satellite, then standard
  const eagleViewUrl = (report as any).eagle_view_image?.data_url
    || (report as any).report_showcase_images?.enhanced_satellite
    || ''
  const satelliteUrl = report.imagery?.satellite_url || ''
  const overheadUrl = eagleViewUrl || report.imagery?.satellite_overhead_url || satelliteUrl

  // ── Per-structure breakdown (house + detached garage/shed/etc.) ──
  // Computed from roof_trace GPS coordinates so each traced building gets its own measurement row.
  const structuresBreakdown = computeStructuresBreakdown(report)

  // ── Waste factor table (4% through 15%) — in square feet ──
  const wastePercentages = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
  const wasteTable = wastePercentages.map(pct => ({
    pct,
    sf: Math.round(netAreaSF * (1 + pct / 100)).toLocaleString()
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

  // ── 3D Axonometric per-structure diagrams (Phase 1) ──
  // For multi-structure reports, render each traced building as its own
  // 3D-look diagram so house and garage no longer get merged into one.
  // Single-structure reports also benefit (3D look replaces the flat view
  // when no AI geometry is available).
  const structureDiagrams = generateAllStructureSVGs(report)
  const perStructureMaterials = structureDiagrams.length > 0
    ? allocateMaterialsToStructures(report, structureDiagrams.map(s => s.partition))
    : []

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
  // (RED/AMBER removed — all pages now use TEAL theme)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=900">
<title>Roof Manager Roof Report | ${fullAddress}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:#fff;color:#1a1a2e;font-size:9.5pt;line-height:1.4;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:8.5in;min-height:11in;margin:0 auto;background:#fff;position:relative;overflow:hidden;page-break-after:always}
.page:last-child{page-break-after:auto}
@media print{.page{page-break-after:always;min-height:auto;box-shadow:none;margin:0}body{background:#fff}@page{margin:0.3in}a[href]:after{content:none !important}}
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
        <div style="font-size:16px;font-weight:900;color:${TEAL};letter-spacing:0.5px;line-height:1">ROOF MANAGER</div>
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
        <span class="pt-label">Gross Area<span class="pt-sub">(w/${mat.waste_pct || 5}% waste)</span></span>
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
          <div style="font-size:16px;font-weight:900;color:${TEAL_DARK}">${Math.max(1, structureDiagrams.length)}</div>
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

  <!-- Two tables side by side: Length Summary + Area by Roof Plane (moved from page 2) -->
  <div style="display:flex;gap:12px;padding:6px 28px 0;margin-bottom:4px">
    <!-- LEFT TABLE: Length Summary -->
    <div style="flex:1">
      <div style="font-size:9px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Length Summary</div>
      <table style="width:100%;border-collapse:collapse;font-size:8px">
        <thead>
          <tr style="background:${TEAL_DARK};color:#fff">
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
          <tr style="background:${TEAL_LIGHT};font-weight:800">
            <td style="padding:4px 6px;border-top:2px solid ${TEAL_DARK};font-size:8px">Total Linear</td>
            <td style="padding:4px 6px;border-top:2px solid ${TEAL_DARK};text-align:center">${report.edges.length}</td>
            <td style="padding:4px 6px;border-top:2px solid ${TEAL_DARK};text-align:right">${Math.round(totalLinearFt * 10) / 10} LF</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- RIGHT TABLE: Area by Roof Plane -->
    <div style="flex:1">
      <div style="font-size:9px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Area by Roof Plane</div>
      <table style="width:100%;border-collapse:collapse;font-size:8px">
        <thead>
          <tr style="background:${TEAL_DARK};color:#fff">
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
          <tr style="background:${TEAL_LIGHT};font-weight:800">
            <td style="padding:4px 5px;border-top:2px solid ${TEAL_DARK};font-size:8px">Total</td>
            <td style="padding:4px 5px;border-top:2px solid ${TEAL_DARK};text-align:right;font-size:8px">${report.total_true_area_sqft.toLocaleString()} SF</td>
            <td style="padding:4px 5px;border-top:2px solid ${TEAL_DARK};text-align:center;font-size:8px">${predominantPitch}</td>
            <td style="padding:4px 5px;border-top:2px solid ${TEAL_DARK};text-align:right;font-size:8px">100%</td>
          </tr>
        </tbody>
      </table>

      <!-- Area by Pitch Breakdown -->
      <div style="margin-top:6px;font-size:8px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:3px">Area by Pitch</div>
      <table style="width:100%;border-collapse:collapse;font-size:7.5px">
        <thead>
          <tr style="background:${TEAL_LIGHT};border-bottom:1.5px solid ${TEAL}">
            <th style="padding:3px 6px;text-align:left;font-weight:700;color:${TEAL_DARK}">Pitch Range</th>
            <th style="padding:3px 6px;text-align:right;font-weight:700;color:${TEAL_DARK}">Roof Area (SF)</th>
            <th style="padding:3px 6px;text-align:right;font-weight:700;color:${TEAL_DARK}">% of Total</th>
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

  ${(() => {
    const rt = (report as any).roof_trace
    const ventCt = rt?.annotations?.vents?.length || 0
    const skylightCt = rt?.annotations?.skylights?.length || 0
    const chimneyCt = rt?.annotations?.chimneys?.length || 0
    if (ventCt === 0 && skylightCt === 0 && chimneyCt === 0) return ''
    return `<div style="padding:2px 28px 0">
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:7px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.5px">Roof Penetrations:</span>
        ${ventCt > 0 ? `<span style="padding:2px 7px;background:${TEAL_LIGHT};color:${TEAL_DARK};border:1px solid ${TEAL};border-radius:3px;font-size:7px;font-weight:700">&#9679; Vents: ${ventCt}</span>` : ''}
        ${skylightCt > 0 ? `<span style="padding:2px 7px;background:${TEAL_LIGHT};color:${TEAL_DARK};border:1px solid ${TEAL};border-radius:3px;font-size:7px;font-weight:700">&#9830; Skylights: ${skylightCt}</span>` : ''}
        ${chimneyCt > 0 ? `<span style="padding:2px 7px;background:${TEAL_LIGHT};color:${TEAL_DARK};border:1px solid #b2dfdb;border-radius:3px;font-size:7px;font-weight:700">&#9632; Chimneys: ${chimneyCt}</span>` : ''}
      </div>
    </div>`
  })()}

  <!-- Pro-tier: version diff banner (only on v >= 2) -->
  ${renderVersionDiffBanner(report)}

  <!-- Pro-tier: per-section confidence breakdown (renders below the global score) -->
  ${renderConfidenceBreakdown(report)}

  <!-- Pro-tier: imagery date / shingle age / regional replacement-cost band / weather risk -->
  ${renderInsuranceExtras(report)}

  <!-- Needs-review banner: rendered when reconciliation gate flagged a footprint mismatch >10% -->
  ${renderNeedsReviewBanner(report)}

  <!-- Accuracy + Disclaimer -->
  <div style="padding:4px 28px 36px;font-size:7px;color:#666;line-height:1.5;text-align:center">
    <strong style="color:#333">Accuracy:</strong> &plusmn;2% area, &plusmn;1% linear &mdash; industry-standard tolerance per EagleView/RoofSnap convention.
    Report is an engineering-grade estimate based on user-traced GPS or AI vision; physical verification recommended for code-critical work.
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
  <!-- Top teal bar -->
  <div style="height:4px;background:linear-gradient(90deg,${TEAL},${TEAL_DARK})"></div>

  <!-- Title -->
  <div style="padding:10px 28px 6px">
    <div style="font-size:14px;font-weight:800;color:#222">Roof Area Analysis${structuresBreakdown.length >= 2 ? ` — All Structures (${structuresBreakdown.length})` : ''}</div>
  </div>

  <!-- Main diagram area -->
  ${structureDiagrams.length >= 2 ? `
  <div style="padding:0 28px;margin-bottom:8px">
    ${structureDiagrams.map(({ partition, svg }) => {
      const matRow = perStructureMaterials.find(m => m.index === partition.index)
      // 2D top-down drawing for this structure only — same renderer as the
      // legacy diagram, fed only this structure's eaves + traced lines so
      // the per-edge dimension callouts are visible.
      const flat2dSvg = generateTraceBasedDiagramSVG(
        {
          eaves: partition.eaves,
          eaves_sections: [partition.eaves],
          ridges: partition.ridges,
          hips: partition.hips,
          valleys: partition.valleys,
        },
        {
          total_ridge_ft: partition.ridge_lf,
          total_hip_ft: partition.hip_lf,
          total_valley_ft: partition.valley_lf,
          total_eave_ft: partition.eave_lf,
          total_rake_ft: partition.rake_lf,
        },
        partition.footprint_sqft,
        partition.dominant_pitch_deg,
        partition.dominant_pitch_label,
        Math.round(partition.true_area_sqft / 100 * (1 + (mat.waste_pct || 5) / 100) * 10) / 10,
        partition.true_area_sqft,
      )
      return `
      <div style="border:1.5px solid #cbd5e1;border-radius:6px;background:#fff;overflow:hidden;margin-bottom:10px">
        <div style="background:linear-gradient(90deg,${TEAL},${TEAL_DARK});color:#fff;padding:6px 12px;display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:11px;font-weight:800;letter-spacing:0.5px">Structure ${partition.index} &mdash; ${partition.label}</div>
          <div style="font-size:9px;font-weight:600;opacity:0.95">${partition.true_area_sqft.toLocaleString()} sqft @ ${partition.dominant_pitch_label} &bull; ${partition.perimeter_ft.toLocaleString()} LF perimeter</div>
        </div>
        <div style="padding:8px 12px;font-size:8.5px">
          <div style="font-size:8px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Measurements</div>
          <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:2px 14px">
            <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Footprint</span><span style="font-weight:700">${partition.footprint_sqft.toLocaleString()} SF</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Roof Area</span><span style="font-weight:800;color:${TEAL_DARK}">${partition.true_area_sqft.toLocaleString()} SF</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Gross w/${(mat.waste_pct || 5)}%</span><span style="font-weight:700">${Math.round(partition.true_area_sqft * (1 + (mat.waste_pct || 5) / 100)).toLocaleString()} SF</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Pitch</span><span style="font-weight:700">${partition.dominant_pitch_label}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Perimeter</span><span style="font-weight:700">${partition.perimeter_ft.toLocaleString()} LF</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#16A34A">Eave</span><span style="font-weight:700">${partition.eave_lf.toLocaleString()} LF</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#DC2626">Ridge</span><span style="font-weight:700">${partition.ridge_lf.toLocaleString()} LF</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#EA580C">Hip</span><span style="font-weight:700">${partition.hip_lf.toLocaleString()} LF</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#2563EB">Valley</span><span style="font-weight:700">${partition.valley_lf.toLocaleString()} LF</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#7C3AED">Rake</span><span style="font-weight:700">${partition.rake_lf.toLocaleString()} LF</span></div>
          </div>
          ${matRow ? `
          <div style="font-size:8px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.5px;margin:8px 0 4px">Materials (allocated)</div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:2px 14px">
            <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Roof Area</span><span style="font-weight:700">${Math.round(matRow.squares * 100).toLocaleString()} SF</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Bundles</span><span style="font-weight:800;color:${TEAL_DARK}">${matRow.bundles}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Underlay</span><span style="font-weight:700">${matRow.underlayment_rolls} rolls</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#64748b">I&amp;W</span><span style="font-weight:700">${matRow.ice_water_sqft.toLocaleString()} SF</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Ridge Cap</span><span style="font-weight:700">${matRow.ridge_cap_lf} LF</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Drip Edge</span><span style="font-weight:700">${matRow.drip_edge_lf} LF</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Valley</span><span style="font-weight:700">${matRow.valley_flashing_lf} LF</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Nails</span><span style="font-weight:700">${matRow.nails_lbs} lbs</span></div>
          </div>
          ` : ''}
        </div>
        <div style="border-top:1px solid #e2e8f0;padding:6px 12px 0;background:#fafbfc">
          <div style="font-size:8px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">2D Plan View &mdash; Edge Dimensions</div>
          <div style="background:#fff;border:1px solid #e2e8f0;border-radius:3px;overflow:hidden">${flat2dSvg}</div>
        </div>
      </div>
    `}).join('')}
    <div style="text-align:center;font-size:6.5px;color:#999;margin-top:2px">2D Plan View shows every traced edge with its haversine length. Each traced building rendered separately.</div>
  </div>` : `
  <div style="padding:0 28px;margin-bottom:8px">
    ${structureDiagrams.length === 1 ? (() => {
      const p = structureDiagrams[0].partition
      const flat = generateTraceBasedDiagramSVG(
        { eaves: p.eaves, eaves_sections: [p.eaves], ridges: p.ridges, hips: p.hips, valleys: p.valleys },
        { total_ridge_ft: p.ridge_lf, total_hip_ft: p.hip_lf, total_valley_ft: p.valley_lf, total_eave_ft: p.eave_lf, total_rake_ft: p.rake_lf },
        p.footprint_sqft, p.dominant_pitch_deg, p.dominant_pitch_label,
        Math.round(p.true_area_sqft / 100 * (1 + (mat.waste_pct || 5) / 100) * 10) / 10,
        p.true_area_sqft,
      )
      return `
      <div style="border:1px solid #d5dae3;border-radius:4px;background:#fff;text-align:center">${flat}</div>
      <div style="text-align:center;font-size:6.5px;color:#999;margin-top:2px">2D top-down plan with haversine edge lengths. All dimensions in feet.</div>
    `})() : `
      <div style="border:1px solid #d5dae3;border-radius:4px;background:#fff;text-align:center">${architecturalDiagramSVG}</div>
      <div style="text-align:center;font-size:6.5px;color:#999;margin:2px 0 8px">AI-Generated Roof Diagram &mdash; All dimensions in feet. Pitch multiplier applied for true sloped area.</div>
    `}
  </div>`}

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

  <!-- Per-Structure Measurement Breakdown (house + detached garage, etc.) -->
  ${structuresBreakdown.length >= 2 && structureDiagrams.length < 2 ? `
  <div style="padding:6px 28px 0">
    <div style="font-size:10px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;border-bottom:1.5px solid ${TEAL};padding-bottom:3px">Per-Structure Breakdown — ${structuresBreakdown.length} Buildings</div>
    <table style="width:100%;border-collapse:collapse;font-size:8px">
      <thead>
        <tr style="background:#1a1a2e;color:#fff">
          <th style="padding:4px 8px;text-align:left;font-size:7.5px;font-weight:700">Structure</th>
          <th style="padding:4px 8px;text-align:right;font-size:7.5px;font-weight:700">Footprint (SF)</th>
          <th style="padding:4px 8px;text-align:right;font-size:7.5px;font-weight:700">Roof Area (SF)</th>
          <th style="padding:4px 8px;text-align:right;font-size:7.5px;font-weight:700">Gross (SF)</th>
          <th style="padding:4px 8px;text-align:right;font-size:7.5px;font-weight:700">Perimeter (LF)</th>
        </tr>
      </thead>
      <tbody>
        ${structuresBreakdown.map((s, i) => `<tr style="${i % 2 === 0 ? 'background:#fafafa' : ''}">
          <td style="padding:4px 8px;border-bottom:1px solid #eee;font-weight:700">${s.label}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${s.footprint_sf.toLocaleString()}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:700;color:${TEAL_DARK}">${s.true_area_sf.toLocaleString()}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${Math.round(s.squares * 100).toLocaleString()}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${s.perimeter_ft.toLocaleString()}</td>
        </tr>`).join('')}
        <tr style="background:#eee;font-weight:800">
          <td style="padding:5px 8px;border-top:2px solid #333">Combined Total</td>
          <td style="padding:5px 8px;border-top:2px solid #333;text-align:right">${structuresBreakdown.reduce((s, x) => s + x.footprint_sf, 0).toLocaleString()}</td>
          <td style="padding:5px 8px;border-top:2px solid #333;text-align:right;color:${TEAL_DARK}">${structuresBreakdown.reduce((s, x) => s + x.true_area_sf, 0).toLocaleString()}</td>
          <td style="padding:5px 8px;border-top:2px solid #333;text-align:right">${Math.round(structuresBreakdown.reduce((s, x) => s + x.squares * 100, 0)).toLocaleString()}</td>
          <td style="padding:5px 8px;border-top:2px solid #333;text-align:right">${Math.round(structuresBreakdown.reduce((s, x) => s + x.perimeter_ft, 0) * 10) / 10}</td>
        </tr>
      </tbody>
    </table>
    <div style="font-size:6.5px;color:#888;margin-top:3px;font-style:italic">Per-structure areas derived from individual traced eave polygons; dominant pitch multiplier applied for sloped area.</div>
  </div>
  <!-- Per-Structure Materials Allocation -->
  ${perStructureMaterials.length >= 2 ? `
  <div style="padding:6px 28px 0">
    <div style="font-size:10px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;border-bottom:1.5px solid ${TEAL};padding-bottom:3px">Per-Structure Materials</div>
    <table style="width:100%;border-collapse:collapse;font-size:8px">
      <thead>
        <tr style="background:#1a1a2e;color:#fff">
          <th style="padding:4px 8px;text-align:left;font-size:7.5px;font-weight:700">Structure</th>
          <th style="padding:4px 8px;text-align:right;font-size:7.5px;font-weight:700">Roof Area (SF)</th>
          <th style="padding:4px 8px;text-align:right;font-size:7.5px;font-weight:700">Bundles</th>
          <th style="padding:4px 8px;text-align:right;font-size:7.5px;font-weight:700">Underlay</th>
          <th style="padding:4px 8px;text-align:right;font-size:7.5px;font-weight:700">I&amp;W (SF)</th>
          <th style="padding:4px 8px;text-align:right;font-size:7.5px;font-weight:700">Ridge Cap (LF)</th>
          <th style="padding:4px 8px;text-align:right;font-size:7.5px;font-weight:700">Drip Edge (LF)</th>
          <th style="padding:4px 8px;text-align:right;font-size:7.5px;font-weight:700">Nails (lbs)</th>
        </tr>
      </thead>
      <tbody>
        ${perStructureMaterials.map((m, i) => `<tr style="${i % 2 === 0 ? 'background:#fafafa' : ''}">
          <td style="padding:4px 8px;border-bottom:1px solid #eee;font-weight:700">Structure ${m.index} &mdash; ${m.label}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${Math.round(m.squares * 100).toLocaleString()}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;font-weight:700;color:${TEAL_DARK}">${m.bundles}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${m.underlayment_rolls}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${m.ice_water_sqft.toLocaleString()}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${m.ridge_cap_lf}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${m.drip_edge_lf}</td>
          <td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right">${m.nails_lbs}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    <div style="font-size:6.5px;color:#888;margin-top:3px;font-style:italic">Materials allocated by roof-area share. Combined total appears on the Material Take-Off page.</div>
  </div>` : ''}` : ''}

  <!-- Methodology note -->
  <div style="padding:6px 28px 0">
    <div style="padding:4px 8px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:3px;font-size:6.5px;color:#0369a1;line-height:1.4">
      <strong>Methodology:</strong> Measurements from ${(report as any).roof_trace ? 'user-traced GPS coordinates (UTM projection, Shoelace formula)' : 'AI vision analysis of satellite imagery'}. Pitch multiplier &radic;(rise&sup2;+12&sup2;)/12 applied for true 3D surface area. Pitch source: ${(report as any).roof_trace ? 'per-segment GPS where computed; otherwise dominant pitch from Solar API roofSegmentStats' : 'AI vision (Gemini)'}. Engine v6.0 &mdash; Industry-standard multipliers per GAF/CertainTeed/IKO/EagleView.
    </div>
  </div>

  <!-- Footer bar -->
  <div style="position:absolute;bottom:0;left:0;right:0;height:28px;background:linear-gradient(90deg,${TEAL},${TEAL_DARK});display:flex;align-items:center;justify-content:space-between;padding:0 28px">
    <span style="color:#fff;font-size:9px;font-weight:700">Roof Manager</span>
    <span style="color:#E0F2F1;font-size:7.5px">roofmanager.ca &bull; Report: ${reportNum} &bull; ${reportDate} &bull; p.2</span>
  </div>
</div>



<!-- Pitch Analysis data consolidated into Page 2 Area by Pitch table -->

${report.customer_price_per_bundle ? buildCustomerPricingHTML(report) : ''}

${buildMaterialTakeoffPage(report, reportNum, reportDate, fullAddress)}

${buildEdgeBreakdownPage(report, reportNum, reportDate, fullAddress)}

${buildMeasurementSummaryPage(report, reportNum, reportDate, fullAddress)}

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
  const mat = report.materials || { net_area_sqft: 0, gross_squares: 0, bundle_count: 0, line_items: [], waste_table: [], waste_pct: 5, gross_area_sqft: 0, total_material_cost_cad: 0, complexity_class: 'simple', complexity_factor: 1, shingle_type: 'architectural' } as any
  const es = report.edge_summary || { total_ridge_ft: 0, total_hip_ft: 0, total_valley_ft: 0, total_eave_ft: 0, total_rake_ft: 0, total_linear_ft: 0 } as any

  // Safe defaults
  if (!report.total_true_area_sqft) report.total_true_area_sqft = report.total_footprint_sqft || 1
  if (!report.total_footprint_sqft) report.total_footprint_sqft = report.total_true_area_sqft || 1
  if (!report.area_multiplier) report.area_multiplier = report.total_true_area_sqft / (report.total_footprint_sqft || 1)
  if (!report.generated_at) report.generated_at = new Date().toISOString()
  if (!report.segments) report.segments = []
  if (!report.edges) report.edges = []

  // Structure count derived from the same partitioner page 2 uses.
  const structureCountSimple = Math.max(1, splitStructures(report).length)

  const fullAddress = [prop.address, prop.city, prop.province, prop.postal_code].filter(Boolean).join(', ')
  const reportDate = new Date(report.generated_at).toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' })
  const netAreaSF = Math.round(report.total_true_area_sqft || report.total_footprint_sqft)
  const grossAreaSF = Math.round(netAreaSF * (1 + (mat.waste_pct || 5) / 100))

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
<meta name="viewport" content="width=900">
<title>Roof Measurement Report | ${fullAddress}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:#fff;color:#1a1a2e;font-size:9pt;line-height:1.35;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@media print{.page{page-break-after:always;min-height:auto;box-shadow:none;margin:0}body{background:#fff}@page{margin:0.3in}a[href]:after{content:none !important}}
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
            <td style="padding:4px 6px;font-weight:800;font-size:8px;color:#001a44">Total (w/${mat.waste_pct || 5}% waste)</td>
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
      <span style="font-size:9px;font-weight:800;color:#00838F">ROOF MANAGER</span>
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
        <div style="display:flex;justify-content:space-between;padding:4px 10px;font-size:8px"><span style="color:#555">Structures</span><span style="font-weight:700">${structureCountSimple}</span></div>
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
          <td style="padding:4px 6px;border:1px solid #ddd;text-align:center;${w.pct === (mat.waste_pct || 5) ? 'background:#e0f7fa;font-weight:800' : ''}">
            <div style="font-weight:700;color:#555">${w.pct}%</div>
            <div style="font-weight:600;color:#1a1a1a;margin-top:1px">${w.sf.toLocaleString()} SF</div>
          </td>`).join('')}
        </tr>
        <tr>
          ${wasteTableEntries.slice(6).map(w => `
          <td style="padding:4px 6px;border:1px solid #ddd;text-align:center;${w.pct === (mat.waste_pct || 5) ? 'background:#e0f7fa;font-weight:800' : ''}">
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
      THIS REPORT IS THE PROPERTY OF ROOF MANAGER AND MAY NOT BE REPRODUCED WITHOUT WRITTEN CONSENT.
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
  const wastePct = mat.waste_pct || 5
  const grossArea = Math.round(netArea * (1 + wastePct / 100))
  const structuresBreakdown = computeStructuresBreakdown(report)

  // Fallback IWB calc (IRC R905.1.2 / NBC) when no trace materials.
  // Low-slope segments (pitch < 2:12) get full sloped-area coverage; the
  // rest get an eave strip (~3 ft) plus 3 ft on each side of valleys.
  const fbLowSlopeSqft = (report.segments || []).reduce((sum: number, s: any) => {
    const rise = 12 * Math.tan(((s?.pitch_degrees || 0) * Math.PI) / 180)
    return rise > 0 && rise < 2.0 ? sum + (s?.true_area_sqft || 0) : sum
  }, 0)
  const fbEaveStripSqft = (report.edge_summary?.total_eave_ft || 0) * 3
  const fbValleySqft = (report.edge_summary?.total_valley_ft || 0) * 3 * 2
  const fbIwbTotalSqft = Math.round(fbLowSlopeSqft + fbEaveStripSqft + fbValleySqft)

  // Use trace materials if available, otherwise calculate from report.materials
  const m = traceMat || {
    shingles_squares_net: Math.round(netArea / 100 * 10) / 10,
    shingles_squares_gross: Math.round(grossArea / 100 * 10) / 10,
    shingles_bundles: Math.ceil(grossArea / 100 * 3),
    underlayment_rolls: Math.ceil(netArea / 400),
    ice_water_shield_sqft: fbIwbTotalSqft,
    ice_water_shield_rolls_2sq: Math.ceil(fbIwbTotalSqft / 200),
    ice_water_breakdown: {
      low_slope_full_coverage_sqft: Math.round(fbLowSlopeSqft),
      low_slope_face_count: (report.segments || []).filter((s: any) => {
        const rise = 12 * Math.tan(((s?.pitch_degrees || 0) * Math.PI) / 180)
        return rise > 0 && rise < 2.0
      }).length,
      eave_strip_sqft: Math.round(fbEaveStripSqft),
      eave_strip_depth_ft: 3,
      valley_sqft: Math.round(fbValleySqft),
      total_sqft: fbIwbTotalSqft,
      total_rolls_2sq: Math.ceil(fbIwbTotalSqft / 200),
      trigger_notes: [],
    },
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

  const iwb = (m as any).ice_water_breakdown
  const iwbRows: any[] = []
  if (iwb && iwb.low_slope_full_coverage_sqft > 0) {
    const fullRolls = Math.ceil(iwb.low_slope_full_coverage_sqft / 200)
    iwbRows.push({
      cat: 'Ice &amp; Water — Full Coverage',
      desc: `Low-slope segments (pitch &lt; 2:12) — IRC R905.1.2`,
      qty: fullRolls,
      unit: 'rolls (2 sq)',
      note: `${Math.round(iwb.low_slope_full_coverage_sqft).toLocaleString()} SF across ${iwb.low_slope_face_count} face(s)`,
      icon: '&#10052;',
      color: '#1d4ed8',
      code: 'RFG IWS',
    })
    const eaveValleySqft = (iwb.eave_strip_sqft || 0) + (iwb.valley_sqft || 0)
    if (eaveValleySqft > 0) {
      iwbRows.push({
        cat: 'Ice &amp; Water — Eave &amp; Valley',
        desc: `Eave + 24&quot; past heated wall, plus 3 ft each side of valleys`,
        qty: Math.ceil(eaveValleySqft / 200),
        unit: 'rolls (2 sq)',
        note: `${Math.round(eaveValleySqft).toLocaleString()} SF (eave ${Math.round(iwb.eave_strip_sqft || 0)} + valley ${Math.round(iwb.valley_sqft || 0)})`,
        icon: '&#10052;',
        color: '#2563eb',
        code: 'RFG IWS',
      })
    }
  } else {
    const stripDepth = iwb?.eave_strip_depth_ft || 3
    iwbRows.push({
      cat: 'Ice &amp; Water Shield',
      desc: `Self-adhering membrane (eave + 24&quot; past wall, plus 3 ft each side of valleys)`,
      qty: m.ice_water_shield_rolls_2sq,
      unit: 'rolls (2 sq)',
      note: `${m.ice_water_shield_sqft.toLocaleString()} SF total IWB area (strip ${stripDepth} ft)`,
      icon: '&#10052;',
      color: '#2563eb',
      code: 'RFG IWS',
    })
  }

  const items = [
    { cat: 'Field Shingles', desc: shingleName + ' shingles', qty: m.shingles_bundles, unit: 'bundles', note: `${m.shingles_squares_gross} sq gross (${m.shingles_squares_net} net + ${wastePct}% waste)${shingleSpec ? ' | ' + shingleSpec : ''}`, icon: '&#9632;', color: '#0891b2', code: 'RFG ARCH' },
    { cat: 'Underlayment', desc: 'Synthetic roof underlayment (15 sq/roll)', qty: m.underlayment_rolls, unit: 'rolls', note: `Covers ${netArea.toLocaleString()} SF net roof area`, icon: '&#9632;', color: '#6366f1', code: 'RFG SYNUL' },
    ...iwbRows,
    { cat: 'Ridge Cap', desc: 'Hip &amp; ridge cap shingles', qty: m.ridge_cap_bundles, unit: 'bundles', note: `${m.ridge_cap_lf} LF total ridge + hip`, icon: '&#9650;', color: '#dc2626', code: 'RFG RIDGC' },
    { cat: 'Starter Strip', desc: 'Starter shingles (eave + rake perimeter)', qty: Math.ceil(m.starter_strip_lf / 100), unit: 'rolls', note: `${m.starter_strip_lf} LF perimeter`, icon: '&#9644;', color: '#16a34a', code: 'RFG STARTU' },
    { cat: 'Drip Edge — Eave', desc: 'Metal drip edge, eave profile (10.5ft sticks)', qty: Math.ceil(m.drip_edge_eave_lf / 10.5), unit: 'sticks', note: `${m.drip_edge_eave_lf} LF`, icon: '&#9472;', color: '#16a34a', code: 'RFG GUTAS' },
    { cat: 'Drip Edge — Rake', desc: 'Metal drip edge, rake profile (10.5ft sticks)', qty: Math.ceil(m.drip_edge_rake_lf / 10.5), unit: 'sticks', note: `${m.drip_edge_rake_lf} LF`, icon: '&#9472;', color: '#7c3aed', code: 'RFG GUTRS' },
    { cat: 'Valley Flashing', desc: 'Pre-bent W-valley metal or roll valley', qty: Math.ceil(m.valley_flashing_lf / 10), unit: 'pcs', note: `${m.valley_flashing_lf} LF total valley`, icon: '&#9660;', color: '#2563eb', code: 'RFG VALLEYM' },
    { cat: 'Roofing Nails', desc: '1.25″ galvanized coil nails', qty: m.roofing_nails_lbs, unit: 'lbs', note: 'Approx 2.5 lbs per square', icon: '&#9733;', color: '#64748b', code: 'RFG NAIL' },
    { cat: 'Caulk / Sealant', desc: 'Roofing sealant tubes', qty: m.caulk_tubes, unit: 'tubes', note: 'Flashings, vents, and penetrations', icon: '&#9679;', color: '#0891b2', code: 'RFG CLK' }
  ]

  return `
<!-- ==================== MATERIAL TAKE-OFF PAGE ==================== -->
<div class="page">
  <div style="height:4px;background:linear-gradient(90deg,${TEAL},#26a69a)"></div>
  <div style="padding:12px 28px 8px">
    <div style="font-size:14px;font-weight:800;color:#222">Complete Material Take-Off</div>
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
          <th style="padding:5px 8px;text-align:left;font-size:7.5px;font-weight:700;width:24%">Material</th>
          <th style="padding:5px 8px;text-align:left;font-size:7.5px;font-weight:700;width:24%">Description</th>
          <th style="padding:5px 8px;text-align:center;font-size:7.5px;font-weight:700;width:9%">Quantity</th>
          <th style="padding:5px 8px;text-align:center;font-size:7.5px;font-weight:700;width:7%">Unit</th>
          <th style="padding:5px 8px;text-align:center;font-size:7.5px;font-weight:700;width:12%">Xactimate</th>
          <th style="padding:5px 8px;text-align:left;font-size:7.5px;font-weight:700;width:24%">Notes</th>
        </tr>
      </thead>
      <tbody>
        ${items.map((item: any, i: number) => `
        <tr style="${i % 2 === 0 ? '' : 'background:#f8fafc'};border-bottom:1px solid #eee">
          <td style="padding:5px 8px;font-weight:700"><span style="color:${item.color};margin-right:3px">${item.icon}</span>${item.cat}</td>
          <td style="padding:5px 8px;color:#555">${item.desc}</td>
          <td style="padding:5px 8px;text-align:center;font-weight:800;font-size:10px;color:${item.color}">${item.qty}</td>
          <td style="padding:5px 8px;text-align:center;font-size:7.5px;color:#777">${item.unit}</td>
          <td style="padding:5px 8px;text-align:center;font-size:7.5px;font-weight:700;color:#1a1a2e;font-family:'SF Mono',Menlo,monospace">${item.code || ''}</td>
          <td style="padding:5px 8px;font-size:7.5px;color:#666">${item.note}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <!-- Waste factor table on Page 1 — not duplicated here -->

  ${structuresBreakdown.length >= 2 ? (() => {
    const totalSloped = structuresBreakdown.reduce((s, x) => s + x.true_area_sf, 0) || 1
    const allocate = (qty: number, share: number) => Math.ceil(qty * share)
    const rows = structuresBreakdown.map(st => {
      const share = st.true_area_sf / totalSloped
      const stEave = Math.round((report.edge_summary?.total_eave_ft || 0) * share * 10) / 10
      const stRake = Math.round((report.edge_summary?.total_rake_ft || 0) * share * 10) / 10
      const stRidgeHip = Math.round(((report.edge_summary?.total_ridge_ft || 0) + (report.edge_summary?.total_hip_ft || 0)) * share * 10) / 10
      const stValley = Math.round((report.edge_summary?.total_valley_ft || 0) * share * 10) / 10
      return {
        label: st.label,
        sloped_sf: st.true_area_sf,
        squares: st.squares,
        bundles: allocate(m.shingles_bundles, share),
        underlayment: allocate(m.underlayment_rolls, share),
        iwb_rolls: allocate(m.ice_water_shield_rolls_2sq || Math.ceil((m.ice_water_shield_sqft || 0) / 200), share),
        ridge_cap_bundles: allocate(m.ridge_cap_bundles, share),
        starter_rolls: allocate(Math.ceil((m.starter_strip_lf || 0) / 100), share),
        drip_edge_sticks: allocate(Math.ceil(((m.drip_edge_total_lf) || 0) / 10.5), share),
        valley_pcs: allocate(Math.ceil(((m.valley_flashing_lf) || 0) / 10), share),
        nails_lbs: allocate(m.roofing_nails_lbs, share),
        eave_lf: stEave,
        rake_lf: stRake,
        ridge_hip_lf: stRidgeHip,
        valley_lf: stValley,
      }
    })
    const sum = (k: keyof typeof rows[0]) => rows.reduce((s, r) => s + (typeof r[k] === 'number' ? r[k] as number : 0), 0)
    return `
  <!-- Per-Structure Material Allocation -->
  <div style="padding:10px 28px 0">
    <div style="font-size:10px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;border-bottom:1.5px solid ${TEAL};padding-bottom:3px">Per-Structure Material Allocation — ${structuresBreakdown.length} Buildings</div>
    <table style="width:100%;border-collapse:collapse;font-size:7.5px">
      <thead>
        <tr style="background:#1a1a2e;color:#fff">
          <th style="padding:4px 6px;text-align:left;font-size:7px;font-weight:700">Structure</th>
          <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">Roof Area (SF)</th>
          <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">Squares</th>
          <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">Shingle Bundles</th>
          <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">Underlayment</th>
          <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">IWB Rolls</th>
          <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">Ridge Cap</th>
          <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">Starter</th>
          <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">Drip Edge</th>
          <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">Valley</th>
          <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">Nails (lbs)</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => `<tr style="${i % 2 === 0 ? 'background:#fafafa' : ''}">
          <td style="padding:4px 6px;border-bottom:1px solid #eee;font-weight:700">${r.label}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right;font-weight:700;color:${TEAL_DARK}">${r.sloped_sf.toLocaleString()}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right">${r.squares}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right;font-weight:700">${r.bundles}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right">${r.underlayment}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right">${r.iwb_rolls}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right">${r.ridge_cap_bundles}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right">${r.starter_rolls}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right">${r.drip_edge_sticks}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right">${r.valley_pcs}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right">${r.nails_lbs}</td>
        </tr>`).join('')}
        <tr style="background:#eee;font-weight:800">
          <td style="padding:5px 6px;border-top:2px solid #333">Combined Total</td>
          <td style="padding:5px 6px;border-top:2px solid #333;text-align:right;color:${TEAL_DARK}">${sum('sloped_sf' as any).toLocaleString()}</td>
          <td style="padding:5px 6px;border-top:2px solid #333;text-align:right">${Math.round(sum('squares' as any) * 10) / 10}</td>
          <td style="padding:5px 6px;border-top:2px solid #333;text-align:right">${sum('bundles' as any)}</td>
          <td style="padding:5px 6px;border-top:2px solid #333;text-align:right">${sum('underlayment' as any)}</td>
          <td style="padding:5px 6px;border-top:2px solid #333;text-align:right">${sum('iwb_rolls' as any)}</td>
          <td style="padding:5px 6px;border-top:2px solid #333;text-align:right">${sum('ridge_cap_bundles' as any)}</td>
          <td style="padding:5px 6px;border-top:2px solid #333;text-align:right">${sum('starter_rolls' as any)}</td>
          <td style="padding:5px 6px;border-top:2px solid #333;text-align:right">${sum('drip_edge_sticks' as any)}</td>
          <td style="padding:5px 6px;border-top:2px solid #333;text-align:right">${sum('valley_pcs' as any)}</td>
          <td style="padding:5px 6px;border-top:2px solid #333;text-align:right">${sum('nails_lbs' as any)}</td>
        </tr>
      </tbody>
    </table>
    <div style="font-size:6.5px;color:#888;margin-top:3px;font-style:italic">Allocation derived from each structure's share of total sloped roof area; per-structure quantities rounded up so the field crew never runs short.</div>
  </div>` })() : ''}

  <!-- Notes -->
  <div style="padding:10px 28px 0">
    <div style="padding:6px 10px;background:${TEAL_LIGHT};border:1px solid #b2dfdb;border-radius:4px;font-size:7px;color:${TEAL_DARK};line-height:1.5">
      <strong>Material Notes:</strong> Quantities include standard waste factor. Verify quantities with your supplier before purchasing. Material availability and prices may vary by region. Bundle counts based on 3 bundles per roofing square for architectural shingles. Underlayment based on 15-square rolls. IWB (Ice &amp; Water Barrier) per IRC R905.1.2 / NBC: full roof coverage on any segment with rise &lt; 2:12; otherwise the membrane extends from the eave edge to at least 24&quot; past the interior heated-wall line, plus 3 ft on each side of valleys.
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

  const TEAL = '#00897B', TEAL_DARK = '#00695C', TEAL_LIGHT = '#E0F2F1'

  // Edge type row builder
  const edgeTypeRows = (details: any[], type: string, label: string, color: string, totalFt: number) => {
    if (!details || details.length === 0) return ''
    return `
    <tr style="background:${color}10;border-top:2px solid ${color}">
      <td colspan="6" style="padding:5px 8px;font-weight:800;font-size:9px;color:${color}"><span style="display:inline-block;width:14px;height:3px;background:${color};border-radius:1px;margin-right:6px;vertical-align:middle"></span>${label} — ${details.length} segments, ${totalFt} LF total</td>
    </tr>
    ${details.map((d: any, i: number) => {
      const conf = typeof d.classifier_confidence === 'number' ? d.classifier_confidence : null
      const verifyPill = conf != null && conf < 70
        ? ` <span style="display:inline-block;padding:1px 5px;background:#FFF4E5;color:#7A4A05;border:1px solid #F5A524;border-radius:3px;font-size:6px;font-weight:700;margin-left:4px">VERIFY ${conf}%</span>`
        : ''
      return `
    <tr style="${i % 2 === 0 ? '' : 'background:#f8fafc'};border-bottom:1px solid #f1f5f9">
      <td style="padding:3px 8px;font-weight:600;font-size:8px">${d.id || d.edge_num || (i + 1)}</td>
      <td style="padding:3px 8px;font-size:8px;color:#555">${type}${verifyPill}</td>
      <td style="padding:3px 8px;text-align:right;font-weight:700;font-size:8px">${Math.round((d.horiz_length_ft || d.length_2d_ft || 0) * 10) / 10}</td>
      <td style="padding:3px 8px;text-align:right;font-size:8px;color:#555">${Math.round((d.sloped_length_ft || d.length_3d_ft || d.horiz_length_ft || d.length_2d_ft || 0) * 10) / 10}</td>
      <td style="padding:3px 8px;text-align:center;font-size:7px;color:#888">${d.slope_factor ? '×' + d.slope_factor.toFixed(3) : '—'}</td>
      <td style="padding:3px 8px;text-align:center;font-size:7px;color:#888">${d.bearing_deg ? Math.round(d.bearing_deg) + '°' : '—'}</td>
    </tr>`
    }).join('')}`
  }

  return `
<!-- ==================== EDGE BREAKDOWN PAGE ==================== -->
<div class="page">
  <div style="height:4px;background:linear-gradient(90deg,${TEAL},${TEAL_DARK})"></div>
  <div style="padding:12px 28px 8px">
    <div style="font-size:14px;font-weight:800;color:#222">Detailed Edge Breakdown</div>
  </div>

  <!-- Summary strip -->
  <div style="margin:0 28px 10px;display:flex;gap:6px;font-size:8px">
    <div style="flex:1;text-align:center;padding:6px;background:#fef2f2;border-radius:4px;border:1px solid #fecaca">
      <div style="font-size:14px;font-weight:900;color:#dc2626">${tm.linear_measurements.ridges_total_ft} <span style="font-size:7px">LF</span></div>
      <div style="font-size:6.5px;color:#991b1b;font-weight:700">${tm.key_measurements.num_ridges} Ridges</div>
    </div>
    <div style="flex:1;text-align:center;padding:6px;background:#f0fdf4;border-radius:4px;border:1px solid #bbf7d0">
      <div style="font-size:14px;font-weight:900;color:#16a34a">${tm.linear_measurements.eaves_total_ft} <span style="font-size:7px">LF</span></div>
      <div style="font-size:6.5px;color:#166534;font-weight:700">${tm.key_measurements.num_eave_points} Eave Segments</div>
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
          <th style="padding:4px 8px;text-align:center;font-size:7px;font-weight:700">Pitch Factor</th>
          <th style="padding:4px 8px;text-align:center;font-size:7px;font-weight:700">Bearing</th>
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
          <td colspan="3"></td>
        </tr>
      </tbody>
    </table>
  </div>

  ${tm.face_details && tm.face_details.length > 0 ? `
  <!-- Face Details -->
  <div style="padding:10px 28px 0">
    <div style="font-size:10px;font-weight:800;color:#333;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;border-bottom:2px solid ${TEAL};padding-bottom:3px">Roof Face Details</div>
    <table style="width:100%;border-collapse:collapse;font-size:8px">
      <thead>
        <tr style="background:${TEAL_LIGHT}">
          <th style="padding:4px 8px;text-align:left;font-size:7px;font-weight:700;color:${TEAL_DARK}">Face</th>
          <th style="padding:4px 8px;text-align:center;font-size:7px;font-weight:700;color:${TEAL_DARK}">Pitch</th>
          <th style="padding:4px 8px;text-align:right;font-size:7px;font-weight:700;color:${TEAL_DARK}">Projected Area</th>
          <th style="padding:4px 8px;text-align:right;font-size:7px;font-weight:700;color:${TEAL_DARK}">Sloped Area</th>
          <th style="padding:4px 8px;text-align:right;font-size:7px;font-weight:700;color:${TEAL_DARK}">Squares</th>
          <th style="padding:4px 8px;text-align:center;font-size:7px;font-weight:700;color:${TEAL_DARK}">Slope Factor</th>
        </tr>
      </thead>
      <tbody>
        ${tm.face_details.map((f: any, i: number) => `
        <tr style="${i % 2 === 0 ? '' : 'background:#f0fdfa'};border-bottom:1px solid #b2dfdb">
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
  <div style="position:absolute;bottom:0;left:0;right:0;height:28px;background:linear-gradient(90deg,${TEAL},${TEAL_DARK});display:flex;align-items:center;justify-content:space-between;padding:0 28px">
    <span style="color:#fff;font-size:9px;font-weight:700">Roof Manager</span>
    <span style="color:#E0F2F1;font-size:7.5px">roofmanager.ca &bull; Report: ${reportNum} &bull; ${reportDate} &bull; Edge Breakdown</span>
  </div>
</div>`
}

// ============================================================
// MEASUREMENT SUMMARY PAGE — Consolidated overview of all measurements
// Replaces the old Cross-Check & Advisory page
// ============================================================
function buildMeasurementSummaryPage(report: RoofReport, reportNum: string, reportDate: string, fullAddress: string): string {
  const tm = (report as any).trace_measurement as any
  const mat = report.materials || {} as any
  const es = report.edge_summary || {} as any
  const TEAL = '#00897B'
  const TEAL_DARK = '#00695C'
  const TEAL_LIGHT = '#E0F2F1'
  const structuresBreakdown = computeStructuresBreakdown(report)

  const netArea = Math.round(report.total_true_area_sqft || 0)
  const footprint = Math.round(report.total_footprint_sqft || netArea)
  const wastePct = mat.waste_pct || 5
  const grossArea = Math.round(netArea * (1 + wastePct / 100))
  const netSquares = Math.round(netArea / 100 * 10) / 10
  const grossSquares = Math.round(grossArea / 100 * 10) / 10
  const slopeMult = report.area_multiplier && report.area_multiplier > 1 ? report.area_multiplier : 1

  // Predominant pitch
  const largestSeg = report.segments?.length ? [...report.segments].sort((a, b) => b.true_area_sqft - a.true_area_sqft)[0] : null
  const predominantPitch = largestSeg?.pitch_ratio || report.roof_pitch_ratio || '0:12'
  const predominantPitchDeg = largestSeg?.pitch_degrees || report.roof_pitch_degrees || 0

  // Edge totals
  const totalEave = es.total_eave_ft || 0
  const totalRidge = es.total_ridge_ft || 0
  const totalHip = es.total_hip_ft || 0
  const totalValley = es.total_valley_ft || 0
  const totalRake = es.total_rake_ft || 0
  const totalPerimeter = totalEave + totalRake
  const totalLinear = totalEave + totalRidge + totalHip + totalValley + totalRake

  // IWB fallback (IRC R905.1.2 / NBC) — matches the take-off page logic
  const sumLowSlopeSqft = (report.segments || []).reduce((sum: number, s: any) => {
    const rise = 12 * Math.tan(((s?.pitch_degrees || 0) * Math.PI) / 180)
    return rise > 0 && rise < 2.0 ? sum + (s?.true_area_sqft || 0) : sum
  }, 0)
  const fbEaveStripSqft = totalEave * 3
  const fbValleySqft = totalValley * 3 * 2
  const fbIwbSqFt = Math.round(sumLowSlopeSqft + fbEaveStripSqft + fbValleySqft)

  // Materials
  const traceMat = tm?.materials_estimate
  const m = traceMat || {
    shingles_bundles: Math.ceil(grossArea / 100 * 3),
    shingles_squares_net: netSquares,
    shingles_squares_gross: grossSquares,
    underlayment_rolls: Math.ceil(netArea / 400),
    ice_water_shield_sqft: fbIwbSqFt,
    ridge_cap_lf: Math.round(totalRidge + totalHip),
    ridge_cap_bundles: Math.ceil((totalRidge + totalHip) / 20),
    starter_strip_lf: Math.round(totalEave + totalRake),
    drip_edge_total_lf: Math.round(totalEave + totalRake),
    valley_flashing_lf: Math.round(totalValley),
    roofing_nails_lbs: Math.ceil(grossArea / 100 * 2.5),
    caulk_tubes: Math.max(2, Math.ceil(netArea / 1000))
  }

  // IWB SF on the summary page reflects the trigger-aware total
  const iwbSqFt = Math.round((m.ice_water_shield_sqft as number) || fbIwbSqFt)

  return `
<!-- ==================== MEASUREMENT SUMMARY PAGE ==================== -->
<div class="page">
  <div style="height:4px;background:linear-gradient(90deg,${TEAL},${TEAL_DARK})"></div>

  <!-- Header -->
  <div style="padding:12px 28px 8px;display:flex;align-items:center;justify-content:space-between">
    <div>
      <div style="font-size:14px;font-weight:800;color:#222">Roof Measurement &amp; Material Summary</div>
      <div style="font-size:9px;color:#888;margin-top:2px">${fullAddress}</div>
    </div>
    <div style="display:flex;align-items:center;gap:6px">
      <div style="width:28px;height:28px;background:${TEAL};border-radius:5px;display:flex;align-items:center;justify-content:center">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 21V10L12 3L21 10V21H15V14H9V21H3Z" fill="white"/></svg>
      </div>
      <div style="font-size:11px;font-weight:900;color:${TEAL}">ROOF MANAGER</div>
    </div>
  </div>

  <!-- Hero summary strip -->
  <div style="margin:0 28px 12px;display:flex;gap:8px">
    <div style="flex:1;background:linear-gradient(135deg,${TEAL},#26a69a);border-radius:6px;padding:10px;text-align:center;color:#fff">
      <div style="font-size:7px;font-weight:700;text-transform:uppercase;opacity:0.8;letter-spacing:0.5px">Total Roof Area</div>
      <div style="font-size:20px;font-weight:900">${netArea.toLocaleString()} SF</div>
      <div style="font-size:7px;opacity:0.7">${netSquares} squares</div>
    </div>
    <div style="flex:1;background:linear-gradient(135deg,#0891b2,#06b6d4);border-radius:6px;padding:10px;text-align:center;color:#fff">
      <div style="font-size:7px;font-weight:700;text-transform:uppercase;opacity:0.8;letter-spacing:0.5px">Gross w/${wastePct}% Waste</div>
      <div style="font-size:20px;font-weight:900">${grossArea.toLocaleString()} SF</div>
      <div style="font-size:7px;opacity:0.7">${grossSquares} squares</div>
    </div>
    <div style="flex:1;background:linear-gradient(135deg,${TEAL_DARK},#004d40);border-radius:6px;padding:10px;text-align:center;color:#fff">
      <div style="font-size:7px;font-weight:700;text-transform:uppercase;opacity:0.8;letter-spacing:0.5px">Pitch</div>
      <div style="font-size:20px;font-weight:900">${predominantPitch}</div>
      <div style="font-size:7px;opacity:0.7">${predominantPitchDeg.toFixed(1)}&deg; &middot; &times;${slopeMult.toFixed(4)}</div>
    </div>
    <div style="flex:1;background:linear-gradient(135deg,#4338ca,#6366f1);border-radius:6px;padding:10px;text-align:center;color:#fff">
      <div style="font-size:7px;font-weight:700;text-transform:uppercase;opacity:0.8;letter-spacing:0.5px">Total Linear</div>
      <div style="font-size:20px;font-weight:900">${Math.round(totalLinear)} LF</div>
      <div style="font-size:7px;opacity:0.7">${report.segments?.length || 0} planes</div>
    </div>
  </div>

  <!-- Two-column layout: Measurements + Materials -->
  <div style="display:flex;gap:14px;padding:0 28px;margin-bottom:10px">

    <!-- LEFT: Roof Measurements -->
    <div style="flex:1">
      <div style="font-size:10px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;border-bottom:2px solid ${TEAL};padding-bottom:3px">Roof Measurements</div>
      <table style="width:100%;border-collapse:collapse;font-size:8.5px">
        <tbody>
          <tr style="background:${TEAL};color:#fff">
            <td style="padding:5px 10px;font-weight:800;font-size:9px">Total Roof Area (Sloped)</td>
            <td style="padding:5px 10px;text-align:right;font-weight:900;font-size:10px">${netArea.toLocaleString()} SF</td>
          </tr>
          <tr style="background:#fafafa">
            <td style="padding:4px 10px;border-bottom:1px solid #eee">Footprint (Projected) Area</td>
            <td style="padding:4px 10px;text-align:right;font-weight:700;border-bottom:1px solid #eee">${footprint.toLocaleString()} SF</td>
          </tr>
          <tr>
            <td style="padding:4px 10px;border-bottom:1px solid #eee">Gross Area (w/${wastePct}% waste)</td>
            <td style="padding:4px 10px;text-align:right;font-weight:700;border-bottom:1px solid #eee">${grossArea.toLocaleString()} SF</td>
          </tr>
          <tr style="background:#fafafa">
            <td style="padding:4px 10px;border-bottom:1px solid #eee">Roofing Squares (net)</td>
            <td style="padding:4px 10px;text-align:right;font-weight:700;border-bottom:1px solid #eee">${netSquares}</td>
          </tr>
          <tr>
            <td style="padding:4px 10px;border-bottom:1px solid #eee">Roofing Squares (gross)</td>
            <td style="padding:4px 10px;text-align:right;font-weight:700;border-bottom:1px solid #eee">${grossSquares}</td>
          </tr>
          <tr style="background:#fafafa">
            <td style="padding:4px 10px;border-bottom:1px solid #eee">Predominant Pitch</td>
            <td style="padding:4px 10px;text-align:right;font-weight:700;border-bottom:1px solid #eee">${predominantPitch} (${predominantPitchDeg.toFixed(1)}&deg;)</td>
          </tr>
          <tr>
            <td style="padding:4px 10px;border-bottom:1px solid #eee">Slope Multiplier</td>
            <td style="padding:4px 10px;text-align:right;font-weight:700;border-bottom:1px solid #eee">&times;${slopeMult.toFixed(4)}</td>
          </tr>
          <tr style="background:#fafafa">
            <td style="padding:4px 10px;border-bottom:1px solid #eee">Roof Planes</td>
            <td style="padding:4px 10px;text-align:right;font-weight:700;border-bottom:1px solid #eee">${report.segments?.length || 0}</td>
          </tr>
          <tr>
            <td style="padding:4px 10px;border-bottom:1px solid #eee">IWB (Ice &amp; Water Barrier)</td>
            <td style="padding:4px 10px;text-align:right;font-weight:700;border-bottom:1px solid #eee">${iwbSqFt} SF</td>
          </tr>
        </tbody>
      </table>

      <!-- Edge Lengths -->
      <div style="font-size:10px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.8px;margin-top:10px;margin-bottom:6px;border-bottom:2px solid ${TEAL};padding-bottom:3px">Edge Lengths</div>
      <table style="width:100%;border-collapse:collapse;font-size:8.5px">
        <thead>
          <tr style="background:${TEAL_DARK};color:#fff">
            <th style="padding:4px 10px;text-align:left;font-size:7.5px">Edge Type</th>
            <th style="padding:4px 10px;text-align:right;font-size:7.5px">Length (LF)</th>
          </tr>
        </thead>
        <tbody>
          <tr style="background:#fafafa"><td style="padding:3px 10px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:3px;background:#16a34a;border-radius:1px;margin-right:4px;vertical-align:middle"></span>Eave</td><td style="padding:3px 10px;text-align:right;font-weight:700;border-bottom:1px solid #eee">${totalEave} LF</td></tr>
          <tr><td style="padding:3px 10px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:3px;background:#DC2626;border-radius:1px;margin-right:4px;vertical-align:middle"></span>Ridge</td><td style="padding:3px 10px;text-align:right;font-weight:700;border-bottom:1px solid #eee">${totalRidge} LF</td></tr>
          <tr style="background:#fafafa"><td style="padding:3px 10px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:3px;background:#EA580C;border-radius:1px;margin-right:4px;vertical-align:middle"></span>Hip</td><td style="padding:3px 10px;text-align:right;font-weight:700;border-bottom:1px solid #eee">${totalHip} LF</td></tr>
          <tr><td style="padding:3px 10px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:3px;background:#2563EB;border-radius:1px;margin-right:4px;vertical-align:middle"></span>Valley</td><td style="padding:3px 10px;text-align:right;font-weight:700;border-bottom:1px solid #eee">${totalValley} LF</td></tr>
          <tr style="background:#fafafa"><td style="padding:3px 10px;border-bottom:1px solid #eee"><span style="display:inline-block;width:12px;height:3px;background:#7C3AED;border-radius:1px;margin-right:4px;vertical-align:middle"></span>Rake</td><td style="padding:3px 10px;text-align:right;font-weight:700;border-bottom:1px solid #eee">${totalRake} LF</td></tr>
          <tr style="background:${TEAL_LIGHT};font-weight:800">
            <td style="padding:4px 10px;border-top:2px solid ${TEAL_DARK}">Total Perimeter (Eave + Rake)</td>
            <td style="padding:4px 10px;text-align:right;border-top:2px solid ${TEAL_DARK}">${totalPerimeter} LF</td>
          </tr>
          <tr style="background:${TEAL};color:#fff;font-weight:800">
            <td style="padding:4px 10px">Total All Edges</td>
            <td style="padding:4px 10px;text-align:right">${Math.round(totalLinear)} LF</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- RIGHT: Material Summary -->
    <div style="flex:1">
      <div style="font-size:10px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px;border-bottom:2px solid ${TEAL};padding-bottom:3px">Material Summary</div>
      <table style="width:100%;border-collapse:collapse;font-size:8.5px">
        <thead>
          <tr style="background:${TEAL_DARK};color:#fff">
            <th style="padding:4px 10px;text-align:left;font-size:7.5px;font-weight:700">Material</th>
            <th style="padding:4px 10px;text-align:center;font-size:7.5px;font-weight:700">Qty</th>
            <th style="padding:4px 10px;text-align:center;font-size:7.5px;font-weight:700">Unit</th>
            <th style="padding:4px 10px;text-align:left;font-size:7.5px;font-weight:700">Based On</th>
          </tr>
        </thead>
        <tbody>
          <tr style="background:#fafafa">
            <td style="padding:4px 10px;border-bottom:1px solid #eee;font-weight:700"><span style="color:#0891b2;margin-right:3px">&#9632;</span>Field Shingles</td>
            <td style="padding:4px 10px;text-align:center;font-weight:800;color:#0891b2;border-bottom:1px solid #eee">${m.shingles_bundles}</td>
            <td style="padding:4px 10px;text-align:center;font-size:7.5px;color:#777;border-bottom:1px solid #eee">bundles</td>
            <td style="padding:4px 10px;font-size:7px;color:#666;border-bottom:1px solid #eee">${m.shingles_squares_gross} sq gross</td>
          </tr>
          <tr>
            <td style="padding:4px 10px;border-bottom:1px solid #eee;font-weight:700"><span style="color:#6366f1;margin-right:3px">&#9632;</span>Underlayment</td>
            <td style="padding:4px 10px;text-align:center;font-weight:800;color:#6366f1;border-bottom:1px solid #eee">${m.underlayment_rolls}</td>
            <td style="padding:4px 10px;text-align:center;font-size:7.5px;color:#777;border-bottom:1px solid #eee">rolls</td>
            <td style="padding:4px 10px;font-size:7px;color:#666;border-bottom:1px solid #eee">${netArea.toLocaleString()} SF net</td>
          </tr>
          <tr style="background:#fafafa">
            <td style="padding:4px 10px;border-bottom:1px solid #eee;font-weight:700"><span style="color:#2563eb;margin-right:3px">&#10052;</span>Ice &amp; Water Shield</td>
            <td style="padding:4px 10px;text-align:center;font-weight:800;color:#2563eb;border-bottom:1px solid #eee">${Math.ceil(m.ice_water_shield_sqft / 200)}</td>
            <td style="padding:4px 10px;text-align:center;font-size:7.5px;color:#777;border-bottom:1px solid #eee">rolls</td>
            <td style="padding:4px 10px;font-size:7px;color:#666;border-bottom:1px solid #eee">${m.ice_water_shield_sqft} SF IWB</td>
          </tr>
          <tr>
            <td style="padding:4px 10px;border-bottom:1px solid #eee;font-weight:700"><span style="color:#dc2626;margin-right:3px">&#9650;</span>Ridge Cap</td>
            <td style="padding:4px 10px;text-align:center;font-weight:800;color:#dc2626;border-bottom:1px solid #eee">${m.ridge_cap_bundles}</td>
            <td style="padding:4px 10px;text-align:center;font-size:7.5px;color:#777;border-bottom:1px solid #eee">bundles</td>
            <td style="padding:4px 10px;font-size:7px;color:#666;border-bottom:1px solid #eee">${m.ridge_cap_lf} LF ridge+hip</td>
          </tr>
          <tr style="background:#fafafa">
            <td style="padding:4px 10px;border-bottom:1px solid #eee;font-weight:700"><span style="color:#16a34a;margin-right:3px">&#9644;</span>Starter Strip</td>
            <td style="padding:4px 10px;text-align:center;font-weight:800;color:#16a34a;border-bottom:1px solid #eee">${Math.ceil(m.starter_strip_lf / 100)}</td>
            <td style="padding:4px 10px;text-align:center;font-size:7.5px;color:#777;border-bottom:1px solid #eee">rolls</td>
            <td style="padding:4px 10px;font-size:7px;color:#666;border-bottom:1px solid #eee">${m.starter_strip_lf} LF perimeter</td>
          </tr>
          <tr>
            <td style="padding:4px 10px;border-bottom:1px solid #eee;font-weight:700"><span style="color:#16a34a;margin-right:3px">&#9472;</span>Drip Edge</td>
            <td style="padding:4px 10px;text-align:center;font-weight:800;color:#16a34a;border-bottom:1px solid #eee">${Math.ceil(m.drip_edge_total_lf / 10.5)}</td>
            <td style="padding:4px 10px;text-align:center;font-size:7.5px;color:#777;border-bottom:1px solid #eee">sticks</td>
            <td style="padding:4px 10px;font-size:7px;color:#666;border-bottom:1px solid #eee">${m.drip_edge_total_lf} LF total</td>
          </tr>
          <tr style="background:#fafafa">
            <td style="padding:4px 10px;border-bottom:1px solid #eee;font-weight:700"><span style="color:#2563eb;margin-right:3px">&#9660;</span>Valley Flashing</td>
            <td style="padding:4px 10px;text-align:center;font-weight:800;color:#2563eb;border-bottom:1px solid #eee">${Math.ceil(m.valley_flashing_lf / 10)}</td>
            <td style="padding:4px 10px;text-align:center;font-size:7.5px;color:#777;border-bottom:1px solid #eee">pcs</td>
            <td style="padding:4px 10px;font-size:7px;color:#666;border-bottom:1px solid #eee">${m.valley_flashing_lf} LF valley</td>
          </tr>
          <tr>
            <td style="padding:4px 10px;border-bottom:1px solid #eee;font-weight:700"><span style="color:#64748b;margin-right:3px">&#9733;</span>Roofing Nails</td>
            <td style="padding:4px 10px;text-align:center;font-weight:800;color:#64748b;border-bottom:1px solid #eee">${m.roofing_nails_lbs}</td>
            <td style="padding:4px 10px;text-align:center;font-size:7.5px;color:#777;border-bottom:1px solid #eee">lbs</td>
            <td style="padding:4px 10px;font-size:7px;color:#666;border-bottom:1px solid #eee">~2.5 lbs/square</td>
          </tr>
          <tr style="background:#fafafa">
            <td style="padding:4px 10px;border-bottom:1px solid #eee;font-weight:700"><span style="color:#0891b2;margin-right:3px">&#9679;</span>Caulk / Sealant</td>
            <td style="padding:4px 10px;text-align:center;font-weight:800;color:#0891b2;border-bottom:1px solid #eee">${m.caulk_tubes}</td>
            <td style="padding:4px 10px;text-align:center;font-size:7.5px;color:#777;border-bottom:1px solid #eee">tubes</td>
            <td style="padding:4px 10px;font-size:7px;color:#666;border-bottom:1px solid #eee">Flashings &amp; penetrations</td>
          </tr>
        </tbody>
      </table>

      <!-- Waste Factor Quick Reference -->
      <div style="font-size:9px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.5px;margin-top:10px;margin-bottom:4px">Waste Factor Reference</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0;border:1px solid #ccc;border-radius:4px;overflow:hidden">
        ${[5, 10, 15].map(pct => `<div style="padding:4px 6px;text-align:center;font-size:8px;${pct === wastePct ? `background:${TEAL};color:#fff;font-weight:800` : 'background:#fafafa;color:#555'}">
          <div style="font-weight:700">${pct}%</div>
          <div>${Math.round(netArea * (1 + pct / 100)).toLocaleString()} SF</div>
        </div>`).join('')}
      </div>
    </div>
  </div>

  ${structuresBreakdown.length >= 2 ? (() => {
    const totalSloped = structuresBreakdown.reduce((s, x) => s + x.true_area_sf, 0) || 1
    const rows = structuresBreakdown.map(st => {
      const share = st.true_area_sf / totalSloped
      return {
        label: st.label,
        footprint_sf: st.footprint_sf,
        sloped_sf: st.true_area_sf,
        squares: st.squares,
        perimeter_ft: st.perimeter_ft,
        eave_lf: Math.round((es.total_eave_ft || 0) * share * 10) / 10,
        rake_lf: Math.round((es.total_rake_ft || 0) * share * 10) / 10,
        ridge_lf: Math.round((es.total_ridge_ft || 0) * share * 10) / 10,
        hip_lf: Math.round((es.total_hip_ft || 0) * share * 10) / 10,
        valley_lf: Math.round((es.total_valley_ft || 0) * share * 10) / 10,
      }
    })
    const sum = (k: keyof typeof rows[0]) => rows.reduce((s, r) => s + (typeof r[k] === 'number' ? r[k] as number : 0), 0)
    return `
  <!-- Per-Structure Measurement Breakdown -->
  <div style="padding:0 28px;margin-bottom:8px">
    <div style="font-size:10px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.8px;margin-bottom:4px;border-bottom:1.5px solid ${TEAL};padding-bottom:3px">Per-Structure Measurement Breakdown — ${structuresBreakdown.length} Buildings</div>
    <table style="width:100%;border-collapse:collapse;font-size:7.5px">
      <thead>
        <tr style="background:#1a1a2e;color:#fff">
          <th style="padding:4px 6px;text-align:left;font-size:7px;font-weight:700">Structure</th>
          <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">Footprint (SF)</th>
          <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">Sloped (SF)</th>
          <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">Squares</th>
          <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">Perimeter (LF)</th>
          <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">Eave</th>
          <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">Rake</th>
          <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">Ridge</th>
          <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">Hip</th>
          <th style="padding:4px 6px;text-align:right;font-size:7px;font-weight:700">Valley</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => `<tr style="${i % 2 === 0 ? 'background:#fafafa' : ''}">
          <td style="padding:4px 6px;border-bottom:1px solid #eee;font-weight:700">${r.label}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right">${r.footprint_sf.toLocaleString()}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right;font-weight:700;color:${TEAL_DARK}">${r.sloped_sf.toLocaleString()}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right">${r.squares}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right">${r.perimeter_ft.toLocaleString()}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right">${r.eave_lf}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right">${r.rake_lf}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right">${r.ridge_lf}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right">${r.hip_lf}</td>
          <td style="padding:4px 6px;border-bottom:1px solid #eee;text-align:right">${r.valley_lf}</td>
        </tr>`).join('')}
        <tr style="background:#eee;font-weight:800">
          <td style="padding:5px 6px;border-top:2px solid #333">Combined Total</td>
          <td style="padding:5px 6px;border-top:2px solid #333;text-align:right">${sum('footprint_sf' as any).toLocaleString()}</td>
          <td style="padding:5px 6px;border-top:2px solid #333;text-align:right;color:${TEAL_DARK}">${sum('sloped_sf' as any).toLocaleString()}</td>
          <td style="padding:5px 6px;border-top:2px solid #333;text-align:right">${Math.round(sum('squares' as any) * 10) / 10}</td>
          <td style="padding:5px 6px;border-top:2px solid #333;text-align:right">${Math.round(sum('perimeter_ft' as any) * 10) / 10}</td>
          <td style="padding:5px 6px;border-top:2px solid #333;text-align:right">${Math.round(sum('eave_lf' as any) * 10) / 10}</td>
          <td style="padding:5px 6px;border-top:2px solid #333;text-align:right">${Math.round(sum('rake_lf' as any) * 10) / 10}</td>
          <td style="padding:5px 6px;border-top:2px solid #333;text-align:right">${Math.round(sum('ridge_lf' as any) * 10) / 10}</td>
          <td style="padding:5px 6px;border-top:2px solid #333;text-align:right">${Math.round(sum('hip_lf' as any) * 10) / 10}</td>
          <td style="padding:5px 6px;border-top:2px solid #333;text-align:right">${Math.round(sum('valley_lf' as any) * 10) / 10}</td>
        </tr>
      </tbody>
    </table>
    <div style="font-size:6.5px;color:#888;margin-top:3px;font-style:italic">Footprint and perimeter come from each traced eave polygon. Sloped area applies the dominant pitch multiplier; edge lengths split by area share.</div>
  </div>` })() : ''}

  <!-- Notes -->
  <div style="padding:0 28px">
    <div style="padding:6px 10px;background:${TEAL_LIGHT};border:1px solid ${TEAL};border-radius:4px;font-size:7px;color:${TEAL_DARK};line-height:1.5">
      <strong>Notes:</strong> All measurements derived from ${(report as any).roof_trace ? 'user-traced GPS coordinates (UTM projection, Shoelace formula)' : 'AI vision analysis'}. Pitch multiplier &radic;(rise&sup2;+12&sup2;)/12 applied for true 3D surface area. Material quantities include standard waste factor. Verify with supplier before purchasing.
    </div>
  </div>

  <!-- Accuracy + Disclaimer -->
  <div style="padding:6px 28px 0;font-size:7px;color:#666;line-height:1.5;text-align:center">
    <strong style="color:#333">Accuracy:</strong> &plusmn;2% area, &plusmn;1% linear &mdash; industry-standard tolerance per EagleView/RoofSnap convention.
    Engineering-grade estimate; physical verification recommended for code-critical work.
    &copy; ${new Date().getFullYear()} Roof Manager.
  </div>

  <!-- Footer bar -->
  <div style="position:absolute;bottom:0;left:0;right:0;height:28px;background:linear-gradient(90deg,${TEAL},${TEAL_DARK});display:flex;align-items:center;justify-content:space-between;padding:0 28px">
    <span style="color:#fff;font-size:9px;font-weight:700">Roof Manager</span>
    <span style="color:#E0F2F1;font-size:7.5px">roofmanager.ca &bull; Report: ${reportNum} &bull; ${reportDate} &bull; Measurement Summary</span>
  </div>
</div>`
}

// ============================================================
// Customer Pricing Estimate — Page Section
// Shows cost estimate based on customer-provided price per bundle
// ============================================================
function buildCustomerPricingHTML(report: RoofReport): string {
  const TEAL = '#00897B', TEAL_DARK = '#00695C', TEAL_LIGHT = '#E0F2F1'
  const pricePerBundle = report.customer_price_per_bundle || 0
  const grossSquares = report.customer_gross_squares || 0
  const totalCost = report.customer_total_cost_estimate || 0
  const trueArea = report.total_true_area_sqft || 0
  const netSquares = Math.round(trueArea / 100 * 10) / 10
  const wasteArea = Math.round(trueArea * 0.15)

  return `
<div style="page-break-before:always;max-width:1050px;margin:0 auto;padding:35px 40px;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:#fff">
  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;padding-bottom:16px;border-bottom:3px solid ${TEAL}">
    <div>
      <div style="font-size:18px;font-weight:900;color:${TEAL_DARK};letter-spacing:0.3px">
        <span style="display:inline-block;width:28px;height:28px;background:${TEAL};color:white;text-align:center;line-height:28px;border-radius:4px;font-size:14px;margin-right:8px">$</span>
        CUSTOMER COST ESTIMATE
      </div>
      <div style="font-size:10px;color:${TEAL_DARK};margin-top:4px;font-weight:500">Roof Replacement Pricing — Based on Client-Provided Rate</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:9px;color:#6b7a8d;text-transform:uppercase;letter-spacing:0.5px">Property</div>
      <div style="font-size:11px;font-weight:700;color:#003366">${report.property?.address || ''}</div>
    </div>
  </div>

  <!-- Summary Cards -->
  <div style="display:flex;gap:16px;margin-bottom:24px">
    <!-- Net Roof Area -->
    <div style="flex:1;background:linear-gradient(135deg,${TEAL_LIGHT},#b2dfdb);border-radius:10px;padding:18px;text-align:center;border:1px solid ${TEAL}30">
      <div style="font-size:9px;color:${TEAL_DARK};font-weight:700;text-transform:uppercase;letter-spacing:0.8px">Net Roof Area</div>
      <div style="font-size:26px;font-weight:900;color:${TEAL_DARK};margin:6px 0">${trueArea.toLocaleString()}</div>
      <div style="font-size:10px;color:${TEAL}">sq ft</div>
    </div>
    <!-- Waste Allowance -->
    <div style="flex:1;background:linear-gradient(135deg,#e0f7fa,#b2ebf2);border-radius:10px;padding:18px;text-align:center;border:1px solid ${TEAL}30">
      <div style="font-size:9px;color:${TEAL_DARK};font-weight:700;text-transform:uppercase;letter-spacing:0.8px">15% Waste Allowance</div>
      <div style="font-size:26px;font-weight:900;color:#00796b;margin:6px 0">+${wasteArea.toLocaleString()}</div>
      <div style="font-size:10px;color:${TEAL}">sq ft</div>
    </div>
    <!-- Gross Squares -->
    <div style="flex:1;background:linear-gradient(135deg,${TEAL},${TEAL_DARK});border-radius:10px;padding:18px;text-align:center;color:white">
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
    <div style="position:absolute;top:-20px;right:-20px;width:120px;height:120px;background:rgba(0,137,123,0.15);border-radius:50%"></div>
    <div style="position:absolute;bottom:-30px;left:-10px;width:80px;height:80px;background:rgba(0,137,123,0.1);border-radius:50%"></div>
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;opacity:0.7;margin-bottom:8px">Estimated Roof Replacement Cost</div>
    <div style="font-size:48px;font-weight:900;color:#80cbc4;text-shadow:0 2px 8px rgba(0,0,0,0.3)">$${totalCost.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
    <div style="font-size:12px;margin-top:6px;opacity:0.6">Canadian Dollars (CAD)</div>
  </div>

  <!-- Calculation Breakdown -->
  <div style="background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;padding:20px;margin-bottom:20px">
    <div style="font-size:12px;font-weight:700;color:#334155;margin-bottom:12px">
      <span style="display:inline-block;width:18px;height:18px;background:${TEAL};color:white;text-align:center;line-height:18px;border-radius:3px;font-size:10px;margin-right:6px">&#8614;</span>
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
        <td style="padding:10px 0;text-align:right;font-weight:900;color:${TEAL_DARK};font-size:14px">$${totalCost.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CAD</td>
      </tr>
    </table>
  </div>

  <!-- Disclaimer -->
  <div style="background:${TEAL_LIGHT};border:1px solid #b2dfdb;border-radius:8px;padding:14px 16px;font-size:9px;color:${TEAL_DARK};line-height:1.6">
    <strong style="font-size:10px">ESTIMATE DISCLAIMER:</strong> This cost estimate is based on the client-provided rate of $${pricePerBundle}/square and AI-measured roof area with 15% waste factor. Actual costs may vary depending on: roof complexity, existing material removal, structural repairs, flashing details, code requirements, and regional pricing. This estimate does not include additional materials (underlayment, flashing, vents, etc.). A professional on-site assessment is recommended for a final quote.
  </div>
</div>`
}

// ============================================================
// SOLAR PROPOSAL PAGE — Renders user-edited (or suggested) panel layout
// over the satellite image, plus system size, annual production, savings.
// ============================================================
function buildSolarProposalPage(report: RoofReport, reportNum: string, reportDate: string, fullAddress: string): string {
  const TEAL = '#00897B', TEAL_DARK = '#00695C', TEAL_LIGHT = '#E0F2F1'
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
  <div style="height:4px;background:linear-gradient(90deg,${TEAL},${TEAL_DARK})"></div>
  <div style="padding:12px 28px 8px">
    <div style="font-size:14px;font-weight:800;color:#222"><span style="color:${TEAL}">&#9728;</span> Solar Proposal</div>
    <div style="font-size:10px;color:#555">${fullAddress}</div>
  </div>

  <div style="padding:0 28px 10px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
    <div style="background:${TEAL_LIGHT};border:1px solid #b2dfdb;border-radius:6px;padding:10px;text-align:center">
      <div style="font-size:7px;font-weight:700;color:${TEAL_DARK};text-transform:uppercase">Panels</div>
      <div style="font-size:20px;font-weight:900;color:${TEAL_DARK}">${panelCount}</div>
    </div>
    <div style="background:#b2dfdb;border:1px solid ${TEAL};border-radius:6px;padding:10px;text-align:center">
      <div style="font-size:7px;font-weight:700;color:${TEAL_DARK};text-transform:uppercase">System Size</div>
      <div style="font-size:20px;font-weight:900;color:${TEAL_DARK}">${systemKw.toFixed(2)} kW</div>
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
    <div style="font-size:11px;font-weight:800;color:${NAVY};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;border-bottom:2px solid ${TEAL};padding-bottom:3px">
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

  <div style="position:absolute;bottom:0;left:0;right:0;height:28px;background:linear-gradient(90deg,${TEAL},${TEAL_DARK});display:flex;align-items:center;justify-content:space-between;padding:0 28px">
    <span style="color:#fff;font-size:9px;font-weight:700">Roof Manager</span>
    <span style="color:#E0F2F1;font-size:7.5px">roofmanager.ca &bull; Report: ${reportNum} &bull; ${reportDate} &bull; Solar Proposal</span>
  </div>
</div>`
}

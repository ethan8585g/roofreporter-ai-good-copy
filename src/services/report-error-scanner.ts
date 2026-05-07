// ============================================================
// Report Error Scanner — single-report sanity checks.
// Used both inline (after each report generation completes) and
// in batch (the loop-scanner 'reports' sweep). Findings are
// written to loop_scan_findings under a parent loop_scan_runs row.
//
// Checks mirror the validation gates already in svg-diagrams.ts and
// report-engine.ts so we catch the same broken outputs after-the-fact:
//   • broken_diagram      — geometry won't render past the AI gate
//   • duplicate_structure — 2+ traced sections with near-identical
//                           footprint AND near-identical centroid
//                           (the "house twice instead of house+garage" bug)
//   • missing_structure   — multiple eaves_sections traced but
//                           breakdown collapsed to one
//   • missing_html        — status='completed' but no rendered HTML
//   • stuck_generating    — status='generating'/'enhancing' for >2h
//   • failed_no_queue     — status='failed' but not flagged for admin
//   • json_parse_error    — api_response_raw exists but won't parse
// ============================================================

import type { Bindings } from '../types'

export type ReportFindingCategory =
  | 'broken_diagram'
  | 'duplicate_structure'
  | 'missing_structure'
  | 'missing_html'
  | 'stuck_generating'
  | 'failed_no_queue'
  | 'json_parse_error'

export type ReportFinding = {
  severity: 'error' | 'warn'
  category: ReportFindingCategory
  order_id: number
  url: string
  message: string
  details?: any
}

type ReportRow = {
  order_id: number
  status: string | null
  generation_started_at: string | null
  professional_report_html: string | null
  api_response_raw: string | null
  needs_review: number | null
  needs_admin_trace: number | null
  order_number: string | null
  property_address: string | null
}

const ADMIN_LINK = (orderId: number) =>
  `/super-admin?tab=report-requests&order=${orderId}`

// ── Public: scan one report ───────────────────────────────────
export async function scanReportForErrors(
  env: Bindings,
  orderId: number | string,
): Promise<ReportFinding[]> {
  const row = await env.DB.prepare(
    `SELECT r.order_id, r.status, r.generation_started_at,
            r.professional_report_html, r.api_response_raw,
            r.needs_review, o.needs_admin_trace,
            o.order_number, o.property_address
     FROM reports r JOIN orders o ON o.id = r.order_id
     WHERE r.order_id = ?`,
  ).bind(orderId).first<ReportRow>()
  if (!row) return []
  return checkReportRow(row)
}

// ── Public: scan many reports (used by sweep) ─────────────────
export async function scanReportsBatch(
  env: Bindings,
  rows: ReportRow[],
): Promise<ReportFinding[]> {
  const out: ReportFinding[] = []
  for (const row of rows) {
    out.push(...checkReportRow(row))
  }
  return out
}

// ── Public: query rows for a sweep window ─────────────────────
export async function fetchReportsForSweep(
  env: Bindings,
  sinceMinutes: number,
): Promise<ReportRow[]> {
  // Cover the recent window AND any review-flagged report still open,
  // so a single tick catches both fresh issues and unresolved older ones.
  const r = await env.DB.prepare(
    `SELECT r.order_id, r.status, r.generation_started_at,
            r.professional_report_html, r.api_response_raw,
            r.needs_review, o.needs_admin_trace,
            o.order_number, o.property_address
     FROM reports r JOIN orders o ON o.id = r.order_id
     WHERE r.created_at > datetime('now', ?)
        OR r.updated_at > datetime('now', ?)
        OR r.needs_review = 1`,
  ).bind(`-${sinceMinutes} minutes`, `-${sinceMinutes} minutes`).all<ReportRow>()
  return (r.results || []) as ReportRow[]
}

// ── Core check logic ──────────────────────────────────────────
function checkReportRow(row: ReportRow): ReportFinding[] {
  const findings: ReportFinding[] = []
  const orderId = Number(row.order_id)
  const tag = `${row.order_number || `#${orderId}`} · ${row.property_address || 'unknown'}`

  // 1) stuck_generating — work-in-progress states older than 2h
  if (row.status === 'generating' || row.status === 'enhancing') {
    const startedAt = row.generation_started_at
      ? new Date(row.generation_started_at + 'Z').getTime()
      : 0
    const ageMin = startedAt ? Math.round((Date.now() - startedAt) / 60_000) : null
    if (ageMin === null || ageMin > 120) {
      findings.push({
        severity: 'error',
        category: 'stuck_generating',
        order_id: orderId,
        url: ADMIN_LINK(orderId),
        message: `Report stuck in '${row.status}' for ${ageMin ?? '?'}m on ${tag}`,
        details: { status: row.status, age_minutes: ageMin },
      })
    }
  }

  // 2) failed_no_queue — failed but not routed to admin trace
  if (row.status === 'failed' && !row.needs_admin_trace) {
    findings.push({
      severity: 'error',
      category: 'failed_no_queue',
      order_id: orderId,
      url: ADMIN_LINK(orderId),
      message: `Report status='failed' but order is not queued for admin trace — ${tag}`,
    })
  }

  // 3) missing_html — completed but the HTML body is missing or trivial
  if (row.status === 'completed') {
    const html = row.professional_report_html || ''
    if (html.length < 500) {
      findings.push({
        severity: 'error',
        category: 'missing_html',
        order_id: orderId,
        url: ADMIN_LINK(orderId),
        message: `Completed report has empty/trivial HTML (${html.length} chars) — ${tag}`,
        details: { html_length: html.length },
      })
    }
  }

  // The remaining checks require a parseable api_response_raw
  if (!row.api_response_raw) return findings
  let report: any
  try {
    report = JSON.parse(row.api_response_raw)
  } catch (e: any) {
    findings.push({
      severity: 'error',
      category: 'json_parse_error',
      order_id: orderId,
      url: ADMIN_LINK(orderId),
      message: `api_response_raw won't JSON.parse — ${tag}: ${e?.message || e}`,
    })
    return findings
  }

  // 4) broken_diagram — mirrors the gates in svg-diagrams.ts:53-62.
  // If the AI geometry would force the renderer onto the fallback path,
  // the customer-visible diagram is degraded.
  const ai = report?.geometry || report?.ai_geometry || report?.ai_measurement_analysis
  const segments = Array.isArray(report?.segments) ? report.segments : []
  const diagFinding = checkDiagram(ai, segments, orderId, tag)
  if (diagFinding) findings.push(diagFinding)

  // 5) duplicate_structure / missing_structure — operate on roof_trace.eaves_sections
  const sections: { lat: number; lng: number }[][] = Array.isArray(report?.roof_trace?.eaves_sections)
    ? report.roof_trace.eaves_sections.filter(
        (s: any) => Array.isArray(s) && s.length >= 3,
      )
    : []
  const structFindings = checkStructures(sections, orderId, tag)
  findings.push(...structFindings)

  return findings
}

function checkDiagram(
  ai: any,
  segments: any[],
  orderId: number,
  tag: string,
): ReportFinding | null {
  // Same gates as svg-diagrams.ts:53-58
  const hasPerim =
    ai && Array.isArray(ai.perimeter) && ai.perimeter.length >= 3
  const hasFacets = ai && Array.isArray(ai.facets) && ai.facets.length >= 2
  const hasAI = !!(ai && (hasPerim || hasFacets))

  if (!hasAI) {
    // Fallback path is used. Acceptable when no AI geometry was ever
    // produced (e.g. trace-only path), but if segments are also missing
    // the diagram will literally be blank.
    if (!Array.isArray(segments) || segments.length < 1) {
      return {
        severity: 'error',
        category: 'broken_diagram',
        order_id: orderId,
        url: ADMIN_LINK(orderId),
        message: `Diagram unrenderable (no AI geometry AND no segments) — ${tag}`,
      }
    }
    return null
  }

  // AI present — check for malformed shapes that would crash the renderer
  const issues: string[] = []
  if (hasFacets) {
    for (let i = 0; i < ai.facets.length; i++) {
      const f = ai.facets[i]
      if (!f || !Array.isArray(f.points) || f.points.length < 3) {
        issues.push(`facet[${i}].points missing/<3`)
        break
      }
    }
  }
  if (Array.isArray(ai.lines)) {
    for (let i = 0; i < ai.lines.length; i++) {
      const l = ai.lines[i]
      if (!l?.start || !l?.end || typeof l.start.x !== 'number' || typeof l.end.x !== 'number') {
        issues.push(`lines[${i}] missing endpoints`)
        break
      }
    }
  }

  if (issues.length > 0) {
    return {
      severity: 'error',
      category: 'broken_diagram',
      order_id: orderId,
      url: ADMIN_LINK(orderId),
      message: `Malformed AI geometry (${issues.join('; ')}) — ${tag}`,
      details: { issues },
    }
  }
  return null
}

function checkStructures(
  sections: { lat: number; lng: number }[][],
  orderId: number,
  tag: string,
): ReportFinding[] {
  const out: ReportFinding[] = []
  if (sections.length < 2) return out

  // Convert each section to a footprint + centroid using a flat-earth approx
  // (same projection as computeStructuresBreakdown in templates/report-html.ts)
  const meanLat0 =
    sections[0].reduce((s, p) => s + p.lat, 0) / sections[0].length
  const FT_PER_DEG_LAT = 364000
  const ftPerDegLng = FT_PER_DEG_LAT * Math.cos((meanLat0 * Math.PI) / 180)
  const lng0 = sections[0][0].lng

  type Geom = { footprint: number; cx: number; cy: number; n: number }
  const geoms: Geom[] = sections.map((pts) => {
    const xy = pts.map((p) => ({
      x: (p.lng - lng0) * ftPerDegLng,
      y: (p.lat - meanLat0) * FT_PER_DEG_LAT,
    }))
    let a = 0
    let cx = 0
    let cy = 0
    for (let i = 0; i < xy.length; i++) {
      const j = (i + 1) % xy.length
      const cross = xy[i].x * xy[j].y - xy[j].x * xy[i].y
      a += cross
      cx += (xy[i].x + xy[j].x) * cross
      cy += (xy[i].y + xy[j].y) * cross
    }
    const area = Math.abs(a) / 2
    // Centroid via shoelace (handles signed area direction)
    const denom = 3 * a
    const cxFinal = denom === 0 ? xy[0].x : cx / denom
    const cyFinal = denom === 0 ? xy[0].y : cy / denom
    return { footprint: area, cx: cxFinal, cy: cyFinal, n: pts.length }
  })

  // Pairwise duplicate check: footprint within 5% AND centroid <= 5m (~16.4ft)
  const DUP_AREA_RATIO = 0.05
  const DUP_CENTROID_FT = 16.4
  for (let i = 0; i < geoms.length; i++) {
    for (let j = i + 1; j < geoms.length; j++) {
      const a = geoms[i]
      const b = geoms[j]
      const minA = Math.min(a.footprint, b.footprint) || 1
      const ratio = Math.abs(a.footprint - b.footprint) / minA
      const dist = Math.hypot(a.cx - b.cx, a.cy - b.cy)
      if (ratio < DUP_AREA_RATIO && dist < DUP_CENTROID_FT) {
        out.push({
          severity: 'warn',
          category: 'duplicate_structure',
          order_id: orderId,
          url: ADMIN_LINK(orderId),
          message: `Likely duplicate structures #${i + 1} & #${j + 1} (footprint Δ ${(ratio * 100).toFixed(1)}%, centroid ${dist.toFixed(1)}ft apart) — ${tag}`,
          details: {
            structure_a: { idx: i, footprint_sf: Math.round(a.footprint), points: a.n },
            structure_b: { idx: j, footprint_sf: Math.round(b.footprint), points: b.n },
            distance_ft: Math.round(dist * 10) / 10,
            footprint_delta_pct: Math.round(ratio * 1000) / 10,
          },
        })
        break // one finding per pair-i is enough
      }
    }
  }

  return out
}

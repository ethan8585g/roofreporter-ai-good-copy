// ============================================================
// Pro-tier measurement metadata
// ============================================================
// Three concerns kept together because they all only run on the
// professional-tier report path:
//   1. computeConfidenceBreakdown()  — per-section confidence ratings
//   2. diffMeasurements()            — version-to-version measurement delta
//   3. (weather risk lives in report-weather.ts so the NWS retry/cache
//      logic doesn't get tangled with synchronous diff math)
// ============================================================

import type {
  ConfidenceBreakdown,
  ConfidenceTier,
  ReportDiffSummary,
  RoofReport,
} from '../types'

// ----------------------------------------------------------------
// CONFIDENCE BREAKDOWN
// ----------------------------------------------------------------

interface ConfidenceInputs {
  /** Solar API imagery quality, when known (HIGH > MEDIUM > BASE/LOW). */
  imagery_quality?: 'HIGH' | 'MEDIUM' | 'LOW' | 'BASE'
  /** Pitch resolver confidence enum. */
  pitch_confidence?: 'high' | 'medium' | 'low'
  /** Pitch resolver source (solar_api beats user_default beats engine_default). */
  pitch_source?: 'solar_api' | 'user_default' | 'engine_default'
  /** Cross-check against external footprint, % delta from engine output. */
  area_variance_pct?: number | null
  /** Whether the SAM3 mask agreed with the trace polygon (IoU 0–1, optional). */
  area_iou?: number | null
  /** Did the DSM RANSAC edge classifier run? Affects edge confidence. */
  edge_classifier_ran?: boolean
  /** Average classifier confidence across edges (0–100). */
  avg_edge_classifier_confidence?: number | null
  /** Number of edges flagged below 70 (low-confidence). */
  low_confidence_edge_count?: number
}

function rateArea(input: ConfidenceInputs): { tier: ConfidenceTier; basis: string } {
  const variance = input.area_variance_pct
  const iou = input.area_iou
  const imagery = input.imagery_quality

  // SAM3 mask IoU dominates when present — it's the most direct check.
  if (typeof iou === 'number') {
    if (iou >= 0.92) return { tier: 'high', basis: `SAM3 mask IoU ${(iou * 100).toFixed(1)}% vs traced polygon` }
    if (iou >= 0.80) return { tier: 'medium', basis: `SAM3 mask IoU ${(iou * 100).toFixed(1)}%` }
    return { tier: 'low', basis: `SAM3 mask IoU only ${(iou * 100).toFixed(1)}% — trace + mask disagree` }
  }
  if (typeof variance === 'number') {
    if (variance <= 3) return { tier: 'high', basis: `Traced footprint within ${variance.toFixed(1)}% of Solar API` }
    if (variance <= 10) return { tier: 'medium', basis: `Traced footprint differs from Solar API by ${variance.toFixed(1)}%` }
    return { tier: 'low', basis: `Traced footprint differs from Solar API by ${variance.toFixed(1)}% — needs review` }
  }
  if (imagery === 'HIGH') return { tier: 'high', basis: 'HIGH-quality satellite imagery (0.1 m/px)' }
  if (imagery === 'MEDIUM') return { tier: 'medium', basis: 'MEDIUM-quality satellite imagery (0.25 m/px)' }
  return { tier: 'low', basis: 'No external area cross-check available' }
}

function ratePitch(input: ConfidenceInputs): { tier: ConfidenceTier; basis: string } {
  if (input.pitch_confidence === 'high' && input.pitch_source === 'solar_api') {
    return { tier: 'high', basis: 'Pitch from Google Solar API roofSegmentStats' }
  }
  if (input.pitch_confidence === 'medium') {
    return { tier: 'medium', basis: input.pitch_source === 'user_default'
      ? 'User-supplied default pitch (no Solar API match)'
      : 'Pitch derived with limited multi-view consensus' }
  }
  if (input.pitch_confidence === 'low') {
    return { tier: 'low', basis: 'Engine fallback pitch — Solar API failed and no user default supplied' }
  }
  return { tier: 'medium', basis: 'Pitch source not specified' }
}

function rateEdges(input: ConfidenceInputs): { tier: ConfidenceTier; basis: string } {
  if (input.edge_classifier_ran && typeof input.avg_edge_classifier_confidence === 'number') {
    const avg = input.avg_edge_classifier_confidence
    const low = input.low_confidence_edge_count || 0
    if (avg >= 85 && low === 0) return { tier: 'high', basis: `DSM RANSAC classified all edges (avg ${avg.toFixed(0)}/100)` }
    if (avg >= 70) return { tier: 'medium', basis: `DSM RANSAC avg ${avg.toFixed(0)}/100, ${low} edge(s) below 70` }
    return { tier: 'low', basis: `DSM RANSAC avg ${avg.toFixed(0)}/100 — edge geometry uncertain` }
  }
  return { tier: 'medium', basis: 'Edges derived from traced geometry without DSM cross-check' }
}

export function computeConfidenceBreakdown(input: ConfidenceInputs): ConfidenceBreakdown {
  const a = rateArea(input)
  const p = ratePitch(input)
  const e = rateEdges(input)
  return {
    pitch: p.tier,           pitch_basis: p.basis,
    area:  a.tier,           area_basis:  a.basis,
    edges: e.tier,           edges_basis: e.basis,
  }
}

// ----------------------------------------------------------------
// MEASUREMENT DIFF
// ----------------------------------------------------------------

interface DiffInput {
  /** Snapshot data: only needs the fields the diff actually compares. */
  total_true_area_sqft?: number
  total_footprint_sqft?: number
  edges?: any[]
  edge_summary?: { total_linear_ft?: number }
  roof_pitch_ratio?: string
  materials?: { gross_squares?: number }
}

/**
 * Compute a human-readable diff between two report measurement payloads.
 * Designed to be cheap (one pass over edges) and timed so we can spot
 * pathological cases. Logs duration via performance.now().
 */
export function diffMeasurements(
  prior: DiffInput,
  next: DiffInput,
  priorVersionNum: number,
): ReportDiffSummary {
  const start = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now()

  const priorArea = Number(prior.total_true_area_sqft ?? prior.total_footprint_sqft ?? 0)
  const nextArea  = Number(next.total_true_area_sqft  ?? next.total_footprint_sqft  ?? 0)
  const areaDelta = Math.round((nextArea - priorArea) * 10) / 10
  const areaDeltaPct = priorArea > 0
    ? Math.round((areaDelta / priorArea) * 1000) / 10
    : 0

  const priorSquares = Number(prior.materials?.gross_squares ?? 0)
  const nextSquares  = Number(next.materials?.gross_squares  ?? 0)
  const squaresDelta = Math.round((nextSquares - priorSquares) * 100) / 100

  const priorEdges = Array.isArray(prior.edges) ? prior.edges.length : 0
  const nextEdges  = Array.isArray(next.edges)  ? next.edges.length  : 0
  const edgesAdded   = Math.max(0, nextEdges  - priorEdges)
  const edgesRemoved = Math.max(0, priorEdges - nextEdges)

  const priorPitch = String(prior.roof_pitch_ratio ?? '').trim()
  const nextPitch  = String(next.roof_pitch_ratio  ?? '').trim()
  const pitchChanged = priorPitch !== '' && nextPitch !== '' && priorPitch !== nextPitch

  const end = (typeof performance !== 'undefined' && typeof performance.now === 'function')
    ? performance.now()
    : Date.now()
  const computedMs = Math.round((end - start) * 100) / 100

  // Build a one-sentence summary for the banner.
  const parts: string[] = []
  if (areaDelta !== 0) {
    const sign = areaDelta > 0 ? '+' : ''
    parts.push(`area ${sign}${areaDelta} ft² (${sign}${areaDeltaPct}%)`)
  }
  if (edgesAdded > 0) parts.push(`+${edgesAdded} edge${edgesAdded === 1 ? '' : 's'} identified`)
  if (edgesRemoved > 0) parts.push(`−${edgesRemoved} edge${edgesRemoved === 1 ? '' : 's'} removed`)
  if (pitchChanged) parts.push(`pitch ${priorPitch} → ${nextPitch}`)
  const message = parts.length > 0
    ? `Re-analysis: ${parts.join(', ')}.`
    : 'Re-analysis produced no measurable changes.'

  // Lightweight perf log — only when the diff took > 5ms. Most run sub-millisecond.
  if (computedMs > 5) {
    console.log(`[report-pro:diff] computed in ${computedMs}ms (priorEdges=${priorEdges}, nextEdges=${nextEdges})`)
  }

  return {
    prior_version_num: priorVersionNum,
    area_delta_ft2: areaDelta,
    area_delta_pct: areaDeltaPct,
    squares_delta: squaresDelta,
    edges_added: edgesAdded,
    edges_removed: edgesRemoved,
    pitch_changed: pitchChanged,
    prior_pitch: priorPitch || undefined,
    new_pitch:   nextPitch  || undefined,
    computed_ms: computedMs,
    message,
  }
}

// ----------------------------------------------------------------
// SHINGLE-AGE ESTIMATE (Insurance Extras)
// ----------------------------------------------------------------

/**
 * Conservative shingle-age estimate from imagery date. Roofing imagery typically
 * captures a roof partway through its useful life, so this is a *floor*: the
 * shingles are AT LEAST this old. Surface this as a hint, not a hard claim.
 */
export function estimateShingleAgeYears(imageryDateIso?: string): number | null {
  if (!imageryDateIso) return null
  const d = new Date(imageryDateIso)
  if (isNaN(d.getTime())) return null
  const ageYears = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000)
  if (!Number.isFinite(ageYears) || ageYears < 0) return null
  return Math.round(ageYears * 10) / 10
}

/**
 * Regional replacement-cost range (CAD per square) — coarse zip/postal-code
 * banding. Real implementation would pull from a pricing table; for now we
 * return the band the report should display (low-mid-high).
 */
export function regionalReplacementBandCad(report: RoofReport): { low: number; mid: number; high: number } {
  const province = (report.property?.province || '').toUpperCase()
  // Q1 2026 contractor pricing per roofing square, asphalt arch shingles
  const bands: Record<string, { low: number; mid: number; high: number }> = {
    AB: { low: 425, mid: 550, high: 725 },
    BC: { low: 475, mid: 625, high: 825 },
    ON: { low: 450, mid: 595, high: 800 },
    QC: { low: 410, mid: 535, high: 700 },
    SK: { low: 400, mid: 525, high: 695 },
    MB: { low: 410, mid: 540, high: 705 },
    NS: { low: 415, mid: 545, high: 715 },
    NB: { low: 405, mid: 530, high: 695 },
    NL: { low: 425, mid: 555, high: 730 },
    PE: { low: 410, mid: 540, high: 710 },
  }
  return bands[province] || { low: 425, mid: 565, high: 750 }
}

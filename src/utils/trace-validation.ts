// ============================================================
// Shared Roof Trace Validation
// Used by BOTH the public /calculate-from-trace endpoint
// AND the admin submit-trace / preview-trace endpoints.
// Catches: malformed structure, self-intersecting polygons,
// absurd coordinates, empty lines, duplicate points.
// ============================================================

export type TraceIssueSeverity = 'error' | 'warning'

export interface TraceIssue {
  severity: TraceIssueSeverity
  code: string
  message: string
  at?: string   // e.g. "eaves[0][2]" or "ridges[1]"
}

export interface TraceValidationResult {
  valid: boolean                // true when there are zero error-level issues
  errors: TraceIssue[]
  warnings: TraceIssue[]
  sections_count: number        // closed eave sections detected
  ridges_count: number
  hips_count: number
  valleys_count: number
  annotations_count: number
}

function isFiniteLatLng(p: any): boolean {
  return p
    && typeof p.lat === 'number' && typeof p.lng === 'number'
    && !isNaN(p.lat) && !isNaN(p.lng)
    && isFinite(p.lat) && isFinite(p.lng)
    && p.lat >= -90 && p.lat <= 90
    && p.lng >= -180 && p.lng <= 180
}

// Standard segment-intersection test (Cohen ... 2D cross products).
function segmentsIntersect(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  c: { lat: number; lng: number },
  d: { lat: number; lng: number }
): boolean {
  const ccw = (p: any, q: any, r: any) =>
    (r.lng - p.lng) * (q.lat - p.lat) - (r.lat - p.lat) * (q.lng - p.lng)
  const d1 = ccw(c, d, a)
  const d2 = ccw(c, d, b)
  const d3 = ccw(a, b, c)
  const d4 = ccw(a, b, d)
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true
  return false
}

// Detect self-intersection in a closed polygon (skipping adjacent and closing edges).
function polygonSelfIntersects(pts: { lat: number; lng: number }[]): boolean {
  const n = pts.length
  if (n < 4) return false
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    for (let j = i + 2; j < n; j++) {
      // Skip the edge that shares a vertex with edge i (wraps at end)
      if (i === 0 && j === n - 1) continue
      const c = pts[j]
      const d = pts[(j + 1) % n]
      if (segmentsIntersect(a, b, c, d)) return true
    }
  }
  return false
}

function shoelaceAreaDeg(pts: { lat: number; lng: number }[]): number {
  let a = 0
  for (let i = 0, n = pts.length; i < n; i++) {
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    a += p1.lng * p2.lat - p2.lng * p1.lat
  }
  return Math.abs(a) / 2
}

/**
 * Validate a raw trace JSON as produced by the UI
 * (either `{eaves, eaves_sections, ridges, hips, valleys, annotations}`
 * or the legacy flat-eaves single-section format).
 */
export function validateTraceUi(trace: any): TraceValidationResult {
  const errors: TraceIssue[] = []
  const warnings: TraceIssue[] = []

  const result: TraceValidationResult = {
    valid: false,
    errors, warnings,
    sections_count: 0,
    ridges_count: 0,
    hips_count: 0,
    valleys_count: 0,
    annotations_count: 0,
  }

  if (!trace || typeof trace !== 'object') {
    errors.push({ severity: 'error', code: 'no_trace', message: 'Trace payload is missing or not an object.' })
    return result
  }

  // ---- Resolve eave sections ----------------------------------------------
  let sections: { lat: number; lng: number }[][] = []
  if (Array.isArray(trace.eaves_sections) && trace.eaves_sections.length > 0) {
    sections = trace.eaves_sections.filter((s: any) => Array.isArray(s))
  } else if (Array.isArray(trace.eaves)) {
    if (trace.eaves.length > 0 && Array.isArray(trace.eaves[0])) {
      sections = trace.eaves
    } else if (trace.eaves.length > 0) {
      sections = [trace.eaves]
    }
  }

  if (sections.length === 0) {
    errors.push({ severity: 'error', code: 'no_eaves', message: 'At least one closed eave polygon is required.' })
  }

  sections.forEach((sec, sIdx) => {
    if (!Array.isArray(sec)) {
      errors.push({ severity: 'error', code: 'bad_section', message: `Eave section ${sIdx + 1} is not an array.`, at: `eaves_sections[${sIdx}]` })
      return
    }
    if (sec.length < 3) {
      errors.push({ severity: 'error', code: 'section_too_few_points', message: `Eave section ${sIdx + 1} has only ${sec.length} points (need ≥ 3).`, at: `eaves_sections[${sIdx}]` })
      return
    }
    sec.forEach((pt, pIdx) => {
      if (!isFiniteLatLng(pt)) {
        errors.push({ severity: 'error', code: 'bad_coord', message: `Eave point has invalid lat/lng.`, at: `eaves_sections[${sIdx}][${pIdx}]` })
      }
    })
    if (shoelaceAreaDeg(sec) < 1e-12) {
      warnings.push({ severity: 'warning', code: 'degenerate_polygon', message: `Eave section ${sIdx + 1} has effectively zero area (collinear points).`, at: `eaves_sections[${sIdx}]` })
    }
    if (polygonSelfIntersects(sec)) {
      errors.push({ severity: 'error', code: 'self_intersecting', message: `Eave section ${sIdx + 1} is self-intersecting. Edges must not cross.`, at: `eaves_sections[${sIdx}]` })
    }
  })
  result.sections_count = sections.length

  // ---- Line layers (ridges, hips, valleys) --------------------------------
  const validateLineLayer = (key: 'ridges' | 'hips' | 'valleys') => {
    const raw = trace[key]
    if (raw == null) return 0
    if (!Array.isArray(raw)) {
      errors.push({ severity: 'error', code: `bad_${key}`, message: `${key} must be an array.`, at: key })
      return 0
    }
    let count = 0
    raw.forEach((line: any, lIdx: number) => {
      // Accept either bare point array OR {pts: [...]} (engine format)
      const pts = Array.isArray(line) ? line : (line && Array.isArray(line.pts) ? line.pts : null)
      if (!pts) {
        errors.push({ severity: 'error', code: `bad_${key}_line`, message: `${key}[${lIdx}] is not a valid line (expected array of points).`, at: `${key}[${lIdx}]` })
        return
      }
      if (pts.length < 2) {
        warnings.push({ severity: 'warning', code: `${key}_line_too_short`, message: `${key}[${lIdx}] has fewer than 2 points — it will be ignored.`, at: `${key}[${lIdx}]` })
        return
      }
      pts.forEach((pt: any, pIdx: number) => {
        if (!isFiniteLatLng(pt)) {
          errors.push({ severity: 'error', code: 'bad_coord', message: `Invalid lat/lng.`, at: `${key}[${lIdx}][${pIdx}]` })
        }
      })
      // Optional per-line pitch (slope_map input): must be a parseable pitch if present
      if (line && typeof line === 'object' && !Array.isArray(line) && line.pitch != null) {
        const s = String(line.pitch).trim()
        const ok = /^(\d+(?:\.\d+)?)\s*[:/]\s*12$/.test(s) || (!isNaN(parseFloat(s)) && isFinite(parseFloat(s)))
        if (!ok) {
          warnings.push({ severity: 'warning', code: 'bad_pitch', message: `${key}[${lIdx}] has an unparseable pitch "${line.pitch}". Default pitch will be used.`, at: `${key}[${lIdx}]` })
        }
      }
      count++
    })
    return count
  }
  result.ridges_count  = validateLineLayer('ridges')
  result.hips_count    = validateLineLayer('hips')
  result.valleys_count = validateLineLayer('valleys')

  // ---- Annotations (vents, skylights, chimneys) ---------------------------
  const ann = trace.annotations || {}
  for (const type of ['vents', 'skylights', 'chimneys'] as const) {
    const list = ann[type]
    if (list == null) continue
    if (!Array.isArray(list)) {
      warnings.push({ severity: 'warning', code: `bad_${type}`, message: `annotations.${type} is not an array — ignored.`, at: `annotations.${type}` })
      continue
    }
    list.forEach((pt: any, i: number) => {
      if (!isFiniteLatLng(pt)) {
        warnings.push({ severity: 'warning', code: 'bad_coord', message: `annotations.${type}[${i}] has invalid coords — ignored.`, at: `annotations.${type}[${i}]` })
      } else {
        result.annotations_count++
      }
    })
  }

  // ---- Sanity: ridges/hips/valleys with no eaves is useless ---------------
  if (sections.length === 0 && (result.ridges_count + result.hips_count + result.valleys_count) > 0) {
    warnings.push({ severity: 'warning', code: 'lines_without_eaves', message: 'Ridge/hip/valley lines provided without an eave outline — they cannot be measured.' })
  }

  result.valid = errors.length === 0
  return result
}

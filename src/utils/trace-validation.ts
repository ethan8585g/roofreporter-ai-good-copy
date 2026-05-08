// ============================================================
// Shared Roof Trace Validation
// Used by BOTH the public /calculate-from-trace endpoint
// AND the admin submit-trace / preview-trace endpoints.
// Catches: malformed structure, self-intersecting polygons,
// absurd coordinates, empty lines, duplicate points.
// ============================================================

// ─── Shared UI-trace types ──────────────────────────────────────────────
// Public, reusable types so route handlers and services stop re-declaring
// the same `{eaves, eaves_sections, ridges,...}` shape inline.

export interface LatLng { lat: number; lng: number }

/** A traced line may be a bare point array (legacy) OR `{pts, pitch?, id?}`. */
export type UiTraceLine = LatLng[] | { pts: LatLng[]; pitch?: number | string | null; id?: string }

/** A wall-junction line. `kind` distinguishes step (along slope) from
 *  headwall (across top of slope). Defaults to 'step' if omitted. */
export type WallFlashingKind = 'step' | 'headwall'
export type UiWallLine =
  | LatLng[]
  | { pts: LatLng[]; kind?: WallFlashingKind; id?: string }

export interface UiTrace {
  eaves?: LatLng[] | LatLng[][]
  eaves_sections?: LatLng[][]
  /** Per-section roof pitch (rise:12), parallel to eaves_sections. null/0
   *  means "use the engine's default/dominant pitch." Used for genuinely
   *  separate structures (detached garages, sheds) whose slope differs from
   *  the main roof. NOT for dormers — see `dormers` below. */
  eaves_section_pitches?: Array<number | null | undefined>
  /** Dormers — roof features inside the main outline that ride at their own
   *  pitch (e.g. 12:12 A-frame dormer on a 6:12 main roof). Each entry is a
   *  closed polygon plus a pitch in rise:12. The engine adds only the
   *  *differential* sloped area (no new footprint), and the report renderer
   *  treats dormers as part of the main structure (not separate buildings
   *  the way eaves_sections become in multi-structure reports). */
  dormers?: Array<{
    polygon: LatLng[]
    pitch_rise: number
    label?: string
  }>
  ridges?: UiTraceLine[]
  hips?: UiTraceLine[]
  valleys?: UiTraceLine[]
  /** Roof–wall junctions (step flashing along slopes, headwall flashing
   *  across slope tops). Linear-foot output drives BOM flashing rows. */
  walls?: UiWallLine[]
  slope_map?: Record<string, string>
  annotations?: {
    vents?: LatLng[]
    skylights?: LatLng[]
    chimneys?: LatLng[]
    /** Plumbing/exhaust pipe penetrations — each becomes one pipe-boot
     *  flashing in the BOM. Separate from `vents` so contractors can
     *  distinguish powered vents from boot-only penetrations. */
    pipe_boots?: LatLng[]
  }
  traced_at?: string
}

/**
 * Discriminated union — the explicit answer to "how is this trace storing
 * eave sections?". Call `resolveEaves(trace)` and switch on `.kind` instead
 * of poking `Array.isArray(trace.eaves[0])` at every call site.
 */
export type ResolvedEaves =
  | { kind: 'none'; sections: [] }
  | { kind: 'single'; sections: [LatLng[]] }
  | { kind: 'multi';  sections: LatLng[][] }

/**
 * Resolve a UI trace's eave data into a uniform multi-section array.
 * Prefers `eaves_sections` when present, falls back to nested `eaves[][]`,
 * then to flat `eaves[]`. Filters out any section with < 3 points.
 */
export function resolveEaves(trace: any): ResolvedEaves {
  if (!trace || typeof trace !== 'object') return { kind: 'none', sections: [] }
  const collect = (raw: any): LatLng[][] => {
    if (!Array.isArray(raw)) return []
    return raw.filter((s: any) => Array.isArray(s) && s.length >= 3)
  }
  if (Array.isArray(trace.eaves_sections) && trace.eaves_sections.length > 0) {
    const secs = collect(trace.eaves_sections)
    if (secs.length > 1) return { kind: 'multi',  sections: secs }
    if (secs.length === 1) return { kind: 'single', sections: [secs[0]] }
  }
  if (Array.isArray(trace.eaves)) {
    if (trace.eaves.length > 0 && Array.isArray(trace.eaves[0])) {
      const secs = collect(trace.eaves)
      if (secs.length > 1) return { kind: 'multi',  sections: secs }
      if (secs.length === 1) return { kind: 'single', sections: [secs[0]] }
    } else if (trace.eaves.length >= 3) {
      return { kind: 'single', sections: [trace.eaves as LatLng[]] }
    }
  }
  return { kind: 'none', sections: [] }
}

/** Pick the largest section by point count — what the engine treats as "primary". */
export function primaryEaveSection(trace: any): LatLng[] {
  const r = resolveEaves(trace)
  if (r.kind === 'none') return []
  return r.sections.reduce((best, s) => s.length > best.length ? s : best, r.sections[0])
}

/** Flat array of all eave points across all sections — useful for centroids. */
export function allEavePoints(trace: any): LatLng[] {
  const r = resolveEaves(trace)
  return r.sections.flat()
}

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
  walls_count: number
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
    walls_count: 0,
    annotations_count: 0,
  }

  if (!trace || typeof trace !== 'object') {
    errors.push({ severity: 'error', code: 'no_trace', message: 'Trace payload is missing or not an object.' })
    return result
  }

  // ---- Resolve eave sections (via shared helper) --------------------------
  // Sections here may still contain < 3-point entries — the structural
  // checks below report those as specific errors. So we pull the raw
  // arrays directly rather than calling resolveEaves (which drops them).
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
    // Sparse-trace warning: if an edge > ~20 ft has zero intermediate
    // points, the tracer probably skipped a corner. 20 ft in latitude
    // ≈ 0.0000548 deg; we compare squared great-circle approximations
    // to avoid importing geodesy here.
    const FT_PER_DEG_LAT = 364_000
    for (let i = 0; i < sec.length; i++) {
      const a = sec[i], b = sec[(i + 1) % sec.length]
      if (!isFiniteLatLng(a) || !isFiniteLatLng(b)) continue
      const ftPerDegLng = FT_PER_DEG_LAT * Math.cos(a.lat * Math.PI / 180)
      const dLatFt = (b.lat - a.lat) * FT_PER_DEG_LAT
      const dLngFt = (b.lng - a.lng) * ftPerDegLng
      const lenFt = Math.sqrt(dLatFt * dLatFt + dLngFt * dLngFt)
      if (lenFt > 22) {
        warnings.push({
          severity: 'warning',
          code: 'sparse_trace_edge',
          message: `Eave section ${sIdx + 1} edge ${i + 1} is ${Math.round(lenFt)} ft with no intermediate points — you may have skipped a corner.`,
          at: `eaves_sections[${sIdx}][${i}]`,
        })
      }
    }
  })
  result.sections_count = sections.length

  // ---- Line layers (ridges, hips, valleys, walls) -------------------------
  const validateLineLayer = (key: 'ridges' | 'hips' | 'valleys' | 'walls') => {
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
  result.walls_count   = validateLineLayer('walls')

  // ---- Wall-line `kind` validation ----------------------------------------
  if (Array.isArray(trace.walls)) {
    trace.walls.forEach((line: any, lIdx: number) => {
      if (line && typeof line === 'object' && !Array.isArray(line) && line.kind != null) {
        if (line.kind !== 'step' && line.kind !== 'headwall') {
          warnings.push({ severity: 'warning', code: 'bad_wall_kind', message: `walls[${lIdx}] has unrecognized kind "${line.kind}". Defaulting to "step".`, at: `walls[${lIdx}]` })
        }
      }
    })
  }

  // ---- Annotations (vents, skylights, chimneys, pipe_boots) ---------------
  const ann = trace.annotations || {}
  for (const type of ['vents', 'skylights', 'chimneys', 'pipe_boots'] as const) {
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

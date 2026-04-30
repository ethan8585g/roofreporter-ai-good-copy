import { describe, it, expect } from 'vitest'
import {
  enhanceTrace,
  mergeCollinearEaves,
  removeTinyEaves,
  snapRightAngles,
  snapRidgeEndpointsToCorners,
  snapRidgeEndpointsToLines,
  closeRidgeGaps,
  equalizeParallelPairs,
} from './trace-enhancer'
import type { LatLng, UiTrace } from '../utils/trace-validation'

// Sherwood Park, AB — same general area as the user's screenshots.
const REF = { lat: 53.5161, lng: -113.3145 }
const FT_PER_DEG_LAT = 364_000
const ftToLat = (ft: number) => ft / FT_PER_DEG_LAT
const ftToLng = (ft: number, lat: number) => ft / (FT_PER_DEG_LAT * Math.cos(lat * Math.PI / 180))
const offset = (base: LatLng, dxFt: number, dyFt: number): LatLng => ({
  lat: base.lat + ftToLat(dyFt),
  lng: base.lng + ftToLng(dxFt, base.lat),
})

// ── A clean 30 ft × 20 ft rectangle, CCW from SW corner ──────
function cleanRect(): LatLng[] {
  return [
    REF,
    offset(REF, 30, 0),
    offset(REF, 30, 20),
    offset(REF, 0,  20),
  ]
}

describe('mergeCollinearEaves', () => {
  it('collapses an extra collinear point on the bottom edge', () => {
    const rect = cleanRect()
    const messy = [
      rect[0],
      offset(REF, 15, 0),  // collinear midpoint
      rect[1],
      rect[2],
      rect[3],
    ]
    const out = mergeCollinearEaves(messy, 6)
    expect(out.removed).toBe(1)
    expect(out.pts.length).toBe(4)
  })

  it('leaves a clean 4-corner rectangle untouched', () => {
    const out = mergeCollinearEaves(cleanRect(), 6)
    expect(out.removed).toBe(0)
    expect(out.pts.length).toBe(4)
  })

  it('refuses to drop below 3 vertices', () => {
    const triangle = [REF, offset(REF, 30, 0), offset(REF, 15, 26)]
    const out = mergeCollinearEaves(triangle, 6)
    expect(out.pts.length).toBeGreaterThanOrEqual(3)
  })
})

describe('removeTinyEaves', () => {
  it('drops a 0.5 ft jog edge', () => {
    const rect = cleanRect()
    const messy = [
      rect[0],
      rect[1],
      offset(rect[1], 0, 0.4),  // tiny jog up 0.4 ft
      rect[2],
      rect[3],
    ]
    const out = removeTinyEaves(messy, 1.2)
    expect(out.removed).toBeGreaterThanOrEqual(1)
    expect(out.pts.length).toBeLessThan(messy.length)
  })

  it('keeps all edges of a clean rectangle (all > 1.2 ft)', () => {
    const out = removeTinyEaves(cleanRect(), 1.2)
    expect(out.removed).toBe(0)
    expect(out.pts.length).toBe(4)
  })

  it('refuses to drop below 3 vertices', () => {
    const triangle = [REF, offset(REF, 0.3, 0), offset(REF, 0, 0.3)]
    const out = removeTinyEaves(triangle, 1.2)
    expect(out.pts.length).toBeGreaterThanOrEqual(3)
  })
})

describe('snapRightAngles', () => {
  it('is a no-op on a perfect rectangle', () => {
    const out = snapRightAngles(cleanRect(), 7)
    expect(out.snapped).toBe(0)
  })

  it('snaps an 85° corner back to 90°', () => {
    // Rectangle but the NE corner is rotated to make a ~85° corner.
    const rect = cleanRect()
    const tilted = [
      rect[0],
      rect[1],
      offset(rect[1], -1.7, 20),  // ~5° tilt at the NE corner
      rect[3],
    ]
    const out = snapRightAngles(tilted, 7)
    expect(out.snapped).toBeGreaterThanOrEqual(1)
  })
})

describe('snapRidgeEndpointsToCorners', () => {
  it('snaps a ridge endpoint that falls 2 ft from a corner', () => {
    const rect = cleanRect()
    const ridge: LatLng[] = [
      offset(rect[0], 1.5, 1.5),  // 2.1 ft from SW corner — within 3 ft
      offset(rect[2], 0, 0),      // exactly at NE corner
    ]
    const out = snapRidgeEndpointsToCorners([ridge], [rect], 3.0)
    expect(out.snapped).toBeGreaterThanOrEqual(1)
    const newPts = Array.isArray(out.ridges[0]) ? out.ridges[0] : (out.ridges[0] as any).pts
    expect(newPts[0].lat).toBeCloseTo(rect[0].lat, 6)
    expect(newPts[0].lng).toBeCloseTo(rect[0].lng, 6)
  })

  it('does NOT snap an endpoint that is 10 ft from any corner', () => {
    const rect = cleanRect()
    const ridge: LatLng[] = [offset(rect[0], 10, 10), offset(rect[2], -3, -3)]
    const out = snapRidgeEndpointsToCorners([ridge], [rect], 3.0)
    expect(out.snapped).toBe(0)
  })

  it('handles { pts } object form for ridge lines', () => {
    const rect = cleanRect()
    const ridge = { pts: [offset(rect[0], 1, 1), rect[2]], pitch: '6:12' }
    const out = snapRidgeEndpointsToCorners([ridge as any], [rect], 3.0)
    expect(out.snapped).toBeGreaterThanOrEqual(1)
    const r0 = out.ridges[0] as any
    expect(r0.pts).toBeDefined()
    expect(r0.pitch).toBe('6:12')  // preserved
  })
})

describe('snapRidgeEndpointsToLines', () => {
  it('snaps a ridge endpoint that ends 1 ft from a hip endpoint', () => {
    const rect = cleanRect()
    const ridge: LatLng[] = [offset(rect[0], 5, 10), offset(rect[1], -5, 10)]
    const hipEndpoint = offset(rect[0], 5.7, 10.3)  // ~0.8 ft from ridge[0]
    const hip: LatLng[] = [hipEndpoint, rect[0]]
    const out = snapRidgeEndpointsToLines([ridge], [hip], 2.0)
    expect(out.snapped).toBeGreaterThanOrEqual(1)
  })
})

describe('closeRidgeGaps', () => {
  it('splices two ridge polylines whose endpoints are 1 ft apart', () => {
    const a: LatLng[] = [offset(REF, 0, 10), offset(REF, 10, 10)]
    const b: LatLng[] = [offset(REF, 10.5, 10), offset(REF, 20, 10)]  // 0.5 ft gap
    const out = closeRidgeGaps([a, b], 1.5)
    expect(out.spliced).toBe(1)
    expect(out.ridges.length).toBe(1)
  })

  it('does NOT splice when the gap is larger than the threshold', () => {
    const a: LatLng[] = [offset(REF, 0, 10), offset(REF, 10, 10)]
    const b: LatLng[] = [offset(REF, 15, 10), offset(REF, 25, 10)]  // 5 ft gap
    const out = closeRidgeGaps([a, b], 1.5)
    expect(out.spliced).toBe(0)
    expect(out.ridges.length).toBe(2)
  })
})

describe('equalizeParallelPairs', () => {
  // Helper: edge length in feet between two LatLngs.
  function edgeFt(a: LatLng, b: LatLng): number {
    const dy = (b.lat - a.lat) * FT_PER_DEG_LAT
    const dx = (b.lng - a.lng) * FT_PER_DEG_LAT * Math.cos(a.lat * Math.PI / 180)
    return Math.hypot(dx, dy)
  }

  it('equalizes a near-symmetric shed (60×27 vs 60×28)', () => {
    // Mimics the user's shop: rectangle whose left side is 28 ft and
    // right side is 27 ft due to GPS noise. Expect both ends → 27.5.
    const pts: LatLng[] = [
      REF,
      offset(REF, 60, 0),
      offset(REF, 60, 27),
      offset(REF, 0, 28),
    ]
    const out = equalizeParallelPairs(pts, 5, 2.0, 0.10)
    expect(out.equalized).toBeGreaterThanOrEqual(1)
    const left = edgeFt(out.pts[3], out.pts[0])
    const right = edgeFt(out.pts[1], out.pts[2])
    expect(Math.abs(left - right)).toBeLessThan(0.5)
  })

  it('leaves a genuinely asymmetric shape alone (gap > 2 ft)', () => {
    // Left side 20 ft, right side 28 ft — a real bumpout, not noise.
    const pts: LatLng[] = [
      REF,
      offset(REF, 60, 0),
      offset(REF, 60, 28),
      offset(REF, 0, 20),
    ]
    const out = equalizeParallelPairs(pts, 5, 2.0, 0.10)
    expect(out.equalized).toBe(0)
  })

  it('leaves a clean rectangle untouched (already equal)', () => {
    const out = equalizeParallelPairs(cleanRect(), 5, 2.0, 0.10)
    expect(out.equalized).toBe(0)
  })

  it('skips pairs that exceed the percent threshold even if under 2 ft', () => {
    // 5 ft vs 6.5 ft → 1.5 ft gap (under 2 ft) but 23% (over 10%).
    // Tiny structures shouldn't get force-equalized.
    const pts: LatLng[] = [
      REF,
      offset(REF, 5, 0),
      offset(REF, 5, 6.5),
      offset(REF, 0, 5),
    ]
    const out = equalizeParallelPairs(pts, 5, 2.0, 0.10)
    expect(out.equalized).toBe(0)
  })
})

describe('enhanceTrace integration', () => {
  it('cleans a messy trace end-to-end and reports changes', () => {
    const rect = cleanRect()
    const messyEaves = [
      rect[0],
      offset(REF, 15, 0),                  // collinear midpoint → merge
      rect[1],
      offset(rect[1], 0, 0.3),             // tiny jog → drop
      rect[2],
      offset(REF, 14.9, 20),               // collinear midpoint → merge
      rect[3],
    ]
    const ridge: LatLng[] = [
      offset(rect[0], 1.5, 1.5),           // ~2 ft from SW → snap to corner
      offset(rect[2], 1, 1),               // ~1.4 ft from NE → snap to corner
    ]
    const trace: UiTrace = {
      eaves_sections: [messyEaves],
      ridges: [ridge],
    }
    const out = enhanceTrace(trace)
    expect(out.changes.length).toBeGreaterThanOrEqual(2)
    expect(out.changes.some(c => c.rule === 'merge_collinear')).toBe(true)
    expect(out.changes.some(c => c.rule === 'snap_ridge_to_corner')).toBe(true)
    // Eave section should now have ~4 points.
    expect(out.trace.eaves_sections![0].length).toBeLessThanOrEqual(5)
  })

  it('is a no-op on an already-clean trace', () => {
    const trace: UiTrace = { eaves_sections: [cleanRect()] }
    const out = enhanceTrace(trace)
    expect(out.changes).toEqual([])
    expect(out.warnings).toEqual([])
  })

  it('preserves multi-section eaves shape', () => {
    const sec1 = cleanRect()
    const sec2 = [
      offset(REF, 50, 0),
      offset(REF, 70, 0),
      offset(REF, 70, 15),
      offset(REF, 50, 15),
    ]
    const trace: UiTrace = { eaves_sections: [sec1, sec2] }
    const out = enhanceTrace(trace)
    expect(out.trace.eaves_sections!.length).toBe(2)
  })

  it('handles legacy flat eaves array', () => {
    const trace: UiTrace = { eaves: cleanRect() }
    const out = enhanceTrace(trace)
    // Should still be readable as flat eaves.
    expect(Array.isArray(out.trace.eaves)).toBe(true)
  })

  it('never produces a polygon with < 3 points', () => {
    // Pathological: 4 nearly-coincident points.
    const tinyTrace: UiTrace = {
      eaves_sections: [[
        REF,
        offset(REF, 0.1, 0),
        offset(REF, 0.1, 0.1),
        offset(REF, 0, 0.1),
      ]],
    }
    const out = enhanceTrace(tinyTrace)
    expect(out.trace.eaves_sections![0].length).toBeGreaterThanOrEqual(3)
  })
})

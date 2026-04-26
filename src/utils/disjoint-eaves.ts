// ============================================================
// Disjoint-eaves auto-detect
//
// When a user traces a house and a detached garage in one stroke
// (without clicking "add structure"), both buildings end up in the
// same eaves polygon as a self-touching shape with two long "jump"
// edges bridging the buildings. This helper detects that case and
// splits the polygon back into per-structure sub-polygons.
//
// Algorithm:
//  1. Project lat/lng to local metres.
//  2. Walk the closed polygon, collecting edge lengths.
//  3. Find edges ≥ 3× the median length AND ≥ 8 m absolute.
//  4. If exactly two such "jump" edges and they're roughly the same
//     length (the entry-bridge and the closing-bridge between two
//     buildings), the points between them form two clusters.
//  5. Validate each cluster has ≥ 3 points and ≥ 25 m² area; if so,
//     return them as separate polygons. Otherwise leave the polygon
//     untouched.
//
// Returns one polygon for genuine single-structure traces, two for
// merged house + detached structure traces.
// ============================================================

export interface LatLng { lat: number; lng: number }

interface XY { x: number; y: number }

function projectToMeters(poly: LatLng[]): { xy: XY[]; refLat: number; refLng: number } {
  const refLat = poly.reduce((s, p) => s + p.lat, 0) / poly.length
  const refLng = poly.reduce((s, p) => s + p.lng, 0) / poly.length
  const cosLat = Math.cos(refLat * Math.PI / 180)
  const xy = poly.map(p => ({
    x: (p.lng - refLng) * 111320 * cosLat,
    y: (p.lat - refLat) * 111320,
  }))
  return { xy, refLat, refLng }
}

function shoelaceM2(pts: XY[]): number {
  let a = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return Math.abs(a) / 2
}

export function detectDisjointEaves(poly: LatLng[]): LatLng[][] {
  if (!poly || poly.length < 6) return [poly || []]

  const { xy } = projectToMeters(poly)
  const n = poly.length

  // Closed-loop edge lengths
  const edges: { len: number; from: number; to: number }[] = []
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    edges.push({ len: Math.hypot(xy[j].x - xy[i].x, xy[j].y - xy[i].y), from: i, to: j })
  }

  // Median edge length
  const lens = edges.map(e => e.len).slice().sort((a, b) => a - b)
  const median = lens[Math.floor(lens.length / 2)] || 1

  // Jump edges: ≥ 3× median AND ≥ 8 m
  const jumps = edges
    .map((e, idx) => ({ ...e, idx }))
    .filter(e => e.len > median * 3 && e.len > 8)
    .sort((a, b) => b.len - a.len)

  if (jumps.length < 2) return [poly]

  // The two longest jumps should be the bridges between buildings.
  // They should be roughly the same length (within 0.4 ratio) — if
  // one jump is much longer than the other, the polygon is just one
  // odd shape with one stretched edge, not two structures.
  const j1 = jumps[0]
  const j2 = jumps[1]
  if (Math.min(j1.len, j2.len) / Math.max(j1.len, j2.len) < 0.4) return [poly]

  // Walk from j1.to → j2.from for cluster A, j2.to → j1.from for cluster B.
  const walk = (start: number, end: number): number[] => {
    const out: number[] = []
    let i = start
    let safety = n + 1
    while (safety-- > 0) {
      out.push(i)
      if (i === end) break
      i = (i + 1) % n
    }
    return out
  }
  const idxA = walk(j1.to, j2.from)
  const idxB = walk(j2.to, j1.from)
  if (idxA.length < 3 || idxB.length < 3) return [poly]

  const polyA = idxA.map(i => poly[i])
  const polyB = idxB.map(i => poly[i])
  const areaA = shoelaceM2(idxA.map(i => xy[i]))
  const areaB = shoelaceM2(idxB.map(i => xy[i]))
  if (Math.min(areaA, areaB) < 25) return [poly]

  return [polyA, polyB]
}

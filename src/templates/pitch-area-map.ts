// ============================================================
// ROOF PITCH MAP — property-specific appendix page
// Replaces the prior "Roof Anatomy Reference" educational glossary.
//
// Renders a top-down outline of the actual traced roof with each face
// colored by its pitch, plus a legend chip per pitch showing total
// sloped area + percentage. Uses face polygons from
// report.trace_measurement.face_details when available; falls back to
// report.segments aggregation when the engine couldn't emit per-face
// polygons (proportional-split path / older AI-only reports).
// ============================================================

import type { RoofReport } from '../types'

const TEAL = '#00897B'
const TEAL_DARK = '#00695C'
const FONT = `font-family="Inter,system-ui,-apple-system,sans-serif"`

function escapeHtml(s: string): string {
  return String(s || '').replace(/[&<>"']/g, c =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  )
}

/** Pitch → hex color (port of saPitchColor in super-admin-dashboard.js).
 *  Buckets chosen so a single property typically spans 2-3 colors and the
 *  legend reads at a glance. */
function pitchToColor(riseOver12: number): string {
  if (!Number.isFinite(riseOver12) || riseOver12 <= 0) return '#94A3B8' // unknown → slate
  if (riseOver12 <= 6)  return '#2563eb' // blue   — low slope
  if (riseOver12 <= 9)  return '#22c55e' // green  — standard
  if (riseOver12 <= 13) return '#f59e0b' // amber  — steep
  return '#dc2626'                       // red    — very steep
}

interface FaceForMap {
  letter: string                          // A, B, C…
  pitch_label: string                     // "6:12"
  pitch_rise: number
  sloped_area_ft2: number
  polygon?: { lat: number; lng: number }[]
}

const SEG_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Collect face data from whichever source is available. Faces with no
 *  polygon still appear in the legend but not on the map. */
function collectFaces(report: RoofReport): FaceForMap[] {
  const tm = (report as any).trace_measurement
  if (tm && Array.isArray(tm.face_details) && tm.face_details.length) {
    return tm.face_details.map((f: any, i: number) => ({
      letter: SEG_LETTERS[i] || `#${i + 1}`,
      pitch_label: f.pitch_label || (typeof f.pitch_rise === 'number' ? `${f.pitch_rise}:12` : '—'),
      pitch_rise: typeof f.pitch_rise === 'number' ? f.pitch_rise : 0,
      sloped_area_ft2: f.sloped_area_ft2 || 0,
      polygon: Array.isArray(f.polygon) && f.polygon.length >= 3 ? f.polygon : undefined,
    }))
  }
  // Fallback: segments[]. No polygon data here, so the SVG map will be
  // empty and only the legend will render.
  return (report.segments || []).map((s: any, i: number) => {
    const deg = s.pitch_degrees || 0
    const rise = 12 * Math.tan((deg * Math.PI) / 180)
    return {
      letter: SEG_LETTERS[i] || `#${i + 1}`,
      pitch_label: s.pitch_ratio || `${Math.round(rise)}:12`,
      pitch_rise: rise,
      sloped_area_ft2: s.true_area_sqft || 0,
      polygon: undefined,
    }
  })
}

/** Project lat/lng polygons → SVG pixel coords using a single bounding box
 *  + equirectangular flat-earth math (fine at building scale). Returns the
 *  projected faces plus the chosen viewport dimensions. */
function projectFaces(faces: FaceForMap[], viewW: number, viewH: number, pad: number) {
  const polyFaces = faces.filter(f => f.polygon && f.polygon.length >= 3)
  if (polyFaces.length === 0) return null
  let minLat = +Infinity, maxLat = -Infinity, minLng = +Infinity, maxLng = -Infinity
  for (const f of polyFaces) {
    for (const p of f.polygon!) {
      if (p.lat < minLat) minLat = p.lat
      if (p.lat > maxLat) maxLat = p.lat
      if (p.lng < minLng) minLng = p.lng
      if (p.lng > maxLng) maxLng = p.lng
    }
  }
  const meanLat = (minLat + maxLat) / 2
  const lngScale = Math.cos(meanLat * Math.PI / 180)
  const rawW = (maxLng - minLng) * lngScale
  const rawH = (maxLat - minLat)
  if (rawW <= 0 || rawH <= 0) return null
  const usableW = viewW - pad * 2
  const usableH = viewH - pad * 2
  const scale = Math.min(usableW / rawW, usableH / rawH)
  const projW = rawW * scale
  const projH = rawH * scale
  const offsetX = pad + (usableW - projW) / 2
  const offsetY = pad + (usableH - projH) / 2
  const project = (lat: number, lng: number) => {
    const x = offsetX + (lng - minLng) * lngScale * scale
    // Flip Y so north is up in screen coords.
    const y = offsetY + (maxLat - lat) * scale
    return { x, y }
  }
  return polyFaces.map(f => {
    const pts = f.polygon!.map(p => project(p.lat, p.lng))
    // Centroid (signed shoelace) for label placement.
    let cx = 0, cy = 0, area2 = 0
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length
      const cross = pts[i].x * pts[j].y - pts[j].x * pts[i].y
      area2 += cross
      cx += (pts[i].x + pts[j].x) * cross
      cy += (pts[i].y + pts[j].y) * cross
    }
    if (Math.abs(area2) < 1e-6) {
      // Degenerate — fall back to bounding-box center.
      cx = pts.reduce((s, p) => s + p.x, 0) / pts.length
      cy = pts.reduce((s, p) => s + p.y, 0) / pts.length
    } else {
      cx = cx / (3 * area2)
      cy = cy / (3 * area2)
    }
    return { face: f, points: pts, centroid: { x: cx, y: cy } }
  })
}

function renderPitchMapSVG(faces: FaceForMap[]): string {
  const W = 720
  const H = 440
  const PAD = 28
  const projected = projectFaces(faces, W, H, PAD)
  if (!projected) {
    return `
      <div style="padding:36px 12px;text-align:center;color:#64748B;font-size:11px;background:#F8FAFC;border:1px dashed #CBD5E1;border-radius:6px">
        Per-face polygons not available for this report. Pitch totals shown in legend below.
      </div>
    `
  }
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">`
  svg += `<rect width="${W}" height="${H}" fill="#fff" stroke="#e5e7eb" stroke-width="1" rx="4"/>`
  // Faint background grid for a "plan view" feel
  for (let gx = 0; gx <= W; gx += 60) {
    svg += `<line x1="${gx}" y1="0" x2="${gx}" y2="${H}" stroke="#F1F5F9" stroke-width="0.5"/>`
  }
  for (let gy = 0; gy <= H; gy += 60) {
    svg += `<line x1="0" y1="${gy}" x2="${W}" y2="${gy}" stroke="#F1F5F9" stroke-width="0.5"/>`
  }
  // Faces — fill colored by pitch, semi-transparent so the outline + label
  // stay legible.
  for (const p of projected) {
    const color = pitchToColor(p.face.pitch_rise)
    const pointsAttr = p.points.map(pt => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ')
    svg += `<polygon points="${pointsAttr}" fill="${color}" fill-opacity="0.55" stroke="#1e293b" stroke-width="1.8" stroke-linejoin="round"/>`
  }
  // Centroid labels last so they paint on top of every polygon.
  for (const p of projected) {
    const cx = p.centroid.x
    const cy = p.centroid.y
    svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="11" fill="#fff" stroke="#1e293b" stroke-width="1.4"/>`
    svg += `<text x="${cx.toFixed(1)}" y="${(cy + 4).toFixed(1)}" text-anchor="middle" font-size="12" font-weight="800" fill="#1e293b" ${FONT}>${escapeHtml(p.face.letter)}</text>`
  }
  // North arrow + scale hint in the bottom-right corner.
  svg += `<g transform="translate(${W - 50},${H - 50})">`
  svg += `<polygon points="0,-14 6,8 0,3 -6,8" fill="#1e293b"/>`
  svg += `<text x="0" y="22" text-anchor="middle" font-size="9" font-weight="700" fill="#1e293b" ${FONT}>N</text>`
  svg += `</g>`
  svg += `</svg>`
  return svg
}

interface LegendEntry {
  pitch_label: string
  pitch_rise: number
  sloped_area_ft2: number
  count: number
}

function buildLegend(faces: FaceForMap[]): { rows: LegendEntry[]; total: number } {
  const byLabel = new Map<string, LegendEntry>()
  for (const f of faces) {
    const key = f.pitch_label || '—'
    const existing = byLabel.get(key)
    if (existing) {
      existing.sloped_area_ft2 += f.sloped_area_ft2
      existing.count += 1
    } else {
      byLabel.set(key, {
        pitch_label: key,
        pitch_rise: f.pitch_rise,
        sloped_area_ft2: f.sloped_area_ft2,
        count: 1,
      })
    }
  }
  const rows = [...byLabel.values()].sort((a, b) => b.sloped_area_ft2 - a.sloped_area_ft2)
  const total = rows.reduce((s, r) => s + r.sloped_area_ft2, 0)
  return { rows, total }
}

function renderLegend(faces: FaceForMap[]): string {
  const { rows, total } = buildLegend(faces)
  if (rows.length === 0) {
    return `<div style="padding:14px;text-align:center;color:#64748B;font-size:11px">No pitch data available.</div>`
  }
  const chips = rows.map(r => {
    const color = pitchToColor(r.pitch_rise)
    const pct = total > 0 ? Math.round((r.sloped_area_ft2 / total) * 1000) / 10 : 0
    const sf = Math.round(r.sloped_area_ft2)
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border:1px solid #E2E8F0;border-radius:8px;background:#fff;min-width:180px;box-shadow:0 1px 2px rgba(0,0,0,0.03)">
        <span style="display:inline-block;width:18px;height:18px;border-radius:4px;background:${color};border:1px solid #1e293b;flex-shrink:0"></span>
        <div style="display:flex;flex-direction:column;line-height:1.2">
          <span style="font-size:14px;font-weight:800;color:#0F172A">${escapeHtml(r.pitch_label)}</span>
          <span style="font-size:10px;color:#475569;font-weight:600">${sf.toLocaleString()} sf · ${pct}%${r.count > 1 ? ` · ${r.count} faces` : ''}</span>
        </div>
      </div>
    `
  }).join('')
  return `
    <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:14px">
      ${chips}
    </div>
  `
}

/** Mountable HTML fragment for the new pitch-map appendix page. Returns the
 *  full page (page-break-before + header + SVG + legend). Drop-in
 *  replacement for renderRoofAnatomyAppendix. */
export function renderPitchAreaMap(report: RoofReport): string {
  const faces = collectFaces(report)
  if (!faces.length) {
    // Skip entirely — no data to show.
    return ''
  }
  const svg = renderPitchMapSVG(faces)
  const legend = renderLegend(faces)

  return `
  <!-- ROOF PITCH MAP APPENDIX -->
  <div style="page-break-before:always;padding:24px 28px;background:#fff;font-family:Inter,system-ui,-apple-system,sans-serif;color:#0f172a">
    <div style="border-bottom:2px solid ${TEAL};padding-bottom:10px;margin-bottom:18px">
      <div style="font-size:18px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.6px">Roof Pitch Map</div>
      <div style="font-size:11px;font-weight:500;color:#64748b;margin-top:2px">Per-face pitch and area breakdown for this property. Face letters cross-reference the Detailed Pitch Breakdown page.</div>
    </div>

    <div style="border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px;background:#fafbfc">
      ${svg}
    </div>

    ${legend}

    <div style="font-size:8.5px;color:#64748b;font-style:italic;line-height:1.5;margin-top:18px">
      Outlines are projected from the traced lat/lng vertices and are scaled to fit the page; relative shape and orientation are preserved but the diagram is not drawn to a fixed real-world scale. Colors group faces by pitch bucket (≤6:12 blue · 7–9:12 green · 10–13:12 amber · ≥14:12 red).
    </div>
  </div>`
}

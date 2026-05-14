// ============================================================
// ROOF ANATOMY APPENDIX — Educational glossary page
// Phase 2 of the page-2 diagram upgrade. This page is appended to the
// end of every full + customer report and shows three static-content
// panels: a numbered layer cross-section, an eave overhang detail, and
// a common-roof-pitches reference card. Content is the same on every
// report — only the highlighted pitch bucket varies (per-report).
//
// All strings live in src/data/roof-anatomy-copy.ts. Renderers are pure
// functions returning SVG / HTML fragments — easy to unit-test.
// ============================================================

import {
  LAYERS,
  EAVE_PARTS,
  COMMON_PITCHES,
  APPENDIX_TITLE,
  APPENDIX_SUBTITLE,
  APPENDIX_DISCLAIMER,
  LAYER_CROSS_SECTION_TITLE,
  LAYER_CROSS_SECTION_SUBTITLE,
  EAVE_OVERHANG_TITLE,
  EAVE_OVERHANG_SUBTITLE,
  EAVE_OVERHANG_RANGE_LABEL,
  COMMON_PITCHES_TITLE,
  COMMON_PITCHES_SUBTITLE,
} from '../data/roof-anatomy-copy'

const TEAL = '#00897B'
const TEAL_DARK = '#00695C'
const FONT = `font-family="Inter,system-ui,-apple-system,sans-serif"`

function escapeHtml(s: string): string {
  return String(s || '').replace(/[&<>"']/g, c =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;'
  )
}

// ───────────────────────── LAYER CROSS-SECTION PANEL ─────────────────────────

/**
 * Exploded view of the six standard roof-assembly layers (shingles ⇒ drywall),
 * stacked vertically and labeled (1)–(6). Pure static SVG — same artwork on
 * every report.
 */
export function renderLayerCrossSection(): string {
  const W = 460
  const H = 360
  const LAYER_COLORS: Record<string, { fill: string; stroke: string }> = {
    Shingles:     { fill: '#1F2937', stroke: '#0F172A' },
    Underlayment: { fill: '#7F1D1D', stroke: '#450A0A' },
    Decking:      { fill: '#D97706', stroke: '#92400E' },
    Framing:      { fill: '#A16207', stroke: '#713F12' },
    Insulation:   { fill: '#FECACA', stroke: '#DC2626' },
    Drywall:      { fill: '#F1F5F9', stroke: '#94A3B8' },
  }
  const layerH = 38
  const yStart = 32
  const xLayer = 22
  const wLayer = 240
  const xLabel = xLayer + wLayer + 22

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">`
  // Faint background
  svg += `<rect width="${W}" height="${H}" fill="#fff" stroke="#e5e7eb" stroke-width="1" rx="4"/>`
  // Top edge "weather" hint
  svg += `<path d="M${xLayer} ${yStart} q12 -10 24 0 q12 -10 24 0 q12 -10 24 0 q12 -10 24 0 q12 -10 24 0 q12 -10 24 0 q12 -10 24 0 q12 -10 24 0 q12 -10 24 0 q12 -10 24 0" stroke="#0F172A" stroke-width="1" fill="none" opacity="0.35"/>`

  LAYERS.forEach((layer, i) => {
    const y = yStart + i * layerH
    const colors = LAYER_COLORS[layer.name] || { fill: '#94A3B8', stroke: '#475569' }
    svg += `<rect x="${xLayer}" y="${y}" width="${wLayer}" height="${layerH - 4}" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="1" rx="2"/>`
    // Numbered badge sitting on the layer's left edge
    const badgeCX = xLayer - 2
    const badgeCY = y + (layerH - 4) / 2
    svg += `<circle cx="${badgeCX}" cy="${badgeCY}" r="9" fill="#fff" stroke="${TEAL_DARK}" stroke-width="1.4"/>`
    svg += `<text x="${badgeCX}" y="${badgeCY + 3.5}" text-anchor="middle" font-size="10" font-weight="800" fill="${TEAL_DARK}" ${FONT}>${layer.number}</text>`
    // Name + blurb to the right
    svg += `<text x="${xLabel}" y="${y + 14}" font-size="11" font-weight="700" fill="#0F172A" ${FONT}>${escapeHtml(layer.name)}</text>`
    svg += `<text x="${xLabel}" y="${y + 26}" font-size="9" font-weight="500" fill="#475569" ${FONT}>${escapeHtml(layer.blurb)}</text>`
  })

  // "INSIDE" arrow at the bottom indicating direction
  const yArrow = yStart + LAYERS.length * layerH + 6
  svg += `<line x1="${xLayer + wLayer / 2}" y1="${yStart - 4}" x2="${xLayer + wLayer / 2}" y2="${yArrow}" stroke="#0F172A" stroke-width="0.6" stroke-dasharray="2,2" opacity="0.4"/>`
  svg += `<text x="${xLayer + wLayer / 2}" y="${yArrow + 10}" text-anchor="middle" font-size="8" font-weight="700" fill="#475569" ${FONT}>EXTERIOR → INTERIOR</text>`

  svg += `</svg>`
  return svg
}

// ───────────────────────── EAVE OVERHANG DETAIL PANEL ─────────────────────────

/**
 * Side-view cross-section of an eave: rafter tail, soffit, fascia, drip edge,
 * gutter. Static SVG — same artwork every report. Includes a "typical
 * overhang 16″–24″" dimension annotation so the reader gets a sense of scale.
 */
export function renderEaveOverhangDetail(): string {
  const W = 460
  const H = 360
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">`
  svg += `<rect width="${W}" height="${H}" fill="#fff" stroke="#e5e7eb" stroke-width="1" rx="4"/>`

  // Building wall (vertical)
  const wallX = 250
  svg += `<rect x="${wallX}" y="100" width="34" height="220" fill="#E5E7EB" stroke="#94A3B8" stroke-width="1"/>`
  svg += `<text x="${wallX + 17}" y="220" text-anchor="middle" font-size="9" font-weight="700" fill="#475569" transform="rotate(-90 ${wallX + 17} 220)" ${FONT}>Wall</text>`

  // Roof slope (rafter going up + out from wall)
  // Rafter top edge (sloped line) and rafter bottom edge.
  // Pitch ~4:12 for readability.
  const rafterTopY1 = 80   // start at top-of-wall
  const rafterTopX1 = wallX
  const rafterTopX2 = 95   // far left (outer end)
  const rafterTopY2 = 145  // dropped down to show slope
  const rafterBotX1 = wallX
  const rafterBotY1 = 110
  const rafterBotX2 = 95
  const rafterBotY2 = 175

  // Decking on top of rafter
  svg += `<polygon points="${rafterTopX1 - 3},${rafterTopY1 - 6} ${rafterTopX2 - 6},${rafterTopY2 - 6} ${rafterTopX2 - 6},${rafterTopY2} ${rafterTopX1 - 3},${rafterTopY1}" fill="#D97706" stroke="#92400E" stroke-width="1"/>`

  // Shingles overlay (slightly thicker)
  svg += `<polygon points="${rafterTopX1 - 3},${rafterTopY1 - 12} ${rafterTopX2 - 6},${rafterTopY2 - 12} ${rafterTopX2 - 6},${rafterTopY2 - 6} ${rafterTopX1 - 3},${rafterTopY1 - 6}" fill="#1F2937" stroke="#0F172A" stroke-width="1"/>`

  // Rafter body
  svg += `<polygon points="${rafterTopX1},${rafterTopY1} ${rafterTopX2},${rafterTopY2} ${rafterBotX2},${rafterBotY2} ${rafterBotX1},${rafterBotY1}" fill="#A16207" stroke="#713F12" stroke-width="1"/>`

  // Soffit (horizontal panel under overhang)
  const soffitY = rafterBotY2 + 4
  svg += `<rect x="${rafterTopX2 + 4}" y="${soffitY}" width="${wallX - rafterTopX2 - 4}" height="6" fill="#E2E8F0" stroke="#94A3B8" stroke-width="0.8"/>`

  // Fascia (vertical board capping the rafter end)
  svg += `<rect x="${rafterTopX2 - 8}" y="${rafterTopY2 - 6}" width="8" height="${soffitY - rafterTopY2 + 14}" fill="#F1F5F9" stroke="#475569" stroke-width="1"/>`

  // Drip edge (small metal angle on top of fascia)
  svg += `<polygon points="${rafterTopX2 - 8},${rafterTopY2 - 12} ${rafterTopX2 - 2},${rafterTopY2 - 12} ${rafterTopX2 - 2},${rafterTopY2 - 4} ${rafterTopX2 - 8},${rafterTopY2 - 4}" fill="#94A3B8" stroke="#475569" stroke-width="0.8"/>`

  // Gutter (U-shape) below drip edge
  const gutY = rafterTopY2 + 2
  svg += `<path d="M${rafterTopX2 - 16} ${gutY} L${rafterTopX2 - 16} ${gutY + 16} Q${rafterTopX2 - 12} ${gutY + 22} ${rafterTopX2 - 4} ${gutY + 16} L${rafterTopX2 - 4} ${gutY}" fill="#CBD5E1" stroke="#475569" stroke-width="1"/>`

  // Leader callouts (anchor + line + pill on the right side of the wall)
  const labelX = wallX + 60
  const pillW = 130
  const pillH = 22
  const drawLabel = (anchorX: number, anchorY: number, labelY: number, name: string, blurb: string) => {
    const lineMidX = wallX + 50
    svg += `<line x1="${anchorX}" y1="${anchorY}" x2="${lineMidX}" y2="${anchorY}" stroke="#64748B" stroke-width="0.8"/>`
    svg += `<line x1="${lineMidX}" y1="${anchorY}" x2="${lineMidX}" y2="${labelY}" stroke="#64748B" stroke-width="0.8"/>`
    svg += `<line x1="${lineMidX}" y1="${labelY}" x2="${labelX - 2}" y2="${labelY}" stroke="#64748B" stroke-width="0.8"/>`
    svg += `<circle cx="${anchorX}" cy="${anchorY}" r="2" fill="${TEAL_DARK}" stroke="#fff" stroke-width="0.8"/>`
    svg += `<g transform="translate(${labelX},${labelY - pillH / 2})">`
    svg += `<rect width="${pillW}" height="${pillH}" rx="3" fill="#fff" stroke="${TEAL_DARK}" stroke-width="1"/>`
    svg += `<text x="8" y="9" font-size="9" font-weight="800" fill="${TEAL_DARK}" ${FONT}>${escapeHtml(name)}</text>`
    svg += `<text x="8" y="18" font-size="7.5" font-weight="500" fill="#475569" ${FONT}>${escapeHtml(blurb)}</text>`
    svg += `</g>`
  }

  drawLabel(rafterTopX1 - 6,  rafterTopY1 - 9,  90,  'Shingles',     'Outer weather barrier')
  drawLabel(rafterBotX1 - 30, rafterBotY1 + 30, 140, 'Rafter tail',  EAVE_PARTS[0].blurb)
  drawLabel(rafterTopX2 + 50, soffitY + 3,      190, 'Soffit',       EAVE_PARTS[1].blurb)
  drawLabel(rafterTopX2 - 4,  rafterTopY2 + 2,  240, 'Fascia',       EAVE_PARTS[2].blurb)
  drawLabel(rafterTopX2 - 5,  rafterTopY2 - 8,  60,  'Drip edge',    EAVE_PARTS[3].blurb)
  drawLabel(rafterTopX2 - 10, gutY + 16,        290, 'Gutter',       EAVE_PARTS[4].blurb)

  // Overhang dimension line (between rafter outer end + wall)
  const dimY = H - 30
  svg += `<line x1="${rafterTopX2 - 8}" y1="${dimY}" x2="${wallX}" y2="${dimY}" stroke="#0F172A" stroke-width="1" marker-start="url(#arrL)" marker-end="url(#arrR)"/>`
  svg += `<defs>
    <marker id="arrL" markerWidth="6" markerHeight="6" refX="0" refY="3" orient="auto"><path d="M6,0 L0,3 L6,6 Z" fill="#0F172A"/></marker>
    <marker id="arrR" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#0F172A"/></marker>
  </defs>`
  const dimCX = (rafterTopX2 - 8 + wallX) / 2
  svg += `<rect x="${dimCX - 70}" y="${dimY - 13}" width="140" height="14" rx="3" fill="#fff" stroke="#0F172A" stroke-width="0.6"/>`
  svg += `<text x="${dimCX}" y="${dimY - 4}" text-anchor="middle" font-size="9" font-weight="700" fill="#0F172A" ${FONT}>${escapeHtml(EAVE_OVERHANG_RANGE_LABEL)}</text>`

  svg += `</svg>`
  return svg
}

// ───────────────────────── COMMON PITCHES CARD ─────────────────────────

/**
 * Reference card showing four standard roof pitches as right-triangle
 * silhouettes. Whichever bucket matches `dominantPitchLabel` (e.g. "6/12")
 * gets a thicker outline + teal fill so the homeowner can see where their
 * roof sits.
 */
export function renderCommonPitchesCard(dominantPitchLabel?: string | null): string {
  const W = 460
  const H = 280
  // Normalize "6:12" / "6/12" / "6 / 12" → "6/12"
  const norm = (s: string | null | undefined): string => {
    if (!s) return ''
    const m = String(s).match(/(\d+(?:\.\d+)?)\s*[:\/]\s*(\d+)/)
    if (!m) return ''
    const rise = parseFloat(m[1])
    // Round to nearest integer so "6.0/12" and "6/12" both map cleanly.
    return `${Math.round(rise)}/${m[2]}`
  }
  const dominant = norm(dominantPitchLabel)

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block">`
  svg += `<rect width="${W}" height="${H}" fill="#fff" stroke="#e5e7eb" stroke-width="1" rx="4"/>`

  const cellW = W / COMMON_PITCHES.length
  const triBaseY = 200
  const triRunPx = 64  // horizontal "run" leg of the triangle in pixels (constant)

  COMMON_PITCHES.forEach((p, i) => {
    const cx = cellW * i + cellW / 2
    // Parse rise/run from the label to compute the triangle's height in pixels.
    const m = p.label.match(/(\d+)\/(\d+)/)
    const rise = m ? parseInt(m[1], 10) : 6
    const run = m ? parseInt(m[2], 10) : 12
    const triHeightPx = triRunPx * (rise / run)
    const isDominant = norm(p.label) === dominant

    // Triangle: bottom-left at (cx - triRunPx/2, triBaseY), bottom-right
    // at (cx + triRunPx/2, triBaseY), top at bottom-left vertex lifted by
    // triHeightPx. Reads as a right-triangle slope.
    const x0 = cx - triRunPx / 2
    const x1 = cx + triRunPx / 2
    const y0 = triBaseY
    const yTop = triBaseY - triHeightPx
    const points = `${x0},${y0} ${x1},${y0} ${x0},${yTop}`
    svg += `<polygon points="${points}" fill="${isDominant ? TEAL : '#F1F5F9'}" stroke="${isDominant ? TEAL_DARK : '#94A3B8'}" stroke-width="${isDominant ? 2.5 : 1.2}" stroke-linejoin="round" opacity="${isDominant ? 0.92 : 0.95}"/>`

    // Rise + Run labels
    svg += `<text x="${x0 - 4}" y="${yTop + triHeightPx / 2 + 3}" text-anchor="end" font-size="8" font-weight="700" fill="#475569" ${FONT}>${rise}″</text>`
    svg += `<text x="${cx}" y="${y0 + 12}" text-anchor="middle" font-size="8" font-weight="700" fill="#475569" ${FONT}>${run}″ run</text>`

    // Pitch label below
    svg += `<text x="${cx}" y="${y0 + 32}" text-anchor="middle" font-size="14" font-weight="800" fill="${isDominant ? TEAL_DARK : '#0F172A'}" ${FONT}>${p.label}</text>`
    svg += `<text x="${cx}" y="${y0 + 46}" text-anchor="middle" font-size="8" font-weight="600" fill="#64748B" ${FONT}>${escapeHtml(p.degrees)} · ${escapeHtml(p.description)}</text>`

    // "Your roof" badge for the matched bucket
    if (isDominant) {
      svg += `<rect x="${cx - 28}" y="${y0 + 56}" width="56" height="14" rx="7" fill="${TEAL_DARK}"/>`
      svg += `<text x="${cx}" y="${y0 + 66}" text-anchor="middle" font-size="8" font-weight="800" fill="#fff" ${FONT}>YOUR ROOF</text>`
    }
  })

  svg += `</svg>`
  return svg
}

// ───────────────────────── FULL APPENDIX PAGE ─────────────────────────

/**
 * Mountable HTML fragment for the roof-anatomy appendix page. Caller
 * (report-html.ts / customer-report-html.ts) inserts this verbatim where
 * the new page should appear.
 */
export function renderRoofAnatomyAppendix(opts: {
  dominantPitchLabel?: string | null
} = {}): string {
  const layerSvg = renderLayerCrossSection()
  const eaveSvg = renderEaveOverhangDetail()
  const pitchesSvg = renderCommonPitchesCard(opts.dominantPitchLabel)

  return `
  <!-- ROOF ANATOMY APPENDIX — Phase 2 educational glossary page -->
  <div style="page-break-before:always;padding:24px 28px;background:#fff;font-family:Inter,system-ui,-apple-system,sans-serif;color:#0f172a">
    <div style="border-bottom:2px solid ${TEAL};padding-bottom:10px;margin-bottom:18px">
      <div style="font-size:18px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.6px">${escapeHtml(APPENDIX_TITLE)}</div>
      <div style="font-size:11px;font-weight:500;color:#64748b;margin-top:2px">${escapeHtml(APPENDIX_SUBTITLE)}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:18px">
      <div style="border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px;background:#fafbfc">
        <div style="font-size:9.5px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">${escapeHtml(LAYER_CROSS_SECTION_TITLE)}</div>
        <div style="font-size:8.5px;font-weight:500;color:#64748b;margin-bottom:8px">${escapeHtml(LAYER_CROSS_SECTION_SUBTITLE)}</div>
        ${layerSvg}
      </div>
      <div style="border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px;background:#fafbfc">
        <div style="font-size:9.5px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">${escapeHtml(EAVE_OVERHANG_TITLE)}</div>
        <div style="font-size:8.5px;font-weight:500;color:#64748b;margin-bottom:8px">${escapeHtml(EAVE_OVERHANG_SUBTITLE)}</div>
        ${eaveSvg}
      </div>
    </div>

    <div style="border:1px solid #e2e8f0;border-radius:6px;padding:10px 12px;background:#fafbfc;margin-bottom:18px">
      <div style="font-size:9.5px;font-weight:800;color:${TEAL_DARK};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">${escapeHtml(COMMON_PITCHES_TITLE)}</div>
      <div style="font-size:8.5px;font-weight:500;color:#64748b;margin-bottom:8px">${escapeHtml(COMMON_PITCHES_SUBTITLE)}</div>
      ${pitchesSvg}
    </div>

    <div style="font-size:8.5px;color:#64748b;font-style:italic;line-height:1.5">
      ${escapeHtml(APPENDIX_DISCLAIMER)}
    </div>
  </div>`
}

// ============================================================
// Grid Overlay — Set-of-Marks-style numbered grid as a transparent PNG
// ============================================================
// Renders a transparent overlay image the SAME size as the satellite
// tile, with a 16×16 grid of red lines + alphanumeric labels (A-P
// columns, 1-16 rows) at every cell centre. Claude sees this as a
// SEPARATE image; the prompt tells it the grid is a coordinate
// reference for Image 1, NOT a feature to trace.
//
// Yang et al. 2023 (arxiv 2310.11441, Set-of-Mark Prompting) showed
// that visible cell labels measurably improve vision-LLM coordinate
// accuracy on spatial tasks. We can't blend the grid INTO Image 1
// (Workers has a PNG encoder via CompressionStream but no decoder),
// so we ship it as a parallel image and the prompt aligns them
// mentally.
//
// Pure-JS PNG encoder mirrors dsm-visualization.ts so we don't add
// any new wasm dependencies. The font is a hand-baked 5x7 bitmap
// (digits 0-9 + letters A-P only — that's all we label).
// ============================================================

export interface GridOverlayResult {
  b64: string
  mediaType: 'image/png'
  width: number
  height: number
  cols: number
  rows: number
}

/** Render a transparent grid overlay PNG. Default 16×16 grid, columns
 *  labeled A..P, rows labeled 1..16. Grid lines drawn at every cell
 *  boundary in semi-transparent red; labels at cell centres in opaque red. */
export async function renderGridOverlay(
  width: number,
  height: number,
  cols = 16,
  rows = 16,
): Promise<GridOverlayResult> {
  // Fully-transparent RGBA buffer to start.
  const rgba = new Uint8ClampedArray(width * height * 4)

  const cellW = width / cols
  const cellH = height / rows

  // 1. Grid lines — semi-transparent red, 2px thick at every boundary.
  const LINE_R = 220, LINE_G = 38, LINE_B = 38, LINE_A = 140
  for (let c = 0; c <= cols; c++) {
    const x0 = Math.round(c * cellW)
    for (let y = 0; y < height; y++) {
      paintPx(rgba, x0,     y, width, height, LINE_R, LINE_G, LINE_B, LINE_A)
      paintPx(rgba, x0 + 1, y, width, height, LINE_R, LINE_G, LINE_B, LINE_A)
    }
  }
  for (let r = 0; r <= rows; r++) {
    const y0 = Math.round(r * cellH)
    for (let x = 0; x < width; x++) {
      paintPx(rgba, x, y0,     width, height, LINE_R, LINE_G, LINE_B, LINE_A)
      paintPx(rgba, x, y0 + 1, width, height, LINE_R, LINE_G, LINE_B, LINE_A)
    }
  }

  // 2. Cell labels — opaque red, 5x7 font upscaled to fit ~30% of the
  //    cell width. At 1280px / 16 cols = 80px cells → 24px-tall labels.
  const labelScale = Math.max(2, Math.floor(Math.min(cellW, cellH) / 16))
  const charW = 5 * labelScale
  const charH = 7 * labelScale
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const label = `${columnChar(c)}${r + 1}`
      // Centre the full label inside the cell.
      const labelW = (charW + labelScale) * label.length - labelScale
      const x0 = Math.round(c * cellW + cellW / 2 - labelW / 2)
      const y0 = Math.round(r * cellH + cellH / 2 - charH / 2)
      drawString(rgba, label, x0, y0, labelScale, width, height, 235, 50, 50, 245)
    }
  }

  // 3. Encode as PNG (reuses the same CompressionStream-based encoder
  //    pattern as dsm-visualization.ts — kept inline to avoid coupling).
  const pngBytes = await encodePNG(rgba, width, height)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < pngBytes.length; i += chunk) {
    bin += String.fromCharCode(...pngBytes.subarray(i, Math.min(i + chunk, pngBytes.length)))
  }
  return { b64: btoa(bin), mediaType: 'image/png', width, height, cols, rows }
}

function columnChar(idx: number): string {
  return String.fromCharCode(65 + idx)  // 0->A, 25->Z
}

function paintPx(buf: Uint8ClampedArray, x: number, y: number, w: number, h: number, r: number, g: number, b: number, a: number): void {
  if (x < 0 || x >= w || y < 0 || y >= h) return
  const i = (y * w + x) * 4
  // Alpha-aware composite — labels overlay gridlines cleanly.
  const dstA = buf[i + 3] / 255
  const srcA = a / 255
  const outA = srcA + dstA * (1 - srcA)
  if (outA <= 0) return
  buf[i + 0] = Math.round((r * srcA + buf[i + 0] * dstA * (1 - srcA)) / outA)
  buf[i + 1] = Math.round((g * srcA + buf[i + 1] * dstA * (1 - srcA)) / outA)
  buf[i + 2] = Math.round((b * srcA + buf[i + 2] * dstA * (1 - srcA)) / outA)
  buf[i + 3] = Math.round(outA * 255)
}

// ─────────────────────────────────────────────────────────────
// 5x7 hand-baked bitmap font — only the characters we actually use
// (digits 0-9 + uppercase A-P). Each glyph is 7 rows × 5 bits, stored
// as 7 bytes (low 5 bits of each). Bit 4 = leftmost pixel.
// ─────────────────────────────────────────────────────────────
const FONT_5x7: Record<string, readonly number[]> = {
  '0': [0x0E, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0E],
  '1': [0x04, 0x0C, 0x04, 0x04, 0x04, 0x04, 0x0E],
  '2': [0x0E, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1F],
  '3': [0x1F, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0E],
  '4': [0x02, 0x06, 0x0A, 0x12, 0x1F, 0x02, 0x02],
  '5': [0x1F, 0x10, 0x1E, 0x01, 0x01, 0x11, 0x0E],
  '6': [0x06, 0x08, 0x10, 0x1E, 0x11, 0x11, 0x0E],
  '7': [0x1F, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0E, 0x11, 0x11, 0x0E, 0x11, 0x11, 0x0E],
  '9': [0x0E, 0x11, 0x11, 0x0F, 0x01, 0x02, 0x0C],
  A:   [0x0E, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
  B:   [0x1E, 0x11, 0x11, 0x1E, 0x11, 0x11, 0x1E],
  C:   [0x0E, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0E],
  D:   [0x1C, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1C],
  E:   [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x1F],
  F:   [0x1F, 0x10, 0x10, 0x1E, 0x10, 0x10, 0x10],
  G:   [0x0E, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0E],
  H:   [0x11, 0x11, 0x11, 0x1F, 0x11, 0x11, 0x11],
  I:   [0x0E, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0E],
  J:   [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0C],
  K:   [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L:   [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1F],
  M:   [0x11, 0x1B, 0x15, 0x15, 0x11, 0x11, 0x11],
  N:   [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
  O:   [0x0E, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0E],
  P:   [0x1E, 0x11, 0x11, 0x1E, 0x10, 0x10, 0x10],
}

function drawString(buf: Uint8ClampedArray, str: string, x: number, y: number, scale: number, w: number, h: number, r: number, g: number, b: number, a: number): void {
  let xCursor = x
  for (const ch of str) {
    drawChar(buf, ch, xCursor, y, scale, w, h, r, g, b, a)
    xCursor += 5 * scale + scale  // 1-px (scaled) gap between chars
  }
}

function drawChar(buf: Uint8ClampedArray, ch: string, x: number, y: number, scale: number, w: number, h: number, r: number, g: number, b: number, a: number): void {
  const glyph = FONT_5x7[ch.toUpperCase()]
  if (!glyph) return
  for (let row = 0; row < 7; row++) {
    const bits = glyph[row]
    for (let col = 0; col < 5; col++) {
      if (bits & (1 << (4 - col))) {
        // Paint a scale×scale block per glyph pixel.
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            paintPx(buf, x + col * scale + dx, y + row * scale + dy, w, h, r, g, b, a)
          }
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// PNG encoder (mirrors dsm-visualization.ts — kept inline for isolation)
// ─────────────────────────────────────────────────────────────
async function encodePNG(rgba: Uint8ClampedArray, w: number, h: number): Promise<Uint8Array> {
  const raw = new Uint8Array((w * 4 + 1) * h)
  let p = 0
  for (let y = 0; y < h; y++) {
    raw[p++] = 0
    const rowStart = y * w * 4
    raw.set(rgba.subarray(rowStart, rowStart + w * 4), p)
    p += w * 4
  }
  const cs = new CompressionStream('deflate')
  const writer = cs.writable.getWriter()
  writer.write(raw)
  writer.close()
  const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer())

  const signature = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
  const ihdrData = new Uint8Array(13)
  const ihdrView = new DataView(ihdrData.buffer)
  ihdrView.setUint32(0, w)
  ihdrView.setUint32(4, h)
  ihdrData[8] = 8; ihdrData[9] = 6; ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0
  const ihdrChunk = makeChunk('IHDR', ihdrData)
  const idatChunk = makeChunk('IDAT', compressed)
  const iendChunk = makeChunk('IEND', new Uint8Array(0))
  const total = signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  const out = new Uint8Array(total)
  let off = 0
  out.set(signature, off); off += signature.length
  out.set(ihdrChunk, off); off += ihdrChunk.length
  out.set(idatChunk, off); off += idatChunk.length
  out.set(iendChunk, off)
  return out
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, data.length)
  chunk[4] = type.charCodeAt(0); chunk[5] = type.charCodeAt(1)
  chunk[6] = type.charCodeAt(2); chunk[7] = type.charCodeAt(3)
  chunk.set(data, 8)
  const crcInput = new Uint8Array(4 + data.length)
  crcInput.set(chunk.subarray(4, 8), 0)
  crcInput.set(data, 4)
  view.setUint32(8 + data.length, crc32(crcInput))
  return chunk
}

const CRC32_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[i]) & 0xFF]
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

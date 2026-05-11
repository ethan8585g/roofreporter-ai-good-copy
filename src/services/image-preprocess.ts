// ============================================================
// Image Preprocess — pure-JS PNG codec + Lanczos resample + VARI tint
// ============================================================
// Three preprocessing passes the auto-trace agent can apply to the
// satellite tile before sending it to Claude:
//
//   1. decodePNG / encodePNG — round-trip PNG ↔ RGBA so we can mutate
//      pixels in pure JS. Cloudflare Workers ships CompressionStream +
//      DecompressionStream but no image codecs; this is the gap.
//   2. lanczosResize — Lanczos-3 resample to Claude's actual ceiling
//      (1568px longest edge per Anthropic's vision docs). Static Maps
//      caps at 640×640 scale=2 = 1280×1280; without an upscale we leave
//      18-22% of the model's input resolution on the table.
//   3. applyVARITint — Visible Atmospherically Resistant Index =
//      (G − R) / (G + R − B). Gitelson 2002 showed VARI correlates 0.7-
//      0.9 with NDVI for green canopy. Pixels above the threshold get
//      a translucent magenta tint so Claude sees "trees are pink,
//      ignore them" without losing the underlying roof signal.
//
// All three are best-effort: any failure falls through with the
// original tile unchanged. PNG-only (Google Static Maps default);
// JPEG inputs would need a separate codec.
// ============================================================

export interface RgbaImage {
  rgba: Uint8ClampedArray
  width: number
  height: number
}

// ─────────────────────────────────────────────────────────────
// PNG decode — handles color types 0, 2, 3, 4, 6 at 8-bit depth.
// 16-bit depth not implemented (Static Maps tiles are 8-bit).
// Interlaced PNGs not implemented (Static Maps doesn't emit them).
// ─────────────────────────────────────────────────────────────
export async function decodePNG(bytes: Uint8Array): Promise<RgbaImage> {
  // Signature check: 89 50 4E 47 0D 0A 1A 0A
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 ||
      bytes[2] !== 0x4E || bytes[3] !== 0x47) {
    throw new Error('Not a PNG (signature mismatch)')
  }
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0
  let palette: Uint8Array | null = null
  let trns: Uint8Array | null = null
  const idatChunks: Uint8Array[] = []
  let pos = 8
  while (pos + 12 <= bytes.length) {
    const len = (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7])
    const data = bytes.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]
      height = (data[4] << 24) | (data[5] << 16) | (data[6] << 8) | data[7]
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'PLTE') {
      palette = new Uint8Array(data)
    } else if (type === 'tRNS') {
      trns = new Uint8Array(data)
    } else if (type === 'IDAT') {
      idatChunks.push(data)
    } else if (type === 'IEND') {
      break
    }
    pos += 12 + len
  }
  if (width === 0 || height === 0) throw new Error('PNG: missing IHDR')
  if (bitDepth !== 8) throw new Error(`PNG: only 8-bit depth supported, got ${bitDepth}`)
  if (interlace !== 0) throw new Error('PNG: interlaced not supported')

  // Concatenate IDATs and inflate (PNG uses zlib-wrapped deflate, so
  // 'deflate' is the right format — NOT 'deflate-raw').
  const idatLen = idatChunks.reduce((s, c) => s + c.length, 0)
  const compressed = new Uint8Array(idatLen)
  let off = 0
  for (const c of idatChunks) { compressed.set(c, off); off += c.length }

  const ds = new DecompressionStream('deflate')
  const writer = ds.writable.getWriter()
  writer.write(compressed)
  writer.close()
  const filtered = new Uint8Array(await new Response(ds.readable).arrayBuffer())

  // Bytes per pixel for each color type at 8-bit depth.
  // 0 = greyscale (1), 2 = RGB (3), 3 = palette (1), 4 = grey+alpha (2), 6 = RGBA (4)
  const bpp = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4
  const stride = width * bpp
  const raw = new Uint8Array(stride * height)
  let fIdx = 0
  for (let y = 0; y < height; y++) {
    const filter = filtered[fIdx++]
    const rowStart = y * stride
    for (let x = 0; x < stride; x++) {
      const cur = filtered[fIdx++]
      const left = x >= bpp ? raw[rowStart + x - bpp] : 0
      const up = y > 0 ? raw[rowStart - stride + x] : 0
      const upLeft = (x >= bpp && y > 0) ? raw[rowStart - stride + x - bpp] : 0
      let pred = 0
      switch (filter) {
        case 0: pred = 0; break
        case 1: pred = left; break
        case 2: pred = up; break
        case 3: pred = (left + up) >> 1; break
        case 4: {
          const p = left + up - upLeft
          const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft)
          pred = pa <= pb && pa <= pc ? left : (pb <= pc ? up : upLeft)
          break
        }
        default: throw new Error(`PNG: unknown filter type ${filter}`)
      }
      raw[rowStart + x] = (cur + pred) & 0xFF
    }
  }

  // Expand to RGBA.
  const rgba = new Uint8ClampedArray(width * height * 4)
  if (colorType === 6) {
    rgba.set(raw)
  } else if (colorType === 2) {
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = raw[i * 3]; rgba[i * 4 + 1] = raw[i * 3 + 1]
      rgba[i * 4 + 2] = raw[i * 3 + 2]; rgba[i * 4 + 3] = 255
    }
  } else if (colorType === 0) {
    for (let i = 0; i < width * height; i++) {
      const v = raw[i]
      rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255
    }
  } else if (colorType === 4) {
    for (let i = 0; i < width * height; i++) {
      const v = raw[i * 2], a = raw[i * 2 + 1]
      rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = a
    }
  } else if (colorType === 3) {
    if (!palette) throw new Error('PNG: palette color type but no PLTE')
    for (let i = 0; i < width * height; i++) {
      const idx = raw[i]
      rgba[i * 4] = palette[idx * 3]
      rgba[i * 4 + 1] = palette[idx * 3 + 1]
      rgba[i * 4 + 2] = palette[idx * 3 + 2]
      rgba[i * 4 + 3] = trns && idx < trns.length ? trns[idx] : 255
    }
  } else {
    throw new Error(`PNG: unsupported color type ${colorType}`)
  }
  return { rgba, width, height }
}

// ─────────────────────────────────────────────────────────────
// PNG encode — RGBA → 8-bit color-type-6 PNG. Mirrors the encoder
// in dsm-visualization.ts and grid-overlay.ts; kept here so this
// module is self-contained and reusable.
// ─────────────────────────────────────────────────────────────
export async function encodePNG(img: RgbaImage): Promise<Uint8Array> {
  const { rgba, width: w, height: h } = img
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
  ihdrView.setUint32(0, w); ihdrView.setUint32(4, h)
  ihdrData[8] = 8; ihdrData[9] = 6; ihdrData[10] = 0; ihdrData[11] = 0; ihdrData[12] = 0
  const ihdr = makeChunk('IHDR', ihdrData)
  const idat = makeChunk('IDAT', compressed)
  const iend = makeChunk('IEND', new Uint8Array(0))
  const total = signature.length + ihdr.length + idat.length + iend.length
  const out = new Uint8Array(total)
  let off = 0
  out.set(signature, off); off += signature.length
  out.set(ihdr, off); off += ihdr.length
  out.set(idat, off); off += idat.length
  out.set(iend, off)
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

// ─────────────────────────────────────────────────────────────
// Lanczos-3 resample
// ─────────────────────────────────────────────────────────────
// Quality: better than bilinear for upscales (preserves edge sharpness).
// CPU: ~6× kernel × 6× kernel = 36 multiplies per output pixel per channel.
// For 1280 → 1568 (RGBA) that's ~88M multiplies — well under Workers'
// CPU budget for paid plans, but skip on tight free-tier budgets via
// the `gated` flag at the call site.
//
// Two-pass separable implementation (rows first, then columns) so the
// memory footprint is one intermediate buffer at (dstW × srcH × 4).
export function lanczosResize(img: RgbaImage, dstW: number, dstH: number): RgbaImage {
  if (dstW === img.width && dstH === img.height) return img
  const a = 3  // Lanczos kernel radius
  const lanczos = (x: number): number => {
    if (x === 0) return 1
    if (x <= -a || x >= a) return 0
    const px = Math.PI * x
    return (a * Math.sin(px) * Math.sin(px / a)) / (px * px)
  }
  const horiz = resampleAxis(img.rgba, img.width, img.height, dstW, true, a, lanczos)
  const final = resampleAxis(horiz, dstW, img.height, dstH, false, a, lanczos)
  return { rgba: final, width: dstW, height: dstH }
}

function resampleAxis(
  src: Uint8ClampedArray,
  srcW: number, srcH: number,
  newDim: number,
  horizontal: boolean,
  a: number,
  kernel: (x: number) => number,
): Uint8ClampedArray {
  const dstW = horizontal ? newDim : srcW
  const dstH = horizontal ? srcH : newDim
  const out = new Uint8ClampedArray(dstW * dstH * 4)
  const srcDim = horizontal ? srcW : srcH
  const scale = srcDim / newDim
  const support = scale > 1 ? a * scale : a  // wider kernel on downscale
  const filterScale = scale > 1 ? 1 / scale : 1

  for (let d = 0; d < newDim; d++) {
    const center = (d + 0.5) * scale - 0.5
    const start = Math.max(0, Math.floor(center - support))
    const end = Math.min(srcDim - 1, Math.ceil(center + support))
    let totalWeight = 0
    const weights: number[] = []
    for (let s = start; s <= end; s++) {
      const w = kernel((s - center) * filterScale)
      weights.push(w)
      totalWeight += w
    }
    if (totalWeight === 0) { weights.fill(0); weights[0] = 1; totalWeight = 1 }
    // Normalize.
    for (let i = 0; i < weights.length; i++) weights[i] /= totalWeight

    if (horizontal) {
      for (let y = 0; y < srcH; y++) {
        let r = 0, g = 0, b = 0, alpha = 0
        for (let i = 0, s = start; s <= end; s++, i++) {
          const idx = (y * srcW + s) * 4
          const w = weights[i]
          r += src[idx] * w
          g += src[idx + 1] * w
          b += src[idx + 2] * w
          alpha += src[idx + 3] * w
        }
        const oIdx = (y * dstW + d) * 4
        out[oIdx] = Math.max(0, Math.min(255, Math.round(r)))
        out[oIdx + 1] = Math.max(0, Math.min(255, Math.round(g)))
        out[oIdx + 2] = Math.max(0, Math.min(255, Math.round(b)))
        out[oIdx + 3] = Math.max(0, Math.min(255, Math.round(alpha)))
      }
    } else {
      for (let x = 0; x < srcW; x++) {
        let r = 0, g = 0, b = 0, alpha = 0
        for (let i = 0, s = start; s <= end; s++, i++) {
          const idx = (s * srcW + x) * 4
          const w = weights[i]
          r += src[idx] * w
          g += src[idx + 1] * w
          b += src[idx + 2] * w
          alpha += src[idx + 3] * w
        }
        const oIdx = (d * dstW + x) * 4
        out[oIdx] = Math.max(0, Math.min(255, Math.round(r)))
        out[oIdx + 1] = Math.max(0, Math.min(255, Math.round(g)))
        out[oIdx + 2] = Math.max(0, Math.min(255, Math.round(b)))
        out[oIdx + 3] = Math.max(0, Math.min(255, Math.round(alpha)))
      }
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────
// VARI vegetation tint
// ─────────────────────────────────────────────────────────────
// Visible Atmospherically Resistant Index = (G − R) / (G + R − B).
// Gitelson 2002 showed 0.7-0.9 correlation with NDVI for green canopy.
// Pixels above the threshold get blended with magenta (R=255, B=255)
// so trees become visually obvious "ignore the pink" zones without
// destroying the underlying texture (we mix at 50% so the roof
// outline can still be read through the canopy where it bleeds).
//
// Tested thresholds: 0.05 catches most green deciduous canopy in
// summer Edmonton imagery. Higher misses dry-leaf cases; lower
// flags grass + tinted shadows. 0.05 is the published sweet spot.
export function applyVARITint(
  img: RgbaImage,
  options: { threshold?: number; blendStrength?: number } = {},
): { tinted: RgbaImage; vegetationPct: number } {
  const threshold = options.threshold ?? 0.05
  const blend = Math.max(0, Math.min(1, options.blendStrength ?? 0.5))
  const out = new Uint8ClampedArray(img.rgba.length)
  let vegCount = 0
  const total = img.width * img.height
  for (let i = 0; i < total; i++) {
    const r = img.rgba[i * 4]
    const g = img.rgba[i * 4 + 1]
    const b = img.rgba[i * 4 + 2]
    const denom = g + r - b
    const vari = denom !== 0 ? (g - r) / denom : 0
    if (vari > threshold) {
      vegCount++
      // Magenta = (255, 0, 255). Mix at `blend`.
      out[i * 4]     = Math.round(r * (1 - blend) + 255 * blend)
      out[i * 4 + 1] = Math.round(g * (1 - blend) + 0   * blend)
      out[i * 4 + 2] = Math.round(b * (1 - blend) + 255 * blend)
      out[i * 4 + 3] = 255
    } else {
      out[i * 4]     = r
      out[i * 4 + 1] = g
      out[i * 4 + 2] = b
      out[i * 4 + 3] = 255
    }
  }
  return {
    tinted: { rgba: out, width: img.width, height: img.height },
    vegetationPct: Math.round((vegCount / total) * 1000) / 10,  // one decimal
  }
}

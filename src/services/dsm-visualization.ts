// ============================================================
// DSM Visualization — render a Google Solar DataLayers DSM as a
// hillshade PNG that Claude can read alongside the satellite image
// ============================================================
// The Solar API returns DSM (Digital Surface Model) elevation data as a
// GeoTIFF: one float per pixel = height above sea level at 0.5m/pixel
// (HIGH quality). That payload is invisible to a vision LLM as-is.
//
// This service turns the DSM into a *hillshade*: a synthetic shaded-relief
// image that highlights the same features a roof-tracing agent cares
// about — ridges, valleys, hips, and the eave drop to ground level. We
// render it as a small PNG (the SAME width/height as the satellite
// image so Claude can correspond pixels 1:1) and return base64+mime
// ready to drop into the messages.create call.
//
// The DSM also includes ground level + trees, so we add an "above-ground"
// height-tint pass that biases the visualization toward roof structures.
//
// PNG encoding is pure JS — Cloudflare Workers don't ship an image
// library, but they DO support CompressionStream('deflate') which is all
// we need for PNG's IDAT chunk. CRC32 uses a fixed 256-entry table.
// ============================================================

import * as geotiff from 'geotiff'
import type { Bindings } from '../types'

const SOLAR_DATALAYERS_URL = 'https://solar.googleapis.com/v1/dataLayers:get'

export interface DsmHillshadeResult {
  /** Base64-encoded PNG, ready for Claude's `image.source.data`. */
  b64: string
  mediaType: 'image/png'
  /** Image dimensions returned to the caller for prompt context. */
  width: number
  height: number
  /** Imagery date so we can warn Claude if the DSM is stale. */
  imageryDate?: string
  /** Solar API quality tier so the caller can decide how much to trust the result. */
  quality?: 'HIGH' | 'MEDIUM' | 'BASE'
}

/**
 * Fetch a DSM from the Solar API and render it as a hillshade PNG.
 * Returns null when Solar coverage is unavailable (most rural lots) —
 * callers should silently fall back to the satellite image alone.
 *
 * @param targetSizePx Desired output square size. We resample the
 *   raster up or down to this to match Claude's satellite image — the
 *   model can only correlate features when both images share resolution.
 */
export async function fetchDsmHillshade(
  env: Bindings,
  lat: number,
  lng: number,
  targetSizePx: number = 1280,
  radiusMeters: number = 50,
): Promise<DsmHillshadeResult | null> {
  if (!env.GOOGLE_SOLAR_API_KEY) return null
  try {
    // 1. Find DSM URL
    const params = new URLSearchParams({
      'location.latitude': lat.toFixed(6),
      'location.longitude': lng.toFixed(6),
      radiusMeters: String(radiusMeters),
      view: 'DSM_LAYER',
      requiredQuality: 'HIGH',
      pixelSizeMeters: '0.5',
      key: env.GOOGLE_SOLAR_API_KEY,
    })
    const resp = await fetch(`${SOLAR_DATALAYERS_URL}?${params}`)
    if (!resp.ok) {
      // 404 = no Solar coverage. Don't surface as an error.
      return null
    }
    const meta = await resp.json() as { dsmUrl?: string; imageryDate?: any; imageryQuality?: 'HIGH' | 'MEDIUM' | 'BASE' }
    if (!meta?.dsmUrl) return null

    // 2. Download + parse DSM GeoTIFF
    const dsmResp = await fetch(`${meta.dsmUrl}&key=${env.GOOGLE_SOLAR_API_KEY}`)
    if (!dsmResp.ok) return null
    const buf = await dsmResp.arrayBuffer()
    const tiff = await geotiff.fromArrayBuffer(buf)
    const image = await tiff.getImage()
    const rasters = await image.readRasters()
    const dsmRaw = rasters[0] as any  // Float32Array typically
    const w = image.getWidth()
    const h = image.getHeight()
    if (!dsmRaw || dsmRaw.length === 0) return null

    // 3. Normalize: clip to (ground..ground+30m) then map to 0..1
    const validValues: number[] = []
    for (let i = 0; i < dsmRaw.length; i++) {
      const v = Number(dsmRaw[i])
      if (Number.isFinite(v) && v > -1000) validValues.push(v)
    }
    if (validValues.length === 0) return null
    validValues.sort((a, b) => a - b)
    // 5th percentile = "ground" — robust against single low pixels.
    const groundLevel = validValues[Math.floor(validValues.length * 0.05)]
    // Cap at ground + 30m so a wide-shot satellite + tall structure
    // doesn't compress the residential range to ~5% of the gradient.
    const ceiling = groundLevel + 30

    const heights = new Float32Array(w * h)
    for (let i = 0; i < dsmRaw.length; i++) {
      const v = Number(dsmRaw[i])
      heights[i] = Number.isFinite(v) ? Math.max(groundLevel, Math.min(ceiling, v)) : groundLevel
    }

    // 4. Multi-azimuth hillshade composite. A single NW sun (the prior
    //    behaviour) shadows any ridge running NW-SE. Render from 4 cardinal
    //    diagonals and take the per-pixel max — eliminates the directional
    //    blind spot. Cost: 4× the hillshade math (still microseconds).
    const hillshadeNW = computeHillshade(heights, w, h, 315)
    const hillshadeNE = computeHillshade(heights, w, h, 45)
    const hillshadeSE = computeHillshade(heights, w, h, 135)
    const hillshadeSW = computeHillshade(heights, w, h, 225)
    const hillshadeComposite = new Uint8ClampedArray(w * h)
    for (let i = 0; i < hillshadeComposite.length; i++) {
      hillshadeComposite[i] = Math.max(hillshadeNW[i], hillshadeNE[i], hillshadeSE[i], hillshadeSW[i])
    }
    // 5. Sobel edges on the height field. Ridges and hips become SHARP green
    //    lines; valleys (concave) and eaves (vertical drop) also pop. Stored
    //    in the G channel so the model gets 3 independent signals from one
    //    image rather than three separate uploads.
    const sobelEdges = computeSobelEdges(heights, w, h)
    // 6. Pack channels: R = multi-az hillshade, G = Sobel edges, B = above-
    //    ground height (warmer = higher).
    const tinted = packRGBChannels(hillshadeComposite, sobelEdges, heights, w, h, groundLevel, ceiling)

    // 6. Resample to targetSizePx square
    const rgba = resampleRGBA(tinted, w, h, targetSizePx, targetSizePx)

    // 7. Encode PNG
    const pngBytes = await encodePNG(rgba, targetSizePx, targetSizePx)
    let bin = ''
    const chunk = 0x8000
    for (let i = 0; i < pngBytes.length; i += chunk) {
      bin += String.fromCharCode(...pngBytes.subarray(i, Math.min(i + chunk, pngBytes.length)))
    }
    return {
      b64: btoa(bin),
      mediaType: 'image/png',
      width: targetSizePx,
      height: targetSizePx,
      imageryDate: meta?.imageryDate ? formatImageryDate(meta.imageryDate) : undefined,
      quality: meta?.imageryQuality,
    }
  } catch (e: any) {
    // Any failure (geotiff parse error, network, OOM) is non-fatal —
    // the agent still runs on the satellite image alone.
    console.warn('[dsm-visualization] failed:', e?.message)
    return null
  }
}

function formatImageryDate(d: any): string | undefined {
  try {
    if (d?.year && d?.month && d?.day) return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`
  } catch {}
  return undefined
}

// ─────────────────────────────────────────────────────────────
// Hillshade — illumination dot product, parameterized azimuth
// ─────────────────────────────────────────────────────────────
function computeHillshade(heights: Float32Array, w: number, h: number, azimuthDeg = 315): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h)
  // Sun position: caller-supplied azimuth, altitude fixed at 45°.
  // Light vector in x/y/z where +x is east, +y is north, +z is up.
  const az = (azimuthDeg * Math.PI) / 180
  const alt = (45 * Math.PI) / 180
  const lx = Math.cos(alt) * Math.sin(az)
  const ly = Math.cos(alt) * Math.cos(az)
  const lz = Math.sin(alt)
  // Slope exaggeration — DSM is 0.5m/pixel but roof features are
  // 0–5m above ground, so without vertical exaggeration the hillshade
  // is washed out. 4× makes ridges + hips visually pop.
  const zScale = 4.0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x
      // Gradient via central difference
      const dzdx = (heights[idx + 1] - heights[idx - 1]) * 0.5 * zScale
      const dzdy = (heights[idx + w] - heights[idx - w]) * 0.5 * zScale
      // Surface normal = (-dzdx, -dzdy, 1) normalized
      const nLen = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1)
      const nx = -dzdx / nLen
      const ny = -dzdy / nLen
      const nz = 1 / nLen
      const dot = Math.max(0, nx * lx + ny * ly + nz * lz)
      out[idx] = Math.round(dot * 255)
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────
// Sobel edge magnitude on the height field
// ─────────────────────────────────────────────────────────────
// Sobel kernels detect first-derivative edges — exactly the signal
// roof ridges, hips, valleys, and eave drops emit on a DSM. Output
// is scaled to 0..255 by p98 normalization so a single tall tree
// doesn't compress all the roof edges to ~0.
function computeSobelEdges(heights: Float32Array, w: number, h: number): Uint8ClampedArray {
  const mag = new Float32Array(w * h)
  let maxMag = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x
      const tl = heights[idx - w - 1], t = heights[idx - w], tr = heights[idx - w + 1]
      const l  = heights[idx - 1],                          r  = heights[idx + 1]
      const bl = heights[idx + w - 1], b = heights[idx + w], br = heights[idx + w + 1]
      // Sobel-X: +1 0 -1 / +2 0 -2 / +1 0 -1
      // Sobel-Y: +1 +2 +1 / 0 0 0 / -1 -2 -1
      const gx = (tr + 2 * r + br) - (tl + 2 * l + bl)
      const gy = (tl + 2 * t + tr) - (bl + 2 * b + br)
      const m = Math.sqrt(gx * gx + gy * gy)
      mag[idx] = m
      if (m > maxMag) maxMag = m
    }
  }
  // Robust normalization: clamp at the 98th percentile so a couple of
  // sky-scraping spikes don't crush the roof gradient range.
  const sorted = Array.from(mag).filter(v => v > 0).sort((a, b) => a - b)
  const p98 = sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))] : maxMag
  const norm = p98 > 0 ? 255 / p98 : 0
  const out = new Uint8ClampedArray(w * h)
  for (let i = 0; i < mag.length; i++) {
    out[i] = Math.min(255, Math.round(mag[i] * norm))
  }
  return out
}

// ─────────────────────────────────────────────────────────────
// Pack three independent structural signals into one RGB image:
//   R = multi-azimuth hillshade composite (omni-directional illumination)
//   G = Sobel edge magnitude on the height field (sharp ridges/hips/valleys)
//   B = above-ground height fraction (taller = brighter blue→yellow tint)
// Trying to keep each channel discriminable in isolation while the
// combined visual still reads as "shaded relief with edge accents."
// ─────────────────────────────────────────────────────────────
function packRGBChannels(
  hillshade: Uint8ClampedArray,
  edges: Uint8ClampedArray,
  heights: Float32Array,
  w: number, h: number,
  groundLevel: number, ceiling: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4)  // RGBA
  const range = Math.max(0.001, ceiling - groundLevel)
  for (let i = 0; i < w * h; i++) {
    const shade = hillshade[i]  // 0..255 illumination
    const edge = edges[i]       // 0..255 Sobel gradient
    const heightFrac = Math.min(1, Math.max(0, (heights[i] - groundLevel) / range))
    // R = hillshade (illumination intensity)
    out[i * 4 + 0] = shade
    // G = Sobel edge magnitude — boost so even modest edges read on a
    // dark satellite-style display. Capped so already-bright edges hold.
    out[i * 4 + 1] = Math.min(255, Math.round(edge * 1.4))
    // B = above-ground height — inverse-warmth so high pixels stay bluish,
    // ground pixels stay near zero. Combined with the shade in the
    // hillshade channel this still reads as familiar shaded relief.
    out[i * 4 + 2] = Math.round(60 + heightFrac * 150)
    out[i * 4 + 3] = 255
  }
  return out
}

// ─────────────────────────────────────────────────────────────
// Nearest-neighbor RGBA resample. Bilinear would look prettier but
// hillshade edges (which are the whole point) get blurrier and Claude
// reads the same features either way.
// ─────────────────────────────────────────────────────────────
function resampleRGBA(src: Uint8ClampedArray, srcW: number, srcH: number, dstW: number, dstH: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dstW * dstH * 4)
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y / dstH) * srcH))
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x / dstW) * srcW))
      const sIdx = (sy * srcW + sx) * 4
      const dIdx = (y * dstW + x) * 4
      out[dIdx + 0] = src[sIdx + 0]
      out[dIdx + 1] = src[sIdx + 1]
      out[dIdx + 2] = src[sIdx + 2]
      out[dIdx + 3] = src[sIdx + 3]
    }
  }
  return out
}

// ─────────────────────────────────────────────────────────────
// Minimal PNG encoder using CompressionStream('deflate')
// ─────────────────────────────────────────────────────────────
async function encodePNG(rgba: Uint8ClampedArray, w: number, h: number): Promise<Uint8Array> {
  // Build the raw scanlines: 1 filter byte (=0 None) + RGBA per row
  const raw = new Uint8Array((w * 4 + 1) * h)
  let p = 0
  for (let y = 0; y < h; y++) {
    raw[p++] = 0  // filter: None
    const rowStart = y * w * 4
    raw.set(rgba.subarray(rowStart, rowStart + w * 4), p)
    p += w * 4
  }

  // Deflate (PNG wraps zlib stream — we use 'deflate' = zlib wrapper, NOT 'deflate-raw').
  const cs = new CompressionStream('deflate')
  const writer = cs.writable.getWriter()
  writer.write(raw)
  writer.close()
  const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer())

  // Assemble PNG
  const signature = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])

  const ihdrData = new Uint8Array(13)
  const ihdrView = new DataView(ihdrData.buffer)
  ihdrView.setUint32(0, w)
  ihdrView.setUint32(4, h)
  ihdrData[8] = 8     // bit depth per channel
  ihdrData[9] = 6     // color type: RGBA
  ihdrData[10] = 0    // compression: deflate
  ihdrData[11] = 0    // filter method: adaptive
  ihdrData[12] = 0    // interlace: none

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
  chunk[4] = type.charCodeAt(0)
  chunk[5] = type.charCodeAt(1)
  chunk[6] = type.charCodeAt(2)
  chunk[7] = type.charCodeAt(3)
  chunk.set(data, 8)
  // CRC over type + data
  const crcInput = new Uint8Array(4 + data.length)
  crcInput.set(chunk.subarray(4, 8), 0)
  crcInput.set(data, 4)
  view.setUint32(8 + data.length, crc32(crcInput))
  return chunk
}

// Standard CRC32 table — generated at module load, cached forever.
const CRC32_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    }
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

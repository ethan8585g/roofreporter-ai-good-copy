// ============================================================
// Auto-Trace Agent — Claude vision generates eave/hip/ridge polylines
// ============================================================
// Used by the super-admin trace UI: when an admin clicks
// "Auto-Trace Eaves" / "Auto-Trace Hips" / "Auto-Trace Ridges"
// the backend hits Claude Opus 4.7 (vision) with:
//   1. A high-res Google Static Maps satellite image of the lot
//   2. Google Solar API building insights (segments, panel positions,
//      bounding box, weighted pitch + azimuth)
//   3. A small few-shot batch of past human-traced reports for similar
//      properties (sqft + segment-count match) — retrieved by
//      services/trace-training-data.ts
// Claude returns pixel coordinates that we convert back to lat/lng
// via the same Web Mercator math used by services/sam3-segmentation.
//
// The agent never persists — it always returns a preview the admin
// reviews + tweaks before clicking Submit. Matches the "preview only"
// answer to the architecture question; never auto-rejects per
// feedback_never_reject_reports.md.
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import type { Bindings } from '../types'
import type { LatLng } from '../utils/trace-validation'
import { fetchBuildingInsightsRaw } from './solar-api'
import { fetchTrainingExamples, type TrainingExample } from './trace-training-data'
import { buildLessonMemo, getCalibrationFactor } from './auto-trace-learning'
import { fetchDsmHillshade, type DsmHillshadeResult } from './dsm-visualization'

const CLAUDE_VISION_MODEL = 'claude-opus-4-7'

export type AutoTraceEdge = 'eaves' | 'hips' | 'ridges'

export interface AutoTraceInput {
  orderId: number
  edge: AutoTraceEdge
  /** Map centre lat/lng — usually the order's stored coords, but the admin
   *  may pan the map and pass a different centre when the property record
   *  is off-target. */
  lat: number
  lng: number
  /** Static Maps zoom level the admin's map is currently at (17–21).
   *  Defaults to 20 (street-level residential). */
  zoom?: number
  /** Optional client-side viewport size — we cap at 640 per side (the
   *  Static Maps limit) and pass scale=2 for 1280×1280 effective resolution. */
  imageWidth?: number
  imageHeight?: number
  /** Optional base64-encoded JPEG snapshot of the super-admin's 3D
   *  reference map (the `<gmp-map-3d>` panel beside the 2D trace map).
   *  Captured client-side via the same WebGL readPixels path the existing
   *  "Capture View" button uses. Lets Claude correlate ridge/hip
   *  visibility from an oblique perspective the satellite view can't
   *  show. Strip any `data:image/...;base64,` prefix client-side. */
  viewport3dB64?: string
  /** Engineering-only flag: when true the result includes the base64-encoded
   *  satellite + DSM hillshade images so the operator can verify what Claude
   *  saw. Off by default — adds ~2MB to the response. */
  includeDebugImages?: boolean
}

export interface AutoTraceResult {
  edge: AutoTraceEdge
  /** Eaves: a list of closed polygons (1 entry per structure).
   *  Hips/ridges: a list of polylines. */
  segments: LatLng[][]
  /** Claude's own 0–100 confidence for the returned segments. Surfaces to
   *  the UI so the admin knows whether to trust the auto-trace or redo by
   *  hand. */
  confidence: number
  /** Human-readable explanation Claude returns alongside the geometry. */
  reasoning: string
  /** Echoed-back base64 of the satellite + hillshade images when caller passes
   *  `includeDebugImages: true`. Inspection-only — never returned to the UI. */
  debug_images?: {
    satellite: { mediaType: string; b64: string }
    hillshade?: { mediaType: string; b64: string }
    target_bbox_px?: { x1: number; y1: number; x2: number; y2: number; widthFt: number; depthFt: number; trusted: boolean }
    target_center_px?: { x: number; y: number }
  }
  /** Diagnostic context — shown in the dev console only. */
  diagnostics: {
    image_url_redacted: string
    solar_segments_count: number
    training_examples_used: number
    raw_model_confidence?: number
    calibration_factor?: number
    lesson_memo_chars?: number
    /** Whether the agent had the DSM hillshade image in its prompt. */
    dsm_hillshade_used: boolean
    dsm_hillshade_quality?: 'HIGH' | 'MEDIUM' | 'BASE'
    dsm_imagery_date?: string
    /** Whether the agent had the 3D viewport image in its prompt. */
    viewport_3d_used: boolean
    model: string
    elapsed_ms: number
  }
}

// ─────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────
export async function runAutoTrace(env: Bindings, input: AutoTraceInput): Promise<AutoTraceResult> {
  const started = Date.now()
  const zoom = clampZoom(input.zoom)
  const safeW = Math.min(input.imageWidth || 640, 640)
  const safeH = Math.min(input.imageHeight || 640, 640)

  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured — auto-trace requires Claude vision')
  }
  if (!env.GOOGLE_MAPS_API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY not configured — auto-trace needs a satellite image')
  }

  // Solar API gives us the building's actual lat/lng bounding box. We need
  // that BEFORE choosing the satellite image centre/zoom so we can frame
  // the image tightly on the target — otherwise the user's pin (often
  // landing on a lot boundary or in front of the actual building) puts a
  // neighbour right next to the target and Claude tries to trace both.
  const solarInsights = await safelyFetchSolar(env, input.lat, input.lng)
  const solarSummary = summarizeSolar(solarInsights)

  // Pick the satellite image's centre + zoom. When Solar gives us a
  // trusted (≤60ft per side) bbox, recentre on its centroid and bump zoom
  // up one notch so the building fills the frame. Falls back to the
  // user's pin + their map zoom otherwise.
  const framing = chooseImageFraming(solarInsights, input.lat, input.lng, zoom)

  const imageUrl = buildSatelliteImageUrl(framing.lat, framing.lng, framing.zoom, safeW, safeH, env.GOOGLE_MAPS_API_KEY)

  // Fetch the two raster inputs in parallel. Both are now centred on
  // `framing.lat/lng` at `framing.zoom` so their pixel grids align 1:1.
  const [satellite, hillshade] = await Promise.all([
    fetchImageB64(imageUrl),
    fetchDsmHillshade(env, framing.lat, framing.lng, safeW * 2).catch((e: any) => {
      console.warn('[auto-trace] DSM hillshade fetch failed:', e?.message)
      return null
    }),
  ])
  const imageB64 = satellite.b64
  const imageMediaType = satellite.mediaType

  // Past human traces of similar properties + lesson memo from past
  // corrections + calibration factor — all three are how this agent
  // adapts to super-admin edits over time. Each is tolerant of an
  // empty data pool so first-day behavior matches steady-state behavior.
  const [examples, lessonMemo, calibrationFactor] = await Promise.all([
    fetchTrainingExamples(env, {
      edge: input.edge,
      centroidLat: framing.lat,
      centroidLng: framing.lng,
      targetSegments: solarSummary.segments_count,
      limit: 5,
    }),
    buildLessonMemo(env, input.edge),
    getCalibrationFactor(env, input.edge),
  ])

  const hasViewport3d = !!(input.viewport3dB64 && input.viewport3dB64.length > 1000)
  // Compute the target building's bounding box in PIXEL space on the satellite
  // image — now using framing.lat/lng/zoom (which may have been recentred on
  // the Solar bbox above). Static Maps always centres the request lat/lng at
  // (W/2, H/2). When the framing is the Solar centroid, the bbox lands neatly
  // in the centre of the image and Claude has no other building to chase.
  const imagePxW = safeW * 2
  const imagePxH = safeH * 2
  const targetCenterPx = { x: Math.round(imagePxW / 2), y: Math.round(imagePxH / 2) }
  const targetBboxPx = computeTargetBboxPx(solarInsights, framing.lat, framing.lng, framing.zoom, imagePxW, imagePxH)
  const systemPrompt = buildSystemPrompt(input.edge, lessonMemo, {
    hasHillshade: !!hillshade,
    hasViewport3d,
    targetCenterPx,
    targetBboxPx,
  })
  const userPrompt = buildUserPrompt({
    edge: input.edge,
    imagePxW,
    imagePxH,
    solarSummary,
    examples,
    hillshade,
    hasViewport3d,
    targetCenterPx,
    targetBboxPx,
  })

  // Build the multimodal content array. Order matters — Claude reads them
  // in sequence, so satellite (truth) → hillshade (structure) → 3D
  // (perspective) keeps the most important signal first.
  const content: any[] = [
    { type: 'image', source: { type: 'base64', media_type: imageMediaType, data: imageB64 } },
  ]
  if (hillshade) {
    content.push({ type: 'image', source: { type: 'base64', media_type: hillshade.mediaType, data: hillshade.b64 } })
  }
  if (hasViewport3d) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: stripDataUrl(input.viewport3dB64!) } })
  }
  content.push({ type: 'text', text: userPrompt })

  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const completion = await anthropic.messages.create({
    // Opus 4.7 deprecated the `temperature` knob — leave the default.
    model: CLAUDE_VISION_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content }],
  })

  const text = completion.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim()

  const parsed = parseClaudeResponse(text)
  const pixelImgW = safeW * 2
  const pixelImgH = safeH * 2
  // Project Claude's pixel coords back to GPS using the SAME centre + zoom
  // that produced the satellite image (which may be Solar-recentred, not
  // the user's original pin).
  const segments = parsed.segments.map(seg => seg.map(p => pxToLatLng(p.x, p.y, framing.lat, framing.lng, framing.zoom, pixelImgW, pixelImgH)))
  // Calibration: scale the model's self-reported confidence by the historical
  // edit rate for this edge type. 100% edit rate → 0.6×; 0% → 1.0×.
  // services/auto-trace-learning.ts maintains this factor on every submit.
  const calibratedConfidence = Math.round(parsed.confidence * calibrationFactor)

  return {
    edge: input.edge,
    segments,
    confidence: calibratedConfidence,
    reasoning: parsed.reasoning,
    ...(input.includeDebugImages ? {
      debug_images: {
        satellite: { mediaType: imageMediaType, b64: imageB64 },
        hillshade: hillshade ? { mediaType: hillshade.mediaType, b64: hillshade.b64 } : undefined,
        target_bbox_px: targetBboxPx || undefined,
        target_center_px: targetCenterPx,
      },
    } : {}),
    diagnostics: {
      image_url_redacted: imageUrl.replace(/key=[^&]+/, 'key=REDACTED'),
      solar_segments_count: solarSummary.segments_count,
      training_examples_used: examples.length,
      raw_model_confidence: parsed.confidence,
      calibration_factor: calibrationFactor,
      lesson_memo_chars: lessonMemo.length,
      dsm_hillshade_used: !!hillshade,
      dsm_hillshade_quality: hillshade?.quality,
      dsm_imagery_date: hillshade?.imageryDate,
      viewport_3d_used: hasViewport3d,
      model: CLAUDE_VISION_MODEL,
      elapsed_ms: Date.now() - started,
    },
  }
}

/** Decide where to centre the satellite image and at what zoom. When Google
 *  Solar API returns a trusted bbox (each side ≤ 60ft per CLAUDE.md's merged-
 *  neighbour heuristic), we centre on that bbox's geographic centroid so the
 *  target building sits in the middle of the frame and bump zoom up one step
 *  to crop neighbours out. Without a trusted bbox we keep the user's pin and
 *  their map zoom so behaviour matches what they're looking at. */
function chooseImageFraming(
  insights: any,
  pinLat: number, pinLng: number, userZoom: number,
): { lat: number; lng: number; zoom: number; recentered: boolean } {
  const bb = insights?.boundingBox
  const sw = bb?.sw || bb?.southWest
  const ne = bb?.ne || bb?.northEast
  if (!sw?.latitude || !ne?.latitude) {
    return { lat: pinLat, lng: pinLng, zoom: userZoom, recentered: false }
  }
  const latDiffM = Math.abs(ne.latitude - sw.latitude) * 111_320
  const lngDiffM = Math.abs(ne.longitude - sw.longitude) * 111_320 * Math.cos((pinLat * Math.PI) / 180)
  const widthFt = lngDiffM * 3.28084
  const depthFt = latDiffM * 3.28084
  const trusted = widthFt <= 60 && depthFt <= 60
  if (!trusted) {
    // Solar merged a neighbour — its bbox is unreliable, don't recentre on it.
    return { lat: pinLat, lng: pinLng, zoom: userZoom, recentered: false }
  }
  const cLat = (sw.latitude + ne.latitude) / 2
  const cLng = (sw.longitude + ne.longitude) / 2
  // Zoom selection: at lat ~53°, residential lots are typically 60-100 ft
  // wide. We want the building to fill 35-55% of the image (so eaves are
  // resolvable but the lot edges aren't cropped). userZoom + 1 typically
  // gets us there; cap at 21 (Static Maps' max).
  const newZoom = Math.min(21, Math.max(userZoom, 21))
  return { lat: cLat, lng: cLng, zoom: newZoom, recentered: true }
}

/** Project the Solar API buildingInsights bounding box (lat/lng corners) into
 *  pixel coordinates on the satellite image we send to Claude. Inverse of
 *  pxToLatLng() — uses the identical Mercator math.
 *
 *  Also computes the bbox dimensions in feet so the caller can detect Google
 *  Solar's "merged neighbour" failure mode: per CLAUDE.md, any side > 60 ft
 *  signals the API has folded a neighbour or the whole lot into the
 *  footprint. We surface that as `trusted = false` so the prompt can fall
 *  back to a tighter "containing centre pixel only" instruction. */
function computeTargetBboxPx(
  insights: any,
  centerLat: number, centerLng: number, zoom: number,
  imgW: number, imgH: number,
): { x1: number; y1: number; x2: number; y2: number; widthFt: number; depthFt: number; trusted: boolean } | null {
  if (!insights?.boundingBox) return null
  const bb = insights.boundingBox
  const sw = bb.sw || bb.southWest
  const ne = bb.ne || bb.northEast
  if (!sw?.latitude || !ne?.latitude) return null

  const latLngToPx = (lat: number, lng: number) => {
    const scale = 1 << zoom
    const centerSin = Math.sin(centerLat * Math.PI / 180)
    const centerWorldX = (256 * (0.5 + centerLng / 360)) * scale
    const centerWorldY = (256 * (0.5 - Math.log((1 + centerSin) / (1 - centerSin)) / (4 * Math.PI))) * scale
    const targetSin = Math.sin(lat * Math.PI / 180)
    const targetWorldX = (256 * (0.5 + lng / 360)) * scale
    const targetWorldY = (256 * (0.5 - Math.log((1 + targetSin) / (1 - targetSin)) / (4 * Math.PI))) * scale
    return {
      x: Math.round((targetWorldX - centerWorldX) * 2 + imgW / 2),
      y: Math.round((targetWorldY - centerWorldY) * 2 + imgH / 2),
    }
  }
  const swPx = latLngToPx(sw.latitude, sw.longitude)
  const nePx = latLngToPx(ne.latitude, ne.longitude)
  let x1 = Math.min(swPx.x, nePx.x)
  let x2 = Math.max(swPx.x, nePx.x)
  let y1 = Math.min(swPx.y, nePx.y)
  let y2 = Math.max(swPx.y, nePx.y)

  // Real-world bbox dimensions for the trust check
  const latDiffM = Math.abs(ne.latitude - sw.latitude) * 111_320
  const lngDiffM = Math.abs(ne.longitude - sw.longitude) * 111_320 * Math.cos((centerLat * Math.PI) / 180)
  const widthFt = Math.round(lngDiffM * 3.28084)
  const depthFt = Math.round(latDiffM * 3.28084)
  // Mirrors CLAUDE.md's 60ft threshold (OVERLAP_THRESHOLD_M = 18.288).
  // A bbox bigger than that is almost certainly a Solar-merged neighbour
  // or the full lot, not a single residential footprint.
  const trusted = widthFt <= 60 && depthFt <= 60

  // 15% outward pad to forgive small Solar slop — only applied for trusted bboxes.
  if (trusted) {
    const padX = Math.round((x2 - x1) * 0.15)
    const padY = Math.round((y2 - y1) * 0.15)
    x1 = Math.max(0, x1 - padX)
    y1 = Math.max(0, y1 - padY)
    x2 = Math.min(imgW - 1, x2 + padX)
    y2 = Math.min(imgH - 1, y2 + padY)
  } else {
    // Untrusted: clamp the box to a 60ft × 60ft rectangle centred on the pin
    // so Claude has SOMETHING to constrain against. 60ft at zoom 20 lat 53° ≈
    // 60/3.28084 m / pixelSizeMeters. At z=20 with scale=2, ground sampling
    // ≈ 0.298m/px at lat 53.5 → 60ft ≈ 18.3m ≈ 61px. Half is 31px from centre.
    const scale = 1 << zoom
    const groundMPerPx = (40_075_016 * Math.cos((centerLat * Math.PI) / 180)) / (256 * scale * 2)
    const halfPx = Math.round(18.288 / groundMPerPx)
    const cx = Math.round(imgW / 2)
    const cy = Math.round(imgH / 2)
    x1 = Math.max(0, cx - halfPx)
    y1 = Math.max(0, cy - halfPx)
    x2 = Math.min(imgW - 1, cx + halfPx)
    y2 = Math.min(imgH - 1, cy + halfPx)
  }
  if (x2 - x1 < 20 || y2 - y1 < 20) return null
  return { x1, y1, x2, y2, widthFt, depthFt, trusted }
}

async function safelyFetchSolar(env: Bindings, lat: number, lng: number): Promise<any> {
  try {
    if (!env.GOOGLE_SOLAR_API_KEY) return null
    return await fetchBuildingInsightsRaw(lat, lng, env.GOOGLE_SOLAR_API_KEY)
  } catch (e: any) {
    console.warn('[auto-trace] solar insights fetch failed:', e?.message)
    return null
  }
}

// `data:image/jpeg;base64,...` → just the base64 payload. Tolerates either
// form so the client can send the raw output of canvas.toDataURL() directly.
function stripDataUrl(s: string): string {
  const comma = s.indexOf(',')
  return comma >= 0 && s.startsWith('data:') ? s.slice(comma + 1) : s
}

// ─────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────
function buildSystemPrompt(
  edge: AutoTraceEdge,
  lessonMemo: string,
  opts: {
    hasHillshade: boolean
    hasViewport3d: boolean
    targetCenterPx: { x: number; y: number }
    targetBboxPx: { x1: number; y1: number; x2: number; y2: number; widthFt: number; depthFt: number; trusted: boolean } | null
  },
): string {
  const role = edge === 'eaves'
    ? 'detecting the OUTER PERIMETER of every building roof in the image — one closed polygon per structure (house + any detached garages/sheds visible). Trace at the EAVE LINE (drip edge), not the walls. Include all jogs, bump-outs, and lower-tier eaves. 8+ vertices per polygon; corners only — no points on straight edges.'
    : edge === 'ridges'
    ? 'detecting RIDGE LINES — the horizontal peaks where two opposing roof planes meet at the top. Each ridge is a polyline (2+ points). Hip-roof structures usually have one short central ridge; gable roofs have one long ridge per gable. Do NOT trace hips, valleys, or eaves.'
    : 'detecting HIP LINES — the diagonal edges that run from a roof peak down to an outside corner of the eave. Each hip is a polyline (usually 2 points: peak → corner). Hip-roof structures have 4 hips at the corners; gable roofs have zero. Do NOT trace ridges, valleys, or eaves.'

  // Image-count phrasing — Claude sees up to 3 images. We tell it which
  // is which so it knows to read pixel coords off the FIRST image only.
  const imageCount = 1 + (opts.hasHillshade ? 1 : 0) + (opts.hasViewport3d ? 1 : 0)
  const imageRoster: string[] = ['Image 1 — Google satellite (top-down, target reference; ALL pixel coordinates you return must be in this image\'s coordinate space).']
  if (opts.hasHillshade) {
    imageRoster.push('Image 2 — DSM hillshade. A synthetic shaded-relief render of the Google Solar API elevation raster, RESAMPLED to the SAME size as Image 1 so pixel coordinates correspond 1:1. Brightness = sun-from-NW illumination of the roof surface; warmer yellow tints = higher above ground. Use it to see ridges (bright lines where two slopes meet at the top), hips (bright diagonal lines from peak to corner), valleys (dark inset lines), and the eave drop where the surface falls to ground level.')
  }
  if (opts.hasViewport3d) {
    imageRoster.push('Image 3 — Oblique 3D photorealistic view of the same property (Google Maps 3D tiles, super-admin\'s current camera angle). Use it for perspective — gables, dormers, ridge orientation that\'s ambiguous from above. Do NOT use it for pixel coordinates.')
  }

  return [
    `You are an expert roof measurement technician ${role}`,
    '',
    `INPUTS: ${imageCount} image${imageCount > 1 ? 's' : ''}, in this order:`,
    ...imageRoster,
    '',
    'Coordinate origin for the target image is top-left (0,0). All coordinates you return must be in pixels of Image 1.',
    '',
    '⚠️ TARGET BUILDING — CRITICAL:',
    `The target building is centred at pixel (${opts.targetCenterPx.x}, ${opts.targetCenterPx.y}) on Image 1 — the satellite image has been recentred and zoomed so the target sits in the middle of the frame. Trace ONLY this central building. Any other buildings visible at the edges of the image are NEIGHBOURS, not the target.`,
    opts.targetBboxPx
      ? (opts.targetBboxPx.trusted
          ? `Google Solar API's footprint for that building covers approximately the pixel rectangle (${opts.targetBboxPx.x1}, ${opts.targetBboxPx.y1}) to (${opts.targetBboxPx.x2}, ${opts.targetBboxPx.y2}) on Image 1 — ${opts.targetBboxPx.widthFt}ft wide × ${opts.targetBboxPx.depthFt}ft deep. Your output polygon for ${edge === 'eaves' ? 'each eave section' : 'each line'} should sit ENTIRELY within or immediately adjacent to that rectangle. Anything outside it is a neighbour's house, driveway, garden bed, or street — DO NOT TRACE THOSE.`
          : `⚠️ Google Solar API returned a ${opts.targetBboxPx.widthFt}ft × ${opts.targetBboxPx.depthFt}ft bounding box for this address — that is LARGER than a typical residential footprint, which means Solar has MERGED THIS HOUSE WITH A NEIGHBOUR or the full lot. DO NOT use Solar's bbox as a guide. Instead, trace ONLY the single building that contains the pin pixel (${opts.targetCenterPx.x}, ${opts.targetCenterPx.y}) and is bounded by visible separations (driveways, fences, grass) from any adjacent buildings. Stay within roughly the pixel rectangle (${opts.targetBboxPx.x1}, ${opts.targetBboxPx.y1}) to (${opts.targetBboxPx.x2}, ${opts.targetBboxPx.y2}) which has been clamped to a 60ft radius around the pin.`)
      : 'No Google Solar bounding box is available for this address — trace ONLY the building under the centre pixel and its directly-attached parts (e.g. attached garage). Do NOT trace any building separated from the centre by a clear gap (those are neighbours).',
    edge === 'eaves'
      ? 'A typical Canadian residential house is 1,500–3,000 sqft. If your traced polygon is bigger than ~3,500 sqft, you are almost certainly combining the target with a neighbour or an unrelated outbuilding — re-evaluate and shrink the trace.'
      : 'If your traced lines extend beyond the target building bbox, you are tracing neighbour roofs — drop those lines.',
    '',
    'OUTPUT: Strict JSON only — no prose, no markdown fences. Schema:',
    '{',
    '  "segments": [ [{"x":int,"y":int}, ...], ... ],',
    '  "confidence": int 0-100,',
    '  "reasoning": "one short sentence on what you saw, citing which image(s) drove your decisions"',
    '}',
    '',
    'RULES:',
    '- Pixel coordinates must be integers within Image 1\'s bounds.',
    '- Eaves: each segment is a CLOSED polygon listed clockwise. Do NOT repeat the first vertex at the end.',
    '- Hips/ridges: each segment is an open polyline (2+ points). Points are roof corners or ridge endpoints, never on a straight edge.',
    '- If you cannot see a roof of the requested edge type, return { "segments": [], "confidence": 0, "reasoning": "..." }.',
    '- Use the few-shot examples below as a tracing style reference (vertex density, where corners go) — they are real super-admin traces of similar properties.',
    '- Use the Google Solar API context (segment count, pitch, azimuths) as a structural hint — a 1-segment building has one big ridge; a 4-segment hip roof has 4 hips.',
    opts.hasHillshade ? '- For ridges and hips specifically: cross-check your pixel picks against Image 2. A "ridge" you draw should sit on a bright line in the hillshade; a "hip" should run along a bright diagonal toward a corner. If the hillshade disagrees with what the satellite suggests, trust the hillshade — it sees through tree shadows and roofing-material color noise.' : '',
    opts.hasViewport3d ? '- Use Image 3 to disambiguate gable-vs-hip and to spot dormers/skylights you might have missed from above. Do NOT trace coordinates from Image 3 — only Image 1.' : '',
    lessonMemo ? '\n' + lessonMemo : '',
  ].filter(Boolean).join('\n')
}

function buildUserPrompt(args: {
  edge: AutoTraceEdge
  imagePxW: number
  imagePxH: number
  solarSummary: ReturnType<typeof summarizeSolar>
  examples: TrainingExample[]
  hillshade: DsmHillshadeResult | null
  hasViewport3d: boolean
  targetCenterPx: { x: number; y: number }
  targetBboxPx: { x1: number; y1: number; x2: number; y2: number } | null
}): string {
  const lines: string[] = []
  lines.push(`Image 1 (target satellite): ${args.imagePxW}x${args.imagePxH} pixels.`)
  if (args.hillshade) {
    lines.push(`Image 2 (DSM hillshade): ${args.hillshade.width}x${args.hillshade.height} pixels, same coordinate space as Image 1. Solar API quality=${args.hillshade.quality || 'unknown'}${args.hillshade.imageryDate ? `, imagery dated ${args.hillshade.imageryDate}` : ''}.`)
  }
  if (args.hasViewport3d) {
    lines.push('Image 3 (3D oblique): perspective only — do not use for pixel coordinates.')
  }
  lines.push('')
  lines.push(`TARGET: building at pixel (${args.targetCenterPx.x}, ${args.targetCenterPx.y}).`)
  if (args.targetBboxPx) {
    const b = args.targetBboxPx
    lines.push(`Target bbox: (${b.x1}, ${b.y1}) → (${b.x2}, ${b.y2}) — ${b.widthFt}ft × ${b.depthFt}ft${b.trusted ? '' : ' (UNTRUSTED, Solar API merged neighbour — clamped to 60ft radius around pin)'}. Stay inside this rectangle.`)
  }
  lines.push('')
  lines.push('Google Solar API context for this address:')
  if (args.solarSummary.available) {
    lines.push(`- Roof segments detected by Solar API: ${args.solarSummary.segments_count}`)
    lines.push(`- Weighted average pitch: ${args.solarSummary.avg_pitch_deg.toFixed(1)}°`)
    lines.push(`- Segment azimuths (deg): ${args.solarSummary.azimuths.map(a => a.toFixed(0)).join(', ')}`)
    lines.push(`- Bounding box: ${args.solarSummary.bbox_width_ft} ft × ${args.solarSummary.bbox_depth_ft} ft`)
  } else {
    lines.push('- Solar API unavailable (rural / no coverage). Lean on the image + few-shot examples.')
  }
  lines.push('')

  if (args.examples.length > 0) {
    lines.push(`Few-shot examples — ${args.examples.length} past super-admin traces of similar properties:`)
    args.examples.forEach((ex, i) => {
      lines.push(`Example ${i + 1}: ${ex.house_sqft} sqft, ${ex.complexity_class || 'unknown'} complexity, ${ex.roof_pitch_degrees?.toFixed?.(1) || '?'}° pitch.`)
      const edgePayload = pickEdgeFromExample(ex, args.edge)
      lines.push(`  ${args.edge} (lat/lng, for reference shape only — DO NOT copy coordinates): ${JSON.stringify(edgePayload).slice(0, 600)}`)
    })
    lines.push('')
  } else {
    lines.push('No similar past traces available — work from the image + Solar context alone.')
    lines.push('')
  }

  lines.push(`Now produce the ${args.edge} segments for THIS property. Return JSON only.`)
  return lines.join('\n')
}

function pickEdgeFromExample(ex: TrainingExample, edge: AutoTraceEdge): unknown {
  try {
    const trace = typeof ex.roof_trace_json === 'string' ? JSON.parse(ex.roof_trace_json) : ex.roof_trace_json
    if (!trace) return null
    if (edge === 'eaves') return trace.eaves_sections || trace.eaves || []
    if (edge === 'ridges') return trace.ridges || []
    if (edge === 'hips') return trace.hips || []
  } catch { /* corrupt example — skip */ }
  return []
}

// ─────────────────────────────────────────────────────────────
// Image fetch + Mercator helpers
// ─────────────────────────────────────────────────────────────
function buildSatelliteImageUrl(lat: number, lng: number, zoom: number, w: number, h: number, key: string): string {
  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${w}x${h}&scale=2&maptype=satellite&key=${key}`
}

async function fetchImageB64(url: string): Promise<{ b64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`satellite image fetch failed (${resp.status})`)
  // Google Static Maps returns PNG by default — the Anthropic API rejects a
  // mismatched media_type, so always read the actual Content-Type instead
  // of assuming JPEG. Fall back to PNG since that's the Static Maps default.
  const ctRaw = (resp.headers.get('content-type') || 'image/png').toLowerCase()
  const mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' =
    ctRaw.includes('jpeg') ? 'image/jpeg'
    : ctRaw.includes('gif')  ? 'image/gif'
    : ctRaw.includes('webp') ? 'image/webp'
    : 'image/png'
  const buf = new Uint8Array(await resp.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
  return { b64: btoa(bin), mediaType }
}

function pxToLatLng(px: number, py: number, centerLat: number, centerLng: number, zoom: number, pixelImgW: number, pixelImgH: number): LatLng {
  const scale = 1 << zoom
  const sin = Math.sin(centerLat * Math.PI / 180)
  const centerWorldX = (256 * (0.5 + centerLng / 360)) * scale
  const centerWorldY = (256 * (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI))) * scale
  const worldX = centerWorldX + (px - pixelImgW / 2) * 0.5
  const worldY = centerWorldY + (py - pixelImgH / 2) * 0.5
  const lng = (worldX / (256 * scale) - 0.5) * 360
  const n = Math.PI - 2 * Math.PI * worldY / (256 * scale)
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
  return { lat, lng }
}

function clampZoom(z: number | undefined): number {
  const n = Number(z)
  if (!Number.isFinite(n)) return 20
  return Math.max(17, Math.min(21, Math.round(n)))
}

// ─────────────────────────────────────────────────────────────
// Solar API summarizer — reduces a heavy buildingInsights response
// to the handful of numbers Claude actually needs in the prompt
// ─────────────────────────────────────────────────────────────
function summarizeSolar(insights: any): {
  available: boolean
  segments_count: number
  avg_pitch_deg: number
  azimuths: number[]
  bbox_width_ft: number
  bbox_depth_ft: number
} {
  if (!insights || !insights.solarPotential) {
    return { available: false, segments_count: 0, avg_pitch_deg: 0, azimuths: [], bbox_width_ft: 0, bbox_depth_ft: 0 }
  }
  const segs: any[] = insights.solarPotential.roofSegmentStats || []
  const azimuths = segs.map(s => Number(s.azimuthDegrees || 0))
  const pitches = segs.map(s => Number(s.pitchDegrees || 0)).filter(p => p > 0)
  const avgPitch = pitches.length > 0 ? pitches.reduce((a, b) => a + b, 0) / pitches.length : 0

  let widthFt = 0, depthFt = 0
  const bb = insights.boundingBox
  if (bb) {
    const sw = bb.sw || bb.southWest
    const ne = bb.ne || bb.northEast
    if (sw?.latitude && ne?.latitude) {
      const lat = (sw.latitude + ne.latitude) / 2
      const latDiffM = Math.abs(ne.latitude - sw.latitude) * 111_320
      const lngDiffM = Math.abs(ne.longitude - sw.longitude) * 111_320 * Math.cos(lat * Math.PI / 180)
      widthFt = Math.round(lngDiffM * 3.28084)
      depthFt = Math.round(latDiffM * 3.28084)
    }
  }
  return {
    available: true,
    segments_count: segs.length,
    avg_pitch_deg: avgPitch,
    azimuths,
    bbox_width_ft: widthFt,
    bbox_depth_ft: depthFt,
  }
}

// ─────────────────────────────────────────────────────────────
// Claude response parsing — strict JSON, tolerant of fenced output
// ─────────────────────────────────────────────────────────────
function parseClaudeResponse(text: string): { segments: { x: number; y: number }[][]; confidence: number; reasoning: string } {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
  let parsed: any
  try {
    parsed = JSON.parse(stripped)
  } catch {
    // Last-ditch: pull the first {...} block out of the body and try again.
    const m = stripped.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('Claude returned non-JSON output')
    parsed = JSON.parse(m[0])
  }
  const rawSegments: any[] = Array.isArray(parsed?.segments) ? parsed.segments : []
  const segments = rawSegments
    .map((seg: any[]) => Array.isArray(seg)
      ? seg.filter((p: any) => Number.isFinite(p?.x) && Number.isFinite(p?.y)).map((p: any) => ({ x: Math.round(p.x), y: Math.round(p.y) }))
      : [])
    .filter(seg => seg.length >= 2)
  const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed?.confidence) || 0)))
  const reasoning = String(parsed?.reasoning || '').slice(0, 500)
  return { segments, confidence, reasoning }
}

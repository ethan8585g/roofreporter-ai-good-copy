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
import { fetchDsmHillshade, fetchSolarRgbOrtho, type DsmHillshadeResult, type SolarRgbResult } from './dsm-visualization'
import { renderGridOverlay } from './grid-overlay'
import { fetchFootprintPriors, type FootprintPrior } from './footprint-priors'
import { decodePNG, encodePNG, lanczosResize, applyVARITint } from './image-preprocess'

const CLAUDE_VISION_MODEL = 'claude-opus-4-7'

export type AutoTraceEdge = 'eaves' | 'hips' | 'ridges' | 'valleys'

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
  /** Skip the post-processing dominant-angle snapping step. **Default true
   *  (snapping is OFF)** as of 2026-05-11 after a regression: buildings
   *  with bay windows, angled wings, hex porches, or any non-90° feature
   *  were getting their real corners flattened. Pass `false` (or
   *  `enableAngleSnapping`) only when you know the building is purely
   *  rectilinear. */
  skipAngleSnapping?: boolean
  /** Opt-IN flag for the dominant-angle snapping step. Mirror of
   *  skipAngleSnapping with the opposite default so route consumers can
   *  use either spelling. */
  enableAngleSnapping?: boolean
  /** Skip the polygon collinear-vertex smoothing step. **Default false
   *  (smoothing IS applied)** — eaves only. Removes 2-pixel-tolerance
   *  near-collinear vertices that arise from Mercator round-trip jitter
   *  on straight walls; never reduces below 3 vertices and never
   *  changes shape. Operators get fewer phantom stair-step vertices to
   *  clean up. Set true to debug raw model output. */
  skipSmoothing?: boolean
  /** Skip rendering past super-admin traces as VISUAL examples (satellite
   *  tile + polygon overlay) and fall back to text-only metadata. Default
   *  false — visuals are rendered when example coords are available.
   *  Set true to debug whether visuals are helping or hurting on a given
   *  property class. */
  skipVisualExamples?: boolean
  /** Allow the auto-trace to return DETACHED garages, sheds, and outbuildings
   *  as additional polygons instead of clamping to the single central
   *  structure. Default false — the bbox clamp suppresses these by design
   *  because most reports cover the main house only. */
  includeOutbuildings?: boolean
  /** When > 0, enable Opus 4.7 extended thinking with this token budget.
   *  Spatial-reasoning tasks (counting roof segments, comparing geometry
   *  across images) benefit from a scratchpad; pixel-localization tasks
   *  usually don't. Defaults to 0 (no thinking). Sensible values: 2000-4000.
   *  Adds ~30-60% latency. */
  thinkingBudget?: number
  /** Send an additional wide-context satellite tile (one zoom level out)
   *  so Claude can see property boundaries + neighbours without the tight
   *  framing of the primary image. Off by default. */
  wideContext?: boolean
  /** Render a transparent 16×16 grid overlay (Set-of-Marks-style) and
   *  include it as a parallel image. Helps Claude anchor pixel
   *  references. Off by default — adds ~1MB to the request payload. */
  gridOverlay?: boolean
  /** Order IDs to exclude from the few-shot retrieval pool. Used by the
   *  harness endpoint to prevent self-recall during accuracy evaluation;
   *  unused on production traces. */
  excludeOrderIds?: number[]
  /** Render each Solar-detected roof plane as a colored translucent
   *  rectangle on the satellite tile (R/G/B/Y...). Tells Claude
   *  "here are N structural ground-truth planes; trace the OUTER
   *  PERIMETER enclosing all of them." Strongest free signal in the
   *  pipeline — Solar's segment detection is DSM-derived, independent
   *  from the satellite imagery the model otherwise sees. **Default
   *  ON** as of 2026-05-11 since it costs nothing extra (Solar bbox
   *  already fetched) and addresses the wrong-shape failure mode.
   *  Set to false to compare against unprompted baseline. */
  solarSegmentOverlay?: boolean
  /** Optional user-drawn hint region — coarse circle/box indicating
   *  approximately where the target building is. This is the SAM-style
   *  interactive-segmentation prompt: the operator marks a rough region
   *  in ~2 seconds, the agent uses it to disambiguate "which thing is
   *  the target." Eliminates the wrong-building / merged-neighbour /
   *  detached-garage failure modes. Foundation vision models perform
   *  dramatically better when the target is visually marked vs. "find
   *  the building somewhere in this image." */
  hintRegion?: {
    /** Centre of the user's hint, in geographic coordinates. */
    centerLat: number
    centerLng: number
    /** Radius in meters — half the largest dimension of the user's
     *  drawn circle/box. Sane bounds: 8m (small shed) to 80m (acreage). */
    radiusMeters: number
  }
  /** Decode the satellite PNG, paint vegetation pixels magenta via VARI
   *  index, and send the tinted version as the primary image. Tells
   *  Claude "the pink stuff is trees; the eave passes through them but
   *  you can see where the roof picks up on the other side." Off by
   *  default — adds ~200-400ms of pure-JS pixel work per call. */
  vegetationTint?: boolean
  /** Resample the satellite tile from Static Maps' 1280×1280 native
   *  output up to Claude's 1568×1568 ceiling via Lanczos-3. Recovers
   *  ~18-22% of the model's input resolution we currently leave on the
   *  table. Off by default — adds ~500ms-1s of pure-JS work per call.
   *  When combined with vegetationTint the work shares one decode. */
  upscaleTo1568?: boolean
}

export interface AutoTraceResult {
  edge: AutoTraceEdge
  /** Stable UUID identifying this exact run. The client MUST echo this
   *  back when the operator submits a trace so the learning loop can
   *  correlate the agent's draft against the admin's final geometry
   *  deterministically — replacing the fuzzy "any run in the last 2h"
   *  log-window match. */
  run_id: string
  /** Eaves: a list of closed polygons (1 entry per structure).
   *  Hips/ridges: a list of polylines. */
  segments: LatLng[][]
  /** Optional parallel array tagging each segment as 'main' (primary roof),
   *  'lower_tier' (porch/garage extension/sunroom lip with separate pitch),
   *  or 'outbuilding'. Populated when Claude returns a `kinds` array AND
   *  every entry validates 1:1 against the kept segments. Undefined means
   *  treat every polygon as 'main' — the previous default behavior. */
  segment_kinds?: SegmentKind[]
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
    /** Subset of `training_examples_used` that were rendered as VISUAL
     *  overlay tiles (satellite + green polygon) and sent as multimodal
     *  images, vs. text-only fallback. Lets us correlate accuracy
     *  improvements with whether visuals fired. */
    visual_examples_count?: number
    raw_model_confidence?: number
    calibration_factor?: number
    /** finalConfidence × calibration_factor — kept as a diagnostic only. The
     *  top-level `confidence` field is the raw post-refinement model value. */
    calibrated_confidence?: number
    lesson_memo_chars?: number
    /** Whether the agent had the DSM hillshade image in its prompt. */
    dsm_hillshade_used: boolean
    dsm_hillshade_quality?: 'HIGH' | 'MEDIUM' | 'BASE'
    dsm_imagery_date?: string
    /** True when the Solar building mask was applied during DSM render —
     *  tree-canopy pixels zeroed so hillshade only carries roof structure. */
    dsm_mask_applied?: boolean
    /** Whether the agent had the 3D viewport image in its prompt. */
    viewport_3d_used: boolean
    /** Second-pass self-critique for eaves only — feeds the first-draft polygon
     *  back to Claude overlaid on the satellite image so it can spot end-notches
     *  it missed. 'skipped-non-eaves' for hips/ridges. 'skipped-high-iou' when
     *  the first draft already overlaps the Solar bbox ≥ 0.85 IoU (running the
     *  critique on already-good drafts degrades them per Huang et al. 2023). */
    refinement_pass: 'improved' | 'no-change' | 'failed' | 'skipped-non-eaves' | 'skipped-empty-draft' | 'skipped-high-iou'
    refinement_vertices_added?: number
    refinement_elapsed_ms?: number
    /** First-draft IoU vs Solar bbox (0-1, 3 decimals). Only populated when a
     *  trusted Solar bbox exists. Drives the skip/run decision for the critique. */
    refinement_iou_gate?: number
    /** True when Manhattan-world dominant-angle snapping changed at least one
     *  vertex. False/undefined means either snapping was skipped (hips/ridges,
     *  or input.skipAngleSnapping) or the polygon was already orthogonal. */
    angle_snapping_applied?: boolean
    /** True when collinear-vertex smoothing dropped any vertices. Surfaces
     *  for diagnostic: a high-vertex-count polygon that got smoothed is
     *  a different signal than one that wasn't (the smoothed one is
     *  legitimately complex). */
    smoothing_applied?: boolean
    /** Sanity-gate signal: how many polygons we returned vs how many roof
     *  segments Solar API detected for this address. Drift of |delta| > 1
     *  flags either a Claude collapse (merged segments) or a Solar miscount
     *  (Solar over-detected facets). Only populated for the eaves path with
     *  a trusted Solar bbox. */
    plane_count_drift?: { agent_polygons: number; solar_segments: number; delta: number }
    /** Footprint-area ratio: traced polygon area (sqft) / Solar bbox area
     *  (sqft). 0.8-1.2 is healthy; outside is a leading indicator of trace
     *  drift. Same gating as plane_count_drift. */
    footprint_area_ratio?: number
    /** Extended-thinking token budget used on this run (0 = disabled). */
    thinking_budget?: number
    /** True when a wide-context (zoom-1) tile was fetched + sent. */
    wide_context_used?: boolean
    /** True when the Set-of-Marks grid overlay was rendered + sent. */
    grid_overlay_used?: boolean
    /** Complexity bucket derived from Solar segment count — 'low' (≤2),
     *  'mid' (3-4), 'hi' (5+). Carried through to auto_trace_corrections
     *  via the route handler so lessonMemo + calibration can segment. */
    complexity_bucket?: string
    /** External building-footprint priors that returned a polygon near
     *  the click point. Each is `source/area_sqft/vertex_count`. */
    footprint_priors?: Array<{ source: string; area_sqft: number; vertices: number; source_id?: string }>
    /** Per-source priors timings (ms) so a slow Overpass doesn't silently
     *  bloat auto-trace latency. */
    footprint_priors_elapsed_ms?: { edmonton?: number; osm?: number }
    /** True when VARI vegetation tint was applied (canopy painted magenta). */
    vegetation_tint_applied?: boolean
    /** Percentage of pixels flagged as vegetation (0-100). Helps the operator
     *  decide whether tree-occlusion was a likely failure mode on this run. */
    vegetation_pct?: number
    /** True when the satellite tile was Lanczos-upscaled to 1568×1568 before
     *  being sent to Claude. */
    upscale_applied?: boolean
    /** Time spent in PNG decode + tint + Lanczos + re-encode (ms). 0 when no
     *  preprocessing was requested. */
    preprocess_elapsed_ms?: number
    /** Dimensions of the image Claude actually saw (vs the projection grid,
     *  always safeW*2 = 1280). */
    sent_image_dim?: number
    /** True when the user-drawn hint region was successfully rendered onto
     *  the satellite tile. False/undefined when no hint was provided or
     *  rendering failed (the run still proceeds, just without the hint). */
    hint_applied?: boolean
    /** Hint geometry in pixel space of the sent image — for debugging. */
    hint_center_px?: { x: number; y: number }
    hint_radius_px?: number
    /** True when Solar segment overlay was rendered onto the satellite tile. */
    solar_overlay_applied?: boolean
    /** Number of Solar planes drawn (only when overlay applied). */
    solar_segments_overlaid?: number
    /** True when Solar API's high-res RGB ortho was fetched + included as
     *  a second image in the multimodal payload. */
    solar_rgb_used?: boolean
    /** Native dimensions + quality of the Solar RGB ortho image. */
    solar_rgb_dim?: { width: number; height: number; quality?: 'HIGH' | 'MEDIUM' | 'BASE' }
    model: string
    elapsed_ms: number
  }
}

// ─────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────
export async function runAutoTrace(env: Bindings, input: AutoTraceInput): Promise<AutoTraceResult> {
  const started = Date.now()
  // Mint a stable per-run UUID so the learning loop can correlate draft
  // → submit pairs deterministically (replaces the fuzzy 2h log match).
  // crypto.randomUUID is on workerd by default; manual fallback covers any
  // legacy runtime that hasn't enabled it yet.
  const runId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `at-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  const zoom = clampZoom(input.zoom)
  const safeW = Math.min(input.imageWidth || 640, 640)
  const safeH = Math.min(input.imageHeight || 640, 640)

  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not configured — auto-trace requires Claude vision')
  }
  if (!env.GOOGLE_MAPS_API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY not configured — auto-trace needs a satellite image')
  }

  // Footprint priors (OSM + Edmonton city LiDAR) — fetched in parallel
  // with Solar so they don't add to total latency. Both are best-effort:
  // any failure is logged + ignored. The result is fed to the prompt as
  // cross-check context AND used to validate Solar's bbox trust.
  //
  // Hard timeout at 1.2s so a slow Overpass server (rural acreages
  // routinely hang 5-10s) doesn't drag the entire auto-trace wall-clock
  // — the priors are context-only, not on the critical accuracy path.
  // 1.2s is roughly 95th-percentile for healthy Overpass responses; lots
  // that need longer probably wouldn't have returned anything useful
  // anyway.
  const priorsP = Promise.race<{ priors: any[]; elapsed_ms: any; errors: any }>([
    fetchFootprintPriors(input.lat, input.lng).catch((e: any) => {
      console.warn('[auto-trace] footprint priors failed:', e?.message)
      return { priors: [], elapsed_ms: {}, errors: {} }
    }),
    new Promise((resolve) => setTimeout(() => resolve({ priors: [], elapsed_ms: { timeout: 1200 }, errors: { timeout: 'priors_timeout_1200ms' } }), 1200)),
  ])

  // Solar API gives us the building's actual lat/lng bounding box. We need
  // that BEFORE choosing the satellite image centre/zoom so we can frame
  // the image tightly on the target — otherwise the user's pin (often
  // landing on a lot boundary or in front of the actual building) puts a
  // neighbour right next to the target and Claude tries to trace both.
  const [solarInsights, footprintPriorsResult] = await Promise.all([
    safelyFetchSolar(env, input.lat, input.lng),
    priorsP,
  ])
  const solarSummary = summarizeSolar(solarInsights)

  // Pick the satellite image's centre + zoom. When Solar gives us a
  // trusted (≤60ft per side) bbox, recentre on its centroid and bump zoom
  // up one notch so the building fills the frame. Falls back to the
  // user's pin + their map zoom otherwise.
  const framing = chooseImageFraming(solarInsights, input.lat, input.lng, zoom)

  const imageUrl = buildSatelliteImageUrl(framing.lat, framing.lng, framing.zoom, safeW, safeH, env.GOOGLE_MAPS_API_KEY)

  // Optional wide-context tile — one zoom level out, same centre. Gives
  // Claude property-boundary awareness without inflating the primary tile.
  const wideContextUrl = input.wideContext && framing.zoom > 17
    ? buildSatelliteImageUrl(framing.lat, framing.lng, framing.zoom - 1, safeW, safeH, env.GOOGLE_MAPS_API_KEY)
    : null

  // Optional Set-of-Marks grid overlay — pure-JS render, no external call.
  // Cheap to compute (~50ms) so we just kick it off in parallel.
  const gridP = input.gridOverlay
    ? renderGridOverlay(safeW * 2, safeH * 2).catch((e: any) => {
        console.warn('[auto-trace] grid overlay render failed:', e?.message)
        return null
      })
    : Promise.resolve(null)

  // Fetch the raster inputs in parallel. All centred on framing.lat/lng at
  // framing.zoom so pixel grids align 1:1 with the primary image.
  // Solar RGB GeoTIFF runs in parallel too — when it returns, it gets
  // sent to Claude as a second high-resolution reference image (10cm/px
  // native, building-cropped) alongside the Google Static Maps primary.
  const [satellite, hillshade, wideContext, gridOverlay, solarRgb] = await Promise.all([
    fetchImageB64(imageUrl),
    fetchDsmHillshade(env, framing.lat, framing.lng, safeW * 2).catch((e: any) => {
      console.warn('[auto-trace] DSM hillshade fetch failed:', e?.message)
      return null
    }),
    wideContextUrl
      ? fetchImageB64(wideContextUrl).catch((e: any) => {
          console.warn('[auto-trace] wide-context tile fetch failed:', e?.message)
          return null
        })
      : Promise.resolve(null),
    gridP,
    fetchSolarRgbOrtho(env, framing.lat, framing.lng).catch((e: any) => {
      console.warn('[auto-trace] Solar RGB fetch failed:', e?.message)
      return null
    }),
  ])
  let imageB64 = satellite.b64
  let imageMediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' = satellite.mediaType
  // Image dimensions Claude actually sees. Defaults to Static Maps' native
  // safeW*2 × safeH*2 (e.g. 1280×1280). If upscaling is applied below this
  // becomes 1568×1568; Claude's returned coords are in this frame and we
  // scale them back to the 1280 grid before projection.
  let actualImageDim = safeW * 2
  let vegetationTintApplied = false
  let vegetationPct: number | undefined
  let upscaleApplied = false
  let preprocessElapsedMs = 0

  // Optional preprocessing: VARI vegetation tint + Lanczos upscale. Both
  // require decoding the PNG to RGBA, mutating pixels, then re-encoding.
  // Wrapped in a single try/catch so any failure (non-PNG response,
  // corrupt bytes, CPU budget exhaustion) falls back to the raw tile.
  // Stub the per-flag state — populated by the merged preprocessing
  // pipeline below. Declared up here so the prompt / diagnostics can
  // read them after the merged block runs.
  let solarOverlayApplied = false
  let solarSegmentsOverlaid = 0
  let hintApplied = false
  let hintCenterPx: { x: number; y: number } | null = null
  let hintRadiusPx: number | null = null
  // Pre-derive whether the operator drew a Mark Region — used in the
  // merged pipeline AND in the bbox / framing branches below.
  const hintIsValid = !!(input.hintRegion && Number.isFinite(input.hintRegion.centerLat)
    && Number.isFinite(input.hintRegion.centerLng) && Number.isFinite(input.hintRegion.radiusMeters))

  // Merged preprocessing pipeline — single decode + single encode for
  // VARI tint + Lanczos upscale + Solar segment overlay + Hint region
  // overlay. Previously each ran its own PNG round-trip (3 decodes + 3
  // encodes on a 1280×1280 RGBA buffer ≈ 1.5-2s of wasted CPU). Now
  // each operation is an in-place mutation on the same shared buffer.
  const needsAnyPreprocess = imageMediaType === 'image/png' && (
    input.vegetationTint || input.upscaleTo1568 ||
    (input.solarSegmentOverlay !== false) || hintIsValid
  )
  if (needsAnyPreprocess) {
    const ppStart = Date.now()
    try {
      const pngBytes = Uint8Array.from(atob(imageB64), c => c.charCodeAt(0))
      let img = await decodePNG(pngBytes)

      // 1. VARI vegetation tint (cheap pixel pass; magenta carries through Lanczos cleanly).
      if (input.vegetationTint) {
        const tinted = applyVARITint(img, { threshold: 0.05, blendStrength: 0.45 })
        img = tinted.tinted
        vegetationPct = tinted.vegetationPct
        vegetationTintApplied = true
      }

      // 2. Lanczos upscale 1280 → 1568 (~Claude's vision ceiling).
      if (input.upscaleTo1568 && img.width < 1568) {
        img = lanczosResize(img, 1568, 1568)
        upscaleApplied = true
      }
      actualImageDim = img.width

      // 3. Solar segment overlay (each detected roof plane → coloured rect).
      if (input.solarSegmentOverlay !== false) {
        const segPx = extractSolarSegmentBboxesPx(solarInsights, framing, img.width, img.height, safeW)
        if (segPx && segPx.length >= 2) {
          drawSolarSegmentOverlay(img.rgba, img.width, img.height, segPx)
          solarOverlayApplied = true
          solarSegmentsOverlaid = segPx.length
        }
      }

      // 4. Hint region overlay (red dashed circle from operator Mark Region).
      if (hintIsValid && input.hintRegion) {
        const radiusM = Math.max(5, Math.min(200, input.hintRegion.radiusMeters))
        const scale = 1 << framing.zoom
        const centerSin = Math.sin(framing.lat * Math.PI / 180)
        const centerWorldX = (256 * (0.5 + framing.lng / 360)) * scale
        const centerWorldY = (256 * (0.5 - Math.log((1 + centerSin) / (1 - centerSin)) / (4 * Math.PI))) * scale
        const hintSin = Math.sin(input.hintRegion.centerLat * Math.PI / 180)
        const hintWorldX = (256 * (0.5 + input.hintRegion.centerLng / 360)) * scale
        const hintWorldY = (256 * (0.5 - Math.log((1 + hintSin) / (1 - hintSin)) / (4 * Math.PI))) * scale
        const worldUnitsPerImgPx = safeW / img.width
        const hintPxX = Math.round((hintWorldX - centerWorldX) / worldUnitsPerImgPx + img.width / 2)
        const hintPxY = Math.round((hintWorldY - centerWorldY) / worldUnitsPerImgPx + img.height / 2)
        const groundMPerWorldUnit = (40_075_016 * Math.cos(framing.lat * Math.PI / 180)) / (256 * scale)
        const radiusPx = Math.round(radiusM / groundMPerWorldUnit / worldUnitsPerImgPx)
        drawHintCircle(img.rgba, img.width, img.height, hintPxX, hintPxY, radiusPx)
        hintCenterPx = { x: hintPxX, y: hintPxY }
        hintRadiusPx = radiusPx
        hintApplied = true
      }

      // 5. Single encode + base64 swap.
      const reencoded = await encodePNG(img)
      let bin = ''
      const chunk = 0x8000
      for (let i = 0; i < reencoded.length; i += chunk) {
        bin += String.fromCharCode(...reencoded.subarray(i, Math.min(i + chunk, reencoded.length)))
      }
      imageB64 = btoa(bin)
      imageMediaType = 'image/png'
    } catch (e: any) {
      console.warn('[auto-trace] merged preprocessing failed (falling back to raw tile):', e?.message)
      vegetationTintApplied = false
      upscaleApplied = false
      solarOverlayApplied = false
      solarSegmentsOverlaid = 0
      hintApplied = false
      hintCenterPx = null
      hintRadiusPx = null
    } finally {
      preprocessElapsedMs = Date.now() - ppStart
    }
  }

  // Derive a complexity bucket from Solar's segment count so lessonMemo +
  // calibration can segment their stats. Same bucketing that
  // refreshTracedIndexCache uses for diversity selection. Stored on the
  // correction row at submit time too — closes the loop.
  const complexityBucket =
    solarSummary.segments_count <= 2 ? 'low'
    : solarSummary.segments_count <= 4 ? 'mid'
    : 'hi'

  // Past human traces of similar properties + lesson memo from past
  // corrections + calibration factor — all three are how this agent
  // adapts to super-admin edits over time. Each is tolerant of an
  // empty data pool so first-day behavior matches steady-state behavior.
  // Derive a sqft target from the Solar bbox so the few-shot retriever's
  // sqftDelta scoring isn't degenerate. Previously this caller never
  // passed targetSqft → scoreExample fell back to 0.5 for every example
  // → similarity ranking ignored building size entirely. With Solar bbox
  // dimensions available we get a clean signal for free.
  const targetSqftFromSolar = solarSummary.available && solarSummary.bbox_width_ft > 0 && solarSummary.bbox_depth_ft > 0
    ? Math.round(solarSummary.bbox_width_ft * solarSummary.bbox_depth_ft)
    : undefined

  const [examples, lessonMemo, calibrationFactor] = await Promise.all([
    fetchTrainingExamples(env, {
      edge: input.edge,
      centroidLat: framing.lat,
      centroidLng: framing.lng,
      targetSegments: solarSummary.segments_count,
      targetSqft: targetSqftFromSolar,
      limit: 5,
      excludeOrderIds: input.excludeOrderIds,
    }),
    buildLessonMemo(env, input.edge, complexityBucket),
    getCalibrationFactor(env, input.edge, complexityBucket),
  ])

  // ── Solar segment overlay — structural ground-truth from a separate sensor ──
  // Render each Solar-detected roof plane as a colored translucent
  // rectangle on the satellite tile. Solar's segment detection is
  // DSM-derived from LiDAR-class height data; it's independent from
  // the visible imagery the model otherwise sees. Strongest free
  // signal in the pipeline — eliminates the wrong-shape / missed-
  // a-wing failure modes on multi-tier roofs. Default ON.
  // Projection grid (Mercator) is always safeW*2 × safeH*2 = 1280×1280
  // regardless of whether the actual sent image is upscaled. Claude's
  // returned coords are scaled back from `actualImageDim` to this grid
  // immediately after parsing so pxToLatLng works unchanged.
  // (Moved up from below the overlays — Solar overlay needs targetBboxPx,
  // and the JS temporal-dead-zone bites when const is referenced before its
  // declaration line. This block must precede any overlay that reads it.)
  const imagePxW = safeW * 2
  const imagePxH = safeH * 2
  const projectionToSentScale = actualImageDim / imagePxW
  // When the operator drew a Mark Region AND the overlay actually
  // rendered onto the satellite tile, derive the bbox from the hint —
  // hint is AUTHORITATIVE and overrides Solar. Critical for acreages
  // where Solar returns an untrusted-and-clamped 60ft box that would
  // otherwise shrink a legitimate 5000-7000 sqft trace. When the
  // overlay render failed (PNG codec error etc.), fall back to Solar
  // since we can't promise the model a circle that isn't there.
  const hintBboxPx = (hintApplied && input.hintRegion && Number.isFinite(input.hintRegion.radiusMeters))
    ? computeHintBboxPx(input.hintRegion, framing.lat, framing.lng, framing.zoom, imagePxW, imagePxH)
    : null
  const projectionBboxPx = hintBboxPx
    ?? computeTargetBboxPx(solarInsights, framing.lat, framing.lng, framing.zoom, imagePxW, imagePxH)
  const targetCenterPx = {
    x: Math.round((imagePxW / 2) * projectionToSentScale),
    y: Math.round((imagePxH / 2) * projectionToSentScale),
  }
  const targetBboxPx = projectionBboxPx
    ? {
        x1: Math.round(projectionBboxPx.x1 * projectionToSentScale),
        y1: Math.round(projectionBboxPx.y1 * projectionToSentScale),
        x2: Math.round(projectionBboxPx.x2 * projectionToSentScale),
        y2: Math.round(projectionBboxPx.y2 * projectionToSentScale),
        widthFt: projectionBboxPx.widthFt,
        depthFt: projectionBboxPx.depthFt,
        trusted: projectionBboxPx.trusted,
        source: projectionBboxPx.source,
      }
    : null

  // (Solar segment overlay + hint region overlay now run inside the
  // merged preprocessing pipeline above — single decode + single encode
  // for all four pixel-level transforms.)

  const hasViewport3d = !!(input.viewport3dB64 && input.viewport3dB64.length > 1000)

  // ── Few-shot VISUAL examples ─────────────────────────────────
  // Render each past super-admin trace as a satellite tile with its eaves
  // polygon overlaid in green via Static Maps `path=`. Same server-side
  // overlay technique used by `refineEavesViaSelfCritique`. Far better
  // shape signal than dumping lat/lng JSON Claude was previously told to
  // ignore. Cap at top-3 to keep the multimodal payload bounded
  // (~1.5MB across 3 base64 tiles). Examples that fail rendering (no
  // coords / URL overflow / fetch failure) fall back to text-only.
  const VISUAL_EXAMPLE_CAP = 3
  const renderedVisualExamples: RenderedExampleOverlay[] = []
  if (!input.skipVisualExamples && examples.length > 0) {
    const top = examples.slice(0, VISUAL_EXAMPLE_CAP)
    const results = await Promise.all(top.map(ex => renderExampleOverlay(env, ex, input.edge)))
    for (const r of results) {
      if (r) renderedVisualExamples.push(r)
    }
  }
  const visualExampleOrderIds = new Set(renderedVisualExamples.map(v => v.example.order_id))

  // (Projection-grid + targetBboxPx now computed earlier in the function,
  // before the Solar / hint overlays that read them.)
  const systemPrompt = buildSystemPrompt(input.edge, lessonMemo, {
    hasHillshade: !!hillshade,
    hasViewport3d,
    hasWideContext: !!wideContext,
    hasGridOverlay: !!gridOverlay,
    hasSolarRgb: !!solarRgb,
    solarRgbInfo: solarRgb ? { width: solarRgb.width, height: solarRgb.height, quality: solarRgb.quality } : null,
    vegetationTintApplied,
    hintApplied,
    hintCenterPx,
    hintRadiusPx,
    solarOverlayApplied,
    solarSegmentsOverlaid,
    targetCenterPx,
    targetBboxPx,
    includeOutbuildings: !!input.includeOutbuildings,
    visualExamples: renderedVisualExamples,
  })
  const userPrompt = buildUserPrompt({
    edge: input.edge,
    // Tell Claude the dimensions of the image it ACTUALLY sees (may be
    // upscaled to 1568). targetCenterPx + targetBboxPx are already in that
    // sent-image frame above; coords come back in the sent-image frame and
    // get scaled to the projection grid before pxToLatLng.
    imagePxW: actualImageDim,
    imagePxH: actualImageDim,
    solarSummary,
    examples,
    hillshade,
    hasWideContext: !!wideContext,
    hasGridOverlay: !!gridOverlay,
    hasViewport3d,
    targetCenterPx,
    targetBboxPx,
    footprintPriors: footprintPriorsResult.priors,
    visualExamples: renderedVisualExamples,
    visualExampleOrderIds,
  })

  // Build the multimodal content array. Order MUST match the system-
  // prompt image roster: satellite → solar-rgb → hillshade → wide-context →
  // grid-overlay → 3D-oblique → text. Anything that drifts out of order
  // means Claude reads about Image 2 while looking at Image 3.
  const content: any[] = [
    { type: 'image', source: { type: 'base64', media_type: imageMediaType, data: imageB64 } },
  ]
  if (solarRgb) {
    content.push({ type: 'image', source: { type: 'base64', media_type: solarRgb.mediaType, data: solarRgb.b64 } })
  }
  // Visual few-shot examples — past super-admin traces of similar properties,
  // rendered as satellite tiles with the operator's polygon overlaid. Placed
  // between primary/solar imagery and structural overlays (hillshade etc.)
  // so Claude reads them while the building is still visually anchored.
  // Order MUST match the captions added in buildSystemPrompt's image roster.
  for (const ex of renderedVisualExamples) {
    content.push({ type: 'image', source: { type: 'base64', media_type: ex.mediaType, data: ex.b64 } })
  }
  if (hillshade) {
    content.push({ type: 'image', source: { type: 'base64', media_type: hillshade.mediaType, data: hillshade.b64 } })
  }
  if (wideContext) {
    content.push({ type: 'image', source: { type: 'base64', media_type: wideContext.mediaType, data: wideContext.b64 } })
  }
  if (gridOverlay) {
    content.push({ type: 'image', source: { type: 'base64', media_type: gridOverlay.mediaType, data: gridOverlay.b64 } })
  }
  if (hasViewport3d) {
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: stripDataUrl(input.viewport3dB64!) } })
  }
  content.push({ type: 'text', text: userPrompt })

  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  // Tool-use enforced output. Previously we asked Claude for "strict JSON
  // only" in prose and parsed the response (with two fallback layers — fence
  // stripping + last-ditch regex). That contract leaks ~3-5% of the time
  // (markdown fences, trailing prose, missing fields). With a typed tool
  // schema the SDK guarantees a structured input that maps 1:1 to our parser.
  const emitTraceTool = buildEmitTraceTool(input.edge)
  const thinkingBudget = Math.max(0, Math.min(8000, Math.floor(Number(input.thinkingBudget) || 0)))
  const messageArgs: any = {
    // Opus 4.7 deprecated the `temperature` knob — leave the default.
    model: CLAUDE_VISION_MODEL,
    max_tokens: thinkingBudget > 0 ? Math.max(4096, thinkingBudget + 4096) : 4096,
    system: systemPrompt,
    tools: [emitTraceTool],
    tool_choice: { type: 'tool', name: emitTraceTool.name },
    messages: [{ role: 'user', content }],
  }
  if (thinkingBudget > 0) {
    // Extended thinking lets the model produce internal reasoning tokens
    // before emitting the tool call. Useful when the question is "how many
    // segments are there?" or "does this polygon match the Solar bbox?".
    // tool_choice must be 'auto' (not 'tool') when thinking is enabled — the
    // SDK rejects forcing a tool with thinking. Schema is still enforced
    // since we only registered one tool and the system prompt directs to it.
    messageArgs.thinking = { type: 'enabled', budget_tokens: thinkingBudget }
    messageArgs.tool_choice = { type: 'auto' }
  }
  const completion = await anthropic.messages.create(messageArgs as any)

  const parsed = parseToolResponse(completion)
  // Claude returned coords in the dimensions of the image it actually saw
  // (actualImageDim × actualImageDim). Our projection helpers expect the
  // 1280-grid Static Maps tile (imagePxW × imagePxH). Scale back BEFORE
  // any downstream geometry (IoU gate, refinement, snapping, projection).
  if (projectionToSentScale !== 1) {
    const inv = 1 / projectionToSentScale
    parsed.segments = parsed.segments.map(seg => seg.map(p => ({
      x: Math.round(p.x * inv),
      y: Math.round(p.y * inv),
    })))
  }

  // ── Self-critique pass (eaves only) ───────────────────────────
  // Feed the first-draft polygon back to Claude overlaid on the satellite
  // image so it can spot porch bump-outs, attached garages, and (most
  // importantly) tree-occluded edges it stopped short of on the first
  // pass. Hips/ridges are a different problem and skip this pass.
  let finalSegmentsPx = parsed.segments
  let finalConfidence = parsed.confidence
  let finalReasoning = parsed.reasoning
  let finalKinds: SegmentKind[] | undefined = parsed.kinds
  let refinementPass: 'improved' | 'no-change' | 'failed' | 'skipped-non-eaves' | 'skipped-empty-draft' | 'skipped-high-iou' = 'skipped-non-eaves'
  let refinementVerticesAdded = 0
  let refinementElapsedMs = 0

  let refinementIouGate: number | undefined
  if (input.edge === 'eaves') {
    if (parsed.segments.length === 0 || parsed.segments.every(s => s.length < 3)) {
      refinementPass = 'skipped-empty-draft'
    } else if (
      // High-confidence single-polygon drafts almost never improve via
      // critique — skip the second Claude call to save 6-12s.
      parsed.confidence >= 90 && parsed.segments.length === 1
    ) {
      refinementPass = 'skipped-high-iou'  // reuse the existing diagnostic value
    } else if (
      projectionBboxPx && projectionBboxPx.trusted &&
      (() => {
        // Pick the LARGEST polygon as the primary; small ancillary polygons
        // (porches/garages) shouldn't decide whether we re-run the critique.
        // Compared in the PROJECTION grid (1280) since both coords have been
        // scaled back already.
        const primary = parsed.segments.reduce((a, b) => a.length >= b.length ? a : b)
        const iou = computeIoUWithRect(primary, projectionBboxPx)
        refinementIouGate = Math.round(iou * 1000) / 1000
        // 0.85 threshold matches the Huang et al. + Lightman et al. guidance:
        // running self-critique on already-good drafts degrades them ~20-30%
        // of the time. Above 0.85 IoU the first draft is already in the
        // right place; the critique can only churn vertices, not improve
        // shape. Below 0.85 the critique still has room to add value.
        return iou >= 0.85
      })()
    ) {
      refinementPass = 'skipped-high-iou'
    } else {
      const refineStart = Date.now()
      try {
        const refined = await refineEavesViaSelfCritique(env, anthropic, {
          originalImageB64: imageB64,
          originalMediaType: imageMediaType,
          draftSegmentsPx: parsed.segments,
          framing,
          safeW,
          safeH,
          targetCenterPx,
          targetBboxPx,
        })
        refinementElapsedMs = Date.now() - refineStart
        if (refined) {
          finalSegmentsPx = refined.segments
          finalConfidence = Math.max(finalConfidence, refined.confidence)
          finalReasoning = refined.reasoning
          refinementVerticesAdded = refined.verticesAdded
          refinementPass = refined.verticesAdded > 0 ? 'improved' : 'no-change'
          // If the refinement added vertices (e.g. split a 2-story house into
          // upper + lower polygons, or attached a garage), the index-based
          // kinds mapping from the first pass is no longer guaranteed to
          // align. Drop so the UI treats every segment as 'main' rather than
          // mislabel them.
          if (refined.verticesAdded > 0) finalKinds = undefined
        } else {
          refinementPass = 'failed'
        }
      } catch (e: any) {
        console.warn('[auto-trace] refinement threw:', e?.message)
        refinementPass = 'failed'
        refinementElapsedMs = Date.now() - refineStart
      }
    }
  }

  const pixelImgW = safeW * 2
  const pixelImgH = safeH * 2
  // Apply Manhattan-world dominant-angle snapping to eaves polygons before
  // projection. **Default OFF** as of 2026-05-11 after a regression where
  // bay windows / angled wings / hex porches got their real corners
  // flattened. Opt-in via `enableAngleSnapping: true` per call when the
  // building is genuinely rectilinear.
  const snappingRequested = input.enableAngleSnapping === true ||
    (input.skipAngleSnapping === false && input.enableAngleSnapping !== false)
  let snappingApplied = false
  if (input.edge === 'eaves' && snappingRequested) {
    const before = finalSegmentsPx
    finalSegmentsPx = finalSegmentsPx.map(seg => seg.length >= 4 ? snapPolygonToDominantAngle(seg) : seg)
    snappingApplied = finalSegmentsPx.some((seg, i) => seg !== before[i])
  }

  // Polygon smoothing — drop near-collinear vertices (sub-pixel stair-
  // step jitter on what should be straight walls). Default ON for
  // eaves: tolerance is 2px in the projection grid ≈ 6 inches at z=21,
  // well below the underlying coord precision. Never reduces below 3
  // vertices. Cuts operator cleanup time on every trace without
  // changing real shape.
  let smoothingApplied = false
  if (input.edge === 'eaves' && input.skipSmoothing !== true) {
    const before = finalSegmentsPx
    finalSegmentsPx = finalSegmentsPx.map(seg => seg.length >= 5 ? smoothPolygonRemoveCollinear(seg, 2) : seg)
    smoothingApplied = finalSegmentsPx.some((seg, i) => seg.length !== before[i].length)
  }

  // Project Claude's pixel coords back to GPS using the SAME centre + zoom
  // that produced the satellite image (which may be Solar-recentred, not
  // the user's original pin).
  const segments = finalSegmentsPx.map(seg => seg.map(p => pxToLatLng(p.x, p.y, framing.lat, framing.lng, framing.zoom, pixelImgW, pixelImgH)))

  // Verify-Planes sanity gate (eaves + trusted Solar bbox only). Compares
  // agent output against the two Solar signals we already have (segment
  // count + bbox area). Surfaced as diagnostics, NOT used to mutate the
  // returned polygon — operator sees the drift and decides. Cheap; no
  // extra service calls. Engine-level Verify-Planes (faces × pitches)
  // requires a full UiTrace which the single-edge agent can't synthesize.
  let planeCountDrift: { agent_polygons: number; solar_segments: number; delta: number } | undefined
  let footprintAreaRatio: number | undefined
  if (input.edge === 'eaves' && targetBboxPx && targetBboxPx.trusted && solarSummary.available && finalSegmentsPx.length > 0) {
    const solarSegs = solarSummary.segments_count
    const agentPolys = finalSegmentsPx.length
    planeCountDrift = { agent_polygons: agentPolys, solar_segments: solarSegs, delta: agentPolys - solarSegs }
    // Pixel-space area → real sqft via the same Mercator scale. At
    // zoom 21 / scale=2 / lat ≈53°N, 1 px ≈ 0.146 ft. Use the framing
    // zoom because that's what produced the pixels.
    const scale = 1 << framing.zoom
    const groundMPerPx = (40_075_016 * Math.cos((framing.lat * Math.PI) / 180)) / (256 * scale * 2)
    const ftPerPx = groundMPerPx * 3.28084
    const ftPerPx2 = ftPerPx * ftPerPx
    const tracedAreaSqft = finalSegmentsPx.reduce((sum, seg) => sum + polygonArea(seg) * ftPerPx2, 0)
    const solarAreaSqft = targetBboxPx.widthFt * targetBboxPx.depthFt
    if (solarAreaSqft > 0) {
      footprintAreaRatio = Math.round((tracedAreaSqft / solarAreaSqft) * 100) / 100
    }
  }

  // Calibration: kept as a diagnostic, NO LONGER multiplied into the surfaced
  // confidence. The previous behavior actively destroyed the signal we need —
  // "high model confidence + high edit rate" is itself useful to the UI
  // ("model thinks it's right but historically wasn't"); squashing it into a
  // single number hid that. Confidence the UI sees is now the raw post-
  // refinement model value. `calibration_factor` and `calibrated_confidence`
  // are still in diagnostics for any consumer that wants them.
  const calibratedConfidence = Math.round(finalConfidence * calibrationFactor)

  return {
    edge: input.edge,
    run_id: runId,
    segments,
    ...(finalKinds && finalKinds.length === segments.length ? { segment_kinds: finalKinds } : {}),
    confidence: finalConfidence,
    reasoning: finalReasoning,
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
      visual_examples_count: renderedVisualExamples.length || undefined,
      raw_model_confidence: parsed.confidence,
      calibration_factor: calibrationFactor,
      calibrated_confidence: calibratedConfidence,
      lesson_memo_chars: lessonMemo.length,
      dsm_hillshade_used: !!hillshade,
      dsm_hillshade_quality: hillshade?.quality,
      dsm_imagery_date: hillshade?.imageryDate,
      dsm_mask_applied: hillshade?.maskApplied,
      viewport_3d_used: hasViewport3d,
      refinement_pass: refinementPass,
      refinement_vertices_added: refinementVerticesAdded,
      refinement_elapsed_ms: refinementElapsedMs,
      refinement_iou_gate: refinementIouGate,
      angle_snapping_applied: snappingApplied,
      smoothing_applied: smoothingApplied || undefined,
      plane_count_drift: planeCountDrift,
      footprint_area_ratio: footprintAreaRatio,
      thinking_budget: thinkingBudget || undefined,
      wide_context_used: !!wideContext,
      grid_overlay_used: !!gridOverlay,
      complexity_bucket: complexityBucket,
      footprint_priors: footprintPriorsResult.priors.length > 0
        ? footprintPriorsResult.priors.map(p => ({
            source: p.source,
            area_sqft: Math.round(p.area_sqft),
            vertices: p.ring.length,
            source_id: p.source_id,
          }))
        : undefined,
      footprint_priors_elapsed_ms: footprintPriorsResult.elapsed_ms,
      vegetation_tint_applied: vegetationTintApplied || undefined,
      vegetation_pct: vegetationPct,
      upscale_applied: upscaleApplied || undefined,
      preprocess_elapsed_ms: preprocessElapsedMs || undefined,
      sent_image_dim: actualImageDim,
      hint_applied: hintApplied || undefined,
      hint_center_px: hintCenterPx || undefined,
      hint_radius_px: hintRadiusPx ?? undefined,
      solar_overlay_applied: solarOverlayApplied || undefined,
      solar_segments_overlaid: solarSegmentsOverlaid || undefined,
      solar_rgb_used: !!solarRgb || undefined,
      solar_rgb_dim: solarRgb ? { width: solarRgb.width, height: solarRgb.height, quality: solarRgb.quality } : undefined,
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
  // Asymmetric trust check (was: widthFt ≤ 60 && depthFt ≤ 60). The old
  // symmetric 60ft cutoff failed long-narrow townhouses (e.g. Vancouver
  // 25×100ft rowhouses → depthFt=100 → untrusted → 60ft clamp crops the
  // rear of the building). New check: max(w,d) ≤ 100ft AND area ≤ 4500
  // sqft. Long-narrow lots pass; genuine merged-neighbour bboxes
  // (typically square and > 5000 sqft) still fail.
  const trusted = Math.max(widthFt, depthFt) <= 100 && (widthFt * depthFt) <= 4500
  if (!trusted) {
    // Solar bbox is suspicious — could be merged neighbour OR genuine
    // acreage. Either way the centroid is usually still on the building,
    // so we STILL recentre, but cap the zoom at 21 (not zoom-out to user
    // pin zoom) to keep the building filling enough of the frame for
    // Claude to see fine eaves. Was previously falling back to userZoom
    // which often left an 80-120ft acreage filling 17-26% of the tile.
    const cLat = (sw.latitude + ne.latitude) / 2
    const cLng = (sw.longitude + ne.longitude) / 2
    // Default to z=21; drop to 20 only when the bbox suggests a genuine
    // huge acreage (>150ft per side) so the building fits in the frame.
    const untrustedZoom = Math.max(widthFt, depthFt) > 150 ? 20 : 21
    return { lat: cLat, lng: cLng, zoom: untrustedZoom, recentered: true }
  }
  const cLat = (sw.latitude + ne.latitude) / 2
  const cLng = (sw.longitude + ne.longitude) / 2
  // Zoom selection: target 55-65% frame fill so the building dominates
  // the image without cropping eaves. Compute the zoom level whose
  // ground-sampling-distance puts the longest building side at ~700px
  // (≈55% of the 1280px effective tile). Cap at 21 (Static Maps free
  // tier max). Previously hard-coded to "userZoom + 1" which often
  // gave 20 instead of 21 for small lots — leaving the building at
  // 25-35% of the frame.
  const longestSideFt = Math.max(widthFt, depthFt)
  const newZoom = pickZoomForBuildingSize(longestSideFt, cLat, 700, 2)
  return { lat: cLat, lng: cLng, zoom: newZoom, recentered: true }
}

/** Pick a Google Static Maps zoom level that makes the building fill roughly
 *  `targetFillPx` pixels of the rendered tile. Web-Mercator GSD doubles per
 *  zoom step; we walk from z=21 (Static Maps max) down until the building
 *  no longer overflows, with z=18 as the floor for huge rural acreages.
 *  Shared by the primary-image framing (scale=2, 700px target on a 1280px
 *  tile) and the few-shot visual-example framing (scale=1, 350px target
 *  on a 640px tile). */
function pickZoomForBuildingSize(longestSideFt: number, centerLat: number, targetFillPx: number, scale: 1 | 2): number {
  if (longestSideFt <= 0) return 21
  const targetGsdMeters = (longestSideFt * 0.3048) / targetFillPx
  for (let z = 21; z >= 18; z--) {
    const gsd = (40_075_016 * Math.cos((centerLat * Math.PI) / 180)) / (256 * (1 << z) * scale)
    if (gsd <= targetGsdMeters || z === 18) return z
  }
  return 18
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
/** Hint-derived bbox helper. When the operator drew a Mark Region, this
 *  produces an AUTHORITATIVE pixel bbox that supersedes Solar's. Returns
 *  the source='hint' tag so downstream prompt code can use the strongest
 *  possible language ("operator drew this, ignore Solar bbox"). */
function computeHintBboxPx(
  hint: { centerLat: number; centerLng: number; radiusMeters: number },
  centerLat: number, centerLng: number, zoom: number,
  imgW: number, imgH: number,
): { x1: number; y1: number; x2: number; y2: number; widthFt: number; depthFt: number; trusted: boolean; source: 'hint' } | null {
  if (!Number.isFinite(hint.radiusMeters) || hint.radiusMeters <= 0) return null
  const scale = 1 << zoom
  const centerSin = Math.sin(centerLat * Math.PI / 180)
  const centerWorldX = (256 * (0.5 + centerLng / 360)) * scale
  const centerWorldY = (256 * (0.5 - Math.log((1 + centerSin) / (1 - centerSin)) / (4 * Math.PI))) * scale
  const hintSin = Math.sin(hint.centerLat * Math.PI / 180)
  const hintWorldX = (256 * (0.5 + hint.centerLng / 360)) * scale
  const hintWorldY = (256 * (0.5 - Math.log((1 + hintSin) / (1 - hintSin)) / (4 * Math.PI))) * scale
  // Mercator world units → image pixels. computeTargetBboxPx uses the *2
  // hardcoded factor (Static Maps scale=2); we mirror that here.
  const cx = Math.round((hintWorldX - centerWorldX) * 2 + imgW / 2)
  const cy = Math.round((hintWorldY - centerWorldY) * 2 + imgH / 2)
  const groundMPerPx = (40_075_016 * Math.cos(centerLat * Math.PI / 180)) / (256 * scale * 2)
  const radiusPx = Math.max(1, Math.round(hint.radiusMeters / groundMPerPx))
  const widthFt = Math.round(hint.radiusMeters * 2 * 3.28084)
  const depthFt = widthFt
  return {
    x1: Math.max(0, cx - radiusPx),
    y1: Math.max(0, cy - radiusPx),
    x2: Math.min(imgW - 1, cx + radiusPx),
    y2: Math.min(imgH - 1, cy + radiusPx),
    widthFt, depthFt,
    trusted: true,   // hint is authoritative — never disable Solar overlay etc.
    source: 'hint',
  }
}

function computeTargetBboxPx(
  insights: any,
  centerLat: number, centerLng: number, zoom: number,
  imgW: number, imgH: number,
): { x1: number; y1: number; x2: number; y2: number; widthFt: number; depthFt: number; trusted: boolean; source: 'solar-trusted' | 'solar-untrusted' } | null {
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
  // Asymmetric trust (was widthFt ≤ 60 && depthFt ≤ 60). Long-narrow
  // residential rowhouses (e.g. Vancouver 25×100ft) need to pass the
  // trust check; genuine merged-neighbour bboxes (typically square &
  // > 5000 sqft) still fail. Threshold: max(w,d) ≤ 100ft AND area ≤ 4500
  // sqft.
  const trusted = Math.max(widthFt, depthFt) <= 100 && (widthFt * depthFt) <= 4500

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
  return { x1, y1, x2, y2, widthFt, depthFt, trusted, source: trusted ? 'solar-trusted' : 'solar-untrusted' }
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
    hasWideContext: boolean
    hasGridOverlay: boolean
    hasSolarRgb: boolean
    solarRgbInfo: { width: number; height: number; quality?: 'HIGH' | 'MEDIUM' | 'BASE' } | null
    vegetationTintApplied: boolean
    hintApplied: boolean
    hintCenterPx: { x: number; y: number } | null
    hintRadiusPx: number | null
    solarOverlayApplied: boolean
    solarSegmentsOverlaid: number
    targetCenterPx: { x: number; y: number }
    targetBboxPx: { x1: number; y1: number; x2: number; y2: number; widthFt: number; depthFt: number; trusted: boolean; source?: 'hint' | 'solar-trusted' | 'solar-untrusted' } | null
    includeOutbuildings: boolean
    visualExamples: RenderedExampleOverlay[]
  },
): string {
  const role = edge === 'eaves'
    ? 'detecting the OUTER PERIMETER of every building roof in the image — one closed polygon per structure (house + any detached garages/sheds visible). Trace at the EAVE LINE (drip edge), not the walls. Include all jogs and bump-outs as vertices of the polygon. ⚠️ FOR 2-STORY BUILDINGS: return the UPPER (main) roofline as ONE polygon AND any LOWER-TIER eave wraparound (porch roof, garage extension lower than the main roof, sunroom/mudroom add-on with its own drip line) as SEPARATE ADDITIONAL polygons in the segments array. Do NOT collapse a 2-story house into a single ring — the lower lip carries a different pitch and matters for the report. ⚠️ FOR ACREAGE / MULTI-WING HOMES: rural/acreage homes are often L-shape, U-shape, T-shape, or a main block with one or more perpendicular wings/extensions. Trace EVERY wing as part of the SAME closed polygon — do NOT stop at the central block. Wings, additions, attached garages, breezeways, sunrooms — all are part of the one building polygon as long as they share continuous eave-level roof with the main structure (no clear roof break / vertical wall separation visible from above). Simple residential traces are 8–16 vertices; multi-wing acreages routinely need 20–32 vertices — do not artificially cap. Corners only — no points on straight edges. Trees and shadows commonly hide parts of an eave — EXTRAPOLATE visible eave lines through the canopy. Residential roofs are RECTILINEAR with right-angle corners: if 3 sides are visible, the 4th follows by orthogonal projection from the last two visible corners. Do NOT stop the trace at the edge of a tree canopy and call that a corner.'
    : edge === 'ridges'
    ? 'detecting RIDGE LINES — the horizontal peaks where two opposing roof planes meet at the top. Each ridge is a polyline (2+ points). Hip-roof structures usually have one short central ridge; gable roofs have one long ridge per gable. Do NOT trace hips, valleys, or eaves.'
    : edge === 'valleys'
    ? 'detecting VALLEY LINES — the INWARD diagonal seams where two roof planes meet in a concave V (the inverse of a hip). Valleys appear where a perpendicular section (dormer, ell, addition) joins the main roof, and run from the ridge intersection DOWN toward an inside eave corner. On the DSM hillshade (Image 2 when present) valleys show as DARK INSET LINES — the surface dips between two planes. Each valley is a polyline (2+ points). A simple gable or hip roof with no perpendicular sections has ZERO valleys. Do NOT trace ridges, hips, or eaves.'
    : 'detecting HIP LINES — the diagonal edges that run from a roof peak down to an outside corner of the eave. Each hip is a polyline (usually 2 points: peak → corner). Hip-roof structures have 4 hips at the corners; gable roofs have zero. Do NOT trace ridges, valleys, or eaves.'

  // Image roster — order matches the multimodal content array. Caption
  // each one immediately so Claude knows what it's looking at without
  // having to infer from contents. Per Anthropic's multi-image docs.
  const imageRoster: string[] = []
  let imgN = 1
  imageRoster.push(`Image ${imgN++} — PRIMARY: Google satellite (top-down, target reference; ALL pixel coordinates you emit must be in THIS image's coordinate space, origin top-left).${opts.vegetationTintApplied ? ' ⚠️ TREE TINT APPLIED: vegetation pixels have been painted MAGENTA via the VARI vegetation index. Magenta = tree canopy (likely deciduous in summer imagery). The eave often passes UNDER the magenta zones — extrapolate the visible eave line through the canopy using the orthogonal-projection rule. Do NOT treat the edge of the magenta as a roof corner.' : ''}${opts.solarOverlayApplied ? ` 🧭 SOLAR PLANE OVERLAY APPLIED: ${opts.solarSegmentsOverlaid} colored translucent rectangles (red/green/blue/yellow/purple/sky/orange/teal) mark Solar API's detected roof PLANES — these are structural ground-truth from a SEPARATE SENSOR (DSM-derived from LiDAR-class height data, NOT from the satellite imagery you see). The colored rectangles are NOT the eave line — they are individual roof FACES. Your eaves polygon must be the OUTER PERIMETER enclosing all colored rectangles. Anything OUTSIDE the union of the colored rectangles is yard, neighbour, or driveway — do not trace there. Use the colors to count distinct roof planes if helpful for vertex placement.` : ''}${opts.hintApplied ? ' 🎯 USER HINT CIRCLE drawn in RED DASHED line with faint pink interior — see the HINT REGION section below.' : ''}`)
  if (opts.hasSolarRgb && opts.solarRgbInfo) {
    imageRoster.push(`Image ${imgN++} — HIGH-RES SOLAR RGB ORTHO: same building as Image 1 but inherently building-cropped at ~${opts.solarRgbInfo.quality === 'HIGH' ? '10' : opts.solarRgbInfo.quality === 'MEDIUM' ? '25' : '50'} cm/px native (${opts.solarRgbInfo.width}×${opts.solarRgbInfo.height} px) — Solar API's RGB ortho fetched from a SEPARATE source than the Google Static Maps primary. Use this image as your HIGH-RESOLUTION REFERENCE for fine eave-edge work and corner placement decisions — it's tightly cropped to the building (no wasted yard pixels) so edges are sharper. ⚠️ ALL pixel coordinates you emit must STILL be in Image 1's coordinate space, NOT this image's. Use this image's CONTENT (where edges fall, where corners are, where eaves drop to shadow) but emit Image 1 pixels.`)
  }
  // VISUAL FEW-SHOT EXAMPLES — past super-admin traces of similar properties,
  // rendered as a satellite tile of THAT property with the operator's polygon
  // drawn in GREEN. These are style references for vertex density, corner
  // placement, and bump-out handling — NOT coordinate sources.
  opts.visualExamples.forEach((ex, i) => {
    const sqft = ex.example.house_sqft ? `${ex.example.house_sqft.toLocaleString()} sqft` : 'unknown sqft'
    const complexity = ex.example.complexity_class || 'unknown'
    const pitch = ex.example.roof_pitch_degrees != null ? `${ex.example.roof_pitch_degrees.toFixed(1)}° pitch` : 'unknown pitch'
    const polyDesc = edge === 'eaves'
      ? `${ex.polygonCount > 1 ? `${ex.polygonCount} closed eaves polygons` : '1 closed eaves polygon'} (${ex.vertexCount} vertices total)`
      : `${ex.polygonCount} ${edge} polyline${ex.polygonCount > 1 ? 's' : ''} (${ex.vertexCount} vertices total)`
    imageRoster.push(`Image ${imgN++} — VISUAL EXAMPLE ${i + 1}: a satellite tile of a DIFFERENT past property (${sqft}, ${complexity} complexity, ${pitch}) with the operator's actual ${edge} trace drawn in GREEN (outline + 25% fill). This is a STYLE REFERENCE: the green polygon shows ${polyDesc} — note vertex density, where corners go, and how bump-outs / wings became vertices. ⚠️ DO NOT emit pixel coordinates from this image — coordinates come ONLY from Image 1. Use this for "what does a clean N-vertex eaves trace look like on a similar roof" pattern matching.`)
  })
  if (opts.hasHillshade) {
    imageRoster.push(`Image ${imgN++} — DSM hillshade. A synthetic structural render of the Google Solar API elevation raster, RESAMPLED to the SAME size as Image 1 so pixel coordinates correspond 1:1. THREE independent signals are packed into the RGB channels: RED = multi-azimuth hillshade (omni-directional illumination, ridges and hips appear as bright lines regardless of orientation); GREEN = Sobel edge magnitude on the height field (SHARP green lines where the surface curvature changes — primary cue for ridges, hips, and the inset of valleys); BLUE = above-ground height (brighter blue = higher above ground; near-zero where the surface is at lawn level). Use red+green together to localize lines; use blue to discriminate roof (bright blue) from yard or driveway (dark blue).`)
  }
  if (opts.hasWideContext) {
    imageRoster.push(`Image ${imgN++} — WIDE CONTEXT: same property at one zoom level OUT. Use it to confirm property boundaries vs neighbouring buildings, and to see whether what you think is "the back of the house" is actually a separate detached structure across a driveway. DO NOT emit pixel coordinates from this image.`)
  }
  if (opts.hasGridOverlay) {
    imageRoster.push(`Image ${imgN++} — GRID OVERLAY: a transparent 16×16 grid (columns A–P, rows 1–16) sized identically to Image 1. Use it as a coordinate reference — name the cell a corner falls in (e.g. "the NE corner is in cell K4") in your reasoning, but emit pixel coords for the actual segments. Grid is a thinking aid, not a feature to trace.`)
  }
  if (opts.hasViewport3d) {
    imageRoster.push(`Image ${imgN++} — 3D OBLIQUE: photorealistic perspective view of the same property (Google Maps 3D tiles, super-admin's current camera angle). Use it for perspective — gables, dormers, ridge orientation that's ambiguous from above. DO NOT use it for pixel coordinates.`)
  }
  const imageCount = imgN - 1

  return [
    `You are an expert roof measurement technician ${role}`,
    '',
    `INPUTS: ${imageCount} image${imageCount > 1 ? 's' : ''}, in this order:`,
    ...imageRoster,
    '',
    'Coordinate origin for the target image is top-left (0,0). All coordinates you return must be in pixels of Image 1.',
    '',
    opts.hintApplied && opts.hintCenterPx && opts.hintRadiusPx
      ? `\n🎯 USER HINT REGION — STRONGEST SIGNAL:\nImage 1 has a RED DASHED CIRCLE drawn on it, centred at pixel (${opts.hintCenterPx.x}, ${opts.hintCenterPx.y}) with radius ~${opts.hintRadiusPx}px, and faint pink shading INSIDE the circle. This is the operator's hint indicating roughly where the target building is. The actual building lives INSIDE this circle. Use the hint to disambiguate from neighbours, garages, sheds — the building you want is the one (or ones, if a porch / lower-tier eave / detached structure was intentionally enclosed) inside the pink shading. The red dashed ring is APPROXIMATE; the real eave line is what you SEE in the satellite imagery, NOT the circle itself. Trace the actual roof edges, but only consider buildings inside or overlapping the hint region — anything entirely OUTSIDE the circle is a neighbour and should be ignored.\n`
      : '',
    '⚠️ TARGET BUILDING — CRITICAL:',
    opts.includeOutbuildings
      ? `The target property is centred at pixel (${opts.targetCenterPx.x}, ${opts.targetCenterPx.y}) on Image 1. Trace the MAIN HOUSE (centre) AND any DETACHED OUTBUILDINGS on the same lot — detached garage, shed, workshop, carport — as ADDITIONAL polygons in segments[]. Each outbuilding gets its own closed polygon. Do NOT trace neighbour houses on adjacent lots (separated by driveways, fences, or property lines).`
      : `The target building is centred at pixel (${opts.targetCenterPx.x}, ${opts.targetCenterPx.y}) on Image 1 — the satellite image has been recentred and zoomed so the target sits in the middle of the frame. Trace ONLY this central building. Any other buildings visible at the edges of the image are NEIGHBOURS, not the target.`,
    opts.targetBboxPx
      ? (opts.targetBboxPx.source === 'hint'
          ? `🎯 OPERATOR MARK REGION — AUTHORITATIVE: the user has explicitly enclosed the target building inside the red dashed circle. The building you must trace fits inside the pixel rectangle (${opts.targetBboxPx.x1}, ${opts.targetBboxPx.y1}) → (${opts.targetBboxPx.x2}, ${opts.targetBboxPx.y2}) — approximately ${opts.targetBboxPx.widthFt}ft × ${opts.targetBboxPx.depthFt}ft. **Trace EVERY roof plane (main block + wings + extensions + porches) visible inside or touching this rectangle as ONE connected polygon** — do NOT stop at the central block. Multi-wing L/U/T-shape acreages need 20–32 vertices. This bbox SUPERSEDES Google Solar's; if Solar's segments overlay or 60ft-clamp hint disagrees with the operator's circle, IGNORE the Solar hints — the operator drew the ring around the whole building they want measured, wings included.`
          : opts.targetBboxPx.trusted
          ? `Google Solar API's footprint for that building covers approximately the pixel rectangle (${opts.targetBboxPx.x1}, ${opts.targetBboxPx.y1}) to (${opts.targetBboxPx.x2}, ${opts.targetBboxPx.y2}) on Image 1 — ${opts.targetBboxPx.widthFt}ft wide × ${opts.targetBboxPx.depthFt}ft deep. Your output polygon for ${edge === 'eaves' ? 'each eave section' : 'each line'} should sit ENTIRELY within or immediately adjacent to that rectangle. Anything outside it is a neighbour's house, driveway, garden bed, or street — DO NOT TRACE THOSE.`
          : `⚠️ Google Solar API returned a ${opts.targetBboxPx.widthFt}ft × ${opts.targetBboxPx.depthFt}ft bounding box for this address — that is LARGER than a typical residential footprint. Two possibilities: (a) Solar merged this house with a neighbour, OR (b) this is a genuine ACREAGE / multi-wing home (5000-8000 sqft is common in rural Alberta). The pixel rectangle (${opts.targetBboxPx.x1}, ${opts.targetBboxPx.y1}) → (${opts.targetBboxPx.x2}, ${opts.targetBboxPx.y2}) has been clamped to a 60ft radius around the pin AS A FALLBACK — but if you can VISUALLY SEE wings, additions, or extensions on the same building outside that clamp (no driveway, no fence, no grass gap between them), TRACE THE WHOLE BUILDING including wings. Use the clamp only to reject genuinely SEPARATE buildings (clear driveway / fence between them). Multi-wing acreages need 20–32 vertices — do not artificially cap.`)
      : 'No Google Solar bounding box is available for this address — trace ONLY the building under the centre pixel and its directly-attached parts (e.g. attached garage). Do NOT trace any building separated from the centre by a clear gap (those are neighbours).',
    edge === 'eaves'
      ? buildEavesSizeSanityClause(opts.targetBboxPx)
      : 'If your traced lines extend beyond the target building bbox, you are tracing neighbour roofs — drop those lines.',
    '',
    'OUTPUT: Call the emit_trace tool with your detected geometry. DO NOT write prose; the tool schema is the contract. Required fields: segments (pixel polygons/polylines in Image 1 space), confidence (0-100), reasoning (one short sentence citing which image(s) drove your decisions).' + (edge === 'eaves' ? ' Optional field: kinds (parallel array of "main"/"lower_tier"/"outbuilding" — omit if every polygon is "main").' : ''),
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

/** Per-property size-sanity range derived from the Solar bbox, replacing the
 *  hard-coded 1200–3000 sqft band. A 4500-sqft acreage home and a 900-sqft
 *  cottage are both legitimate; flagging them as "you merged a neighbour" or
 *  "you stopped at a tree" caused real false negatives. When Solar has a
 *  trusted bbox we anchor on that; otherwise fall back to the prior band. */
function buildEavesSizeSanityClause(bbox: { widthFt: number; depthFt: number; trusted: boolean; source?: 'hint' | 'solar-trusted' | 'solar-untrusted' } | null): string {
  if (bbox && bbox.source === 'hint') {
    // Mark Region wins — anchor size sanity on the operator's circle area.
    // Operator circles are intentionally coarse and almost always over-
    // circle by 30-50% so a wide 0.3×-2.0× bracket is appropriate.
    const expected = Math.max(400, bbox.widthFt * bbox.depthFt)
    const lo = Math.round(expected * 0.3)
    const hi = Math.round(expected * 2.0)
    return `SIZE SANITY (hint-derived, loose): the operator's Mark Region encloses ~${Math.round(expected)} sqft. A correct eaves polygon should fall in ${lo}–${hi} sqft (operator circles are often 30–50% bigger than the actual building). Hugely outside this range → recheck the imagery, but DO NOT shrink a multi-wing trace just to fit a tighter band — wings count.`
  }
  if (bbox && bbox.trusted) {
    const expected = Math.max(400, bbox.widthFt * bbox.depthFt)
    // Widened on 2026-05-11 from 0.6×-1.3× to 0.4×-1.8× after a regression
    // where Solar's bbox under-reported real building area on tree-occluded
    // lots, and the tight bracket told Claude to shrink an already-correct
    // polygon. The bracket is meant as a sanity cap (catch neighbour merges
    // + tree-stops), NOT a tight prior — leaving plenty of room for valid
    // additions, porches, breezeways that Solar's footprint misses.
    const lo = Math.round(expected * 0.4)
    const hi = Math.round(expected * 1.8)
    return `SIZE SANITY (loose sanity cap, not a tight constraint): Solar API's bounding box suggests roughly ${Math.round(expected)} sqft. A correct eaves polygon for THIS property would typically fall in ${lo}–${hi} sqft. Outside that range → recheck: bigger than ${hi} sqft usually means a neighbour got merged; smaller than ${lo} sqft usually means tree occlusion clipped the trace early. WITHIN this range, do not second-guess the satellite — Solar's bbox is often clipped at overhanging tree canopy and can under-report the real building by 20-30%.`
  }
  // Untrusted bbox WITHOUT a hint — could be merged neighbour OR genuine acreage.
  // Reframe so Claude doesn't blindly shrink legitimate large homes.
  return 'SIZE SANITY (broad band): residential Canadian homes typically span 1,200–3,500 sqft for suburban, 3,500–8,000 sqft for acreages and rural estates. Solar API\'s bbox is suspicious here — could be a merged neighbour OR a legitimately large acreage. If your traced polygon falls in 800–8,000 sqft AND the imagery shows one continuous building (no driveways or fences cutting through it), trust the imagery. Outside that range → recheck for merged neighbours (>8,000 sqft) or tree-occlusion clip (<800 sqft).'
}

function buildUserPrompt(args: {
  edge: AutoTraceEdge
  imagePxW: number
  imagePxH: number
  solarSummary: ReturnType<typeof summarizeSolar>
  examples: TrainingExample[]
  hillshade: DsmHillshadeResult | null
  hasWideContext: boolean
  hasGridOverlay: boolean
  hasViewport3d: boolean
  targetCenterPx: { x: number; y: number }
  targetBboxPx: { x1: number; y1: number; x2: number; y2: number } | null
  footprintPriors: FootprintPrior[]
  visualExamples: RenderedExampleOverlay[]
  visualExampleOrderIds: Set<number>
}): string {
  const lines: string[] = []
  let img = 1
  lines.push(`Image ${img++} (primary satellite): ${args.imagePxW}x${args.imagePxH} pixels.`)
  if (args.hillshade) {
    lines.push(`Image ${img++} (DSM hillshade): ${args.hillshade.width}x${args.hillshade.height} pixels, same coordinate space as Image 1. Solar API quality=${args.hillshade.quality || 'unknown'}${args.hillshade.imageryDate ? `, imagery dated ${args.hillshade.imageryDate}` : ''}.`)
  }
  if (args.hasWideContext) {
    lines.push(`Image ${img++} (wide context): same property at zoom −1; for property-boundary confirmation only. Do NOT emit coords from this image.`)
  }
  if (args.hasGridOverlay) {
    lines.push(`Image ${img++} (grid overlay): 16×16 grid (cols A–P, rows 1–16) at ${args.imagePxW}x${args.imagePxH}, transparent everywhere else. Reference by cell name in reasoning; emit pixel coords for output.`)
  }
  if (args.hasViewport3d) {
    lines.push(`Image ${img++} (3D oblique): perspective only — do not use for pixel coordinates.`)
  }
  lines.push('')
  lines.push(`TARGET: building at pixel (${args.targetCenterPx.x}, ${args.targetCenterPx.y}).`)
  if (args.targetBboxPx) {
    const b: any = args.targetBboxPx
    if (b.source === 'hint') {
      lines.push(`Target bbox (operator MARK REGION — authoritative): (${b.x1}, ${b.y1}) → (${b.x2}, ${b.y2}) — ${b.widthFt}ft × ${b.depthFt}ft. Trace the FULL building inside this rectangle including wings/extensions; ignore Solar's bbox if it disagrees.`)
    } else if (b.trusted) {
      lines.push(`Target bbox (Solar API trusted): (${b.x1}, ${b.y1}) → (${b.x2}, ${b.y2}) — ${b.widthFt}ft × ${b.depthFt}ft. Stay inside this rectangle.`)
    } else {
      lines.push(`Target bbox (Solar API UNTRUSTED — bbox may have merged a neighbour OR this may be a legitimate acreage): (${b.x1}, ${b.y1}) → (${b.x2}, ${b.y2}) — clamped to 60ft radius around pin. Trace the visible single building including any clearly-attached wings; only treat as separate the buildings with a clear gap (driveway/fence/grass).`)
    }
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

  // External footprint priors — OSM and/or Edmonton municipal LiDAR. Most
  // useful when they CORROBORATE Solar (high agent confidence) or when
  // they DISAGREE (something's wrong with one of the data sources — defer
  // to the satellite image). We pass the polygon vertex count + area; the
  // raw coordinates aren't useful to Claude since this prompt expects
  // pixel output.
  if (args.footprintPriors.length > 0) {
    lines.push('External building-footprint priors (cross-check Solar bbox; do NOT copy these coordinates — they are lat/lng, not pixels):')
    for (const p of args.footprintPriors) {
      lines.push(`- ${p.source}: ${Math.round(p.area_sqft)} sqft polygon (${p.ring.length} vertices)`)
    }
    if (args.footprintPriors.length >= 2) {
      // Two or more sources — surface agreement/disagreement.
      const areas = args.footprintPriors.map(p => p.area_sqft)
      const minA = Math.min(...areas), maxA = Math.max(...areas)
      const ratio = minA > 0 ? maxA / minA : 0
      if (ratio < 1.15) {
        lines.push(`  → Sources AGREE within ${Math.round((ratio - 1) * 100)}%. Treat this as the high-confidence footprint area; your eaves polygon should target this size.`)
      } else {
        lines.push(`  → Sources DISAGREE (max/min ratio ${ratio.toFixed(2)}). Trust the satellite image over either prior; one of the data sources is wrong.`)
      }
    }
    lines.push('')
  }

  if (args.examples.length > 0) {
    // Reference rendered examples by their VISUAL EXAMPLE ordinal (which
    // matches the system prompt's image-roster label), not by absolute Image#.
    // Image numbering drifts based on solar-rgb / hillshade / wide-context
    // presence; ordinals are stable.
    lines.push(`Few-shot examples — ${args.examples.length} past super-admin traces of similar properties:`)
    let visualOrdinal = 0
    args.examples.forEach((ex, i) => {
      const hasVisual = args.visualExampleOrderIds.has(ex.order_id)
      const sqftStr = ex.house_sqft != null ? `${ex.house_sqft.toLocaleString()} sqft` : 'unknown sqft'
      const complexity = ex.complexity_class || 'unknown'
      const pitch = ex.roof_pitch_degrees?.toFixed?.(1) || '?'
      if (hasVisual) {
        visualOrdinal++
        const rendered = args.visualExamples.find(v => v.example.order_id === ex.order_id)!
        lines.push(`Example ${i + 1} (VISUAL EXAMPLE ${visualOrdinal} above — see the GREEN polygon overlay): ${sqftStr}, ${complexity} complexity, ${pitch}° pitch, ${rendered.vertexCount}-vertex ${args.edge} (${rendered.polygonCount} polygon${rendered.polygonCount > 1 ? 's' : ''}).`)
        lines.push(`  → STYLE NOTES: count the vertices on the green outline; note whether wings/bump-outs get explicit corners; observe corner placement relative to building edges.`)
      } else {
        // Fallback — no visual rendering (no coords / fetch failure / disabled).
        // Keep the text-only metadata; drop the lat/lng JSON dump that was
        // previously noise (coords are from a different property, can't be used).
        lines.push(`Example ${i + 1} (text-only — no visual available): ${sqftStr}, ${complexity} complexity, ${pitch}° pitch.`)
      }
    })
    lines.push('')
  } else {
    lines.push('No similar past traces available — work from the image + Solar context alone.')
    lines.push('')
  }

  lines.push(`Now produce the ${args.edge} segments for THIS property. Return JSON only.`)
  return lines.join('\n')
}

/** Trim a few-shot example's polygon payload so it fits cleanly in the prompt
 *  WITHOUT the old `.slice(0, 600)` byte-cap, which truncated mid-vertex on any
 *  polygon with more than ~10 vertices at full lat/lng precision. We round
 *  every lat/lng to 6 decimals (~11 cm) and cap each array at `maxPerArray`
 *  vertices, recursing through nested polygon arrays. The model only needs the
 *  SHAPE — vertex count, aspect ratio, jog pattern — not 13-decimal precision. */
function sanitizeExamplePayload(payload: any, maxPerArray = 18): any {
  if (Array.isArray(payload)) {
    return payload.slice(0, maxPerArray).map(item => sanitizeExamplePayload(item, maxPerArray))
  }
  if (payload && typeof payload === 'object') {
    const out: any = {}
    for (const k of Object.keys(payload)) {
      const v = payload[k]
      if ((k === 'lat' || k === 'lng') && typeof v === 'number') {
        out[k] = Math.round(v * 1e6) / 1e6
      } else {
        out[k] = sanitizeExamplePayload(v, maxPerArray)
      }
    }
    return out
  }
  return payload
}

function pickEdgeFromExample(ex: TrainingExample, edge: AutoTraceEdge): unknown {
  try {
    const trace = typeof ex.roof_trace_json === 'string' ? JSON.parse(ex.roof_trace_json) : ex.roof_trace_json
    if (!trace) return null
    if (edge === 'eaves') return trace.eaves_sections || trace.eaves || []
    if (edge === 'ridges') return trace.ridges || []
    if (edge === 'hips') return trace.hips || []
    if (edge === 'valleys') return trace.valleys || []
  } catch { /* corrupt example — skip */ }
  return []
}

// ─────────────────────────────────────────────────────────────
// Image fetch + Mercator helpers
// ─────────────────────────────────────────────────────────────
function buildSatelliteImageUrl(lat: number, lng: number, zoom: number, w: number, h: number, key: string): string {
  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${w}x${h}&scale=2&maptype=satellite&key=${key}`
}

export interface RenderedExampleOverlay {
  b64: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  example: TrainingExample
  vertexCount: number
  polygonCount: number
}

/** Render a past super-admin trace as a satellite tile with the operator's
 *  polygon overlaid via Google Static Maps `path=` params. Reuses the same
 *  server-side overlay technique as `refineEavesViaSelfCritique`; no canvas /
 *  WASM dependency. Returns null on any missing data / URL-length / fetch
 *  failure so the caller falls back to text-only metadata for that example. */
async function renderExampleOverlay(
  env: Bindings,
  example: TrainingExample,
  edge: AutoTraceEdge,
): Promise<RenderedExampleOverlay | null> {
  const raw = pickEdgeFromExample(example, edge)
  const polygons = normalizeExamplePolygons(raw)
  if (polygons.length === 0) return null

  // Centroid + bbox across ALL polygons in the example (multi-section eaves,
  // multi-segment ridges) so the tile frames the whole roof, not just polygon 0.
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
  let vertexCount = 0
  for (const poly of polygons) {
    for (const p of poly) {
      if (p.lat < minLat) minLat = p.lat
      if (p.lat > maxLat) maxLat = p.lat
      if (p.lng < minLng) minLng = p.lng
      if (p.lng > maxLng) maxLng = p.lng
      vertexCount++
    }
  }
  if (!isFinite(minLat) || vertexCount < 2) return null
  const cLat = (minLat + maxLat) / 2
  const cLng = (minLng + maxLng) / 2
  const latDiffM = (maxLat - minLat) * 111_320
  const lngDiffM = (maxLng - minLng) * 111_320 * Math.cos((cLat * Math.PI) / 180)
  const longestSideFt = Math.max(latDiffM, lngDiffM) * 3.28084
  // 350px target on a 640x640 scale=1 tile = ~55% frame fill, matching the
  // primary-image framing strategy. Lower bound floors out at z=18 for
  // huge acreages (handled by pickZoomForBuildingSize).
  const zoom = pickZoomForBuildingSize(longestSideFt, cLat, 350, 1)

  // Eaves: closed filled polygons. Ridges/hips/valleys: open polylines (no fill).
  // Green color (0x00cc00) matches the in-app eaves stroke so Claude can
  // pattern-match "green polygon = eaves trace" against the operator's mental
  // model. Outline 100% alpha; fill 25% alpha so satellite imagery remains visible.
  const isFilled = edge === 'eaves'
  const outlineColor = '0x00cc00ff'
  const fillColor = '0x00cc003f'
  const pathParams = polygons
    .filter(p => p.length >= (isFilled ? 3 : 2))
    .map(p => {
      const closed = isFilled ? [...p, p[0]] : p
      const pts = closed.map(pt => `${pt.lat.toFixed(6)},${pt.lng.toFixed(6)}`).join('|')
      const fill = isFilled ? `|fillcolor:${fillColor}` : ''
      return `path=color:${outlineColor}|weight:4${fill}|${pts}`
    })
    .join('&')
  if (!pathParams) return null

  const url = `https://maps.googleapis.com/maps/api/staticmap?center=${cLat},${cLng}&zoom=${zoom}&size=640x640&scale=1&maptype=satellite&${pathParams}&key=${env.GOOGLE_MAPS_API_KEY}`
  // Static Maps URL hard limit ~8192 chars. A 20-vertex polygon at 6-decimal
  // precision is ~450 chars; multi-polygon examples can still overflow.
  if (url.length > 8000) return null

  try {
    const img = await fetchImageB64(url)
    return { ...img, example, vertexCount, polygonCount: polygons.length }
  } catch (e: any) {
    console.warn(`[auto-trace] example ${example.order_id} overlay fetch failed:`, e?.message)
    return null
  }
}

/** Normalize a raw polygon payload from `pickEdgeFromExample` into a uniform
 *  `[{lat, lng}, ...][]` shape. Handles both modern (objects with lat/lng) and
 *  legacy (tuple [lat, lng]) storage, plus the legacy flat-polygon `eaves`
 *  shape (one polygon, not wrapped in an outer array). */
function normalizeExamplePolygons(raw: unknown): { lat: number; lng: number }[][] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  const firstEl: any = raw[0]
  // Detect flat-polygon (legacy `eaves: [{lat,lng}, ...]`) vs nested array-of-polygons.
  // Flat: first element is a point (object with lat/lng OR a 2-number tuple).
  // Nested: first element is itself an array.
  const isFlatPolygon = !Array.isArray(firstEl) || (
    Array.isArray(firstEl) && firstEl.length === 2 &&
    typeof firstEl[0] === 'number' && typeof firstEl[1] === 'number'
  )
  const isPointObj = firstEl && typeof firstEl === 'object' && !Array.isArray(firstEl) &&
    typeof firstEl.lat === 'number' && typeof firstEl.lng === 'number'
  const polys = (isFlatPolygon && (isPointObj || (Array.isArray(firstEl) && firstEl.length === 2)))
    ? [raw]
    : raw
  const out: { lat: number; lng: number }[][] = []
  for (const poly of polys) {
    if (!Array.isArray(poly)) continue
    const pts: { lat: number; lng: number }[] = []
    for (const v of poly) {
      if (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number') {
        pts.push({ lat: v[0], lng: v[1] })
      } else if (v && typeof v === 'object' && typeof (v as any).lat === 'number' && typeof (v as any).lng === 'number') {
        pts.push({ lat: (v as any).lat, lng: (v as any).lng })
      }
    }
    if (pts.length >= 2) out.push(pts)
  }
  return out
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

/** Web Mercator pixel → lat/lng for the satellite tile we sent to Claude.
 *  Inverse of the Static Maps projection. Note: this function does NOT handle
 *  the ±180° meridian wrap (a polygon spanning the antimeridian would project
 *  incorrectly). Acceptable for the current Canadian-only deployment; if the
 *  service expands to NZ / Fiji / eastern Russia, add a wrap-around branch. */
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
export type SegmentKind = 'main' | 'lower_tier' | 'outbuilding'

/** Tool-use schema for the auto-trace output. Returned by the SDK as
 *  structured `input` on a `tool_use` content block — no JSON parsing,
 *  no fence-stripping, no regex fallback. The schema differs by edge
 *  type only in the `kinds` field (eaves-only). */
function buildEmitTraceTool(edge: AutoTraceEdge): {
  name: string
  description: string
  input_schema: any
} {
  const baseProps: any = {
    segments: {
      type: 'array',
      description: edge === 'eaves'
        ? 'List of closed polygons (one per structure). Eaves: clockwise vertices, do NOT repeat the first vertex at the end. Each polygon needs >= 3 vertices.'
        : 'List of polylines (one per detected line). Each polyline is an ordered sequence of >= 2 points (corners or endpoints).',
      items: {
        type: 'array',
        items: {
          type: 'object',
          required: ['x', 'y'],
          properties: {
            x: { type: 'integer', description: 'Pixel x in Image 1 coordinate space' },
            y: { type: 'integer', description: 'Pixel y in Image 1 coordinate space (origin top-left)' },
          },
        },
      },
    },
    confidence: {
      type: 'integer',
      description: '0-100 self-reported confidence for this trace.',
      minimum: 0,
      maximum: 100,
    },
    reasoning: {
      type: 'string',
      description: 'One short sentence on what you saw, citing which image(s) drove your decisions.',
    },
  }
  if (edge === 'eaves') {
    baseProps.kinds = {
      type: 'array',
      description: 'OPTIONAL parallel array tagging each polygon as "main", "lower_tier" (porch/garage/sunroom lip with separate pitch), or "outbuilding". Omit entirely if every polygon is "main".',
      items: { type: 'string', enum: ['main', 'lower_tier', 'outbuilding'] },
    }
  }
  return {
    name: 'emit_trace',
    description: `Emit the ${edge} geometry detected in Image 1.`,
    input_schema: {
      type: 'object',
      required: ['segments', 'confidence', 'reasoning'],
      properties: baseProps,
    },
  }
}

/** Pull the tool_use block out of a tool-enforced completion and validate
 *  its shape. Falls through to text-parsing if the tool call is missing
 *  (defensive — shouldn't happen with tool_choice forced, but keeps the
 *  pipeline resilient to API changes). */
function parseToolResponse(completion: any): {
  segments: { x: number; y: number }[][]
  confidence: number
  reasoning: string
  kinds?: SegmentKind[]
} {
  const toolUse = (completion?.content || []).find((b: any) => b?.type === 'tool_use' && b?.name === 'emit_trace')
  if (toolUse && toolUse.input) {
    return normalizeParsedTrace(toolUse.input)
  }
  // Fallback: SDK returned text only (some failure modes do this).
  const text = (completion?.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim()
  return parseClaudeResponse(text)
}

/** Normalize either a tool_use.input object or a parsed JSON dict into the
 *  internal shape. Single source of truth for the validation rules. */
function normalizeParsedTrace(parsed: any): {
  segments: { x: number; y: number }[][]
  confidence: number
  reasoning: string
  kinds?: SegmentKind[]
} {
  const rawSegments: any[] = Array.isArray(parsed?.segments) ? parsed.segments : []
  const segments = rawSegments
    .map((seg: any[]) => Array.isArray(seg)
      ? seg.filter((p: any) => Number.isFinite(p?.x) && Number.isFinite(p?.y)).map((p: any) => ({ x: Math.round(p.x), y: Math.round(p.y) }))
      : [])
    .filter(seg => seg.length >= 2)
  const confidence = Math.max(0, Math.min(100, Math.round(Number(parsed?.confidence) || 0)))
  const reasoning = String(parsed?.reasoning || '').slice(0, 500)
  let kinds: SegmentKind[] | undefined
  const rawKinds = Array.isArray(parsed?.kinds) ? parsed.kinds : null
  if (rawKinds && rawKinds.length === rawSegments.length) {
    const validated: SegmentKind[] = []
    let allValid = true
    for (let i = 0; i < rawKinds.length; i++) {
      const seg = rawSegments[i]
      const kept = Array.isArray(seg) && seg.filter((p: any) => Number.isFinite(p?.x) && Number.isFinite(p?.y)).length >= 2
      if (!kept) continue
      const k = String(rawKinds[i] || '').toLowerCase()
      if (k === 'main' || k === 'lower_tier' || k === 'outbuilding') {
        validated.push(k as SegmentKind)
      } else {
        allValid = false
        break
      }
    }
    if (allValid && validated.length === segments.length) kinds = validated
  }
  return { segments, confidence, reasoning, kinds }
}

/** Legacy prose-JSON parser. Kept ONLY for the critique-pass fallback path
 *  and for the tool-use safety-net in parseToolResponse(). All happy-path
 *  parsing now goes through normalizeParsedTrace() via the tool-use input. */
function parseClaudeResponse(text: string): {
  segments: { x: number; y: number }[][]
  confidence: number
  reasoning: string
  kinds?: SegmentKind[]
} {
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
  return normalizeParsedTrace(parsed)
}

// ─────────────────────────────────────────────────────────────
// Solar segment overlay — draws each Solar-detected roof plane as a
// colored translucent rectangle on the satellite tile. Tells Claude
// "here are N structural ground-truth planes; your eaves polygon
// must enclose all of them." Eliminates the "wrong shape / missed
// a wing" failure mode on multi-tier roofs by giving the model an
// explicit structural prior from a separate sensor (DSM-derived).
// ─────────────────────────────────────────────────────────────
const SOLAR_SEGMENT_COLORS: ReadonlyArray<[number, number, number]> = [
  [239, 68, 68],   // red
  [34, 197, 94],   // green
  [59, 130, 246],  // blue
  [234, 179, 8],   // yellow
  [168, 85, 247],  // purple
  [14, 165, 233],  // sky
  [249, 115, 22],  // orange
  [16, 185, 129],  // teal
]

function drawSolarSegmentOverlay(
  rgba: Uint8ClampedArray,
  imgW: number,
  imgH: number,
  segments: Array<{ x1: number; y1: number; x2: number; y2: number }>,
): void {
  for (let s = 0; s < segments.length; s++) {
    const [r, g, b] = SOLAR_SEGMENT_COLORS[s % SOLAR_SEGMENT_COLORS.length]
    const seg = segments[s]
    const xMin = Math.max(0, Math.min(imgW - 1, Math.round(seg.x1)))
    const xMax = Math.max(0, Math.min(imgW - 1, Math.round(seg.x2)))
    const yMin = Math.max(0, Math.min(imgH - 1, Math.round(seg.y1)))
    const yMax = Math.max(0, Math.min(imgH - 1, Math.round(seg.y2)))
    // Fill: 18% alpha so the underlying satellite is still readable.
    const a = 0.18
    for (let y = yMin; y <= yMax; y++) {
      for (let x = xMin; x <= xMax; x++) {
        const idx = (y * imgW + x) * 4
        rgba[idx]     = Math.round(rgba[idx] * (1 - a) + r * a)
        rgba[idx + 1] = Math.round(rgba[idx + 1] * (1 - a) + g * a)
        rgba[idx + 2] = Math.round(rgba[idx + 2] * (1 - a) + b * a)
      }
    }
    // Solid 2px outline so the rectangle's edges are unambiguous.
    for (let x = xMin; x <= xMax; x++) {
      for (let dy = 0; dy < 2; dy++) {
        if (yMin + dy <= imgH - 1) {
          const idx1 = ((yMin + dy) * imgW + x) * 4
          rgba[idx1] = r; rgba[idx1 + 1] = g; rgba[idx1 + 2] = b
        }
        if (yMax - dy >= 0) {
          const idx2 = ((yMax - dy) * imgW + x) * 4
          rgba[idx2] = r; rgba[idx2 + 1] = g; rgba[idx2 + 2] = b
        }
      }
    }
    for (let y = yMin; y <= yMax; y++) {
      for (let dx = 0; dx < 2; dx++) {
        if (xMin + dx <= imgW - 1) {
          const idx1 = (y * imgW + (xMin + dx)) * 4
          rgba[idx1] = r; rgba[idx1 + 1] = g; rgba[idx1 + 2] = b
        }
        if (xMax - dx >= 0) {
          const idx2 = (y * imgW + (xMax - dx)) * 4
          rgba[idx2] = r; rgba[idx2 + 1] = g; rgba[idx2 + 2] = b
        }
      }
    }
  }
}

/** Pull per-segment bounding boxes from solarInsights + project to pixel
 *  space on the satellite tile. Filters to segments INSIDE the image
 *  bounds + reasonably sized (skip tiny degenerate ones). */
function extractSolarSegmentBboxesPx(
  insights: any,
  framing: { lat: number; lng: number; zoom: number },
  imgW: number,
  imgH: number,
  safeW: number,
): Array<{ x1: number; y1: number; x2: number; y2: number; pitchDeg: number; azimuthDeg: number; areaSqFt: number }> | null {
  const segs: any[] = insights?.solarPotential?.roofSegmentStats || []
  if (!Array.isArray(segs) || segs.length < 2) return null  // single-segment overlay adds no info

  const scale = 1 << framing.zoom
  const centerSin = Math.sin(framing.lat * Math.PI / 180)
  const centerWorldX = (256 * (0.5 + framing.lng / 360)) * scale
  const centerWorldY = (256 * (0.5 - Math.log((1 + centerSin) / (1 - centerSin)) / (4 * Math.PI))) * scale
  // World-units → image-pixels factor.
  const worldUnitsPerImgPx = safeW / imgW

  const latLngToPx = (lat: number, lng: number) => {
    const sin = Math.sin(lat * Math.PI / 180)
    const worldX = (256 * (0.5 + lng / 360)) * scale
    const worldY = (256 * (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI))) * scale
    return {
      x: Math.round((worldX - centerWorldX) / worldUnitsPerImgPx + imgW / 2),
      y: Math.round((worldY - centerWorldY) / worldUnitsPerImgPx + imgH / 2),
    }
  }

  const out: Array<{ x1: number; y1: number; x2: number; y2: number; pitchDeg: number; azimuthDeg: number; areaSqFt: number }> = []
  for (const seg of segs) {
    const bb = seg?.boundingBox
    const sw = bb?.sw || bb?.southWest
    const ne = bb?.ne || bb?.northEast
    if (!sw?.latitude || !ne?.latitude) continue
    const swPx = latLngToPx(sw.latitude, sw.longitude)
    const nePx = latLngToPx(ne.latitude, ne.longitude)
    const x1 = Math.min(swPx.x, nePx.x), x2 = Math.max(swPx.x, nePx.x)
    const y1 = Math.min(swPx.y, nePx.y), y2 = Math.max(swPx.y, nePx.y)
    // Skip degenerate segments (< 20px on a side ≈ smaller than a roof vent).
    if (x2 - x1 < 20 || y2 - y1 < 20) continue
    // Skip segments that lie entirely outside the image.
    if (x2 < 0 || y2 < 0 || x1 >= imgW || y1 >= imgH) continue
    out.push({
      x1, y1, x2, y2,
      pitchDeg: Number(seg.pitchDegrees) || 0,
      azimuthDeg: Number(seg.azimuthDegrees) || 0,
      areaSqFt: Math.round(Number(seg.stats?.areaMeters2 || 0) * 10.7639),
    })
  }
  return out.length >= 2 ? out : null
}

// ─────────────────────────────────────────────────────────────
// Hint-region overlay — draws a red dashed circle + faint pink interior
// onto an RGBA buffer in-place. Used to mark the user's coarse hint
// region on the satellite tile so the vision model can see "the target
// is inside this circle." Pure pixel math; no image library needed.
// ─────────────────────────────────────────────────────────────
function drawHintCircle(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  r: number,
): void {
  if (r <= 0) return
  const r2_inner = (r - 3) * (r - 3)
  const r2_outer_dashed = (r + 4) * (r + 4)
  const r2_inner_dashed = (r - 4) * (r - 4)
  // Faint pink fill INSIDE the circle (alpha ~15%) so the model can see
  // a soft shaded zone without losing the underlying texture.
  const xMin = Math.max(0, Math.floor(cx - r - 5))
  const xMax = Math.min(w - 1, Math.ceil(cx + r + 5))
  const yMin = Math.max(0, Math.floor(cy - r - 5))
  const yMax = Math.min(h - 1, Math.ceil(cy + r + 5))
  for (let y = yMin; y <= yMax; y++) {
    for (let x = xMin; x <= xMax; x++) {
      const dx = x - cx, dy = y - cy
      const d2 = dx * dx + dy * dy
      const idx = (y * w + x) * 4
      // Dashed ring: pixels in the [r-4, r+4] annulus get drawn red,
      // but only on dashes. Dash modulus: 12 degrees per dash, 50% duty.
      if (d2 <= r2_outer_dashed && d2 >= r2_inner_dashed) {
        const theta = Math.atan2(dy, dx)
        const dashPhase = ((theta + Math.PI) * 180 / Math.PI) % 24
        if (dashPhase < 14) {
          rgba[idx]     = 235
          rgba[idx + 1] = 38
          rgba[idx + 2] = 56
          rgba[idx + 3] = 255
        }
        continue
      }
      // Inside the circle (but not the ring): blend faint pink.
      if (d2 < r2_inner) {
        const a = 0.15
        rgba[idx]     = Math.round(rgba[idx] * (1 - a) + 255 * a)
        rgba[idx + 1] = Math.round(rgba[idx + 1] * (1 - a) + 180 * a)
        rgba[idx + 2] = Math.round(rgba[idx + 2] * (1 - a) + 200 * a)
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Polygon smoothing — remove near-collinear vertices
// ─────────────────────────────────────────────────────────────
// Claude vision returns polygons in integer pixel coordinates, and the
// Mercator round-trip produces additional ~0.5-2 ft per-vertex jitter.
// The result: 4-corner rectangles arrive with 6-9 vertices stuttering
// along straight walls. Operators have to nudge each of those away.
//
// Smoothing removes vertices that lie within `tolerance` pixels of the
// line between their two neighbours — pure geometric simplification,
// no shape change. Douglas-Peucker would be more aggressive but risks
// losing legitimate small jogs (bay windows, kitchen bump-outs);
// per-vertex collinearity check is a safer floor.
//
// Tolerance ~2 px on a 1280-pixel projection grid = ~6 inches at z=21.
// Below the noise floor of the underlying coord pipeline.
function smoothPolygonRemoveCollinear(poly: { x: number; y: number }[], tolerancePx: number = 2): { x: number; y: number }[] {
  if (poly.length <= 4) return poly  // Don't simplify simple rectangles further
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < poly.length; i++) {
    const prev = poly[(i - 1 + poly.length) % poly.length]
    const curr = poly[i]
    const next = poly[(i + 1) % poly.length]
    // Perpendicular distance from `curr` to line (prev → next).
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    const len = Math.hypot(dx, dy)
    if (len < 1) { out.push(curr); continue }
    const dist = Math.abs((curr.x - prev.x) * dy - (curr.y - prev.y) * dx) / len
    if (dist > tolerancePx) out.push(curr)
    // else: drop curr (it's effectively collinear with neighbours)
  }
  // Guard: never reduce below 3 vertices (degenerate polygon).
  return out.length >= 3 ? out : poly
}

// ─────────────────────────────────────────────────────────────
// Dominant-angle snapping (Manhattan-world regularization)
// ─────────────────────────────────────────────────────────────
// Residential roofs in North America are overwhelmingly axis-aligned
// rectilinear shapes — even L/T/U composites are made of right-angle
// corners. After Claude returns a polygon, snap every edge to the
// nearest 0° / 90° offset from the building's dominant angle. This is
// a JOSM-style "orthogonalize shape" pass: deterministic, ~30 lines,
// catches the kind of jittery vertex placement the prompt's
// "extrapolate through canopy" instruction can produce.
//
// Algorithm: histogram of edge orientations (mod 90°), pick the bin
// with the largest weighted length, then for each edge, rotate it to
// the nearest k×90° offset from that dominant. Vertices are the
// intersection of consecutive snapped edges.

const SNAP_TOLERANCE_DEG = 12  // edges within ±12° of an axis snap; outside, leave alone

function snapPolygonToDominantAngle(poly: { x: number; y: number }[]): { x: number; y: number }[] {
  if (poly.length < 4) return poly  // triangles & lower — nothing to snap
  // 1. Build edges + their orientations (radians, mod π/2 since we treat
  //    horizontal and vertical as the same axis family).
  type Edge = { a: { x: number; y: number }; b: { x: number; y: number }; theta: number; len: number }
  const edges: Edge[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy)
    if (len < 1) continue
    const t = Math.atan2(dy, dx)
    // Map to [0, π/2) — direction-agnostic, so a NS edge and EW edge are π/2 apart.
    let modT = ((t % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2)
    edges.push({ a, b, theta: modT, len })
  }
  if (edges.length < 4) return poly
  // 2. Find the dominant angle in [0, π/2) by length-weighted histogram. 36 bins
  //    of 2.5° each gives enough resolution to distinguish a 5° tilt from 0°.
  const BINS = 36
  const binW = Math.PI / 2 / BINS
  const hist = new Float64Array(BINS)
  for (const e of edges) {
    const idx = Math.min(BINS - 1, Math.floor(e.theta / binW))
    hist[idx] += e.len
  }
  let bestBin = 0, bestW = hist[0]
  for (let i = 1; i < BINS; i++) if (hist[i] > bestW) { bestW = hist[i]; bestBin = i }
  const dominantTheta = (bestBin + 0.5) * binW  // centre of the dominant bin
  // 3. For each edge, compute the angular distance to dominantTheta (mod π/2).
  //    If within tolerance, snap it onto axis k * π/2 + dominantTheta for the
  //    nearest k. Otherwise leave as-is (preserves angled wings, mansard cuts).
  const tolRad = SNAP_TOLERANCE_DEG * Math.PI / 180
  const snappedEdges = edges.map(e => {
    // True orientation in [-π, π]
    const trueTheta = Math.atan2(e.b.y - e.a.y, e.b.x - e.a.x)
    // Nearest multiple of π/2 plus dominantTheta
    const offsetFromDominant = trueTheta - dominantTheta
    const k = Math.round(offsetFromDominant / (Math.PI / 2))
    const targetTheta = dominantTheta + k * (Math.PI / 2)
    const diff = Math.abs(((trueTheta - targetTheta + Math.PI) % (2 * Math.PI)) - Math.PI)
    if (diff > tolRad) return { ...e, snappedTheta: null as number | null }
    return { ...e, snappedTheta: targetTheta }
  })
  // 4. Rebuild vertices as intersections of consecutive snapped edges. Anchor
  //    each snapped edge at its midpoint (so the polygon stays roughly in place
  //    rather than drifting). Edges that weren't snapped contribute their
  //    original endpoints back into the polygon directly.
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < snappedEdges.length; i++) {
    const e = snappedEdges[i]
    const prev = snappedEdges[(i - 1 + snappedEdges.length) % snappedEdges.length]
    if (e.snappedTheta === null && prev.snappedTheta === null) {
      out.push(e.a)
      continue
    }
    if (e.snappedTheta !== null && prev.snappedTheta !== null) {
      // Intersect prev (anchored at its midpoint) with e (anchored at its midpoint).
      const pMx = (prev.a.x + prev.b.x) / 2, pMy = (prev.a.y + prev.b.y) / 2
      const eMx = (e.a.x + e.b.x) / 2, eMy = (e.a.y + e.b.y) / 2
      const pDx = Math.cos(prev.snappedTheta!), pDy = Math.sin(prev.snappedTheta!)
      const eDx = Math.cos(e.snappedTheta!),    eDy = Math.sin(e.snappedTheta!)
      // Solve [pDx -eDx; pDy -eDy] [t; s] = [eMx-pMx; eMy-pMy]
      const det = pDx * (-eDy) - (-eDx) * pDy
      if (Math.abs(det) < 1e-6) { out.push(e.a); continue }
      const rhsX = eMx - pMx, rhsY = eMy - pMy
      const t = (rhsX * (-eDy) - (-eDx) * rhsY) / det
      out.push({ x: Math.round(pMx + t * pDx), y: Math.round(pMy + t * pDy) })
      continue
    }
    // Only one side is snapped — anchor at the original shared vertex.
    out.push(e.a)
  }
  return out
}

// ─────────────────────────────────────────────────────────────
// IoU helpers — gate the self-critique pass
// ─────────────────────────────────────────────────────────────
// The literature on self-correction (Huang et al. 2023, DeepMind:
// "Large Language Models Cannot Self-Correct Reasoning Yet")
// shows intrinsic self-critique without an external signal degrades
// already-good outputs ~20-30% of the time. We use the Solar API
// bounding box as that external signal: if the first-draft polygon
// overlaps the bbox closely, skip the critique entirely.

/** Shoelace area of a polygon (absolute value, no orientation requirement). */
function polygonArea(poly: { x: number; y: number }[]): number {
  if (poly.length < 3) return 0
  let sum = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

/** Sutherland-Hodgman polygon clipping against an axis-aligned rectangle.
 *  Returns the clipped polygon (possibly empty if no overlap). */
function clipPolygonByRect(
  poly: { x: number; y: number }[],
  rect: { x1: number; y1: number; x2: number; y2: number },
): { x: number; y: number }[] {
  type P = { x: number; y: number }
  const inside = [
    (p: P) => p.x >= rect.x1,           // left
    (p: P) => p.x <= rect.x2,           // right
    (p: P) => p.y >= rect.y1,           // top
    (p: P) => p.y <= rect.y2,           // bottom
  ]
  const intersect = (a: P, b: P, edgeIdx: number): P => {
    if (edgeIdx === 0) {
      const dx = b.x - a.x
      const t = dx === 0 ? 0 : (rect.x1 - a.x) / dx
      return { x: rect.x1, y: a.y + t * (b.y - a.y) }
    }
    if (edgeIdx === 1) {
      const dx = b.x - a.x
      const t = dx === 0 ? 0 : (rect.x2 - a.x) / dx
      return { x: rect.x2, y: a.y + t * (b.y - a.y) }
    }
    if (edgeIdx === 2) {
      const dy = b.y - a.y
      const t = dy === 0 ? 0 : (rect.y1 - a.y) / dy
      return { x: a.x + t * (b.x - a.x), y: rect.y1 }
    }
    const dy = b.y - a.y
    const t = dy === 0 ? 0 : (rect.y2 - a.y) / dy
    return { x: a.x + t * (b.x - a.x), y: rect.y2 }
  }
  let output: P[] = poly.slice()
  for (let e = 0; e < 4; e++) {
    if (output.length === 0) break
    const input = output
    output = []
    for (let i = 0; i < input.length; i++) {
      const curr = input[i]
      const prev = input[(i - 1 + input.length) % input.length]
      const currIn = inside[e](curr)
      const prevIn = inside[e](prev)
      if (currIn) {
        if (!prevIn) output.push(intersect(prev, curr, e))
        output.push(curr)
      } else if (prevIn) {
        output.push(intersect(prev, curr, e))
      }
    }
  }
  return output
}

/** IoU of a polygon vs an axis-aligned rectangle, in pixel space. Returns 0
 *  on any degenerate input. */
function computeIoUWithRect(
  poly: { x: number; y: number }[],
  rect: { x1: number; y1: number; x2: number; y2: number },
): number {
  if (poly.length < 3) return 0
  const polyA = polygonArea(poly)
  const rectA = Math.max(0, rect.x2 - rect.x1) * Math.max(0, rect.y2 - rect.y1)
  if (polyA === 0 || rectA === 0) return 0
  const clipped = clipPolygonByRect(poly, rect)
  const inter = clipped.length >= 3 ? polygonArea(clipped) : 0
  const union = polyA + rectA - inter
  return union > 0 ? inter / union : 0
}

// ─────────────────────────────────────────────────────────────
// Self-critique pass (eaves only)
// ─────────────────────────────────────────────────────────────
// Builds a second Static Maps tile with the first-draft polygon
// drawn ON TOP of the same satellite imagery, then asks Claude to
// critique-and-refine. Static Maps and Claude's pixel coords share
// the exact same Mercator projection, so the overlay lands on the
// building 1:1 with the original image. Returns null on any
// regression / failure so the caller falls back to the first draft.
async function refineEavesViaSelfCritique(
  env: Bindings,
  anthropic: Anthropic,
  args: {
    originalImageB64: string
    originalMediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
    draftSegmentsPx: { x: number; y: number }[][]
    framing: { lat: number; lng: number; zoom: number }
    safeW: number
    safeH: number
    targetCenterPx: { x: number; y: number }
    targetBboxPx: { x1: number; y1: number; x2: number; y2: number; widthFt: number; depthFt: number; trusted: boolean; source?: 'hint' | 'solar-trusted' | 'solar-untrusted' } | null
  },
): Promise<{
  segments: { x: number; y: number }[][]
  confidence: number
  reasoning: string
  verticesAdded: number
} | null> {
  const { framing, safeW, safeH, draftSegmentsPx } = args
  const pixelImgW = safeW * 2
  const pixelImgH = safeH * 2

  // Project draft pixel coords back to lat/lng so Static Maps can render them.
  const draftLatLngs = draftSegmentsPx.map(seg =>
    seg.map(p => pxToLatLng(p.x, p.y, framing.lat, framing.lng, framing.zoom, pixelImgW, pixelImgH))
  )

  // Build path params — one path= per polygon, closed (first vertex repeated).
  const pathParams = draftLatLngs
    .filter(seg => seg.length >= 3)
    .map(seg => {
      const closed = [...seg, seg[0]]
      const pts = closed.map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('|')
      // Red outline (FF0000FF), light-green fill (00FF003F = 25% alpha).
      return `path=color:0xff0000ff|weight:4|fillcolor:0x00ff003f|${pts}`
    })
    .join('&')

  if (!pathParams) return null

  const overlayUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${framing.lat},${framing.lng}&zoom=${framing.zoom}&size=${safeW}x${safeH}&scale=2&maptype=satellite&${pathParams}&key=${env.GOOGLE_MAPS_API_KEY}`

  // Static Maps URL hard limit is ~8192 chars. For a single ~20-vertex polygon
  // we're at ~700 chars; bail if we somehow blew past it (multi-building cases).
  if (overlayUrl.length > 8000) {
    console.warn('[auto-trace] refinement overlay URL too long, skipping critique')
    return null
  }

  let overlay: { b64: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }
  try {
    overlay = await fetchImageB64(overlayUrl)
  } catch (e: any) {
    console.warn('[auto-trace] refinement overlay fetch failed:', e?.message)
    return null
  }

  const bboxClause = args.targetBboxPx
    ? ((args.targetBboxPx as any).source === 'hint'
        ? `Target building bbox is AUTHORITATIVE from operator Mark Region (~${args.targetBboxPx.widthFt}ft × ${args.targetBboxPx.depthFt}ft); the first-draft polygon should cover all wings/extensions inside this region — your refinement should EXPAND not shrink.`
        : `Target building is centred at pixel (${args.targetCenterPx.x}, ${args.targetCenterPx.y}); Solar bbox is ${args.targetBboxPx.widthFt}ft × ${args.targetBboxPx.depthFt}ft${args.targetBboxPx.trusted ? '' : ' (UNTRUSTED — may be a merged neighbour OR a legitimate acreage; trust the visible imagery, do not arbitrarily shrink)'}.`)
    : `Target building is centred at pixel (${args.targetCenterPx.x}, ${args.targetCenterPx.y}).`

  const critiqueSystem = [
    'You are an expert roof measurement technician performing a SELF-CRITIQUE pass on a first-draft eave trace.',
    '',
    'INPUTS: 2 images.',
    'Image 1 — clean Google satellite (target reference; ALL pixel coordinates you return must be in this image\'s coordinate space).',
    'Image 2 — the SAME satellite with the first-draft polygon drawn in RED outline + faint green fill.',
    '',
    bboxClause,
    '',
    'Your job: critically evaluate the red polygon. Common misses to look for:',
    '- Front porch / entry roof bump-outs',
    '- Attached garages and breezeways',
    '- Rear additions, mudrooms, sunrooms',
    '- Bay windows, kitchen nooks, bumped-out corners',
    '- Recessed entryways (porch CUT INTO the footprint, not added)',
    '- HVAC mechanical bumps with their own small roof',
    '- ⚠️ TREE-OCCLUDED edges — the first draft may have STOPPED at a tree canopy instead of extrapolating the eave through it. Residential roofs are RECTILINEAR with right-angle corners: if 3 sides are visible, the 4th follows by orthogonal projection. Push the trace through the tree to where the eave actually ends.',
    '',
    'Output rules:',
    '- Keep the corners the first draft got right. Add the corners it missed. Remove any vertex that cuts off real roof or that traces a neighbour.',
    '- If the first draft is correct as-is, return it unchanged with reasoning "first draft already complete".',
    '- One vertex per corner — no points on straight edges. Clockwise. Do NOT repeat the first vertex at the end. Most residential traces land between 8 and 24 vertices per polygon; a true rectangle is 4 and that is correct.',
    '- Call the emit_trace tool with the refined geometry. DO NOT write prose response; the tool schema is the contract.',
  ].join('\n')

  const critiqueUser = `Image 1 is ${pixelImgW}x${pixelImgH} pixels. Image 2 is the same dimensions, identical projection — pixel coords are interchangeable.\n\nFirst-draft vertex count per polygon: ${draftSegmentsPx.map(s => s.length).join(', ')}.\n\nReturn the refined ${draftSegmentsPx.length === 1 ? 'polygon' : 'polygons'} as JSON.`

  const critiqueTool = buildEmitTraceTool('eaves')
  let completion: any
  try {
    completion = await anthropic.messages.create({
      model: CLAUDE_VISION_MODEL,
      max_tokens: 4096,
      system: critiqueSystem,
      tools: [critiqueTool],
      tool_choice: { type: 'tool', name: critiqueTool.name },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: args.originalMediaType, data: args.originalImageB64 } },
          { type: 'image', source: { type: 'base64', media_type: overlay.mediaType, data: overlay.b64 } },
          { type: 'text', text: critiqueUser },
        ],
      }],
    } as any)
  } catch (e: any) {
    console.warn('[auto-trace] refinement Claude call failed:', e?.message)
    return null
  }

  let parsed: { segments: { x: number; y: number }[][]; confidence: number; reasoning: string }
  try {
    parsed = parseToolResponse(completion)
  } catch (e: any) {
    console.warn('[auto-trace] refinement parse failed:', e?.message)
    return null
  }

  // Regression guards — better to keep the first draft than ship a worse one.
  if (parsed.segments.length === 0) return null
  if (parsed.segments.length < draftSegmentsPx.length) return null
  const originalVerts = draftSegmentsPx.reduce((s, p) => s + p.length, 0)
  const refinedVerts = parsed.segments.reduce((s, p) => s + p.length, 0)
  // Refinement should never lose more than 30% of the vertices — if it did,
  // Claude probably collapsed detail rather than adding it.
  if (refinedVerts < originalVerts * 0.7) return null

  return {
    segments: parsed.segments,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
    verticesAdded: refinedVerts - originalVerts,
  }
}

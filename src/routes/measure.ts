// ============================================================
// /api/measure — Tracing helpers for the customer-facing UI
// ============================================================
// Three thin endpoints that surface server-side intelligence
// (RANSAC ridge/eave detection, pitch resolution, SAM3 prefill)
// to the manual tracing flow.
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { getSnapFeatures } from '../services/measure-snap-cache'
import { resolvePitch } from '../services/pitch-resolver'
import { segmentWithGemini, geminiOutlineToTracePayload } from '../services/sam3-segmentation'

export const measureRoutes = new Hono<{ Bindings: Bindings }>()

// ─────────────────────────────────────────────────────────────
// GET /api/measure/snap-features?lat=&lng=
// Returns ridge/eave/hip/valley polylines (lat/lng) the
// frontend can snap manual clicks to (~50cm tolerance).
// ─────────────────────────────────────────────────────────────
measureRoutes.get('/snap-features', async (c) => {
  const lat = Number(c.req.query('lat'))
  const lng = Number(c.req.query('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return c.json({ error: 'lat and lng query params required' }, 400)
  }

  try {
    const features = await getSnapFeatures(c.env, lat, lng)
    if (!features) {
      return c.json({ ridges: [], eaves: [], hips: [], valleys: [], available: false })
    }
    return c.json({ ...features, available: true })
  } catch (err: any) {
    console.warn('[measure/snap-features]', err?.message)
    return c.json({ ridges: [], eaves: [], hips: [], valleys: [], available: false })
  }
})

// ─────────────────────────────────────────────────────────────
// GET /api/measure/live-pitch?lat=&lng=
// Resolves a single roof-wide pitch via Solar API for live
// readout while the user is tracing.
// ─────────────────────────────────────────────────────────────
measureRoutes.get('/live-pitch', async (c) => {
  const lat = Number(c.req.query('lat'))
  const lng = Number(c.req.query('lng'))
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return c.json({ error: 'lat and lng query params required' }, 400)
  }

  try {
    const resolved = await resolvePitch({
      centroidLat: lat,
      centroidLng: lng,
      solarApiKey: c.env.GOOGLE_SOLAR_API_KEY,
      mapsApiKey: c.env.GOOGLE_MAPS_API_KEY,
      logTag: 'measure/live-pitch',
    })

    return c.json({
      pitch_rise: resolved.pitch_rise,
      pitch_deg: resolved.solar_pitch_deg,
      confidence: resolved.pitch_confidence,
      source: resolved.pitch_source,
    })
  } catch (err: any) {
    console.warn('[measure/live-pitch]', err?.message)
    return c.json({ pitch_rise: null, pitch_deg: null, confidence: 'low', source: 'engine_default' })
  }
})

// ─────────────────────────────────────────────────────────────
// POST /api/measure/auto-detect
// Body: { lat, lng, zoom, imageUrl, imageWidth, imageHeight }
// Calls Gemini segmentation → returns a TracePayload-shaped
// object (eaves, eaves_sections, ridges, hips, valleys).
// ─────────────────────────────────────────────────────────────
measureRoutes.post('/auto-detect', async (c) => {
  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid json' }, 400) }

  const lat = Number(body?.lat)
  const lng = Number(body?.lng)
  const zoom = Number(body?.zoom) || 20
  const imageWidth = Number(body?.imageWidth) || 1024
  const imageHeight = Number(body?.imageHeight) || 1024

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return c.json({ error: 'lat and lng required' }, 400)
  }

  // Opt-in bridge to the full auto-trace agent (Claude Opus + Solar +
  // DSM + few-shot + self-critique + snapping + verify-planes). When
  // body.engine === 'claude' is set, route through runAutoTrace for
  // ALL FOUR edge types in parallel (eaves + ridges + hips + valleys)
  // so the customer's "Auto Detect Roof" button pre-fills enough
  // structure for the 3D diagram engine to take Path A (5-pass per-ridge
  // anchoring) instead of the bounding-box hip-roof fallback.
  // Default (no engine field) keeps the existing Gemini-flash one-shot
  // below as the cheap eaves-only fallback.
  if (body?.engine === 'claude') {
    try {
      const { runAutoTrace } = await import('../services/auto-trace-agent')
      const orderId = Number(body?.order_id) || 0
      const baseInput = { orderId, lat, lng, zoom, imageWidth, imageHeight }
      const [eavesRes, ridgesRes, hipsRes, valleysRes] = await Promise.all([
        runAutoTrace(c.env, { ...baseInput, edge: 'eaves' }),
        runAutoTrace(c.env, { ...baseInput, edge: 'ridges' }),
        runAutoTrace(c.env, { ...baseInput, edge: 'hips' }),
        runAutoTrace(c.env, { ...baseInput, edge: 'valleys' }),
      ])
      // /auto-detect's TracePayload shape: eaves is a SINGLE polygon (flat
      // LatLng[]). runAutoTrace returns LatLng[][] (one polygon per
      // structure). Pick the largest polygon as the eaves return; ignore
      // any lower_tier / outbuilding polygons for backward compatibility.
      const primaryEaves = eavesRes.segments.length > 0
        ? eavesRes.segments.reduce((a, b) => a.length >= b.length ? a : b)
        : []
      return c.json({
        eaves: primaryEaves,
        ridges: ridgesRes.segments,
        hips: hipsRes.segments,
        valleys: valleysRes.segments,
        pitch_rise: null,
        agent: {
          eaves:   { confidence: eavesRes.confidence,   reasoning: eavesRes.reasoning },
          ridges:  { confidence: ridgesRes.confidence,  reasoning: ridgesRes.reasoning },
          hips:    { confidence: hipsRes.confidence,    reasoning: hipsRes.reasoning },
          valleys: { confidence: valleysRes.confidence, reasoning: valleysRes.reasoning },
        },
      })
    } catch (err: any) {
      console.warn('[measure/auto-detect:claude]', err?.message)
      return c.json({ error: 'auto_detect_failed', engine: 'claude', message: err?.message }, 500)
    }
  }

  // Build the source image server-side so the API key never leaves the worker.
  // Static Maps caps width/height at 640px per side; scale=2 doubles effective resolution.
  const mapsKey = c.env.GOOGLE_MAPS_API_KEY
  if (!mapsKey) return c.json({ error: 'GOOGLE_MAPS_API_KEY not configured' }, 500)
  const safeW = Math.min(imageWidth, 640)
  const safeH = Math.min(imageHeight, 640)
  const imageUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${safeW}x${safeH}&scale=2&maptype=satellite&key=${mapsKey}`

  try {
    // Fallback to GEMINI_ENHANCE_API_KEY — the production Pages project has
    // that one set, not the canonical GEMINI_API_KEY. Mirrors the same
    // fallback used by reports.ts, sam3-analysis.ts, home-designer.ts.
    const geminiKey = (c.env as any).GEMINI_API_KEY || (c.env as any).GEMINI_ENHANCE_API_KEY
    if (!geminiKey) return c.json({ error: 'segmentation_unavailable', message: 'GEMINI_API_KEY not configured' }, 503)

    // Inline debug — call Gemini directly here and surface any error to the
    // caller so we can see WHY segmentation fails in prod (auth? model? quota?
    // image fetch? JSON parse?). Replaces the swallow-and-log pattern in
    // segmentWithGemini for this one route. TODO: remove once stable.
    let imgB64: string
    try {
      const imgResp = await fetch(imageUrl)
      if (!imgResp.ok) return c.json({ error: 'image_fetch_failed', status: imgResp.status }, 503)
      const buf = new Uint8Array(await imgResp.arrayBuffer())
      let bin = ''
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
      imgB64 = btoa(bin)
    } catch (e: any) {
      return c.json({ error: 'image_fetch_threw', message: e?.message }, 503)
    }

    const gReq = {
      contents: [{ parts: [
        { text: 'Return a tight polygon (>=8 vertices) tracing the OUTER PERIMETER of the largest roof in this satellite image, at the eave line. Pixel coordinates, image is ' + (safeW * 2) + 'x' + (safeH * 2) + ' px (0,0 = top-left).' },
        { inlineData: { mimeType: 'image/jpeg', data: imgB64 } }
      ] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 4096,
        responseSchema: {
          type: 'OBJECT',
          properties: {
            roof_outline: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } },
                required: ['x', 'y']
              }
            }
          },
          required: ['roof_outline']
        }
      }
    }
    // Use gemini-2.5-flash — gemini-2.0-flash is no longer available to keys
    // created after the deprecation window. 2.5-flash supports vision +
    // responseSchema and is the model the rest of the codebase migrated to
    // (see routes/gemini.ts, routes/secretary.ts).
    const gResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(gReq) }
    )
    if (!gResp.ok) {
      const errText = await gResp.text()
      return c.json({ error: 'gemini_error', status: gResp.status, body: errText.slice(0, 500) }, 503)
    }
    const gJson = await gResp.json() as any
    const text = gJson?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      return c.json({ error: 'gemini_no_text', resp: JSON.stringify(gJson).slice(0, 500) }, 503)
    }
    let parsed: any
    try { parsed = JSON.parse(text) } catch (e: any) {
      return c.json({ error: 'gemini_parse_failed', text: text.slice(0, 500) }, 503)
    }
    const outlinePx: { x: number; y: number }[] = parsed?.roof_outline || []
    if (outlinePx.length < 3) {
      return c.json({ error: 'no_outline_detected', got: outlinePx.length }, 422)
    }

    // Convert pixel coords back to lat/lng using the same Mercator math the
    // sam3 helper uses. Static Maps with size=safeWxsafeH and scale=2 yields
    // an effective image of (safeW*2 x safeH*2) px centered on (lat, lng).
    const pixelImgW = safeW * 2
    const pixelImgH = safeH * 2
    const scale = 1 << zoom
    const sin = Math.sin(lat * Math.PI / 180)
    const centerWorldX = (256 * (0.5 + lng / 360)) * scale
    const centerWorldY = (256 * (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI))) * scale
    // Static Maps with scale=2 produces an image where each pixel = 0.5 world units
    // at the given zoom (because scale doubles resolution). Effective pixels-per-world-unit = 2.
    function pxToLatLng(px: number, py: number) {
      const worldX = centerWorldX + (px - pixelImgW / 2) * 0.5
      const worldY = centerWorldY + (py - pixelImgH / 2) * 0.5
      const lng2 = (worldX / (256 * scale) - 0.5) * 360
      const n = Math.PI - 2 * Math.PI * worldY / (256 * scale)
      const lat2 = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
      return { lat: lat2, lng: lng2 }
    }
    const eaves = outlinePx.map(p => pxToLatLng(p.x, p.y))

    return c.json({ eaves, ridges: [], hips: [], valleys: [], pitch_rise: null })
  } catch (err: any) {
    console.warn('[measure/auto-detect]', err?.message)
    return c.json({ error: 'auto_detect_failed', message: err?.message, stack: (err?.stack || '').slice(0, 500) }, 500)
  }
})

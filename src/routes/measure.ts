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

  // Build the source image server-side so the API key never leaves the worker.
  // Static Maps caps width/height at 640px per side; scale=2 doubles effective resolution.
  const mapsKey = c.env.GOOGLE_MAPS_API_KEY
  if (!mapsKey) return c.json({ error: 'GOOGLE_MAPS_API_KEY not configured' }, 500)
  const safeW = Math.min(imageWidth, 640)
  const safeH = Math.min(imageHeight, 640)
  const imageUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${safeW}x${safeH}&scale=2&maptype=satellite&key=${mapsKey}`

  try {
    const seg = await segmentWithGemini(c.env as any, imageUrl, safeW * 2, safeH * 2)
    if (!seg) {
      return c.json({ error: 'segmentation_unavailable' }, 503)
    }
    const payload = geminiOutlineToTracePayload(seg, lat, lng, zoom, imageWidth, imageHeight, {})

    const eaves = (payload.eaves_outline || []).map(p => ({ lat: p.lat, lng: p.lng }))
    if (eaves.length < 3) {
      return c.json({ error: 'no_outline_detected' }, 422)
    }

    return c.json({
      eaves,
      ridges: payload.ridges || [],
      hips: payload.hips || [],
      valleys: payload.valleys || [],
      pitch_rise: payload.default_pitch ?? null,
    })
  } catch (err: any) {
    console.warn('[measure/auto-detect]', err?.message)
    return c.json({ error: 'auto_detect_failed', message: err?.message }, 500)
  }
})

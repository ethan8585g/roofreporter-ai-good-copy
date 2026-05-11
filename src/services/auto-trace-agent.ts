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
  /** Diagnostic context — shown in the dev console only. */
  diagnostics: {
    image_url_redacted: string
    solar_segments_count: number
    training_examples_used: number
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

  const imageUrl = buildSatelliteImageUrl(input.lat, input.lng, zoom, safeW, safeH, env.GOOGLE_MAPS_API_KEY)
  const imageB64 = await fetchImageB64(imageUrl)

  // Google Solar API context — pitches, azimuths, segment bounding boxes.
  // Skipped silently when the property is outside Solar coverage (rural)
  // so the agent still runs from vision + few-shot alone.
  let solarInsights: any = null
  try {
    if (env.GOOGLE_SOLAR_API_KEY) {
      solarInsights = await fetchBuildingInsightsRaw(input.lat, input.lng, env.GOOGLE_SOLAR_API_KEY)
    }
  } catch (e: any) {
    console.warn('[auto-trace] solar insights fetch failed:', e?.message)
  }
  const solarSummary = summarizeSolar(solarInsights)

  // Past human traces of similar properties — Claude uses these as the
  // ground-truth "how a real super-admin draws this kind of roof" reference.
  const examples = await fetchTrainingExamples(env, {
    edge: input.edge,
    centroidLat: input.lat,
    centroidLng: input.lng,
    targetSegments: solarSummary.segments_count,
    limit: 5,
  })

  const systemPrompt = buildSystemPrompt(input.edge)
  const userPrompt = buildUserPrompt({
    edge: input.edge,
    imagePxW: safeW * 2,
    imagePxH: safeH * 2,
    solarSummary,
    examples,
  })

  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const completion = await anthropic.messages.create({
    model: CLAUDE_VISION_MODEL,
    max_tokens: 4096,
    temperature: 0.1,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageB64 } },
        { type: 'text', text: userPrompt },
      ],
    }],
  })

  const text = completion.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim()

  const parsed = parseClaudeResponse(text)
  const pixelImgW = safeW * 2
  const pixelImgH = safeH * 2
  const segments = parsed.segments.map(seg => seg.map(p => pxToLatLng(p.x, p.y, input.lat, input.lng, zoom, pixelImgW, pixelImgH)))

  return {
    edge: input.edge,
    segments,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
    diagnostics: {
      image_url_redacted: imageUrl.replace(/key=[^&]+/, 'key=REDACTED'),
      solar_segments_count: solarSummary.segments_count,
      training_examples_used: examples.length,
      model: CLAUDE_VISION_MODEL,
      elapsed_ms: Date.now() - started,
    },
  }
}

// ─────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────
function buildSystemPrompt(edge: AutoTraceEdge): string {
  const role = edge === 'eaves'
    ? 'detecting the OUTER PERIMETER of every building roof in the image — one closed polygon per structure (house + any detached garages/sheds visible). Trace at the EAVE LINE (drip edge), not the walls. Include all jogs, bump-outs, and lower-tier eaves. 8+ vertices per polygon; corners only — no points on straight edges.'
    : edge === 'ridges'
    ? 'detecting RIDGE LINES — the horizontal peaks where two opposing roof planes meet at the top. Each ridge is a polyline (2+ points). Hip-roof structures usually have one short central ridge; gable roofs have one long ridge per gable. Do NOT trace hips, valleys, or eaves.'
    : 'detecting HIP LINES — the diagonal edges that run from a roof peak down to an outside corner of the eave. Each hip is a polyline (usually 2 points: peak → corner). Hip-roof structures have 4 hips at the corners; gable roofs have zero. Do NOT trace ridges, valleys, or eaves.'

  return [
    `You are an expert roof measurement technician ${role}`,
    '',
    'INPUT: One high-resolution Google satellite image of a residential property. Coordinate origin is top-left (0,0). All coordinates you return must be in pixels.',
    '',
    'OUTPUT: Strict JSON only — no prose, no markdown fences. Schema:',
    '{',
    '  "segments": [ [{"x":int,"y":int}, ...], ... ],',
    '  "confidence": int 0-100,',
    '  "reasoning": "one short sentence on what you saw"',
    '}',
    '',
    'RULES:',
    '- Pixel coordinates must be integers within the image bounds.',
    '- Eaves: each segment is a CLOSED polygon listed clockwise. Do NOT repeat the first vertex at the end.',
    '- Hips/ridges: each segment is an open polyline (2+ points). Points are roof corners or ridge endpoints, never on a straight edge.',
    '- If you cannot see a roof of the requested edge type, return { "segments": [], "confidence": 0, "reasoning": "..." }.',
    '- Use the few-shot examples below as a tracing style reference (vertex density, where corners go) — they are real super-admin traces of similar properties.',
    '- Use the Google Solar API context (segment count, pitch, azimuths) as a structural hint — a 1-segment building has one big ridge; a 4-segment hip roof has 4 hips.',
  ].join('\n')
}

function buildUserPrompt(args: {
  edge: AutoTraceEdge
  imagePxW: number
  imagePxH: number
  solarSummary: ReturnType<typeof summarizeSolar>
  examples: TrainingExample[]
}): string {
  const lines: string[] = []
  lines.push(`Image size: ${args.imagePxW}x${args.imagePxH} pixels.`)
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

async function fetchImageB64(url: string): Promise<string> {
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`satellite image fetch failed (${resp.status})`)
  const buf = new Uint8Array(await resp.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
  return btoa(bin)
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

// ============================================================
// RoofReporterAI — Report Image Generation Worker Route
// ============================================================
// POST /api/report-images/generate
//
// Pipeline (per the RoofReporterAI diagram):
//   1. Measure coordinates (eaves, perimeter, ridges)
//   2. Text-to-Image Cloudflare Worker — branches into:
//      → IMAGE 1: Take 2 satellite images & regenerate to enhance quality/visibility
//      → IMAGE 2: Generate a roof diagram of house to show measures
//   3. These are the main 2 pics showcased on the Report
//
// Uses Gemini 2.0 Flash (image generation) via GEMINI_ENHANCE_API_KEY
// or falls back to GOOGLE_VERTEX_API_KEY.
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'

export const reportImagesRoutes = new Hono<{ Bindings: Bindings }>()

// ── Types ──────────────────────────────────────────────────

interface ReportImageRequest {
  /** Order/report ID to fetch data from */
  order_id?: number
  /** Or pass coordinates directly */
  coordinates?: {
    eaves: { lat: number; lng: number }[]
    perimeter: { lat: number; lng: number }[]
    ridges: { lat: number; lng: number }[][]
  }
  /** Property address for labeling */
  address?: string
  /** Latitude / longitude for satellite fetch */
  lat?: number
  lng?: number
  /** Measurement data for diagram */
  measurements?: {
    total_area_sqft?: number
    total_footprint_sqft?: number
    pitch_degrees?: number
    pitch_ratio?: string
    segments?: {
      name: string
      true_area_sqft: number
      pitch_degrees: number
      azimuth_direction: string
    }[]
    edge_summary?: {
      total_ridge_ft?: number
      total_hip_ft?: number
      total_valley_ft?: number
      total_eave_ft?: number
      total_rake_ft?: number
      total_linear_ft?: number
    }
    edges?: {
      edge_type: string
      label: string
      true_length_ft: number
    }[]
  }
}

interface GeneratedReportImage {
  type: 'enhanced_satellite' | 'roof_diagram'
  label: string
  description: string
  data_url: string   // base64 data URL
  generated_at: string
}

interface ReportImagesResult {
  success: boolean
  images: GeneratedReportImage[]
  generation_time_ms: number
  model: string
}

// ── Helpers ────────────────────────────────────────────────

const GEMINI_IMAGE_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent'

/** Fetch an image URL and return base64 string */
async function fetchImageBase64(url: string, timeoutMs = 10000): Promise<string | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const resp = await fetch(url, { signal: ctrl.signal })
    clearTimeout(t)
    if (!resp.ok) return null
    const buf = await resp.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let bin = ''
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin)
  } catch { return null }
}

/** Call Gemini image generation with optional reference images */
async function callGeminiImage(
  apiKey: string,
  prompt: string,
  referenceImages: string[] = [],
  timeoutMs = 45000
): Promise<string | null> {
  try {
    const parts: any[] = [{ text: prompt }]
    for (const img of referenceImages) {
      parts.push({ inline_data: { mime_type: 'image/png', data: img } })
    }

    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)

    const resp = await fetch(`${GEMINI_IMAGE_API}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          temperature: 0.7
        }
      }),
      signal: ctrl.signal
    })
    clearTimeout(t)

    if (!resp.ok) {
      console.warn(`[ReportImages] Gemini error ${resp.status}: ${(await resp.text()).substring(0, 200)}`)
      return null
    }

    const data: any = await resp.json()
    for (const part of data?.candidates?.[0]?.content?.parts || []) {
      if (part.inline_data?.data) return part.inline_data.data
    }
    return null
  } catch (err: any) {
    console.warn(`[ReportImages] Gemini call failed: ${err.message}`)
    return null
  }
}

/** Convert decimal feet to ft + inches string, e.g. 8.42 → "8ft 5in" */
function feetToFtIn(decimalFt: number): string {
  const ft = Math.floor(decimalFt)
  const inches = Math.round((decimalFt - ft) * 12)
  if (inches === 0) return `${ft}ft`
  if (inches === 12) return `${ft + 1}ft`
  return `${ft}ft ${inches}in`
}

// ── Auth middleware ─────────────────────────────────────────

async function getAuthUser(c: any): Promise<{ id: number; role: string } | null> {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice(7)

  // Admin session
  const admin = await c.env.DB.prepare(
    "SELECT u.id, u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at>datetime('now')"
  ).bind(token).first<any>()
  if (admin) return { id: admin.id, role: admin.role }

  // Customer session
  const cust = await c.env.DB.prepare(
    "SELECT cs.customer_id FROM customer_sessions cs WHERE cs.session_token=? AND cs.expires_at>datetime('now')"
  ).bind(token).first<any>()
  if (cust) return { id: cust.customer_id, role: 'customer' }

  return null
}

reportImagesRoutes.use('/*', async (c, next) => {
  const user = await getAuthUser(c)
  if (!user) return c.json({ error: 'Authentication required' }, 401)
  c.set('user' as any, user)
  return next()
})

// ============================================================
// POST /generate — Main pipeline: coordinates → 2 report images
// ============================================================
reportImagesRoutes.post('/generate', async (c) => {
  const startTime = Date.now()
  const body: ReportImageRequest = await c.req.json()

  // Resolve Gemini API key
  const apiKey = (c.env as any).GEMINI_ENHANCE_API_KEY || c.env.GOOGLE_VERTEX_API_KEY
  if (!apiKey) return c.json({ error: 'Gemini API key not configured (GEMINI_ENHANCE_API_KEY or GOOGLE_VERTEX_API_KEY)' }, 503)

  // Resolve Google Maps key for satellite fetch
  const mapsKey = c.env.GOOGLE_MAPS_API_KEY || c.env.GOOGLE_SOLAR_API_KEY

  // ── If order_id provided, load report data from DB ──
  let lat = body.lat, lng = body.lng
  let address = body.address || ''
  let measurements = body.measurements
  let reportJson: any = null

  if (body.order_id) {
    const report = await c.env.DB.prepare(
      'SELECT report_json FROM reports WHERE order_id = ? ORDER BY id DESC LIMIT 1'
    ).bind(body.order_id).first<any>()

    if (report?.report_json) {
      try {
        reportJson = JSON.parse(report.report_json)
        lat = lat || reportJson.property?.latitude || reportJson.metadata?.coordinates?.lat
        lng = lng || reportJson.property?.longitude || reportJson.metadata?.coordinates?.lng
        address = address || [reportJson.property?.address, reportJson.property?.city, reportJson.property?.province].filter(Boolean).join(', ')

        // Extract measurements from report
        measurements = measurements || {
          total_area_sqft: reportJson.total_true_area_sqft,
          total_footprint_sqft: reportJson.total_footprint_sqft,
          pitch_degrees: reportJson.roof_pitch_degrees,
          pitch_ratio: reportJson.roof_pitch_ratio,
          segments: reportJson.segments?.map((s: any) => ({
            name: s.name,
            true_area_sqft: s.true_area_sqft,
            pitch_degrees: s.pitch_degrees,
            azimuth_direction: s.azimuth_direction
          })),
          edge_summary: reportJson.edge_summary,
          edges: reportJson.edges?.map((e: any) => ({
            edge_type: e.edge_type,
            label: e.label,
            true_length_ft: e.true_length_ft
          }))
        }
      } catch (e) {
        console.warn('[ReportImages] Failed to parse report JSON')
      }
    }
  }

  if (!lat || !lng) {
    return c.json({ error: 'Latitude and longitude are required (either pass lat/lng or order_id with a generated report)' }, 400)
  }

  const images: GeneratedReportImage[] = []

  // ══════════════════════════════════════════════════════════
  // IMAGE 1: Enhanced Satellite Composite
  // Take 2 satellite images & regenerate to enhance quality/visibility
  // ══════════════════════════════════════════════════════════
  console.log('[ReportImages] === IMAGE 1: Enhanced Satellite Composite ===')

  let image1: string | null = null
  if (mapsKey) {
    // Fetch 2 satellite images at different zoom levels
    const overheadUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=20&size=640x640&maptype=satellite&key=${mapsKey}`
    const contextUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=19&size=640x640&maptype=satellite&key=${mapsKey}`

    console.log('[ReportImages] Fetching 2 satellite images (zoom 20 + zoom 19)...')
    const [sat1, sat2] = await Promise.all([
      fetchImageBase64(overheadUrl),
      fetchImageBase64(contextUrl)
    ])

    const refImages = [sat1, sat2].filter(Boolean) as string[]
    console.log(`[ReportImages] Got ${refImages.length} satellite images, sending to Gemini for enhancement...`)

    if (refImages.length > 0) {
      // Build edge/measurement context for annotation
      const edgeInfo = measurements?.edge_summary
        ? `Edge measurements:
  - Ridge: ${measurements.edge_summary.total_ridge_ft || 0} ft
  - Hip: ${measurements.edge_summary.total_hip_ft || 0} ft
  - Valley: ${measurements.edge_summary.total_valley_ft || 0} ft
  - Eave: ${measurements.edge_summary.total_eave_ft || 0} ft
  - Rake: ${measurements.edge_summary.total_rake_ft || 0} ft`
        : ''

      const segmentInfo = measurements?.segments
        ? measurements.segments.map((s, i) =>
            `  Segment ${i + 1}: ${s.name} — ${s.true_area_sqft} sqft, ${s.pitch_degrees}° pitch, facing ${s.azimuth_direction}`
          ).join('\n')
        : ''

      const prompt1 = `You are a professional aerial imagery specialist creating EagleView-quality roof imagery for a formal measurement report.

I'm providing ${refImages.length} satellite image(s) of a residential property roof. Create ONE single, stunning EAGLE-VIEW overhead image.

CRITICAL REQUIREMENTS:
1. TRUE EAGLE-VIEW PERSPECTIVE — perfectly overhead/nadir view (looking straight down), like a drone at 200ft altitude
2. ULTRA-HIGH CLARITY — Photorealistic, razor-sharp roof edges, individual shingle lines visible
3. ACCURATE ROOF GEOMETRY — Maintain exact proportions and shape from the satellite images. Do NOT distort, stretch, or change the roof shape
4. ENHANCED QUALITY — Fix any blur, cloud cover, shadow issues. Make it look like a clear, sunny day capture
5. PROFESSIONAL COLOR GRADING — High contrast, vivid but natural colors, crisp shadows showing roof pitch/depth

ANNOTATION OVERLAY (clean, precise lines):
- RED lines (2px) along RIDGES with measurement labels
- AMBER/GOLD lines (2px) along HIPS with measurement labels
- GREEN lines (2px) along EAVES with measurement labels
- BLUE dashed lines along VALLEYS (if any) with measurement labels
- Each roof facet tinted with a different semi-transparent pastel overlay (20% opacity)
- Small area label on each facet showing square footage
- Clean LEGEND box (bottom-right): edge type colors + total area
- "RoofReporterAI" small professional watermark (top-left corner)

Property: ${address || 'Residential Property'}
Total roof area: ${measurements?.total_area_sqft?.toLocaleString() || '?'} sq ft
Pitch: ${measurements?.pitch_ratio || '?'} (${measurements?.pitch_degrees || '?'}°)
${edgeInfo}
${segmentInfo ? `Roof segments:\n${segmentInfo}` : ''}

OUTPUT: One single, professional eagle-view aerial photograph — enhanced to look like premium EagleView/Nearmap/Google Solar quality imagery. Sharp enough to see individual shingle courses. Measurement annotations overlaid cleanly.`

      image1 = await callGeminiImage(apiKey, prompt1, refImages, 45000)
    }
  }

  if (image1) {
    images.push({
      type: 'enhanced_satellite',
      label: 'AI-Enhanced Satellite Measurement View',
      description: 'Enhanced satellite composite with color-coded edge annotations, facet overlays, and measurement labels.',
      data_url: `data:image/png;base64,${image1}`,
      generated_at: new Date().toISOString()
    })
    console.log(`[ReportImages] ✅ Image 1 generated (${Math.round(image1.length / 1024)}KB)`)
  } else {
    console.warn('[ReportImages] ⚠ Image 1 failed — satellite enhancement not available')
  }

  // ══════════════════════════════════════════════════════════
  // IMAGE 2: Professional Roof Diagram with Measurements
  // Generate a 3D roof diagram of house to show measures
  // (per diagram: 8ft 5 inches, 12ft 9 inches etc.)
  // ══════════════════════════════════════════════════════════
  console.log('[ReportImages] === IMAGE 2: 3D Roof Measurement Diagram ===')

  // Build detailed dimension strings in ft + inches format
  const edgeSummary = measurements?.edge_summary || {} as any
  const ridgeFt = edgeSummary.total_ridge_ft || 0
  const hipFt = edgeSummary.total_hip_ft || 0
  const valleyFt = edgeSummary.total_valley_ft || 0
  const eaveFt = edgeSummary.total_eave_ft || 0
  const rakeFt = edgeSummary.total_rake_ft || 0

  // Build per-edge dimension labels
  const edgeLabels = (measurements?.edges || [])
    .filter(e => e.true_length_ft > 0)
    .map(e => `${e.label}: ${feetToFtIn(e.true_length_ft)} (${e.edge_type})`)
    .join('\n')

  // Build segment dimension descriptions
  const segmentDims = (measurements?.segments || [])
    .map((s, i) => `Facet ${i + 1} "${s.name}": ${s.true_area_sqft.toLocaleString()} sqft at ${s.pitch_degrees}° facing ${s.azimuth_direction}`)
    .join('\n')

  const totalArea = measurements?.total_area_sqft || 0
  const pitchRatio = measurements?.pitch_ratio || '6:12'
  const pitchDeg = measurements?.pitch_degrees || 25

  const prompt2 = `Create a professional ARCHITECTURAL ROOF MEASUREMENT DIAGRAM suitable for a formal roofing report.

This should be a clean 3D ISOMETRIC technical drawing of a residential roof structure, showing:

PERSPECTIVE:
- 3D isometric view (45° angle) showing the roof from above-and-in-front
- Clean white/light gray house walls visible below roofline
- Light blue sky gradient background

ROOF STRUCTURE:
- ${(measurements?.segments || []).length || 4} distinct roof facets/planes
- Main pitch: ${pitchDeg}° (${pitchRatio})
- Total roof area: ${totalArea.toLocaleString()} sq ft
${segmentDims ? `- Facets:\n${segmentDims}` : ''}

MEASUREMENT ANNOTATIONS (the key feature):
- Draw precise DIMENSION LINES with arrows on each roof edge
- Show measurements in FEET AND INCHES format (e.g., "12ft 9in", "8ft 5in")
- Use different colors for edge types:
  • RED dimension lines for RIDGES — total ${feetToFtIn(ridgeFt)}
  • BLUE dimension lines for HIPS — total ${feetToFtIn(hipFt)}
  • GREEN dimension lines for VALLEYS — total ${feetToFtIn(valleyFt)}
  • YELLOW dimension lines for EAVES — total ${feetToFtIn(eaveFt)}
  • ORANGE dimension lines for RAKES — total ${feetToFtIn(rakeFt)}
${edgeLabels ? `\nIndividual edge measurements:\n${edgeLabels}` : ''}

ADDITIONAL ELEMENTS:
- Each roof facet color-coded with a different pastel shade
- Area label on each facet showing sqft
- Pitch angle shown with a small pitch triangle indicator
- Small compass rose in corner showing North direction
- Clean LEGEND box showing: edge type colors, total area badge, pitch info
- "RoofReporterAI" branded watermark in corner, small and professional
- Dark navy border (#002244)

Property: ${address || 'Residential Property'}

STYLE: Professional architectural technical drawing. Clean vector-like lines, precise measurements, high contrast. Like an EagleView or Hover 3D measurement diagram. NOT a photograph — this is a clean technical illustration.`

  const image2 = await callGeminiImage(apiKey, prompt2, [], 45000)

  if (image2) {
    images.push({
      type: 'roof_diagram',
      label: '3D Roof Measurement Diagram',
      description: `Professional 3D isometric roof diagram with dimension lines showing all measurements in feet and inches.`,
      data_url: `data:image/png;base64,${image2}`,
      generated_at: new Date().toISOString()
    })
    console.log(`[ReportImages] ✅ Image 2 generated (${Math.round(image2.length / 1024)}KB)`)
  } else {
    console.warn('[ReportImages] ⚠ Image 2 failed — diagram generation not available')
  }

  // ── Store in DB if order_id provided ──
  if (body.order_id && images.length > 0) {
    try {
      const imgJson = JSON.stringify({
        images: images.map(i => ({
          type: i.type,
          label: i.label,
          description: i.description,
          data_url: i.data_url,
          generated_at: i.generated_at
        })),
        generation_time_ms: Date.now() - startTime,
        model: 'gemini-2.0-flash-exp',
        generated_at: new Date().toISOString()
      })

      // Update the report JSON with the new showcase images
      if (reportJson) {
        reportJson.report_showcase_images = {
          enhanced_satellite: images.find(i => i.type === 'enhanced_satellite')?.data_url || null,
          roof_diagram: images.find(i => i.type === 'roof_diagram')?.data_url || null,
          generated_at: new Date().toISOString(),
          generation_time_ms: Date.now() - startTime
        }

        await c.env.DB.prepare(
          'UPDATE reports SET report_json = ?, ai_status = ?, updated_at = datetime(\'now\') WHERE order_id = ? ORDER BY id DESC LIMIT 1'
        ).bind(JSON.stringify(reportJson), 'images_generated', body.order_id).run()
      }

      // Also store in a dedicated column/table for fast access
      await c.env.DB.prepare(`
        INSERT OR REPLACE INTO report_showcase_images (order_id, image_1_type, image_1_url, image_2_type, image_2_url, generated_at, generation_time_ms)
        VALUES (?, 'enhanced_satellite', ?, 'roof_diagram', ?, datetime('now'), ?)
      `).bind(
        body.order_id,
        images.find(i => i.type === 'enhanced_satellite')?.data_url || null,
        images.find(i => i.type === 'roof_diagram')?.data_url || null,
        Date.now() - startTime
      ).run().catch(() => {
        // Table might not exist yet — that's fine, the report_json update is the primary storage
        console.log('[ReportImages] report_showcase_images table not found — using report_json storage only')
      })
    } catch (e: any) {
      console.warn(`[ReportImages] DB update error: ${e.message}`)
    }
  }

  const result: ReportImagesResult = {
    success: images.length > 0,
    images,
    generation_time_ms: Date.now() - startTime,
    model: 'gemini-2.0-flash-exp'
  }

  console.log(`[ReportImages] ✅ Pipeline complete: ${images.length}/2 images in ${result.generation_time_ms}ms`)
  return c.json(result)
})

// ============================================================
// POST /eagle-view — Regenerate ONLY the eagle-view satellite image
// Higher quality, focused solely on the overhead roof photo
// ============================================================
reportImagesRoutes.post('/eagle-view', async (c) => {
  const startTime = Date.now()
  const body: ReportImageRequest = await c.req.json()

  const apiKey = (c.env as any).GEMINI_ENHANCE_API_KEY || c.env.GOOGLE_VERTEX_API_KEY
  if (!apiKey) return c.json({ error: 'Gemini API key not configured' }, 503)
  const mapsKey = c.env.GOOGLE_MAPS_API_KEY || c.env.GOOGLE_SOLAR_API_KEY
  if (!mapsKey) return c.json({ error: 'Google Maps API key required for satellite imagery' }, 503)

  let lat = body.lat, lng = body.lng
  let address = body.address || ''
  let measurements = body.measurements
  let reportJson: any = null

  // Resolve from order_id
  if (body.order_id) {
    const report = await c.env.DB.prepare(
      'SELECT report_json FROM reports WHERE order_id = ? ORDER BY id DESC LIMIT 1'
    ).bind(body.order_id).first<any>()
    if (report?.report_json) {
      try {
        reportJson = JSON.parse(report.report_json)
        lat = lat || reportJson.property?.latitude || reportJson.metadata?.coordinates?.lat
        lng = lng || reportJson.property?.longitude || reportJson.metadata?.coordinates?.lng
        address = address || [reportJson.property?.address, reportJson.property?.city, reportJson.property?.province].filter(Boolean).join(', ')
        measurements = measurements || {
          total_area_sqft: reportJson.total_true_area_sqft,
          total_footprint_sqft: reportJson.total_footprint_sqft,
          pitch_degrees: reportJson.roof_pitch_degrees,
          pitch_ratio: reportJson.roof_pitch_ratio,
          segments: reportJson.segments?.map((s: any) => ({ name: s.name, true_area_sqft: s.true_area_sqft, pitch_degrees: s.pitch_degrees, azimuth_direction: s.azimuth_direction })),
          edge_summary: reportJson.edge_summary,
        }
      } catch (e) { console.warn('[EagleView] Failed to parse report JSON') }
    }
  }

  if (!lat || !lng) return c.json({ error: 'Coordinates required' }, 400)

  // Fetch 3 satellite images at different zoom levels for maximum quality
  console.log('[EagleView] Fetching 3 satellite images (zoom 21 + 20 + 19)...')
  const [sat1, sat2, sat3] = await Promise.all([
    fetchImageBase64(`https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=21&size=640x640&maptype=satellite&key=${mapsKey}`),
    fetchImageBase64(`https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=20&size=640x640&maptype=satellite&key=${mapsKey}`),
    fetchImageBase64(`https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=19&size=640x640&maptype=satellite&key=${mapsKey}`)
  ])

  const refImages = [sat1, sat2, sat3].filter(Boolean) as string[]
  if (refImages.length === 0) return c.json({ error: 'Failed to fetch satellite images' }, 502)

  console.log(`[EagleView] Got ${refImages.length} images, generating eagle-view...`)

  const eaglePrompt = `You are a premium aerial imagery enhancement AI. Create the highest quality possible EAGLE-VIEW overhead roof image from these ${refImages.length} satellite photos.

MISSION: Produce a PHOTOREALISTIC, ULTRA-SHARP eagle-view image of this roof — as if captured by a professional drone at 150-200ft altitude on a clear sunny day.

CRITICAL — DO THIS:
1. PERFECT NADIR (straight-down) perspective — zero angle, pure overhead
2. PHOTOREALISTIC quality — this must look like an actual drone photograph, NOT a rendering
3. RAZOR-SHARP edges — individual shingle courses and tab lines should be visible
4. NATURAL lighting — bright, clear day, gentle shadows showing roof plane angles and depth
5. TRUE-TO-LIFE colors — realistic shingle colors, realistic surroundings (grass, driveway, trees)
6. ACCURATE PROPORTIONS — match the exact roof shape and geometry from the satellite images precisely
7. NO distortion — maintain exact building footprint proportions

ENHANCE:
- Remove any cloud cover, haze, atmospheric blur
- Sharpen all roof edges dramatically  
- Increase detail resolution — make it look 4x higher resolution than the input
- Correct any color cast or poor white balance
- Add realistic shadow depth to show roof pitch angles clearly

DO NOT:
- Do NOT add text, annotations, measurement lines, or labels
- Do NOT change the roof shape or footprint
- Do NOT add objects that aren't in the original
- Do NOT make it look like a 3D render or CGI — keep it photorealistic

Property: ${address || 'Residential Property'}
Roof area: ~${measurements?.total_area_sqft?.toLocaleString() || '?'} sq ft, Pitch: ${measurements?.pitch_ratio || '?'}

OUTPUT: A single, stunning eagle-view aerial photograph that looks like it was captured by a $50,000 professional aerial imaging system (like EagleView, Nearmap, or Verisk). Ultra-sharp. Photorealistic.`

  const eagleImage = await callGeminiImage(apiKey, eaglePrompt, refImages, 60000)

  if (!eagleImage) {
    return c.json({ success: false, error: 'Eagle-view generation failed', generation_time_ms: Date.now() - startTime }, 500)
  }

  const dataUrl = `data:image/png;base64,${eagleImage}`

  // Update report JSON if order_id provided
  if (body.order_id && reportJson) {
    try {
      reportJson.eagle_view_image = {
        data_url: dataUrl,
        generated_at: new Date().toISOString(),
        generation_time_ms: Date.now() - startTime,
        model: 'gemini-2.0-flash-exp'
      }
      // Also update the satellite overhead URL to use the eagle view
      if (reportJson.imagery) {
        reportJson.imagery.eagle_view_url = dataUrl
      }
      await c.env.DB.prepare(
        'UPDATE reports SET report_json = ?, updated_at = datetime(\'now\') WHERE order_id = ?'
      ).bind(JSON.stringify(reportJson), body.order_id).run()
      console.log(`[EagleView] ✅ Saved eagle-view for order ${body.order_id}`)
    } catch (e: any) {
      console.warn(`[EagleView] DB save error: ${e.message}`)
    }
  }

  console.log(`[EagleView] ✅ Eagle-view generated in ${Date.now() - startTime}ms (${Math.round(eagleImage.length / 1024)}KB)`)

  return c.json({
    success: true,
    image: {
      type: 'eagle_view',
      label: 'Eagle-View Aerial Image',
      description: 'AI-enhanced eagle-view overhead photograph — photorealistic, ultra-sharp drone-quality imagery.',
      data_url: dataUrl,
      generated_at: new Date().toISOString()
    },
    generation_time_ms: Date.now() - startTime,
    model: 'gemini-2.0-flash-exp'
  })
})

// ============================================================
// GET /status — Check image generation capability
// ============================================================
reportImagesRoutes.get('/status', async (c) => {
  const hasGemini = !!(c.env as any).GEMINI_ENHANCE_API_KEY || !!c.env.GOOGLE_VERTEX_API_KEY
  const hasMaps = !!c.env.GOOGLE_MAPS_API_KEY || !!c.env.GOOGLE_SOLAR_API_KEY

  return c.json({
    available: hasGemini,
    capabilities: {
      image_1_enhanced_satellite: hasGemini && hasMaps,
      image_2_roof_diagram: hasGemini
    },
    model: 'gemini-2.0-flash-exp',
    description: 'Generates 2 showcase images for roof measurement reports: (1) AI-enhanced satellite composite with measurement annotations, (2) Professional 3D roof diagram with dimensions in feet and inches.'
  })
})

// ============================================================
// GET /:order_id — Retrieve previously generated images for an order
// ============================================================
reportImagesRoutes.get('/:order_id', async (c) => {
  const orderId = parseInt(c.req.param('order_id'))
  if (isNaN(orderId)) return c.json({ error: 'Invalid order_id' }, 400)

  // Try report_json first
  const report = await c.env.DB.prepare(
    'SELECT report_json FROM reports WHERE order_id = ? ORDER BY id DESC LIMIT 1'
  ).bind(orderId).first<any>()

  if (report?.report_json) {
    try {
      const rj = JSON.parse(report.report_json)
      if (rj.report_showcase_images) {
        return c.json({
          success: true,
          order_id: orderId,
          images: rj.report_showcase_images
        })
      }
      // Check older ai_generated_imagery field
      if (rj.ai_generated_imagery) {
        return c.json({
          success: true,
          order_id: orderId,
          images: rj.ai_generated_imagery
        })
      }
    } catch { /* parse error */ }
  }

  return c.json({ success: false, order_id: orderId, message: 'No showcase images generated yet for this order.' })
})

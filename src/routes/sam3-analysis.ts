// ============================================================
// Roof Manager — SAM 3 Satellite Image Analysis Routes
// ============================================================
//
// Integrates SAM 3 + Gemini into the existing report pipeline
// for enhanced satellite image analysis and annotation.
//
// ENDPOINTS:
//   POST /api/reports/:orderId/sam3-analyze     → Run SAM 3 + Gemini on report satellite image
//   GET  /api/reports/:orderId/sam3-results     → Get analysis results
//   POST /api/reports/:orderId/sam3-annotate    → Generate annotated satellite overlay
//   GET  /api/reports/sam3-capabilities         → System capabilities check
//   POST /api/reports/:orderId/auto-pipeline    → Full auto-fallback: SAM3 → Gemini → RANSAC
// ============================================================

import type { Context } from 'hono'
import { Hono } from 'hono'
import { getCustomerSessionToken } from '../lib/session-tokens'
import type { Bindings, AppEnv } from '../types'
import {
  segmentWithSAM3,
  segmentWithGemini,
  runUnifiedSegmentation,
  calculateGSD,
  pixelsToSquareFeet,
  pixelsToLinearFeet,
  convertToAIMeasurement,
  type UnifiedSegmentationResult,
  type EnrichedRoofSegment,
  type EnrichedEdge
} from '../services/sam3-segmentation'

const sam3Routes = new Hono<AppEnv>()

// ── AUTH HELPER ──────────────────────────────────────────────

async function validateAdmin(c: Context<AppEnv>): Promise<boolean> {
  const authHeader = c.req.header('Authorization') || ''
  const token = authHeader.replace('Bearer ', '')
  if (!token) return false
  const session = await c.env.DB.prepare(
    "SELECT admin_id FROM admin_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  return !!session
}

async function validateCustomer(c: Context<AppEnv>): Promise<number | null> {
  const token = getCustomerSessionToken(c)
  if (!token) return null
  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  return session?.customer_id || null
}

// ── DB Tables ──────────────────────────────────────────────

async function ensureSAM3Tables(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sam3_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      tier_used INTEGER,
      tiers_attempted TEXT,
      segmentation_result TEXT,
      enriched_segments TEXT,
      edges_detected TEXT,
      obstructions_detected TEXT,
      summary TEXT,
      confidence_scores TEXT,
      gsd_meters REAL,
      image_url TEXT,
      image_width INTEGER,
      image_height INTEGER,
      latitude REAL,
      longitude REAL,
      zoom_level INTEGER DEFAULT 20,
      annotated_svg TEXT,
      processing_time_ms INTEGER,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sam3_order ON sam3_analyses(order_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sam3_pipeline_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      tier INTEGER NOT NULL,
      tier_name TEXT NOT NULL,
      status TEXT NOT NULL,
      confidence REAL,
      segments_found INTEGER,
      edges_found INTEGER,
      processing_time_ms INTEGER,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sam3_pipeline_order ON sam3_pipeline_log(order_id)`),
  ])
}

// ============================================================
// GET /sam3-capabilities — System capabilities check
// ============================================================

sam3Routes.get('/sam3-capabilities', async (c) => {
  const env = c.env as any
  return c.json({
    success: true,
    capabilities: {
      sam3: {
        available: !!(env.HF_API_TOKEN),
        endpoint: env.SAM3_ENDPOINT_URL ? 'custom' : 'huggingface_serverless',
        model: 'facebook/sam3',
        tier: 1,
        features: ['instance_segmentation', 'open_vocabulary', 'text_prompts', 'box_prompts', '270k_concepts'],
      },
      gemini: {
        available: !!(env.GEMINI_API_KEY || env.GEMINI_ENHANCE_API_KEY),
        model: 'gemini-2.0-flash',
        tier: 2,
        features: ['structured_segmentation', 'pitch_estimation', 'material_id', 'condition_assessment', 'json_schema'],
      },
      ransac: {
        available: true,
        tier: 3,
        features: ['dsm_planar_segmentation', 'edge_classification', 'no_api_required'],
      },
      imagery: {
        google_solar: !!(env.GOOGLE_SOLAR_API_KEY),
        google_maps: !!(env.GOOGLE_MAPS_API_KEY),
        nearmap: !!(env.NEARMAP_API_KEY),
        eagleview: !!(env.EAGLEVIEW_API_KEY),
      },
      replicate: {
        available: !!(env.REPLICATE_API_KEY),
        use: 'image_inpainting_for_recolor',
      }
    },
    recommended_pipeline: 'SAM 3 → Gemini → RANSAC (auto-fallback)',
  })
})

// ============================================================
// POST /:orderId/sam3-analyze — Run SAM 3 + Gemini analysis
// ============================================================

sam3Routes.post('/:orderId/sam3-analyze', async (c) => {
  const isAdmin = await validateAdmin(c)
  const customerId = await validateCustomer(c)
  if (!isAdmin && !customerId) return c.json({ error: 'Authentication required' }, 401)

  const orderId = c.req.param('orderId')
  const startMs = Date.now()

  try {
    await ensureSAM3Tables(c.env.DB)

    // Get order data
    const order = await c.env.DB.prepare(
      'SELECT id, property_address, latitude, longitude FROM orders WHERE id = ?'
    ).bind(orderId).first<any>()
    if (!order) return c.json({ error: 'Order not found' }, 404)

    // Get satellite image URL from existing report
    const report = await c.env.DB.prepare(
      'SELECT satellite_image_url, api_response_raw FROM roof_reports WHERE order_id = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(orderId).first<any>()

    let imageUrl = ''
    if (report?.satellite_image_url) {
      imageUrl = report.satellite_image_url
    } else if (report?.api_response_raw) {
      try {
        const raw = JSON.parse(report.api_response_raw)
        imageUrl = raw?.imagery?.satellite_overhead_url || raw?.imagery?.satellite_url || ''
      } catch {}
    }

    // Fallback to Google Maps Static API
    if (!imageUrl && order.latitude && order.longitude) {
      const mapsKey = (c.env as any).GOOGLE_MAPS_API_KEY
      if (mapsKey) {
        imageUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${order.latitude},${order.longitude}&zoom=20&size=640x640&scale=2&maptype=satellite&key=${mapsKey}`
      }
    }

    if (!imageUrl) {
      return c.json({ error: 'No satellite image available for this order. Generate a report first.' }, 400)
    }

    const body = await c.req.json().catch(() => ({}))
    const zoom = body.zoom || 20
    const imageWidth = body.image_width || 640
    const imageHeight = body.image_height || 640

    console.log(`[SAM3-Route] Starting analysis for order ${orderId} — lat=${order.latitude}, lng=${order.longitude}, zoom=${zoom}`)

    // ── Run unified segmentation pipeline ──
    const env = c.env as any
    const result = await runUnifiedSegmentation(
      env,
      imageUrl,
      parseFloat(order.latitude) || 53.5,
      parseFloat(order.longitude) || -113.5,
      zoom,
      imageWidth,
      imageHeight,
    )

    // ── Log each tier's performance ──
    for (const tier of result.processing_tiers_used) {
      const tierName = tier === 1 ? 'SAM3' : tier === 2 ? 'Gemini' : 'RANSAC'
      const tierSegments = result.segments.filter(s => 
        s.source === tierName.toLowerCase() || s.source === 'fused'
      ).length

      await c.env.DB.prepare(`
        INSERT INTO sam3_pipeline_log (order_id, tier, tier_name, status, confidence, segments_found, edges_found, processing_time_ms, created_at)
        VALUES (?, ?, ?, 'success', ?, ?, ?, ?, datetime('now'))
      `).bind(
        parseInt(orderId),
        tier,
        tierName,
        result.segments.reduce((max, s) => Math.max(max, s.confidence), 0),
        tierSegments,
        result.edges.length,
        result.total_inference_ms,
      ).run()
    }

    // ── Store analysis result ──
    await c.env.DB.prepare(`
      INSERT INTO sam3_analyses (
        order_id, status, tier_used, tiers_attempted,
        enriched_segments, edges_detected, obstructions_detected, summary,
        confidence_scores, gsd_meters, image_url, image_width, image_height,
        latitude, longitude, zoom_level,
        processing_time_ms, created_at, updated_at
      ) VALUES (?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).bind(
      parseInt(orderId),
      result.processing_tiers_used[0] || 3,
      JSON.stringify(result.processing_tiers_used),
      JSON.stringify(result.segments),
      JSON.stringify(result.edges),
      JSON.stringify(result.obstructions),
      JSON.stringify(result.summary),
      JSON.stringify(result.segments.map(s => ({ id: s.id, source: s.source, confidence: s.confidence }))),
      result.gsd_meters,
      imageUrl.length > 500 ? '[satellite_image]' : imageUrl,
      imageWidth,
      imageHeight,
      parseFloat(order.latitude) || 0,
      parseFloat(order.longitude) || 0,
      zoom,
      Date.now() - startMs,
    ).run()

    return c.json({
      success: true,
      order_id: orderId,
      analysis: {
        tiers_used: result.processing_tiers_used,
        tier_names: result.processing_tiers_used.map(t => t === 1 ? 'SAM 3' : t === 2 ? 'Gemini' : 'RANSAC'),
        segments: result.segments,
        edges: result.edges,
        obstructions: result.obstructions,
        summary: result.summary,
        gsd_meters: result.gsd_meters,
        total_inference_ms: result.total_inference_ms,
      },
      processing_time_ms: Date.now() - startMs,
      message: `Analysis complete using tier(s): ${result.processing_tiers_used.map(t => t === 1 ? 'SAM 3' : t === 2 ? 'Gemini' : 'RANSAC').join(' → ')}`,
    })
  } catch (err: any) {
    console.error(`[SAM3-Route] Analysis error for order ${orderId}:`, err.message)
    return c.json({ error: err.message }, 500)
  }
})

// ============================================================
// GET /:orderId/sam3-results — Get stored analysis results
// ============================================================

sam3Routes.get('/:orderId/sam3-results', async (c) => {
  const isAdmin = await validateAdmin(c)
  const customerId = await validateCustomer(c)
  if (!isAdmin && !customerId) return c.json({ error: 'Authentication required' }, 401)

  const orderId = c.req.param('orderId')

  try {
    await ensureSAM3Tables(c.env.DB)

    const analysis = await c.env.DB.prepare(
      'SELECT * FROM sam3_analyses WHERE order_id = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(orderId).first<any>()

    if (!analysis) {
      return c.json({
        success: false,
        error: 'No SAM 3 analysis found for this order. Run /sam3-analyze first.',
        available: false,
      }, 404)
    }

    // Parse stored JSON fields
    const parsed = {
      ...analysis,
      enriched_segments: JSON.parse(analysis.enriched_segments || '[]'),
      edges_detected: JSON.parse(analysis.edges_detected || '[]'),
      obstructions_detected: JSON.parse(analysis.obstructions_detected || '[]'),
      summary: JSON.parse(analysis.summary || '{}'),
      confidence_scores: JSON.parse(analysis.confidence_scores || '[]'),
      tiers_attempted: JSON.parse(analysis.tiers_attempted || '[]'),
    }

    // Get pipeline log
    const pipelineLog = await c.env.DB.prepare(
      'SELECT * FROM sam3_pipeline_log WHERE order_id = ? ORDER BY created_at DESC LIMIT 20'
    ).bind(orderId).all<any>()

    return c.json({
      success: true,
      analysis: parsed,
      pipeline_log: pipelineLog.results || [],
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ============================================================
// POST /:orderId/sam3-annotate — Generate annotated SVG overlay
// Draws roof segments, edges, and measurements on satellite image
// ============================================================

sam3Routes.post('/:orderId/sam3-annotate', async (c) => {
  const isAdmin = await validateAdmin(c)
  const customerId = await validateCustomer(c)
  if (!isAdmin && !customerId) return c.json({ error: 'Authentication required' }, 401)

  const orderId = c.req.param('orderId')

  try {
    await ensureSAM3Tables(c.env.DB)

    // Get latest analysis
    const analysis = await c.env.DB.prepare(
      'SELECT * FROM sam3_analyses WHERE order_id = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(orderId).first<any>()

    if (!analysis) {
      return c.json({ error: 'Run SAM 3 analysis first' }, 404)
    }

    const segments: EnrichedRoofSegment[] = JSON.parse(analysis.enriched_segments || '[]')
    const edges: EnrichedEdge[] = JSON.parse(analysis.edges_detected || '[]')
    const summary = JSON.parse(analysis.summary || '{}')
    const w = analysis.image_width || 640
    const h = analysis.image_height || 640

    // ── Generate SVG annotation overlay ──
    const edgeColors: Record<string, string> = {
      ridge: '#DC2626',
      hip: '#EA580C',
      valley: '#2563EB',
      eave: '#16A34A',
      rake: '#7C3AED',
      step_flashing: '#F59E0B',
      transition: '#6B7280',
    }

    const facetColors = [
      'rgba(239,68,68,0.15)',   // red
      'rgba(59,130,246,0.15)',  // blue
      'rgba(16,185,129,0.15)', // green
      'rgba(168,85,247,0.15)', // purple
      'rgba(245,158,11,0.15)', // amber
      'rgba(236,72,153,0.15)', // pink
      'rgba(6,182,212,0.15)',  // cyan
      'rgba(132,204,22,0.15)', // lime
    ]

    let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n`
    svgContent += `  <defs>\n`
    svgContent += `    <style>\n`
    svgContent += `      .facet-label { font: bold 11px sans-serif; fill: white; text-shadow: 1px 1px 2px rgba(0,0,0,0.8); }\n`
    svgContent += `      .edge-label { font: 10px sans-serif; fill: white; text-shadow: 1px 1px 2px rgba(0,0,0,0.9); }\n`
    svgContent += `      .measurement { font: bold 9px monospace; fill: #FFD700; text-shadow: 1px 1px 2px rgba(0,0,0,0.9); }\n`
    svgContent += `      .title-text { font: bold 14px sans-serif; fill: white; }\n`
    svgContent += `    </style>\n`
    svgContent += `  </defs>\n`

    // Draw facet polygons
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      if (!seg.polygon_pixels || seg.polygon_pixels.length < 3) continue

      const color = facetColors[i % facetColors.length]
      const points = seg.polygon_pixels.map(p => `${p.x},${p.y}`).join(' ')
      const borderColor = color.replace('0.15', '0.6')

      svgContent += `  <!-- Facet ${seg.id}: ${seg.type} -->\n`
      svgContent += `  <polygon points="${points}" fill="${color}" stroke="${borderColor}" stroke-width="2" />\n`

      // Facet label
      if (seg.centroid) {
        const label = String.fromCharCode(65 + i)
        const area = seg.area_sqft ? `${Math.round(seg.area_sqft)} SF` : ''
        const pitch = seg.estimated_pitch_label || ''
        svgContent += `  <text x="${seg.centroid.x}" y="${seg.centroid.y - 8}" text-anchor="middle" class="facet-label">${label}</text>\n`
        if (area) svgContent += `  <text x="${seg.centroid.x}" y="${seg.centroid.y + 6}" text-anchor="middle" class="measurement">${area}</text>\n`
        if (pitch) svgContent += `  <text x="${seg.centroid.x}" y="${seg.centroid.y + 18}" text-anchor="middle" class="measurement">${pitch}</text>\n`
      }
    }

    // Draw edges
    for (const edge of edges) {
      const color = edgeColors[edge.type] || '#6B7280'
      const dashArray = ['valley', 'hip'].includes(edge.type) ? 'stroke-dasharray="6,3"' : ''
      const strokeWidth = edge.type === 'ridge' ? 3 : 2

      svgContent += `  <line x1="${edge.start.x}" y1="${edge.start.y}" x2="${edge.end.x}" y2="${edge.end.y}" stroke="${color}" stroke-width="${strokeWidth}" ${dashArray} stroke-linecap="round" />\n`

      // Edge measurement label
      if (edge.length_ft && edge.length_ft > 5) {
        const midX = (edge.start.x + edge.end.x) / 2
        const midY = (edge.start.y + edge.end.y) / 2
        svgContent += `  <text x="${midX}" y="${midY - 4}" text-anchor="middle" class="edge-label">${edge.length_ft.toFixed(1)} ft</text>\n`
      }
    }

    // Legend
    svgContent += `  <!-- Legend -->\n`
    svgContent += `  <rect x="10" y="${h - 110}" width="150" height="100" rx="6" fill="rgba(0,0,0,0.75)" />\n`
    let ly = h - 95
    for (const [type, color] of Object.entries(edgeColors)) {
      if (['transition'].includes(type)) continue
      svgContent += `  <line x1="20" y1="${ly}" x2="38" y2="${ly}" stroke="${color}" stroke-width="2" />\n`
      svgContent += `  <text x="44" y="${ly + 4}" fill="white" font-size="10">${type.replace('_', ' ')}</text>\n`
      ly += 14
    }

    // Summary box
    svgContent += `  <rect x="${w - 180}" y="10" width="170" height="70" rx="6" fill="rgba(0,0,0,0.75)" />\n`
    svgContent += `  <text x="${w - 170}" y="28" class="title-text">SAM 3 Analysis</text>\n`
    svgContent += `  <text x="${w - 170}" y="44" fill="#94A3B8" font-size="10">${segments.length} facets • ${edges.length} edges</text>\n`
    svgContent += `  <text x="${w - 170}" y="58" fill="#94A3B8" font-size="10">${summary.total_area_sqft ? Math.round(summary.total_area_sqft) + ' SF total' : ''}</text>\n`
    svgContent += `  <text x="${w - 170}" y="72" fill="#94A3B8" font-size="10">${summary.predominant_pitch_label || ''} pitch</text>\n`

    svgContent += `</svg>`

    // Store annotated SVG
    await c.env.DB.prepare(
      "UPDATE sam3_analyses SET annotated_svg = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(svgContent, analysis.id).run()

    return c.json({
      success: true,
      order_id: orderId,
      annotated_svg: svgContent,
      dimensions: { width: w, height: h },
      stats: {
        segments: segments.length,
        edges: edges.length,
        total_area_sqft: summary.total_area_sqft || 0,
        pitch: summary.predominant_pitch_label || 'N/A',
      },
    })
  } catch (err: any) {
    console.error(`[SAM3-Route] Annotate error for order ${orderId}:`, err.message)
    return c.json({ error: err.message }, 500)
  }
})

// ============================================================
// POST /:orderId/auto-pipeline — Full auto-fallback chain
// SAM 3 → Gemini → RANSAC with confidence tracking in D1
// ============================================================

sam3Routes.post('/:orderId/auto-pipeline', async (c) => {
  const isAdmin = await validateAdmin(c)
  const customerId = await validateCustomer(c)
  if (!isAdmin && !customerId) return c.json({ error: 'Authentication required' }, 401)

  const orderId = c.req.param('orderId')
  const startMs = Date.now()

  try {
    await ensureSAM3Tables(c.env.DB)

    const order = await c.env.DB.prepare(
      'SELECT id, property_address, latitude, longitude FROM orders WHERE id = ?'
    ).bind(orderId).first<any>()
    if (!order) return c.json({ error: 'Order not found' }, 404)

    const report = await c.env.DB.prepare(
      'SELECT satellite_image_url, api_response_raw FROM roof_reports WHERE order_id = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(orderId).first<any>()

    let imageUrl = report?.satellite_image_url || ''
    if (!imageUrl && report?.api_response_raw) {
      try {
        const raw = JSON.parse(report.api_response_raw)
        imageUrl = raw?.imagery?.satellite_overhead_url || raw?.imagery?.satellite_url || ''
      } catch {}
    }

    if (!imageUrl) {
      const mapsKey = (c.env as any).GOOGLE_MAPS_API_KEY
      if (mapsKey && order.latitude && order.longitude) {
        imageUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${order.latitude},${order.longitude}&zoom=20&size=640x640&scale=2&maptype=satellite&key=${mapsKey}`
      }
    }

    if (!imageUrl) {
      return c.json({ error: 'No satellite image available' }, 400)
    }

    const env = c.env as any
    const lat = parseFloat(order.latitude) || 53.5
    const lng = parseFloat(order.longitude) || -113.5
    const zoom = 20
    const imgW = 640, imgH = 640

    // ── Pipeline: Try each tier, log results, use best ──
    const pipelineResults: any[] = []
    let bestResult: UnifiedSegmentationResult | null = null

    // --- Tier 1: SAM 3 ---
    const t1Start = Date.now()
    let sam3Success = false
    try {
      if (env.HF_API_TOKEN) {
        const sam3 = await segmentWithSAM3(env, imageUrl, [
          'roof segment', 'roof facet', 'ridge line', 'hip line', 'valley', 'dormer', 'chimney', 'skylight'
        ], { threshold: 0.4 })
        
        if (sam3 && sam3.masks.length > 0) {
          sam3Success = true
          pipelineResults.push({
            tier: 1, name: 'SAM 3', status: 'success',
            segments: sam3.masks.length, time_ms: Date.now() - t1Start,
            confidence: sam3.masks.reduce((max, m) => Math.max(max, m.score), 0),
          })
        } else {
          pipelineResults.push({
            tier: 1, name: 'SAM 3', status: 'no_results',
            segments: 0, time_ms: Date.now() - t1Start,
          })
        }
      } else {
        pipelineResults.push({ tier: 1, name: 'SAM 3', status: 'not_configured' })
      }
    } catch (err: any) {
      pipelineResults.push({
        tier: 1, name: 'SAM 3', status: 'error',
        error: err.message, time_ms: Date.now() - t1Start,
      })
    }

    // --- Tier 2: Gemini ---
    const t2Start = Date.now()
    let geminiSuccess = false
    try {
      const geminiKey = env.GEMINI_API_KEY || env.GEMINI_ENHANCE_API_KEY
      if (geminiKey) {
        const gemini = await segmentWithGemini(
          { GEMINI_API_KEY: geminiKey },
          imageUrl, imgW, imgH
        )
        
        if (gemini && gemini.segments.length > 0) {
          geminiSuccess = true
          pipelineResults.push({
            tier: 2, name: 'Gemini', status: 'success',
            segments: gemini.segments.length,
            edges: gemini.edges.length,
            time_ms: Date.now() - t2Start,
            confidence: gemini.segments.reduce((max, s) => Math.max(max, s.confidence), 0),
          })
        } else {
          pipelineResults.push({
            tier: 2, name: 'Gemini', status: 'no_results',
            segments: 0, time_ms: Date.now() - t2Start,
          })
        }
      } else {
        pipelineResults.push({ tier: 2, name: 'Gemini', status: 'not_configured' })
      }
    } catch (err: any) {
      pipelineResults.push({
        tier: 2, name: 'Gemini', status: 'error',
        error: err.message, time_ms: Date.now() - t2Start,
      })
    }

    // --- Tier 3: RANSAC (always available) ---
    pipelineResults.push({
      tier: 3, name: 'RANSAC', status: 'available',
      note: 'DSM-based fallback (used when SAM 3 + Gemini both fail)',
    })

    // ── Run unified pipeline for best merged result ──
    bestResult = await runUnifiedSegmentation(env, imageUrl, lat, lng, zoom, imgW, imgH)

    // ── Log all tier results to D1 ──
    for (const pr of pipelineResults) {
      if (pr.status !== 'available') {
        await c.env.DB.prepare(`
          INSERT INTO sam3_pipeline_log (order_id, tier, tier_name, status, confidence, segments_found, edges_found, processing_time_ms, error_message, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(
          parseInt(orderId),
          pr.tier,
          pr.name,
          pr.status,
          pr.confidence || null,
          pr.segments || 0,
          pr.edges || 0,
          pr.time_ms || 0,
          pr.error || null,
        ).run()
      }
    }

    // ── Convert to AIMeasurementAnalysis for report engine ──
    let aiMeasurement = null
    if (bestResult && bestResult.segments.length > 0) {
      aiMeasurement = convertToAIMeasurement(bestResult, lat, lng)
    }

    // ── Store analysis ──
    if (bestResult) {
      await c.env.DB.prepare(`
        INSERT INTO sam3_analyses (
          order_id, status, tier_used, tiers_attempted,
          enriched_segments, edges_detected, obstructions_detected, summary,
          confidence_scores, gsd_meters, image_url, image_width, image_height,
          latitude, longitude, zoom_level, processing_time_ms, created_at, updated_at
        ) VALUES (?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).bind(
        parseInt(orderId),
        bestResult.processing_tiers_used[0] || 3,
        JSON.stringify(bestResult.processing_tiers_used),
        JSON.stringify(bestResult.segments),
        JSON.stringify(bestResult.edges),
        JSON.stringify(bestResult.obstructions),
        JSON.stringify(bestResult.summary),
        JSON.stringify(bestResult.segments.map(s => ({ id: s.id, source: s.source, confidence: s.confidence }))),
        bestResult.gsd_meters,
        imageUrl.length > 500 ? '[satellite]' : imageUrl,
        imgW, imgH,
        lat, lng, zoom,
        Date.now() - startMs,
      ).run()
    }

    return c.json({
      success: true,
      order_id: orderId,
      pipeline_results: pipelineResults,
      best_result: bestResult ? {
        tiers_used: bestResult.processing_tiers_used,
        segments: bestResult.segments.length,
        edges: bestResult.edges.length,
        obstructions: bestResult.obstructions.length,
        summary: bestResult.summary,
        total_inference_ms: bestResult.total_inference_ms,
      } : null,
      ai_measurement: aiMeasurement,
      processing_time_ms: Date.now() - startMs,
      message: bestResult
        ? `Pipeline complete: ${bestResult.processing_tiers_used.map(t => t === 1 ? 'SAM 3' : t === 2 ? 'Gemini' : 'RANSAC').join(' + ')} — ${bestResult.segments.length} segments, ${bestResult.edges.length} edges detected`
        : 'Pipeline ran but no segments detected. RANSAC fallback available with DSM data.',
    })
  } catch (err: any) {
    console.error(`[SAM3-Pipeline] Error for order ${orderId}:`, err.message)
    return c.json({ error: err.message }, 500)
  }
})

export { sam3Routes }

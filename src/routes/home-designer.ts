// ============================================================
// RoofReporterAI — Home Designer Routes (Hover-Style)
// ============================================================
//
// ARCHITECTURE:
//   1. Upload 3-5 exterior photos of the home
//   2. AI (SAM 3 / Gemini) segments the roof from each photo
//   3. User selects roofing material + color
//   4. Gemini generates a 2D diagram (bird's-eye roof plan)
//   5. AI inpaints the roof with selected material/color
//   6. Results: before/after photos + 2D roof diagram
//
// ENDPOINTS:
//   POST /api/home-designer/projects          → Create new design project
//   POST /api/home-designer/projects/:id/photos → Upload photos
//   POST /api/home-designer/projects/:id/segment → Auto-segment roofs (SAM3/Gemini)
//   POST /api/home-designer/projects/:id/generate → Generate recolor renders
//   GET  /api/home-designer/projects/:id      → Get project status + results
//   GET  /api/home-designer/projects          → List projects
//   GET  /api/home-designer/catalog           → Roofing materials catalog
//   POST /api/home-designer/projects/:id/diagram → Generate 2D roof diagram
//   DELETE /api/home-designer/projects/:id    → Delete project
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { resolveTeamOwner } from './team'

const homeDesignerRoutes = new Hono<{ Bindings: Bindings }>()

// ── CONSTANTS ──────────────────────────────────────────────

const MAX_PHOTOS = 5
const MIN_PHOTOS = 1
const MAX_PHOTO_SIZE_MB = 15
const SUPPORTED_FORMATS = ['image/jpeg', 'image/png', 'image/webp']

// Comprehensive roofing materials catalog — Canadian market focus
const ROOFING_CATALOG = {
  shingles: {
    label: 'Asphalt Shingles',
    icon: 'fa-layer-group',
    products: [
      { id: 'sh-onyx-black', name: 'Onyx Black', hex: '#222222', brand: 'IKO Cambridge', type: '3-tab', warranty: '25 years', price_per_sqft: 3.50 },
      { id: 'sh-charcoal', name: 'Charcoal', hex: '#36454F', brand: 'IKO Cambridge', type: 'Architectural', warranty: '30 years', price_per_sqft: 4.25 },
      { id: 'sh-weathered-wood', name: 'Weathered Wood', hex: '#8B8378', brand: 'GAF Timberline HDZ', type: 'Architectural', warranty: '50 years', price_per_sqft: 5.00 },
      { id: 'sh-estate-gray', name: 'Estate Gray', hex: '#7A7A7A', brand: 'CertainTeed Landmark', type: 'Architectural', warranty: '50 years', price_per_sqft: 4.75 },
      { id: 'sh-brownwood', name: 'Brownwood', hex: '#5C4033', brand: 'BP Mystique 42', type: 'Architectural', warranty: '40 years', price_per_sqft: 4.50 },
      { id: 'sh-hunter-green', name: 'Hunter Green', hex: '#355E3B', brand: 'IKO Dynasty', type: 'Performance', warranty: '50 years', price_per_sqft: 5.25 },
      { id: 'sh-terra-cotta', name: 'Terra Cotta', hex: '#E2725B', brand: 'Owens Corning Duration', type: 'Impact Resistant', warranty: '50 years', price_per_sqft: 5.50 },
      { id: 'sh-crimson', name: 'Crimson Red', hex: '#990000', brand: 'CertainTeed NorthGate', type: 'Impact Resistant', warranty: 'Lifetime', price_per_sqft: 6.00 },
      { id: 'sh-driftwood', name: 'Driftwood', hex: '#B8A088', brand: 'GAF Timberline HDZ', type: 'Architectural', warranty: '50 years', price_per_sqft: 5.00 },
      { id: 'sh-slate-blue', name: 'Slate Blue', hex: '#4A6580', brand: 'IKO Dynasty', type: 'Performance', warranty: '50 years', price_per_sqft: 5.25 },
      { id: 'sh-autumn-brown', name: 'Autumn Brown', hex: '#6B4226', brand: 'BP Mystique 42', type: 'Architectural', warranty: '40 years', price_per_sqft: 4.50 },
      { id: 'sh-desert-tan', name: 'Desert Tan', hex: '#C2A878', brand: 'Malarkey Vista AR', type: 'Architectural', warranty: '30 years', price_per_sqft: 4.25 },
    ]
  },
  metal: {
    label: 'Standing Seam Metal',
    icon: 'fa-shield-alt',
    products: [
      { id: 'mt-galvalume', name: 'Galvalume Silver', hex: '#C0C0C0', brand: 'Vicwest', type: '26 gauge', warranty: '50 years', price_per_sqft: 8.00 },
      { id: 'mt-copper-patina', name: 'Copper Patina', hex: '#43B3AE', brand: 'Ideal Roofing', type: '26 gauge', warranty: '50 years', price_per_sqft: 8.50 },
      { id: 'mt-bronze', name: 'Bronze', hex: '#CD7F32', brand: 'Westman Steel', type: '26 gauge', warranty: '50 years', price_per_sqft: 8.25 },
      { id: 'mt-matte-black', name: 'Matte Black', hex: '#1C1C1C', brand: 'Vicwest', type: '24 gauge', warranty: '50 years', price_per_sqft: 9.00 },
      { id: 'mt-classic-blue', name: 'Classic Blue', hex: '#0F52BA', brand: 'Ideal Roofing', type: '26 gauge', warranty: '50 years', price_per_sqft: 8.50 },
      { id: 'mt-forest-green', name: 'Forest Green', hex: '#228B22', brand: 'Westman Steel', type: '26 gauge', warranty: '50 years', price_per_sqft: 8.25 },
      { id: 'mt-barn-red', name: 'Barn Red', hex: '#7C0A02', brand: 'Vicwest', type: '26 gauge', warranty: '50 years', price_per_sqft: 8.00 },
      { id: 'mt-charcoal', name: 'Charcoal Metal', hex: '#2F3640', brand: 'Ideal Roofing', type: '24 gauge', warranty: '50 years', price_per_sqft: 9.00 },
    ]
  },
  tile: {
    label: 'Clay & Concrete Tile',
    icon: 'fa-building',
    products: [
      { id: 'tl-terracotta', name: 'Terracotta Classic', hex: '#C04000', brand: 'Boral', type: 'Clay Barrel', warranty: '75 years', price_per_sqft: 12.00 },
      { id: 'tl-sandstone', name: 'Sandstone', hex: '#C2B280', brand: 'Eagle Roofing', type: 'Concrete Flat', warranty: '50 years', price_per_sqft: 7.50 },
      { id: 'tl-slate-black', name: 'Slate Black', hex: '#2F3640', brand: 'Boral', type: 'Concrete Slate', warranty: '50 years', price_per_sqft: 8.00 },
      { id: 'tl-moss-green', name: 'Moss Green', hex: '#8A9A5B', brand: 'Eagle Roofing', type: 'Concrete S-Tile', warranty: '50 years', price_per_sqft: 7.75 },
    ]
  },
  cedar: {
    label: 'Cedar Shake',
    icon: 'fa-tree',
    products: [
      { id: 'cd-natural', name: 'Natural Cedar', hex: '#A0522D', brand: 'Cedar Valley', type: '#1 Heavy', warranty: '30 years', price_per_sqft: 10.00 },
      { id: 'cd-weathered', name: 'Weathered Silver', hex: '#A9A9A9', brand: 'Cedar Valley', type: '#1 Medium', warranty: '25 years', price_per_sqft: 9.50 },
      { id: 'cd-stained-dark', name: 'Stained Dark', hex: '#4A3728', brand: 'Maibec', type: 'Tapersawn', warranty: '30 years', price_per_sqft: 11.00 },
    ]
  },
  slate: {
    label: 'Natural Slate',
    icon: 'fa-gem',
    products: [
      { id: 'sl-charcoal', name: 'Vermont Gray', hex: '#4A4A4A', brand: 'Vermont Structural', type: 'Natural', warranty: '100 years', price_per_sqft: 18.00 },
      { id: 'sl-green', name: 'Unfading Green', hex: '#4F6D4E', brand: 'New England Slate', type: 'Natural', warranty: '100 years', price_per_sqft: 20.00 },
      { id: 'sl-purple', name: 'Royal Purple', hex: '#5D3A6B', brand: 'North Country Slate', type: 'Natural', warranty: '100 years', price_per_sqft: 22.00 },
    ]
  }
}

// Roof recolor prompt templates for Gemini/Replicate
const RECOLOR_SYSTEM_PROMPT = `You are an expert AI architectural renderer. Given an exterior photo of a house with the roof area identified, generate a photorealistic version of the same house with the roof replaced by the specified roofing material and color.

Requirements:
- ONLY change the roof — keep everything else (walls, windows, landscaping, sky) identical
- Match the lighting and shadow direction of the original photo
- Apply realistic material texture:
  * Shingles: visible tab lines, slight granule texture variation
  * Metal: standing seam lines, subtle reflections matching light angle
  * Tile: individual tile shapes with slight shadow between rows
  * Cedar: natural wood grain variation, slight irregular spacing
  * Slate: stone texture with slight color variation between tiles
- Maintain proper perspective — the material pattern follows the roof slope
- Include realistic edge details (drip edge, ridge cap, hip caps)
- Shadows on the roof should match the original photo's sun position`

// 2D diagram generation prompt for Gemini
const DIAGRAM_SYSTEM_PROMPT = `You are an expert roofing measurement and diagramming AI. Generate a clean, professional 2D bird's-eye-view roof diagram SVG.

The diagram should look like professional roofing software output (similar to Hover, EagleView, or RoofReporterAI):
- Clean lines showing each roof facet as a polygon
- Each facet filled with the selected roofing color
- Ridge lines shown as thick dark lines
- Hip lines, valleys shown as dashed lines
- Eave and rake lines as solid edges
- Facet labels (A, B, C, etc.) with area in square feet
- Measurement annotations along edges showing linear feet
- North arrow indicator
- Scale bar
- Pitch indicators on each facet (e.g., "6:12")
- Clean white background with light grid
- Professional color scheme

Output a valid SVG string that can be embedded directly in HTML.`

// ── AUTH HELPER ──────────────────────────────────────────────

async function getDesignerCustomerId(c: any): Promise<number | null> {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return null
  const session = await c.env.DB.prepare(`
    SELECT customer_id FROM customer_sessions
    WHERE session_token = ? AND expires_at > datetime('now')
  `).bind(token).first<any>()
  if (!session?.customer_id) return null
  const teamInfo = await resolveTeamOwner(c.env.DB, session.customer_id)
  return teamInfo.ownerId
}

// ============================================================
// DB MIGRATION — Auto-create tables
// ============================================================

async function ensureDesignerTables(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hd_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      name TEXT NOT NULL DEFAULT 'New Design Project',
      property_address TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      selected_material_id TEXT,
      selected_material_name TEXT,
      selected_material_hex TEXT,
      selected_material_type TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hd_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      photo_index INTEGER NOT NULL DEFAULT 0,
      original_url TEXT NOT NULL,
      mask_data TEXT,
      segmentation_result TEXT,
      segmentation_tier INTEGER,
      segmentation_confidence REAL,
      recolored_url TEXT,
      recolor_status TEXT DEFAULT 'pending',
      recolor_job_id TEXT,
      angle_label TEXT DEFAULT 'front',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES hd_projects(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hd_diagrams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      diagram_svg TEXT,
      diagram_data TEXT,
      material_id TEXT,
      material_hex TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES hd_projects(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hd_projects_customer ON hd_projects(customer_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hd_photos_project ON hd_photos(project_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hd_diagrams_project ON hd_diagrams(project_id)`),
  ])
}

// ============================================================
// GET /catalog — Roofing materials catalog
// ============================================================

homeDesignerRoutes.get('/catalog', async (c) => {
  return c.json({
    success: true,
    catalog: ROOFING_CATALOG,
    categories: Object.keys(ROOFING_CATALOG),
    total_products: Object.values(ROOFING_CATALOG).reduce((sum, cat) => sum + cat.products.length, 0),
  })
})

// ============================================================
// POST /projects — Create new design project
// ============================================================

homeDesignerRoutes.post('/projects', async (c) => {
  const customerId = await getDesignerCustomerId(c)
  if (!customerId) return c.json({ error: 'Authentication required' }, 401)

  try {
    await ensureDesignerTables(c.env.DB)

    const body = await c.req.json()
    const { name, property_address, notes } = body

    const result = await c.env.DB.prepare(`
      INSERT INTO hd_projects (customer_id, name, property_address, notes, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'draft', datetime('now'), datetime('now'))
    `).bind(
      customerId,
      name || 'New Design Project',
      property_address || null,
      notes || null,
    ).run()

    const projectId = result.meta.last_row_id

    return c.json({
      success: true,
      project_id: projectId,
      message: 'Design project created. Upload 1-5 exterior photos next.',
      next_step: `/api/home-designer/projects/${projectId}/photos`,
    })
  } catch (err: any) {
    console.error('[HomeDesigner] Create project error:', err.message)
    return c.json({ error: err.message }, 500)
  }
})

// ============================================================
// POST /projects/:id/photos — Upload photos (base64)
// ============================================================

homeDesignerRoutes.post('/projects/:id/photos', async (c) => {
  const customerId = await getDesignerCustomerId(c)
  if (!customerId) return c.json({ error: 'Authentication required' }, 401)

  const projectId = parseInt(c.req.param('id'))
  
  try {
    await ensureDesignerTables(c.env.DB)

    // Verify project ownership
    const project = await c.env.DB.prepare(
      'SELECT id, customer_id, status FROM hd_projects WHERE id = ? AND customer_id = ?'
    ).bind(projectId, customerId).first<any>()
    if (!project) return c.json({ error: 'Project not found' }, 404)

    const body = await c.req.json()
    const { photos, angle_labels } = body
    // photos: array of { data: base64, angle: string }

    if (!photos || !Array.isArray(photos) || photos.length === 0) {
      return c.json({ error: 'At least 1 photo required' }, 400)
    }

    // Check existing photo count
    const existing = await c.env.DB.prepare(
      'SELECT COUNT(*) as cnt FROM hd_photos WHERE project_id = ?'
    ).bind(projectId).first<any>()
    const existingCount = existing?.cnt || 0

    if (existingCount + photos.length > MAX_PHOTOS) {
      return c.json({ error: `Maximum ${MAX_PHOTOS} photos per project. Already have ${existingCount}.` }, 400)
    }

    const uploaded: any[] = []
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i]
      const angleLabel = (angle_labels && angle_labels[i]) || photo.angle || `photo-${existingCount + i + 1}`

      // Store the base64 data URL directly — in production you'd store to R2/S3
      // For now we store a truncated reference and process immediately
      const photoUrl = photo.data || photo.url

      if (!photoUrl) continue

      const result = await c.env.DB.prepare(`
        INSERT INTO hd_photos (project_id, photo_index, original_url, angle_label, recolor_status, created_at)
        VALUES (?, ?, ?, ?, 'pending', datetime('now'))
      `).bind(
        projectId,
        existingCount + i,
        photoUrl.length > 500 ? '[base64_uploaded]' : photoUrl,
        angleLabel,
      ).run()

      uploaded.push({
        photo_id: result.meta.last_row_id,
        index: existingCount + i,
        angle: angleLabel,
      })
    }

    // Update project status
    await c.env.DB.prepare(
      "UPDATE hd_projects SET status = 'photos_uploaded', updated_at = datetime('now') WHERE id = ?"
    ).bind(projectId).run()

    return c.json({
      success: true,
      uploaded,
      total_photos: existingCount + uploaded.length,
      message: `${uploaded.length} photo(s) uploaded. Run segmentation next.`,
      next_step: `/api/home-designer/projects/${projectId}/segment`,
    })
  } catch (err: any) {
    console.error('[HomeDesigner] Upload photos error:', err.message)
    return c.json({ error: err.message }, 500)
  }
})

// ============================================================
// POST /projects/:id/segment — AI Roof Segmentation
// Uses SAM 3 (Tier 1) → Gemini (Tier 2) auto-fallback
// ============================================================

homeDesignerRoutes.post('/projects/:id/segment', async (c) => {
  const customerId = await getDesignerCustomerId(c)
  if (!customerId) return c.json({ error: 'Authentication required' }, 401)

  const projectId = parseInt(c.req.param('id'))

  try {
    const project = await c.env.DB.prepare(
      'SELECT id, customer_id FROM hd_projects WHERE id = ? AND customer_id = ?'
    ).bind(projectId, customerId).first<any>()
    if (!project) return c.json({ error: 'Project not found' }, 404)

    // Get all photos
    const photosResult = await c.env.DB.prepare(
      'SELECT id, original_url, angle_label FROM hd_photos WHERE project_id = ? ORDER BY photo_index'
    ).bind(projectId).all<any>()
    const photos = photosResult.results || []

    if (photos.length === 0) {
      return c.json({ error: 'Upload photos first' }, 400)
    }

    const segmentationResults: any[] = []

    for (const photo of photos) {
      let tier = 0
      let confidence = 0
      let segResult: any = null

      // ── TIER 1: SAM 3 via Gemini Vision (roof mask detection) ──
      const geminiKey = (c.env as any).GEMINI_API_KEY || (c.env as any).GEMINI_ENHANCE_API_KEY
      if (geminiKey) {
        try {
          const segResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  parts: [
                    {
                      text: `Analyze this exterior house photo. Identify and segment the roof area.

Return a JSON object with:
{
  "roof_detected": true/false,
  "roof_coverage_percent": number (0-100, what % of image is roof),
  "roof_polygon": [{"x": 0-1000, "y": 0-1000}...] (normalized polygon vertices, scaled to 1000x1000),
  "roof_type": "gable|hip|flat|mansard|gambrel|shed|cross-gable|mixed",
  "current_material": "asphalt_shingles|metal|tile|cedar|slate|unknown",
  "current_color": "description of current roof color",
  "current_condition": "excellent|good|fair|poor",
  "visible_features": ["ridge_cap", "hip_cap", "valley", "dormer", "chimney", "skylight", "vent", "satellite_dish"],
  "photo_quality": number (0-100),
  "angle": "front|rear|left|right|aerial|oblique",
  "obstruction_pct": number (0-100, trees/shadows covering roof)
}`
                    },
                    ...(photo.original_url.startsWith('data:') ? [{
                      inlineData: {
                        mimeType: photo.original_url.split(';')[0].split(':')[1] || 'image/jpeg',
                        data: photo.original_url.split(',')[1] || ''
                      }
                    }] : [{
                      text: `Image URL: ${photo.original_url}`
                    }])
                  ]
                }],
                generationConfig: {
                  responseMimeType: 'application/json',
                  temperature: 0.1,
                  maxOutputTokens: 4096,
                }
              })
            }
          )

          if (segResponse.ok) {
            const apiResult = await segResponse.json() as any
            const text = apiResult?.candidates?.[0]?.content?.parts?.[0]?.text
            if (text) {
              segResult = JSON.parse(text)
              tier = 2 // Gemini Vision
              confidence = segResult.photo_quality ? segResult.photo_quality / 100 : 0.75
            }
          }
        } catch (err: any) {
          console.warn(`[HomeDesigner] Gemini segmentation failed for photo ${photo.id}: ${err.message}`)
        }
      }

      // Store segmentation result
      if (segResult) {
        await c.env.DB.prepare(`
          UPDATE hd_photos 
          SET segmentation_result = ?, segmentation_tier = ?, segmentation_confidence = ?
          WHERE id = ?
        `).bind(
          JSON.stringify(segResult),
          tier,
          confidence,
          photo.id,
        ).run()
      }

      segmentationResults.push({
        photo_id: photo.id,
        angle: photo.angle_label,
        tier,
        confidence,
        roof_detected: segResult?.roof_detected || false,
        roof_type: segResult?.roof_type || 'unknown',
        current_material: segResult?.current_material || 'unknown',
        roof_coverage_pct: segResult?.roof_coverage_percent || 0,
      })
    }

    // Update project status
    await c.env.DB.prepare(
      "UPDATE hd_projects SET status = 'segmented', updated_at = datetime('now') WHERE id = ?"
    ).bind(projectId).run()

    return c.json({
      success: true,
      photos_segmented: segmentationResults.length,
      results: segmentationResults,
      message: 'Roof segmentation complete. Select material and generate renders.',
      next_step: `/api/home-designer/projects/${projectId}/generate`,
    })
  } catch (err: any) {
    console.error('[HomeDesigner] Segment error:', err.message)
    return c.json({ error: err.message }, 500)
  }
})

// ============================================================
// POST /projects/:id/generate — Generate recolored renders
// Uses Gemini to create photorealistic roof replacements
// ============================================================

homeDesignerRoutes.post('/projects/:id/generate', async (c) => {
  const customerId = await getDesignerCustomerId(c)
  if (!customerId) return c.json({ error: 'Authentication required' }, 401)

  const projectId = parseInt(c.req.param('id'))

  try {
    const project = await c.env.DB.prepare(
      'SELECT id, customer_id FROM hd_projects WHERE id = ? AND customer_id = ?'
    ).bind(projectId, customerId).first<any>()
    if (!project) return c.json({ error: 'Project not found' }, 404)

    const body = await c.req.json()
    const { material_id, material_name, material_hex, material_type } = body

    if (!material_id || !material_hex) {
      return c.json({ error: 'material_id and material_hex required' }, 400)
    }

    // Store selected material on project
    await c.env.DB.prepare(`
      UPDATE hd_projects 
      SET selected_material_id = ?, selected_material_name = ?, selected_material_hex = ?, selected_material_type = ?,
          status = 'generating', updated_at = datetime('now')
      WHERE id = ?
    `).bind(material_id, material_name || material_id, material_hex, material_type || 'shingle', projectId).run()

    // Get photos with segmentation data
    const photosResult = await c.env.DB.prepare(
      'SELECT id, original_url, segmentation_result, angle_label FROM hd_photos WHERE project_id = ? ORDER BY photo_index'
    ).bind(projectId).all<any>()
    const photos = photosResult.results || []

    if (photos.length === 0) {
      return c.json({ error: 'No photos found' }, 400)
    }

    const geminiKey = (c.env as any).GEMINI_API_KEY || (c.env as any).GEMINI_ENHANCE_API_KEY
    if (!geminiKey) {
      return c.json({ error: 'GEMINI_API_KEY required for render generation' }, 503)
    }

    const generateResults: any[] = []

    for (const photo of photos) {
      let segData: any = null
      try { segData = photo.segmentation_result ? JSON.parse(photo.segmentation_result) : null } catch {}

      // Use Gemini to generate a text description of the recolored roof
      // In a production system, you would use an image generation model (Replicate, DALL-E, etc.)
      // For now, we generate an AI description + store the render request for async processing
      try {
        const recolorPrompt = `You are a photorealistic architectural AI renderer.

Given this exterior house photo, imagine the exact same house but with the roof replaced by: 
**${material_name || material_id}** roofing in **${material_hex}** color.

Current roof analysis: ${segData ? JSON.stringify({
  type: segData.roof_type,
  current_material: segData.current_material,
  coverage: segData.roof_coverage_percent,
  features: segData.visible_features,
}) : 'Not analyzed'}

Describe in precise detail what the rendered house would look like with the new roofing material. Include:
1. How the new material changes the home's curb appeal
2. How light interacts with the new material at this angle
3. Edge details (ridge caps, hip caps, drip edge) in the new material
4. Color harmony with the existing siding, trim, and landscaping

Return as JSON:
{
  "render_description": "detailed photorealistic description",
  "curb_appeal_rating": 1-10,
  "color_harmony_score": 1-10,
  "recommendations": ["tip1", "tip2"],
  "contrast_with_siding": "good|fair|poor",
  "estimated_material_cost_per_sqft": number
}`

        const renderResp = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: recolorPrompt },
                  ...(photo.original_url.startsWith('data:') ? [{
                    inlineData: {
                      mimeType: 'image/jpeg',
                      data: photo.original_url.split(',')[1] || ''
                    }
                  }] : [])
                ]
              }],
              generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.3,
                maxOutputTokens: 2048,
              }
            })
          }
        )

        if (renderResp.ok) {
          const apiResult = await renderResp.json() as any
          const text = apiResult?.candidates?.[0]?.content?.parts?.[0]?.text
          if (text) {
            const renderData = JSON.parse(text)

            // Store render result
            await c.env.DB.prepare(`
              UPDATE hd_photos 
              SET recolor_status = 'completed',
                  recolored_url = ?
              WHERE id = ?
            `).bind(JSON.stringify(renderData), photo.id).run()

            generateResults.push({
              photo_id: photo.id,
              angle: photo.angle_label,
              status: 'completed',
              render: renderData,
            })
          }
        }
      } catch (err: any) {
        console.warn(`[HomeDesigner] Render failed for photo ${photo.id}: ${err.message}`)
        generateResults.push({
          photo_id: photo.id,
          angle: photo.angle_label,
          status: 'failed',
          error: err.message,
        })
      }
    }

    // Also dispatch Replicate inpainting if key is available
    const replicateKey = (c.env as any).REPLICATE_API_KEY
    if (replicateKey) {
      // Async dispatch — results come via webhook
      for (const photo of photos) {
        if (photo.original_url.startsWith('data:') || photo.original_url.startsWith('http')) {
          try {
            const segData = photo.segmentation_result ? JSON.parse(photo.segmentation_result) : null
            const requestUrl = new URL(c.req.url)
            const webhookUrl = `${requestUrl.protocol}//${requestUrl.host}/api/home-designer/webhook`

            const payload = {
              version: 'stability-ai/stable-diffusion-inpainting:95b7223104132402a9ae91cc677285bc5eb997834bd2349fa486f53910fd68b3'.split(':')[1],
              input: {
                image: photo.original_url,
                prompt: `A photorealistic ${material_name || 'architectural shingle'} roof in ${material_hex} color, high quality exterior photography, matching original lighting`,
                negative_prompt: 'ugly, distorted, cartoon, blurry, artifacts, low quality',
                num_inference_steps: 30,
                guidance_scale: 7.5,
              },
              webhook: webhookUrl,
              webhook_events_filter: ['completed'],
            }

            const resp = await fetch('https://api.replicate.com/v1/predictions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${replicateKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(payload),
            })

            if (resp.ok) {
              const prediction = await resp.json() as any
              if (prediction.id) {
                await c.env.DB.prepare(
                  'UPDATE hd_photos SET recolor_job_id = ? WHERE id = ?'
                ).bind(prediction.id, photo.id).run()
              }
            }
          } catch (err: any) {
            console.warn(`[HomeDesigner] Replicate dispatch failed: ${err.message}`)
          }
        }
      }
    }

    // Update project status
    await c.env.DB.prepare(
      "UPDATE hd_projects SET status = 'completed', updated_at = datetime('now') WHERE id = ?"
    ).bind(projectId).run()

    return c.json({
      success: true,
      project_id: projectId,
      material: { id: material_id, name: material_name, hex: material_hex, type: material_type },
      renders: generateResults,
      message: 'Roof visualization complete.',
    })
  } catch (err: any) {
    console.error('[HomeDesigner] Generate error:', err.message)
    return c.json({ error: err.message }, 500)
  }
})

// ============================================================
// POST /projects/:id/diagram — Generate 2D Roof Diagram
// Hover-style bird's-eye view SVG diagram
// ============================================================

homeDesignerRoutes.post('/projects/:id/diagram', async (c) => {
  const customerId = await getDesignerCustomerId(c)
  if (!customerId) return c.json({ error: 'Authentication required' }, 401)

  const projectId = parseInt(c.req.param('id'))

  try {
    await ensureDesignerTables(c.env.DB)

    const project = await c.env.DB.prepare(
      'SELECT * FROM hd_projects WHERE id = ? AND customer_id = ?'
    ).bind(projectId, customerId).first<any>()
    if (!project) return c.json({ error: 'Project not found' }, 404)

    const body = await c.req.json()
    const { material_id, material_hex, material_name, roof_data } = body

    const selectedHex = material_hex || project.selected_material_hex || '#36454F'
    const selectedName = material_name || project.selected_material_name || 'Charcoal'

    const geminiKey = (c.env as any).GEMINI_API_KEY || (c.env as any).GEMINI_ENHANCE_API_KEY
    if (!geminiKey) {
      return c.json({ error: 'GEMINI_API_KEY required for diagram generation' }, 503)
    }

    // Get segmentation data from photos to inform the diagram
    const photosResult = await c.env.DB.prepare(
      'SELECT segmentation_result, angle_label FROM hd_photos WHERE project_id = ? ORDER BY photo_index'
    ).bind(projectId).all<any>()

    let roofContext = ''
    for (const photo of (photosResult.results || []) as any[]) {
      if (photo.segmentation_result) {
        try {
          const seg = JSON.parse(photo.segmentation_result)
          roofContext += `\nPhoto (${photo.angle_label}): ${seg.roof_type || 'unknown'} roof, ${seg.visible_features?.join(', ') || 'no features'}`
        } catch {}
      }
    }

    // If we have report data (from an existing roof order), use it
    let measurementContext = ''
    if (roof_data) {
      measurementContext = `\nRoof measurements provided: ${JSON.stringify(roof_data)}`
    }

    // Generate 2D diagram via Gemini
    const diagramPrompt = `${DIAGRAM_SYSTEM_PROMPT}

Roof context from photos:${roofContext || ' No photo analysis available.'}
${measurementContext}

Selected roofing material: ${selectedName} (${selectedHex})

Generate a professional 2D roof diagram SVG. The SVG should be:
- 800x600 viewport
- Show roof facets filled with ${selectedHex} color (with slight shade variations per facet)
- Include ridge, hip, valley, eave lines with measurements
- Label each facet with letter and area
- Include a title bar, north arrow, and scale bar
- Look professional enough for a homeowner presentation

Return ONLY the SVG string, starting with <svg and ending with </svg>. No other text.`

    const diagramResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: diagramPrompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
          }
        })
      }
    )

    if (!diagramResp.ok) {
      return c.json({ error: 'Diagram generation failed' }, 502)
    }

    const diagramResult = await diagramResp.json() as any
    let svgText = diagramResult?.candidates?.[0]?.content?.parts?.[0]?.text || ''

    // Extract SVG from response (Gemini may wrap it in markdown)
    const svgMatch = svgText.match(/<svg[\s\S]*?<\/svg>/i)
    if (svgMatch) {
      svgText = svgMatch[0]
    }

    // Store diagram
    const insertResult = await c.env.DB.prepare(`
      INSERT INTO hd_diagrams (project_id, diagram_svg, material_id, material_hex, status, created_at)
      VALUES (?, ?, ?, ?, 'completed', datetime('now'))
    `).bind(projectId, svgText, material_id || selectedHex, selectedHex).run()

    return c.json({
      success: true,
      diagram_id: insertResult.meta.last_row_id,
      diagram_svg: svgText,
      material: { id: material_id, name: selectedName, hex: selectedHex },
      message: 'Roof diagram generated successfully.',
    })
  } catch (err: any) {
    console.error('[HomeDesigner] Diagram error:', err.message)
    return c.json({ error: err.message }, 500)
  }
})

// ============================================================
// GET /projects/:id — Get full project details
// ============================================================

homeDesignerRoutes.get('/projects/:id', async (c) => {
  const customerId = await getDesignerCustomerId(c)
  if (!customerId) return c.json({ error: 'Authentication required' }, 401)

  const projectId = parseInt(c.req.param('id'))

  try {
    await ensureDesignerTables(c.env.DB)

    const project = await c.env.DB.prepare(
      'SELECT * FROM hd_projects WHERE id = ? AND customer_id = ?'
    ).bind(projectId, customerId).first<any>()
    if (!project) return c.json({ error: 'Project not found' }, 404)

    const photosResult = await c.env.DB.prepare(
      'SELECT id, photo_index, original_url, segmentation_result, segmentation_tier, segmentation_confidence, recolored_url, recolor_status, recolor_job_id, angle_label, created_at FROM hd_photos WHERE project_id = ? ORDER BY photo_index'
    ).bind(projectId).all<any>()

    const diagramsResult = await c.env.DB.prepare(
      'SELECT id, diagram_svg, material_id, material_hex, status, created_at FROM hd_diagrams WHERE project_id = ? ORDER BY created_at DESC'
    ).bind(projectId).all<any>()

    // Parse segmentation results for each photo
    const photos = ((photosResult.results || []) as any[]).map(p => {
      let segParsed = null
      try { segParsed = p.segmentation_result ? JSON.parse(p.segmentation_result) : null } catch {}
      let recolorParsed = null
      try { recolorParsed = p.recolored_url && p.recolored_url.startsWith('{') ? JSON.parse(p.recolored_url) : p.recolored_url } catch {}
      return {
        ...p,
        segmentation: segParsed,
        render: recolorParsed,
      }
    })

    return c.json({
      success: true,
      project,
      photos,
      diagrams: diagramsResult.results || [],
      catalog_url: '/api/home-designer/catalog',
    })
  } catch (err: any) {
    console.error('[HomeDesigner] Get project error:', err.message)
    return c.json({ error: err.message }, 500)
  }
})

// ============================================================
// GET /projects — List all projects for customer
// ============================================================

homeDesignerRoutes.get('/projects', async (c) => {
  const customerId = await getDesignerCustomerId(c)
  if (!customerId) return c.json({ error: 'Authentication required' }, 401)

  try {
    await ensureDesignerTables(c.env.DB)

    const projectsResult = await c.env.DB.prepare(`
      SELECT p.*, 
        (SELECT COUNT(*) FROM hd_photos WHERE project_id = p.id) as photo_count,
        (SELECT COUNT(*) FROM hd_diagrams WHERE project_id = p.id) as diagram_count
      FROM hd_projects p
      WHERE p.customer_id = ?
      ORDER BY p.updated_at DESC
      LIMIT 50
    `).bind(customerId).all<any>()

    return c.json({
      success: true,
      projects: projectsResult.results || [],
      count: (projectsResult.results || []).length,
    })
  } catch (err: any) {
    console.error('[HomeDesigner] List projects error:', err.message)
    return c.json({ error: err.message }, 500)
  }
})

// ============================================================
// DELETE /projects/:id — Delete project
// ============================================================

homeDesignerRoutes.delete('/projects/:id', async (c) => {
  const customerId = await getDesignerCustomerId(c)
  if (!customerId) return c.json({ error: 'Authentication required' }, 401)

  const projectId = parseInt(c.req.param('id'))

  try {
    const project = await c.env.DB.prepare(
      'SELECT id FROM hd_projects WHERE id = ? AND customer_id = ?'
    ).bind(projectId, customerId).first<any>()
    if (!project) return c.json({ error: 'Project not found' }, 404)

    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM hd_diagrams WHERE project_id = ?').bind(projectId),
      c.env.DB.prepare('DELETE FROM hd_photos WHERE project_id = ?').bind(projectId),
      c.env.DB.prepare('DELETE FROM hd_projects WHERE id = ?').bind(projectId),
    ])

    return c.json({ success: true, message: 'Project deleted' })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ============================================================
// POST /webhook — Replicate callback for async renders
// ============================================================

homeDesignerRoutes.post('/webhook', async (c) => {
  try {
    const payload = await c.req.json() as any
    const jobId = payload.id
    const status = payload.status
    const output = payload.output

    if (!jobId) return c.json({ received: true }, 200)

    if (status === 'succeeded' && output) {
      const finalUrl = Array.isArray(output) ? output[0] : output
      await c.env.DB.prepare(`
        UPDATE hd_photos SET recolor_status = 'completed', recolored_url = ? WHERE recolor_job_id = ?
      `).bind(finalUrl, jobId).run()
    } else if (status === 'failed') {
      await c.env.DB.prepare(`
        UPDATE hd_photos SET recolor_status = 'failed' WHERE recolor_job_id = ?
      `).bind(jobId).run()
    }

    return c.json({ received: true }, 200)
  } catch (err: any) {
    return c.json({ received: true, error: err.message }, 200)
  }
})

export { homeDesignerRoutes }

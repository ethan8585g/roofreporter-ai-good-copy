import type { Context } from 'hono'
import { Hono } from 'hono'
import type { Bindings, AppEnv } from '../types'
import { resolveTeamOwner } from './team'
import { trueAreaFromFootprint, pitchToRatio } from '../utils/geo-math'
import { calculateTieredProposals, calculateProposal, DEFAULT_PRESETS, TIER_PRESETS } from '../services/pricing-engine'
import type { RoofMeasurements, RoofPresetCosts } from '../services/pricing-engine'
import { limitByIp, limitByKey } from '../lib/rate-limit'

export const widgetRoutes = new Hono<AppEnv>()

// ============================================================
// AUTH HELPER — same pattern as website-builder.ts
// ============================================================
async function getOwnerId(c: Context<AppEnv>): Promise<number | null> {
  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  if (!session) return null
  const { ownerId } = await resolveTeamOwner(c.env.DB, session.customer_id)
  return ownerId
}

// ============================================================
// DYNAMIC CORS for public widget endpoints
// ============================================================
async function setWidgetCors(c: Context<AppEnv>, allowedDomains: string) {
  const origin = c.req.header('Origin') || ''
  const domains = (allowedDomains || '').split(',').map((d: string) => d.trim()).filter(Boolean)
  // If no domains configured, allow all. Otherwise check origin.
  if (domains.length === 0 || domains.some((d: string) => origin.includes(d))) {
    c.header('Access-Control-Allow-Origin', origin || '*')
  } else {
    c.header('Access-Control-Allow-Origin', 'null')
  }
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  c.header('Access-Control-Allow-Headers', 'Content-Type')
}

// ============================================================
// PUBLIC ENDPOINTS — no auth, dynamic CORS
// ============================================================

// Preflight for all public routes
widgetRoutes.options('/public/*', async (c) => {
  c.header('Access-Control-Allow-Origin', c.req.header('Origin') || '*')
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  c.header('Access-Control-Allow-Headers', 'Content-Type')
  return c.text('', 204 as any)
})

// GET /public/config/:public_key — widget branding config
widgetRoutes.get('/public/config/:public_key', async (c) => {
  try {
    const publicKey = c.req.param('public_key')
    const config = await c.env.DB.prepare(`
      SELECT wc.*, c.brand_business_name, c.brand_logo_url, c.brand_primary_color,
             c.brand_phone, c.brand_email, c.brand_website
      FROM widget_configs wc
      JOIN customers c ON c.id = wc.customer_id
      WHERE wc.public_key = ? AND wc.is_active = 1
    `).bind(publicKey).first<any>()

    if (!config) {
      return c.json({ error: 'Widget not found or inactive' }, 404)
    }

    await setWidgetCors(c, config.allowed_domains)

    return c.json({
      headline: config.headline,
      subheadline: config.subheadline,
      button_color: config.button_color || config.brand_primary_color || '#1e3a5f',
      button_text: config.button_text || 'Get My Estimate',
      logo_url: config.logo_url || config.brand_logo_url || '',
      business_name: config.brand_business_name || '',
      business_phone: config.brand_phone || '',
      business_email: config.brand_email || '',
      business_website: config.brand_website || '',
      show_tiers: !!config.show_tiers,
      require_phone: !!config.require_phone,
      require_email: !!config.require_email,
    })
  } catch (e: any) {
    return c.json({ error: 'Failed to load widget config', details: e.message }, 500)
  }
})

// POST /public/estimate — run Solar API measurement + pricing, save lead
widgetRoutes.post('/public/estimate', async (c) => {
  try {
    // Rate limit: each call hits the paid Google Solar API and inserts a
    // widget_leads row. Without caps, an attacker can both run up the Solar
    // API bill and flood the contractor's lead inbox with garbage. Limit per
    // IP AND per public_key (so a single widget can't be DoS'd either).
    const ipRl = await limitByIp(c, 'widget-estimate-ip', 10, 600)
    if (!ipRl.ok) return c.json({ error: 'Too many estimate requests from your network. Try again in 10 minutes.' }, 429)

    const body = await c.req.json()
    const { public_key, address, lat, lng, name, email, phone } = body

    if (!public_key || !address || !lat || !lng) {
      return c.json({ error: 'public_key, address, lat, and lng are required' }, 400)
    }
    // Per-widget cap so one badly-targeted widget can't drain Solar API quota.
    const widgetRl = await limitByKey(c, 'widget-estimate-key', String(public_key), 30, 600)
    if (!widgetRl.ok) return c.json({ error: 'This widget has hit its rate limit. Try again in 10 minutes.' }, 429)

    // Look up widget config
    const config = await c.env.DB.prepare(`
      SELECT wc.*, c.brand_business_name, c.brand_phone, c.brand_email
      FROM widget_configs wc
      JOIN customers c ON c.id = wc.customer_id
      WHERE wc.public_key = ? AND wc.is_active = 1
    `).bind(public_key).first<any>()

    if (!config) {
      return c.json({ error: 'Widget not found or inactive' }, 404)
    }

    await setWidgetCors(c, config.allowed_domains)

    const solarKey = c.env.GOOGLE_SOLAR_API_KEY
    if (!solarKey) {
      return c.json({ error: 'Solar API not configured' }, 500)
    }

    // Call Google Solar API (same logic as ai-analysis.ts /ras-yield)
    let totalAreaSqft = 0
    let measurementsJson: any = null
    let solarFailed = false
    let dominantPitch = '6/12'

    try {
      const solarUrl = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=HIGH&key=${solarKey}`
      const solarResp = await fetch(solarUrl)

      if (!solarResp.ok) {
        solarFailed = true
      } else {
        const data: any = await solarResp.json()
        const sp = data.solarPotential
        if (!sp) {
          solarFailed = true
        } else {
          const segments = (sp.roofSegmentStats || []).map((seg: any, i: number) => {
            const pitchDeg = seg.pitchDegrees || 0
            const footprintSqm = seg.stats?.areaMeters2 || 0
            const footprintSqft = footprintSqm * 10.7639
            const trueAreaSqft = trueAreaFromFootprint(footprintSqft, pitchDeg)
            return {
              name: `Segment ${i + 1}`,
              pitch_degrees: Math.round(pitchDeg * 10) / 10,
              pitch_ratio: pitchToRatio(pitchDeg),
              footprint_sqft: Math.round(footprintSqft),
              true_area_sqft: Math.round(trueAreaSqft),
            }
          })

          totalAreaSqft = segments.reduce((s: number, seg: any) => s + seg.true_area_sqft, 0)
          measurementsJson = { segments, total_area_sqft: totalAreaSqft }

          // Dominant pitch = largest segment
          if (segments.length > 0) {
            const largest = segments.reduce((a: any, b: any) => a.true_area_sqft > b.true_area_sqft ? a : b)
            dominantPitch = largest.pitch_ratio
          }
        }
      }
    } catch {
      solarFailed = true
    }

    // If Solar API failed, save lead as manual_needed
    if (solarFailed) {
      await c.env.DB.prepare(`
        INSERT INTO widget_leads (widget_config_id, customer_id, lead_name, lead_email, lead_phone,
          property_address, lat, lng, status, source_domain, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual_needed', ?, ?, ?)
      `).bind(
        config.id, config.customer_id, name || '', email || '', phone || '',
        address, lat, lng,
        c.req.header('Origin') || '', c.req.header('CF-Connecting-IP') || '', c.req.header('User-Agent') || ''
      ).run()

      return c.json({
        status: 'manual_needed',
        message: "We couldn't automatically analyze this address. A team member will follow up with a manual estimate.",
        business_name: config.brand_business_name || '',
        business_phone: config.brand_phone || '',
        business_email: config.brand_email || '',
      })
    }

    // Calculate tiered proposals (with custom pricing if configured)
    const measurements: RoofMeasurements = {
      total_area_sqft: totalAreaSqft,
      dominant_pitch: dominantPitch,
    }

    let tiers: { good: any; better: any; best: any }
    const customPresets = config.pricing_presets_json ? JSON.parse(config.pricing_presets_json) : null

    if (customPresets) {
      // Merge: DEFAULT_PRESETS + shared overrides + per-tier overrides
      const shared = customPresets.shared || {}
      const buildPresets = (tierKey: 'good' | 'better' | 'best'): RoofPresetCosts => ({
        ...DEFAULT_PRESETS,
        ...shared,
        ...(TIER_PRESETS[tierKey] || {}),
        ...(customPresets[tierKey] || {}),
      })
      tiers = {
        good: calculateProposal(measurements, buildPresets('good'), 'Good — Custom'),
        better: calculateProposal(measurements, buildPresets('better'), 'Better — Custom'),
        best: calculateProposal(measurements, buildPresets('best'), 'Best — Custom'),
      }
    } else {
      tiers = calculateTieredProposals(measurements)
    }

    const estimateJson = {
      good: { total: tiers.good.total_price, squares: tiers.good.gross_squares },
      better: { total: tiers.better.total_price, squares: tiers.better.gross_squares },
      best: { total: tiers.best.total_price, squares: tiers.best.gross_squares },
    }

    // Save lead
    await c.env.DB.prepare(`
      INSERT INTO widget_leads (widget_config_id, customer_id, lead_name, lead_email, lead_phone,
        property_address, lat, lng, measurements_json, estimate_json, total_area_sqft,
        estimated_price_low, estimated_price_mid, estimated_price_high,
        status, source_domain, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)
    `).bind(
      config.id, config.customer_id, name || '', email || '', phone || '',
      address, lat, lng,
      JSON.stringify(measurementsJson), JSON.stringify(estimateJson), totalAreaSqft,
      tiers.good.total_price, tiers.better.total_price, tiers.best.total_price,
      c.req.header('Origin') || '', c.req.header('CF-Connecting-IP') || '', c.req.header('User-Agent') || ''
    ).run()

    return c.json({
      status: 'success',
      area_sqft: Math.round(totalAreaSqft),
      dominant_pitch: dominantPitch,
      tiers: {
        good: { label: 'Standard', total: Math.round(tiers.good.total_price) },
        better: { label: 'Premium', total: Math.round(tiers.better.total_price) },
        best: { label: 'Luxury', total: Math.round(tiers.best.total_price) },
      },
      business_name: config.brand_business_name || '',
      business_phone: config.brand_phone || '',
      business_email: config.brand_email || '',
    })
  } catch (e: any) {
    console.error('[widget/estimate]', e)
    return c.json({ error: 'Estimation failed', details: e.message }, 500)
  }
})

// ============================================================
// CONTRACTOR ENDPOINTS — require customer auth
// ============================================================

// GET /config — get or auto-create widget config
widgetRoutes.get('/config', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Authentication required' }, 401)

  try {
    let config = await c.env.DB.prepare(
      'SELECT * FROM widget_configs WHERE customer_id = ?'
    ).bind(ownerId).first<any>()

    if (!config) {
      // Auto-create with UUID public key and brand defaults
      const publicKey = crypto.randomUUID()
      const customer = await c.env.DB.prepare(
        'SELECT brand_primary_color, brand_logo_url FROM customers WHERE id = ?'
      ).bind(ownerId).first<any>()

      await c.env.DB.prepare(`
        INSERT INTO widget_configs (customer_id, public_key, button_color, logo_url)
        VALUES (?, ?, ?, ?)
      `).bind(
        ownerId, publicKey,
        customer?.brand_primary_color || null,
        customer?.brand_logo_url || null
      ).run()

      config = await c.env.DB.prepare(
        'SELECT * FROM widget_configs WHERE customer_id = ?'
      ).bind(ownerId).first<any>()
    }

    return c.json({ success: true, config })
  } catch (e: any) {
    return c.json({ error: 'Failed to load config', details: e.message }, 500)
  }
})

// PUT /config — update widget settings
widgetRoutes.put('/config', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Authentication required' }, 401)

  try {
    const body = await c.req.json()
    const fields = ['is_active', 'allowed_domains', 'headline', 'subheadline',
      'button_color', 'button_text', 'logo_url', 'show_tiers', 'require_phone', 'require_email',
      'pricing_presets_json']

    const updates: string[] = []
    const values: any[] = []
    for (const field of fields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = ?`)
        // Store pricing_presets_json as string if passed as object
        if (field === 'pricing_presets_json' && typeof body[field] === 'object') {
          values.push(JSON.stringify(body[field]))
        } else {
          values.push(body[field])
        }
      }
    }

    if (updates.length === 0) {
      return c.json({ error: 'No fields to update' }, 400)
    }

    updates.push("updated_at = datetime('now')")
    values.push(ownerId)

    await c.env.DB.prepare(
      `UPDATE widget_configs SET ${updates.join(', ')} WHERE customer_id = ?`
    ).bind(...values).run()

    const config = await c.env.DB.prepare(
      'SELECT * FROM widget_configs WHERE customer_id = ?'
    ).bind(ownerId).first<any>()

    return c.json({ success: true, config })
  } catch (e: any) {
    return c.json({ error: 'Failed to update config', details: e.message }, 500)
  }
})

// GET /leads — list leads with pagination + status filter
widgetRoutes.get('/leads', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Authentication required' }, 401)

  try {
    const status = c.req.query('status')
    const page = parseInt(c.req.query('page') || '1')
    const limit = parseInt(c.req.query('limit') || '20')
    const offset = (page - 1) * limit

    let sql = 'SELECT * FROM widget_leads WHERE customer_id = ?'
    const params: any[] = [ownerId]

    if (status && status !== 'all') {
      sql += ' AND status = ?'
      params.push(status)
    }

    // Count total
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total')
    const countResult = await c.env.DB.prepare(countSql).bind(...params).first<any>()

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)
    const leads = await c.env.DB.prepare(sql).bind(...params).all()

    return c.json({
      success: true,
      leads: leads.results,
      pagination: {
        page, limit,
        total: countResult?.total || 0,
        pages: Math.ceil((countResult?.total || 0) / limit),
      }
    })
  } catch (e: any) {
    return c.json({ error: 'Failed to load leads', details: e.message }, 500)
  }
})

// GET /leads/:id — full lead detail
widgetRoutes.get('/leads/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Authentication required' }, 401)

  try {
    const id = c.req.param('id')
    const lead = await c.env.DB.prepare(
      'SELECT * FROM widget_leads WHERE id = ? AND customer_id = ?'
    ).bind(id, ownerId).first<any>()

    if (!lead) return c.json({ error: 'Lead not found' }, 404)

    // Parse JSON fields
    if (lead.measurements_json) lead.measurements = JSON.parse(lead.measurements_json)
    if (lead.estimate_json) lead.estimate = JSON.parse(lead.estimate_json)

    return c.json({ success: true, lead })
  } catch (e: any) {
    return c.json({ error: 'Failed to load lead', details: e.message }, 500)
  }
})

// PATCH /leads/:id/status — update lead status
widgetRoutes.patch('/leads/:id/status', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Authentication required' }, 401)

  try {
    const id = c.req.param('id')
    const { status } = await c.req.json()
    const valid = ['new', 'contacted', 'converted', 'archived', 'manual_needed']
    if (!valid.includes(status)) {
      return c.json({ error: `Invalid status. Must be: ${valid.join(', ')}` }, 400)
    }

    const result = await c.env.DB.prepare(
      "UPDATE widget_leads SET status = ?, updated_at = datetime('now') WHERE id = ? AND customer_id = ?"
    ).bind(status, id, ownerId).run()

    if (!result.meta.changes) return c.json({ error: 'Lead not found' }, 404)
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Failed to update status', details: e.message }, 500)
  }
})

// DELETE /leads/:id — archive a lead
widgetRoutes.delete('/leads/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Authentication required' }, 401)

  try {
    const id = c.req.param('id')
    const result = await c.env.DB.prepare(
      "UPDATE widget_leads SET status = 'archived', updated_at = datetime('now') WHERE id = ? AND customer_id = ?"
    ).bind(id, ownerId).run()

    if (!result.meta.changes) return c.json({ error: 'Lead not found' }, 404)
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Failed to archive lead', details: e.message }, 500)
  }
})

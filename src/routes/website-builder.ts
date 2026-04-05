import { Hono } from 'hono'
import type { Bindings } from '../types'
import { resolveTeamOwner } from './team'
import { generateSiteCopy } from '../services/site-generator'
import { buildPageHTML } from '../services/site-templates'
import type { WBIntakeFormData, WBBrandColors } from '../types'

export const websiteBuilderRoutes = new Hono<{ Bindings: Bindings }>()

// ============================================================
// AUTH HELPER — same pattern as crm.ts
// ============================================================
async function getOwnerId(c: any): Promise<number | null> {
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

const SQUARE_API_BASE = 'https://connect.squareup.com/v2'
const SQUARE_API_VERSION = '2025-01-23'

async function squareRequest(accessToken: string, method: string, path: string, body?: any) {
  const response = await fetch(`${SQUARE_API_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': SQUARE_API_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data: any = await response.json()
  if (!response.ok) {
    throw new Error(data.errors?.[0]?.detail || `Square API error: ${response.status}`)
  }
  return data
}

// ============================================================
// GET /subscription — Check website builder subscription status
// ============================================================
websiteBuilderRoutes.get('/subscription', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)

  const sub = await c.env.DB.prepare(
    "SELECT * FROM wb_subscriptions WHERE customer_id = ? AND status = 'active' AND current_period_end > datetime('now') ORDER BY created_at DESC LIMIT 1"
  ).bind(ownerId).first()

  return c.json({
    active: !!sub,
    subscription: sub || null,
    price: '$99/month',
    price_cents: 9900,
  })
})

// ============================================================
// POST /subscribe — Create Square checkout for $99/month website builder
// ============================================================
websiteBuilderRoutes.post('/subscribe', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const accessToken = c.env.SQUARE_ACCESS_TOKEN
    const locationId = c.env.SQUARE_LOCATION_ID
    if (!accessToken || !locationId) return c.json({ error: 'Payments not configured' }, 503)

    // Check if already has active subscription
    const existing = await c.env.DB.prepare(
      "SELECT * FROM wb_subscriptions WHERE customer_id = ? AND status = 'active' AND current_period_end > datetime('now')"
    ).bind(ownerId).first()
    if (existing) return c.json({ active: true, message: 'Already subscribed' })

    const origin = new URL(c.req.url).origin
    const idempotencyKey = `wb-sub-${ownerId}-${Date.now()}`

    const paymentLink = await squareRequest(accessToken, 'POST', '/online-checkout/payment-links', {
      idempotency_key: idempotencyKey,
      quick_pay: {
        name: 'AI Website Builder — Monthly Subscription',
        price_money: {
          amount: 9900,
          currency: 'USD',
        },
        location_id: locationId,
      },
      checkout_options: {
        redirect_url: `${origin}/customer/website-builder?wb_payment=success`,
        ask_for_shipping_address: false,
      },
      payment_note: `Website Builder subscription for customer #${ownerId}`,
    })

    const link = paymentLink.payment_link

    // Create pending subscription
    await c.env.DB.prepare(`
      INSERT INTO wb_subscriptions (customer_id, status, square_order_id, square_payment_link_id, monthly_price_cents)
      VALUES (?, 'pending', ?, ?, 9900)
    `).bind(ownerId, link?.order_id || '', link?.id || '').run()

    return c.json({
      checkout_url: link?.url || link?.long_url,
      payment_link_id: link?.id,
    })
  } catch (err: any) {
    console.error('[WebsiteBuilder] Subscribe error:', err)
    return c.json({ error: 'Payment setup failed: ' + err.message }, 500)
  }
})

// ============================================================
// POST /subscribe/confirm — Activate subscription after payment
// ============================================================
websiteBuilderRoutes.post('/subscribe/confirm', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)

  try {
    // Find the most recent pending subscription for this customer
    const pending = await c.env.DB.prepare(
      "SELECT * FROM wb_subscriptions WHERE customer_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1"
    ).bind(ownerId).first<any>()

    if (!pending) {
      // Check if already active
      const active = await c.env.DB.prepare(
        "SELECT * FROM wb_subscriptions WHERE customer_id = ? AND status = 'active' AND current_period_end > datetime('now')"
      ).bind(ownerId).first()
      if (active) return c.json({ success: true, message: 'Already active' })
      return c.json({ error: 'No pending subscription found' }, 404)
    }

    // Activate the subscription — 30 days from now
    const now = new Date()
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

    await c.env.DB.prepare(`
      UPDATE wb_subscriptions
      SET status = 'active',
          current_period_start = datetime('now'),
          current_period_end = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(periodEnd.toISOString(), pending.id).run()

    return c.json({ success: true, expires: periodEnd.toISOString() })
  } catch (err: any) {
    console.error('[WebsiteBuilder] Confirm error:', err)
    return c.json({ error: 'Confirmation failed' }, 500)
  }
})

// ============================================================
// POST /intake — Save intake form, generate AI copy, create site + pages
// ============================================================
websiteBuilderRoutes.post('/intake', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)

    // Check active subscription
    const activeSub = await c.env.DB.prepare(
      "SELECT id FROM wb_subscriptions WHERE customer_id = ? AND status = 'active' AND current_period_end > datetime('now')"
    ).bind(ownerId).first()
    if (!activeSub) {
      return c.json({ error: 'subscription_required', message: 'Website Builder requires a $99/month subscription.' }, 402)
    }

  try {
    const intake: WBIntakeFormData = await c.req.json()

    if (!intake.business_name || !intake.city || !intake.province) {
      return c.json({ error: 'Missing required fields: business_name, city, province' }, 400)
    }
    if (!intake.services_offered?.length) {
      return c.json({ error: 'At least one service is required' }, 400)
    }

    // Generate subdomain from business name
    let subdomain = intake.business_name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 40)
      .replace(/^-|-$/g, '')

    // Check uniqueness, append random suffix if needed
    const existing = await c.env.DB.prepare(
      'SELECT id FROM wb_sites WHERE subdomain = ?'
    ).bind(subdomain).first()
    if (existing) {
      subdomain += '-' + Math.random().toString(36).slice(2, 6)
    }

    const colors: WBBrandColors = intake.brand_colors || {
      primary: '#1E3A5F',
      secondary: '#1a1a2e',
      accent: '#e85c2b'
    }

    // Create site record first
    const site = await c.env.DB.prepare(`
      INSERT INTO wb_sites (
        owner_id, subdomain, business_name, business_phone, business_email,
        business_address, city, province, logo_url,
        primary_color, secondary_color, accent_color,
        tagline, services_json, service_areas_json, certifications_json,
        years_in_business, google_reviews_json, brand_vibe,
        owner_name, company_story, status, theme, intake_data_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generating', ?, ?)
      RETURNING id
    `).bind(
      ownerId, subdomain, intake.business_name, intake.phone, intake.email,
      intake.address || '', intake.city, intake.province, intake.logo_url || '',
      colors.primary, colors.secondary, colors.accent,
      '', JSON.stringify(intake.services_offered), JSON.stringify(intake.service_areas),
      JSON.stringify(intake.certifications || []),
      intake.years_in_business || null, JSON.stringify(intake.google_reviews || []),
      intake.brand_vibe || 'professional',
      intake.owner_name || '', intake.company_story || '',
      intake.theme_id || 'clean-pro', JSON.stringify(intake)
    ).first<any>()

    if (!site?.id) throw new Error('Failed to create site record')
    const siteId = site.id

    // Generate AI content
    const siteContent = await generateSiteCopy(intake, {
      GEMINI_API_KEY: c.env.GEMINI_API_KEY,
      GCP_SERVICE_ACCOUNT_KEY: c.env.GCP_SERVICE_ACCOUNT_KEY,
      GOOGLE_VERTEX_API_KEY: c.env.GOOGLE_VERTEX_API_KEY,
    })

    // Build pages
    const basePath = `/sites/${subdomain}`
    const pageTypes = [
      { key: 'home' as const, slug: '/', page_type: 'home', title: 'Home', sort: 0 },
      { key: 'services' as const, slug: '/services', page_type: 'services', title: 'Services', sort: 1 },
      { key: 'about' as const, slug: '/about', page_type: 'about', title: 'About Us', sort: 2 },
      { key: 'service_areas' as const, slug: '/service-areas', page_type: 'service_area', title: 'Service Areas', sort: 3 },
      { key: 'contact' as const, slug: '/contact', page_type: 'contact', title: 'Contact', sort: 4 },
    ]

    for (const pageInfo of pageTypes) {
      const pageContent = siteContent[pageInfo.key]
      if (!pageContent) continue

      const html = buildPageHTML(pageContent, colors, intake.business_name, intake.phone, siteId, basePath)

      await c.env.DB.prepare(`
        INSERT INTO wb_pages (site_id, slug, page_type, title, meta_title, meta_description, sections_json, html_snapshot, sort_order, is_published)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      `).bind(
        siteId, pageInfo.slug, pageInfo.page_type, pageInfo.title,
        pageContent.meta_title, pageContent.meta_description,
        JSON.stringify(pageContent.sections), html, pageInfo.sort
      ).run()
    }

    // Save content draft
    await c.env.DB.prepare(`
      INSERT INTO wb_content_drafts (site_id, version, full_content_json, generation_model)
      VALUES (?, 1, ?, 'gemini-2.0-flash')
    `).bind(siteId, JSON.stringify(siteContent)).run()

    // Update status to preview
    await c.env.DB.prepare(
      "UPDATE wb_sites SET status = 'preview', updated_at = datetime('now') WHERE id = ?"
    ).bind(siteId).run()

    return c.json({
      success: true,
      site_id: siteId,
      subdomain,
      preview_url: `/api/website-builder/sites/${siteId}/preview/home`,
    })
  } catch (err: any) {
    console.error('[WebsiteBuilder] Intake error:', err)
    // Clean up any half-created site records
    try {
      await c.env.DB.prepare(
        "DELETE FROM wb_sites WHERE owner_id = ? AND status = 'generating'"
      ).bind(ownerId).run()
    } catch {}
    return c.json({ error: 'generation_failed', message: 'AI generation failed — please try again. Error: ' + (err.message || 'Unknown') }, 500)
  }
})

// ============================================================
// GET /sites — List contractor's sites
// ============================================================
websiteBuilderRoutes.get('/sites', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)

  const sites = await c.env.DB.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM wb_pages p WHERE p.site_id = s.id) as page_count,
      (SELECT COUNT(*) FROM wb_site_leads l WHERE l.site_id = s.id) as lead_count
    FROM wb_sites s
    WHERE s.owner_id = ?
    ORDER BY s.created_at DESC
  `).bind(ownerId).all()

  return c.json({ success: true, sites: sites.results })
})

// ============================================================
// GET /sites/:id — Site details + pages
// ============================================================
websiteBuilderRoutes.get('/sites/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const siteId = parseInt(c.req.param('id'))

  const site = await c.env.DB.prepare(
    'SELECT * FROM wb_sites WHERE id = ? AND owner_id = ?'
  ).bind(siteId, ownerId).first()
  if (!site) return c.json({ error: 'Site not found' }, 404)

  const pages = await c.env.DB.prepare(
    'SELECT id, slug, page_type, title, meta_title, meta_description, sort_order, is_published, created_at FROM wb_pages WHERE site_id = ? ORDER BY sort_order'
  ).bind(siteId).all()

  return c.json({ success: true, site, pages: pages.results })
})

// ============================================================
// GET /sites/:id/preview/:slug — Serve page HTML preview
// ============================================================
websiteBuilderRoutes.get('/sites/:id/preview/:slug', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const siteId = parseInt(c.req.param('id'))
  const slug = '/' + (c.req.param('slug') === 'home' ? '' : c.req.param('slug'))
  const normalizedSlug = slug === '/' ? '/' : slug

  const site = await c.env.DB.prepare(
    'SELECT id FROM wb_sites WHERE id = ? AND owner_id = ?'
  ).bind(siteId, ownerId).first()
  if (!site) return c.json({ error: 'Site not found' }, 404)

  const page = await c.env.DB.prepare(
    'SELECT html_snapshot FROM wb_pages WHERE site_id = ? AND slug = ?'
  ).bind(siteId, normalizedSlug).first<any>()
  if (!page?.html_snapshot) return c.json({ error: 'Page not found' }, 404)

  return c.html(page.html_snapshot)
})

// ============================================================
// POST /sites/:id/publish — Set site live
// ============================================================
websiteBuilderRoutes.post('/sites/:id/publish', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const siteId = parseInt(c.req.param('id'))

  const site = await c.env.DB.prepare(
    'SELECT * FROM wb_sites WHERE id = ? AND owner_id = ?'
  ).bind(siteId, ownerId).first<any>()
  if (!site) return c.json({ error: 'Site not found' }, 404)

  // Publish all pages
  await c.env.DB.prepare(
    "UPDATE wb_pages SET is_published = 1, updated_at = datetime('now') WHERE site_id = ?"
  ).bind(siteId).run()

  // Update site status
  await c.env.DB.prepare(
    "UPDATE wb_sites SET status = 'published', published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).bind(siteId).run()

  const liveUrl = `https://www.roofmanager.ca/sites/${site.subdomain}`

  return c.json({
    success: true,
    url: liveUrl,
    subdomain: site.subdomain,
  })
})

// ============================================================
// PATCH /sites/:id — Update site settings
// ============================================================
websiteBuilderRoutes.patch('/sites/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const siteId = parseInt(c.req.param('id'))

  const site = await c.env.DB.prepare(
    'SELECT id FROM wb_sites WHERE id = ? AND owner_id = ?'
  ).bind(siteId, ownerId).first()
  if (!site) return c.json({ error: 'Site not found' }, 404)

  const body = await c.req.json()
  const allowedFields = [
    'business_name', 'business_phone', 'business_email', 'business_address',
    'city', 'province', 'logo_url', 'primary_color', 'secondary_color', 'accent_color',
    'tagline', 'theme', 'meta_title', 'meta_description', 'custom_domain'
  ]

  const updates: string[] = []
  const values: any[] = []
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates.push(`${field} = ?`)
      values.push(body[field])
    }
  }

  if (updates.length === 0) return c.json({ error: 'No valid fields to update' }, 400)

  updates.push("updated_at = datetime('now')")
  values.push(siteId)

  await c.env.DB.prepare(
    `UPDATE wb_sites SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run()

  return c.json({ success: true })
})

// ============================================================
// GET /sites/:id/pages/:pageId — Get page sections for editing
// ============================================================
websiteBuilderRoutes.get('/sites/:id/pages/:pageId', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const siteId = parseInt(c.req.param('id'))
  const pageId = parseInt(c.req.param('pageId'))

  const site = await c.env.DB.prepare(
    'SELECT id FROM wb_sites WHERE id = ? AND owner_id = ?'
  ).bind(siteId, ownerId).first()
  if (!site) return c.json({ error: 'Site not found' }, 404)

  const page = await c.env.DB.prepare(
    'SELECT id, slug, page_type, title, meta_title, meta_description, sections_json, sort_order, is_published FROM wb_pages WHERE id = ? AND site_id = ?'
  ).bind(pageId, siteId).first<any>()
  if (!page) return c.json({ error: 'Page not found' }, 404)

  const sections = JSON.parse(page.sections_json || '[]')
  return c.json({ success: true, page: { ...page, sections, sections_json: undefined } })
})

// ============================================================
// PATCH /sites/:id/pages/:pageId — Edit page content
// ============================================================
websiteBuilderRoutes.patch('/sites/:id/pages/:pageId', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const siteId = parseInt(c.req.param('id'))
  const pageId = parseInt(c.req.param('pageId'))

  const site = await c.env.DB.prepare(
    'SELECT * FROM wb_sites WHERE id = ? AND owner_id = ?'
  ).bind(siteId, ownerId).first<any>()
  if (!site) return c.json({ error: 'Site not found' }, 404)

  const page = await c.env.DB.prepare(
    'SELECT * FROM wb_pages WHERE id = ? AND site_id = ?'
  ).bind(pageId, siteId).first<any>()
  if (!page) return c.json({ error: 'Page not found' }, 404)

  const body = await c.req.json()

  const metaTitle = body.meta_title !== undefined ? body.meta_title : page.meta_title
  const metaDesc = body.meta_description !== undefined ? body.meta_description : page.meta_description
  const sections = body.sections !== undefined ? body.sections : JSON.parse(page.sections_json || '[]')

  if (body.sections !== undefined && !Array.isArray(body.sections)) {
    return c.json({ error: 'sections must be an array' }, 400)
  }

  // Rebuild HTML snapshot
  const colors: WBBrandColors = {
    primary: site.primary_color || '#1E3A5F',
    secondary: site.secondary_color || '#1a1a2e',
    accent: site.accent_color || '#e85c2b',
  }
  const basePath = `/sites/${site.subdomain}`
  const pageContent = { meta_title: metaTitle, meta_description: metaDesc, sections }
  const html = buildPageHTML(pageContent, colors, site.business_name, site.business_phone, siteId, basePath)

  await c.env.DB.prepare(`
    UPDATE wb_pages SET meta_title = ?, meta_description = ?, sections_json = ?, html_snapshot = ?, updated_at = datetime('now') WHERE id = ?
  `).bind(metaTitle, metaDesc, JSON.stringify(sections), html, pageId).run()

  return c.json({ success: true })
})

// ============================================================
// POST /sites/:id/regenerate — Re-run AI generation
// ============================================================
websiteBuilderRoutes.post('/sites/:id/regenerate', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const siteId = parseInt(c.req.param('id'))

  const site = await c.env.DB.prepare(
    'SELECT * FROM wb_sites WHERE id = ? AND owner_id = ?'
  ).bind(siteId, ownerId).first<any>()
  if (!site) return c.json({ error: 'Site not found' }, 404)

  const intake: WBIntakeFormData = JSON.parse(site.intake_data_json || '{}')
  if (!intake.business_name) return c.json({ error: 'No intake data found for this site' }, 400)

  // Set status to generating
  await c.env.DB.prepare(
    "UPDATE wb_sites SET status = 'generating', updated_at = datetime('now') WHERE id = ?"
  ).bind(siteId).run()

  const siteContent = await generateSiteCopy(intake, {
    GEMINI_API_KEY: c.env.GEMINI_API_KEY,
    GCP_SERVICE_ACCOUNT_KEY: c.env.GCP_SERVICE_ACCOUNT_KEY,
    GOOGLE_VERTEX_API_KEY: c.env.GOOGLE_VERTEX_API_KEY,
  })

  const colors: WBBrandColors = {
    primary: site.primary_color || '#1E3A5F',
    secondary: site.secondary_color || '#1a1a2e',
    accent: site.accent_color || '#e85c2b',
  }

  // Delete old pages and recreate
  await c.env.DB.prepare('DELETE FROM wb_pages WHERE site_id = ?').bind(siteId).run()

  const basePath = `/sites/${site.subdomain}`
  const pageTypes = [
    { key: 'home' as const, slug: '/', page_type: 'home', title: 'Home', sort: 0 },
    { key: 'services' as const, slug: '/services', page_type: 'services', title: 'Services', sort: 1 },
    { key: 'about' as const, slug: '/about', page_type: 'about', title: 'About Us', sort: 2 },
    { key: 'service_areas' as const, slug: '/service-areas', page_type: 'service_area', title: 'Service Areas', sort: 3 },
    { key: 'contact' as const, slug: '/contact', page_type: 'contact', title: 'Contact', sort: 4 },
  ]

  for (const pageInfo of pageTypes) {
    const pageContent = siteContent[pageInfo.key]
    if (!pageContent) continue

    const html = buildPageHTML(pageContent, colors, site.business_name, site.business_phone, siteId, basePath)

    await c.env.DB.prepare(`
      INSERT INTO wb_pages (site_id, slug, page_type, title, meta_title, meta_description, sections_json, html_snapshot, sort_order, is_published)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      siteId, pageInfo.slug, pageInfo.page_type, pageInfo.title,
      pageContent.meta_title, pageContent.meta_description,
      JSON.stringify(pageContent.sections), html, pageInfo.sort,
      site.status === 'published' ? 1 : 0
    ).run()
  }

  // Save new draft version
  const lastDraft = await c.env.DB.prepare(
    'SELECT MAX(version) as max_ver FROM wb_content_drafts WHERE site_id = ?'
  ).bind(siteId).first<any>()
  const nextVersion = (lastDraft?.max_ver || 0) + 1

  await c.env.DB.prepare(`
    INSERT INTO wb_content_drafts (site_id, version, full_content_json, generation_model)
    VALUES (?, ?, ?, 'gemini-2.0-flash')
  `).bind(siteId, nextVersion, JSON.stringify(siteContent)).run()

  // Keep published status if site was already live, otherwise set to preview
  const newStatus = site.status === 'published' ? 'published' : 'preview'
  await c.env.DB.prepare(
    "UPDATE wb_sites SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(newStatus, siteId).run()

  return c.json({ success: true, version: nextVersion })
})

// ============================================================
// POST /leads — Public lead capture (no auth required, CORS open for custom domains)
// ============================================================

// Simple in-memory rate limiter for lead submissions
const leadRateLimit = new Map<string, { count: number; resetAt: number }>()

websiteBuilderRoutes.options('/leads', (c) => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  })
})

websiteBuilderRoutes.post('/leads', async (c) => {
  // Allow cross-origin for custom domain forms
  c.header('Access-Control-Allow-Origin', '*')
  try {
    // Rate limiting: max 5 submissions per IP per 60 seconds
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown'
    const now = Date.now()
    const rl = leadRateLimit.get(ip)
    if (rl && rl.resetAt > now) {
      if (rl.count >= 5) {
        return c.json({ error: 'Too many submissions. Please try again later.' }, 429)
      }
      rl.count++
    } else {
      leadRateLimit.set(ip, { count: 1, resetAt: now + 60000 })
    }

    const body = await c.req.json()

    // Validate required fields
    const siteId = parseInt(body.site_id)
    if (!siteId || !body.name || String(body.name).trim().length < 2) {
      return c.json({ error: 'site_id and name are required' }, 400)
    }
    if (!body.email && !body.phone) {
      return c.json({ error: 'Email or phone is required' }, 400)
    }
    // Validate email format if provided
    if (body.email && !String(body.email).includes('@')) {
      return c.json({ error: 'Invalid email format' }, 400)
    }
    // Validate phone has at least 7 digits if provided
    if (body.phone && String(body.phone).replace(/\D/g, '').length < 7) {
      return c.json({ error: 'Invalid phone number' }, 400)
    }

    // Look up site to get owner_id
    const site = await c.env.DB.prepare(
      "SELECT id, owner_id, business_name FROM wb_sites WHERE id = ? AND status = 'published'"
    ).bind(siteId).first<any>()
    if (!site) return c.json({ error: 'Site not found' }, 404)

    // Insert lead
    const lead = await c.env.DB.prepare(`
      INSERT INTO wb_site_leads (site_id, owner_id, name, email, phone, address, message, service_type, source, source_page, utm_source, utm_medium, utm_campaign)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id
    `).bind(
      siteId, site.owner_id, body.name, body.email || '', body.phone || '',
      body.address || '', body.message || '', body.service_type || '',
      body.source || 'contact_form', body.source_page || '',
      body.utm_source || '', body.utm_medium || '', body.utm_campaign || ''
    ).first<any>()

    // Auto-create CRM customer if email provided
    if (body.email) {
      try {
        const existingCrm = await c.env.DB.prepare(
          'SELECT id FROM crm_customers WHERE owner_id = ? AND email = ?'
        ).bind(site.owner_id, body.email).first<any>()

        if (!existingCrm) {
          const crmCustomer = await c.env.DB.prepare(`
            INSERT INTO crm_customers (owner_id, name, email, phone, address, source, notes)
            VALUES (?, ?, ?, ?, ?, 'website', ?)
            RETURNING id
          `).bind(
            site.owner_id, body.name, body.email, body.phone || '',
            body.address || '', `Lead from ${site.business_name} website`
          ).first<any>()

          if (crmCustomer?.id && lead?.id) {
            await c.env.DB.prepare(
              'UPDATE wb_site_leads SET crm_customer_id = ? WHERE id = ?'
            ).bind(crmCustomer.id, lead.id).run()
          }
        }
      } catch (e) {
        console.warn('[WebsiteBuilder] CRM sync failed:', e)
      }
    }

    return c.json({ success: true, lead_id: lead?.id })
  } catch (err: any) {
    console.error('[WebsiteBuilder] Lead capture error:', err)
    return c.json({ error: 'Failed to submit lead' }, 500)
  }
})

// ============================================================
// GET /sites/:id/leads — View leads for a site
// ============================================================
websiteBuilderRoutes.get('/sites/:id/leads', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const siteId = parseInt(c.req.param('id'))

  const site = await c.env.DB.prepare(
    'SELECT id FROM wb_sites WHERE id = ? AND owner_id = ?'
  ).bind(siteId, ownerId).first()
  if (!site) return c.json({ error: 'Site not found' }, 404)

  const leads = await c.env.DB.prepare(`
    SELECT * FROM wb_site_leads WHERE site_id = ? ORDER BY created_at DESC LIMIT 100
  `).bind(siteId).all()

  return c.json({ success: true, leads: leads.results })
})

// ============================================================
// DELETE /sites/:id — Delete a site
// ============================================================
websiteBuilderRoutes.delete('/sites/:id', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)
  const siteId = parseInt(c.req.param('id'))

  const site = await c.env.DB.prepare(
    'SELECT id FROM wb_sites WHERE id = ? AND owner_id = ?'
  ).bind(siteId, ownerId).first()
  if (!site) return c.json({ error: 'Site not found' }, 404)

  // Cascade deletes handle pages and drafts
  await c.env.DB.prepare('DELETE FROM wb_site_leads WHERE site_id = ?').bind(siteId).run()
  await c.env.DB.prepare('DELETE FROM wb_content_drafts WHERE site_id = ?').bind(siteId).run()
  await c.env.DB.prepare('DELETE FROM wb_pages WHERE site_id = ?').bind(siteId).run()
  await c.env.DB.prepare('DELETE FROM wb_sites WHERE id = ?').bind(siteId).run()

  return c.json({ success: true })
})

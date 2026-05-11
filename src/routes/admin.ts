import { Hono } from 'hono'
import type { Bindings } from '../types'
import { validateAdminSession, requireSuperadmin } from './auth'
import { generateReportForOrder } from './reports'
import { createAutoInvoiceForOrder } from '../services/auto-invoice'
import { validateTraceUi } from '../utils/trace-validation'
import { RoofMeasurementEngine, traceUiToEnginePayload } from '../services/roof-measurement-engine'
import { BASEMAP_PROVIDERS } from '../services/satellite-imagery'
import { generateApiKey } from '../middleware/api-auth'
import { addCredits } from '../services/api-billing'
import { notifyNewReportRequest, sendGmailOAuth2, sendViaResend, sendGmailEmail } from '../services/email'
import { recordAndNotify } from '../services/admin-notifications'
import { logAdminAction } from '../lib/audit-log'
import { clientIp } from '../lib/rate-limit'
import { encryptSecret, decryptSecret } from '../lib/secret-vault'
import { trackActivity } from '../services/activity-tracker'
import { getReportViewEvents, getReportViewSummary } from '../repositories/reports'
import { runAutoTrace, type AutoTraceEdge } from '../services/auto-trace-agent'
import { logCorrections as logAutoTraceCorrections } from '../services/auto-trace-learning'

export const adminRoutes = new Hono<{ Bindings: Bindings }>()

// Seeds the default material catalog items for a new account. The list mirrors
// every line item the proposal builder calculates from a roof measurement
// report so the catalog is a useful starting point on day one.
async function seedDefaultMaterials(db: any, ownerId: number) {
  const defaults = [
    { category: 'shingles',      name: '3-Tab Standard Shingles',              unit: 'bundles', unit_price: 32.00,  coverage_per_unit: '33 sq ft per bundle (3 bundles/square)', is_default: 0, sort_order: 1 },
    { category: 'shingles',      name: 'Architectural Shingles (Laminate)',    unit: 'bundles', unit_price: 42.00,  coverage_per_unit: '33 sq ft per bundle (3 bundles/square)', is_default: 1, sort_order: 2 },
    { category: 'shingles',      name: 'Premium Architectural Shingles',       unit: 'bundles', unit_price: 55.00,  coverage_per_unit: '33 sq ft per bundle (3 bundles/square)', is_default: 0, sort_order: 3 },
    { category: 'shingles',      name: 'Designer / Luxury Shingles',           unit: 'bundles', unit_price: 72.00,  coverage_per_unit: '33 sq ft per bundle (3 bundles/square)', is_default: 0, sort_order: 4 },
    { category: 'shingles',      name: 'Impact-Resistant Shingles (Class 4)',  unit: 'bundles', unit_price: 62.00,  coverage_per_unit: '33 sq ft per bundle (3 bundles/square)', is_default: 0, sort_order: 5 },
    { category: 'shingles',      name: 'Steel / Metal Shingles',               unit: 'bundles', unit_price: 95.00,  coverage_per_unit: '33 sq ft per bundle (3 bundles/square)', is_default: 0, sort_order: 6 },
    { category: 'underlayment',  name: 'Synthetic Underlayment',               unit: 'rolls',   unit_price: 95.00,  coverage_per_unit: '400 sq ft per roll',                     is_default: 1, sort_order: 7 },
    { category: 'ice_shield',    name: 'Ice & Water Shield Membrane',          unit: 'rolls',   unit_price: 165.00, coverage_per_unit: '200 sq ft per roll',                     is_default: 1, sort_order: 8 },
    { category: 'starter',       name: 'Starter Strip Shingles',              unit: 'boxes',   unit_price: 45.00,  coverage_per_unit: '100 lin ft per box',                     is_default: 1, sort_order: 9 },
    { category: 'ridge_cap',     name: 'Ridge/Hip Cap Shingles',              unit: 'bundles', unit_price: 65.00,  coverage_per_unit: '35 lin ft per bundle',                   is_default: 1, sort_order: 10 },
    { category: 'drip_edge',     name: 'Drip Edge — Eave (Type C)',           unit: 'pieces',  unit_price: 8.50,   coverage_per_unit: '10 ft per piece',                        is_default: 1, sort_order: 11 },
    { category: 'drip_edge',     name: 'Drip Edge — Rake/Gable (Type D)',     unit: 'pieces',  unit_price: 9.50,   coverage_per_unit: '10 ft per piece',                        is_default: 1, sort_order: 12 },
    { category: 'valley_metal',  name: 'W-Valley Flashing (Aluminum)',        unit: 'pieces',  unit_price: 22.00,  coverage_per_unit: '10 ft per piece',                        is_default: 1, sort_order: 13 },
    { category: 'nails',         name: 'Roofing Nails 1-1/4" Galvanized',    unit: 'boxes',   unit_price: 28.00,  coverage_per_unit: '5 lb box (~2 squares)',                  is_default: 1, sort_order: 14 },
    { category: 'ventilation',   name: 'Ridge Vent',                          unit: 'pieces',  unit_price: 22.00,  coverage_per_unit: '4 ft per piece',                         is_default: 1, sort_order: 15 },
    { category: 'custom',        name: 'Roofing Cement / Caulk',             unit: 'tubes',   unit_price: 8.50,   coverage_per_unit: '~1 tube per 5 squares',                  is_default: 1, sort_order: 16 },
    { category: 'custom',        name: 'Pipe Boot / Collar',                 unit: 'pieces',  unit_price: 18.00,  coverage_per_unit: '~2 per 1000 sq ft',                      is_default: 0, sort_order: 17 },
  ]
  for (const d of defaults) {
    await db.prepare(
      `INSERT INTO material_catalog (owner_id, category, name, unit, unit_price, coverage_per_unit, supplier, is_default, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(ownerId, d.category, d.name, d.unit, d.unit_price, d.coverage_per_unit, '', d.is_default, d.sort_order).run()
  }
}

// ============================================================
// ADMIN AUTH MIDDLEWARE — Validates session on every request
// ============================================================
adminRoutes.use('/*', async (c, next) => {
  // Allow init-db without auth (it's now protected separately)
  // All other routes require valid admin session
  const path = c.req.path.replace('/api/admin', '')

  // init-db requires auth separately inside the handler
  if (path === '/init-db') {
    return next()
  }

  // P1-31: accept the HttpOnly rm_admin_session cookie as a fallback to the
  // legacy Authorization: Bearer header so browsers that migrated off
  // localStorage still authenticate.
  const admin = await validateAdminSession(
    c.env.DB,
    c.req.header('Authorization'),
    c.req.header('Cookie')
  )
  if (!admin) {
    return c.json({ error: 'Admin authentication required. Please log in at /login' }, 401)
  }

  // P1-14: admin.ts is the superadmin management surface — every route here
  // requires role === 'superadmin'. Previously the guard was scattered on
  // ~20 handlers and absent from the rest; consolidating here closes the gap.
  if (!requireSuperadmin(admin)) {
    return c.json({ error: 'Superadmin access required' }, 403)
  }

  // Store admin info in context for downstream use
  c.set('admin' as any, admin)

  // Activity tracking — fire-and-forget. Never blocks the request.
  try {
    const job = trackActivity(c.env, {
      userType: 'admin',
      userId: admin.id,
      path: c.req.path,
      ip: c.req.header('CF-Connecting-IP') || null,
      ua: c.req.header('User-Agent') || null,
    })
    // @ts-ignore — executionCtx is available in the Workers runtime
    if (c.executionCtx?.waitUntil) c.executionCtx.waitUntil(job)
  } catch {}

  return next()
})

// Test notification email — superadmin only
adminRoutes.post('/superadmin/test-notification', async (c) => {
  try {
    const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
    if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

    await notifyNewReportRequest(c.env, {
      order_number: 'RM-TEST-0000',
      property_address: '123 Test Street, Toronto, ON',
      requester_name: 'Test User',
      requester_email: 'test@example.com',
      service_tier: 'standard',
      price: 10.00,
      is_trial: false
    })

    return c.json({ success: true, sent_to: 'sales@roofmanager.ca' })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// Email pipeline diagnostic — surfaces the actual provider error rather than
// swallowing it. notifyNewReportRequest() catches its own errors so the regular
// test-notification endpoint always returns 200 even when delivery fails.
adminRoutes.get('/superadmin/email-diagnostic', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  const env: any = c.env
  const recipient = c.req.query('to') || 'sales@roofmanager.ca'

  // Resolve credentials with same DB-fallback logic as notifyNewReportRequest
  const clientId = env.GMAIL_CLIENT_ID || ''
  let clientSecret = env.GMAIL_CLIENT_SECRET || ''
  let refreshToken = env.GMAIL_REFRESH_TOKEN || ''
  let clientSecretSource = clientSecret ? 'env' : 'missing'
  let refreshTokenSource = refreshToken ? 'env' : 'missing'
  if (!clientSecret || !refreshToken) {
    try {
      const r = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_refresh_token' AND master_company_id=1").first<any>()
      if (r?.setting_value && !refreshToken) { refreshToken = r.setting_value; refreshTokenSource = 'db' }
      const s = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_client_secret' AND master_company_id=1").first<any>()
      if (s?.setting_value && !clientSecret) { clientSecret = s.setting_value; clientSecretSource = 'db' }
    } catch (e: any) {
      return c.json({ ok: false, step: 'db_lookup', error: e?.message })
    }
  }

  const credentials = {
    clientId: clientId ? `${clientId.slice(0, 8)}…(${clientId.length}c)` : null,
    clientSecret: clientSecret ? `set (${clientSecretSource}, ${clientSecret.length}c)` : null,
    refreshToken: refreshToken ? `set (${refreshTokenSource}, ${refreshToken.length}c)` : null,
    senderEmail: env.GMAIL_SENDER_EMAIL || null,
    resendApiKey: env.RESEND_API_KEY ? 'set' : null,
    gcpServiceAccount: env.GCP_SERVICE_ACCOUNT_JSON ? 'set' : null,
  }

  // Try Resend first if configured
  if (env.RESEND_API_KEY) {
    try {
      const r = await sendViaResend(env.RESEND_API_KEY, recipient, '[Diagnostic] Roof Manager email test', '<p>This is a diagnostic email.</p>')
      return c.json({ ok: true, provider: 'resend', credentials, sent_to: recipient, message_id: r.id })
    } catch (e: any) {
      return c.json({ ok: false, provider: 'resend', credentials, step: 'resend_send', error: e?.message })
    }
  }

  if (!clientId || !clientSecret || !refreshToken) {
    return c.json({ ok: false, credentials, step: 'credentials_missing', error: 'Gmail OAuth2 credentials incomplete (need clientId + clientSecret + refreshToken)' })
  }

  // Step 1 — refresh access token. This is where stale/revoked refresh tokens fail.
  let accessToken = ''
  try {
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }).toString(),
      signal: AbortSignal.timeout(10000)
    })
    const text = await tokenResp.text()
    if (!tokenResp.ok) {
      return c.json({ ok: false, provider: 'gmail_oauth2', credentials, step: 'token_refresh', http_status: tokenResp.status, error: text })
    }
    accessToken = JSON.parse(text).access_token
  } catch (e: any) {
    return c.json({ ok: false, provider: 'gmail_oauth2', credentials, step: 'token_refresh_network', error: e?.message })
  }

  // Step 2 — actual send
  try {
    const r = await sendGmailOAuth2(clientId, clientSecret, refreshToken, recipient, '[Diagnostic] Roof Manager email test', '<p>This is a diagnostic email from /api/admin/superadmin/email-diagnostic.</p>', env.GMAIL_SENDER_EMAIL || null)
    return c.json({ ok: true, provider: 'gmail_oauth2', credentials, sent_to: recipient, message_id: r.id, access_token_preview: accessToken.slice(0, 12) + '…' })
  } catch (e: any) {
    return c.json({ ok: false, provider: 'gmail_oauth2', credentials, step: 'gmail_send', error: e?.message })
  }
})

// Auto-invoice pipeline health — surfaces Gmail OAuth state + recent runs
adminRoutes.get('/health/auto-invoice', async (c) => {
  try {
    const env = c.env as any
    const gmailReady = !!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN)

    const enabledCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as n FROM customers WHERE auto_invoice_enabled = 1'
    ).first<{ n: number }>()

    const lastRun = await c.env.DB.prepare(`
      SELECT action, order_id, invoice_id, new_value, created_at
      FROM invoice_audit_log
      WHERE action LIKE 'auto_invoice_%'
      ORDER BY created_at DESC LIMIT 1
    `).first<any>()

    const lastFailure = await c.env.DB.prepare(`
      SELECT action, order_id, new_value, created_at
      FROM invoice_audit_log
      WHERE action IN ('auto_invoice_error','auto_invoice_email_failed','auto_invoice_gmail_not_configured','auto_invoice_report_timeout')
      ORDER BY created_at DESC LIMIT 1
    `).first<any>()

    const recent = await c.env.DB.prepare(`
      SELECT action, COUNT(*) as n
      FROM invoice_audit_log
      WHERE action LIKE 'auto_invoice_%' AND created_at >= datetime('now','-7 days')
      GROUP BY action ORDER BY n DESC
    `).all()

    // Backlog: reports completed for auto-invoice customers that still have
    // no auto-invoice draft. If this stays non-zero for >15 min in prod,
    // the cron sweep is broken.
    const backlog = await c.env.DB.prepare(`
      SELECT COUNT(*) AS n
      FROM reports r
      JOIN orders o ON o.id = r.order_id
      JOIN customers c ON c.id = o.customer_id
      WHERE r.status = 'completed'
        AND c.auto_invoice_enabled = 1
        AND o.invoice_customer_email IS NOT NULL AND o.invoice_customer_email != ''
        AND NOT EXISTS (
          SELECT 1 FROM invoices i
          WHERE i.order_id = r.order_id AND i.created_by = 'auto-invoice'
        )
    `).first<{ n: number }>()

    return c.json({
      gmail_oauth_ready: gmailReady,
      customers_with_automation: enabledCount?.n ?? 0,
      backlog: backlog?.n ?? 0,
      last_run: lastRun || null,
      last_failure: lastFailure || null,
      last_7d_breakdown: recent.results || []
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// Dashboard stats
adminRoutes.get('/dashboard', async (c) => {
  try {
    // Order stats
    const orderStats = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total_orders,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
      FROM orders
    `).first()

    // Revenue stats (EXCLUDES trial orders + credit-redemption orders).
    // Credit-redemption orders carry a notional $10 price but no money moves
    // — the actual revenue was booked when the credit pack was purchased.
    const revenueStats = await c.env.DB.prepare(`
      SELECT
        SUM(CASE WHEN payment_status = 'paid' AND (is_trial IS NULL OR is_trial = 0) AND (notes IS NULL OR notes NOT LIKE 'Paid via credit balance%') THEN price ELSE 0 END) as total_revenue,
        SUM(CASE WHEN payment_status = 'paid' AND service_tier = 'express' AND (is_trial IS NULL OR is_trial = 0) AND (notes IS NULL OR notes NOT LIKE 'Paid via credit balance%') THEN price ELSE 0 END) as express_revenue,
        SUM(CASE WHEN payment_status = 'paid' AND service_tier = 'standard' AND (is_trial IS NULL OR is_trial = 0) AND (notes IS NULL OR notes NOT LIKE 'Paid via credit balance%') THEN price ELSE 0 END) as standard_revenue,
        SUM(CASE WHEN is_trial = 1 THEN 1 ELSE 0 END) as trial_orders
      FROM orders
    `).first()

    // Tier breakdown
    const tierStats = await c.env.DB.prepare(`
      SELECT service_tier, COUNT(*) as count, SUM(price) as total_value
      FROM orders GROUP BY service_tier
    `).all()

    // Recent orders
    const recentOrders = await c.env.DB.prepare(`
      SELECT o.*, cc.company_name as customer_company_name
      FROM orders o
      LEFT JOIN customer_companies cc ON o.customer_company_id = cc.id
      ORDER BY o.created_at DESC LIMIT 10
    `).all()

    // Customer count (registered platform users — from customers table)
    const customerCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM customers WHERE is_active = 1'
    ).first<{ count: number }>()

    // Customer company count (admin-managed B2B clients)
    const companyCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM customer_companies WHERE is_active = 1'
    ).first<{ count: number }>()

    // Recent activity
    const recentActivity = await c.env.DB.prepare(`
      SELECT * FROM user_activity_log ORDER BY created_at DESC LIMIT 20
    `).all()

    // Report/material stats
    let reportStats: any = {}
    try {
      reportStats = await c.env.DB.prepare(`
        SELECT
          COUNT(*) as total_reports,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_reports,
          AVG(gross_squares) as avg_squares,
          AVG(total_material_cost_cad) as avg_material_cost,
          SUM(total_material_cost_cad) as total_material_value,
          AVG(confidence_score) as avg_confidence,
          SUM(CASE WHEN complexity_class = 'simple' THEN 1 ELSE 0 END) as simple_roofs,
          SUM(CASE WHEN complexity_class = 'moderate' THEN 1 ELSE 0 END) as moderate_roofs,
          SUM(CASE WHEN complexity_class = 'complex' THEN 1 ELSE 0 END) as complex_roofs,
          SUM(CASE WHEN complexity_class = 'very_complex' THEN 1 ELSE 0 END) as very_complex_roofs
        FROM reports
      `).first() || {}
    } catch (e) {
      // migration may not have run yet
    }

    return c.json({
      orders: orderStats,
      revenue: revenueStats,
      tiers: tierStats.results,
      recent_orders: recentOrders.results,
      customer_count: customerCount?.count || 0,
      company_count: companyCount?.count || 0,
      recent_activity: recentActivity.results,
      report_stats: reportStats
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to load dashboard', details: err.message }, 500)
  }
})

// ============================================================
// MATERIAL PREFERENCES — Company-level defaults for BOM engine
// ============================================================
adminRoutes.get('/material-preferences', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT material_preferences FROM master_companies WHERE id = 1'
  ).first<any>()
  const defaults = {
    shingle_type: 'architectural',
    waste_factor_pct: 15,
    include_ventilation: true,
    include_pipe_boots: true,
    tax_rate: 0.05,
  }
  let prefs = defaults
  let proposalPricing = null
  if (row?.material_preferences) {
    try {
      const parsed = JSON.parse(row.material_preferences)
      prefs = { ...defaults, ...parsed }
      proposalPricing = parsed.proposal_pricing || null
    } catch {}
  }
  if (proposalPricing) prefs.proposal_pricing = proposalPricing
  return c.json({ preferences: prefs })
})

adminRoutes.put('/material-preferences', async (c) => {
  const body = await c.req.json()
  const allowed = ['shingle_type', 'waste_factor_pct', 'include_ventilation', 'include_pipe_boots', 'tax_rate']
  const prefs: any = { _saved: true }
  for (const key of allowed) {
    if (body[key] !== undefined) prefs[key] = body[key]
  }
  await c.env.DB.prepare(
    "UPDATE master_companies SET material_preferences = ?, updated_at = datetime('now') WHERE id = 1"
  ).bind(JSON.stringify(prefs)).run()
  return c.json({ success: true, preferences: prefs })
})

// ============================================================
// PROPOSAL PRICING PRESETS — Stored inside material_preferences JSON
// ============================================================
adminRoutes.get('/proposal-pricing', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT material_preferences FROM master_companies WHERE id = 1'
  ).first<any>()
  const defaults = {
    pricing_mode: 'markup',
    markup_percent: 30,
    price_per_square: 350,
    price_per_bundle: 125,
    include_labor: true,
    labor_per_square: 180,
    include_tearoff: true,
    tearoff_per_square: 45,
    // Full per-unit price sheet for "bundle pricing" mode — engine
    // multiplies these against the report's material take-off to
    // auto-generate proposal line items.
    material_unit_prices: {
      shingle_bundle: 42,
      underlayment_roll: 110,
      ice_water_roll: 90,
      ridge_cap_bundle: 65,
      drip_edge_lf: 1.75,
      starter_strip_lf: 1.25,
      valley_flashing_lf: 3.25,
      step_flashing_lf: 0.85,
      headwall_flashing_lf: 1.40,
      chimney_flashing_kit: 65,
      pipe_boot_each: 12,
      gutter_lf: 4.50,
      nails_box: 48,
      caulk_tube: 8,
      labor_per_square: 180,
      tearoff_per_square: 45,
      dumpster_flat: 450,
      dumpster_sqft_per_unit: 3000,
      tax_rate: 0.05,
    },
  }
  let presets = defaults
  if (row?.material_preferences) {
    try {
      const parsed = JSON.parse(row.material_preferences)
      presets = { ...defaults, ...(parsed.proposal_pricing || {}) }
    } catch {}
  }
  return c.json({ presets })
})

adminRoutes.put('/proposal-pricing', async (c) => {
  const body = await c.req.json()
  const allowed = ['pricing_mode', 'markup_percent', 'price_per_square', 'price_per_bundle', 'include_labor', 'labor_per_square', 'include_tearoff', 'tearoff_per_square']
  const presets: any = {}
  for (const key of allowed) {
    if (body[key] !== undefined) presets[key] = body[key]
  }
  if (body.material_unit_prices && typeof body.material_unit_prices === 'object') {
    const mupAllowed = ['shingle_bundle', 'underlayment_roll', 'ice_water_roll', 'ridge_cap_bundle',
      'drip_edge_lf', 'starter_strip_lf', 'valley_flashing_lf',
      'step_flashing_lf', 'headwall_flashing_lf', 'chimney_flashing_kit', 'pipe_boot_each',
      'gutter_lf',
      'nails_box', 'caulk_tube',
      'labor_per_square', 'tearoff_per_square', 'dumpster_flat', 'dumpster_sqft_per_unit', 'tax_rate']
    const mup: any = {}
    for (const k of mupAllowed) {
      const v = body.material_unit_prices[k]
      if (v !== undefined && v !== null && !isNaN(Number(v))) mup[k] = Number(v)
    }
    presets.material_unit_prices = mup
  }

  // Read existing material_preferences and merge proposal_pricing into it
  const row = await c.env.DB.prepare(
    'SELECT material_preferences FROM master_companies WHERE id = 1'
  ).first<any>()
  let existing: any = {}
  if (row?.material_preferences) {
    try { existing = JSON.parse(row.material_preferences) } catch {}
  }
  existing.proposal_pricing = presets

  await c.env.DB.prepare(
    "UPDATE master_companies SET material_preferences = ?, updated_at = datetime('now') WHERE id = 1"
  ).bind(JSON.stringify(existing)).run()
  return c.json({ success: true, presets })
})

// ============================================================
// INIT-DB — Protected: requires valid admin session
// In production, use D1 migrations instead.
// This endpoint is kept for dev/emergency recovery only.
// ============================================================
adminRoutes.post('/init-db', async (c) => {
  // Require admin auth for schema initialization
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) {
    return c.json({ error: 'Superadmin authentication required for database initialization' }, 403)
  }

  try {
    // Create tables if they don't exist
    const schema = `
      CREATE TABLE IF NOT EXISTS master_companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_name TEXT NOT NULL,
        contact_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT, address TEXT, city TEXT, province TEXT, postal_code TEXT,
        logo_url TEXT, api_key TEXT UNIQUE, is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS customer_companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        master_company_id INTEGER NOT NULL,
        company_name TEXT NOT NULL, contact_name TEXT NOT NULL, email TEXT NOT NULL,
        phone TEXT, address TEXT, city TEXT, province TEXT, postal_code TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (master_company_id) REFERENCES master_companies(id)
      );
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_number TEXT UNIQUE NOT NULL,
        master_company_id INTEGER NOT NULL,
        customer_company_id INTEGER,
        property_address TEXT NOT NULL, property_city TEXT, property_province TEXT, property_postal_code TEXT,
        latitude REAL, longitude REAL,
        homeowner_name TEXT NOT NULL, homeowner_phone TEXT, homeowner_email TEXT,
        requester_name TEXT NOT NULL, requester_company TEXT, requester_email TEXT, requester_phone TEXT,
        service_tier TEXT NOT NULL, price REAL NOT NULL,
        status TEXT DEFAULT 'pending', payment_status TEXT DEFAULT 'unpaid',
        payment_intent_id TEXT, estimated_delivery TEXT, delivered_at TEXT, notes TEXT,
        roof_trace_json TEXT, price_per_bundle REAL,
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (master_company_id) REFERENCES master_companies(id),
        FOREIGN KEY (customer_company_id) REFERENCES customer_companies(id)
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL UNIQUE,
        roof_area_sqft REAL, roof_area_sqm REAL, roof_pitch_degrees REAL,
        roof_azimuth_degrees REAL, max_sunshine_hours REAL, num_panels_possible INTEGER,
        yearly_energy_kwh REAL, roof_segments TEXT, satellite_image_url TEXT,
        dsm_image_url TEXT, mask_image_url TEXT, report_pdf_url TEXT, report_html TEXT,
        api_response_raw TEXT,
        status TEXT DEFAULT 'pending', error_message TEXT,
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (order_id) REFERENCES orders(id)
      );
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        stripe_payment_intent_id TEXT, amount REAL NOT NULL, currency TEXT DEFAULT 'CAD',
        status TEXT DEFAULT 'pending', payment_method TEXT, receipt_url TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (order_id) REFERENCES orders(id)
      );
      CREATE TABLE IF NOT EXISTS api_requests_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER, request_type TEXT NOT NULL, endpoint TEXT,
        request_payload TEXT, response_status INTEGER, response_payload TEXT, duration_ms INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (order_id) REFERENCES orders(id)
      );
      CREATE TABLE IF NOT EXISTS user_activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        company_id INTEGER, action TEXT NOT NULL, details TEXT,
        ip_address TEXT, user_agent TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        master_company_id INTEGER NOT NULL,
        setting_key TEXT NOT NULL, setting_value TEXT, is_encrypted INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (master_company_id) REFERENCES master_companies(id),
        UNIQUE(master_company_id, setting_key)
      );
    `

    // Execute each CREATE TABLE statement
    const statements = schema.split(';').filter(s => s.trim().length > 0)
    for (const stmt of statements) {
      await c.env.DB.prepare(stmt).run()
    }

    // Create indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)',
      'CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number)',
      'CREATE INDEX IF NOT EXISTS idx_reports_order ON reports(order_id)',
      'CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id)',
    ]
    for (const idx of indexes) {
      await c.env.DB.prepare(idx).run()
    }

    // Migration 0003: Edge measurements, materials, quality columns
    const migration0003Cols = [
      'edge_measurements TEXT', 'total_ridge_ft REAL', 'total_hip_ft REAL',
      'total_valley_ft REAL', 'total_eave_ft REAL', 'total_rake_ft REAL',
      'material_estimate TEXT', 'gross_squares REAL', 'bundle_count INTEGER',
      'total_material_cost_cad REAL', 'complexity_class TEXT',
      'imagery_quality TEXT', 'imagery_date TEXT', 'confidence_score INTEGER',
      'field_verification_recommended INTEGER DEFAULT 0',
      'professional_report_html TEXT', 'report_version TEXT DEFAULT \'2.0\'',
      'roof_footprint_sqft REAL', 'roof_footprint_sqm REAL', 'area_multiplier REAL',
      'roof_pitch_ratio TEXT'
    ]
    for (const col of migration0003Cols) {
      try { await c.env.DB.prepare(`ALTER TABLE reports ADD COLUMN ${col}`).run() } catch(e) {}
    }

    // Migration 0004: AI Measurement Engine columns
    const migration0004Cols = [
      'ai_measurement_json TEXT', 'ai_report_json TEXT', 'ai_satellite_url TEXT',
      'ai_analyzed_at TEXT', "ai_status TEXT DEFAULT 'pending'", 'ai_error TEXT'
    ]
    for (const col of migration0004Cols) {
      try { await c.env.DB.prepare(`ALTER TABLE reports ADD COLUMN ${col}`).run() } catch(e) {}
    }

    // Migration 0004b: Report generation state machine columns
    const migration0004bCols = [
      'generation_attempts INTEGER DEFAULT 0',
      'generation_started_at TEXT',
      'generation_completed_at TEXT'
    ]
    for (const col of migration0004bCols) {
      try { await c.env.DB.prepare(`ALTER TABLE reports ADD COLUMN ${col}`).run() } catch(e) {}
    }

    // Migration 0005: Authentication system
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT DEFAULT 'admin' CHECK(role IN ('superadmin', 'admin', 'staff')),
        company_name TEXT,
        phone TEXT,
        is_active INTEGER DEFAULT 1,
        last_login TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `).run()
    try { await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email)').run() } catch(e) {}

    // Migration 0005b: Admin sessions table (secure session management)
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS admin_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id INTEGER NOT NULL,
        session_token TEXT UNIQUE NOT NULL,
        expires_at TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
      )
    `).run()
    try { await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_admin_sessions_token ON admin_sessions(session_token)').run() } catch(e) {}
    try { await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin ON admin_sessions(admin_id)').run() } catch(e) {}

    // Migration 0006: Customer Portal, Invoices & Sales Tracking
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, phone TEXT, company_name TEXT,
        google_id TEXT UNIQUE, google_avatar TEXT, password_hash TEXT,
        address TEXT, city TEXT, province TEXT, postal_code TEXT,
        is_active INTEGER DEFAULT 1, email_verified INTEGER DEFAULT 0,
        last_login TEXT, notes TEXT, tags TEXT,
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
      )
    `).run()

    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_number TEXT UNIQUE NOT NULL, customer_id INTEGER NOT NULL,
        order_id INTEGER, subtotal REAL DEFAULT 0, tax_rate REAL DEFAULT 5.0,
        tax_amount REAL DEFAULT 0, discount_amount REAL DEFAULT 0,
        total REAL DEFAULT 0, currency TEXT DEFAULT 'CAD',
        status TEXT DEFAULT 'draft', issue_date TEXT DEFAULT (date('now')),
        due_date TEXT, paid_date TEXT, sent_date TEXT,
        payment_method TEXT, payment_reference TEXT, notes TEXT,
        terms TEXT DEFAULT 'Payment due within 30 days of invoice date.',
        created_by TEXT, created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (order_id) REFERENCES orders(id)
      )
    `).run()

    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS invoice_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL, description TEXT NOT NULL,
        quantity REAL DEFAULT 1, unit_price REAL DEFAULT 0,
        amount REAL DEFAULT 0, sort_order INTEGER DEFAULT 0,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      )
    `).run()

    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS customer_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL, session_token TEXT UNIQUE NOT NULL,
        expires_at TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
      )
    `).run()

    // Add customer_id to orders if not present
    try { await c.env.DB.prepare('ALTER TABLE orders ADD COLUMN customer_id INTEGER REFERENCES customers(id)').run() } catch(e) {}

    // Migration 0007: Customer credits & Stripe/Square columns
    const customerCreditCols = [
      'report_credits INTEGER DEFAULT 0',
      'credits_used INTEGER DEFAULT 0',
      'stripe_customer_id TEXT',
      'square_customer_id TEXT',
      'subscription_plan TEXT DEFAULT \'free\'',
      'subscription_status TEXT',
      'subscription_start TEXT',
      'subscription_end TEXT'
    ]
    for (const col of customerCreditCols) {
      try { await c.env.DB.prepare(`ALTER TABLE customers ADD COLUMN ${col}`).run() } catch(e) {}
    }

    // Migration 0008: Free trial tracking (separate from paid credits)
    const trialCols = [
      'free_trial_total INTEGER DEFAULT 3',
      'free_trial_used INTEGER DEFAULT 0'
    ]
    for (const col of trialCols) {
      try { await c.env.DB.prepare(`ALTER TABLE customers ADD COLUMN ${col}`).run() } catch(e) {}
    }

    // Migration: Trial + subscription tracking columns
    const trialSubCols = [
      'trial_ends_at TEXT',
      'subscription_price_cents INTEGER DEFAULT 0',
      'lead_source TEXT',
      'lead_utm_source TEXT'
    ]
    for (const col of trialSubCols) {
      try { await c.env.DB.prepare(`ALTER TABLE customers ADD COLUMN ${col}`).run() } catch(e) {}
    }

    // Migration 0009: Trial flag on orders (so admin can filter trial vs paid)
    try { await c.env.DB.prepare('ALTER TABLE orders ADD COLUMN is_trial INTEGER DEFAULT 0').run() } catch(e) {}

    // Migration 0012: Custom Branding columns on customers table
    const brandingCols = [
      'brand_business_name TEXT',
      'brand_logo_url TEXT',
      'brand_primary_color TEXT DEFAULT \'#1e3a5f\'',
      'brand_secondary_color TEXT DEFAULT \'#0ea5e9\'',
      'brand_tagline TEXT',
      'brand_phone TEXT',
      'brand_email TEXT',
      'brand_website TEXT',
      'brand_address TEXT',
      'brand_license_number TEXT',
      'brand_insurance_info TEXT',
      'ad_facebook_connected INTEGER DEFAULT 0',
      'ad_facebook_page_id TEXT',
      'ad_google_connected INTEGER DEFAULT 0',
      'ad_google_account_id TEXT',
      'ad_meta_pixel_id TEXT',
      'ad_google_analytics_id TEXT'
    ]
    for (const col of brandingCols) {
      try { await c.env.DB.prepare(`ALTER TABLE customers ADD COLUMN ${col}`).run() } catch(e) {}
    }

    // Migration 0010: Remove old CHECK constraint on service_tier
    // RETIRED — This migration was for the initial schema transition.
    // Both local and production databases already use the new schema.
    // No DROP TABLE or destructive operations remain in init-db.
    // Kept as comment for historical reference only.

    // Square tables (current payment processor)
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS square_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        square_order_id TEXT,
        square_payment_id TEXT,
        square_payment_link_id TEXT,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'cad',
        status TEXT DEFAULT 'pending',
        payment_type TEXT DEFAULT 'credit_pack',
        description TEXT,
        order_id INTEGER,
        metadata_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (order_id) REFERENCES orders(id)
      )
    `).run()

    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS square_webhook_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        square_event_id TEXT UNIQUE NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT,
        processed INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `).run()

    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS credit_packages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL, description TEXT,
        credits INTEGER NOT NULL, price_cents INTEGER NOT NULL,
        is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `).run()

    // Seed default credit packages — only if table is empty (never delete existing data)
    // Pricing v5 (CAD): 10=$7.50/ea, 25=$7.00/ea, 50=$6.50/ea, 100=$5.95/ea
    const pkgCount = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM credit_packages').first<any>()
    if (!pkgCount?.cnt || pkgCount.cnt === 0) {
      await c.env.DB.prepare(`
        INSERT INTO credit_packages (id, name, description, credits, price_cents, sort_order)
        VALUES
          (1, '10-Pack', '10 reports — $7.50/each (save 6%)', 10, 7500, 1),
          (2, '25-Pack', '25 reports — $7.00/each (save 13%)', 25, 17500, 2),
          (3, '50-Pack', '50 reports — $6.50/each (save 19%)', 50, 32500, 3),
          (4, '100-Pack', '100 reports — $5.95/each (save 26%)', 100, 59500, 4)
      `).run()
    }

    // Customer portal indexes
    const custIndexes = [
      'CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email)',
      'CREATE INDEX IF NOT EXISTS idx_customers_google_id ON customers(google_id)',
      'CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id)',
      'CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)',
      'CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id)',
      'CREATE INDEX IF NOT EXISTS idx_customer_sessions_token ON customer_sessions(session_token)',
      'CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id)'
    ]
    for (const idx of custIndexes) {
      try { await c.env.DB.prepare(idx).run() } catch(e) {}
    }

    // ============================================================
    // Migration 0011: CRM Module — Business Customers, Invoices, Proposals, Jobs
    // These are the USER'S business customers (homeowners/leads), NOT platform customers
    // ============================================================
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS crm_customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        name TEXT NOT NULL, email TEXT, phone TEXT, company TEXT,
        address TEXT, city TEXT, province TEXT, postal_code TEXT,
        status TEXT DEFAULT 'active', source TEXT,
        notes TEXT, tags TEXT,
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (owner_id) REFERENCES customers(id)
      )
    `).run()

    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS crm_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        crm_customer_id INTEGER NOT NULL,
        invoice_number TEXT UNIQUE NOT NULL,
        subtotal REAL DEFAULT 0, tax_rate REAL DEFAULT 5.0,
        tax_amount REAL DEFAULT 0, total REAL DEFAULT 0,
        currency TEXT DEFAULT 'CAD',
        status TEXT DEFAULT 'draft',
        issue_date TEXT DEFAULT (date('now')), due_date TEXT, paid_date TEXT, sent_date TEXT,
        payment_method TEXT, notes TEXT,
        terms TEXT DEFAULT 'Payment due within 30 days.',
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (owner_id) REFERENCES customers(id),
        FOREIGN KEY (crm_customer_id) REFERENCES crm_customers(id)
      )
    `).run()

    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS crm_invoice_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL,
        description TEXT NOT NULL, quantity REAL DEFAULT 1, unit_price REAL DEFAULT 0,
        amount REAL DEFAULT 0, sort_order INTEGER DEFAULT 0,
        FOREIGN KEY (invoice_id) REFERENCES crm_invoices(id) ON DELETE CASCADE
      )
    `).run()

    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS crm_proposals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        crm_customer_id INTEGER NOT NULL,
        proposal_number TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL, property_address TEXT,
        scope_of_work TEXT, materials_detail TEXT,
        labor_cost REAL DEFAULT 0, material_cost REAL DEFAULT 0, other_cost REAL DEFAULT 0,
        total_amount REAL DEFAULT 0,
        status TEXT DEFAULT 'draft',
        valid_until TEXT, notes TEXT,
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (owner_id) REFERENCES customers(id),
        FOREIGN KEY (crm_customer_id) REFERENCES crm_customers(id)
      )
    `).run()

    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS crm_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        crm_customer_id INTEGER,
        proposal_id INTEGER,
        job_number TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL, property_address TEXT,
        job_type TEXT DEFAULT 'install',
        scheduled_date TEXT NOT NULL, scheduled_time TEXT,
        estimated_duration TEXT, crew_size INTEGER,
        status TEXT DEFAULT 'scheduled',
        completed_date TEXT, notes TEXT,
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (owner_id) REFERENCES customers(id),
        FOREIGN KEY (crm_customer_id) REFERENCES crm_customers(id),
        FOREIGN KEY (proposal_id) REFERENCES crm_proposals(id)
      )
    `).run()

    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS crm_job_checklist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL,
        item_type TEXT NOT NULL,
        label TEXT NOT NULL,
        is_completed INTEGER DEFAULT 0,
        completed_at TEXT, notes TEXT,
        sort_order INTEGER DEFAULT 0,
        FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE
      )
    `).run()

    const crmIndexes = [
      'CREATE INDEX IF NOT EXISTS idx_crm_customers_owner ON crm_customers(owner_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_invoices_owner ON crm_invoices(owner_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_invoices_customer ON crm_invoices(crm_customer_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_invoices_status ON crm_invoices(status)',
      'CREATE INDEX IF NOT EXISTS idx_crm_proposals_owner ON crm_proposals(owner_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_proposals_status ON crm_proposals(status)',
      'CREATE INDEX IF NOT EXISTS idx_crm_jobs_owner ON crm_jobs(owner_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_jobs_date ON crm_jobs(scheduled_date)',
      'CREATE INDEX IF NOT EXISTS idx_crm_jobs_status ON crm_jobs(status)',
      'CREATE INDEX IF NOT EXISTS idx_crm_job_checklist_job ON crm_job_checklist(job_id)'
    ]

    // Migration 0013: Email verification codes table
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS email_verification_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        code TEXT NOT NULL,
        verification_token TEXT,
        used INTEGER DEFAULT 0,
        verified_at TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `).run()
    try { await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_verification_codes_email ON email_verification_codes(email)').run() } catch(e) {}
    try { await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_verification_codes_token ON email_verification_codes(verification_token)').run() } catch(e) {}

    // Migration 0012: Proposal view tracking columns
    const proposalTrackingCols = [
      'view_count INTEGER DEFAULT 0',
      'last_viewed_at TEXT',
      'share_token TEXT',
      'sent_at TEXT'
    ]
    for (const col of proposalTrackingCols) {
      try { await c.env.DB.prepare(`ALTER TABLE crm_proposals ADD COLUMN ${col}`).run() } catch(e) {}
    }
    try { await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_crm_proposals_share_token ON crm_proposals(share_token)').run() } catch(e) {}
    for (const idx of crmIndexes) {
      try { await c.env.DB.prepare(idx).run() } catch(e) {}
    }

    // Migration 0014: Enhanced invoice/proposal columns + Square payment links + Webhook logs
    const invoiceExtraCols = [
      'document_type TEXT DEFAULT \'invoice\'',
      'scope_of_work TEXT DEFAULT \'\'',
      'warranty_terms TEXT DEFAULT \'\'',
      'payment_terms_text TEXT DEFAULT \'\'',
      'valid_until TEXT DEFAULT \'\'',
      'attached_report_id INTEGER',
      'share_token TEXT',
      'viewed_at TEXT',
      'viewed_count INTEGER DEFAULT 0',
      'proposal_tier TEXT DEFAULT \'\'',
      'proposal_group_id TEXT DEFAULT \'\'',
      'discount_type TEXT DEFAULT \'fixed\''
    ]
    for (const col of invoiceExtraCols) {
      try { await c.env.DB.prepare(`ALTER TABLE invoices ADD COLUMN ${col}`).run() } catch(e) {}
    }
    try { await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_invoices_share_token ON invoices(share_token)').run() } catch(e) {}
    try { await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_invoices_doc_type ON invoices(document_type)').run() } catch(e) {}

    // Add extra columns to invoice_items (unit, is_taxable, category)
    const invoiceItemExtraCols = [
      'unit TEXT DEFAULT \'each\'',
      'is_taxable INTEGER DEFAULT 1',
      'category TEXT DEFAULT \'\''
    ]
    for (const col of invoiceItemExtraCols) {
      try { await c.env.DB.prepare(`ALTER TABLE invoice_items ADD COLUMN ${col}`).run() } catch(e) {}
    }

    // Square Payment Links table (for Invoice Manager → Square checkout)
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS square_payment_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL,
        payment_link_id TEXT,
        payment_link_url TEXT,
        order_id TEXT,
        amount_cents INTEGER,
        currency TEXT DEFAULT 'CAD',
        status TEXT DEFAULT 'created',
        transaction_id TEXT,
        receipt_url TEXT,
        paid_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (invoice_id) REFERENCES invoices(id)
      )
    `).run()
    try { await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_sq_pay_links_invoice ON square_payment_links(invoice_id)').run() } catch(e) {}
    try { await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_sq_pay_links_order ON square_payment_links(order_id)').run() } catch(e) {}

    // Webhook logs table (for Square payment confirmations)
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS webhook_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT DEFAULT 'square',
        event_type TEXT,
        event_id TEXT,
        payload TEXT,
        processed INTEGER DEFAULT 0,
        invoice_id INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `).run()
    try { await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_webhook_logs_event ON webhook_logs(event_id)').run() } catch(e) {}
    try { await c.env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_webhook_logs_invoice ON webhook_logs(invoice_id)').run() } catch(e) {}

    return c.json({ success: true, message: 'Database initialized successfully' })
  } catch (err: any) {
    return c.json({ error: 'Failed to initialize database', details: err.message }, 500)
  }
})

// ============================================================
// SUPER ADMIN DASHBOARD ENDPOINTS
// ============================================================

// 1. All Active Users — full user list with account info
// GET /superadmin/people — Unified people directory: platform users + CRM customers + prospects
adminRoutes.get('/superadmin/people', async (c) => {
  const admin = c.get('admin' as any)
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  try {
    const search = c.req.query('search') || ''
    const typeFilter = c.req.query('type') || '' // platform_user, crm_customer, prospect
    const limit = parseInt(c.req.query('limit') || '50')
    const people: any[] = []

    // Probe customer_login_events; older local DBs may not have migration 0214 applied yet.
    let hasLoginEvents = true
    try { await c.env.DB.prepare(`SELECT 1 FROM customer_login_events LIMIT 1`).first() }
    catch { hasLoginEvents = false }
    const loginCountSql = hasLoginEvents
      ? `, (SELECT COUNT(*) FROM customer_login_events WHERE customer_id = customers.id) as login_count`
      : `, 0 as login_count`

    // 1. Platform users (customers table)
    if (!typeFilter || typeFilter === 'platform_user') {
      const q = search
        ? `SELECT id, name, email, phone, company_name, 'platform_user' as person_type, created_at, is_active, last_login${loginCountSql}
           FROM customers WHERE name LIKE ? OR email LIKE ? OR phone LIKE ? OR company_name LIKE ?
           ORDER BY created_at DESC LIMIT ?`
        : `SELECT id, name, email, phone, company_name, 'platform_user' as person_type, created_at, is_active, last_login${loginCountSql}
           FROM customers ORDER BY created_at DESC LIMIT ?`
      const res = search
        ? await c.env.DB.prepare(q).bind(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, limit).all()
        : await c.env.DB.prepare(q).bind(limit).all()
      for (const r of (res.results || [])) people.push(r)
    }

    // 2. CRM customers (homeowners owned by platform customers)
    if (!typeFilter || typeFilter === 'crm_customer') {
      try {
        const q = search
          ? `SELECT cc.id, cc.name, cc.email, cc.phone, cc.company, 'crm_customer' as person_type, cc.created_at, cc.status,
               c.company_name as owner_company
             FROM crm_customers cc LEFT JOIN customers c ON c.id = cc.owner_id
             WHERE cc.name LIKE ? OR cc.email LIKE ? OR cc.phone LIKE ? OR cc.address LIKE ?
             ORDER BY cc.created_at DESC LIMIT ?`
          : `SELECT cc.id, cc.name, cc.email, cc.phone, cc.company, 'crm_customer' as person_type, cc.created_at, cc.status,
               c.company_name as owner_company
             FROM crm_customers cc LEFT JOIN customers c ON c.id = cc.owner_id
             ORDER BY cc.created_at DESC LIMIT ?`
        const res = search
          ? await c.env.DB.prepare(q).bind(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, limit).all()
          : await c.env.DB.prepare(q).bind(limit).all()
        for (const r of (res.results || [])) people.push(r)
      } catch (e) { /* crm_customers table may not exist */ }
    }

    // 3. Cold-call prospects
    if (!typeFilter || typeFilter === 'prospect') {
      try {
        const q = search
          ? `SELECT id, contact_name as name, email, phone, company_name as company, 'prospect' as person_type, created_at, status
             FROM cc_prospects WHERE contact_name LIKE ? OR email LIKE ? OR phone LIKE ? OR company_name LIKE ?
             ORDER BY created_at DESC LIMIT ?`
          : `SELECT id, contact_name as name, email, phone, company_name as company, 'prospect' as person_type, created_at, status
             FROM cc_prospects ORDER BY created_at DESC LIMIT ?`
        const res = search
          ? await c.env.DB.prepare(q).bind(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, limit).all()
          : await c.env.DB.prepare(q).bind(limit).all()
        for (const r of (res.results || [])) people.push(r)
      } catch (e) { /* cc_prospects table may not exist */ }
    }

    // Sort by created_at descending
    people.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))

    return c.json({ people: people.slice(0, limit), total: people.length })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// GET /superadmin/person/:type/:id — Detail for a single row in the People
// Directory, used by the inline slide-over panel (Phase 4 #15). Mirrors the
// three person_type buckets returned by /superadmin/people.
adminRoutes.get('/superadmin/person/:type/:id', async (c) => {
  const admin = c.get('admin' as any)
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  const type = c.req.param('type')
  const id = parseInt(c.req.param('id'), 10)
  if (!id || id <= 0) return c.json({ error: 'Invalid id' }, 400)
  try {
    if (type === 'platform_user') {
      const cust = await c.env.DB.prepare(
        `SELECT id, name, email, phone, company_name, company_size, primary_use,
                address, city, province, postal_code,
                lead_source, lead_utm_source, referral_code, referred_by,
                google_id, google_avatar, is_active, last_login, created_at,
                free_trial_used, free_trial_total, report_credits, credits_used
           FROM customers WHERE id = ?`
      ).bind(id).first<any>()
      if (!cust) return c.json({ error: 'Not found' }, 404)
      const stats = await c.env.DB.prepare(
        `SELECT
            (SELECT COUNT(*) FROM orders WHERE customer_id = ?) as order_count,
            (SELECT COUNT(*) FROM orders WHERE customer_id = ? AND status = 'completed') as completed_orders,
            (SELECT COUNT(*) FROM orders WHERE customer_id = ? AND is_trial = 1) as trial_orders,
            (SELECT COALESCE(SUM(price), 0) FROM orders WHERE customer_id = ? AND payment_status = 'paid') as total_paid,
            (SELECT MAX(created_at) FROM orders WHERE customer_id = ?) as last_order_at,
            (SELECT COUNT(*) FROM invoices WHERE customer_id = ?) as invoice_count,
            (SELECT COUNT(*) FROM secretary_subscriptions WHERE customer_id = ? AND status IN ('active','trialing')) as active_secretary_subs`
      ).bind(id, id, id, id, id, id, id).first<any>()
      const recentOrders = await c.env.DB.prepare(
        `SELECT id, order_number, property_address, status, price, created_at
           FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 5`
      ).bind(id).all<any>()
      return c.json({ type, customer: cust, stats: stats || {}, recent_orders: recentOrders.results || [] })
    }
    if (type === 'crm_customer') {
      try {
        const row = await c.env.DB.prepare(
          `SELECT cc.id, cc.name, cc.email, cc.phone, cc.company, cc.address,
                  cc.status, cc.created_at, cc.owner_id,
                  c.name as owner_name, c.email as owner_email, c.company_name as owner_company
             FROM crm_customers cc LEFT JOIN customers c ON c.id = cc.owner_id
            WHERE cc.id = ?`
        ).bind(id).first<any>()
        if (!row) return c.json({ error: 'Not found' }, 404)
        return c.json({ type, customer: row, stats: {}, recent_orders: [] })
      } catch (e: any) {
        return c.json({ error: 'crm_customers table unavailable' }, 404)
      }
    }
    if (type === 'prospect') {
      try {
        const row = await c.env.DB.prepare(
          `SELECT id, contact_name as name, email, phone, company_name as company,
                  status, created_at
             FROM cc_prospects WHERE id = ?`
        ).bind(id).first<any>()
        if (!row) return c.json({ error: 'Not found' }, 404)
        return c.json({ type, customer: row, stats: {}, recent_orders: [] })
      } catch (e: any) {
        return c.json({ error: 'cc_prospects table unavailable' }, 404)
      }
    }
    return c.json({ error: 'Invalid type' }, 400)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

adminRoutes.get('/superadmin/users', async (c) => {
  const admin = c.get('admin' as any)
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  try {
    // Each customer gets one row, labeled `team_member` when an active
    // team_members membership exists — prevents the previous duplicate
    // (owner + team_member) rows and ensures the team badge actually shows.
    // D1 rejects result sets with too many columns, so we select explicitly.
    const users = await c.env.DB.prepare(`
      SELECT
        c.id, c.email, c.name, c.phone, c.company_name,
        c.company_size, c.primary_use,
        c.address, c.city, c.province, c.postal_code,
        c.email_verified,
        c.referral_code, c.referred_by,
        ref.name as referred_by_name, ref.email as referred_by_email,
        c.lead_source, c.lead_utm_source,
        c.google_id, c.google_avatar,
        c.is_active, c.last_login, c.created_at,
        (SELECT COUNT(*) FROM customer_login_events e
         WHERE e.customer_id = c.id) as login_count,
        (SELECT COUNT(*) FROM customer_login_events e
         WHERE e.customer_id = c.id AND date(e.created_at) = date('now')) as login_count_today,
        c.free_trial_used, c.free_trial_total,
        c.report_credits, c.credits_used,
        CASE WHEN tm.id IS NOT NULL THEN 'team_member' ELSE 'owner' END as user_type,
        tm.id as team_member_id,
        tm.role as team_role,
        tm.owner_id as team_owner_id,
        owner.name as team_owner_name,
        owner.email as team_owner_email,
        owner.company_name as team_owner_company,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) as order_count,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.is_trial = 1) as trial_orders,
        (SELECT COALESCE(SUM(o.price), 0) FROM orders o WHERE o.customer_id = c.id AND o.payment_status = 'paid' AND (o.is_trial IS NULL OR o.is_trial = 0) AND (o.notes IS NULL OR o.notes NOT LIKE 'Paid via credit balance%'))
          + (SELECT COALESCE(SUM(mp.amount), 0) FROM manual_payments mp WHERE mp.customer_id = c.id) as total_spent,
        (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id = c.id) as last_order_date,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status = 'completed') as completed_reports,
        -- Total time spent on platform across all modules. user_activity_daily is a
        -- forever-kept rollup (user_module_visits is purged after 90d).
        (SELECT COALESCE(SUM(uad.total_seconds), 0) FROM user_activity_daily uad
         WHERE uad.user_type = 'customer' AND uad.user_id = c.id) as total_seconds
      FROM customers c
      LEFT JOIN team_members tm ON tm.member_customer_id = c.id AND tm.status = 'active'
      LEFT JOIN customers owner ON owner.id = tm.owner_id
      LEFT JOIN customers ref ON ref.id = c.referred_by
      ORDER BY c.created_at DESC
    `).all()

    // API key users live in api_accounts (separate from customers). Surface
    // them in the same list so super admin has a single pane to see every
    // paying/consuming entity on the platform.
    let apiAccounts: any = { results: [] }
    try {
      apiAccounts = await c.env.DB.prepare(`
        SELECT
          a.id,
          a.contact_email as email,
          a.company_name as name,
          NULL as phone,
          a.company_name,
          NULL as company_size,
          NULL as primary_use,
          NULL as address,
          NULL as city,
          NULL as province,
          NULL as postal_code,
          NULL as email_verified,
          NULL as referral_code,
          NULL as referred_by,
          NULL as referred_by_name,
          NULL as referred_by_email,
          NULL as lead_source,
          NULL as lead_utm_source,
          NULL as google_id,
          NULL as google_avatar,
          CASE WHEN a.status = 'active' THEN 1 ELSE 0 END as is_active,
          NULL as last_login,
          datetime(a.created_at, 'unixepoch') as created_at,
          0 as login_count,
          0 as login_count_today,
          0 as free_trial_used,
          0 as free_trial_total,
          a.credit_balance as report_credits,
          (SELECT COALESCE(SUM(CASE WHEN delta < 0 THEN -delta ELSE 0 END), 0)
           FROM api_credit_ledger l WHERE l.account_id = a.id) as credits_used,
          'api_account' as user_type,
          NULL as team_member_id,
          NULL as team_role,
          NULL as team_owner_id,
          NULL as team_owner_name,
          NULL as team_owner_email,
          NULL as team_owner_company,
          (SELECT COUNT(*) FROM api_jobs j WHERE j.account_id = a.id) as order_count,
          0 as trial_orders,
          0 as total_spent,
          (SELECT MAX(datetime(j.created_at, 'unixepoch')) FROM api_jobs j WHERE j.account_id = a.id) as last_order_date,
          (SELECT COUNT(*) FROM api_jobs j WHERE j.account_id = a.id AND j.status = 'ready') as completed_reports,
          0 as total_seconds
        FROM api_accounts a
        ORDER BY a.created_at DESC
      `).all()
    } catch (e: any) {
      console.warn('[superadmin/users] api_accounts query failed:', e?.message || e)
    }

    const combinedUsers = [...(users.results || []), ...(apiAccounts.results || [])]

    const summary = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total_users,
        SUM(CASE WHEN is_active = 1 OR is_active IS NULL THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN google_id IS NOT NULL THEN 1 ELSE 0 END) as google_users,
        SUM(CASE WHEN report_credits > 0 OR credits_used > 0 THEN 1 ELSE 0 END) as paying_users,
        SUM(report_credits) as total_credits_available,
        SUM(credits_used) as total_credits_used,
        SUM(free_trial_used) as total_trial_used,
        SUM(free_trial_total) as total_trial_available,
        SUM(CASE WHEN created_at >= date('now', '-7 days') THEN 1 ELSE 0 END) as new_signups_7d,
        SUM(CASE WHEN created_at >= date('now', '-30 days') THEN 1 ELSE 0 END) as new_signups_30d,
        SUM(CASE WHEN last_login IS NULL THEN 1 ELSE 0 END) as never_logged_in,
        SUM(CASE WHEN last_login IS NOT NULL THEN 1 ELSE 0 END) as ever_logged_in
      FROM customers
    `).first()

    const teamMemberCount = (users.results || []).filter((u: any) => u.user_type === 'team_member').length
    const apiAccountCount = (apiAccounts.results || []).length
    const enrichedSummary = {
      ...(summary as any || {}),
      total_users: ((summary as any)?.total_users || 0) + apiAccountCount,
      team_members: teamMemberCount,
      api_accounts: apiAccountCount,
    }

    return c.json({ users: combinedUsers, summary: enrichedSummary })
  } catch (err: any) {
    return c.json({ error: 'Failed to load users', details: err.message }, 500)
  }
})

// 2. Credit Pack Sales — with period filter (daily/weekly/monthly)
adminRoutes.get('/superadmin/sales', async (c) => {
  const admin = c.get('admin' as any)
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  try {
    const period = c.req.query('period') || 'monthly' // daily, weekly, monthly

    let dateFilter = ''
    let groupBy = ''
    let orderBy = ''
    if (period === 'daily') {
      dateFilter = "WHERE sp.created_at >= date('now', '-30 days')"
      groupBy = "strftime('%Y-%m-%d', sp.created_at)"
      orderBy = "period DESC"
    } else if (period === 'weekly') {
      dateFilter = "WHERE sp.created_at >= date('now', '-12 weeks')"
      groupBy = "strftime('%Y-W%W', sp.created_at)"
      orderBy = "period DESC"
    } else {
      dateFilter = "WHERE sp.created_at >= date('now', '-12 months')"
      groupBy = "strftime('%Y-%m', sp.created_at)"
      orderBy = "period DESC"
    }

    // Individual credit pack purchases (from square_payments)
    const salesByPeriod = await c.env.DB.prepare(`
      SELECT ${groupBy} as period,
        COUNT(*) as transactions,
        SUM(sp.amount) as total_cents,
        SUM(CASE WHEN sp.status = 'succeeded' THEN sp.amount ELSE 0 END) as paid_cents
      FROM square_payments sp
      ${dateFilter}
      GROUP BY ${groupBy}
      ORDER BY ${orderBy}
    `).all()

    // Per-report order sales (non-trial). paid_value excludes credit
    // redemptions (those carry a notional $10 with no money moved).
    const orderSalesByPeriod = await c.env.DB.prepare(`
      SELECT ${groupBy.replace(/sp\./g, 'o.')} as period,
        COUNT(*) as orders,
        SUM(o.price) as total_value,
        SUM(CASE WHEN o.payment_status = 'paid' AND (o.notes IS NULL OR o.notes NOT LIKE 'Paid via credit balance%') THEN o.price ELSE 0 END) as paid_value,
        SUM(CASE WHEN o.is_trial = 1 THEN 1 ELSE 0 END) as trial_count
      FROM orders o
      ${dateFilter.replace(/sp\./g, 'o.')}
      GROUP BY ${groupBy.replace(/sp\./g, 'o.')}
      ORDER BY ${orderBy}
    `).all()

    // Credit packages info
    const packages = await c.env.DB.prepare(`
      SELECT * FROM credit_packages WHERE is_active = 1 ORDER BY sort_order
    `).all()

    // Recent individual transactions
    const recentSales = await c.env.DB.prepare(`
      SELECT sp.*, c.name as customer_name, c.email as customer_email, c.company_name
      FROM square_payments sp
      LEFT JOIN customers c ON sp.customer_id = c.id
      ORDER BY sp.created_at DESC
      LIMIT 50
    `).all()

    // Summary totals
    const totals = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total_transactions,
        SUM(amount) as total_cents,
        SUM(CASE WHEN status = 'succeeded' THEN amount ELSE 0 END) as paid_cents
      FROM square_payments
    `).first()

    const orderTotals = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total_orders,
        SUM(price) as total_value,
        SUM(CASE WHEN payment_status = 'paid' AND (is_trial IS NULL OR is_trial = 0) AND (notes IS NULL OR notes NOT LIKE 'Paid via credit balance%') THEN price ELSE 0 END) as paid_value,
        SUM(CASE WHEN is_trial = 1 THEN 1 ELSE 0 END) as trial_orders
      FROM orders
    `).first()

    return c.json({
      period,
      credit_sales_by_period: salesByPeriod.results,
      order_sales_by_period: orderSalesByPeriod.results,
      packages: packages.results,
      recent_sales: recentSales.results,
      credit_totals: totals,
      order_totals: orderTotals
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to load sales', details: err.message }, 500)
  }
})

// 3. Order History & Logistics — with report completion time
adminRoutes.get('/superadmin/orders', async (c) => {
  const admin = c.get('admin' as any)
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  try {
    const limit = parseInt(c.req.query('limit') || '100')
    const offset = parseInt(c.req.query('offset') || '0')
    const status = c.req.query('status') || ''
    const validStatuses = ['pending', 'processing', 'completed', 'failed', 'cancelled']

    const useStatusFilter = status && validStatuses.includes(status)

    const orders = await c.env.DB.prepare(`
      SELECT o.*,
        c.name as customer_name, c.email as customer_email, c.company_name as customer_company,
        r.status as report_status, r.created_at as report_started_at, r.updated_at as report_completed_at,
        r.gross_squares, r.confidence_score, r.complexity_class,
        r.share_token, r.share_view_count, r.share_sent_at,
        (SELECT COUNT(*) FROM report_view_events
           WHERE order_id = o.id
             AND view_type IN ('share','portal','pdf')
             AND is_bot = 0) as view_count,
        (SELECT COUNT(*) FROM report_view_events
           WHERE order_id = o.id
             AND view_type = '3d_tool'
             AND is_bot = 0) as tool_3d_count,
        CASE
          WHEN r.updated_at IS NOT NULL AND r.created_at IS NOT NULL
          THEN CAST((julianday(r.updated_at) - julianday(r.created_at)) * 86400 AS INTEGER)
          ELSE NULL
        END as processing_seconds
      FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN reports r ON r.order_id = o.id
      ${useStatusFilter ? 'WHERE o.status = ?' : ''}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...(useStatusFilter ? [status, limit, offset] : [limit, offset])).all()

    const counts = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
        AVG(price) as avg_price,
        AVG(CASE WHEN COALESCE(is_trial,0) = 0 THEN price END) as avg_price_paid,
        AVG(CASE WHEN COALESCE(is_trial,0) = 1 THEN price END) as avg_price_trial,
        SUM(CASE WHEN is_trial = 1 THEN 1 ELSE 0 END) as trial_orders,
        SUM(CASE WHEN COALESCE(is_trial,0) = 0 THEN 1 ELSE 0 END) as paid_orders,
        SUM(CASE WHEN trace_source = 'self' THEN 1 ELSE 0 END) as self_traced,
        SUM(CASE WHEN trace_source = 'admin' THEN 1 ELSE 0 END) as admin_traced,
        SUM(CASE WHEN trace_source = 'ai_agent' THEN 1 ELSE 0 END) as ai_traced,
        SUM(CASE WHEN trace_source IS NULL AND COALESCE(needs_admin_trace,0) = 0 THEN 1 ELSE 0 END) as no_trace,
        -- needs_trace must match the actual queue (status in processing/pending)
        -- so the sidebar badge agrees with the orders shown in the queue.
        SUM(CASE WHEN COALESCE(needs_admin_trace,0) = 1 AND status IN ('processing','pending') THEN 1 ELSE 0 END) as needs_trace,
        SUM(CASE WHEN trace_source = 'self' AND COALESCE(is_trial,0) = 0 THEN 1 ELSE 0 END) as self_traced_paid,
        COALESCE(SUM(CASE WHEN trace_source = 'self' AND payment_status = 'paid' AND COALESCE(is_trial,0) = 0 AND (notes IS NULL OR notes NOT LIKE 'Paid via credit balance%') THEN price ELSE 0 END), 0) as self_traced_revenue
      FROM orders
    `).first()

    // Average processing time (for completed reports)
    const avgTime = await c.env.DB.prepare(`
      SELECT AVG(
        CAST((julianday(r.updated_at) - julianday(r.created_at)) * 86400 AS INTEGER)
      ) as avg_seconds
      FROM reports r
      WHERE r.status = 'completed' AND r.updated_at IS NOT NULL AND r.created_at IS NOT NULL
    `).first()

    return c.json({
      orders: orders.results,
      counts,
      avg_processing_seconds: avgTime?.avg_seconds || 0,
      limit, offset
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to load orders', details: err.message }, 500)
  }
})

// ============================================================
// GET /superadmin/orders/:id/views
// Per-report view activity for the super-admin drill-down: aggregate counts
// (share / portal / pdf / admin / bot) plus the most recent ~20 events.
// Sourced from `report_view_events` (migration 0216).
// ============================================================
adminRoutes.get('/superadmin/orders/:id/views', async (c) => {
  const admin = c.get('admin' as any)
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  try {
    const orderId = parseInt(c.req.param('id'))
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return c.json({ error: 'Invalid order id' }, 400)
    }
    const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '20'), 100))
    const [summary, events] = await Promise.all([
      getReportViewSummary(c.env.DB, orderId),
      getReportViewEvents(c.env.DB, orderId, limit),
    ])
    return c.json({ summary, events })
  } catch (err: any) {
    return c.json({ error: 'Failed to load report views', details: err.message }, 500)
  }
})

// ============================================================
// SUPER ADMIN NOTIFICATIONS — Persistent feed of order-lifecycle events.
// Source of truth for "did super admin see this order arrive?"; email is
// best-effort and may fail. Rows are inserted by services/admin-notifications.ts
// from every order-creation path (use-credit, square webhook + verify-payment,
// admin POST /api/orders, submit-trace, unmatched-payment branch).
// ============================================================
adminRoutes.get('/superadmin/notifications', async (c) => {
  const admin = c.get('admin' as any)
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  try {
    const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') || '50'), 200))
    const offset = Math.max(0, parseInt(c.req.query('offset') || '0'))
    const unreadOnly = c.req.query('unread') === '1'
    const kind = (c.req.query('kind') || '').trim()
    const validKinds = ['new_order', 'needs_trace', 'trace_completed', 'payment_unmatched']
    const useKindFilter = !!kind && validKinds.includes(kind)

    const where: string[] = []
    const args: any[] = []
    if (unreadOnly) where.push('read_at IS NULL')
    if (useKindFilter) { where.push('kind = ?'); args.push(kind) }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

    const rows = await c.env.DB.prepare(`
      SELECT id, kind, order_id, order_number, customer_id, customer_email,
             property_address, service_tier, price, payment_status, is_trial,
             trace_source, needs_admin_trace, email_status, email_detail,
             severity, read_at, payload_json, created_at
      FROM super_admin_notifications
      ${whereSql}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...args, limit, offset).all()

    const counts = await c.env.DB.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unread,
        SUM(CASE WHEN kind = 'new_order' AND read_at IS NULL THEN 1 ELSE 0 END) AS unread_new_order,
        SUM(CASE WHEN kind = 'needs_trace' AND read_at IS NULL THEN 1 ELSE 0 END) AS unread_needs_trace,
        SUM(CASE WHEN kind = 'trace_completed' AND read_at IS NULL THEN 1 ELSE 0 END) AS unread_trace_completed,
        SUM(CASE WHEN kind = 'payment_unmatched' AND read_at IS NULL THEN 1 ELSE 0 END) AS unread_payment_unmatched,
        SUM(CASE WHEN email_status = 'failed' THEN 1 ELSE 0 END) AS email_failed
      FROM super_admin_notifications
    `).first()

    return c.json({ notifications: rows.results, counts, limit, offset })
  } catch (err: any) {
    return c.json({ error: 'Failed to load notifications', details: err.message }, 500)
  }
})

adminRoutes.post('/superadmin/notifications/:id/read', async (c) => {
  const admin = c.get('admin' as any)
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid notification id' }, 400)
  try {
    const r = await c.env.DB.prepare(
      "UPDATE super_admin_notifications SET read_at = datetime('now') WHERE id = ? AND read_at IS NULL"
    ).bind(id).run()
    return c.json({ success: true, changed: r.meta.changes })
  } catch (err: any) {
    return c.json({ error: 'Failed to mark read', details: err.message }, 500)
  }
})

adminRoutes.post('/superadmin/notifications/read-all', async (c) => {
  const admin = c.get('admin' as any)
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  try {
    let body: any = {}
    try { body = await c.req.json() } catch {}
    const kind = (body?.kind || '').trim()
    const validKinds = ['new_order', 'needs_trace', 'trace_completed', 'payment_unmatched']
    const useKindFilter = !!kind && validKinds.includes(kind)
    const sql = useKindFilter
      ? "UPDATE super_admin_notifications SET read_at = datetime('now') WHERE read_at IS NULL AND kind = ?"
      : "UPDATE super_admin_notifications SET read_at = datetime('now') WHERE read_at IS NULL"
    const r = useKindFilter
      ? await c.env.DB.prepare(sql).bind(kind).run()
      : await c.env.DB.prepare(sql).run()
    return c.json({ success: true, changed: r.meta.changes })
  } catch (err: any) {
    return c.json({ error: 'Failed to mark all read', details: err.message }, 500)
  }
})

// 4. New User Sign-ups — with period filter
adminRoutes.get('/superadmin/signups', async (c) => {
  const admin = c.get('admin' as any)
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  try {
    const period = c.req.query('period') || 'monthly'

    let groupBy = ''
    let dateFilter = ''
    if (period === 'daily') {
      groupBy = "strftime('%Y-%m-%d', created_at)"
      dateFilter = "WHERE created_at >= date('now', '-30 days')"
    } else if (period === 'weekly') {
      groupBy = "strftime('%Y-W%W', created_at)"
      dateFilter = "WHERE created_at >= date('now', '-12 weeks')"
    } else {
      groupBy = "strftime('%Y-%m', created_at)"
      dateFilter = "WHERE created_at >= date('now', '-12 months')"
    }

    const signupsByPeriod = await c.env.DB.prepare(`
      SELECT ${groupBy} as period,
        COUNT(*) as signups,
        SUM(CASE WHEN google_id IS NOT NULL THEN 1 ELSE 0 END) as google_signups,
        SUM(CASE WHEN google_id IS NULL THEN 1 ELSE 0 END) as email_signups
      FROM customers
      ${dateFilter}
      GROUP BY ${groupBy}
      ORDER BY period DESC
    `).all()

    const recentSignups = await c.env.DB.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) as order_count,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.is_trial = 1) as trial_orders
      FROM customers c
      ORDER BY c.created_at DESC
      LIMIT 30
    `).all()

    const summary = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total_all_time,
        SUM(CASE WHEN created_at >= date('now') THEN 1 ELSE 0 END) as today,
        SUM(CASE WHEN created_at >= date('now', '-7 days') THEN 1 ELSE 0 END) as this_week,
        SUM(CASE WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now') THEN 1 ELSE 0 END) as this_month,
        SUM(CASE WHEN google_id IS NOT NULL THEN 1 ELSE 0 END) as google_total,
        SUM(CASE WHEN google_id IS NULL THEN 1 ELSE 0 END) as email_total
      FROM customers
    `).first()

    return c.json({
      period,
      signups_by_period: signupsByPeriod.results,
      recent_signups: recentSignups.results,
      summary
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to load signups', details: err.message }, 500)
  }
})

// 5. Internal Sales & Marketing — proposals, invoices, leads, campaigns
adminRoutes.get('/superadmin/marketing', async (c) => {
  const admin = c.get('admin' as any)
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  try {
    // CRM aggregate across all users
    const crmStats = await c.env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM crm_customers) as total_leads,
        (SELECT COUNT(*) FROM crm_customers WHERE status = 'active') as active_leads,
        (SELECT COUNT(*) FROM crm_proposals) as total_proposals,
        (SELECT COUNT(*) FROM crm_proposals WHERE status = 'draft') as draft_proposals,
        (SELECT COUNT(*) FROM crm_proposals WHERE status = 'sent') as sent_proposals,
        (SELECT COUNT(*) FROM crm_proposals WHERE status = 'sold') as sold_proposals,
        (SELECT COALESCE(SUM(total_amount), 0) FROM crm_proposals WHERE status = 'sold') as sold_value,
        (SELECT COALESCE(SUM(total_amount), 0) FROM crm_proposals) as total_proposal_value,
        (SELECT COUNT(*) FROM crm_invoices) as total_invoices,
        (SELECT COUNT(*) FROM crm_invoices WHERE status = 'paid') as paid_invoices,
        (SELECT COALESCE(SUM(total), 0) FROM crm_invoices WHERE status = 'paid') as paid_invoice_value,
        (SELECT COALESCE(SUM(total), 0) FROM crm_invoices WHERE status IN ('sent','viewed','overdue')) as outstanding_invoice_value,
        (SELECT COUNT(*) FROM crm_jobs) as total_jobs,
        (SELECT COUNT(*) FROM crm_jobs WHERE status = 'scheduled') as scheduled_jobs,
        (SELECT COUNT(*) FROM crm_jobs WHERE status = 'completed') as completed_jobs
    `).first()

    // Platform-level invoice stats (admin invoices, not CRM)
    const platformInvoices = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END) as paid_value,
        SUM(CASE WHEN status IN ('sent','viewed') THEN total ELSE 0 END) as outstanding_value,
        SUM(CASE WHEN status = 'overdue' THEN total ELSE 0 END) as overdue_value
      FROM invoices
    `).first()

    // Recent proposals
    const recentProposals = await c.env.DB.prepare(`
      SELECT p.*, cc.name as customer_name, c.name as owner_name, c.email as owner_email
      FROM crm_proposals p
      LEFT JOIN crm_customers cc ON p.crm_customer_id = cc.id
      LEFT JOIN customers c ON p.owner_id = c.id
      ORDER BY p.created_at DESC LIMIT 20
    `).all()

    // Recent CRM invoices
    const recentInvoices = await c.env.DB.prepare(`
      SELECT i.*, cc.name as customer_name, c.name as owner_name
      FROM crm_invoices i
      LEFT JOIN crm_customers cc ON i.crm_customer_id = cc.id
      LEFT JOIN customers c ON i.owner_id = c.id
      ORDER BY i.created_at DESC LIMIT 20
    `).all()

    // Conversion funnel: signups → trial → paid
    const funnel = await c.env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM customers) as total_signups,
        (SELECT COUNT(*) FROM customers WHERE free_trial_used > 0) as used_trial,
        (SELECT COUNT(*) FROM customers WHERE report_credits > 0 OR credits_used > 0) as became_paid,
        (SELECT COUNT(*) FROM orders WHERE is_trial = 1) as trial_reports,
        (SELECT COUNT(*) FROM orders WHERE is_trial = 0 OR is_trial IS NULL) as paid_reports
    `).first()

    // Trial expiry alerts — customers expiring within 7 days
    const trialAlerts = await c.env.DB.prepare(`
      SELECT id, name, email, company_name, trial_ends_at, subscription_plan, subscription_price_cents
      FROM customers
      WHERE subscription_status = 'trialing' AND trial_ends_at IS NOT NULL
        AND trial_ends_at BETWEEN datetime('now') AND datetime('now', '+7 days')
      ORDER BY trial_ends_at ASC LIMIT 10
    `).all()

    // Revenue metrics
    const revenue = await c.env.DB.prepare(`
      SELECT
        (SELECT COALESCE(SUM(subscription_price_cents), 0) FROM customers WHERE subscription_status = 'active') as mrr_cents,
        (SELECT COUNT(*) FROM customers WHERE subscription_status = 'active') as active_subs,
        (SELECT COUNT(*) FROM customers WHERE subscription_status = 'trialing') as trialing,
        (SELECT COALESCE(SUM(total), 0) FROM invoices WHERE status = 'paid' AND created_at > datetime('now', '-30 days')) as invoiced_30d,
        (SELECT COUNT(*) FROM customers WHERE subscription_status = 'cancelled') as churned,
        (SELECT COUNT(*) FROM customers WHERE subscription_status = 'trialing' AND trial_ends_at < datetime('now')) as expired_trials
    `).first()

    // Lead sources
    const leadSources = await c.env.DB.prepare(`
      SELECT COALESCE(lead_source, lead_utm_source, 'direct') as source, COUNT(*) as count,
        SUM(CASE WHEN subscription_status = 'active' THEN 1 ELSE 0 END) as converted
      FROM customers GROUP BY source ORDER BY count DESC LIMIT 10
    `).all()

    return c.json({
      crm_stats: crmStats,
      platform_invoices: platformInvoices,
      recent_proposals: recentProposals.results,
      recent_invoices: recentInvoices.results,
      funnel,
      trial_alerts: trialAlerts.results,
      revenue,
      lead_sources: leadSources.results,
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to load marketing data', details: err.message }, 500)
  }
})

// GET /superadmin/trial-expiry — All trialing customers
adminRoutes.get('/superadmin/trial-expiry', async (c) => {
  const admin = c.get('admin' as any)
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  try {
    const customers = await c.env.DB.prepare(`
      SELECT id, name, email, company_name, subscription_plan, trial_ends_at, subscription_status, subscription_price_cents, report_credits, created_at
      FROM customers WHERE subscription_status = 'trialing' AND trial_ends_at IS NOT NULL
      ORDER BY trial_ends_at ASC LIMIT 100
    `).all()
    return c.json({ customers: customers.results })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

// ============================================================
// SUPERADMIN: AI SECRETARY PLATFORM METRICS
// Trial signups, SIP trunk connections, per-customer call minutes.
// Replaces the old per-account inbox aggregator (web chat / leads /
// callbacks) which belonged on the customer dashboard, not super admin.
// ============================================================

// GET /superadmin/inbox — AI Secretary platform-wide metrics for super admin
adminRoutes.get('/superadmin/inbox', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  try {
    // Summary KPIs
    const summary: any = {
      active_trials: 0,
      paid_subscribers: 0,
      pending_setup: 0,
      active_sip_trunks: 0,
      total_call_minutes_30d: 0,
      total_calls_30d: 0,
      total_calls_all_time: 0,
      last_call_at: null,
      call_window: '30d',
    }

    // Active trials: status='trialing' OR explicit trial dates that haven't expired.
    try {
      const r = await c.env.DB.prepare(
        `SELECT COUNT(*) as c FROM secretary_subscriptions
           WHERE (status = 'trialing'
                  OR (trial_started_at IS NOT NULL
                      AND (trial_ends_at IS NULL OR trial_ends_at > datetime('now'))))
             AND status NOT IN ('cancelled', 'expired')`
      ).first<any>()
      summary.active_trials = r?.c || 0
    } catch {}

    try {
      const r = await c.env.DB.prepare(
        `SELECT COUNT(*) as c FROM secretary_subscriptions WHERE status = 'active'`
      ).first<any>()
      summary.paid_subscribers = r?.c || 0
    } catch {}

    // Pending setup — paid for the plan but trunk/config not finished.
    try {
      const r = await c.env.DB.prepare(
        `SELECT COUNT(*) as c FROM secretary_subscriptions WHERE status = 'pending'`
      ).first<any>()
      summary.pending_setup = r?.c || 0
    } catch {}

    try {
      const r = await c.env.DB.prepare(
        `SELECT COUNT(*) as c FROM sip_trunks WHERE status = 'active'`
      ).first<any>()
      summary.active_sip_trunks = r?.c || 0
    } catch {}

    // Call minutes — try 30d first; if empty, fall back to all-time so the
    // dashboard always shows real numbers (calls are infrequent).
    try {
      const r30 = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(call_duration_seconds), 0) as s, COUNT(*) as n
           FROM secretary_call_logs
           WHERE created_at >= datetime('now', '-30 days')`
      ).first<any>()
      const minutes30 = Math.round((r30?.s || 0) / 60)
      const calls30 = r30?.n || 0

      if (minutes30 === 0 && calls30 === 0) {
        const rAll = await c.env.DB.prepare(
          `SELECT COALESCE(SUM(call_duration_seconds), 0) as s, COUNT(*) as n, MAX(created_at) as last_at
             FROM secretary_call_logs`
        ).first<any>()
        summary.total_call_minutes_30d = Math.round((rAll?.s || 0) / 60)
        summary.total_calls_30d = rAll?.n || 0
        summary.total_calls_all_time = rAll?.n || 0
        summary.last_call_at = rAll?.last_at || null
        summary.call_window = 'all-time'
      } else {
        summary.total_call_minutes_30d = minutes30
        summary.total_calls_30d = calls30
        const rAll = await c.env.DB.prepare(
          `SELECT COUNT(*) as n, MAX(created_at) as last_at FROM secretary_call_logs`
        ).first<any>()
        summary.total_calls_all_time = rAll?.n || 0
        summary.last_call_at = rAll?.last_at || null
      }
    } catch {}

    // Trials list — every customer currently in or recently in a trial,
    // joined to customer info, with trial usage stats.
    let trials: any[] = []
    try {
      const res = await c.env.DB.prepare(
        `SELECT s.customer_id,
                c.name        as customer_name,
                c.email       as customer_email,
                c.company_name as company_name,
                s.trial_started_at,
                s.trial_ends_at,
                s.status,
                CAST(
                  (julianday(COALESCE(s.trial_ends_at, datetime('now'))) - julianday(datetime('now')))
                  AS INTEGER
                ) as days_remaining,
                (SELECT COUNT(*) FROM secretary_call_logs cl
                   WHERE cl.customer_id = s.customer_id
                     AND cl.created_at >= s.trial_started_at) as calls_count,
                (SELECT COALESCE(SUM(call_duration_seconds), 0) FROM secretary_call_logs cl
                   WHERE cl.customer_id = s.customer_id
                     AND cl.created_at >= s.trial_started_at) as seconds_used
           FROM secretary_subscriptions s
           LEFT JOIN customers c ON c.id = s.customer_id
           WHERE s.trial_started_at IS NOT NULL
              OR s.status IN ('trialing','pending','active')
           ORDER BY COALESCE(s.trial_started_at, s.created_at) DESC
           LIMIT 200`
      ).all()
      trials = (res.results || []).map((r: any) => ({
        customer_id: r.customer_id,
        customer_name: r.customer_name || '',
        customer_email: r.customer_email || '',
        company_name: r.company_name || '',
        trial_started_at: r.trial_started_at,
        trial_ends_at: r.trial_ends_at,
        days_remaining: typeof r.days_remaining === 'number' ? r.days_remaining : 0,
        status: r.status,
        calls_count: r.calls_count || 0,
        minutes_used: Math.round((r.seconds_used || 0) / 60),
      }))
    } catch {}

    // SIP trunk connections — joined to assigned customer (if any) via the
    // phone pool. Trunks may be unassigned, in which case customer is null.
    let sipTrunks: any[] = []
    try {
      const res = await c.env.DB.prepare(
        `SELECT t.trunk_id,
                t.trunk_type,
                t.phone_number,
                t.status,
                t.created_at,
                p.assigned_to_customer_id as assigned_customer_id,
                c.name        as assigned_customer_name,
                c.company_name as assigned_company_name
           FROM sip_trunks t
           LEFT JOIN secretary_phone_pool p ON p.sip_trunk_id = t.trunk_id
           LEFT JOIN customers c ON c.id = p.assigned_to_customer_id
           ORDER BY t.created_at DESC
           LIMIT 200`
      ).all()
      sipTrunks = (res.results || []).map((r: any) => ({
        trunk_id: r.trunk_id,
        trunk_type: r.trunk_type,
        phone_number: r.phone_number || '',
        status: r.status,
        created_at: r.created_at,
        assigned_customer_id: r.assigned_customer_id || null,
        assigned_customer_name: r.assigned_customer_name || '',
        assigned_company_name: r.assigned_company_name || '',
      }))
    } catch {}

    // Call volume by customer (last 30 days)
    let callVolume: any[] = []
    try {
      const res = await c.env.DB.prepare(
        `SELECT cl.customer_id,
                c.name        as customer_name,
                c.company_name as company_name,
                COUNT(*)      as calls_30d,
                COALESCE(SUM(cl.call_duration_seconds), 0) as seconds_30d,
                MAX(cl.created_at) as last_call_at
           FROM secretary_call_logs cl
           LEFT JOIN customers c ON c.id = cl.customer_id
           WHERE cl.created_at >= datetime('now', '-30 days')
           GROUP BY cl.customer_id
           ORDER BY seconds_30d DESC
           LIMIT 200`
      ).all()
      callVolume = (res.results || []).map((r: any) => ({
        customer_id: r.customer_id,
        customer_name: r.customer_name || '',
        company_name: r.company_name || '',
        calls_30d: r.calls_30d || 0,
        minutes_30d: Math.round((r.seconds_30d || 0) / 60),
        last_call_at: r.last_call_at,
      }))
    } catch {}

    return c.json({
      summary,
      trials,
      sip_trunks: sipTrunks,
      call_volume_by_customer: callVolume,
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// POST /superadmin/sip-trunks — Register an existing LiveKit/Telnyx trunk in D1
// so it shows up on the Inbox view. Trunks live in LiveKit/Telnyx; this
// table is a mirror used purely for display + assignment.
adminRoutes.post('/superadmin/sip-trunks', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  try {
    const body = await c.req.json<any>().catch(() => ({}))
    const trunk_id = (body.trunk_id || '').toString().trim()
    const trunk_type = (body.trunk_type || 'outbound').toString().trim()
    const phone_number = (body.phone_number || '').toString().trim()
    const status = (body.status || 'active').toString().trim()
    const name = (body.name || '').toString().trim().slice(0, 200) || null
    const dispatch_rule_id = (body.dispatch_rule_id || '').toString().trim() || null

    if (!trunk_id) return c.json({ error: 'trunk_id required' }, 400)
    if (!['inbound', 'outbound'].includes(trunk_type)) return c.json({ error: "trunk_type must be 'inbound' or 'outbound'" }, 400)
    if (!['active', 'disabled', 'deleted'].includes(status)) return c.json({ error: "status must be active|disabled|deleted" }, 400)

    const existing = await c.env.DB.prepare(`SELECT id FROM sip_trunks WHERE trunk_id = ?`).bind(trunk_id).first()
    if (existing) {
      await c.env.DB.prepare(
        `UPDATE sip_trunks SET trunk_type=?, phone_number=?, status=?, name=COALESCE(?, name), dispatch_rule_id=COALESCE(?, dispatch_rule_id), updated_at=datetime('now') WHERE trunk_id = ?`
      ).bind(trunk_type, phone_number, status, name, dispatch_rule_id, trunk_id).run()
      return c.json({ success: true, updated: true })
    }

    await c.env.DB.prepare(
      `INSERT INTO sip_trunks (trunk_id, trunk_type, name, phone_number, status, dispatch_rule_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(trunk_id, trunk_type, name, phone_number, status, dispatch_rule_id).run()

    return c.json({ success: true, created: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// DELETE /superadmin/sip-trunks/:trunkId — Remove a registered trunk from D1.
adminRoutes.delete('/superadmin/sip-trunks/:trunkId', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  try {
    const trunkId = c.req.param('trunkId')
    if (!trunkId) return c.json({ error: 'trunkId required' }, 400)
    await c.env.DB.prepare(`DELETE FROM sip_trunks WHERE trunk_id = ?`).bind(trunkId).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// GET /superadmin/inbox/unread-count — Sidebar badge for the AI Secretary
// section. Returns the count of currently-active trials; that's the
// actionable number a super admin cares about at a glance.
adminRoutes.get('/superadmin/inbox/unread-count', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  try {
    const r = await c.env.DB.prepare(
      `SELECT COUNT(*) as c FROM secretary_subscriptions
         WHERE status = 'trialing'
           AND (trial_ends_at IS NULL OR trial_ends_at > datetime('now'))`
    ).first<any>()
    const total = r?.c || 0
    return c.json({ total, active_trials: total })
  } catch (err: any) {
    return c.json({ total: 0 }, 200)
  }
})

// GET /superadmin/new-signups-count — Sidebar badge for new user signups in the last 24h.
// Drives the "Customers" green badge so the super admin sees fresh signups at a glance.
adminRoutes.get('/superadmin/new-signups-count', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  try {
    const r = await c.env.DB.prepare(
      `SELECT COUNT(*) as c FROM customers WHERE created_at > datetime('now', '-1 day')`
    ).first<any>()
    const total = r?.c || 0
    return c.json({ total, window: '24h' })
  } catch (err: any) {
    return c.json({ total: 0 }, 200)
  }
})

// POST /superadmin/customer-recovery-email — Send a one-off custom HTML email
// to a customer (or any address) via the existing Gmail integration. Built so
// we can reach out to users who hit a bug and offer a discount/follow-up.
// Superadmin only. Rate-limited by the requireSuperadmin gate.
adminRoutes.post('/superadmin/customer-recovery-email', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  try {
    const { to, subject, html_body } = await c.req.json<{ to: string; subject: string; html_body: string }>()
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return c.json({ error: 'Invalid recipient email' }, 400)
    if (!subject || !html_body) return c.json({ error: 'subject and html_body required' }, 400)
    if (subject.length > 300) return c.json({ error: 'Subject too long' }, 400)
    if (html_body.length > 200_000) return c.json({ error: 'Body too long' }, 400)

    const env: any = c.env
    // Production uses Gmail OAuth2 (client_id/secret in env, refresh_token in
    // D1 settings) per memory_email_credentials_split. Service account is the
    // fallback for legacy environments.
    const cid = env.GMAIL_CLIENT_ID
    const csec = env.GMAIL_CLIENT_SECRET
    let rtok = env.GMAIL_REFRESH_TOKEN || ''
    if ((!csec || !rtok) && c.env.DB) {
      try {
        const r = await c.env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key='gmail_refresh_token' AND master_company_id=1").first<any>()
        if (r?.setting_value) rtok = r.setting_value
      } catch (_) {}
    }
    if (cid && csec && rtok) {
      const result = await sendGmailOAuth2(cid, csec, rtok, to, subject, html_body, 'sales@roofmanager.ca')
      return c.json({ success: true, via: 'gmail_oauth2', message_id: result.id, sent_to: to, sent_at: new Date().toISOString() })
    }
    if (env.GCP_SERVICE_ACCOUNT_JSON) {
      await sendGmailEmail(env.GCP_SERVICE_ACCOUNT_JSON, to, subject, html_body, 'sales@roofmanager.ca')
      return c.json({ success: true, via: 'gcp_service_account', sent_to: to, sent_at: new Date().toISOString() })
    }
    return c.json({ error: 'No Gmail send credentials available (need either GMAIL_CLIENT_ID+SECRET+REFRESH_TOKEN or GCP_SERVICE_ACCOUNT_JSON)' }, 500)
  } catch (err: any) {
    return c.json({ error: 'Send failed', details: String(err?.message || err) }, 500)
  }
})

// GET /superadmin/inbox/lead/:type/:id — Single lead detail (type = lead|sitelead|contact|demo)
adminRoutes.get('/superadmin/inbox/lead/:type/:id', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  const type = c.req.param('type')
  const id = c.req.param('id')
  try {
    let lead: any = null
    if (type === 'lead') {
      lead = await c.env.DB.prepare(
        `SELECT id, email, name, company, address, building_count, source, tag, created_at, 'asset_report' as lead_type FROM asset_report_leads WHERE id = ?`
      ).bind(id).first<any>()
    } else if (type === 'sitelead') {
      lead = await c.env.DB.prepare(
        `SELECT id, email, name, company_name as company, phone, source_page as source, message, status, created_at, 'site_form' as lead_type FROM leads WHERE id = ?`
      ).bind(id).first<any>()
    } else if (type === 'contact') {
      lead = await c.env.DB.prepare(
        `SELECT id, email, name, company, phone, interest, employees, message, utm_source, utm_medium, utm_campaign, created_at, 'contact_form' as lead_type FROM contact_leads WHERE id = ?`
      ).bind(id).first<any>()
    } else if (type === 'demo') {
      lead = await c.env.DB.prepare(
        `SELECT id, email, name, company, phone, message, created_at, 'demo_request' as lead_type FROM demo_leads WHERE id = ?`
      ).bind(id).first<any>()
    }
    if (!lead) return c.json({ error: 'Lead not found' }, 404)
    return c.json(lead)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// POST /superadmin/inbox/mark-read — Mark a conversation as read for this admin
adminRoutes.post('/superadmin/inbox/mark-read', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  try {
    const { conversation_id, channel } = await c.req.json()
    if (!conversation_id || !channel) return c.json({ error: 'conversation_id and channel required' }, 400)
    await c.env.DB.prepare(
      `INSERT INTO inbox_read_state (admin_user_id, conversation_id, channel, last_read_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(admin_user_id, conversation_id) DO UPDATE SET last_read_at = datetime('now')`
    ).bind((admin as any).id, conversation_id, channel).run()
    // Also update source table read state where applicable
    if (channel === 'sms') {
      const msgId = conversation_id.replace('msg_', '')
      await c.env.DB.prepare(`UPDATE secretary_messages SET is_read = 1 WHERE id = ?`).bind(msgId).run()
    }
    return c.json({ ok: true })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// POST /superadmin/inbox/reply — Reply to a conversation (writes to correct channel)
adminRoutes.post('/superadmin/inbox/reply', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  try {
    const { conversation_id, channel, message } = await c.req.json()
    if (!conversation_id || !channel || !message) return c.json({ error: 'conversation_id, channel, and message required' }, 400)

    if (channel === 'web_chat') {
      const roverId = conversation_id.replace('rover_', '')
      await c.env.DB.prepare(
        `INSERT INTO rover_messages (conversation_id, role, content, created_at) VALUES (?, 'assistant', ?, datetime('now'))`
      ).bind(roverId, message).run()
      await c.env.DB.prepare(
        `UPDATE rover_conversations SET last_message_at = datetime('now') WHERE id = ?`
      ).bind(roverId).run()
      return c.json({ ok: true, channel: 'web_chat' })
    } else if (channel === 'job_message') {
      const parts = conversation_id.replace('job_', '').split('_')
      const jobId = parts[0]
      await c.env.DB.prepare(
        `INSERT INTO crew_messages (job_id, author_id, author_name, content, created_at) VALUES (?, ?, ?, ?, datetime('now'))`
      ).bind(jobId, (admin as any).id, (admin as any).name || 'Admin', message).run()
      return c.json({ ok: true, channel: 'job_message' })
    } else {
      // voice, sms, voicemail, form, cold_call — reply not directly supported, log as admin note
      return c.json({ ok: false, error: 'Reply not supported for this channel. Use the original system to respond.' }, 400)
    }
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ============================================================
// SUPERADMIN: ROOFER SECRETARY AI — Subscriber management, usage, revenue
// ============================================================

// GET /superadmin/secretary/overview — Full overview of all secretary subscribers
adminRoutes.get('/superadmin/secretary/overview', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  try {
    // Subscription stats — MRR excludes comped accounts (free access via comp_until)
    const subStats = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total_subscriptions,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count,
        SUM(CASE WHEN status = 'trialing' THEN 1 ELSE 0 END) as trialing_count,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
        SUM(CASE WHEN status = 'past_due' THEN 1 ELSE 0 END) as past_due_count,
        SUM(CASE
          WHEN status = 'active'
           AND comp_until IS NOT NULL AND comp_until > datetime('now')
          THEN 1 ELSE 0
        END) as comped_count,
        SUM(CASE
          WHEN status = 'active'
           AND (comp_until IS NULL OR comp_until <= datetime('now'))
          THEN monthly_price_cents ELSE 0
        END) as monthly_mrr_cents
      FROM secretary_subscriptions
    `).first<any>()

    // Call stats
    const callStats = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total_calls,
        SUM(call_duration_seconds) as total_seconds,
        AVG(call_duration_seconds) as avg_duration,
        SUM(CASE WHEN call_outcome = 'answered' THEN 1 ELSE 0 END) as answered,
        SUM(CASE WHEN call_outcome = 'voicemail' THEN 1 ELSE 0 END) as voicemail,
        SUM(CASE WHEN call_outcome = 'transferred' THEN 1 ELSE 0 END) as transferred,
        SUM(CASE WHEN call_outcome = 'missed' THEN 1 ELSE 0 END) as missed
      FROM secretary_call_logs
    `).first<any>()

    // Calls in last 30 days
    const recentCallStats = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as calls_30d,
        SUM(call_duration_seconds) as seconds_30d,
        COUNT(DISTINCT customer_id) as active_users_30d
      FROM secretary_call_logs
      WHERE created_at >= datetime('now', '-30 days')
    `).first<any>()

    // Calls in last 7 days
    const weekCallStats = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as calls_7d,
        SUM(call_duration_seconds) as seconds_7d,
        COUNT(DISTINCT customer_id) as active_users_7d
      FROM secretary_call_logs
      WHERE created_at >= datetime('now', '-7 days')
    `).first<any>()

    // Config stats (active service users)
    const configStats = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total_configs,
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_services
      FROM secretary_config
    `).first<any>()

    // Messages & appointments
    const msgStats = await c.env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM secretary_messages) as total_messages,
        (SELECT COUNT(*) FROM secretary_messages WHERE is_read = 0) as unread_messages,
        (SELECT COUNT(*) FROM secretary_appointments) as total_appointments,
        (SELECT COUNT(*) FROM secretary_appointments WHERE status = 'pending') as pending_appointments,
        (SELECT COUNT(*) FROM secretary_callbacks) as total_callbacks,
        (SELECT COUNT(*) FROM secretary_callbacks WHERE status = 'pending') as pending_callbacks
    `).first<any>()

    return c.json({
      subscriptions: subStats || {},
      calls: callStats || {},
      recent_calls: recentCallStats || {},
      week_calls: weekCallStats || {},
      configs: configStats || {},
      messages: msgStats || {}
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to load secretary overview', details: err.message }, 500)
  }
})

// GET /superadmin/secretary/subscribers — All subscribers with details
adminRoutes.get('/superadmin/secretary/subscribers', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  try {
    const subscribers = await c.env.DB.prepare(`
      SELECT 
        ss.id,
        ss.customer_id,
        ss.status,
        ss.stripe_subscription_id,
        ss.monthly_price_cents,
        ss.current_period_start,
        ss.current_period_end,
        ss.cancelled_at,
        ss.created_at,
        ss.updated_at,
        c.name as customer_name,
        c.email as customer_email,
        c.phone as customer_phone,
        c.company_name as customer_company,
        sc.business_phone,
        sc.is_active as service_active,
        sc.greeting_script,
        (SELECT COUNT(*) FROM secretary_call_logs cl WHERE cl.customer_id = ss.customer_id) as total_calls,
        (SELECT SUM(call_duration_seconds) FROM secretary_call_logs cl WHERE cl.customer_id = ss.customer_id) as total_call_seconds,
        (SELECT COUNT(*) FROM secretary_call_logs cl WHERE cl.customer_id = ss.customer_id AND cl.created_at >= datetime('now', '-30 days')) as calls_30d,
        (SELECT SUM(call_duration_seconds) FROM secretary_call_logs cl WHERE cl.customer_id = ss.customer_id AND cl.created_at >= datetime('now', '-30 days')) as seconds_30d,
        (SELECT COUNT(*) FROM secretary_messages m WHERE m.customer_id = ss.customer_id) as total_messages,
        (SELECT COUNT(*) FROM secretary_appointments a WHERE a.customer_id = ss.customer_id) as total_appointments
      FROM secretary_subscriptions ss
      LEFT JOIN customers c ON c.id = ss.customer_id
      LEFT JOIN secretary_config sc ON sc.customer_id = ss.customer_id
      ORDER BY ss.created_at DESC
    `).all()

    return c.json({ subscribers: subscribers.results || [] })
  } catch (err: any) {
    return c.json({ error: 'Failed to load subscribers', details: err.message }, 500)
  }
})

// GET /superadmin/secretary/revenue — Revenue analytics & subscription lifecycle
adminRoutes.get('/superadmin/secretary/revenue', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  try {
    const period = c.req.query('period') || 'monthly'
    let dateFormat: string, dateFilter: string
    if (period === 'weekly') {
      dateFormat = '%Y-W%W'
      dateFilter = "datetime('now', '-90 days')"
    } else if (period === 'daily') {
      dateFormat = '%Y-%m-%d'
      dateFilter = "datetime('now', '-30 days')"
    } else {
      dateFormat = '%Y-%m'
      dateFilter = "datetime('now', '-12 months')"
    }

    // Revenue over time (from subscriptions)
    const revenueByPeriod = await c.env.DB.prepare(`
      SELECT 
        strftime('${dateFormat}', ss.created_at) as period,
        COUNT(*) as new_subs,
        SUM(monthly_price_cents) as revenue_cents
      FROM secretary_subscriptions ss
      WHERE ss.created_at >= ${dateFilter}
      GROUP BY period
      ORDER BY period ASC
    `).all()

    // Current MRR breakdown
    const mrr = await c.env.DB.prepare(`
      SELECT
        SUM(CASE WHEN status = 'active' THEN monthly_price_cents ELSE 0 END) as active_mrr_cents,
        SUM(CASE WHEN status = 'past_due' THEN monthly_price_cents ELSE 0 END) as at_risk_mrr_cents,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_count,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as churned_count,
        COUNT(CASE WHEN status = 'past_due' THEN 1 END) as at_risk_count
      FROM secretary_subscriptions
    `).first<any>()

    // Upcoming renewals (subscriptions expiring in next 30 days)
    const upcomingRenewals = await c.env.DB.prepare(`
      SELECT 
        ss.id,
        ss.customer_id,
        ss.status,
        ss.monthly_price_cents,
        ss.current_period_end,
        c.name as customer_name,
        c.email as customer_email,
        c.company_name as customer_company
      FROM secretary_subscriptions ss
      LEFT JOIN customers c ON c.id = ss.customer_id
      WHERE ss.status = 'active'
        AND ss.current_period_end IS NOT NULL
        AND ss.current_period_end <= datetime('now', '+30 days')
      ORDER BY ss.current_period_end ASC
    `).all()

    // Expired/past-due subscriptions
    const expired = await c.env.DB.prepare(`
      SELECT 
        ss.id,
        ss.customer_id,
        ss.status,
        ss.monthly_price_cents,
        ss.current_period_end,
        ss.cancelled_at,
        c.name as customer_name,
        c.email as customer_email,
        c.company as customer_company
      FROM secretary_subscriptions ss
      LEFT JOIN customers c ON c.id = ss.customer_id
      WHERE ss.status IN ('past_due', 'cancelled')
      ORDER BY ss.updated_at DESC
      LIMIT 50
    `).all()

    // Lifetime revenue
    const lifetime = await c.env.DB.prepare(`
      SELECT 
        SUM(monthly_price_cents) as total_lifetime_cents,
        COUNT(*) as total_subscriptions_ever,
        MIN(created_at) as first_subscription
      FROM secretary_subscriptions
      WHERE status IN ('active', 'cancelled', 'past_due')
    `).first<any>()

    return c.json({
      revenue_by_period: revenueByPeriod.results || [],
      mrr: mrr || {},
      upcoming_renewals: upcomingRenewals.results || [],
      expired: expired.results || [],
      lifetime: lifetime || {},
      period
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to load revenue data', details: err.message }, 500)
  }
})

// GET /superadmin/secretary/calls — Recent call logs across all subscribers
adminRoutes.get('/superadmin/secretary/calls', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  try {
    const limit = parseInt(c.req.query('limit') || '50')
    const offset = parseInt(c.req.query('offset') || '0')
    const customerId = c.req.query('customer_id')
    
    let whereClause = ''
    const params: any[] = []
    if (customerId) {
      whereClause = 'WHERE cl.customer_id = ?'
      params.push(parseInt(customerId))
    }

    const calls = await c.env.DB.prepare(`
      SELECT 
        cl.*,
        c.name as customer_name,
        c.email as customer_email,
        c.company_name as customer_company
      FROM secretary_call_logs cl
      LEFT JOIN customers c ON c.id = cl.customer_id
      ${whereClause}
      ORDER BY cl.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all()

    const totalRes = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM secretary_call_logs cl ${whereClause}
    `).bind(...params).first<any>()

    return c.json({
      calls: calls.results || [],
      total: totalRes?.count || 0,
      limit,
      offset
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to load call logs', details: err.message }, 500)
  }
})

// ============================================================
// SUPERADMIN: CUSTOMER ONBOARDING — Create accounts + Secretary AI
// ============================================================

// GET /superadmin/onboarding/list — List all onboarded customers with secretary status
adminRoutes.get('/superadmin/onboarding/list', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  try {
    const rows = await c.env.DB.prepare(`
      SELECT
        c.id, c.name as contact_name, c.email, c.phone as personal_phone,
        c.company_name as business_name, c.company_type, c.subscription_plan,
        c.subscription_status, c.trial_ends_at, c.subscription_price_cents,
        c.is_active, c.created_at,
        sc.is_active as secretary_enabled, sc.secretary_mode,
        sc.assigned_phone_number as agent_phone_number,
        CASE
          WHEN sc.livekit_inbound_trunk_id IS NOT NULL AND sc.livekit_inbound_trunk_id != '' THEN 'livekit'
          WHEN sc.assigned_phone_number IS NOT NULL AND sc.assigned_phone_number != '' THEN 'twilio'
          ELSE NULL
        END as phone_provider,
        sc.connection_status, sc.livekit_inbound_trunk_id
      FROM customers c
      LEFT JOIN secretary_config sc ON sc.customer_id = c.id
      WHERE c.is_active = 1
      ORDER BY c.created_at DESC
      LIMIT 200
    `).all<any>()
    return c.json({ customers: rows.results || [] })
  } catch (err: any) {
    return c.json({ error: 'Failed to load customers', details: err.message }, 500)
  }
})

// POST /superadmin/onboarding/create — Create customer + optionally set up Secretary AI
adminRoutes.post('/superadmin/onboarding/create', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  const body = await c.req.json()
  const { email, password, contact_name, business_name, phone, personal_phone,
          agent_phone_number, secretary_mode, phone_provider, notes, enable_secretary,
          call_forwarding_number, secretary_phone_number,
          forwarding_method, sip_uri, sip_username, sip_password,
          subscription_tier, trial_days, credit_pack, send_invoice } = body

  if (!email || !password || !contact_name) {
    return c.json({ error: 'email, password, and contact_name are required' }, 400)
  }
  if (typeof password !== 'string' || password.length < 8) {
    return c.json({ error: 'password must be at least 8 characters' }, 400)
  }

  const existing = await c.env.DB.prepare(`SELECT id FROM customers WHERE email = ?`)
    .bind(email.toLowerCase()).first<any>()
  if (existing) return c.json({ error: 'A customer with that email already exists' }, 409)

  const password_hash = await hashCustomerPassword(password)

  // Trial + subscription setup
  const trialDaysNum = parseInt(trial_days) || 30
  const tierPrices: Record<string, number> = { starter: 4999, pro: 19900, enterprise: 49900 }
  const selectedTier = subscription_tier || 'starter'
  const priceCents = tierPrices[selectedTier] || 4999

  try {
    const result = await c.env.DB.prepare(`
      INSERT INTO customers (email, password_hash, name, company_name, phone,
        is_active, email_verified, free_trial_total, free_trial_used, report_credits,
        subscription_plan, subscription_status, trial_ends_at, subscription_price_cents,
        auto_invoice_enabled,
        created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 1, 3, 0, 0, ?, 'trialing',
        datetime('now', '+' || ? || ' days'), ?,
        0,
        datetime('now'), datetime('now'))
    `).bind(
      email.toLowerCase(), password_hash, contact_name,
      business_name || contact_name,
      phone || personal_phone || '',
      selectedTier, String(trialDaysNum), priceCents
    ).run()

    const customerId = (result as any).meta?.last_row_id
    if (!customerId) return c.json({ error: 'Failed to create customer account' }, 500)

    // Seed default material catalog so new account has context on the section (non-blocking)
    seedDefaultMaterials(c.env.DB, customerId).catch((e) => console.warn("[admin] seedDefaultMaterials failed:", e?.message || e))

    let secretarySetup = false
    const agentPhone = agent_phone_number || secretary_phone_number || ''

    if (enable_secretary !== false) {
      // NOTE: Previously this block auto-activated a free secretary_subscriptions row.
      // That path is removed — all Secretary activation now flows through
      // POST /api/secretary/start-trial (1-month free trial + card on file, then $199/mo).
      // To comp an account for free, use POST /superadmin/secretary/:customerId/comp
      // which sets secretary_subscriptions.comp_until. This keeps every account visible
      // in the new Secretary subscriptions tracking dashboard.

      // Create secretary config
      const fwdMethod = ['livekit_number', 'call_forwarding', 'sip_trunk'].includes(forwarding_method)
        ? forwarding_method : 'livekit_number'
      // Encrypt SIP credentials at rest (AES-256-GCM via SIP_ENCRYPTION_KEY).
      const encSipUser = await encryptSecret(c.env, sip_username || '')
      const encSipPass = await encryptSecret(c.env, sip_password || '')
      await c.env.DB.prepare(`
        INSERT INTO secretary_config (
          customer_id, business_phone, greeting_script, common_qa, general_notes,
          secretary_mode, is_active, connection_status, assigned_phone_number,
          forwarding_method, livekit_sip_uri, sip_username, sip_password,
          created_at, updated_at
        ) VALUES (?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `).bind(
        customerId,
        personal_phone || phone || '',
        notes || '',
        secretary_mode || 'full',
        agentPhone ? 1 : 0,
        agentPhone ? 'pending_forwarding' : 'not_connected',
        agentPhone || '',
        fwdMethod,
        sip_uri || '',
        encSipUser,
        encSipPass
      ).run()

      // If agent phone provided, mark in pool or insert
      if (agentPhone) {
        const poolEntry = await c.env.DB.prepare(
          `SELECT id FROM secretary_phone_pool WHERE phone_number = ?`
        ).bind(agentPhone).first<any>()
        if (poolEntry) {
          await c.env.DB.prepare(
            `UPDATE secretary_phone_pool SET status = 'assigned', assigned_to_customer_id = ?, updated_at = datetime('now') WHERE id = ?`
          ).bind(customerId, poolEntry.id).run()
        } else {
          await c.env.DB.prepare(
            `INSERT OR IGNORE INTO secretary_phone_pool (phone_number, region, status, assigned_to_customer_id, assigned_at) VALUES (?, 'CA', 'assigned', ?, datetime('now'))`
          ).bind(agentPhone, customerId).run()
        }
        secretarySetup = true
      }
    }

    // Auto-deploy LiveKit trunk + dispatch rule if agent phone and LiveKit configured
    let livekitDeployed = false
    let livekitTrunkId = ''
    let livekitDispatchId = ''
    let livekitError = ''
    if (agentPhone && secretarySetup) {
      try {
        const result = await deployLiveKitForCustomer(c.env, customerId, agentPhone, {
          sip_username: sip_username || undefined,
          sip_password: sip_password || undefined,
        })
        if (result.success) {
          livekitDeployed = true
          livekitTrunkId = result.trunk_id
          livekitDispatchId = result.dispatch_rule_id
        } else {
          livekitError = result.error || 'Unknown LiveKit deploy error'
        }
      } catch (e: any) {
        livekitError = e.message || String(e)
        console.warn(`[Onboarding] LiveKit auto-deploy failed for ${customerId}: ${livekitError}`)
      }
    }

    // Optionally create invoice with Square payment link
    let invoiceResult: any = null
    if (send_invoice && credit_pack && credit_pack !== 'none') {
      const packs: Record<string, { qty: number; price: number; desc: string }> = {
        '10-pack':  { qty: 10,  price: 55,   desc: '10 Roof Report Credits' },
        '25-pack':  { qty: 25,  price: 175,  desc: '25 Roof Report Credits' },
        '100-pack': { qty: 100, price: 595,  desc: '100 Roof Report Credits' },
      }
      const pack = packs[credit_pack]
      if (pack) {
        try {
          const d = new Date().toISOString().slice(0, 10).replace(/-/g, '')
          const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0')
          const invoiceNumber = `OB-${d}-${rand}`
          const shareToken = crypto.randomUUID().replace(/-/g, '').substring(0, 24)

          const invRes = await c.env.DB.prepare(`
            INSERT INTO invoices (invoice_number, master_company_id, customer_id, subtotal, tax_rate, tax_amount, total, currency, status, document_type, notes, share_token, issue_date, due_date, created_at, updated_at)
            VALUES (?, 1, ?, ?, 0, 0, ?, 'CAD', 'sent', 'invoice', ?, ?, datetime('now'), datetime('now', '+30 days'), datetime('now'), datetime('now'))
          `).bind(invoiceNumber, customerId, pack.price, pack.price, `Onboarding — ${pack.desc}`, shareToken).run()
          const invoiceId = (invRes as any).meta?.last_row_id

          if (invoiceId) {
            await c.env.DB.prepare(
              'INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, 0)'
            ).bind(invoiceId, pack.desc, pack.qty, pack.price / pack.qty, pack.price).run()

            const sq = await createSquarePaymentLink(c.env, invoiceId, invoiceNumber, pack.price)
            const checkoutUrl = sq?.url || ''

            // Send invoice email
            try {
              const origin = new URL(c.req.url).origin
              await fetch(`${origin}/api/invoices/${invoiceId}/send-gmail`, {
                method: 'POST',
                headers: { 'Authorization': c.req.header('Authorization') || '', 'Content-Type': 'application/json' }
              })
            } catch (emailErr: any) { console.warn('[Onboarding] Invoice email failed:', emailErr.message) }

            invoiceResult = { invoice_id: invoiceId, invoice_number: invoiceNumber, checkout_url: checkoutUrl, share_token: shareToken }
          }
        } catch (invErr: any) { console.warn('[Onboarding] Invoice creation failed:', invErr.message) }
      }
    }

    return c.json({
      success: true,
      customer_id: customerId,
      email: email.toLowerCase(),
      secretary_setup: secretarySetup,
      agent_phone_number: agentPhone || null,
      personal_phone: personal_phone || phone || null,
      livekit_deployed: livekitDeployed,
      livekit_trunk_id: livekitTrunkId,
      livekit_error: livekitError || undefined,
      subscription_tier: selectedTier,
      trial_ends_at: new Date(Date.now() + trialDaysNum * 86400000).toISOString(),
      invoice: invoiceResult,
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to create customer', details: err.message }, 500)
  }
})

// ── LiveKit deployment helper — creates SIP trunk + dispatch rule ──
async function deployLiveKitForCustomer(
  env: any,
  customerId: number,
  phoneNumber: string,
  opts: { sip_username?: string; sip_password?: string; reuse_existing?: boolean } = {}
): Promise<{ success: boolean; trunk_id: string; dispatch_rule_id: string; error?: string }> {
  const apiKey = env.LIVEKIT_API_KEY
  const apiSecret = env.LIVEKIT_API_SECRET
  const livekitUrl = env.LIVEKIT_URL
  const livekitSipUri = env.LIVEKIT_SIP_URI || ''

  if (!apiKey || !apiSecret || !livekitUrl) {
    // P2: avoid leaking specific env var names in user-facing errors.
    return { success: false, trunk_id: '', dispatch_rule_id: '', error: 'Voice service not configured. Contact admin.' }
  }

  if (opts.reuse_existing !== false) {
    const existing = await env.DB.prepare(
      'SELECT livekit_inbound_trunk_id, livekit_dispatch_rule_id FROM secretary_config WHERE customer_id = ?'
    ).bind(customerId).first<any>()
    if (existing?.livekit_inbound_trunk_id && existing?.livekit_dispatch_rule_id) {
      return { success: true, trunk_id: existing.livekit_inbound_trunk_id, dispatch_rule_id: existing.livekit_dispatch_rule_id }
    }
  }

  // Create JWT for LiveKit SIP API
  function b64url(data: Uint8Array | string): string {
    let str: string
    if (typeof data === 'string') { str = btoa(data) } else { let b = ''; for (let i = 0; i < data.length; i++) b += String.fromCharCode(data[i]); str = btoa(b) }
    return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ iss: apiKey, sub: 'server', iat: now, exp: now + 300, nbf: now, video: { roomCreate: true, roomList: true, roomAdmin: true }, sip: { admin: true, call: true } }))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${payload}`))
  const jwt = `${header}.${payload}.${b64url(new Uint8Array(sig))}`
  const httpUrl = livekitUrl.replace('wss://', 'https://').replace(/\/$/, '')

  async function lkApi(path: string, body: any) {
    const resp = await fetch(`${httpUrl}${path}`, { method: 'POST', headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return resp.json() as Promise<any>
  }

  // Step 1: Create inbound trunk (with optional BYO SIP auth)
  const trunkBody: any = { name: `secretary-${customerId}`, numbers: [phoneNumber], krisp_enabled: true, metadata: JSON.stringify({ customer_id: customerId, service: 'roofer_secretary' }) }
  if (opts.sip_username) trunkBody.auth_username = opts.sip_username
  if (opts.sip_password) trunkBody.auth_password = opts.sip_password
  const trunkResult = await lkApi('/twirp/livekit.SIP/CreateSIPInboundTrunk', { trunk: trunkBody })
  const trunkId = trunkResult?.sip_trunk_id || trunkResult?.trunk?.sip_trunk_id || ''
  if (!trunkId) {
    return { success: false, trunk_id: '', dispatch_rule_id: '', error: `LiveKit trunk creation failed: ${JSON.stringify(trunkResult).slice(0, 200)}` }
  }

  // Step 2: Create dispatch rule
  const dispatchResult = await lkApi('/twirp/livekit.SIP/CreateSIPDispatchRule', {
    trunk_ids: trunkId ? [trunkId] : [],
    rule: { dispatchRuleIndividual: { roomPrefix: `secretary-${customerId}-`, pin: '' } },
    name: `secretary-dispatch-${customerId}`,
    metadata: JSON.stringify({ customer_id: customerId }),
  })
  const dispatchId = dispatchResult?.sip_dispatch_rule_id || ''

  // Save to secretary_config
  await env.DB.prepare(
    'UPDATE secretary_config SET livekit_inbound_trunk_id = ?, livekit_dispatch_rule_id = ?, livekit_sip_uri = ?, connection_status = ?, is_active = 1, updated_at = datetime("now") WHERE customer_id = ?'
  ).bind(trunkId, dispatchId, livekitSipUri, trunkId ? 'connected' : 'pending_forwarding', customerId).run()

  // Update phone pool
  if (trunkId) {
    await env.DB.prepare(
      'UPDATE secretary_phone_pool SET sip_trunk_id = ?, dispatch_rule_id = ?, updated_at = datetime("now") WHERE assigned_to_customer_id = ?'
    ).bind(trunkId, dispatchId, customerId).run()
  }

  console.log(`[LiveKit Deploy] Customer ${customerId}: trunk=${trunkId}, dispatch=${dispatchId}`)
  return { success: !!trunkId, trunk_id: trunkId, dispatch_rule_id: dispatchId }
}

// PBKDF2 password hashing — matches verifyPassword() in customer-auth.ts
async function hashCustomerPassword(password: string): Promise<string> {
  const pwSalt = crypto.randomUUID()
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), { name: 'PBKDF2' }, false, ['deriveBits'])
  const hashBuffer = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(pwSalt), iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  )
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map((b: number) => b.toString(16).padStart(2, '0')).join('')
  return `pbkdf2:${pwSalt}:${hashHex}`
}

// Square payment-link helper. Returns { url, id } or null on failure.
async function createSquarePaymentLink(env: any, invoiceId: number, invoiceNumber: string, totalDollars: number): Promise<{ url: string; id: string } | null> {
  const sqToken = env.SQUARE_ACCESS_TOKEN
  const sqLocation = env.SQUARE_LOCATION_ID
  if (!sqToken || !sqLocation) return null
  try {
    const sqResp = await fetch('https://connect.squareup.com/v2/online-checkout/payment-links', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${sqToken}`, 'Content-Type': 'application/json', 'Square-Version': '2025-01-23' },
      body: JSON.stringify({
        idempotency_key: `inv-${invoiceId}-${Date.now()}`,
        quick_pay: { name: `Invoice ${invoiceNumber}`, price_money: { amount: Math.round(totalDollars * 100), currency: 'CAD' }, location_id: sqLocation }
      })
    })
    const sqData: any = await sqResp.json()
    if (sqData.payment_link?.url) {
      await env.DB.prepare("UPDATE invoices SET square_payment_link_url = ?, square_payment_link_id = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(sqData.payment_link.url, sqData.payment_link.id, invoiceId).run()
      return { url: sqData.payment_link.url, id: sqData.payment_link.id }
    } else {
      console.warn('[Square] payment link not created for invoice', invoiceNumber, '— response:', JSON.stringify(sqData))
    }
  } catch (e: any) {
    console.warn('[Square] payment link creation failed:', e.message)
  }
  return null
}

// POST /superadmin/users/create — Standalone create-user (no secretary, no invoice)
adminRoutes.post('/superadmin/users/create', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  const { email, password, name, company_name, phone } = await c.req.json()
  if (!email || !password || !name) return c.json({ error: 'email, password, and name are required' }, 400)
  if (typeof password !== 'string' || password.length < 8) return c.json({ error: 'password must be at least 8 characters' }, 400)

  const existing = await c.env.DB.prepare('SELECT id FROM customers WHERE email = ?').bind(email.toLowerCase()).first<any>()
  if (existing) return c.json({ error: 'A customer with that email already exists' }, 409)

  const password_hash = await hashCustomerPassword(password)
  try {
    const result = await c.env.DB.prepare(`
      INSERT INTO customers (email, password_hash, name, company_name, phone,
        is_active, email_verified, free_trial_total, free_trial_used, report_credits,
        subscription_plan, subscription_status, auto_invoice_enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 1, 0, 0, 0, 'starter', 'inactive', 0, datetime('now'), datetime('now'))
    `).bind(email.toLowerCase(), password_hash, name, company_name || name, phone || '').run()
    const customerId = (result as any).meta?.last_row_id
    return c.json({ success: true, customer_id: customerId, email: email.toLowerCase() })
  } catch (err: any) {
    return c.json({ error: 'Failed to create user', details: err.message }, 500)
  }
})

// POST /superadmin/secretary/:customerId/sip-config — Update SIP fields without re-onboarding
adminRoutes.post('/superadmin/secretary/:customerId/sip-config', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  const customerId = parseInt(c.req.param('customerId'))
  const { forwarding_method, sip_uri, sip_username, sip_password, assigned_phone_number, redeploy } = await c.req.json()

  const fwdMethod = ['livekit_number', 'call_forwarding', 'sip_trunk'].includes(forwarding_method) ? forwarding_method : null
  const updates: string[] = []
  const binds: any[] = []
  if (fwdMethod) { updates.push('forwarding_method = ?'); binds.push(fwdMethod) }
  if (typeof sip_uri === 'string') { updates.push('livekit_sip_uri = ?'); binds.push(sip_uri) }
  // Encrypt SIP credentials on write (AES-256-GCM via SIP_ENCRYPTION_KEY).
  if (typeof sip_username === 'string') { updates.push('sip_username = ?'); binds.push(await encryptSecret(c.env, sip_username)) }
  if (typeof sip_password === 'string') { updates.push('sip_password = ?'); binds.push(await encryptSecret(c.env, sip_password)) }
  if (typeof assigned_phone_number === 'string') { updates.push('assigned_phone_number = ?'); binds.push(assigned_phone_number) }
  if (!updates.length) return c.json({ error: 'No fields to update' }, 400)
  updates.push("updated_at = datetime('now')")
  binds.push(customerId)
  await c.env.DB.prepare(`UPDATE secretary_config SET ${updates.join(', ')} WHERE customer_id = ?`).bind(...binds).run()

  let deploy: any = null
  if (redeploy) {
    const cfg = await c.env.DB.prepare('SELECT assigned_phone_number, sip_username, sip_password FROM secretary_config WHERE customer_id = ?').bind(customerId).first<any>()
    if (cfg?.assigned_phone_number) {
      // Decrypt at the call-site — LiveKit needs the plaintext creds.
      const [plainUser, plainPass] = await Promise.all([
        decryptSecret(c.env, cfg.sip_username),
        decryptSecret(c.env, cfg.sip_password),
      ])
      deploy = await deployLiveKitForCustomer(c.env, customerId, cfg.assigned_phone_number, {
        sip_username: plainUser || undefined,
        sip_password: plainPass || undefined,
        reuse_existing: false,
      })
    }
  }
  return c.json({ success: true, deploy })
})

// POST /superadmin/secretary/:customerId/test-call — Verify trunk health via LiveKit list API
adminRoutes.post('/superadmin/secretary/:customerId/test-call', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  const customerId = parseInt(c.req.param('customerId'))
  const cfg = await c.env.DB.prepare('SELECT livekit_inbound_trunk_id, assigned_phone_number FROM secretary_config WHERE customer_id = ?').bind(customerId).first<any>()
  if (!cfg) return c.json({ error: 'No secretary config' }, 404)

  const apiKey = c.env.LIVEKIT_API_KEY
  const apiSecret = c.env.LIVEKIT_API_SECRET
  const livekitUrl = c.env.LIVEKIT_URL
  if (!apiKey || !apiSecret || !livekitUrl) {
    const details = 'LiveKit env vars not configured'
    await c.env.DB.prepare("UPDATE secretary_config SET last_test_at = datetime('now'), last_test_result = 'failed', last_test_details = ? WHERE customer_id = ?").bind(details, customerId).run()
    return c.json({ success: false, result: 'failed', details })
  }

  function b64url(data: Uint8Array | string): string {
    let str: string
    if (typeof data === 'string') { str = btoa(data) } else { let b = ''; for (let i = 0; i < data.length; i++) b += String.fromCharCode(data[i]); str = btoa(b) }
    return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ iss: apiKey, sub: 'server', iat: now, exp: now + 300, nbf: now, sip: { admin: true, call: true } }))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${payload}`))
  const jwt = `${header}.${payload}.${b64url(new Uint8Array(sig))}`
  const httpUrl = livekitUrl.replace('wss://', 'https://').replace(/\/$/, '')

  try {
    const resp = await fetch(`${httpUrl}/twirp/livekit.SIP/ListSIPInboundTrunk`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: '{}'
    })
    const data: any = await resp.json()
    const items: any[] = data?.items || []
    const found = items.find((t: any) => t?.sip_trunk_id === cfg.livekit_inbound_trunk_id)
    const ok = !!found
    const details = ok
      ? `Trunk ${cfg.livekit_inbound_trunk_id} active, numbers=${(found.numbers || []).join(',')}`
      : `Trunk ${cfg.livekit_inbound_trunk_id || '(none)'} not found in LiveKit (got ${items.length} trunks)`
    await c.env.DB.prepare("UPDATE secretary_config SET last_test_at = datetime('now'), last_test_result = ?, last_test_details = ? WHERE customer_id = ?")
      .bind(ok ? 'success' : 'failed', details, customerId).run()
    return c.json({ success: ok, result: ok ? 'success' : 'failed', details })
  } catch (err: any) {
    const details = `LiveKit API error: ${err.message}`
    await c.env.DB.prepare("UPDATE secretary_config SET last_test_at = datetime('now'), last_test_result = 'failed', last_test_details = ? WHERE customer_id = ?").bind(details, customerId).run()
    return c.json({ success: false, result: 'failed', details })
  }
})

// POST /superadmin/deploy-secretary/:customerId — Deploy LiveKit agent for existing customer
adminRoutes.post('/superadmin/deploy-secretary/:customerId', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || admin.role !== 'superadmin') return c.json({ error: 'Unauthorized' }, 403)

  const customerId = parseInt(c.req.param('customerId'))
  const config = await c.env.DB.prepare('SELECT assigned_phone_number FROM secretary_config WHERE customer_id = ?').bind(customerId).first<any>()
  if (!config) return c.json({ error: 'No secretary config found for this customer' }, 404)
  if (!config.assigned_phone_number) return c.json({ error: 'No agent phone number assigned. Set one first.' }, 400)

  try {
    const result = await deployLiveKitForCustomer(c.env, customerId, config.assigned_phone_number)
    if (result.success) {
      return c.json({ success: true, trunk_id: result.trunk_id, dispatch_rule_id: result.dispatch_rule_id, message: 'LiveKit agent deployed! Calls will now route to AI secretary.' })
    }
    return c.json({ error: 'LiveKit deployment failed — check LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL env vars' }, 500)
  } catch (err: any) {
    return c.json({ error: 'Deploy failed', details: err.message }, 500)
  }
})

// POST /superadmin/onboarding/:id/toggle-secretary — Enable/disable secretary AI
adminRoutes.post('/superadmin/onboarding/:id/toggle-secretary', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  const customerId = parseInt(c.req.param('id'))
  const { enabled } = await c.req.json()

  try {
    const config = await c.env.DB.prepare(`SELECT id FROM secretary_config WHERE customer_id = ?`)
      .bind(customerId).first<any>()

    if (config) {
      await c.env.DB.prepare(
        `UPDATE secretary_config SET is_active = ?, updated_at = datetime('now') WHERE customer_id = ?`
      ).bind(enabled ? 1 : 0, customerId).run()
    } else if (enabled) {
      // Create default config if enabling for the first time
      await c.env.DB.prepare(`
        INSERT INTO secretary_config (customer_id, business_phone, greeting_script, is_active, connection_status, created_at, updated_at)
        VALUES (?, '', '', 1, 'not_connected', datetime('now'), datetime('now'))
      `).bind(customerId).run()
    }

    return c.json({ success: true, enabled: !!enabled })
  } catch (err: any) {
    return c.json({ error: 'Failed to toggle secretary', details: err.message }, 500)
  }
})

// ============================================================
// SUPERADMIN: ROOFER SECRETARY SUBSCRIPTION TRACKING
// ============================================================
// Read-only dashboards so every trial, conversion, renewal, cancellation
// and phone-number purchase is visible in super-admin.
// ============================================================

// GET /superadmin/secretary/subscriptions?status=trialing&limit=100
adminRoutes.get('/superadmin/secretary/subscriptions', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  const statusFilter = (c.req.query('status') || '').trim()
  const limit = Math.min(500, parseInt(c.req.query('limit') || '100', 10))

  const where = statusFilter ? `WHERE ss.status = ?` : ''
  const binds = statusFilter ? [statusFilter, limit] : [limit]

  const rows = await c.env.DB.prepare(`
    SELECT
      ss.id, ss.customer_id, ss.status, ss.monthly_price_cents,
      ss.trial_started_at, ss.trial_ends_at,
      ss.current_period_start, ss.current_period_end,
      ss.square_subscription_id, ss.card_brand, ss.card_last4,
      ss.comp_until, ss.cancelled_at, ss.created_at,
      c.email, c.name, c.company_name, c.phone,
      (SELECT COUNT(*) FROM secretary_call_logs scl WHERE scl.customer_id = ss.customer_id) AS call_count,
      (SELECT phone_number FROM secretary_phone_pool spp
         WHERE spp.assigned_to_customer_id = ss.customer_id AND spp.status = 'assigned'
         ORDER BY spp.id DESC LIMIT 1) AS phone_number,
      (SELECT provider FROM secretary_phone_pool spp
         WHERE spp.assigned_to_customer_id = ss.customer_id AND spp.status = 'assigned'
         ORDER BY spp.id DESC LIMIT 1) AS phone_provider
    FROM secretary_subscriptions ss
    JOIN customers c ON c.id = ss.customer_id
    ${where}
    ORDER BY ss.id DESC
    LIMIT ?
  `).bind(...binds).all<any>()

  return c.json({ subscriptions: rows.results || [] })
})

// GET /superadmin/secretary/billing-events?customer_id=123&limit=100
adminRoutes.get('/superadmin/secretary/billing-events', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  const customerId = c.req.query('customer_id')
  const limit = Math.min(500, parseInt(c.req.query('limit') || '100', 10))

  const sql = customerId
    ? `SELECT * FROM secretary_billing_events WHERE customer_id = ? ORDER BY id DESC LIMIT ?`
    : `SELECT * FROM secretary_billing_events ORDER BY id DESC LIMIT ?`
  const stmt = customerId
    ? c.env.DB.prepare(sql).bind(customerId, limit)
    : c.env.DB.prepare(sql).bind(limit)

  const rows = await stmt.all<any>()
  return c.json({ events: rows.results || [] })
})

// GET /superadmin/secretary/stats — counts + MRR + conversion rate
adminRoutes.get('/superadmin/secretary/stats', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  // Subscription counts grouped by status. MRR-eligible total excludes
  // comped subs (status='active' but comp_until > now → free access).
  const counts = await c.env.DB.prepare(`
    SELECT status,
           COUNT(*) AS count,
           SUM(CASE
             WHEN comp_until IS NULL OR comp_until <= datetime('now')
             THEN monthly_price_cents ELSE 0
           END) AS billable_cents
    FROM secretary_subscriptions
    GROUP BY status
  `).all<any>()

  // Phone-pool spend is what WE pay Telnyx/Twilio for the numbers — an
  // operational cost, NOT subscriber revenue. Reported separately.
  const phoneNumbers = await c.env.DB.prepare(`
    SELECT provider, COUNT(*) AS count, SUM(monthly_cost_cents_billed) AS total_cents
    FROM secretary_phone_pool
    WHERE status = 'assigned'
    GROUP BY provider
  `).all<any>()

  const convHistory = await c.env.DB.prepare(`
    SELECT COUNT(*) AS converted
    FROM secretary_billing_events
    WHERE event_type = 'converted'
  `).first<any>()

  const trialHistory = await c.env.DB.prepare(`
    SELECT COUNT(*) AS started
    FROM secretary_billing_events
    WHERE event_type = 'trial_started'
  `).first<any>()

  let mrrCents = 0
  for (const r of (counts.results || [])) {
    if (r.status === 'active') mrrCents += Number(r.billable_cents || 0)
  }
  let phoneInfraCents = 0
  for (const r of (phoneNumbers.results || [])) {
    phoneInfraCents += Number(r.total_cents || 0)
  }

  const startedN = Number(trialHistory?.started || 0)
  const convertedN = Number(convHistory?.converted || 0)
  const conversionRate = startedN > 0 ? (convertedN / startedN) : 0

  return c.json({
    by_status: counts.results || [],
    phone_numbers: phoneNumbers.results || [],
    mrr_cents: mrrCents,
    mrr_dollars: mrrCents / 100,
    phone_infra_cents: phoneInfraCents,
    phone_infra_dollars: phoneInfraCents / 100,
    trials_started: startedN,
    trials_converted: convertedN,
    conversion_rate: conversionRate,
  })
})

// POST /superadmin/secretary/:customerId/comp — Set comp_until to grant free access
// Body: { until: "YYYY-MM-DD" }  (omit or null to clear)
adminRoutes.post('/superadmin/secretary/:customerId/comp', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  const customerId = parseInt(c.req.param('customerId'))
  let body: any = {}
  try { body = await c.req.json() } catch {}
  const until: string | null = body.until || null

  const existing = await c.env.DB.prepare(
    `SELECT id FROM secretary_subscriptions WHERE customer_id = ? ORDER BY id DESC LIMIT 1`
  ).bind(customerId).first<any>()

  if (existing) {
    await c.env.DB.prepare(
      `UPDATE secretary_subscriptions SET comp_until = ?, status = CASE WHEN ? IS NOT NULL THEN 'active' ELSE status END, updated_at = datetime('now') WHERE id = ?`
    ).bind(until, until, existing.id).run()
  } else {
    await c.env.DB.prepare(
      `INSERT INTO secretary_subscriptions (customer_id, status, monthly_price_cents, comp_until, created_at, updated_at)
       VALUES (?, ?, 0, ?, datetime('now'), datetime('now'))`
    ).bind(customerId, until ? 'active' : 'pending', until).run()
  }

  await c.env.DB.prepare(
    `INSERT INTO secretary_billing_events (customer_id, event_type, metadata) VALUES (?, 'comp_set', ?)`
  ).bind(customerId, JSON.stringify({ until, admin_id: admin.id })).run()

  return c.json({ success: true, comp_until: until })
})

// ============================================================
// SUPERADMIN: SECRETARY MANAGER — connections panel
// ------------------------------------------------------------
// Endpoints the super-admin-dashboard.js Secretary Manager view depends on.
// Without these, clicking a customer row in the Manager tab silently fails (404).
// ============================================================

// GET /superadmin/secretary-manager/customer/:customerId
// Returns the full bundle the detail view needs.
adminRoutes.get('/superadmin/secretary-manager/customer/:customerId', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  const customerId = parseInt(c.req.param('customerId'))
  if (!customerId) return c.json({ error: 'Invalid customerId' }, 400)

  const customer = await c.env.DB.prepare(
    `SELECT id, email, name, company_name, phone, created_at FROM customers WHERE id = ?`
  ).bind(customerId).first<any>()
  if (!customer) return c.json({ error: 'Customer not found' }, 404)

  const config = await c.env.DB.prepare(
    `SELECT * FROM secretary_config WHERE customer_id = ?`
  ).bind(customerId).first<any>() || {}

  const directories = config.id
    ? (await c.env.DB.prepare(
        `SELECT * FROM secretary_directories WHERE config_id = ? ORDER BY sort_order, id`
      ).bind(config.id).all<any>()).results || []
    : []

  const subscription = await c.env.DB.prepare(
    `SELECT id, status, monthly_price_cents, trial_started_at, trial_ends_at, comp_until,
            current_period_start, current_period_end, card_brand, card_last4,
            square_subscription_id, cancelled_at, created_at, updated_at
     FROM secretary_subscriptions WHERE customer_id = ? ORDER BY id DESC LIMIT 1`
  ).bind(customerId).first<any>() || {}

  const callStats = await c.env.DB.prepare(
    `SELECT
       COUNT(*) as total,
       COALESCE(SUM(call_duration_seconds), 0) as total_seconds,
       SUM(CASE WHEN created_at > datetime('now', '-7 days') THEN 1 ELSE 0 END) as calls_7d,
       SUM(CASE WHEN call_outcome = 'answered' THEN 1 ELSE 0 END) as leads
     FROM secretary_call_logs WHERE customer_id = ?`
  ).bind(customerId).first<any>() || { total: 0, total_seconds: 0, calls_7d: 0, leads: 0 }

  return c.json({ customer, config, directories, subscription, call_stats: callStats })
})

// PUT /superadmin/secretary-manager/customer/:customerId/config
// Accepts the body posted by super-admin-dashboard.js smSaveConfig().
// Updates secretary_config and replaces secretary_directories.
const secretaryManagerConfigHandler = async (c: any) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  const customerId = parseInt(c.req.param('customerId'))
  if (!customerId) return c.json({ error: 'Invalid customerId' }, 400)

  let body: any = {}
  try { body = await c.req.json() } catch {}

  // Whitelist of secretary_config columns the manager view edits.
  const fields: Record<string, any> = {
    agent_name: body.agent_name,
    agent_voice: body.agent_voice,
    secretary_mode: body.secretary_mode,
    is_active: typeof body.is_active === 'number' ? body.is_active : (body.is_active ? 1 : 0),
    connection_status: body.connection_status,
    business_phone: body.business_phone,
    assigned_phone_number: body.assigned_phone_number,
    carrier_name: body.carrier_name,
    forwarding_method: body.forwarding_method,
    answering_forward_number: body.answering_forward_number,
    greeting_script: body.greeting_script,
    common_qa: body.common_qa,
    general_notes: body.general_notes,
    full_can_book_appointments: body.full_can_book_appointments,
    full_can_send_email: body.full_can_send_email,
    full_can_schedule_callback: body.full_can_schedule_callback,
    full_can_answer_faq: body.full_can_answer_faq,
    full_can_take_payment_info: body.full_can_take_payment_info,
    full_booking_link: body.full_booking_link,
    full_services_offered: body.full_services_offered,
    full_pricing_info: body.full_pricing_info,
    full_service_area: body.full_service_area,
    full_business_hours: body.full_business_hours,
    answering_fallback_action: body.answering_fallback_action,
    answering_sms_notify: body.answering_sms_notify,
    answering_email_notify: body.answering_email_notify,
    answering_notify_email: body.answering_notify_email,
    full_email_from_name: body.full_email_from_name,
  }

  // Build dynamic update from non-undefined keys only.
  const setKeys: string[] = []
  const setVals: any[] = []
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue
    setKeys.push(`${k} = ?`)
    setVals.push(v)
  }

  // Ensure a config row exists.
  const existing = await c.env.DB.prepare(`SELECT id FROM secretary_config WHERE customer_id = ?`).bind(customerId).first<any>()
  if (!existing) {
    await c.env.DB.prepare(
      `INSERT INTO secretary_config (customer_id, business_phone, greeting_script, created_at, updated_at)
       VALUES (?, '', '', datetime('now'), datetime('now'))`
    ).bind(customerId).run()
  }

  if (setKeys.length > 0) {
    setKeys.push(`updated_at = datetime('now')`)
    await c.env.DB.prepare(
      `UPDATE secretary_config SET ${setKeys.join(', ')} WHERE customer_id = ?`
    ).bind(...setVals, customerId).run()
  }

  // Replace directories.
  const cfgRow = await c.env.DB.prepare(`SELECT id FROM secretary_config WHERE customer_id = ?`).bind(customerId).first<any>()
  if (cfgRow?.id && Array.isArray(body.directories)) {
    await c.env.DB.prepare(`DELETE FROM secretary_directories WHERE config_id = ?`).bind(cfgRow.id).run()
    for (let i = 0; i < body.directories.length; i++) {
      const d = body.directories[i] || {}
      if (!d.name) continue
      await c.env.DB.prepare(
        `INSERT INTO secretary_directories (customer_id, config_id, name, phone_or_action, special_notes, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(customerId, cfgRow.id, d.name, d.phone_or_action || '', d.special_notes || '', i).run()
    }
  }

  return c.json({ success: true })
}
adminRoutes.put('/superadmin/secretary-manager/customer/:customerId/config', secretaryManagerConfigHandler)
adminRoutes.post('/superadmin/secretary-manager/customer/:customerId/config', secretaryManagerConfigHandler)

// POST /superadmin/secretary-manager/setup-livekit/:customerId
// Wraps deployLiveKitForCustomer for the existing config's assigned_phone_number.
adminRoutes.post('/superadmin/secretary-manager/setup-livekit/:customerId', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  const customerId = parseInt(c.req.param('customerId'))
  if (!customerId) return c.json({ error: 'Invalid customerId' }, 400)

  const cfg = await c.env.DB.prepare(
    `SELECT assigned_phone_number, livekit_inbound_trunk_id, livekit_dispatch_rule_id
     FROM secretary_config WHERE customer_id = ?`
  ).bind(customerId).first<any>()
  if (!cfg?.assigned_phone_number) {
    return c.json({ error: 'Customer has no assigned phone number — assign one first.' }, 400)
  }
  if (cfg.livekit_inbound_trunk_id && cfg.livekit_dispatch_rule_id) {
    return c.json({
      already_configured: true,
      trunk_id: cfg.livekit_inbound_trunk_id,
      dispatch_rule_id: cfg.livekit_dispatch_rule_id,
    })
  }
  try {
    const result = await deployLiveKitForCustomer(c.env, customerId, cfg.assigned_phone_number, { reuse_existing: true })
    return c.json({ success: true, ...result })
  } catch (err: any) {
    return c.json({ error: err?.message || 'LiveKit setup failed' }, 500)
  }
})

// POST /superadmin/secretary/reconcile
// One-shot helper to seed/update a customer's secretary_config + secretary_phone_pool +
// secretary_subscriptions to reflect infrastructure that already exists outside the
// normal /numbers/purchase flow (e.g. the founder's own pre-existing trunk).
//
// Body: {
//   customer_id: number,
//   phone_number: string (E.164),
//   business_phone?: string,
//   livekit_inbound_trunk_id?: string,
//   livekit_dispatch_rule_id?: string,
//   set_status?: 'connected' | 'pending_forwarding' | 'not_connected',
//   set_comp?: boolean   // if true, comp the subscription for 10 years
// }
adminRoutes.post('/superadmin/secretary/reconcile', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  let body: any = {}
  try { body = await c.req.json() } catch {}
  const customerId = parseInt(body.customer_id)
  const phoneNumber = (body.phone_number || '').toString().trim()
  if (!customerId || !phoneNumber) return c.json({ error: 'customer_id and phone_number are required' }, 400)

  const customer = await c.env.DB.prepare(`SELECT id FROM customers WHERE id = ?`).bind(customerId).first<any>()
  if (!customer) return c.json({ error: 'Customer not found' }, 404)

  const businessPhone = body.business_phone || ''
  const trunkId = body.livekit_inbound_trunk_id || ''
  const dispatchId = body.livekit_dispatch_rule_id || ''
  const setStatus = body.set_status || 'connected'

  // Ensure phone is in pool.
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO secretary_phone_pool
     (phone_number, region, status, assigned_to_customer_id, assigned_at, sip_trunk_id, dispatch_rule_id, provider, monthly_cost_cents_billed, purchased_at)
     VALUES (?, '', 'assigned', ?, datetime('now'), ?, ?, 'telnyx', 0, datetime('now'))`
  ).bind(phoneNumber, customerId, trunkId, dispatchId).run()
  await c.env.DB.prepare(
    `UPDATE secretary_phone_pool
     SET status = 'assigned', assigned_to_customer_id = ?,
         sip_trunk_id = COALESCE(NULLIF(?, ''), sip_trunk_id),
         dispatch_rule_id = COALESCE(NULLIF(?, ''), dispatch_rule_id),
         provider = COALESCE(provider, 'telnyx'),
         updated_at = datetime('now')
     WHERE phone_number = ?`
  ).bind(customerId, trunkId, dispatchId, phoneNumber).run()

  // Ensure secretary_config row exists.
  const cfgExisting = await c.env.DB.prepare(`SELECT id FROM secretary_config WHERE customer_id = ?`).bind(customerId).first<any>()
  if (!cfgExisting) {
    await c.env.DB.prepare(
      `INSERT INTO secretary_config (
         customer_id, business_phone, assigned_phone_number,
         livekit_inbound_trunk_id, livekit_dispatch_rule_id,
         connection_status, is_active, secretary_mode, agent_name, forwarding_method,
         greeting_script, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'full', 'Sarah', 'livekit_number', '', datetime('now'), datetime('now'))`
    ).bind(customerId, businessPhone, phoneNumber, trunkId, dispatchId, setStatus).run()
  } else {
    await c.env.DB.prepare(
      `UPDATE secretary_config
       SET business_phone = COALESCE(NULLIF(?, ''), business_phone),
           assigned_phone_number = ?,
           livekit_inbound_trunk_id = COALESCE(NULLIF(?, ''), livekit_inbound_trunk_id),
           livekit_dispatch_rule_id = COALESCE(NULLIF(?, ''), livekit_dispatch_rule_id),
           connection_status = ?,
           is_active = 1,
           updated_at = datetime('now')
       WHERE customer_id = ?`
    ).bind(businessPhone, phoneNumber, trunkId, dispatchId, setStatus, customerId).run()
  }

  // Optionally comp the subscription so they're never charged.
  if (body.set_comp) {
    const sub = await c.env.DB.prepare(`SELECT id FROM secretary_subscriptions WHERE customer_id = ? ORDER BY id DESC LIMIT 1`).bind(customerId).first<any>()
    if (sub?.id) {
      await c.env.DB.prepare(
        `UPDATE secretary_subscriptions SET status = 'active', comp_until = datetime('now', '+10 years'), updated_at = datetime('now') WHERE id = ?`
      ).bind(sub.id).run()
    } else {
      await c.env.DB.prepare(
        `INSERT INTO secretary_subscriptions (customer_id, status, monthly_price_cents, comp_until, created_at, updated_at)
         VALUES (?, 'active', 19900, datetime('now', '+10 years'), datetime('now'), datetime('now'))`
      ).bind(customerId).run()
    }
  }

  await c.env.DB.prepare(
    `INSERT INTO secretary_billing_events (customer_id, event_type, metadata) VALUES (?, 'reconciled', ?)`
  ).bind(customerId, JSON.stringify({
    phone_number: phoneNumber, trunk_id: trunkId, dispatch_rule_id: dispatchId,
    set_status: setStatus, set_comp: !!body.set_comp, admin_id: admin.id,
  })).run()

  return c.json({
    success: true,
    customer_id: customerId,
    phone_number: phoneNumber,
    trunk_id: trunkId,
    dispatch_rule_id: dispatchId,
    connection_status: setStatus,
    comped: !!body.set_comp,
  })
})

// ============================================================
// SUPERADMIN: PHONE NUMBER MANAGEMENT
// ============================================================

// GET /superadmin/phone-numbers/available — Search Twilio available numbers
adminRoutes.get('/superadmin/phone-numbers/available', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  const country = c.req.query('country') || 'CA'
  const areaCode = c.req.query('area_code') || ''

  const twilioSid = (c.env as any).TWILIO_ACCOUNT_SID
  const twilioAuth = (c.env as any).TWILIO_AUTH_TOKEN
  if (!twilioSid || !twilioAuth) {
    return c.json({ error: 'Phone provider not configured. Contact admin.', numbers: [] })
  }

  try {
    let path = `/AvailablePhoneNumbers/${country}/Local?VoiceEnabled=true&PageSize=10`
    if (areaCode) path += `&AreaCode=${areaCode}`
    const url = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}${path}.json`
    const resp = await fetch(url, { headers: { 'Authorization': `Basic ${btoa(`${twilioSid}:${twilioAuth}`)}` } })
    const data = await resp.json() as any
    if (data.status >= 400) return c.json({ error: data.message || 'Twilio API error', numbers: [] })
    const numbers = (data.available_phone_numbers || []).map((n: any) => ({
      phone_number: n.phone_number,
      friendly_name: n.friendly_name,
      locality: n.locality,
      region: n.region,
    }))
    return c.json({ numbers })
  } catch (err: any) {
    return c.json({ error: 'Failed to search numbers: ' + err.message, numbers: [] }, 500)
  }
})

// POST /superadmin/phone-numbers/purchase — Buy from Twilio + add to phone pool
adminRoutes.post('/superadmin/phone-numbers/purchase', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  const { phone_number, purpose } = await c.req.json()
  if (!phone_number) return c.json({ error: 'phone_number is required' }, 400)

  const twilioSid = (c.env as any).TWILIO_ACCOUNT_SID
  const twilioAuth = (c.env as any).TWILIO_AUTH_TOKEN
  if (!twilioSid || !twilioAuth) return c.json({ error: 'Twilio not configured' }, 503)

  try {
    const params = new URLSearchParams({
      PhoneNumber: phone_number,
      FriendlyName: 'Roof Manager Secretary - Pool',
    })
    const url = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/IncomingPhoneNumbers.json`
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${twilioSid}:${twilioAuth}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })
    const data = await resp.json() as any
    if (!resp.ok) return c.json({ error: data.message || 'Twilio purchase failed' }, 400)

    const sid = data.sid || ''
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO secretary_phone_pool (phone_number, phone_sid, region, status, monthly_cost_cents, created_at, updated_at)
       VALUES (?, ?, 'CA', 'available', 200, datetime('now'), datetime('now'))`
    ).bind(phone_number, sid).run()

    return c.json({ success: true, phone_number, phone_sid: sid })
  } catch (err: any) {
    return c.json({ error: 'Purchase failed: ' + err.message }, 500)
  }
})

// POST /superadmin/phone-pool/add — Manually add a number to the pool without Twilio purchase
adminRoutes.post('/superadmin/phone-pool/add', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  const { phone_number, region } = await c.req.json()
  if (!phone_number) return c.json({ error: 'phone_number is required' }, 400)

  try {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO secretary_phone_pool (phone_number, region, status, monthly_cost_cents, created_at, updated_at)
       VALUES (?, ?, 'available', 200, datetime('now'), datetime('now'))`
    ).bind(phone_number, region || 'CA').run()
    return c.json({ success: true, phone_number })
  } catch (err: any) {
    return c.json({ error: 'Failed to add number: ' + err.message }, 500)
  }
})

// POST /superadmin/phone-pool/assign — Assign pool number to a customer + optional LiveKit deploy
adminRoutes.post('/superadmin/phone-pool/assign', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  const { phone_number, customer_id, deploy_livekit } = await c.req.json()
  if (!phone_number || !customer_id) return c.json({ error: 'phone_number and customer_id are required' }, 400)

  try {
    await c.env.DB.prepare(
      `UPDATE secretary_phone_pool SET status = 'assigned', assigned_to_customer_id = ?, assigned_at = datetime('now'), updated_at = datetime('now') WHERE phone_number = ?`
    ).bind(customer_id, phone_number).run()

    const existing = await c.env.DB.prepare('SELECT id FROM secretary_config WHERE customer_id = ?').bind(customer_id).first<any>()
    if (existing) {
      await c.env.DB.prepare(
        `UPDATE secretary_config SET assigned_phone_number = ?, is_active = 1, updated_at = datetime('now') WHERE customer_id = ?`
      ).bind(phone_number, customer_id).run()
    } else {
      await c.env.DB.prepare(
        `INSERT INTO secretary_config (customer_id, assigned_phone_number, business_phone, greeting_script, is_active, connection_status, forwarding_method, created_at, updated_at)
         VALUES (?, ?, '', '', 1, 'pending_forwarding', 'livekit_number', datetime('now'), datetime('now'))`
      ).bind(customer_id, phone_number).run()
    }

    let livekit: any = null
    if (deploy_livekit) {
      livekit = await deployLiveKitForCustomer(c.env, customer_id, phone_number, { reuse_existing: false })
    }

    return c.json({ success: true, phone_number, customer_id, livekit_deployed: livekit?.success || false, livekit })
  } catch (err: any) {
    return c.json({ error: 'Assign failed: ' + err.message }, 500)
  }
})

// POST /superadmin/secretary/:customerId/update-phone — Set/change agent phone number + optional redeploy
adminRoutes.post('/superadmin/secretary/:customerId/update-phone', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  const customerId = parseInt(c.req.param('customerId'))
  const { agent_phone_number, deploy_livekit, sip_uri, sip_username, sip_password } = await c.req.json()
  if (!agent_phone_number) return c.json({ error: 'agent_phone_number is required' }, 400)

  try {
    const existing = await c.env.DB.prepare('SELECT id FROM secretary_config WHERE customer_id = ?').bind(customerId).first<any>()
    // Encrypt SIP credentials at rest.
    const encSipUser = sip_username !== undefined ? await encryptSecret(c.env, sip_username) : undefined
    const encSipPass = sip_password !== undefined ? await encryptSecret(c.env, sip_password) : undefined
    if (existing) {
      const updates: string[] = [`assigned_phone_number = ?`, `updated_at = datetime('now')`]
      const binds: any[] = [agent_phone_number]
      if (sip_uri !== undefined) { updates.push('livekit_sip_uri = ?'); binds.push(sip_uri) }
      if (encSipUser !== undefined) { updates.push('sip_username = ?'); binds.push(encSipUser) }
      if (encSipPass !== undefined) { updates.push('sip_password = ?'); binds.push(encSipPass) }
      binds.push(customerId)
      await c.env.DB.prepare(`UPDATE secretary_config SET ${updates.join(', ')} WHERE customer_id = ?`).bind(...binds).run()
    } else {
      await c.env.DB.prepare(
        `INSERT INTO secretary_config (customer_id, assigned_phone_number, livekit_sip_uri, sip_username, sip_password, business_phone, greeting_script, is_active, connection_status, forwarding_method, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '', '', 1, 'pending_forwarding', 'livekit_number', datetime('now'), datetime('now'))`
      ).bind(customerId, agent_phone_number, sip_uri || '', encSipUser || '', encSipPass || '').run()
    }

    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO secretary_phone_pool (phone_number, region, status, assigned_to_customer_id, assigned_at) VALUES (?, 'CA', 'assigned', ?, datetime('now'))`
    ).bind(agent_phone_number, customerId).run()

    let livekit: any = null
    if (deploy_livekit) {
      livekit = await deployLiveKitForCustomer(c.env, customerId, agent_phone_number, {
        sip_username: sip_username || undefined,
        sip_password: sip_password || undefined,
        reuse_existing: false,
      })
    }

    return c.json({ success: true, customer_id: customerId, agent_phone_number, livekit })
  } catch (err: any) {
    return c.json({ error: 'Update failed: ' + err.message }, 500)
  }
})

// GET /superadmin/secretary/deployment-status — All customers' LiveKit SIP trunk deployment status
adminRoutes.get('/superadmin/secretary/deployment-status', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  try {
    const rows = await c.env.DB.prepare(`
      SELECT
        c.id, c.name as contact_name, c.email, c.company_name as business_name,
        sc.is_active as secretary_active, sc.secretary_mode,
        sc.assigned_phone_number as agent_phone,
        sc.livekit_inbound_trunk_id as trunk_id,
        sc.livekit_dispatch_rule_id as dispatch_id,
        sc.livekit_sip_uri as sip_uri,
        sc.sip_username, sc.connection_status, sc.forwarding_method,
        sc.last_test_at, sc.last_test_result
      FROM customers c
      INNER JOIN secretary_config sc ON sc.customer_id = c.id
      WHERE c.is_active = 1
      ORDER BY c.created_at DESC
    `).all<any>()
    // Mask encrypted sip_username before returning — the dashboard only
    // needs to show presence, not the raw (encrypted-at-rest) blob.
    const { maskSecret } = await import('../lib/secret-vault')
    const deployments = ((rows.results || []) as any[]).map((r) => ({
      ...r,
      sip_username: r.sip_username ? maskSecret(r.sip_username) : '',
    }))
    return c.json({ deployments })
  } catch (err: any) {
    return c.json({ error: err.message, deployments: [] }, 500)
  }
})

// ============================================================
// SUPERADMIN: GEMINI AI COMMAND CENTER CHAT
// ============================================================

// NOTE: Full Gemini chat is handled by /api/gemini (geminiRoutes) which is mounted in index.tsx
// This stub ensures the superadmin dashboard's saFetch calls to /api/admin/superadmin/gemini-chat still work
adminRoutes.post('/superadmin/gemini-chat', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  const { message, history = [] } = await c.req.json()
  if (!message?.trim()) return c.json({ error: 'Message required' }, 400)

  const apiKey = (c.env as any).GEMINI_API_KEY || (c.env as any).GEMINI_ENHANCE_API_KEY
  if (!apiKey) return c.json({ error: 'AI service not configured. Contact admin.' }, 503)

  const systemContext = `You are an AI assistant for the Roof Manager platform super admin dashboard.
You help the super admin understand platform metrics, troubleshoot issues, draft content, and manage the business.
Keep responses concise and actionable. Current date: ${new Date().toISOString().split('T')[0]}.`

  const contents = [
    ...(history as any[]).map((h: any) => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] })),
    { role: 'user', parts: [{ text: message }] }
  ]

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system_instruction: { parts: [{ text: systemContext }] }, contents })
      }
    )
    const data = await res.json() as any
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from Gemini.'
    return c.json({ reply, model: 'gemini-2.0-flash' })
  } catch (err: any) {
    return c.json({ error: 'Gemini request failed', details: err.message }, 500)
  }
})

// ============================================================
// AREA 1: CUSTOMER OPERATIONS
// ============================================================

// Search customers
adminRoutes.get('/superadmin/users/search', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const q = c.req.query('q') || ''
  if (!q || q.length < 2) return c.json({ customers: [] })
  const like = `%${q}%`
  const rows = await c.env.DB.prepare(
    `SELECT id, name, email, company_name, phone, is_active, report_credits, credits_used, free_trial_total, free_trial_used, subscription_plan, created_at
     FROM customers WHERE (email LIKE ? OR name LIKE ? OR company_name LIKE ?) AND is_active = 1 ORDER BY created_at DESC LIMIT 50`
  ).bind(like, like, like).all<any>()
  return c.json({ customers: rows.results || [] })
})

// Edit customer
adminRoutes.put('/superadmin/users/:id', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const id = parseInt(c.req.param('id'))
  const { name, email, company_name, phone, subscription_plan, report_credits } = await c.req.json()
  const updates: string[] = []
  const vals: any[] = []
  if (name !== undefined) { updates.push('name=?'); vals.push(name) }
  if (email !== undefined) { updates.push('email=?'); vals.push(email) }
  if (company_name !== undefined) { updates.push('company_name=?'); vals.push(company_name) }
  if (phone !== undefined) { updates.push('phone=?'); vals.push(phone) }
  if (subscription_plan !== undefined) { updates.push('subscription_plan=?'); vals.push(subscription_plan) }
  if (report_credits !== undefined) { updates.push('report_credits=?'); vals.push(report_credits) }
  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400)
  updates.push('updated_at=datetime("now")')
  vals.push(id)
  await c.env.DB.prepare(`UPDATE customers SET ${updates.join(', ')} WHERE id=?`).bind(...vals).run()
  return c.json({ success: true })
})

// Adjust credits
adminRoutes.post('/superadmin/users/:id/adjust-credits', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const id = parseInt(c.req.param('id'))
  const { amount, reason } = await c.req.json()
  if (!amount || typeof amount !== 'number') return c.json({ error: 'amount required (positive to add, negative to remove)' }, 400)
  if (amount > 0) {
    await c.env.DB.prepare('UPDATE customers SET report_credits = report_credits + ?, updated_at = datetime("now") WHERE id = ?').bind(amount, id).run()
  } else {
    await c.env.DB.prepare('UPDATE customers SET credits_used = credits_used + ?, updated_at = datetime("now") WHERE id = ?').bind(Math.abs(amount), id).run()
  }
  await c.env.DB.prepare('INSERT INTO user_activity_log (company_id, action, details) VALUES (1, ?, ?)').bind('admin_credit_adjustment', `Admin adjusted ${amount} credits for customer #${id}: ${reason || 'No reason'}`).run()
  const updated = await c.env.DB.prepare('SELECT report_credits, credits_used FROM customers WHERE id=?').bind(id).first<any>()
  return c.json({ success: true, report_credits: updated?.report_credits || 0, credits_used: updated?.credits_used || 0, remaining: (updated?.report_credits || 0) - (updated?.credits_used || 0) })
})

// Suspend customer
adminRoutes.post('/superadmin/users/:id/suspend', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const id = parseInt(c.req.param('id'))
  await c.env.DB.prepare('UPDATE customers SET is_active = 0, updated_at = datetime("now") WHERE id = ?').bind(id).run()
  return c.json({ success: true, message: 'Customer suspended' })
})

// Reactivate customer
adminRoutes.post('/superadmin/users/:id/reactivate', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const id = parseInt(c.req.param('id'))
  await c.env.DB.prepare('UPDATE customers SET is_active = 1, updated_at = datetime("now") WHERE id = ?').bind(id).run()
  return c.json({ success: true, message: 'Customer reactivated' })
})

// Delete customer (soft)
adminRoutes.delete('/superadmin/users/:id', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const id = parseInt(c.req.param('id'))
  // P1-23: snapshot before soft-delete so the audit log captures prior state.
  const before = await c.env.DB.prepare('SELECT id, email, name, is_active FROM customers WHERE id = ?').bind(id).first<any>()
  await c.env.DB.prepare('UPDATE customers SET is_active = 0, email = "deleted_" || id || "_" || email, updated_at = datetime("now") WHERE id = ?').bind(id).run()
  await logAdminAction(c.env.DB, {
    admin: { id: admin.id, email: admin.email },
    action: 'customer.soft_delete',
    targetType: 'customer',
    targetId: id,
    before,
    ip: clientIp(c),
  })
  return c.json({ success: true, message: 'Customer soft-deleted' })
})

// Refund
adminRoutes.post('/superadmin/users/:id/refund', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const id = parseInt(c.req.param('id'))
  const { payment_id, credits_to_remove, reason } = await c.req.json()
  if (payment_id) {
    await c.env.DB.prepare("UPDATE square_payments SET status = 'refunded', updated_at = datetime('now') WHERE id = ? AND customer_id = ?").bind(payment_id, id).run()
  }
  if (credits_to_remove && credits_to_remove > 0) {
    await c.env.DB.prepare('UPDATE customers SET report_credits = MAX(0, report_credits - ?), updated_at = datetime("now") WHERE id = ?').bind(credits_to_remove, id).run()
  }
  await c.env.DB.prepare('INSERT INTO user_activity_log (company_id, action, details) VALUES (1, ?, ?)').bind('admin_refund', `Admin refunded customer #${id}: ${reason || ''}, credits removed: ${credits_to_remove || 0}`).run()
  // P1-23: structured audit log with before/after for post-hoc review.
  await logAdminAction(c.env.DB, {
    admin: { id: admin.id, email: admin.email },
    action: 'customer.refund',
    targetType: 'customer',
    targetId: id,
    after: { payment_id, credits_to_remove: credits_to_remove || 0, reason: reason || '' },
    ip: clientIp(c),
  })
  return c.json({ success: true })
})

// CSV Export — customers
adminRoutes.get('/superadmin/users/export', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const rows = await c.env.DB.prepare('SELECT id, name, email, company_name, phone, subscription_plan, report_credits, credits_used, free_trial_total, free_trial_used, is_active, created_at FROM customers ORDER BY created_at DESC').all<any>()
  let csv = 'ID,Name,Email,Company,Phone,Plan,Credits,Used,Free Trial,Free Used,Active,Created\n'
  for (const r of (rows.results || []) as any[]) {
    csv += `${r.id},"${(r.name||'').replace(/"/g,'""')}","${r.email||''}","${(r.company_name||'').replace(/"/g,'""')}","${r.phone||''}","${r.subscription_plan||''}",${r.report_credits||0},${r.credits_used||0},${r.free_trial_total||0},${r.free_trial_used||0},${r.is_active},${r.created_at||''}\n`
  }
  return c.text(csv, 200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="customers-export.csv"' })
})

// CSV Export — orders
adminRoutes.get('/superadmin/orders/export', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const rows = await c.env.DB.prepare('SELECT o.id, o.order_number, o.property_address, o.status, o.payment_status, o.price, o.service_tier, o.is_trial, o.created_at, c.name as customer_name, c.email as customer_email FROM orders o LEFT JOIN customers c ON c.id = o.customer_id ORDER BY o.created_at DESC LIMIT 5000').all<any>()
  let csv = 'ID,Order Number,Address,Status,Payment,Price,Tier,Trial,Created,Customer,Email\n'
  for (const r of (rows.results || []) as any[]) {
    csv += `${r.id},"${r.order_number||''}","${(r.property_address||'').replace(/"/g,'""')}","${r.status||''}","${r.payment_status||''}",${r.price||0},"${r.service_tier||''}",${r.is_trial||0},${r.created_at||''},"${(r.customer_name||'').replace(/"/g,'""')}","${r.customer_email||''}"\n`
  }
  return c.text(csv, 200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="orders-export.csv"' })
})

// ============================================================
// AREA 2: LIVEKIT / TELEPHONY MANAGEMENT
// ============================================================

// Telephony status
adminRoutes.get('/superadmin/telephony-status', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const lkConfigured = !!(c.env as any).LIVEKIT_API_KEY && !!(c.env as any).LIVEKIT_URL
  const trunks = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM secretary_config WHERE livekit_inbound_trunk_id IS NOT NULL AND livekit_inbound_trunk_id != ''").first<any>()
  const dispatches = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM secretary_config WHERE livekit_dispatch_rule_id IS NOT NULL AND livekit_dispatch_rule_id != ''").first<any>()
  const phones = await c.env.DB.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status='assigned' THEN 1 ELSE 0 END) as assigned, SUM(CASE WHEN status='available' THEN 1 ELSE 0 END) as available FROM secretary_phone_pool").first<any>()
  const activeAgents = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM secretary_config WHERE is_active = 1").first<any>()
  return c.json({ livekit_configured: lkConfigured, livekit_url: (c.env as any).LIVEKIT_URL || '', sip_uri: (c.env as any).LIVEKIT_SIP_URI || '', total_trunks: trunks?.cnt || 0, total_dispatch_rules: dispatches?.cnt || 0, phone_numbers: { total: phones?.total || 0, assigned: phones?.assigned || 0, available: phones?.available || 0 }, active_agents: activeAgents?.cnt || 0 })
})

// LiveKit overview
adminRoutes.get('/superadmin/livekit/overview', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const configs = await c.env.DB.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) as active FROM secretary_config").first<any>()
  const calls30d = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM secretary_call_logs WHERE created_at > datetime('now', '-30 days')").first<any>()
  const phones = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM secretary_phone_pool").first<any>()
  return c.json({ livekit_url: (c.env as any).LIVEKIT_URL || '', sip_uri: (c.env as any).LIVEKIT_SIP_URI || '', configured: !!(c.env as any).LIVEKIT_API_KEY, total_configs: configs?.total || 0, active_configs: configs?.active || 0, calls_30d: calls30d?.cnt || 0, phone_pool_size: phones?.cnt || 0 })
})

// Secretary configs list
adminRoutes.get('/superadmin/livekit/secretary-configs', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const rows = await c.env.DB.prepare(
    `SELECT sc.*, c.name as customer_name, c.email as customer_email, c.company_name
     FROM secretary_config sc LEFT JOIN customers c ON c.id = sc.customer_id ORDER BY sc.updated_at DESC`
  ).all<any>()
  return c.json({ configs: rows.results || [] })
})

// Phone pool
adminRoutes.get('/superadmin/livekit/phone-pool', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const rows = await c.env.DB.prepare(
    `SELECT p.*, c.name as customer_name, c.email as customer_email
     FROM secretary_phone_pool p LEFT JOIN customers c ON c.id = p.assigned_to_customer_id ORDER BY p.created_at DESC`
  ).all<any>()
  return c.json({ phones: rows.results || [] })
})

// Add phone to pool
adminRoutes.post('/superadmin/livekit/phone-pool/add', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const { phone_number, region } = await c.req.json()
  if (!phone_number) return c.json({ error: 'phone_number required' }, 400)
  await c.env.DB.prepare("INSERT OR IGNORE INTO secretary_phone_pool (phone_number, region, status, assigned_at) VALUES (?, ?, 'available', datetime('now'))").bind(phone_number, region || 'CA').run()
  return c.json({ success: true })
})

// Release phone from customer
adminRoutes.post('/superadmin/livekit/phone-pool/release', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const { phone_number } = await c.req.json()
  await c.env.DB.prepare("UPDATE secretary_phone_pool SET status = 'available', assigned_to_customer_id = NULL, updated_at = datetime('now') WHERE phone_number = ?").bind(phone_number).run()
  return c.json({ success: true })
})

// Toggle secretary config
adminRoutes.post('/superadmin/livekit/secretary-config/toggle', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const { customer_id, enabled } = await c.req.json()
  await c.env.DB.prepare('UPDATE secretary_config SET is_active = ?, updated_at = datetime("now") WHERE customer_id = ?').bind(enabled ? 1 : 0, customer_id).run()
  return c.json({ success: true })
})

// Get customer secretary config
adminRoutes.get('/superadmin/livekit/secretary-config/:customerId', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const config = await c.env.DB.prepare('SELECT sc.*, c.name, c.email, c.company_name FROM secretary_config sc LEFT JOIN customers c ON c.id = sc.customer_id WHERE sc.customer_id = ?').bind(parseInt(c.req.param('customerId'))).first<any>()
  if (!config) return c.json({ error: 'Config not found' }, 404)
  const dirs = await c.env.DB.prepare('SELECT * FROM secretary_directories WHERE config_id = ? ORDER BY sort_order').bind(config.id).all<any>()
  return c.json({ config, directories: dirs.results || [] })
})

// Create SIP trunk via LiveKit
adminRoutes.post('/superadmin/livekit/trunk/create', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const { customer_id, phone_number } = await c.req.json()
  if (!customer_id || !phone_number) return c.json({ error: 'customer_id and phone_number required' }, 400)
  try {
    const result = await deployLiveKitForCustomer(c.env, customer_id, phone_number)
    return c.json(result)
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// Delete SIP trunk
adminRoutes.post('/superadmin/livekit/trunk/delete', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const { trunk_id, customer_id } = await c.req.json()
  const apiKey = (c.env as any).LIVEKIT_API_KEY; const apiSecret = (c.env as any).LIVEKIT_API_SECRET; const livekitUrl = (c.env as any).LIVEKIT_URL
  if (!apiKey || !apiSecret || !livekitUrl) return c.json({ error: 'LiveKit not configured' }, 500)
  try {
    const result = await adminLivekitAPI(apiKey, apiSecret, livekitUrl, '/twirp/livekit.SIP/DeleteSIPTrunk', { sip_trunk_id: trunk_id })
    if (customer_id) await c.env.DB.prepare("UPDATE secretary_config SET livekit_inbound_trunk_id = '', connection_status = 'not_connected', updated_at = datetime('now') WHERE customer_id = ?").bind(customer_id).run()
    // P1-23 destructive action audit.
    await logAdminAction(c.env.DB, {
      admin: { id: admin.id, email: admin.email },
      action: 'livekit.trunk.delete',
      targetType: 'sip_trunk',
      targetId: trunk_id,
      before: { customer_id },
      ip: clientIp(c),
    })
    return c.json({ success: true, result })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// Delete dispatch rule
adminRoutes.post('/superadmin/livekit/dispatch/delete', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const { dispatch_rule_id, customer_id } = await c.req.json()
  const apiKey = (c.env as any).LIVEKIT_API_KEY; const apiSecret = (c.env as any).LIVEKIT_API_SECRET; const livekitUrl = (c.env as any).LIVEKIT_URL
  if (!apiKey || !apiSecret || !livekitUrl) return c.json({ error: 'LiveKit not configured' }, 500)
  try {
    const result = await adminLivekitAPI(apiKey, apiSecret, livekitUrl, '/twirp/livekit.SIP/DeleteSIPDispatchRule', { sip_dispatch_rule_id: dispatch_rule_id })
    if (customer_id) await c.env.DB.prepare("UPDATE secretary_config SET livekit_dispatch_rule_id = '', updated_at = datetime('now') WHERE customer_id = ?").bind(customer_id).run()
    // P1-23 destructive action audit.
    await logAdminAction(c.env.DB, {
      admin: { id: admin.id, email: admin.email },
      action: 'livekit.dispatch.delete',
      targetType: 'dispatch_rule',
      targetId: dispatch_rule_id,
      before: { customer_id },
      ip: clientIp(c),
    })
    return c.json({ success: true, result })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// Phone numbers — owned
adminRoutes.get('/superadmin/phone-numbers/owned', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const rows = await c.env.DB.prepare('SELECT p.*, c.name as customer_name FROM secretary_phone_pool p LEFT JOIN customers c ON c.id = p.assigned_to_customer_id ORDER BY p.created_at DESC').all<any>()
  return c.json({ phones: rows.results || [] })
})

// ============================================================
// AREA 3: SYSTEM HEALTH & MONITORING
// ============================================================

// System health
adminRoutes.get('/superadmin/system-health', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)

  const env = c.env as any
  const out: Record<string, any> = { generated_at: new Date().toISOString() }

  // Database — timed liveness probe
  try {
    const t0 = Date.now()
    const r = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM customers').first<any>()
    out.database = { status: 'ok', customers: r?.cnt || 0, latency_ms: Date.now() - t0 }
  } catch (e: any) {
    out.database = { status: 'error', error: e.message, latency_ms: null }
  }

  // Activity windows — orders / signups / leads / reports at 24h, 7d, 30d
  out.activity = {
    orders_24h: 0, orders_7d: 0, orders_30d: 0,
    signups_24h: 0, signups_7d: 0, signups_30d: 0,
    leads_24h: 0, leads_7d: 0,
    reports_24h: 0, reports_7d: 0,
  }
  try {
    const rows = await c.env.DB.batch([
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE created_at > datetime('now', '-1 day')"),
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE created_at > datetime('now', '-7 days')"),
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE created_at > datetime('now', '-30 days')"),
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM customers WHERE created_at > datetime('now', '-1 day')"),
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM customers WHERE created_at > datetime('now', '-7 days')"),
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM customers WHERE created_at > datetime('now', '-30 days')"),
    ]) as any[]
    out.activity.orders_24h = rows[0].results?.[0]?.cnt || 0
    out.activity.orders_7d = rows[1].results?.[0]?.cnt || 0
    out.activity.orders_30d = rows[2].results?.[0]?.cnt || 0
    out.activity.signups_24h = rows[3].results?.[0]?.cnt || 0
    out.activity.signups_7d = rows[4].results?.[0]?.cnt || 0
    out.activity.signups_30d = rows[5].results?.[0]?.cnt || 0
  } catch {}
  try {
    const r1 = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM leads WHERE created_at > datetime('now', '-1 day')").first<any>()
    const r2 = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM leads WHERE created_at > datetime('now', '-7 days')").first<any>()
    out.activity.leads_24h = r1?.cnt || 0
    out.activity.leads_7d = r2?.cnt || 0
  } catch {}
  try {
    const r1 = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM reports WHERE created_at > datetime('now', '-1 day')").first<any>()
    const r2 = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM reports WHERE created_at > datetime('now', '-7 days')").first<any>()
    out.activity.reports_24h = r1?.cnt || 0
    out.activity.reports_7d = r2?.cnt || 0
  } catch {}

  // Errors / unhealthy state
  out.errors = { failed_orders_7d: 0, unprocessed_webhooks_7d: 0 }
  try {
    const r = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status = 'failed' AND created_at > datetime('now', '-7 days')").first<any>()
    out.errors.failed_orders_7d = r?.cnt || 0
  } catch {}
  try {
    const r = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM webhook_logs WHERE processed = 0 AND created_at > datetime('now', '-7 days')").first<any>()
    out.errors.unprocessed_webhooks_7d = r?.cnt || 0
  } catch {}

  // Subscriptions / MRR (secretary_subscriptions is the source of truth)
  out.subscriptions = { active: 0, trial: 0, past_due: 0, mrr_cents: 0, arr_cents: 0 }
  try {
    const rows = await c.env.DB.batch([
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM secretary_subscriptions WHERE status='active'"),
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM secretary_subscriptions WHERE status='trial' OR status='trialing'"),
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM secretary_subscriptions WHERE status='past_due'"),
      c.env.DB.prepare("SELECT COALESCE(SUM(monthly_price_cents),0) as mrr FROM secretary_subscriptions WHERE status='active'"),
    ]) as any[]
    out.subscriptions.active = rows[0].results?.[0]?.cnt || 0
    out.subscriptions.trial = rows[1].results?.[0]?.cnt || 0
    out.subscriptions.past_due = rows[2].results?.[0]?.cnt || 0
    out.subscriptions.mrr_cents = rows[3].results?.[0]?.mrr || 0
    out.subscriptions.arr_cents = (out.subscriptions.mrr_cents as number) * 12
  } catch {}

  // Telephony / LiveKit health
  out.telephony = { phones_assigned: 0, phones_available: 0, phones_total: 0, agents_total: 0, agents_connected: 0 }
  try {
    const a = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM secretary_phone_pool WHERE status='assigned'").first<any>()
    const v = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM secretary_phone_pool WHERE status='available'").first<any>()
    const t = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM secretary_phone_pool").first<any>()
    out.telephony.phones_assigned = a?.cnt || 0
    out.telephony.phones_available = v?.cnt || 0
    out.telephony.phones_total = t?.cnt || 0
  } catch {}
  try {
    const total = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM secretary_config WHERE is_active = 1").first<any>()
    const conn = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM secretary_config WHERE is_active = 1 AND connection_status = 'connected'").first<any>()
    out.telephony.agents_total = total?.cnt || 0
    out.telephony.agents_connected = conn?.cnt || 0
  } catch {}

  // Integration health — env-var presence grouped by service category
  const presence = (k: string) => !!env[k]
  out.integrations = [
    {
      name: 'Payments',
      icon: 'fa-credit-card',
      keys: [
        { key: 'SQUARE_ACCESS_TOKEN', present: presence('SQUARE_ACCESS_TOKEN') },
        { key: 'SQUARE_WEBHOOK_SIGNATURE_KEY', present: presence('SQUARE_WEBHOOK_SIGNATURE_KEY') },
        { key: 'SQUARE_WEBHOOK_URL', present: presence('SQUARE_WEBHOOK_URL') },
        { key: 'STRIPE_SECRET_KEY', present: presence('STRIPE_SECRET_KEY') },
      ],
    },
    {
      name: 'AI / Vision',
      icon: 'fa-brain',
      keys: [
        { key: 'GEMINI_API_KEY', present: presence('GEMINI_API_KEY') },
        { key: 'CLOUD_RUN_URL', present: presence('CLOUD_RUN_URL') },
        { key: 'CLOUD_RUN_API_KEY', present: presence('CLOUD_RUN_API_KEY') },
      ],
    },
    {
      name: 'Voice / LiveKit',
      icon: 'fa-microphone',
      keys: [
        { key: 'LIVEKIT_URL', present: presence('LIVEKIT_URL') },
        { key: 'LIVEKIT_API_KEY', present: presence('LIVEKIT_API_KEY') },
        { key: 'LIVEKIT_API_SECRET', present: presence('LIVEKIT_API_SECRET') },
        { key: 'SIP_OUTBOUND_TRUNK_ID', present: presence('SIP_OUTBOUND_TRUNK_ID') },
      ],
    },
    {
      name: 'Maps / Solar',
      icon: 'fa-map-marked-alt',
      keys: [
        { key: 'GOOGLE_MAPS_API_KEY', present: presence('GOOGLE_MAPS_API_KEY') },
        { key: 'GOOGLE_SOLAR_API_KEY', present: presence('GOOGLE_SOLAR_API_KEY') },
        { key: 'GCP_SERVICE_ACCOUNT_JSON', present: presence('GCP_SERVICE_ACCOUNT_JSON') },
      ],
    },
    {
      name: 'Email',
      icon: 'fa-envelope',
      keys: [
        { key: 'GMAIL_CLIENT_ID', present: presence('GMAIL_CLIENT_ID') },
        { key: 'GMAIL_CLIENT_SECRET', present: presence('GMAIL_CLIENT_SECRET') },
        { key: 'RESEND_API_KEY', present: presence('RESEND_API_KEY') },
      ],
    },
    {
      name: 'Analytics',
      icon: 'fa-chart-line',
      keys: [
        { key: 'GA4_MEASUREMENT_ID', present: presence('GA4_MEASUREMENT_ID') },
        { key: 'GA4_PROPERTY_ID', present: presence('GA4_PROPERTY_ID') },
      ],
    },
    {
      name: 'Auth / Security',
      icon: 'fa-shield-alt',
      keys: [
        { key: 'JWT_SECRET', present: presence('JWT_SECRET') },
        { key: 'GOOGLE_OAUTH_CLIENT_ID', present: presence('GOOGLE_OAUTH_CLIENT_ID') },
      ],
    },
  ]

  return c.json(out)
})

// Health Check Log — surfaces the platform monitor agent's run history,
// per-run details, and Claude-generated insights. Read-only feed for super admin.
adminRoutes.get('/superadmin/health-check-log', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)

  const out: Record<string, any> = { generated_at: new Date().toISOString() }

  // Agent config — last run status, totals, enabled flag, next_run_at
  try {
    const cfg = await c.env.DB.prepare(
      "SELECT enabled, config_json, last_run_at, last_run_status, last_run_details, next_run_at, run_count, error_count, created_at, updated_at FROM agent_configs WHERE agent_type = 'monitor'"
    ).first<any>()
    out.config = cfg || null
  } catch (e: any) { out.config = null }

  // Recent runs — last 30 monitor runs, parse details_json into an object client-side
  try {
    const runs = await c.env.DB.prepare(
      "SELECT id, status, summary, details_json, duration_ms, created_at FROM agent_runs WHERE agent_type = 'monitor' ORDER BY created_at DESC LIMIT 30"
    ).all<any>()
    out.runs = (runs.results || []).map((r: any) => {
      let details: any = null
      try { details = r.details_json ? JSON.parse(r.details_json) : null } catch { details = null }
      return { id: r.id, status: r.status, summary: r.summary, duration_ms: r.duration_ms, created_at: r.created_at, details }
    })
  } catch (e: any) { out.runs = [] }

  // Run rollups — totals over rolling windows for the header KPIs
  out.rollup = { runs_24h: 0, runs_7d: 0, errors_24h: 0, errors_7d: 0, avg_duration_ms_7d: null }
  try {
    const rows = await c.env.DB.batch([
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM agent_runs WHERE agent_type = 'monitor' AND created_at > datetime('now', '-1 day')"),
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM agent_runs WHERE agent_type = 'monitor' AND created_at > datetime('now', '-7 days')"),
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM agent_runs WHERE agent_type = 'monitor' AND status = 'error' AND created_at > datetime('now', '-1 day')"),
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM agent_runs WHERE agent_type = 'monitor' AND status = 'error' AND created_at > datetime('now', '-7 days')"),
      c.env.DB.prepare("SELECT AVG(duration_ms) as avg_ms FROM agent_runs WHERE agent_type = 'monitor' AND created_at > datetime('now', '-7 days')"),
    ]) as any[]
    out.rollup.runs_24h = rows[0].results?.[0]?.cnt || 0
    out.rollup.runs_7d = rows[1].results?.[0]?.cnt || 0
    out.rollup.errors_24h = rows[2].results?.[0]?.cnt || 0
    out.rollup.errors_7d = rows[3].results?.[0]?.cnt || 0
    out.rollup.avg_duration_ms_7d = rows[4].results?.[0]?.avg_ms || null
  } catch {}

  // Recent insights — last 50 platform_insights from the monitor agent
  try {
    const insights = await c.env.DB.prepare(
      "SELECT id, category, severity, title, description, suggested_fix, status, created_at, resolved_at FROM platform_insights ORDER BY created_at DESC LIMIT 50"
    ).all<any>()
    out.insights = insights.results || []
  } catch (e: any) { out.insights = [] }

  // Insight counts — by status for the header KPIs
  out.insight_counts = { open: 0, acknowledged: 0, resolved: 0, critical_open: 0, high_open: 0 }
  try {
    const rows = await c.env.DB.batch([
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM platform_insights WHERE status = 'open'"),
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM platform_insights WHERE status = 'acknowledged'"),
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM platform_insights WHERE status = 'resolved'"),
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM platform_insights WHERE status = 'open' AND severity = 'critical'"),
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM platform_insights WHERE status = 'open' AND severity = 'high'"),
    ]) as any[]
    out.insight_counts.open = rows[0].results?.[0]?.cnt || 0
    out.insight_counts.acknowledged = rows[1].results?.[0]?.cnt || 0
    out.insight_counts.resolved = rows[2].results?.[0]?.cnt || 0
    out.insight_counts.critical_open = rows[3].results?.[0]?.cnt || 0
    out.insight_counts.high_open = rows[4].results?.[0]?.cnt || 0
  } catch {}

  // Accumulated platform memory — what Claude has learned about the platform across runs
  try {
    const mem = await c.env.DB.prepare(
      "SELECT memory_key, memory_value, updated_at FROM agent_memory WHERE agent_type = 'monitor' ORDER BY updated_at DESC"
    ).all<any>()
    out.memory = mem.results || []
  } catch (e: any) { out.memory = [] }

  // ── Diagnostic — translates raw run state into a single actionable
  // banner the UI can show at the top of the page. We look at the head of
  // the run list (already sorted DESC) for a contiguous failure streak and
  // surface the most-common error_code so the user knows exactly what to fix.
  try {
    const runs = out.runs as any[]
    let streak = 0
    let streakCode: string | null = null
    const codeCounts = new Map<string, number>()
    for (const r of runs) {
      if (r.status === 'success') break
      streak++
      const code = r.details?.error_code || (r.summary?.toLowerCase?.().includes('credit balance') ? 'insufficient_credits' : 'unknown')
      codeCounts.set(code, (codeCounts.get(code) || 0) + 1)
      if (streakCode === null) streakCode = code
    }
    const lastSuccess = runs.find((r: any) => r.status === 'success') || null

    // Most common code in the failure streak (prefer billing/auth over unknown)
    let dominantCode = streakCode || 'unknown'
    let dominantCount = 0
    for (const [code, n] of codeCounts) {
      if (n > dominantCount) { dominantCode = code; dominantCount = n }
    }

    let action_needed: null | { severity: 'critical'|'warning'|'info'; code: string; title: string; message: string; cta_label?: string; cta_url?: string } = null

    if (streak >= 3 && dominantCode === 'insufficient_credits') {
      action_needed = {
        severity: 'critical',
        code: 'insufficient_credits',
        title: 'Anthropic API credits exhausted',
        message: `The platform monitor has failed ${streak} consecutive runs because the Anthropic account is out of credits. Top up billing to resume health checks, content generation, lead replies, and traffic analysis.`,
        cta_label: 'Open Anthropic billing',
        cta_url: 'https://console.anthropic.com/settings/billing',
      }
    } else if (streak >= 3 && dominantCode === 'auth_failed') {
      action_needed = {
        severity: 'critical',
        code: 'auth_failed',
        title: 'Anthropic API key rejected',
        message: `${streak} consecutive auth failures from Anthropic. Verify ANTHROPIC_API_KEY is set in Cloudflare Workers secrets and matches a valid key.`,
      }
    } else if (streak >= 3 && dominantCode === 'rate_limited') {
      action_needed = {
        severity: 'warning',
        code: 'rate_limited',
        title: 'Anthropic API is rate-limiting us',
        message: `${streak} consecutive rate-limit failures. Reduce concurrent agent runs or upgrade the Anthropic tier.`,
      }
    } else if (streak >= 3 && dominantCode === 'missing_api_key') {
      action_needed = {
        severity: 'critical',
        code: 'missing_api_key',
        title: 'ANTHROPIC_API_KEY not configured',
        message: 'The Cloudflare Workers environment is missing ANTHROPIC_API_KEY. Set it via wrangler secret put or the Pages dashboard.',
      }
    } else if (streak >= 5) {
      action_needed = {
        severity: 'warning',
        code: dominantCode,
        title: `${streak} consecutive monitor failures`,
        message: `The most recent ${streak} runs all failed. Investigate the latest error in the runs table below.`,
      }
    } else if (!lastSuccess && runs.length > 0) {
      action_needed = {
        severity: 'info',
        code: 'no_success_yet',
        title: 'Monitor has never completed successfully',
        message: 'No successful run on record. Click "Run scan now" once API access is healthy to seed the dashboard.',
      }
    }

    out.diagnostic = {
      action_needed,
      run_streak: streak,
      streak_code: streakCode,
      dominant_code: dominantCode,
      last_success_at: lastSuccess?.created_at || null,
      anthropic_key_present: !!c.env.ANTHROPIC_API_KEY,
    }
  } catch {
    out.diagnostic = { action_needed: null, run_streak: 0, streak_code: null, dominant_code: null, last_success_at: null, anthropic_key_present: !!c.env.ANTHROPIC_API_KEY }
  }

  return c.json(out)
})

// Paywall status
adminRoutes.get('/superadmin/paywall-status', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)

  const tiers = await c.env.DB.prepare("SELECT subscription_plan, COUNT(*) as cnt FROM customers WHERE is_active = 1 GROUP BY subscription_plan").all<any>()
  const packages = await c.env.DB.prepare("SELECT * FROM credit_packages WHERE is_active = 1 ORDER BY sort_order").all<any>()

  // Real config flag — falls back to false if no row exists.
  let enabled = false
  let trial_days = 7
  try {
    const e = await c.env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key = 'paywall_enabled' AND master_company_id = 1").first<any>()
    if (e?.setting_value) enabled = e.setting_value === 'true' || e.setting_value === '1'
    const t = await c.env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key = 'paywall_trial_days' AND master_company_id = 1").first<any>()
    const parsed = parseInt(t?.setting_value || '')
    if (!isNaN(parsed) && parsed > 0) trial_days = parsed
  } catch {}

  // Subscription rollups (same source as system-health so the UI can cross-reference)
  let mrr_cents = 0, active_subs = 0, trial_subs = 0, paying_count = 0
  try {
    const rows = await c.env.DB.batch([
      c.env.DB.prepare("SELECT COALESCE(SUM(monthly_price_cents),0) as mrr, COUNT(*) as cnt FROM secretary_subscriptions WHERE status='active'"),
      c.env.DB.prepare("SELECT COUNT(*) as cnt FROM secretary_subscriptions WHERE status='trial' OR status='trialing'"),
      c.env.DB.prepare("SELECT COUNT(DISTINCT customer_id) as cnt FROM square_payments WHERE status='completed' AND created_at >= datetime('now','-12 months')"),
    ]) as any[]
    mrr_cents = rows[0].results?.[0]?.mrr || 0
    active_subs = rows[0].results?.[0]?.cnt || 0
    trial_subs = rows[1].results?.[0]?.cnt || 0
    paying_count = rows[2].results?.[0]?.cnt || 0
  } catch {}

  return c.json({
    enabled,
    trial_days,
    tiers: tiers.results || [],
    packages: packages.results || [],
    square_configured: !!(c.env as any).SQUARE_ACCESS_TOKEN,
    mrr_cents,
    active_subs,
    trial_subs,
    paying_count,
  })
})

// Service invoices
adminRoutes.get('/superadmin/service-invoices', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const rows = await c.env.DB.prepare("SELECT i.*, c.name as customer_name, c.email as customer_email FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.master_company_id = 1 ORDER BY i.created_at DESC LIMIT 200").all<any>()
  return c.json({ invoices: rows.results || [] })
})

// Service invoice — create by customer email
adminRoutes.post('/superadmin/service-invoices/create', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const { customer_email, items, due_date, notes } = await c.req.json()
  if (!customer_email || !items || !items.length) return c.json({ error: 'customer_email and items required' }, 400)

  try {
    // Find or create customer
    let customer = await c.env.DB.prepare('SELECT id, name, email FROM customers WHERE email = ?').bind(customer_email.toLowerCase()).first<any>()
    if (!customer) {
      const result = await c.env.DB.prepare("INSERT INTO customers (email, name, is_active, email_verified, free_trial_total) VALUES (?, ?, 1, 0, 0)").bind(customer_email.toLowerCase(), customer_email.split('@')[0]).run()
      customer = { id: result.meta.last_row_id, name: customer_email.split('@')[0], email: customer_email.toLowerCase() }
    }

    // Normalize line items (UI may send `price` instead of `unit_price`)
    const normItems = items.map((it: any) => ({
      description: it.description || 'Service',
      quantity: it.quantity || 1,
      unit_price: it.unit_price != null ? Number(it.unit_price) : Number(it.price || 0),
    }))
    let subtotal = 0
    for (const it of normItems) { subtotal += it.quantity * it.unit_price }
    const taxRate = 0
    const total = subtotal

    // Generate invoice number
    const d = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    const rand = Math.floor(Math.random() * 9999).toString().padStart(4, '0')
    const invoiceNumber = `SVC-${d}-${rand}`
    const shareToken = crypto.randomUUID().replace(/-/g, '').substring(0, 24)

    // P1-25: the invoice header + its line items are one logical write.
    // Previously we issued N+1 non-atomic statements — a mid-loop error left
    // an invoice with no line items on disk. Insert the header first to get
    // the auto-generated id, then atomically batch all child rows.
    const invResult = await c.env.DB.prepare(
      `INSERT INTO invoices (invoice_number, customer_id, subtotal, tax_rate, tax_amount, total, currency, status, document_type, notes, share_token, due_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, 'CAD', 'draft', 'invoice', ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(invoiceNumber, customer.id, subtotal, taxRate, total, notes || '', shareToken, due_date || null).run()
    const invoiceId = invResult.meta.last_row_id as number

    const itemStmts = normItems.map((it: any, i: number) =>
      c.env.DB.prepare('INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(invoiceId, it.description, it.quantity, it.unit_price, it.quantity * it.unit_price, i)
    )
    if (itemStmts.length) await c.env.DB.batch(itemStmts)

    const sq = await createSquarePaymentLink(c.env, invoiceId, invoiceNumber, total)
    return c.json({ success: true, invoice_id: invoiceId, invoice_number: invoiceNumber, share_token: shareToken, customer_id: customer.id, total, checkout_url: sq?.url || '' })
  } catch (err: any) {
    console.error('[ServiceInvoice] Create failed:', err.message)
    return c.json({ error: err.message || 'Invoice creation failed' }, 500)
  }
})

// Service invoice — send via email
adminRoutes.post('/superadmin/service-invoices/:id/send', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const id = parseInt(c.req.param('id'))

  // Use the invoices send-gmail logic via internal fetch
  const origin = new URL(c.req.url).origin
  const token = c.req.header('Authorization') || ''
  try {
    const resp = await fetch(`${origin}/api/invoices/${id}/send-gmail`, {
      method: 'POST',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' }
    })
    const data: any = await resp.json()
    return c.json(data, resp.ok ? 200 : 500)
  } catch (err: any) {
    return c.json({ error: 'Failed to send: ' + err.message }, 500)
  }
})

// Sales scripts
adminRoutes.get('/superadmin/sales-scripts', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  try {
    const rows = await c.env.DB.prepare('SELECT * FROM cc_campaigns ORDER BY created_at DESC').all<any>()
    return c.json({ scripts: rows.results || [] })
  } catch { return c.json({ scripts: [] }) }
})

// Call center stats
adminRoutes.get('/superadmin/call-center/stats', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  try {
    const total = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM cc_call_logs').first<any>()
    const today = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM cc_call_logs WHERE created_at > datetime('now', '-1 day')").first<any>()
    const agents = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM cc_agents').first<any>()
    const prospects = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM cc_prospects').first<any>()
    return c.json({ total_calls: total?.cnt || 0, calls_today: today?.cnt || 0, total_agents: agents?.cnt || 0, total_prospects: prospects?.cnt || 0 })
  } catch { return c.json({ total_calls: 0, calls_today: 0, total_agents: 0, total_prospects: 0 }) }
})

// Secretary monitor
adminRoutes.get('/superadmin/secretary/monitor', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const active = await c.env.DB.prepare(
    `SELECT sc.customer_id, sc.is_active, sc.secretary_mode, sc.connection_status, sc.assigned_phone_number, sc.agent_name,
            c.name as customer_name, c.company_name,
            (SELECT COUNT(*) FROM secretary_call_logs cl WHERE cl.customer_id = sc.customer_id AND cl.created_at > datetime('now', '-1 day')) as calls_today,
            (SELECT COUNT(*) FROM secretary_call_logs cl WHERE cl.customer_id = sc.customer_id) as total_calls
     FROM secretary_config sc LEFT JOIN customers c ON c.id = sc.customer_id WHERE sc.is_active = 1 ORDER BY sc.updated_at DESC`
  ).all<any>()
  return c.json({ agents: active.results || [] })
})

// SEO page meta
adminRoutes.get('/superadmin/seo/page-meta', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  try {
    const rows = await c.env.DB.prepare("SELECT * FROM settings WHERE setting_key LIKE 'seo_%' AND master_company_id = 1").all<any>()
    return c.json({ pages: rows.results || [] })
  } catch { return c.json({ pages: [] }) }
})

// Save SEO page meta
adminRoutes.put('/superadmin/seo/page-meta', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const { page_url, meta_title, meta_description, og_image } = await c.req.json()
  if (!page_url) return c.json({ error: 'page_url required' }, 400)
  const key = 'seo_' + page_url.replace(/\//g, '_')
  const value = JSON.stringify({ meta_title, meta_description, og_image })
  await c.env.DB.prepare("INSERT OR REPLACE INTO settings (master_company_id, setting_key, setting_value) VALUES (1, ?, ?)").bind(key, value).run()
  return c.json({ success: true })
})

// Backlinks
adminRoutes.get('/superadmin/seo/backlinks', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  try {
    const rows = await c.env.DB.prepare("SELECT * FROM settings WHERE setting_key = 'seo_backlinks' AND master_company_id = 1").first<any>()
    return c.json({ backlinks: rows?.setting_value ? JSON.parse(rows.setting_value) : [] })
  } catch { return c.json({ backlinks: [] }) }
})

adminRoutes.post('/superadmin/seo/backlinks', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const { url, anchor_text, domain_authority } = await c.req.json()
  let existing: any[] = []
  try { const row = await c.env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key = 'seo_backlinks' AND master_company_id = 1").first<any>(); existing = row?.setting_value ? JSON.parse(row.setting_value) : [] } catch {}
  existing.push({ id: Date.now(), url, anchor_text, domain_authority, created_at: new Date().toISOString() })
  await c.env.DB.prepare("INSERT OR REPLACE INTO settings (master_company_id, setting_key, setting_value) VALUES (1, 'seo_backlinks', ?)").bind(JSON.stringify(existing)).run()
  return c.json({ success: true })
})

adminRoutes.delete('/superadmin/seo/backlinks/:id', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const id = parseInt(c.req.param('id'))
  let existing: any[] = []
  try { const row = await c.env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key = 'seo_backlinks' AND master_company_id = 1").first<any>(); existing = row?.setting_value ? JSON.parse(row.setting_value) : [] } catch {}
  const removed = existing.find((b: any) => b.id === id) || null
  existing = existing.filter((b: any) => b.id !== id)
  await c.env.DB.prepare("INSERT OR REPLACE INTO settings (master_company_id, setting_key, setting_value) VALUES (1, 'seo_backlinks', ?)").bind(JSON.stringify(existing)).run()
  // P1-23 destructive action audit.
  await logAdminAction(c.env.DB, {
    admin: { id: admin.id, email: admin.email },
    action: 'seo.backlink.delete',
    targetType: 'seo_backlink',
    targetId: id,
    before: removed,
    ip: clientIp(c),
  })
  return c.json({ success: true })
})

// Onboarding config
adminRoutes.get('/superadmin/onboarding/config', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  try {
    const row = await c.env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key = 'onboarding_config' AND master_company_id = 1").first<any>()
    return c.json({ config: row?.setting_value ? JSON.parse(row.setting_value) : { free_trial_reports: 3, require_phone: false, enable_secretary: true, default_plan: 'free' } })
  } catch { return c.json({ config: { free_trial_reports: 3, require_phone: false, enable_secretary: true, default_plan: 'free' } }) }
})

// ============================================================
// BASEMAP PROVIDERS — Higher-res alternatives to Google Satellite for the
// admin trace tool. Mirrors /api/storm-scout/basemaps but gated by admin JWT.
// ============================================================
adminRoutes.get('/superadmin/basemaps', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const env: any = c.env
  const out: any[] = []
  for (const p of Object.values(BASEMAP_PROVIDERS)) {
    if (!p.requiresToken) {
      out.push({ id: p.id, name: p.name, maxZoom: p.maxZoom, attribution: p.attribution, urlTemplate: p.urlTemplate, enabled: true })
      continue
    }
    let token: string | undefined
    if (p.id === 'mapbox_satellite') token = env.MAPBOX_ACCESS_TOKEN
    if (p.id === 'nearmap') token = env.NEARMAP_API_KEY
    if (!token) continue
    out.push({
      id: p.id, name: p.name, maxZoom: p.maxZoom, attribution: p.attribution,
      urlTemplate: p.urlTemplate.replace('{token}', token),
      enabled: true
    })
  }
  return c.json({ providers: out })
})

// ============================================================
// MANUAL TRACE QUEUE — Get orders waiting for admin trace
// ============================================================
adminRoutes.get('/superadmin/orders/needs-trace', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  try {
    const orders = await c.env.DB.prepare(`
      SELECT o.id, o.order_number, o.property_address, o.latitude, o.longitude,
             o.created_at, o.customer_id, o.source, o.api_job_id, o.customer_notes,
             c.name as customer_name, c.email as customer_email,
             a.company_name as api_company_name
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN api_accounts a ON a.id = (
        SELECT account_id FROM api_jobs WHERE id = o.api_job_id LIMIT 1
      )
      WHERE o.needs_admin_trace = 1
        AND (o.status = 'processing' OR o.status = 'pending')
      ORDER BY o.created_at ASC
    `).all()
    return c.json({ orders: orders.results || [] })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ============================================================
// AUTO-TRACE — Claude vision agent generates eave/hip/ridge polylines
// ============================================================
// Three endpoints, one per edge type. Fires ONLY when the super-admin
// explicitly clicks the Auto-Trace button in the trace UI — never
// background, never auto-persist. Returns a preview the admin reviews
// and tweaks before submitting via /submit-trace.
//
// Body: { lat?, lng?, zoom?, imageWidth?, imageHeight? } — all optional.
// Defaults fall back to the order's stored coords + zoom 20 + 1280×1280
// effective image (Static Maps 640×640 × scale=2).
// ============================================================
adminRoutes.post('/superadmin/orders/:id/auto-trace/:edge', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)

  const orderId = parseInt(c.req.param('id'))
  if (isNaN(orderId)) return c.json({ error: 'Invalid order ID' }, 400)

  const edge = c.req.param('edge') as AutoTraceEdge
  if (edge !== 'eaves' && edge !== 'hips' && edge !== 'ridges' && edge !== 'valleys') {
    return c.json({ error: 'edge must be eaves|hips|ridges|valleys' }, 400)
  }

  let body: any = {}
  try { body = await c.req.json() } catch { /* empty body is fine — use defaults */ }

  const order = await c.env.DB.prepare(
    'SELECT id, order_number, latitude, longitude, property_address FROM orders WHERE id = ?'
  ).bind(orderId).first<any>()
  if (!order) return c.json({ error: 'Order not found' }, 404)

  const lat = Number(body?.lat) || Number(order.latitude)
  const lng = Number(body?.lng) || Number(order.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return c.json({ error: 'Order has no stored coordinates — pass lat/lng in the request body' }, 400)
  }

  try {
    // viewport_3d_b64 is the client's screenshot of the <gmp-map-3d>
    // beside the trace map. Cap at ~4MB after base64 (matches the
    // existing extra_captures cap on /submit-trace) so a runaway client
    // can't blow the worker's memory ceiling. Stripping is handled
    // inside auto-trace-agent.ts so the route stays a thin pass-through.
    let viewport3dB64: string | undefined
    if (typeof body?.viewport_3d_b64 === 'string' && body.viewport_3d_b64.length > 1000) {
      if (body.viewport_3d_b64.length <= 5_500_000) {
        viewport3dB64 = body.viewport_3d_b64
      } else {
        console.warn('[auto-trace] viewport_3d_b64 too large, ignoring:', body.viewport_3d_b64.length, 'chars')
      }
    }

    // ?debug=1 returns the base64-encoded satellite + DSM hillshade images
    // alongside the normal response so engineers can inspect exactly what
    // Claude saw. Never enabled by the UI — set explicitly when reproducing
    // a bad trace via curl. Adds ~2MB to the response, so off by default.
    const debugImages = c.req.query('debug') === '1'

    const result = await runAutoTrace(c.env, {
      orderId,
      edge,
      lat, lng,
      zoom: Number(body?.zoom) || 20,
      imageWidth: Number(body?.imageWidth) || 640,
      imageHeight: Number(body?.imageHeight) || 640,
      viewport3dB64,
      includeDebugImages: debugImages,
      includeOutbuildings: body?.include_outbuildings === true,
      skipAngleSnapping: body?.skip_angle_snapping === true,
    })

    // Audit row so the super-admin activity feed shows who ran what when,
    // AND so the auto-trace learner (services/auto-trace-learning.ts) can
    // recover the agent's draft segments when /submit-trace fires later
    // and diff them against the admin's final geometry. Non-fatal.
    try {
      await c.env.DB.prepare(
        "INSERT INTO user_activity_log (company_id, action, details) VALUES (1, 'admin_auto_trace', ?)"
      ).bind(JSON.stringify({
        order_id: orderId,
        admin_id: admin.id,
        edge,
        confidence: result.confidence,
        segments_returned: result.segments.length,
        segments: result.segments,
        reasoning: result.reasoning,
        model: result.diagnostics.model,
        elapsed_ms: result.diagnostics.elapsed_ms,
      })).run()
    } catch { /* non-fatal */ }

    return c.json({ success: true, ...result, order: { id: order.id, order_number: order.order_number } })
  } catch (err: any) {
    console.warn('[auto-trace] failed:', err?.message)
    return c.json({ error: 'auto_trace_failed', message: err?.message || String(err) }, 500)
  }
})

// ============================================================
// PREVIEW TRACE — Dry-run the engine on a proposed trace without saving.
// Returns validation issues + a before/after delta vs the currently-stored
// trace (if any). Used by the admin review panel to QA an override.
// ============================================================
adminRoutes.post('/superadmin/orders/:id/preview-trace', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const orderId = parseInt(c.req.param('id'))
  if (isNaN(orderId)) return c.json({ error: 'Invalid order ID' }, 400)
  try {
    const { roof_trace_json, default_pitch } = await c.req.json()
    if (!roof_trace_json) return c.json({ error: 'roof_trace_json is required' }, 400)

    let traceObj: any
    try {
      traceObj = typeof roof_trace_json === 'string' ? JSON.parse(roof_trace_json) : roof_trace_json
    } catch (e: any) {
      return c.json({ error: 'roof_trace_json is not valid JSON', details: e.message }, 400)
    }

    const validation = validateTraceUi(traceObj)

    // Fetch order for context and previously stored trace
    const order = await c.env.DB.prepare(
      'SELECT id, order_number, property_address, roof_trace_json, house_sqft FROM orders WHERE id = ?'
    ).bind(orderId).first<any>()
    if (!order) return c.json({ error: 'Order not found' }, 404)

    const runEngine = (t: any) => {
      try {
        const payload = traceUiToEnginePayload(t, {
          property_address: order.property_address || '',
          order_number: order.order_number || '',
        }, Number(default_pitch) || 5.0)
        const engine = new RoofMeasurementEngine(payload)
        const report = engine.run()
        return {
          footprint_ft2: report.key_measurements.total_projected_footprint_ft2,
          sloped_ft2:    report.key_measurements.total_roof_area_sloped_ft2,
          squares_net:   report.key_measurements.total_squares_net,
          squares_gross: report.key_measurements.total_squares_gross_w_waste,
          dominant_pitch: report.key_measurements.dominant_pitch_label,
          num_faces:     report.key_measurements.num_roof_faces,
          num_eave_points: report.key_measurements.num_eave_points,
          num_ridges:    report.key_measurements.num_ridges,
          num_hips:      report.key_measurements.num_hips,
          num_valleys:   report.key_measurements.num_valleys,
          eaves_ft:      report.linear_measurements.eaves_total_ft,
          ridges_ft:     report.linear_measurements.ridges_total_ft,
          hips_ft:       report.linear_measurements.hips_total_ft,
          valleys_ft:    report.linear_measurements.valleys_total_ft,
          advisory_notes: report.advisory_notes,
          // Per-face polygons + pitches — used by the Verify Planes UI to let
          // the admin confirm or override each plane individually. When the
          // engine could not bound a face polygon (no ridges/hips traced),
          // polygon will be undefined for that entry.
          face_details:  (report.face_details || []).map(f => ({
            face_id:            f.face_id,
            label:              f.face_id,
            pitch_rise:         f.pitch_rise,
            pitch_label:        f.pitch_label,
            projected_area_ft2: f.projected_area_ft2,
            sloped_area_ft2:    f.sloped_area_ft2,
            polygon:            f.polygon || null,
            azimuth_deg:        f.azimuth_deg ?? null,
          })),
        }
      } catch (e: any) {
        return { error: e.message }
      }
    }

    // Run the engine on the raw trace (no AI simplification) so admin previews
    // match exactly what user-self-traced reports produce.
    let proposed: any = null
    if (validation.valid) {
      proposed = runEngine(traceObj)
    }

    let previous: any = null
    if (order.roof_trace_json) {
      try {
        const prev = typeof order.roof_trace_json === 'string'
          ? JSON.parse(order.roof_trace_json)
          : order.roof_trace_json
        const prevValidation = validateTraceUi(prev)
        if (prevValidation.valid) previous = runEngine(prev)
      } catch { /* ignore — previous trace is corrupt */ }
    }

    // Compute a simple diff summary for the UI
    let delta: any = null
    if (proposed && previous && !proposed.error && !previous.error) {
      delta = {
        footprint_ft2: proposed.footprint_ft2 - previous.footprint_ft2,
        sloped_ft2:    proposed.sloped_ft2 - previous.sloped_ft2,
        squares_gross: proposed.squares_gross - previous.squares_gross,
        footprint_pct: previous.footprint_ft2 > 0
          ? Math.round(((proposed.footprint_ft2 - previous.footprint_ft2) / previous.footprint_ft2) * 1000) / 10
          : null,
      }
    }

    return c.json({
      success: true,
      validation,
      proposed,
      previous,
      delta,
      enhancements: null,
      order: { id: order.id, order_number: order.order_number, property_address: order.property_address, house_sqft: order.house_sqft },
    })
  } catch (err: any) {
    return c.json({ error: 'Preview failed: ' + err.message }, 500)
  }
})

// ============================================================
// SUBMIT TRACE — Admin saves trace + triggers report generation
// ============================================================
adminRoutes.post('/superadmin/orders/:id/submit-trace', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const orderId = parseInt(c.req.param('id'))
  if (isNaN(orderId)) return c.json({ error: 'Invalid order ID' }, 400)
  try {
    const { roof_trace_json, force, extra_captures } = await c.req.json()
    if (!roof_trace_json) return c.json({ error: 'roof_trace_json is required' }, 400)

    // Parse if string, then validate structure + geometry before anything hits the DB
    let traceObj: any
    try {
      traceObj = typeof roof_trace_json === 'string' ? JSON.parse(roof_trace_json) : roof_trace_json
    } catch (e: any) {
      return c.json({ error: 'roof_trace_json is not valid JSON', details: e.message }, 400)
    }

    // Validate optional admin-captured 3D map screenshots. Cap at 4 entries,
    // each ≤ ~3MB after base64 decoding (matches the existing /3d-cover and
    // /3d-aerials caps). Reject if shape is wrong; tolerate empty/missing
    // by treating it as "no captures" so the report renders as today.
    const cleanedCaptures: Array<{ data_url: string; captured_at: string }> = []
    if (extra_captures != null) {
      if (!Array.isArray(extra_captures)) {
        return c.json({ error: 'extra_captures must be an array' }, 400)
      }
      if (extra_captures.length > 4) {
        return c.json({ error: 'extra_captures: max 4 captures' }, 400)
      }
      const nowIso = new Date().toISOString()
      for (const cap of extra_captures) {
        const dataUrl = String(cap?.data_url || '')
        if (!dataUrl.startsWith('data:image/')) {
          return c.json({ error: 'each extra_captures entry needs a data:image/* data_url' }, 400)
        }
        if (dataUrl.length > 4_400_000) {
          return c.json({ error: 'extra_captures: each image max ~3MB' }, 413)
        }
        const capturedAt = typeof cap?.captured_at === 'string' && cap.captured_at ? cap.captured_at : nowIso
        cleanedCaptures.push({ data_url: dataUrl, captured_at: capturedAt })
      }
    }

    const validation = validateTraceUi(traceObj)
    if (!validation.valid && !force) {
      return c.json({
        error: 'Trace validation failed. Re-submit with force=true to override.',
        validation_errors: validation.errors,
        validation_warnings: validation.warnings,
      }, 400)
    }

    // Persist the raw trace as-is so admin-submitted reports have identical
    // geometric detail to user-self-traced reports (no AI simplification).
    try {
      const prev = await c.env.DB.prepare(
        'SELECT roof_trace_json FROM orders WHERE id = ?'
      ).bind(orderId).first<any>()
      const prevJson = prev?.roof_trace_json || null
      await c.env.DB.prepare(
        "INSERT INTO user_activity_log (company_id, action, details) VALUES (1, 'admin_trace_override', ?)"
      ).bind(JSON.stringify({
        order_id: orderId,
        admin_id: admin.id,
        validation_warnings: validation.warnings.length,
        validation_errors: validation.errors.length,
        forced: !!force,
        previous_trace_existed: !!prevJson,
      })).run()
    } catch (e) { /* non-fatal audit */ }

    const traceStr = JSON.stringify(traceObj)
    await c.env.DB.prepare(
      "UPDATE orders SET roof_trace_json = ?, needs_admin_trace = 0, trace_source = 'admin', updated_at = datetime('now') WHERE id = ?"
    ).bind(traceStr, orderId).run()

    // Self-improvement hook: if the admin ran the auto-trace agent for any
    // edge type before submitting, diff the agent's draft against this final
    // trace and record one correction row per edge. Powers the lesson-memo
    // (next agent run reads its own past mistakes) + confidence calibration.
    // Non-fatal — never blocks report generation.
    const ctxLog = (c as any).executionCtx
    const logP = logAutoTraceCorrections(c.env, orderId, traceObj)
      .catch((e: any) => console.warn('[auto-trace-learning] log failed:', e?.message))
    if (ctxLog?.waitUntil) ctxLog.waitUntil(logP)

    // Generate the report (this is admin submitting so we call synchronously within worker timeout)
    const result = await generateReportForOrder(orderId, c.env, (c as any).executionCtx)

    // Merge any admin-captured 3D map screenshots into the report's imagery
    // payload. Mirrors the /3d-aerials handler pattern at reports.ts:801-848.
    // Done after report generation so the reports row is guaranteed to exist
    // (generateReportForOrder upserts it). No-op if cleanedCaptures is empty,
    // so reports render unchanged when the admin doesn't capture anything.
    if (cleanedCaptures.length > 0 && result?.success) {
      try {
        const row = await c.env.DB.prepare(
          'SELECT api_response_raw FROM reports WHERE order_id = ?'
        ).bind(orderId).first<{ api_response_raw: string | null }>()
        if (row) {
          let parsed: any = {}
          try { parsed = row.api_response_raw ? JSON.parse(row.api_response_raw) : {} } catch { parsed = {} }
          parsed.imagery = parsed.imagery || {}
          parsed.imagery.extra_captures = cleanedCaptures
          parsed.imagery.extra_captures_captured_at = new Date().toISOString()
          await c.env.DB.prepare(
            'UPDATE reports SET api_response_raw = ? WHERE order_id = ?'
          ).bind(JSON.stringify(parsed), orderId).run()
        }
      } catch (e: any) {
        console.warn('[submit-trace] extra_captures merge failed:', e?.message || e)
      }
    }

    // Auto-invoice: admin-traced orders previously only got a draft proposal
    // when the 10-minute cron sweep ran. Hook it inline so the roofer sees
    // the proposal within seconds of the trace being submitted.
    if (result?.success) {
      const ctx = (c as any).executionCtx
      const autoInvP = createAutoInvoiceForOrder(c.env, Number(orderId))
        .catch((e) => console.warn('[auto-invoice] admin-trace hook error:', e?.message))
      if (ctx?.waitUntil) ctx.waitUntil(autoInvP)
    }

    // Notify the customer via email + push (best-effort) and record a
    // 'trace_completed' row in super_admin_notifications so the feed shows
    // the trace lifecycle end-to-end.
    try {
      const order = await c.env.DB.prepare(
        'SELECT o.customer_id, o.property_address, o.order_number, o.service_tier, o.price, o.is_trial, c.email AS customer_email, c.name AS customer_name FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = ?'
      ).bind(orderId).first<any>()
      if (order) {
        const notifyPromise = recordAndNotify(c.env, {
          kind: 'trace_completed',
          order: {
            order_id: orderId,
            order_number: order.order_number,
            customer_id: order.customer_id,
            customer_email: order.customer_email || '',
            customer_name: order.customer_name || '',
            property_address: order.property_address || '',
            service_tier: order.service_tier || '',
            price: order.price ?? 0,
            payment_status: 'paid',
            is_trial: !!order.is_trial,
            trace_source: 'admin',
            needs_admin_trace: false,
            payload: { admin_id: admin.id },
          },
        }).catch((e) => console.warn('[admin-notif] trace_completed:', e?.message || e))
        const ctx = (c as any).executionCtx
        if (ctx?.waitUntil) ctx.waitUntil(notifyPromise)
        await c.env.DB.prepare(
          "INSERT INTO user_activity_log (company_id, action, details) VALUES (1, 'manual_trace_completed', ?)"
        ).bind(`Admin traced order ${order.order_number} — ${order.property_address}`).run()
      }
    } catch(e) { /* non-fatal */ }

    return c.json({
      success: true,
      result,
      enhancements: null,
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to submit trace: ' + err.message }, 500)
  }
})

// ============================================================
// REGENERATE REPORT — Re-runs the report engine on the existing
// stored roof_trace_json without touching the trace itself. Used
// when a code change to the engine or report template needs to
// flow into a previously-generated report (e.g. a new line item
// like Eaves Flashing was added). Non-destructive: the trace is
// preserved, only the report HTML/data is rebuilt.
// ============================================================
adminRoutes.post('/superadmin/orders/:id/regenerate-report', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const orderId = parseInt(c.req.param('id'))
  if (isNaN(orderId)) return c.json({ error: 'Invalid order ID' }, 400)

  try {
    const order = await c.env.DB.prepare(
      'SELECT id, order_number, property_address, roof_trace_json FROM orders WHERE id = ?'
    ).bind(orderId).first<any>()
    if (!order) return c.json({ error: 'Order not found' }, 404)
    if (!order.roof_trace_json) {
      return c.json({ error: 'Order has no stored trace — use submit-trace instead' }, 400)
    }

    // Reset just the report row so the engine writes a fresh result.
    // Keep roof_trace_json on orders untouched.
    await c.env.DB.prepare(`
      UPDATE reports SET
        professional_report_html = NULL,
        customer_report_html = NULL,
        api_response_raw = NULL,
        status = 'pending',
        generation_attempts = 0,
        generation_started_at = NULL,
        generation_completed_at = NULL,
        error_message = NULL,
        needs_review = 0,
        review_reason = NULL,
        review_detail = NULL,
        updated_at = datetime('now')
      WHERE order_id = ?
    `).bind(orderId).run()

    const result = await generateReportForOrder(orderId, c.env, (c as any).executionCtx)

    try {
      await c.env.DB.prepare(
        "INSERT INTO user_activity_log (company_id, action, details) VALUES (1, 'admin_regenerate_report', ?)"
      ).bind(JSON.stringify({
        order_id: orderId,
        order_number: order.order_number,
        admin_id: admin.id,
        admin_email: admin.email,
        property_address: order.property_address,
        success: !!result?.success,
      })).run()
    } catch (e) { /* non-fatal audit */ }

    return c.json({ success: true, result })
  } catch (err: any) {
    return c.json({ error: 'Failed to regenerate report: ' + err.message }, 500)
  }
})

// ============================================================
// CANCEL & RE-TRACE — Hard-reset a generated report and put the
// order back in the manual trace queue. Used when a generated
// report is wrong (broken diagram, duplicated structure, etc.)
// and the super-admin wants to redraw the trace from scratch.
//
// Hard reset wipes:
//   reports.professional_report_html
//   reports.api_response_raw, reports.customer_report_html
//   reports.status='pending', generation_attempts=0, needs_review=0
//   orders.roof_trace_json=NULL, trace_source=NULL
//   orders.needs_admin_trace=1, status='processing'
// ============================================================
adminRoutes.post('/superadmin/orders/:id/cancel-and-retrace', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const orderId = parseInt(c.req.param('id'))
  if (isNaN(orderId)) return c.json({ error: 'Invalid order ID' }, 400)

  try {
    const body = await c.req.json().catch(() => ({}))
    const reason = (body?.reason || '').toString().slice(0, 500) || 'manual_retrace'

    const order = await c.env.DB.prepare(
      'SELECT id, order_number, property_address FROM orders WHERE id = ?'
    ).bind(orderId).first<any>()
    if (!order) return c.json({ error: 'Order not found' }, 404)

    // Hard-reset the report row (keeps the row so foreign keys stay intact;
    // wipes everything that would otherwise let the customer dashboard show
    // the broken report).
    await c.env.DB.prepare(`
      UPDATE reports SET
        professional_report_html = NULL,
        customer_report_html = NULL,
        api_response_raw = NULL,
        status = 'pending',
        generation_attempts = 0,
        generation_started_at = NULL,
        generation_completed_at = NULL,
        error_message = NULL,
        needs_review = 0,
        review_reason = NULL,
        review_detail = NULL,
        enhancement_status = NULL,
        enhancement_error = NULL,
        updated_at = datetime('now')
      WHERE order_id = ?
    `).bind(orderId).run()

    // Re-queue the order for manual trace.
    await c.env.DB.prepare(`
      UPDATE orders SET
        roof_trace_json = NULL,
        trace_measurement_json = NULL,
        trace_source = NULL,
        needs_admin_trace = 1,
        status = 'processing',
        delivered_at = NULL,
        updated_at = datetime('now')
      WHERE id = ?
    `).bind(orderId).run()

    // Audit row — survives a re-trace cycle so we can see who cancelled and why.
    try {
      await c.env.DB.prepare(
        "INSERT INTO user_activity_log (company_id, action, details) VALUES (1, 'admin_cancel_and_retrace', ?)"
      ).bind(JSON.stringify({
        order_id: orderId,
        admin_id: admin.id,
        admin_email: admin.email,
        reason,
        order_number: order.order_number,
        property_address: order.property_address,
      })).run()
    } catch { /* non-fatal audit */ }

    // Resolve any open loop_scan_findings for this order so the Loop Tracker
    // doesn't keep re-flagging the same broken report after we've cancelled it.
    try {
      await c.env.DB.prepare(
        `UPDATE loop_scan_findings
         SET resolved_at = datetime('now'), resolved_by = ?
         WHERE resolved_at IS NULL
           AND details_json LIKE ?`
      ).bind(admin.email || 'admin', `%"order_id":${orderId}%`).run()
    } catch { /* non-fatal */ }

    return c.json({
      success: true,
      order_id: orderId,
      order_number: order.order_number,
      message: `Order ${order.order_number} reset and queued for re-trace`,
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to cancel and re-trace: ' + err.message }, 500)
  }
})

// LiveKit SIP API helper for admin
async function adminLivekitAPI(apiKey: string, apiSecret: string, livekitUrl: string, path: string, body: any) {
  function b64url(data: Uint8Array | string): string {
    let str: string
    if (typeof data === 'string') { str = btoa(data) } else { let b = ''; for (let i = 0; i < data.length; i++) b += String.fromCharCode(data[i]); str = btoa(b) }
    return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ iss: apiKey, sub: 'server', iat: now, exp: now + 300, nbf: now, video: { roomCreate: true, roomList: true, roomAdmin: true }, sip: { admin: true, call: true } }))
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(apiSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${payload}`))
  const jwt = `${header}.${payload}.${b64url(new Uint8Array(sig))}`
  const httpUrl = livekitUrl.replace('wss://', 'https://').replace(/\/$/, '')
  const resp = await fetch(`${httpUrl}${path}`, { method: 'POST', headers: { 'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return resp.json()
}

// ============================================================
// PUBLIC API ADMIN ROUTES
// Superadmin management of API accounts, keys, and queue.
// All routes require superadmin role.
// ============================================================

// ── GET /api/admin/api-queue — Jobs awaiting tracing ────────────────────────
adminRoutes.get('/api-queue', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin) return c.json({ error: 'Admin auth required' }, 401)
  if (admin.role !== 'superadmin') return c.json({ error: 'Superadmin required' }, 403)

  const jobs = await c.env.DB.prepare(`
    SELECT j.*, a.company_name, a.contact_email,
           o.order_number, o.status as order_status,
           (strftime('%s','now') - j.created_at) as age_seconds
    FROM api_jobs j
    JOIN api_accounts a ON a.id = j.account_id
    LEFT JOIN orders o ON o.id = j.order_id
    WHERE j.status IN ('queued','tracing','generating')
    ORDER BY j.created_at ASC
    LIMIT 100
  `).all()

  return c.json({ jobs: jobs.results })
})

// ── GET /api/admin/api-accounts — List all API accounts ────────────────────
adminRoutes.get('/api-accounts', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin) return c.json({ error: 'Admin auth required' }, 401)
  if (admin.role !== 'superadmin') return c.json({ error: 'Superadmin required' }, 403)

  const accounts = await c.env.DB.prepare(`
    SELECT a.*,
      (SELECT COUNT(*) FROM api_keys k WHERE k.account_id = a.id AND k.revoked_at IS NULL) as active_key_count,
      (SELECT COUNT(*) FROM api_jobs j WHERE j.account_id = a.id) as total_jobs,
      (SELECT COUNT(*) FROM api_jobs j WHERE j.account_id = a.id AND j.status = 'ready') as completed_jobs
    FROM api_accounts a
    ORDER BY a.created_at DESC
  `).all()

  return c.json({ accounts: accounts.results })
})

// ── POST /api/admin/api-accounts — Create a new API account ─────────────────
adminRoutes.post('/api-accounts', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin) return c.json({ error: 'Admin auth required' }, 401)
  if (admin.role !== 'superadmin') return c.json({ error: 'Superadmin required' }, 403)

  const body = await c.req.json()
  const { company_name, contact_email, initial_credits } = body

  if (!company_name || !contact_email) {
    return c.json({ error: 'company_name and contact_email are required' }, 400)
  }

  const id = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)
  const credits = Math.max(0, parseInt(initial_credits ?? '0', 10))

  await c.env.DB.prepare(`
    INSERT INTO api_accounts (id, company_name, contact_email, credit_balance, status, created_at)
    VALUES (?, ?, ?, ?, 'active', ?)
  `).bind(id, company_name, contact_email, credits, now).run()

  // Record initial credits if any
  if (credits > 0) {
    await addCredits(c.env.DB, id, credits, 'admin_adjustment', 'initial_grant')
  }

  return c.json({ success: true, account_id: id }, 201)
})

// ── PATCH /api/admin/api-accounts/:accountId — Update account ───────────────
adminRoutes.patch('/api-accounts/:accountId', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin) return c.json({ error: 'Admin auth required' }, 401)
  if (admin.role !== 'superadmin') return c.json({ error: 'Superadmin required' }, 403)

  const accountId = c.req.param('accountId')
  const body = await c.req.json()
  const { status, add_credits } = body

  if (status && !['active','suspended','banned'].includes(status)) {
    return c.json({ error: 'Invalid status' }, 400)
  }

  if (status) {
    await c.env.DB.prepare('UPDATE api_accounts SET status = ? WHERE id = ?')
      .bind(status, accountId).run()
  }

  if (add_credits && parseInt(add_credits, 10) > 0) {
    await addCredits(c.env.DB, accountId, parseInt(add_credits, 10), 'admin_adjustment', 'admin_topup')
  }

  return c.json({ success: true })
})

// ── POST /api/admin/api-accounts/:accountId/keys — Issue a new API key ──────
adminRoutes.post('/api-accounts/:accountId/keys', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin) return c.json({ error: 'Admin auth required' }, 401)
  if (admin.role !== 'superadmin') return c.json({ error: 'Superadmin required' }, 403)

  const accountId = c.req.param('accountId')
  const body = await c.req.json().catch(() => ({}))
  const keyName = (body as any).name ?? null

  const account = await c.env.DB.prepare('SELECT id FROM api_accounts WHERE id = ?')
    .bind(accountId).first()
  if (!account) return c.json({ error: 'Account not found' }, 404)

  const { raw, prefix, hash } = await generateApiKey()
  const keyId = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)

  await c.env.DB.prepare(`
    INSERT INTO api_keys (id, account_id, key_prefix, key_hash, name, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(keyId, accountId, prefix, hash, keyName, now).run()

  return c.json({
    key_id: keyId,
    api_key: raw,
    prefix,
    message: 'Save this API key — it will not be shown again.'
  }, 201)
})

// ── DELETE /api/admin/api-accounts/:accountId/keys/:keyId — Revoke key ──────
adminRoutes.delete('/api-accounts/:accountId/keys/:keyId', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin) return c.json({ error: 'Admin auth required' }, 401)
  if (admin.role !== 'superadmin') return c.json({ error: 'Superadmin required' }, 403)

  const { accountId, keyId } = c.req.param()
  const now = Math.floor(Date.now() / 1000)

  await c.env.DB.prepare(
    'UPDATE api_keys SET revoked_at = ? WHERE id = ? AND account_id = ?'
  ).bind(now, keyId, accountId).run()

  // P1-23 destructive action audit.
  await logAdminAction(c.env.DB, {
    admin: { id: admin.id, email: admin.email },
    action: 'api_key.revoke',
    targetType: 'api_key',
    targetId: keyId,
    after: { account_id: accountId, revoked_at: now },
    ip: clientIp(c),
  })

  return c.json({ success: true })
})

// ── GET /api/admin/api-accounts/:accountId/keys — List keys for account ─────
adminRoutes.get('/api-accounts/:accountId/keys', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin) return c.json({ error: 'Admin auth required' }, 401)
  if (admin.role !== 'superadmin') return c.json({ error: 'Superadmin required' }, 403)

  const accountId = c.req.param('accountId')
  const keys = await c.env.DB.prepare(`
    SELECT id, account_id, key_prefix, name, last_used_at, revoked_at, created_at
    FROM api_keys WHERE account_id = ? ORDER BY created_at DESC
  `).bind(accountId).all()

  return c.json({ keys: keys.results })
})

// ── GET /api/admin/superadmin/api-accounts — Enriched list for super admin UI ─
adminRoutes.get('/superadmin/api-accounts', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin) return c.json({ error: 'Admin auth required' }, 401)
  if (admin.role !== 'superadmin') return c.json({ error: 'Superadmin required' }, 403)

  const now = Math.floor(Date.now() / 1000)
  const thirtyDaysAgo = now - 30 * 86400

  const accounts = await c.env.DB.prepare(`
    SELECT
      a.*,
      (SELECT COUNT(*) FROM api_keys k
         WHERE k.account_id = a.id AND k.revoked_at IS NULL)               AS active_key_count,
      (SELECT COUNT(*) FROM api_jobs j WHERE j.account_id = a.id)          AS total_jobs,
      (SELECT COUNT(*) FROM api_jobs j
         WHERE j.account_id = a.id AND j.status = 'ready')                 AS completed_jobs,
      (SELECT COUNT(*) FROM api_jobs j
         WHERE j.account_id = a.id
         AND j.status IN ('queued','tracing','generating'))                 AS active_jobs,
      (SELECT COUNT(*) FROM api_jobs j
         WHERE j.account_id = a.id AND j.created_at >= ?)                  AS jobs_this_month,
      (SELECT COALESCE(SUM(delta),0) FROM api_credit_ledger l
         WHERE l.account_id = a.id AND l.delta > 0)                        AS total_credits_purchased,
      (SELECT created_at FROM api_credit_ledger l
         WHERE l.account_id = a.id AND l.reason = 'purchase'
         ORDER BY created_at DESC LIMIT 1)                                 AS last_purchase_at,
      (SELECT created_at FROM api_jobs j
         WHERE j.account_id = a.id
         ORDER BY created_at DESC LIMIT 1)                                 AS last_job_at
    FROM api_accounts a
    ORDER BY a.created_at DESC
  `).bind(thirtyDaysAgo).all()

  return c.json({ accounts: accounts.results ?? [] })
})

// ── GET /api/admin/superadmin/api-accounts/:id/ledger — Per-account ledger ───
adminRoutes.get('/superadmin/api-accounts/:accountId/ledger', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin) return c.json({ error: 'Admin auth required' }, 401)
  if (admin.role !== 'superadmin') return c.json({ error: 'Superadmin required' }, 403)

  const accountId = c.req.param('accountId')
  const entries = await c.env.DB.prepare(`
    SELECT * FROM api_credit_ledger
    WHERE account_id = ?
    ORDER BY created_at DESC LIMIT 50
  `).bind(accountId).all()

  return c.json({ entries: entries.results ?? [] })
})

// ── GET /api/admin/api-stats — Dashboard summary ────────────────────────────
adminRoutes.get('/api-stats', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin) return c.json({ error: 'Admin auth required' }, 401)
  if (admin.role !== 'superadmin') return c.json({ error: 'Superadmin required' }, 403)

  const [queueSize, totalAccounts, totalJobs, recentErrors] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM api_jobs WHERE status IN ('queued','tracing','generating')`).first<any>(),
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM api_accounts WHERE status = 'active'`).first<any>(),
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM api_jobs`).first<any>(),
    c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM api_jobs WHERE status = 'failed' AND created_at > strftime('%s','now') - 86400`).first<any>()
  ])

  return c.json({
    queue_depth: queueSize?.cnt ?? 0,
    active_accounts: totalAccounts?.cnt ?? 0,
    total_jobs: totalJobs?.cnt ?? 0,
    errors_last_24h: recentErrors?.cnt ?? 0
  })
})

// Auto-proposal observability moved to /api/automations/proposal/* —
// those routes are roofer-scoped (customer session) with admin passthrough.
// See src/routes/automations.ts.


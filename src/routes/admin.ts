import { Hono } from 'hono'
import type { Bindings } from '../types'
import { validateAdminSession, requireSuperadmin } from './auth'
import { generateReportForOrder } from './reports'
import { createAutoInvoiceForOrder } from '../services/auto-invoice'
import { validateTraceUi } from '../utils/trace-validation'
import { RoofMeasurementEngine, traceUiToEnginePayload } from '../services/roof-measurement-engine'
import { generateApiKey } from '../middleware/api-auth'
import { addCredits } from '../services/api-billing'
import { notifyNewReportRequest } from '../services/email'
import { logAdminAction } from '../lib/audit-log'
import { clientIp } from '../lib/rate-limit'
import { encryptSecret, decryptSecret } from '../lib/secret-vault'

export const adminRoutes = new Hono<{ Bindings: Bindings }>()

// Seeds the 12 default material catalog items for a new account so users have
// context on what the Material Catalog section is for when they first open it.
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
    { category: 'drip_edge',     name: 'Aluminum Drip Edge (Type C/D)',       unit: 'pieces',  unit_price: 8.50,   coverage_per_unit: '10 ft per piece',                        is_default: 1, sort_order: 11 },
    { category: 'valley_metal',  name: 'W-Valley Flashing (Aluminum)',        unit: 'pieces',  unit_price: 22.00,  coverage_per_unit: '10 ft per piece',                        is_default: 1, sort_order: 12 },
    { category: 'nails',         name: 'Roofing Nails 1-1/4" Galvanized',    unit: 'boxes',   unit_price: 28.00,  coverage_per_unit: '5 lb box (~2 squares)',                  is_default: 1, sort_order: 13 },
    { category: 'ventilation',   name: 'Ridge Vent',                          unit: 'pieces',  unit_price: 22.00,  coverage_per_unit: '4 ft per piece',                         is_default: 1, sort_order: 14 },
    { category: 'custom',        name: 'Roofing Cement / Caulk',             unit: 'tubes',   unit_price: 8.50,   coverage_per_unit: '~1 tube per 5 squares',                  is_default: 1, sort_order: 15 },
    { category: 'custom',        name: 'Pipe Boot / Collar',                 unit: 'pieces',  unit_price: 18.00,  coverage_per_unit: '~2 per 1000 sq ft',                      is_default: 0, sort_order: 16 },
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
  return next()
})

// Test notification email — superadmin only
adminRoutes.post('/superadmin/test-notification', async (c) => {
  try {
    const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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

    // Revenue stats (EXCLUDES trial orders)
    const revenueStats = await c.env.DB.prepare(`
      SELECT
        SUM(CASE WHEN payment_status = 'paid' AND (is_trial IS NULL OR is_trial = 0) THEN price ELSE 0 END) as total_revenue,
        SUM(CASE WHEN payment_status = 'paid' AND service_tier = 'express' AND (is_trial IS NULL OR is_trial = 0) THEN price ELSE 0 END) as express_revenue,
        SUM(CASE WHEN payment_status = 'paid' AND service_tier = 'standard' AND (is_trial IS NULL OR is_trial = 0) THEN price ELSE 0 END) as standard_revenue,
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
      'drip_edge_lf', 'starter_strip_lf', 'valley_flashing_lf', 'nails_box', 'caulk_tube',
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
    // Pricing: Single=$10, 10=$9/ea, 25=$8/ea, 50=$7/ea, 100=$6/ea
    const pkgCount = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM credit_packages').first<any>()
    if (!pkgCount?.cnt || pkgCount.cnt === 0) {
      await c.env.DB.prepare(`
        INSERT INTO credit_packages (id, name, description, credits, price_cents, sort_order)
        VALUES
          (1, '10 Pack', '10 reports — $9.00/ea — Save 10%', 10, 9000, 1),
          (2, '25 Pack', '25 reports — $8.00/ea — Save 20%', 25, 20000, 2),
          (3, '50 Pack', '50 reports — $7.00/ea — Save 30%', 50, 35000, 3),
          (4, '100 Pack', '100 reports — best value — $6.00/ea — Save 40%', 100, 60000, 4)
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

    // 1. Platform users (customers table)
    if (!typeFilter || typeFilter === 'platform_user') {
      const q = search
        ? `SELECT id, name, email, phone, company_name, 'platform_user' as person_type, created_at, is_active, last_login
           FROM customers WHERE name LIKE ? OR email LIKE ? OR phone LIKE ? OR company_name LIKE ?
           ORDER BY created_at DESC LIMIT ?`
        : `SELECT id, name, email, phone, company_name, 'platform_user' as person_type, created_at, is_active, last_login
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

adminRoutes.get('/superadmin/users', async (c) => {
  const admin = c.get('admin' as any)
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  try {
    const users = await c.env.DB.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) as order_count,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.is_trial = 1) as trial_orders,
        (SELECT COALESCE(SUM(o.price), 0) FROM orders o WHERE o.customer_id = c.id AND o.payment_status = 'paid' AND (o.is_trial IS NULL OR o.is_trial = 0)) as total_spent,
        (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id = c.id) as last_order_date,
        (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status = 'completed') as completed_reports
      FROM customers c
      ORDER BY c.created_at DESC
    `).all()

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
        SUM(CASE WHEN created_at >= date('now', '-30 days') THEN 1 ELSE 0 END) as new_signups_30d
      FROM customers
    `).first()

    return c.json({ users: users.results, summary })
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

    // Per-report order sales (non-trial)
    const orderSalesByPeriod = await c.env.DB.prepare(`
      SELECT ${groupBy.replace(/sp\./g, 'o.')} as period,
        COUNT(*) as orders,
        SUM(o.price) as total_value,
        SUM(CASE WHEN o.payment_status = 'paid' THEN o.price ELSE 0 END) as paid_value,
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
        SUM(CASE WHEN payment_status = 'paid' AND (is_trial IS NULL OR is_trial = 0) THEN price ELSE 0 END) as paid_value,
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
        SUM(CASE WHEN is_trial = 1 THEN 1 ELSE 0 END) as trial_orders
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
// SUPERADMIN: UNIFIED INBOX — Aggregates rover chat, secretary calls/messages/callbacks, lead captures
// ============================================================

// GET /superadmin/inbox — Unified conversations across all channels
adminRoutes.get('/superadmin/inbox', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  try {
    const channel = c.req.query('channel') || ''  // web_chat, voice, sms, voicemail, form, all
    const limit = parseInt(c.req.query('limit') || '50')
    const offset = parseInt(c.req.query('offset') || '0')
    const search = c.req.query('search') || ''

    const conversations: any[] = []

    // 1. Rover web chat conversations
    if (!channel || channel === 'all' || channel === 'web_chat') {
      const roverQuery = search
        ? `SELECT id, visitor_name as contact_name, visitor_email as contact_email, visitor_phone as contact_phone,
             'web_chat' as channel, status, lead_status, summary as preview,
             last_message_at as last_activity_at, first_message_at as created_at,
             (SELECT COUNT(*) FROM rover_messages WHERE conversation_id = rc.id) as message_count
           FROM rover_conversations rc
           WHERE visitor_name LIKE ? OR visitor_email LIKE ? OR summary LIKE ?
           ORDER BY last_message_at DESC LIMIT 100`
        : `SELECT id, visitor_name as contact_name, visitor_email as contact_email, visitor_phone as contact_phone,
             'web_chat' as channel, status, lead_status, summary as preview,
             last_message_at as last_activity_at, first_message_at as created_at,
             (SELECT COUNT(*) FROM rover_messages WHERE conversation_id = rc.id) as message_count
           FROM rover_conversations rc
           ORDER BY last_message_at DESC LIMIT 100`
      const roverRes = search
        ? await c.env.DB.prepare(roverQuery).bind(`%${search}%`, `%${search}%`, `%${search}%`).all()
        : await c.env.DB.prepare(roverQuery).all()
      for (const r of (roverRes.results || [])) {
        conversations.push({ ...r, source_id: `rover_${r.id}` })
      }
    }

    // 2. Secretary call logs
    if (!channel || channel === 'all' || channel === 'voice') {
      const callQuery = search
        ? `SELECT cl.id, cl.caller_name as contact_name, '' as contact_email, cl.caller_phone as contact_phone,
             'voice' as channel, cl.call_outcome as status, '' as lead_status,
             cl.call_summary as preview, cl.created_at as last_activity_at, cl.created_at,
             1 as message_count, cl.call_duration_seconds, c.company_name as customer_company
           FROM secretary_call_logs cl
           LEFT JOIN customers c ON c.id = cl.customer_id
           WHERE cl.caller_name LIKE ? OR cl.caller_phone LIKE ? OR cl.call_summary LIKE ?
           ORDER BY cl.created_at DESC LIMIT 100`
        : `SELECT cl.id, cl.caller_name as contact_name, '' as contact_email, cl.caller_phone as contact_phone,
             'voice' as channel, cl.call_outcome as status, '' as lead_status,
             cl.call_summary as preview, cl.created_at as last_activity_at, cl.created_at,
             1 as message_count, cl.call_duration_seconds, c.company_name as customer_company
           FROM secretary_call_logs cl
           LEFT JOIN customers c ON c.id = cl.customer_id
           ORDER BY cl.created_at DESC LIMIT 100`
      const callRes = search
        ? await c.env.DB.prepare(callQuery).bind(`%${search}%`, `%${search}%`, `%${search}%`).all()
        : await c.env.DB.prepare(callQuery).all()
      for (const r of (callRes.results || [])) {
        conversations.push({ ...r, source_id: `call_${r.id}` })
      }
    }

    // 3. Secretary messages (answering mode)
    if (!channel || channel === 'all' || channel === 'sms') {
      const msgQuery = search
        ? `SELECT sm.id, sm.caller_name as contact_name, '' as contact_email, sm.caller_phone as contact_phone,
             'sms' as channel, CASE WHEN sm.is_read = 1 THEN 'read' ELSE 'new' END as status, '' as lead_status,
             sm.message_text as preview, sm.created_at as last_activity_at, sm.created_at,
             1 as message_count, sm.urgency, c.company_name as customer_company
           FROM secretary_messages sm
           LEFT JOIN customers c ON c.id = sm.customer_id
           WHERE sm.caller_name LIKE ? OR sm.caller_phone LIKE ? OR sm.message_text LIKE ?
           ORDER BY sm.created_at DESC LIMIT 100`
        : `SELECT sm.id, sm.caller_name as contact_name, '' as contact_email, sm.caller_phone as contact_phone,
             'sms' as channel, CASE WHEN sm.is_read = 1 THEN 'read' ELSE 'new' END as status, '' as lead_status,
             sm.message_text as preview, sm.created_at as last_activity_at, sm.created_at,
             1 as message_count, sm.urgency, c.company_name as customer_company
           FROM secretary_messages sm
           LEFT JOIN customers c ON c.id = sm.customer_id
           ORDER BY sm.created_at DESC LIMIT 100`
      const msgRes = search
        ? await c.env.DB.prepare(msgQuery).bind(`%${search}%`, `%${search}%`, `%${search}%`).all()
        : await c.env.DB.prepare(msgQuery).all()
      for (const r of (msgRes.results || [])) {
        conversations.push({ ...r, source_id: `msg_${r.id}` })
      }
    }

    // 4. Secretary callbacks
    if (!channel || channel === 'all' || channel === 'voicemail') {
      const cbQuery = search
        ? `SELECT sc.id, sc.caller_name as contact_name, '' as contact_email, sc.caller_phone as contact_phone,
             'voicemail' as channel, sc.status, '' as lead_status,
             sc.reason as preview, sc.created_at as last_activity_at, sc.created_at,
             1 as message_count, sc.preferred_time, c.company_name as customer_company
           FROM secretary_callbacks sc
           LEFT JOIN customers c ON c.id = sc.customer_id
           WHERE sc.caller_name LIKE ? OR sc.caller_phone LIKE ? OR sc.reason LIKE ?
           ORDER BY sc.created_at DESC LIMIT 50`
        : `SELECT sc.id, sc.caller_name as contact_name, '' as contact_email, sc.caller_phone as contact_phone,
             'voicemail' as channel, sc.status, '' as lead_status,
             sc.reason as preview, sc.created_at as last_activity_at, sc.created_at,
             1 as message_count, sc.preferred_time, c.company_name as customer_company
           FROM secretary_callbacks sc
           LEFT JOIN customers c ON c.id = sc.customer_id
           ORDER BY sc.created_at DESC LIMIT 50`
      const cbRes = search
        ? await c.env.DB.prepare(cbQuery).bind(`%${search}%`, `%${search}%`, `%${search}%`).all()
        : await c.env.DB.prepare(cbQuery).all()
      for (const r of (cbRes.results || [])) {
        conversations.push({ ...r, source_id: `cb_${r.id}` })
      }
    }

    // 5. Lead capture form submissions (all lead tables)
    if (!channel || channel === 'all' || channel === 'form') {
      // 5a. asset_report_leads (homepage CTA, exit intent, demo portal, condo)
      const leadQuery = search
        ? `SELECT id, name as contact_name, email as contact_email, '' as contact_phone,
             'form' as channel, 'new' as status, '' as lead_status,
             COALESCE(address, 'Lead from ' || source) as preview,
             created_at as last_activity_at, created_at,
             1 as message_count, source, tag, company as customer_company
           FROM asset_report_leads
           WHERE name LIKE ? OR email LIKE ? OR address LIKE ?
           ORDER BY created_at DESC LIMIT 100`
        : `SELECT id, name as contact_name, email as contact_email, '' as contact_phone,
             'form' as channel, 'new' as status, '' as lead_status,
             COALESCE(address, 'Lead from ' || source) as preview,
             created_at as last_activity_at, created_at,
             1 as message_count, source, tag, company as customer_company
           FROM asset_report_leads
           ORDER BY created_at DESC LIMIT 100`
      const leadRes = search
        ? await c.env.DB.prepare(leadQuery).bind(`%${search}%`, `%${search}%`, `%${search}%`).all()
        : await c.env.DB.prepare(leadQuery).all()
      for (const r of (leadRes.results || [])) {
        conversations.push({ ...r, source_id: `lead_${r.id}` })
      }

      // 5b. leads table (blog, pricing, feature page, comparison page forms)
      try {
        const siteLeadQuery = search
          ? `SELECT id, name as contact_name, email as contact_email, phone as contact_phone,
               'form' as channel, status, '' as lead_status,
               COALESCE(message, 'Lead from ' || source_page) as preview,
               created_at as last_activity_at, created_at,
               1 as message_count, source_page as source, '' as tag, company_name as customer_company
             FROM leads
             WHERE name LIKE ? OR email LIKE ? OR message LIKE ? OR company_name LIKE ?
             ORDER BY created_at DESC LIMIT 100`
          : `SELECT id, name as contact_name, email as contact_email, phone as contact_phone,
               'form' as channel, status, '' as lead_status,
               COALESCE(message, 'Lead from ' || source_page) as preview,
               created_at as last_activity_at, created_at,
               1 as message_count, source_page as source, '' as tag, company_name as customer_company
             FROM leads
             ORDER BY created_at DESC LIMIT 100`
        const siteLeadRes = search
          ? await c.env.DB.prepare(siteLeadQuery).bind(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`).all()
          : await c.env.DB.prepare(siteLeadQuery).all()
        for (const r of (siteLeadRes.results || [])) {
          conversations.push({ ...r, source_id: `sitelead_${r.id}` })
        }
      } catch (e) { /* leads table may not exist */ }

      // 5c. contact_leads table (contact page form)
      try {
        const contactQuery = search
          ? `SELECT id, name as contact_name, email as contact_email, phone as contact_phone,
               'form' as channel, 'new' as status, '' as lead_status,
               COALESCE(message, 'Contact form inquiry') as preview,
               created_at as last_activity_at, created_at,
               1 as message_count, 'contact_form' as source, interest as tag, company as customer_company
             FROM contact_leads
             WHERE name LIKE ? OR email LIKE ? OR message LIKE ? OR company LIKE ?
             ORDER BY created_at DESC LIMIT 100`
          : `SELECT id, name as contact_name, email as contact_email, phone as contact_phone,
               'form' as channel, 'new' as status, '' as lead_status,
               COALESCE(message, 'Contact form inquiry') as preview,
               created_at as last_activity_at, created_at,
               1 as message_count, 'contact_form' as source, interest as tag, company as customer_company
             FROM contact_leads
             ORDER BY created_at DESC LIMIT 100`
        const contactRes = search
          ? await c.env.DB.prepare(contactQuery).bind(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`).all()
          : await c.env.DB.prepare(contactQuery).all()
        for (const r of (contactRes.results || [])) {
          conversations.push({ ...r, source_id: `contact_${r.id}` })
        }
      } catch (e) { /* contact_leads table may not exist */ }

      // 5d. demo_leads table (demo scheduling form)
      try {
        const demoQuery = search
          ? `SELECT id, name as contact_name, email as contact_email, phone as contact_phone,
               'form' as channel, 'new' as status, '' as lead_status,
               COALESCE(message, 'Demo request') as preview,
               created_at as last_activity_at, created_at,
               1 as message_count, 'demo_request' as source, '' as tag, company as customer_company
             FROM demo_leads
             WHERE name LIKE ? OR email LIKE ? OR message LIKE ? OR company LIKE ?
             ORDER BY created_at DESC LIMIT 100`
          : `SELECT id, name as contact_name, email as contact_email, phone as contact_phone,
               'form' as channel, 'new' as status, '' as lead_status,
               COALESCE(message, 'Demo request') as preview,
               created_at as last_activity_at, created_at,
               1 as message_count, 'demo_request' as source, '' as tag, company as customer_company
             FROM demo_leads
             ORDER BY created_at DESC LIMIT 100`
        const demoRes = search
          ? await c.env.DB.prepare(demoQuery).bind(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`).all()
          : await c.env.DB.prepare(demoQuery).all()
        for (const r of (demoRes.results || [])) {
          conversations.push({ ...r, source_id: `demo_${r.id}` })
        }
      } catch (e) { /* demo_leads table may not exist */ }
    }

    // 6. Cold-call outbound call logs
    if (!channel || channel === 'all' || channel === 'cold_call') {
      try {
        const ccQuery = search
          ? `SELECT cl.id, cl.contact_name, '' as contact_email, cl.phone_dialed as contact_phone,
               'cold_call' as channel, cl.call_outcome as status, '' as lead_status,
               cl.call_summary as preview, cl.created_at as last_activity_at, cl.created_at,
               1 as message_count, cl.call_duration_seconds, cl.company_name as customer_company
             FROM cc_call_logs cl
             WHERE cl.contact_name LIKE ? OR cl.phone_dialed LIKE ? OR cl.call_summary LIKE ?
             ORDER BY cl.created_at DESC LIMIT 100`
          : `SELECT cl.id, cl.contact_name, '' as contact_email, cl.phone_dialed as contact_phone,
               'cold_call' as channel, cl.call_outcome as status, '' as lead_status,
               cl.call_summary as preview, cl.created_at as last_activity_at, cl.created_at,
               1 as message_count, cl.call_duration_seconds, cl.company_name as customer_company
             FROM cc_call_logs cl
             ORDER BY cl.created_at DESC LIMIT 100`
        const ccRes = search
          ? await c.env.DB.prepare(ccQuery).bind(`%${search}%`, `%${search}%`, `%${search}%`).all()
          : await c.env.DB.prepare(ccQuery).all()
        for (const r of (ccRes.results || [])) {
          conversations.push({ ...r, source_id: `cc_${r.id}` })
        }
      } catch (e) { /* cc_call_logs may not exist */ }
    }

    // 7. CRM job messages (crew messages)
    if (!channel || channel === 'all' || channel === 'job_message') {
      try {
        const jmQuery = search
          ? `SELECT cm.id, cm.author_name as contact_name, '' as contact_email, '' as contact_phone,
               'job_message' as channel, 'open' as status, '' as lead_status,
               cm.content as preview, cm.created_at as last_activity_at, cm.created_at,
               1 as message_count, j.title as customer_company
             FROM crew_messages cm
             LEFT JOIN crm_jobs j ON j.id = cm.job_id
             WHERE cm.author_name LIKE ? OR cm.content LIKE ?
             ORDER BY cm.created_at DESC LIMIT 100`
          : `SELECT cm.id, cm.author_name as contact_name, '' as contact_email, '' as contact_phone,
               'job_message' as channel, 'open' as status, '' as lead_status,
               cm.content as preview, cm.created_at as last_activity_at, cm.created_at,
               1 as message_count, j.title as customer_company
             FROM crew_messages cm
             LEFT JOIN crm_jobs j ON j.id = cm.job_id
             ORDER BY cm.created_at DESC LIMIT 100`
        const jmRes = search
          ? await c.env.DB.prepare(jmQuery).bind(`%${search}%`, `%${search}%`).all()
          : await c.env.DB.prepare(jmQuery).all()
        for (const r of (jmRes.results || [])) {
          conversations.push({ ...r, source_id: `job_${r.id}` })
        }
      } catch (e) { /* crew_messages may not exist */ }
    }

    // Sort all by last_activity_at descending, then paginate
    conversations.sort((a, b) => {
      const da = a.last_activity_at || a.created_at || ''
      const db = b.last_activity_at || b.created_at || ''
      return db.localeCompare(da)
    })

    const total = conversations.length
    const paginated = conversations.slice(offset, offset + limit)

    // Unread counts per channel
    const unreadCounts: Record<string, number> = {}
    try {
      const roverUnread = await c.env.DB.prepare(
        `SELECT COUNT(*) as c FROM rover_conversations WHERE status = 'active'`
      ).first<any>()
      unreadCounts.web_chat = roverUnread?.c || 0

      const msgUnread = await c.env.DB.prepare(
        `SELECT COUNT(*) as c FROM secretary_messages WHERE is_read = 0`
      ).first<any>()
      unreadCounts.sms = msgUnread?.c || 0

      const cbPending = await c.env.DB.prepare(
        `SELECT COUNT(*) as c FROM secretary_callbacks WHERE status = 'pending'`
      ).first<any>()
      unreadCounts.voicemail = cbPending?.c || 0

      const todayCalls = await c.env.DB.prepare(
        `SELECT COUNT(*) as c FROM secretary_call_logs WHERE created_at >= datetime('now', '-24 hours')`
      ).first<any>()
      unreadCounts.voice = todayCalls?.c || 0

      let formCount = 0
      const recentLeads = await c.env.DB.prepare(
        `SELECT COUNT(*) as c FROM asset_report_leads WHERE created_at >= datetime('now', '-7 days')`
      ).first<any>()
      formCount += recentLeads?.c || 0
      try { const r = await c.env.DB.prepare(`SELECT COUNT(*) as c FROM leads WHERE created_at >= datetime('now', '-7 days')`).first<any>(); formCount += r?.c || 0 } catch {}
      try { const r = await c.env.DB.prepare(`SELECT COUNT(*) as c FROM contact_leads WHERE created_at >= datetime('now', '-7 days')`).first<any>(); formCount += r?.c || 0 } catch {}
      try { const r = await c.env.DB.prepare(`SELECT COUNT(*) as c FROM demo_leads WHERE created_at >= datetime('now', '-7 days')`).first<any>(); formCount += r?.c || 0 } catch {}
      unreadCounts.form = formCount
    } catch (e) { /* counts are best-effort */ }

    const totalUnread = (unreadCounts.web_chat || 0) + (unreadCounts.sms || 0) + (unreadCounts.voicemail || 0)

    return c.json({
      conversations: paginated,
      total,
      offset,
      limit,
      unread: unreadCounts,
      total_unread: totalUnread
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// GET /superadmin/inbox/unread-count — Lightweight badge count
adminRoutes.get('/superadmin/inbox/unread-count', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  try {
    const [roverR, msgR, cbR] = await Promise.all([
      c.env.DB.prepare(`SELECT COUNT(*) as c FROM rover_conversations WHERE status = 'active'`).first<any>(),
      c.env.DB.prepare(`SELECT COUNT(*) as c FROM secretary_messages WHERE is_read = 0`).first<any>(),
      c.env.DB.prepare(`SELECT COUNT(*) as c FROM secretary_callbacks WHERE status = 'pending'`).first<any>(),
    ])
    const total = (roverR?.c || 0) + (msgR?.c || 0) + (cbR?.c || 0)
    return c.json({ total, web_chat: roverR?.c || 0, sms: msgR?.c || 0, voicemail: cbR?.c || 0 })
  } catch (err: any) {
    return c.json({ total: 0 }, 200)
  }
})

// GET /superadmin/inbox/lead/:type/:id — Single lead detail (type = lead|sitelead|contact|demo)
adminRoutes.get('/superadmin/inbox/lead/:type/:id', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)
  try {
    // Subscription stats
    const subStats = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total_subscriptions,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_count,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
        SUM(CASE WHEN status = 'past_due' THEN 1 ELSE 0 END) as past_due_count,
        SUM(CASE WHEN status = 'active' THEN monthly_price_cents ELSE 0 END) as monthly_mrr_cents
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const tierPrices: Record<string, number> = { starter: 4999, pro: 14900, enterprise: 49900 }
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
        1,
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
      // Create secretary subscription (active, bypassing payment)
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO secretary_subscriptions (customer_id, status, monthly_price_cents, created_at, updated_at)
        VALUES (?, 'active', 14900, datetime('now'), datetime('now'))
      `).bind(customerId).run()

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
            VALUES (?, 1, ?, ?, 0, 0, ?, 'USD', 'sent', 'invoice', ?, ?, datetime('now'), datetime('now', '+30 days'), datetime('now'), datetime('now'))
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
        quick_pay: { name: `Invoice ${invoiceNumber}`, price_money: { amount: Math.round(totalDollars * 100), currency: 'USD' }, location_id: sqLocation }
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
      VALUES (?, ?, ?, ?, ?, 1, 1, 0, 0, 0, 'starter', 'inactive', 1, datetime('now'), datetime('now'))
    `).bind(email.toLowerCase(), password_hash, name, company_name || name, phone || '').run()
    const customerId = (result as any).meta?.last_row_id
    return c.json({ success: true, customer_id: customerId, email: email.toLowerCase() })
  } catch (err: any) {
    return c.json({ error: 'Failed to create user', details: err.message }, 500)
  }
})

// POST /superadmin/secretary/:customerId/sip-config — Update SIP fields without re-onboarding
adminRoutes.post('/superadmin/secretary/:customerId/sip-config', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
// SUPERADMIN: PHONE NUMBER MANAGEMENT
// ============================================================

// GET /superadmin/phone-numbers/available — Search Twilio available numbers
adminRoutes.get('/superadmin/phone-numbers/available', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const id = parseInt(c.req.param('id'))
  await c.env.DB.prepare('UPDATE customers SET is_active = 0, updated_at = datetime("now") WHERE id = ?').bind(id).run()
  return c.json({ success: true, message: 'Customer suspended' })
})

// Reactivate customer
adminRoutes.post('/superadmin/users/:id/reactivate', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const id = parseInt(c.req.param('id'))
  await c.env.DB.prepare('UPDATE customers SET is_active = 1, updated_at = datetime("now") WHERE id = ?').bind(id).run()
  return c.json({ success: true, message: 'Customer reactivated' })
})

// Delete customer (soft)
adminRoutes.delete('/superadmin/users/:id', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const configs = await c.env.DB.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN is_active=1 THEN 1 ELSE 0 END) as active FROM secretary_config").first<any>()
  const calls30d = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM secretary_call_logs WHERE created_at > datetime('now', '-30 days')").first<any>()
  const phones = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM secretary_phone_pool").first<any>()
  return c.json({ livekit_url: (c.env as any).LIVEKIT_URL || '', sip_uri: (c.env as any).LIVEKIT_SIP_URI || '', configured: !!(c.env as any).LIVEKIT_API_KEY, total_configs: configs?.total || 0, active_configs: configs?.active || 0, calls_30d: calls30d?.cnt || 0, phone_pool_size: phones?.cnt || 0 })
})

// Secretary configs list
adminRoutes.get('/superadmin/livekit/secretary-configs', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const rows = await c.env.DB.prepare(
    `SELECT sc.*, c.name as customer_name, c.email as customer_email, c.company_name
     FROM secretary_config sc LEFT JOIN customers c ON c.id = sc.customer_id ORDER BY sc.updated_at DESC`
  ).all<any>()
  return c.json({ configs: rows.results || [] })
})

// Phone pool
adminRoutes.get('/superadmin/livekit/phone-pool', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const rows = await c.env.DB.prepare(
    `SELECT p.*, c.name as customer_name, c.email as customer_email
     FROM secretary_phone_pool p LEFT JOIN customers c ON c.id = p.assigned_to_customer_id ORDER BY p.created_at DESC`
  ).all<any>()
  return c.json({ phones: rows.results || [] })
})

// Add phone to pool
adminRoutes.post('/superadmin/livekit/phone-pool/add', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const { phone_number, region } = await c.req.json()
  if (!phone_number) return c.json({ error: 'phone_number required' }, 400)
  await c.env.DB.prepare("INSERT OR IGNORE INTO secretary_phone_pool (phone_number, region, status, assigned_at) VALUES (?, ?, 'available', datetime('now'))").bind(phone_number, region || 'CA').run()
  return c.json({ success: true })
})

// Release phone from customer
adminRoutes.post('/superadmin/livekit/phone-pool/release', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const { phone_number } = await c.req.json()
  await c.env.DB.prepare("UPDATE secretary_phone_pool SET status = 'available', assigned_to_customer_id = NULL, updated_at = datetime('now') WHERE phone_number = ?").bind(phone_number).run()
  return c.json({ success: true })
})

// Toggle secretary config
adminRoutes.post('/superadmin/livekit/secretary-config/toggle', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const { customer_id, enabled } = await c.req.json()
  await c.env.DB.prepare('UPDATE secretary_config SET is_active = ?, updated_at = datetime("now") WHERE customer_id = ?').bind(enabled ? 1 : 0, customer_id).run()
  return c.json({ success: true })
})

// Get customer secretary config
adminRoutes.get('/superadmin/livekit/secretary-config/:customerId', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const config = await c.env.DB.prepare('SELECT sc.*, c.name, c.email, c.company_name FROM secretary_config sc LEFT JOIN customers c ON c.id = sc.customer_id WHERE sc.customer_id = ?').bind(parseInt(c.req.param('customerId'))).first<any>()
  if (!config) return c.json({ error: 'Config not found' }, 404)
  const dirs = await c.env.DB.prepare('SELECT * FROM secretary_directories WHERE config_id = ? ORDER BY sort_order').bind(config.id).all<any>()
  return c.json({ config, directories: dirs.results || [] })
})

// Create SIP trunk via LiveKit
adminRoutes.post('/superadmin/livekit/trunk/create', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const rows = await c.env.DB.prepare('SELECT p.*, c.name as customer_name FROM secretary_phone_pool p LEFT JOIN customers c ON c.id = p.assigned_to_customer_id ORDER BY p.created_at DESC').all<any>()
  return c.json({ phones: rows.results || [] })
})

// ============================================================
// AREA 3: SYSTEM HEALTH & MONITORING
// ============================================================

// System health
adminRoutes.get('/superadmin/system-health', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const checks: Record<string, any> = {}
  // DB check
  try { const r = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM customers').first<any>(); checks.database = { status: 'ok', customers: r?.cnt || 0 } } catch (e: any) { checks.database = { status: 'error', error: e.message } }
  // Env vars
  checks.env = {
    SQUARE_ACCESS_TOKEN: !!(c.env as any).SQUARE_ACCESS_TOKEN,
    LIVEKIT_API_KEY: !!(c.env as any).LIVEKIT_API_KEY,
    LIVEKIT_URL: !!(c.env as any).LIVEKIT_URL,
    GEMINI_API_KEY: !!(c.env as any).GEMINI_API_KEY,
    GOOGLE_SOLAR_API_KEY: !!(c.env as any).GOOGLE_SOLAR_API_KEY,
    GOOGLE_MAPS_API_KEY: !!(c.env as any).GOOGLE_MAPS_API_KEY,
    GA4_MEASUREMENT_ID: !!(c.env as any).GA4_MEASUREMENT_ID,
    JWT_SECRET: !!(c.env as any).JWT_SECRET,
    SIP_OUTBOUND_TRUNK_ID: !!(c.env as any).SIP_OUTBOUND_TRUNK_ID,
  }
  // Recent errors
  try { const errs = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status = 'failed' AND created_at > datetime('now', '-7 days')").first<any>(); checks.recent_errors = { failed_orders_7d: errs?.cnt || 0 } } catch { checks.recent_errors = { failed_orders_7d: 0 } }
  // Orders today
  try { const today = await c.env.DB.prepare("SELECT COUNT(*) as cnt FROM orders WHERE created_at > datetime('now', '-1 day')").first<any>(); checks.activity = { orders_24h: today?.cnt || 0 } } catch { checks.activity = { orders_24h: 0 } }
  return c.json(checks)
})

// Paywall status
adminRoutes.get('/superadmin/paywall-status', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const tiers = await c.env.DB.prepare("SELECT subscription_plan, COUNT(*) as cnt FROM customers WHERE is_active = 1 GROUP BY subscription_plan").all<any>()
  const packages = await c.env.DB.prepare("SELECT * FROM credit_packages WHERE is_active = 1 ORDER BY sort_order").all<any>()
  return c.json({ tiers: tiers.results || [], packages: packages.results || [], square_configured: !!(c.env as any).SQUARE_ACCESS_TOKEN })
})

// Service invoices
adminRoutes.get('/superadmin/service-invoices', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const rows = await c.env.DB.prepare("SELECT i.*, c.name as customer_name, c.email as customer_email FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.master_company_id = 1 ORDER BY i.created_at DESC LIMIT 200").all<any>()
  return c.json({ invoices: rows.results || [] })
})

// Service invoice — create by customer email
adminRoutes.post('/superadmin/service-invoices/create', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
       VALUES (?, ?, ?, ?, 0, ?, 'USD', 'draft', 'invoice', ?, ?, ?, datetime('now'), datetime('now'))`
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  try {
    const rows = await c.env.DB.prepare('SELECT * FROM cc_campaigns ORDER BY created_at DESC').all<any>()
    return c.json({ scripts: rows.results || [] })
  } catch { return c.json({ scripts: [] }) }
})

// Call center stats
adminRoutes.get('/superadmin/call-center/stats', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  try {
    const rows = await c.env.DB.prepare("SELECT * FROM settings WHERE setting_key LIKE 'seo_%' AND master_company_id = 1").all<any>()
    return c.json({ pages: rows.results || [] })
  } catch { return c.json({ pages: [] }) }
})

// Save SEO page meta
adminRoutes.put('/superadmin/seo/page-meta', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  try {
    const rows = await c.env.DB.prepare("SELECT * FROM settings WHERE setting_key = 'seo_backlinks' AND master_company_id = 1").first<any>()
    return c.json({ backlinks: rows?.setting_value ? JSON.parse(rows.setting_value) : [] })
  } catch { return c.json({ backlinks: [] }) }
})

adminRoutes.post('/superadmin/seo/backlinks', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const { url, anchor_text, domain_authority } = await c.req.json()
  let existing: any[] = []
  try { const row = await c.env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key = 'seo_backlinks' AND master_company_id = 1").first<any>(); existing = row?.setting_value ? JSON.parse(row.setting_value) : [] } catch {}
  existing.push({ id: Date.now(), url, anchor_text, domain_authority, created_at: new Date().toISOString() })
  await c.env.DB.prepare("INSERT OR REPLACE INTO settings (master_company_id, setting_key, setting_value) VALUES (1, 'seo_backlinks', ?)").bind(JSON.stringify(existing)).run()
  return c.json({ success: true })
})

adminRoutes.delete('/superadmin/seo/backlinks/:id', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  try {
    const row = await c.env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key = 'onboarding_config' AND master_company_id = 1").first<any>()
    return c.json({ config: row?.setting_value ? JSON.parse(row.setting_value) : { free_trial_reports: 3, require_phone: false, enable_secretary: true, default_plan: 'free' } })
  } catch { return c.json({ config: { free_trial_reports: 3, require_phone: false, enable_secretary: true, default_plan: 'free' } }) }
})

// ============================================================
// MANUAL TRACE QUEUE — Get orders waiting for admin trace
// ============================================================
adminRoutes.get('/superadmin/orders/needs-trace', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  try {
    const orders = await c.env.DB.prepare(`
      SELECT o.id, o.order_number, o.property_address, o.latitude, o.longitude,
             o.created_at, o.customer_id, o.source, o.api_job_id,
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
// PREVIEW TRACE — Dry-run the engine on a proposed trace without saving.
// Returns validation issues + a before/after delta vs the currently-stored
// trace (if any). Used by the admin review panel to QA an override.
// ============================================================
adminRoutes.post('/superadmin/orders/:id/preview-trace', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
        }
      } catch (e: any) {
        return { error: e.message }
      }
    }

    let proposed: any = null
    if (validation.valid) proposed = runEngine(traceObj)

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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Unauthorized' }, 403)
  const orderId = parseInt(c.req.param('id'))
  if (isNaN(orderId)) return c.json({ error: 'Invalid order ID' }, 400)
  try {
    const { roof_trace_json, force } = await c.req.json()
    if (!roof_trace_json) return c.json({ error: 'roof_trace_json is required' }, 400)

    // Parse if string, then validate structure + geometry before anything hits the DB
    let traceObj: any
    try {
      traceObj = typeof roof_trace_json === 'string' ? JSON.parse(roof_trace_json) : roof_trace_json
    } catch (e: any) {
      return c.json({ error: 'roof_trace_json is not valid JSON', details: e.message }, 400)
    }
    const validation = validateTraceUi(traceObj)
    if (!validation.valid && !force) {
      return c.json({
        error: 'Trace validation failed. Re-submit with force=true to override.',
        validation_errors: validation.errors,
        validation_warnings: validation.warnings,
      }, 400)
    }

    // Audit: capture the previous trace (if any) so overrides are reversible
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

    // Save the trace
    const traceStr = JSON.stringify(traceObj)
    await c.env.DB.prepare(
      "UPDATE orders SET roof_trace_json = ?, needs_admin_trace = 0, updated_at = datetime('now') WHERE id = ?"
    ).bind(traceStr, orderId).run()

    // Generate the report (this is admin submitting so we call synchronously within worker timeout)
    const result = await generateReportForOrder(orderId, c.env, (c as any).executionCtx)

    // Auto-invoice: admin-traced orders previously only got a draft proposal
    // when the 10-minute cron sweep ran. Hook it inline so the roofer sees
    // the proposal within seconds of the trace being submitted.
    if (result?.success) {
      const ctx = (c as any).executionCtx
      const autoInvP = createAutoInvoiceForOrder(c.env, Number(orderId))
        .catch((e) => console.warn('[auto-invoice] admin-trace hook error:', e?.message))
      if (ctx?.waitUntil) ctx.waitUntil(autoInvP)
    }

    // Notify the customer via push (best-effort)
    try {
      const order = await c.env.DB.prepare(
        'SELECT customer_id, property_address, order_number FROM orders WHERE id = ?'
      ).bind(orderId).first<any>()
      if (order?.customer_id) {
        const subs = await c.env.DB.prepare(
          'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE customer_id = ?'
        ).bind(order.customer_id).all()
        // Log the activity — customer will see report in dashboard via polling
        await c.env.DB.prepare(
          "INSERT INTO user_activity_log (company_id, action, details) VALUES (1, 'manual_trace_completed', ?)"
        ).bind(`Admin traced order ${order.order_number} — ${order.property_address}`).run()
      }
    } catch(e) { /* non-fatal */ }

    return c.json({ success: true, result })
  } catch (err: any) {
    return c.json({ error: 'Failed to submit trace: ' + err.message }, 500)
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
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

// ============================================================
// AUTO-PROPOSAL OBSERVABILITY (superadmin-only)
// These surface the health of the auto-invoice pipeline without
// requiring shell access to wrangler / D1.
// ============================================================

// GET /api/admin/auto-proposal/health
// Reports whether Gmail is configured, when the last successful send
// happened, how many auto-drafts are pending, plus the last 10 audit
// rows across all orders.
adminRoutes.get('/auto-proposal/health', async (c) => {
  const admin = c.get('admin' as any)
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  const env: any = c.env
  const platformGmail = !!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN)
  // Per-customer Gmail only works if GMAIL_CLIENT_ID + _SECRET are set
  // (the refresh token comes from customers.gmail_refresh_token).
  const perCustomerPossible = !!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET)
  const connected = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM customers
     WHERE gmail_refresh_token IS NOT NULL AND gmail_refresh_token != ''`
  ).first<{ n: number }>()
  const customersWithGmail = connected?.n ?? 0
  // Auto-proposal can send when: platform Gmail exists OR at least one
  // customer has connected their own Gmail.
  const gmailConfigured = platformGmail || (perCustomerPossible && customersWithGmail > 0)

  const [lastSent, pendingDrafts, recent, counts24h] = await Promise.all([
    c.env.DB.prepare(
      `SELECT created_at FROM invoice_audit_log
       WHERE action = 'auto_invoice_proposal_emailed'
       ORDER BY id DESC LIMIT 1`
    ).first<{ created_at: string }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) as n FROM invoices
       WHERE created_by = 'auto-invoice' AND status = 'draft'`
    ).first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT id, order_id, invoice_id, action, new_value as reason, created_at
       FROM invoice_audit_log
       WHERE changed_by = 'auto-invoice'
       ORDER BY id DESC LIMIT 10`
    ).all(),
    c.env.DB.prepare(
      `SELECT action, COUNT(*) as n FROM invoice_audit_log
       WHERE changed_by = 'auto-invoice'
         AND created_at >= datetime('now', '-1 day')
       GROUP BY action ORDER BY n DESC`
    ).all(),
  ])

  return c.json({
    gmail_configured: gmailConfigured,
    gmail_platform_configured: platformGmail,
    customers_with_gmail_connected: customersWithGmail,
    last_successful_send_at: lastSent?.created_at ?? null,
    pending_drafts_count: pendingDrafts?.n ?? 0,
    last_10_audit_log_entries: recent.results || [],
    action_counts_last_24h: counts24h.results || []
  })
})

// POST /api/admin/auto-proposal/trigger?order_id=N
// Superadmin-only diagnostic: manually invokes the same event-driven
// createAutoInvoiceForOrder path that fires from report completion.
// Idempotent (the service itself skips if an auto-invoice row already
// exists for the order). Returns the service's structured result.
adminRoutes.post('/auto-proposal/trigger', async (c) => {
  const admin = c.get('admin' as any)
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  const orderIdRaw = c.req.query('order_id')
  const orderId = orderIdRaw ? parseInt(orderIdRaw, 10) : NaN
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return c.json({ error: 'order_id query param required (positive integer)' }, 400)
  }

  const result = await createAutoInvoiceForOrder(c.env, orderId)
  return c.json({ order_id: orderId, result })
})

// GET /api/admin/auto-proposal/audit?order_id=N
// Returns the full auto-invoice audit trail for a single order,
// oldest → newest. Useful to diagnose why a specific proposal did or
// did not get sent.
adminRoutes.get('/auto-proposal/audit', async (c) => {
  const admin = c.get('admin' as any)
  if (!admin || !requireSuperadmin(admin)) return c.json({ error: 'Superadmin required' }, 403)

  const orderIdRaw = c.req.query('order_id')
  const orderId = orderIdRaw ? parseInt(orderIdRaw, 10) : NaN
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return c.json({ error: 'order_id query param required (positive integer)' }, 400)
  }

  const rows = await c.env.DB.prepare(
    `SELECT id, order_id, invoice_id, action, new_value as reason, created_at
     FROM invoice_audit_log
     WHERE order_id = ? AND changed_by = 'auto-invoice'
     ORDER BY id ASC`
  ).bind(orderId).all()

  return c.json({ order_id: orderId, entries: rows.results || [] })
})

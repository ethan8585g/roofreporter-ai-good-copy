import { Hono } from 'hono'
import type { Bindings } from '../types'
import { validateAdminSession, requireSuperadmin } from './auth'

export const adminRoutes = new Hono<{ Bindings: Bindings }>()

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
  
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) {
    return c.json({ error: 'Admin authentication required. Please log in at /login' }, 401)
  }
  
  // Store admin info in context for downstream use
  c.set('admin' as any, admin)
  return next()
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

    // Stripe tables (legacy — kept for historical data)
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS stripe_payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER, order_id INTEGER,
        stripe_checkout_session_id TEXT, stripe_payment_intent_id TEXT,
        amount INTEGER DEFAULT 0, currency TEXT DEFAULT 'cad',
        status TEXT DEFAULT 'pending', payment_type TEXT,
        description TEXT,
        created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (customer_id) REFERENCES customers(id),
        FOREIGN KEY (order_id) REFERENCES orders(id)
      )
    `).run()

    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS stripe_webhook_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        stripe_event_id TEXT UNIQUE NOT NULL,
        event_type TEXT, payload TEXT, processed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `).run()

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
adminRoutes.get('/superadmin/users', async (c) => {
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
        SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active_users,
        SUM(CASE WHEN google_id IS NOT NULL THEN 1 ELSE 0 END) as google_users,
        SUM(CASE WHEN report_credits > 0 OR credits_used > 0 THEN 1 ELSE 0 END) as paying_users,
        SUM(report_credits) as total_credits_available,
        SUM(credits_used) as total_credits_used,
        SUM(free_trial_used) as total_trial_used,
        SUM(free_trial_total) as total_trial_available
      FROM customers
    `).first()

    return c.json({ users: users.results, summary })
  } catch (err: any) {
    return c.json({ error: 'Failed to load users', details: err.message }, 500)
  }
})

// 2. Credit Pack Sales — with period filter (daily/weekly/monthly)
adminRoutes.get('/superadmin/sales', async (c) => {
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
  try {
    const limit = parseInt(c.req.query('limit') || '100')
    const offset = parseInt(c.req.query('offset') || '0')
    const status = c.req.query('status') || ''

    let whereClause = ''
    if (status) whereClause = `WHERE o.status = '${status}'`

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
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all()

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

    return c.json({
      crm_stats: crmStats,
      platform_invoices: platformInvoices,
      recent_proposals: recentProposals.results,
      recent_invoices: recentInvoices.results,
      funnel
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to load marketing data', details: err.message }, 500)
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
        c.company as customer_company,
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
        c.company as customer_company
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
        c.company as customer_company
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
        c.is_active, c.created_at,
        sc.is_active as secretary_enabled, sc.secretary_mode,
        sc.assigned_phone_number as agent_phone_number,
        sc.secretary_mode as phone_provider,
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
          call_forwarding_number, secretary_phone_number } = body

  if (!email || !password || !contact_name) {
    return c.json({ error: 'email, password, and contact_name are required' }, 400)
  }

  const existing = await c.env.DB.prepare(`SELECT id FROM customers WHERE email = ?`)
    .bind(email.toLowerCase()).first<any>()
  if (existing) return c.json({ error: 'A customer with that email already exists' }, 409)

  // Hash password using same pattern as customer-auth.ts
  const saltBytes = crypto.getRandomValues(new Uint8Array(16))
  const salt = Array.from(saltBytes).map((b: number) => b.toString(16).padStart(2, '0')).join('')
  const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${password}`))
  const hash = Array.from(new Uint8Array(hashBuf)).map((b: number) => b.toString(16).padStart(2, '0')).join('')
  const password_hash = `${salt}:${hash}`

  try {
    const result = await c.env.DB.prepare(`
      INSERT INTO customers (email, password_hash, name, company_name, phone,
        is_active, email_verified, free_trial_total, free_trial_used, report_credits,
        subscription_plan, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 1, 3, 0, 0, 'pro', datetime('now'), datetime('now'))
    `).bind(
      email.toLowerCase(), password_hash, contact_name,
      business_name || contact_name,
      phone || personal_phone || ''
    ).run()

    const customerId = (result as any).meta?.last_row_id
    if (!customerId) return c.json({ error: 'Failed to create customer account' }, 500)

    let secretarySetup = false
    const agentPhone = agent_phone_number || secretary_phone_number || ''

    if (enable_secretary !== false) {
      // Create secretary subscription (active, bypassing payment)
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO secretary_subscriptions (customer_id, status, monthly_price_cents, created_at, updated_at)
        VALUES (?, 'active', 14900, datetime('now'), datetime('now'))
      `).bind(customerId).run()

      // Create secretary config
      await c.env.DB.prepare(`
        INSERT INTO secretary_config (
          customer_id, business_phone, greeting_script, common_qa, general_notes,
          secretary_mode, is_active, connection_status, assigned_phone_number,
          forwarding_method, created_at, updated_at
        ) VALUES (?, ?, '', '', ?, ?, ?, ?, ?, 'forward', datetime('now'), datetime('now'))
      `).bind(
        customerId,
        personal_phone || phone || '',
        notes || '',
        secretary_mode || 'full',
        agentPhone ? 1 : 0,
        agentPhone ? 'pending_forwarding' : 'not_connected',
        agentPhone || ''
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
    if (agentPhone && secretarySetup) {
      try {
        const result = await deployLiveKitForCustomer(c.env, customerId, agentPhone)
        if (result.success) {
          livekitDeployed = true
          livekitTrunkId = result.trunk_id
          livekitDispatchId = result.dispatch_rule_id
        }
      } catch (e: any) {
        console.warn(`[Onboarding] LiveKit auto-deploy failed for ${customerId}: ${e.message}`)
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
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to create customer', details: err.message }, 500)
  }
})

// ── LiveKit deployment helper — creates SIP trunk + dispatch rule ──
async function deployLiveKitForCustomer(env: any, customerId: number, phoneNumber: string): Promise<{ success: boolean; trunk_id: string; dispatch_rule_id: string }> {
  const apiKey = env.LIVEKIT_API_KEY
  const apiSecret = env.LIVEKIT_API_SECRET
  const livekitUrl = env.LIVEKIT_URL
  const livekitSipUri = env.LIVEKIT_SIP_URI || ''

  if (!apiKey || !apiSecret || !livekitUrl) {
    return { success: false, trunk_id: '', dispatch_rule_id: '' }
  }

  // Check if already deployed
  const existing = await env.DB.prepare(
    'SELECT livekit_inbound_trunk_id, livekit_dispatch_rule_id FROM secretary_config WHERE customer_id = ?'
  ).bind(customerId).first<any>()
  if (existing?.livekit_inbound_trunk_id && existing?.livekit_dispatch_rule_id) {
    return { success: true, trunk_id: existing.livekit_inbound_trunk_id, dispatch_rule_id: existing.livekit_dispatch_rule_id }
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

  // Step 1: Create inbound trunk
  const trunkResult = await lkApi('/twirp/livekit.SIP/CreateSIPInboundTrunk', {
    trunk: { name: `secretary-${customerId}`, numbers: [phoneNumber], krisp_enabled: true, metadata: JSON.stringify({ customer_id: customerId, service: 'roofer_secretary' }) }
  })
  const trunkId = trunkResult?.sip_trunk_id || trunkResult?.trunk?.sip_trunk_id || ''

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
  if (!apiKey) return c.json({ error: 'Gemini not configured — set GEMINI_API_KEY in Cloudflare secrets' }, 503)

  const systemContext = `You are an AI assistant for the RoofReporterAI platform super admin dashboard.
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
  await c.env.DB.prepare('UPDATE customers SET is_active = 0, email = "deleted_" || id || "_" || email, updated_at = datetime("now") WHERE id = ?').bind(id).run()
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
  existing = existing.filter((b: any) => b.id !== id)
  await c.env.DB.prepare("INSERT OR REPLACE INTO settings (master_company_id, setting_key, setting_value) VALUES (1, 'seo_backlinks', ?)").bind(JSON.stringify(existing)).run()
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

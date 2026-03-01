-- ============================================================
-- FIX REMOTE PRODUCTION DB: Add all missing tables
-- Safe: Uses CREATE TABLE IF NOT EXISTS and try/catch for ALTERs
-- ============================================================

-- CRM Tables (from migration 0008)
CREATE TABLE IF NOT EXISTS crm_customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  email TEXT, phone TEXT, company TEXT, address TEXT, city TEXT,
  province TEXT, postal_code TEXT, notes TEXT, tags TEXT,
  status TEXT DEFAULT 'active', source TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_crm_customers_owner ON crm_customers(owner_id);
CREATE INDEX IF NOT EXISTS idx_crm_customers_status ON crm_customers(status);

CREATE TABLE IF NOT EXISTS crm_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL, crm_customer_id INTEGER NOT NULL,
  invoice_number TEXT NOT NULL, subtotal REAL DEFAULT 0,
  tax_rate REAL DEFAULT 5.0, tax_amount REAL DEFAULT 0, total REAL DEFAULT 0,
  currency TEXT DEFAULT 'CAD',
  status TEXT DEFAULT 'draft', issue_date TEXT DEFAULT (date('now')),
  due_date TEXT, paid_date TEXT, sent_date TEXT, notes TEXT,
  terms TEXT DEFAULT 'Payment due within 30 days.',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (crm_customer_id) REFERENCES crm_customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_crm_invoices_owner ON crm_invoices(owner_id);
CREATE INDEX IF NOT EXISTS idx_crm_invoices_customer ON crm_invoices(crm_customer_id);
CREATE INDEX IF NOT EXISTS idx_crm_invoices_status ON crm_invoices(status);

CREATE TABLE IF NOT EXISTS crm_invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL, description TEXT NOT NULL,
  quantity REAL DEFAULT 1, unit_price REAL DEFAULT 0,
  amount REAL DEFAULT 0, sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (invoice_id) REFERENCES crm_invoices(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_crm_invoice_items_inv ON crm_invoice_items(invoice_id);

CREATE TABLE IF NOT EXISTS crm_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL, crm_customer_id INTEGER NOT NULL,
  proposal_number TEXT NOT NULL, title TEXT NOT NULL,
  property_address TEXT, scope_of_work TEXT, materials_detail TEXT,
  labor_cost REAL DEFAULT 0, material_cost REAL DEFAULT 0,
  other_cost REAL DEFAULT 0, total_amount REAL DEFAULT 0,
  status TEXT DEFAULT 'draft', valid_until TEXT, notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (crm_customer_id) REFERENCES crm_customers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_crm_proposals_owner ON crm_proposals(owner_id);
CREATE INDEX IF NOT EXISTS idx_crm_proposals_customer ON crm_proposals(crm_customer_id);
CREATE INDEX IF NOT EXISTS idx_crm_proposals_status ON crm_proposals(status);

CREATE TABLE IF NOT EXISTS crm_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL, crm_customer_id INTEGER,
  proposal_id INTEGER, job_number TEXT NOT NULL, title TEXT NOT NULL,
  property_address TEXT, job_type TEXT DEFAULT 'install',
  scheduled_date TEXT NOT NULL, scheduled_time TEXT,
  estimated_duration TEXT, crew_size INTEGER, notes TEXT,
  status TEXT DEFAULT 'scheduled', completed_date TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (crm_customer_id) REFERENCES crm_customers(id),
  FOREIGN KEY (proposal_id) REFERENCES crm_proposals(id)
);

CREATE INDEX IF NOT EXISTS idx_crm_jobs_owner ON crm_jobs(owner_id);
CREATE INDEX IF NOT EXISTS idx_crm_jobs_date ON crm_jobs(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_crm_jobs_status ON crm_jobs(status);

CREATE TABLE IF NOT EXISTS crm_job_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL, item_type TEXT NOT NULL,
  label TEXT NOT NULL, is_completed INTEGER DEFAULT 0,
  completed_at TEXT, notes TEXT, sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (job_id) REFERENCES crm_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_crm_checklist_job ON crm_job_checklist(job_id);

-- Blog posts (from migration 0011)
CREATE TABLE IF NOT EXISTS blog_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
  excerpt TEXT, content TEXT NOT NULL, cover_image TEXT,
  author TEXT DEFAULT 'RoofReporterAI Team', category TEXT DEFAULT 'general',
  tags TEXT, meta_title TEXT, meta_description TEXT,
  is_published INTEGER DEFAULT 0, published_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_blog_published ON blog_posts(is_published);
CREATE INDEX IF NOT EXISTS idx_blog_slug ON blog_posts(slug);

-- Admin tables (from init-db)
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
  name TEXT NOT NULL, role TEXT DEFAULT 'admin',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER NOT NULL, session_token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL, session_token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

-- Credit packages
CREATE TABLE IF NOT EXISTS credit_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, description TEXT,
  credits INTEGER NOT NULL, price_cents INTEGER NOT NULL,
  is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Stripe tables
CREATE TABLE IF NOT EXISTS stripe_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER, order_id INTEGER,
  stripe_checkout_session_id TEXT, stripe_payment_intent_id TEXT,
  amount INTEGER DEFAULT 0, currency TEXT DEFAULT 'cad',
  status TEXT DEFAULT 'pending', payment_type TEXT,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_event_id TEXT UNIQUE NOT NULL,
  event_type TEXT, payload TEXT, processed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- API requests log
CREATE TABLE IF NOT EXISTS api_requests_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER, request_type TEXT, endpoint TEXT,
  response_status INTEGER, response_body TEXT, duration_ms INTEGER,
  cost_cad REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- D2D tables
CREATE TABLE IF NOT EXISTS d2d_team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  customer_id INTEGER,
  name TEXT NOT NULL,
  email TEXT, phone TEXT,
  role TEXT DEFAULT 'member',
  color TEXT DEFAULT '#3b82f6',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS d2d_turfs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  name TEXT NOT NULL, description TEXT,
  polygon_json TEXT NOT NULL,
  center_lat REAL, center_lng REAL,
  color TEXT DEFAULT '#3b82f6',
  assigned_to INTEGER,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to) REFERENCES d2d_team_members(id)
);

CREATE TABLE IF NOT EXISTS d2d_pins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  turf_id INTEGER,
  lat REAL NOT NULL, lng REAL NOT NULL,
  address TEXT,
  status TEXT DEFAULT 'not_knocked',
  notes TEXT,
  knocked_by INTEGER,
  knocked_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES customers(id) ON DELETE CASCADE,
  FOREIGN KEY (turf_id) REFERENCES d2d_turfs(id),
  FOREIGN KEY (knocked_by) REFERENCES d2d_team_members(id)
);

CREATE INDEX IF NOT EXISTS idx_d2d_turfs_owner ON d2d_turfs(owner_id);
CREATE INDEX IF NOT EXISTS idx_d2d_pins_turf ON d2d_pins(turf_id);
CREATE INDEX IF NOT EXISTS idx_d2d_pins_owner ON d2d_pins(owner_id);
CREATE INDEX IF NOT EXISTS idx_d2d_team_owner ON d2d_team_members(owner_id);

-- Indexes for core tables
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_google_id ON customers(google_id);
CREATE INDEX IF NOT EXISTS idx_reports_order_id ON reports(order_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

-- Fix remaining: D2D tables, indexes, and mark migrations complete

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

-- Core indexes
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_reports_order_id ON reports(order_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

-- Mark stuck migrations as applied so future migrations work
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0008_crm_tables.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0009_report_generation_tracking.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0010_add_trial_payment_status.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0011_blog_posts.sql');

-- Material Catalog: Per-customer product & pricing list
-- Integrates with Material Calculator for custom pricing
CREATE TABLE IF NOT EXISTS material_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  sku TEXT,
  unit TEXT NOT NULL,
  unit_price REAL NOT NULL,
  coverage_per_unit TEXT,
  supplier TEXT,
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES customers(id)
);
CREATE INDEX IF NOT EXISTS idx_material_catalog_owner ON material_catalog(owner_id);
CREATE INDEX IF NOT EXISTS idx_material_catalog_category ON material_catalog(owner_id, category);

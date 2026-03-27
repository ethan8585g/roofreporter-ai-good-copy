-- Migration 0039: D2D team member permissions + account linking
-- Adds fine-grained permissions to d2d_team_members so admins can
-- control exactly what each door-knocker can see and access.
-- {"d2d":"all|assigned","reports":bool,"crm":bool,"secretary":bool,"team":bool}

CREATE TABLE IF NOT EXISTS d2d_team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  customer_id INTEGER,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  role TEXT DEFAULT 'salesperson',
  color TEXT DEFAULT '#3B82F6',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES customers(id)
);

ALTER TABLE d2d_team_members ADD COLUMN permissions TEXT DEFAULT '{"d2d":"all","reports":true,"crm":true,"secretary":false,"team":false}';

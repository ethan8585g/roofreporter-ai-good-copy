-- D2D Appointments — door-knocker booked appointments routed to team owner as leads
CREATE TABLE IF NOT EXISTS d2d_appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  created_by_member_id INTEGER,
  assigned_to_member_id INTEGER,
  customer_name TEXT NOT NULL,
  address TEXT NOT NULL,
  appointment_date TEXT NOT NULL,
  appointment_time TEXT NOT NULL,
  notes TEXT,
  company_type TEXT DEFAULT 'roofing',
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES customers(id),
  FOREIGN KEY (created_by_member_id) REFERENCES d2d_team_members(id),
  FOREIGN KEY (assigned_to_member_id) REFERENCES d2d_team_members(id)
);

CREATE INDEX IF NOT EXISTS idx_d2d_appt_owner ON d2d_appointments(owner_id);
CREATE INDEX IF NOT EXISTS idx_d2d_appt_assigned ON d2d_appointments(assigned_to_member_id);
CREATE INDEX IF NOT EXISTS idx_d2d_appt_status ON d2d_appointments(status);
CREATE INDEX IF NOT EXISTS idx_d2d_appt_created ON d2d_appointments(created_at);

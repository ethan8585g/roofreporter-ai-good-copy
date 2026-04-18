-- Status history tracking for CRM pipeline time-in-stage metrics
CREATE TABLE IF NOT EXISTS crm_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,        -- 'customer' or 'proposal'
  entity_id INTEGER NOT NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_at TEXT DEFAULT (datetime('now')),
  changed_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_status_history_entity
  ON crm_status_history(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_status_history_changed
  ON crm_status_history(changed_at);

-- Track when entities entered their current stage
ALTER TABLE crm_customers ADD COLUMN stage_entered_at TEXT DEFAULT (datetime('now'));
ALTER TABLE invoices ADD COLUMN stage_entered_at TEXT DEFAULT (datetime('now'));

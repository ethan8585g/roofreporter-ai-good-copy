-- Admin action + tool-call audit logs. Written by src/lib/audit-log.ts.
-- Every mutation on /api/admin/* and every AI-admin-chat tool invocation
-- should insert a row here.

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id     INTEGER,
  admin_email  TEXT,
  action       TEXT NOT NULL,
  target_type  TEXT,
  target_id    TEXT,
  before_json  TEXT,
  after_json   TEXT,
  ip           TEXT,
  ts           TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_log(admin_id, ts);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log(action, ts);

CREATE TABLE IF NOT EXISTS admin_tool_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id     INTEGER,
  admin_email  TEXT,
  tool         TEXT NOT NULL,
  args_json    TEXT,
  result       TEXT,
  error        TEXT,
  ip           TEXT,
  ts           TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_tool_admin ON admin_tool_audit(admin_id, ts);
CREATE INDEX IF NOT EXISTS idx_admin_tool_tool  ON admin_tool_audit(tool, ts);

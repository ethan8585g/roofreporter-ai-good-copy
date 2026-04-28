-- ============================================================
-- 0190 — Super Admin manual cold-call tracker
-- Two tables, both independent of customer-cold-call.ts
-- and the existing call-center route.  Purely additive.
-- ============================================================

-- Leads — the people you intend to call (one row per company/contact)
CREATE TABLE IF NOT EXISTS sa_cold_call_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  company_name TEXT,
  phone TEXT,
  email TEXT,
  website TEXT,
  address TEXT,
  city TEXT,
  province TEXT,
  country TEXT,
  source TEXT,                       -- "Google Maps", "trade show", "referral from X"
  status TEXT NOT NULL DEFAULT 'new',
                                     -- new | attempting | contacted | qualified
                                     -- proposal_sent | won | lost | do_not_call
  priority INTEGER NOT NULL DEFAULT 3,    -- 1=hottest, 5=coldest
  next_action_at DATETIME,           -- when to call back; NULL = none scheduled
  assigned_to INTEGER,               -- admin_users.id; NULL = unassigned (solo for now)
  notes TEXT,                        -- free-text bio/research
  linked_customer_id INTEGER,        -- auto-linked when their email matches customers.email
  attempts_count INTEGER NOT NULL DEFAULT 0,   -- denormalized for fast queue sort
  last_attempt_at DATETIME,          -- denormalized
  last_outcome TEXT,                 -- denormalized; mirrors latest log row's outcome
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sa_leads_status         ON sa_cold_call_leads(status);
CREATE INDEX IF NOT EXISTS idx_sa_leads_priority       ON sa_cold_call_leads(priority);
CREATE INDEX IF NOT EXISTS idx_sa_leads_next_action_at ON sa_cold_call_leads(next_action_at);
CREATE INDEX IF NOT EXISTS idx_sa_leads_assigned_to    ON sa_cold_call_leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_sa_leads_email          ON sa_cold_call_leads(email);
CREATE INDEX IF NOT EXISTS idx_sa_leads_phone          ON sa_cold_call_leads(phone);

-- Logs — one row per call attempt.  Keep this append-only for clean history.
CREATE TABLE IF NOT EXISTS sa_cold_call_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL,
  admin_user_id INTEGER,             -- who placed the call
  called_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  duration_seconds INTEGER,
  outcome TEXT NOT NULL,
                                     -- no_answer | voicemail | wrong_number
                                     -- not_interested | interested | callback_requested
                                     -- meeting_booked | do_not_call | won | lost
  sentiment INTEGER,                 -- 1..5 optional
  notes TEXT,
  next_step TEXT,
  next_action_at DATETIME,           -- when to try again; copied onto the lead row
  FOREIGN KEY (lead_id) REFERENCES sa_cold_call_leads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sa_logs_lead     ON sa_cold_call_logs(lead_id);
CREATE INDEX IF NOT EXISTS idx_sa_logs_called   ON sa_cold_call_logs(called_at);
CREATE INDEX IF NOT EXISTS idx_sa_logs_outcome  ON sa_cold_call_logs(outcome);
CREATE INDEX IF NOT EXISTS idx_sa_logs_admin    ON sa_cold_call_logs(admin_user_id);

-- ROLLBACK (manual):
--   DROP TABLE sa_cold_call_logs;
--   DROP TABLE sa_cold_call_leads;

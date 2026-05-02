-- 0199: Trial claims audit — log every free-trial report grant with the
-- claimant's IP so we can rate-limit abuse (one human creates N accounts
-- to keep claiming trials). Read by /api/square/use-credit before granting.

CREATE TABLE IF NOT EXISTS trial_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  order_id INTEGER,
  ip_address TEXT,
  email TEXT,
  claimed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_trial_claims_ip ON trial_claims(ip_address, claimed_at DESC);
CREATE INDEX IF NOT EXISTS idx_trial_claims_customer ON trial_claims(customer_id, claimed_at DESC);
CREATE INDEX IF NOT EXISTS idx_trial_claims_email ON trial_claims(email, claimed_at DESC);

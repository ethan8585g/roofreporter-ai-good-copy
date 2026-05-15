-- ============================================================
-- Add the columns the abandoned-signups dashboard, email.ts
-- sendSignupRecoveryEmail, and cron-worker runAbandonedSignupRecovery
-- have been referencing all along but were never created.
--
-- Symptom this fixes: /super-admin/abandoned-signups list endpoint
-- threw "no such column: sa.recovery_sent" inside the LEFT JOIN
-- subqueries, returning {error, rows:[]} with no `days` field —
-- which surfaced as "0 people · verified · last undefined days".
-- ============================================================

ALTER TABLE signup_attempts ADD COLUMN preview_id TEXT;
ALTER TABLE signup_attempts ADD COLUMN recovery_sent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE signup_attempts ADD COLUMN recovery_sent_at DATETIME;
ALTER TABLE signup_attempts ADD COLUMN completed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE signup_attempts ADD COLUMN utm_source TEXT;

CREATE INDEX IF NOT EXISTS idx_signup_attempts_email ON signup_attempts(email);
CREATE INDEX IF NOT EXISTS idx_signup_attempts_recovery ON signup_attempts(recovery_sent, created_at);

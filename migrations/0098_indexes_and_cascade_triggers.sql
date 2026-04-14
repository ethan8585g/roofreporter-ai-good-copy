-- 0098: Composite indexes on hot query paths + cascade-on-delete triggers.
-- D1 (SQLite) cannot add FK constraints to existing tables without a full
-- table recreate, so we use AFTER DELETE triggers as the safer equivalent.

-- ── Composite indexes for CRM hot queries (see audit: crm.ts:86-89)
CREATE INDEX IF NOT EXISTS idx_crm_invoices_customer_status
  ON crm_invoices (crm_customer_id, status);

CREATE INDEX IF NOT EXISTS idx_crm_proposals_owner_status
  ON crm_proposals (owner_id, status);

CREATE INDEX IF NOT EXISTS idx_crm_jobs_owner_scheduled
  ON crm_jobs (owner_id, scheduled_date);

-- ── Cascade-on-delete triggers (equivalent to ON DELETE CASCADE on existing tables).
-- `orders`, `invoices`, and `stripe_payments` reference `customers(id)` but the FK
-- was declared without CASCADE. Rebuilding the tables in D1 would require a full
-- data copy; these triggers get the same effect.

CREATE TRIGGER IF NOT EXISTS cascade_customer_delete_orders
AFTER DELETE ON customers
BEGIN
  DELETE FROM orders WHERE customer_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_customer_delete_invoices
AFTER DELETE ON customers
BEGIN
  DELETE FROM invoices WHERE customer_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS cascade_customer_delete_stripe_payments
AFTER DELETE ON customers
BEGIN
  DELETE FROM stripe_payments WHERE customer_id = OLD.id;
END;

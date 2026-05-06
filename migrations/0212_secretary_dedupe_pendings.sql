-- Phase 3 #10: enforce one open Secretary subscription per customer.
-- The /start-trial handler used to short-circuit when an existing pending row
-- was present, so a stuck pending could spawn unlimited duplicates. The
-- handler now treats pending<5min as in-flight (409) and pending>=5min as
-- recoverable (deletes + retries). This migration:
--   1. Cleans up the duplicates that already exist.
--   2. Adds a partial unique index so the DB rejects any future duplicate
--      open-state row before it's written.
-- All open-state rows for a given customer collapse to the most recent.

-- Step 1 — collapse duplicates: keep the highest id per customer in any of
-- the open states; delete the rest. SQLite-safe (no window functions).
DELETE FROM secretary_subscriptions
 WHERE id IN (
   SELECT s1.id FROM secretary_subscriptions s1
   WHERE s1.status IN ('active','trialing','pending','past_due')
     AND s1.id < (
       SELECT MAX(s2.id) FROM secretary_subscriptions s2
        WHERE s2.customer_id = s1.customer_id
          AND s2.status IN ('active','trialing','pending','past_due')
     )
 );

-- Step 2 — partial unique index on (customer_id) restricted to open states.
-- Cancelled/expired rows are intentionally allowed to coexist with a fresh
-- subscription so the audit trail stays intact.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_secretary_open_per_customer
  ON secretary_subscriptions(customer_id)
  WHERE status IN ('active','trialing','pending','past_due');

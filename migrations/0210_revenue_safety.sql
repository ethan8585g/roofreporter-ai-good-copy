-- Revenue safety net.
--
-- 1) Backfill NULL trial counters on legacy customers. The use-credit deduction
--    UPDATE uses `WHERE free_trial_used < free_trial_total`, which evaluates to
--    NULL (i.e. false) when either side is NULL. Customers with NULL counters
--    were getting HTTP 402 "no trials remaining" on their FIRST attempt and
--    bouncing. Backfill to the documented defaults (0 used, 4 total).
UPDATE customers
   SET free_trial_used = 0
 WHERE free_trial_used IS NULL;

UPDATE customers
   SET free_trial_total = 4
 WHERE free_trial_total IS NULL;

UPDATE customers
   SET report_credits = 0
 WHERE report_credits IS NULL;

UPDATE customers
   SET credits_used = 0
 WHERE credits_used IS NULL;

-- 2) Prevent duplicate order creation in the webhook + verify-payment race.
--    Each one-time-report Square order has a unique square_payments row, and
--    the order created from it should be unique too. Partial unique index on
--    orders.notes via square_order_id won't work cleanly, so we instead make
--    square_payments.order_id unique-when-set so a second insert attempting
--    to link the same square_payments row will fail and the loser bails.
CREATE UNIQUE INDEX IF NOT EXISTS idx_square_payments_order_id
  ON square_payments(order_id)
  WHERE order_id IS NOT NULL;

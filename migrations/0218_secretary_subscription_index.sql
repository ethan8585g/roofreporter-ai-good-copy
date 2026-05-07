-- Index for the Square webhook lookup hot path. Every subscription/invoice
-- webhook reads `secretary_subscriptions` by `square_subscription_id`, and
-- without an index that's a full table scan on each event. As trial volume
-- grows this hits webhook timeouts.
CREATE INDEX IF NOT EXISTS idx_secretary_subs_square_id
  ON secretary_subscriptions(square_subscription_id);

-- Frequent filter on call_log_id for the call-detail roll-up endpoint.
CREATE INDEX IF NOT EXISTS idx_secretary_messages_call
  ON secretary_messages(customer_id, call_log_id);
CREATE INDEX IF NOT EXISTS idx_secretary_appts_call
  ON secretary_appointments(customer_id, call_log_id);
CREATE INDEX IF NOT EXISTS idx_secretary_callbacks_call
  ON secretary_callbacks(customer_id, call_log_id);

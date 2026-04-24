-- Idempotency key prevents multi-charge when a single client-side "Use Credit"
-- click triggers multiple POST /api/square/use-credit requests (network retry,
-- Worker CPU-limit retry, or user double-submit after a network error).
-- The client generates one UUID per click; the server treats any repeat of the
-- same (customer_id, idempotency_key) as the same order — no second INSERT,
-- no second credit deduction.
ALTER TABLE orders ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_customer_idempotency
  ON orders(customer_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

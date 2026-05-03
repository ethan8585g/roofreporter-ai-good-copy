-- Track who produced the roof trace on an order.
-- Values: 'self' (customer drew it), 'admin' (admin manually traced), 'ai_agent' (auto-traced), NULL (no trace)
ALTER TABLE orders ADD COLUMN trace_source TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_trace_source ON orders(trace_source);

-- Best-effort backfill for existing rows.
-- Anything that has a trace and isn't queued for admin = 'self' (customer self-trace at submit time).
UPDATE orders SET trace_source = 'self'
  WHERE trace_source IS NULL
    AND roof_trace_json IS NOT NULL
    AND COALESCE(needs_admin_trace, 0) = 0;

-- Rows still flagged for admin trace are unfinished — leave NULL until admin completes.

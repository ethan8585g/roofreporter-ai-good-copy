-- Manual trace queue: when 1, this order skips auto-generation and waits for admin to manually trace
ALTER TABLE orders ADD COLUMN needs_admin_trace INTEGER DEFAULT 0;

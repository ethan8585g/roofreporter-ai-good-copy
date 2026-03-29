-- ============================================================
-- 0051: Square OAuth Per-User Merchant Connect
-- Allows each customer to connect their own Square merchant
-- account so they can accept payments via their own Square
-- account (not the platform's shared account).
-- ============================================================

-- Add per-user Square OAuth tokens to customers table
ALTER TABLE customers ADD COLUMN square_merchant_id TEXT DEFAULT NULL;
ALTER TABLE customers ADD COLUMN square_merchant_access_token TEXT DEFAULT NULL;
ALTER TABLE customers ADD COLUMN square_merchant_refresh_token TEXT DEFAULT NULL;
ALTER TABLE customers ADD COLUMN square_merchant_token_expires_at DATETIME DEFAULT NULL;
ALTER TABLE customers ADD COLUMN square_merchant_location_id TEXT DEFAULT NULL;
ALTER TABLE customers ADD COLUMN square_merchant_name TEXT DEFAULT NULL;
ALTER TABLE customers ADD COLUMN square_merchant_connected_at DATETIME DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_square_merchant ON customers(square_merchant_id);

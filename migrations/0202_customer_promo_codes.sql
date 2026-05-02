-- Customer-facing promo/discount code system for the report-credit checkout.
-- Distinct from invoice-level discounts in src/routes/invoices.ts which apply
-- to B2B billing — these are for customers buying report credits via Square.
CREATE TABLE IF NOT EXISTS promo_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,                  -- case-insensitive, stored uppercase
  discount_type TEXT NOT NULL,                -- 'percent' | 'fixed'
  discount_value REAL NOT NULL,               -- percent (0-100) OR dollar amount
  max_uses INTEGER,                           -- null = unlimited
  uses_count INTEGER NOT NULL DEFAULT 0,
  customer_email TEXT,                        -- null = any customer; else exact-match
  expires_at TEXT,                            -- ISO datetime; null = never
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT,                                 -- internal context (campaign, recovery, etc.)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_by_admin_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code);
CREATE INDEX IF NOT EXISTS idx_promo_codes_active ON promo_codes(active);

CREATE TABLE IF NOT EXISTS promo_code_redemptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  promo_code_id INTEGER NOT NULL,
  customer_id INTEGER,
  order_id INTEGER,
  original_amount REAL,
  discount_applied REAL,
  final_amount REAL,
  redeemed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_code ON promo_code_redemptions(promo_code_id);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_customer ON promo_code_redemptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_promo_redemptions_order ON promo_code_redemptions(order_id);

ALTER TABLE orders ADD COLUMN promo_code TEXT;
ALTER TABLE orders ADD COLUMN promo_discount_amount REAL;

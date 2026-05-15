-- 0252_customer_apple_sub.sql
-- Sign in with Apple support — required for iOS App Store rule 4.8 since the
-- site already offers Google OAuth.
--
-- We use a sidecar table instead of adding columns to `customers` because
-- that table has hit SQLite's effective per-table column limit on D1 after
-- 250+ migrations. A 1:1 sidecar keeps auth-specific data cleanly separated
-- and is trivial to JOIN in the /api/customer-auth/apple route.
--
-- apple_sub        — Apple's stable opaque user ID from JWT `sub` claim.
--                    PRIMARY KEY because Apple guarantees per-app uniqueness.
-- apple_email_relay — 1 if user picked "Hide my email" (apple's private relay).
--                    Pipeline uses this to avoid bulk-mailing through the
--                    relay (Apple bounces excess volume) and to prompt the
--                    user later for their real address.
-- linked_at        — when we first associated this Apple ID with the customer.

CREATE TABLE IF NOT EXISTS customer_apple_auth (
  customer_id        INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  apple_sub          TEXT NOT NULL PRIMARY KEY,
  apple_email_relay  INTEGER NOT NULL DEFAULT 0,
  linked_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_customer_apple_auth_customer ON customer_apple_auth(customer_id);

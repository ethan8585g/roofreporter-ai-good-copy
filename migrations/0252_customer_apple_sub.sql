-- 0252_customer_apple_sub.sql
-- Sign in with Apple support — required for iOS App Store submission
-- (Apple App Review rule 4.8) since the site already offers Google OAuth.
--
-- apple_sub  is the stable, anonymous user ID Apple returns in the JWT
-- `sub` claim. It is the join key for repeat logins; the email Apple
-- gives us can be a per-app relay (@privaterelay.appleid.com) and can
-- change if the user toggles "Hide my email", so we cannot rely on email.
--
-- apple_email_relay flags users who chose the privacy-relay option, so
-- the marketing email pipeline knows not to send unsolicited mail through
-- the relay (Apple bounces excess volume) and we can prompt them later
-- to share their real address.

ALTER TABLE customers ADD COLUMN apple_sub TEXT;
ALTER TABLE customers ADD COLUMN apple_email_relay INTEGER DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_apple_sub ON customers(apple_sub) WHERE apple_sub IS NOT NULL;

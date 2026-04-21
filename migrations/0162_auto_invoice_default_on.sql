-- Opt new customers into auto-proposal by default.
--
-- The column was added in 0154 with DEFAULT 0, so every existing row has an
-- explicit 0. We DO NOT flip those to 1 — that would silently auto-email
-- homeowners for roofers who never asked for automation. Only NULL rows
-- (if any) get flipped.
--
-- The application-level default is enforced at every customers INSERT path
-- going forward (see customer-auth.ts / admin.ts / square.ts / d2d.ts).
UPDATE customers
SET auto_invoice_enabled = 1
WHERE auto_invoice_enabled IS NULL;

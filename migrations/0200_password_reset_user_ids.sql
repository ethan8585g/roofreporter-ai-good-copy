-- Phase 1 #2: tie password reset tokens to a specific user_id (not just email)
-- so the consume step can UPDATE by primary key, eliminating the email-rebind
-- race that could let a reset apply to the wrong account.

ALTER TABLE password_reset_tokens ADD COLUMN admin_id INTEGER;
ALTER TABLE password_reset_tokens ADD COLUMN customer_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_prt_admin_id ON password_reset_tokens(admin_id);
CREATE INDEX IF NOT EXISTS idx_prt_customer_id ON password_reset_tokens(customer_id);

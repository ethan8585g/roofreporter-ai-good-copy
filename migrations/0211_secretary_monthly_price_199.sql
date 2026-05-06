-- Phase 2 #9: Secretary monthly subscription is documented as $199/mo with a
-- 1-month free trial (see src/routes/secretary.ts header comment), but the
-- settings row had drifted to $249. Realign the pricing source of truth so
-- the Super Admin pricing panel reflects the documented offer.
UPDATE settings
   SET setting_value = '19900', updated_at = datetime('now')
 WHERE setting_key = 'secretary_monthly_price_cents'
   AND master_company_id = 1;

-- Idempotent insert in case the row never existed.
INSERT OR IGNORE INTO settings (master_company_id, setting_key, setting_value)
VALUES (1, 'secretary_monthly_price_cents', '19900');

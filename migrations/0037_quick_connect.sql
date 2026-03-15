-- Quick Connect: SMS-verified phone setup for Secretary AI
-- Adds verification code storage and phone_verified flag

-- Add verification fields to secretary_config
ALTER TABLE secretary_config ADD COLUMN verification_code TEXT DEFAULT NULL;
ALTER TABLE secretary_config ADD COLUMN verification_expires TEXT DEFAULT NULL;
ALTER TABLE secretary_config ADD COLUMN phone_verified INTEGER DEFAULT 0;
ALTER TABLE secretary_config ADD COLUMN phone_verified_at TEXT DEFAULT NULL;

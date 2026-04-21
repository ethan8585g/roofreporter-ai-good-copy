-- Utility-bill inputs on solar deals — drives "your savings" math on the
-- homeowner proposal. Additive only, no rename of existing columns.
ALTER TABLE solar_deals ADD COLUMN annual_consumption_kwh REAL;
ALTER TABLE solar_deals ADD COLUMN utility_rate_per_kwh REAL;
ALTER TABLE solar_deals ADD COLUMN utility_escalator_pct REAL DEFAULT 3.0;
ALTER TABLE solar_deals ADD COLUMN utility_provider TEXT;
ALTER TABLE solar_deals ADD COLUMN utility_bill_r2_key TEXT;

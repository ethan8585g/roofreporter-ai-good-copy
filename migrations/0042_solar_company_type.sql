-- Migration 0042: Solar company type support
-- Adds company_type (roofing vs solar) and solar panel wattage to customers

ALTER TABLE customers ADD COLUMN company_type TEXT DEFAULT NULL;
ALTER TABLE customers ADD COLUMN solar_panel_wattage_w INTEGER DEFAULT 400;

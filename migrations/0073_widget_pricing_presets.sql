-- Add custom pricing presets column to widget_configs
-- Stores JSON with shared costs + per-tier (good/better/best) overrides
ALTER TABLE widget_configs ADD COLUMN pricing_presets_json TEXT;

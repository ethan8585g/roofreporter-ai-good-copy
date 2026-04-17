-- Add language setting for AI secretary (en, fr, es)
ALTER TABLE secretary_config ADD COLUMN agent_language TEXT NOT NULL DEFAULT 'en';

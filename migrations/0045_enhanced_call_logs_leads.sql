-- ============================================================
-- Migration 0045: Enhanced call logs, leads tracking, and agent voices
-- Adds lead tracking, conversation highlights, sentiment analysis,
-- and voice/agent persona options for the Secretary AI
-- ============================================================

-- Add new columns to secretary_call_logs for richer call data
ALTER TABLE secretary_call_logs ADD COLUMN caller_email TEXT DEFAULT '';
ALTER TABLE secretary_call_logs ADD COLUMN service_type TEXT DEFAULT '';
ALTER TABLE secretary_call_logs ADD COLUMN property_address TEXT DEFAULT '';
ALTER TABLE secretary_call_logs ADD COLUMN is_lead INTEGER DEFAULT 0;
ALTER TABLE secretary_call_logs ADD COLUMN lead_status TEXT DEFAULT 'new';
ALTER TABLE secretary_call_logs ADD COLUMN lead_quality TEXT DEFAULT 'unknown';
ALTER TABLE secretary_call_logs ADD COLUMN conversation_highlights TEXT DEFAULT '';
ALTER TABLE secretary_call_logs ADD COLUMN sentiment TEXT DEFAULT 'neutral';
ALTER TABLE secretary_call_logs ADD COLUMN follow_up_required INTEGER DEFAULT 0;
ALTER TABLE secretary_call_logs ADD COLUMN follow_up_notes TEXT DEFAULT '';
ALTER TABLE secretary_call_logs ADD COLUMN follow_up_completed INTEGER DEFAULT 0;
ALTER TABLE secretary_call_logs ADD COLUMN tags TEXT DEFAULT '';

-- Create index for lead queries
CREATE INDEX IF NOT EXISTS idx_call_logs_is_lead ON secretary_call_logs(customer_id, is_lead);
CREATE INDEX IF NOT EXISTS idx_call_logs_lead_status ON secretary_call_logs(customer_id, lead_status);
CREATE INDEX IF NOT EXISTS idx_call_logs_created ON secretary_call_logs(customer_id, created_at);

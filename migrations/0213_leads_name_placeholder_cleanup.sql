-- Phase 3 #11: lead-facing ack emails greeted anonymous form submissions
-- with "Hi Website," because the intake stored the placeholder
-- 'Website Visitor' in `leads.name` and the firstName extractor took the
-- first word. The intake (src/routes/agents.ts) now suppresses the
-- placeholder for the greeting only — but historical rows still carry
-- the bad value. Null those out so any retroactive resend / display
-- treats them as anonymous.
-- leads.name is NOT NULL in the production schema, so we collapse the
-- placeholders to empty string. The lead-agent / ack-email code path now
-- treats empty + placeholder strings as "no name" and falls back to "there".
UPDATE leads
   SET name = '',
       updated_at = datetime('now')
 WHERE name IN ('Website Visitor', 'Blog visitor', 'Anonymous', 'Unknown', 'N/A', 'n/a');

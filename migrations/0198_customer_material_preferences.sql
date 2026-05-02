-- Per-contractor material defaults & proposal pricing.
-- Stored on `customers` (the auth row that contractors log in as), scoped by
-- team owner via resolveTeamOwner so team members share the owner's prefs.
-- Mirrors the schema previously placed on master_companies (migration 0149)
-- which was platform-wide and shared across every contractor — the wrong scope.
ALTER TABLE customers ADD COLUMN material_preferences TEXT DEFAULT NULL;

-- Migration 0079: Add permissions column to team_invitations
-- Required by the invite flow which stores per-member permission flags with the invitation

ALTER TABLE team_invitations ADD COLUMN permissions TEXT DEFAULT '{"orders":true,"reports":true,"crm":true,"secretary":true,"virtual_tryon":true}';

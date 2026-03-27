-- Migration 0039: D2D team member permissions + account linking
-- Adds fine-grained permissions to d2d_team_members so admins can
-- control exactly what each door-knocker can see and access.
-- {"d2d":"all|assigned","reports":bool,"crm":bool,"secretary":bool,"team":bool}

ALTER TABLE d2d_team_members ADD COLUMN permissions TEXT DEFAULT '{"d2d":"all","reports":true,"crm":true,"secretary":false,"team":false}';

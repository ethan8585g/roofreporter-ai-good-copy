-- Add Google Calendar OAuth columns to customers table
ALTER TABLE customers ADD COLUMN gmail_refresh_token TEXT;
ALTER TABLE customers ADD COLUMN gmail_connected_email TEXT;
ALTER TABLE customers ADD COLUMN gmail_connected_at TEXT;
ALTER TABLE customers ADD COLUMN gcal_oauth_state TEXT;

CREATE TABLE IF NOT EXISTS magic_link_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  token_type TEXT NOT NULL DEFAULT 'signin',
  used INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_magic_token ON magic_link_tokens(token);
CREATE INDEX IF NOT EXISTS idx_magic_email ON magic_link_tokens(email);

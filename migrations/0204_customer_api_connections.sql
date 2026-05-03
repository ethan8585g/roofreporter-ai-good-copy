-- Outbound CRM/API connections per customer (account-owner scoped).
-- Lets a B2B customer (e.g. AccuLynx user) register one or more endpoints;
-- every finalized report is POSTed to each enabled endpoint with a stable
-- JSON payload so the report lands directly in the customer's CRM.
CREATE TABLE IF NOT EXISTS customer_api_connections (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id     INTEGER NOT NULL,
  name            TEXT NOT NULL,
  provider        TEXT NOT NULL DEFAULT 'custom',
  endpoint_url    TEXT NOT NULL,
  api_key_cipher  TEXT NOT NULL,
  api_key_iv      TEXT NOT NULL,
  api_key_hint    TEXT,
  auth_header     TEXT NOT NULL DEFAULT 'Authorization',
  auth_prefix     TEXT NOT NULL DEFAULT 'Bearer ',
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_capi_customer ON customer_api_connections(customer_id, enabled);

-- Delivery audit log: one row per (order_id, connection_id) attempt cycle.
-- The unique index is the idempotency guard so report regeneration cannot
-- double-post to the customer's CRM.
CREATE TABLE IF NOT EXISTS customer_api_deliveries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id   INTEGER NOT NULL,
  order_id        TEXT NOT NULL,
  customer_id     INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  http_status     INTEGER,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  delivered_at    TEXT,
  error_message   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_capi_deliv_order ON customer_api_deliveries(order_id);
CREATE INDEX IF NOT EXISTS idx_capi_deliv_conn  ON customer_api_deliveries(connection_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_capi_deliv_order_conn
  ON customer_api_deliveries(order_id, connection_id);

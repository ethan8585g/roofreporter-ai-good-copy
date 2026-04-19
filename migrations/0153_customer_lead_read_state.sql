-- Customer lead read state — per-customer tracking of read/unread leads across all channels
CREATE TABLE IF NOT EXISTS customer_lead_read_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  lead_id TEXT NOT NULL,          -- e.g. widget_42, call_99, d2d_7, form_3
  lead_channel TEXT NOT NULL,     -- web_widget, voice_call, sms, voicemail, d2d_appointment, storm_alert, form_submission, email_reply, crm_job_message
  read_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(customer_id, lead_id, lead_channel)
);

CREATE INDEX IF NOT EXISTS idx_cust_lead_read_customer ON customer_lead_read_state(customer_id);
CREATE INDEX IF NOT EXISTS idx_cust_lead_read_lead ON customer_lead_read_state(lead_id, lead_channel);

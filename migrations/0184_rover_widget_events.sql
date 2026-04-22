-- Rover widget engagement funnel events
-- Tracks top-of-funnel metrics (impressions, opens) that precede conversations.
-- Conversations are still in rover_conversations; this is the visibility layer
-- so super admin can see visitors who saw/opened the widget but never typed.

CREATE TABLE IF NOT EXISTS rover_widget_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,           -- 'widget_impression' | 'widget_opened'
  page_url TEXT,
  referrer TEXT,
  visitor_ip TEXT,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (session_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_rover_widget_events_type ON rover_widget_events(event_type);
CREATE INDEX IF NOT EXISTS idx_rover_widget_events_created ON rover_widget_events(created_at);

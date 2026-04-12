-- Blog Content Agent: keyword queue + generation log
CREATE TABLE IF NOT EXISTS blog_keyword_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  geo_modifier TEXT,                  -- e.g. "Toronto", "Calgary", "Florida"
  intent TEXT DEFAULT 'informational', -- informational | commercial | comparison | local
  priority INTEGER DEFAULT 5,          -- 1 highest, 10 lowest
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','drafted','published','failed','skipped')),
  target_category TEXT DEFAULT 'roofing',
  notes TEXT,
  post_id INTEGER,                     -- FK to blog_posts once drafted/published
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  locked_until TEXT,                   -- prevents concurrent runs picking same row
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_blog_kq_status ON blog_keyword_queue(status, priority);
CREATE UNIQUE INDEX IF NOT EXISTS idx_blog_kq_keyword_geo ON blog_keyword_queue(keyword, geo_modifier);

CREATE TABLE IF NOT EXISTS blog_generation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id INTEGER,
  post_id INTEGER,
  stage TEXT NOT NULL,                 -- pick | draft | quality_gate | publish | error
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  quality_score REAL,                  -- 0-100
  quality_breakdown TEXT,              -- JSON: eeat, keyword_density, readability, schema
  passed_gate INTEGER DEFAULT 0,
  duration_ms INTEGER,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_blog_gl_queue ON blog_generation_log(queue_id);
CREATE INDEX IF NOT EXISTS idx_blog_gl_created ON blog_generation_log(created_at);

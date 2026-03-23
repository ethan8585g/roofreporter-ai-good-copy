-- Migration number: 0050 	 2024-03-22T00:00:00.000Z
-- Visualizer Photos Table
CREATE TABLE IF NOT EXISTS visualizer_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  photo_url TEXT NOT NULL,
  angle TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (order_id) REFERENCES orders(id)
);

-- Phase 0: Measurement provenance + versioning schema
-- Additive-only migration. No DROPs.

-- Per-field provenance: JSON map of field → { source, confidence, computed_at, engine_version, notes }
ALTER TABLE reports ADD COLUMN measurement_metadata TEXT;

-- Per-facet geographic polygons: JSON array of { facet_id, lat_lng_ring: [[lat,lng],...], source }
ALTER TABLE reports ADD COLUMN facet_polygons_geo TEXT;

-- Engine version stamp (e.g. "2026.04-phase1")
ALTER TABLE reports ADD COLUMN engine_version TEXT;

-- FK to report_versions for recompute lineage
ALTER TABLE reports ADD COLUMN previous_version_id INTEGER;

-- Workflow status: null | 'review_required' | 'approved'
ALTER TABLE reports ADD COLUMN review_status TEXT;

-- Full report snapshot table for recompute history + rollback
CREATE TABLE IF NOT EXISTS report_versions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id        INTEGER NOT NULL,
  engine_version   TEXT    NOT NULL,
  snapshot_json    TEXT    NOT NULL,
  created_at       INTEGER NOT NULL,
  superseded_at    INTEGER,
  FOREIGN KEY (report_id) REFERENCES reports(id)
);

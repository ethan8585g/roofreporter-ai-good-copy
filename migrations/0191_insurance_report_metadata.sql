-- Phase 2: Insurance-grade report metadata
-- Forward-only, idempotent. All columns nullable. Sections render only
-- when populated; absence keeps existing reports rendering as today.

CREATE TABLE IF NOT EXISTS report_claim_metadata (
  report_id            INTEGER PRIMARY KEY,
  claim_number         TEXT,
  policy_number        TEXT,
  carrier_name         TEXT,
  adjuster_name        TEXT,
  adjuster_email       TEXT,
  adjuster_phone       TEXT,
  date_of_loss         TEXT,           -- ISO 8601 date
  peril                TEXT,           -- hail / wind / fire / wear / other
  inspection_date      TEXT,           -- ISO 8601 date
  inspector_name       TEXT,
  inspector_license    TEXT,
  signed_at            TEXT,           -- ISO 8601 timestamp; NULL = unsigned
  insurance_ready      INTEGER NOT NULL DEFAULT 0,  -- 0 = draft, 1 = adjuster-ready
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_report_claim_metadata_ready
  ON report_claim_metadata(insurance_ready);

-- Penetrations: pipe boots (with diameters), vents (5 types), skylights, chimneys.
-- Per-item diameters / dims stored as JSON to avoid 20 nullable columns.
CREATE TABLE IF NOT EXISTS report_penetrations (
  report_id              INTEGER PRIMARY KEY,
  pipe_boots_15in        INTEGER,    -- 1.5"
  pipe_boots_2in         INTEGER,
  pipe_boots_3in         INTEGER,
  pipe_boots_4in         INTEGER,
  vents_turtle           INTEGER,
  vents_box              INTEGER,
  vents_ridge            INTEGER,    -- count of ridge vents (continuous LF stored separately on flashing)
  vents_turbine          INTEGER,
  vents_power            INTEGER,
  skylights_count        INTEGER,
  skylights_dims_json    TEXT,       -- [{w_in, l_in, type}]
  chimneys_count         INTEGER,
  chimneys_dims_json     TEXT,       -- [{w_in, l_in, h_ft, material}]
  notes                  TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);

-- Flashing breakdown by type (LF). Valley LF already lives on the report row.
CREATE TABLE IF NOT EXISTS report_flashing (
  report_id            INTEGER PRIMARY KEY,
  step_lf              REAL,
  headwall_lf          REAL,
  sidewall_lf          REAL,
  counter_lf           REAL,
  chimney_apron_lf     REAL,
  chimney_step_lf      REAL,
  chimney_counter_lf   REAL,
  chimney_cricket_lf   REAL,
  skylight_kits        INTEGER,
  kickout_count        INTEGER,
  notes                TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);

-- Photos. One row per photo. Multiple per report.
CREATE TABLE IF NOT EXISTS report_photos (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id           INTEGER NOT NULL,
  url                 TEXT NOT NULL,
  caption             TEXT,
  taken_at            TEXT,           -- ISO 8601
  gps_lat             REAL,
  gps_lng             REAL,
  category            TEXT,           -- damage / overview / penetration / flashing / decking / other
  display_order       INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_report_photos_report
  ON report_photos(report_id, display_order);

-- Existing material survey + condition.
CREATE TABLE IF NOT EXISTS report_existing_material (
  report_id              INTEGER PRIMARY KEY,
  material_type          TEXT,           -- 3-tab / architectural / designer / metal / tile / built-up / TPO / EPDM / other
  manufacturer           TEXT,
  color                  TEXT,
  age_years              INTEGER,
  layers_count           INTEGER,        -- 1 or 2 (or 3+) — drives tear-off cost
  damage_hail            INTEGER,        -- boolean 0/1
  damage_wind_lift       INTEGER,
  damage_granule_loss    INTEGER,
  damage_blistering      INTEGER,
  damage_nail_pops       INTEGER,
  damage_sealant_failure INTEGER,
  damage_other           TEXT,
  test_squares_count     INTEGER,
  itel_match_recommended INTEGER,        -- 0/1
  notes                  TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);

-- Decking + ventilation per IRC 806.
CREATE TABLE IF NOT EXISTS report_decking (
  report_id              INTEGER PRIMARY KEY,
  sheathing_type         TEXT,           -- plywood / OSB / board / other
  sheathing_thickness_in REAL,
  underlayment_layers    INTEGER,
  ventilation_type       TEXT,           -- ridge / soffit / box / power / mixed
  ventilation_nfa_in2    REAL,           -- net free area, sq inches
  notes                  TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);

-- Drainage (low-slope only).
CREATE TABLE IF NOT EXISTS report_drainage (
  report_id      INTEGER PRIMARY KEY,
  scuppers_count INTEGER,
  drains_count   INTEGER,
  parapet_lf     REAL,
  coping_lf      REAL,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);

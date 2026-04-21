-- Phase 8 — Seed 30 high-intent long-tail keywords for the autonomous blog agent.
-- Three cohorts:
--   A) [city] hail damage roof repair   × top 15 US hail metros
--   B) [carrier] roof insurance claim process × top 10 US carriers
--   C) [code] roof requirements         × 5 building codes
-- Idempotent via the (keyword, geo_modifier) UNIQUE index from 0094.

-- A) City × hail damage repair (local intent)
INSERT OR IGNORE INTO blog_keyword_queue (keyword, geo_modifier, intent, priority, target_category, notes) VALUES
  ('hail damage roof repair', 'Denver, CO',        'local', 2, 'storm-response', 'Front Range hail corridor - high frequency'),
  ('hail damage roof repair', 'Dallas, TX',        'local', 2, 'storm-response', 'DFW hail belt'),
  ('hail damage roof repair', 'Oklahoma City, OK', 'local', 2, 'storm-response', 'Tornado alley hail + wind'),
  ('hail damage roof repair', 'Wichita, KS',       'local', 2, 'storm-response', 'Hail belt'),
  ('hail damage roof repair', 'Omaha, NE',         'local', 2, 'storm-response', 'Northern hail belt'),
  ('hail damage roof repair', 'Des Moines, IA',    'local', 3, 'storm-response', 'Post-Derecho demand'),
  ('hail damage roof repair', 'Colorado Springs, CO', 'local', 2, 'storm-response', 'Palmer Divide storm cell concentration'),
  ('hail damage roof repair', 'Kansas City, MO',   'local', 2, 'storm-response', 'KC metro hail'),
  ('hail damage roof repair', 'San Antonio, TX',   'local', 3, 'storm-response', 'Hail + tornado corridor'),
  ('hail damage roof repair', 'Fort Worth, TX',    'local', 3, 'storm-response', 'DFW west'),
  ('hail damage roof repair', 'Austin, TX',        'local', 3, 'storm-response', 'Spring hail events'),
  ('hail damage roof repair', 'Minneapolis, MN',   'local', 3, 'storm-response', 'Summer hail + ice dam mix'),
  ('hail damage roof repair', 'St. Louis, MO',     'local', 3, 'storm-response', 'Mid-continent storm junction'),
  ('hail damage roof repair', 'Phoenix, AZ',       'local', 3, 'storm-response', 'Monsoon hail'),
  ('hail damage roof repair', 'Chicago, IL',       'local', 3, 'storm-response', 'Derecho + lake effect mix');

-- B) Carrier × claim process (comparison intent)
INSERT OR IGNORE INTO blog_keyword_queue (keyword, geo_modifier, intent, priority, target_category, notes) VALUES
  ('roof insurance claim process', 'State Farm',       'comparison', 2, 'insurance', 'Top US carrier by share'),
  ('roof insurance claim process', 'Allstate',         'comparison', 2, 'insurance', 'Top 2 US carrier'),
  ('roof insurance claim process', 'USAA',             'comparison', 2, 'insurance', 'Military demographic, claim-friendly'),
  ('roof insurance claim process', 'Farmers Insurance','comparison', 2, 'insurance', 'Top 5 US'),
  ('roof insurance claim process', 'Liberty Mutual',   'comparison', 3, 'insurance', 'Top 10 US'),
  ('roof insurance claim process', 'Travelers',        'comparison', 3, 'insurance', 'Major commercial + residential'),
  ('roof insurance claim process', 'Nationwide',       'comparison', 3, 'insurance', 'Top 10 US'),
  ('roof insurance claim process', 'Progressive Home', 'comparison', 3, 'insurance', 'Growing home market'),
  ('roof insurance claim process', 'Erie Insurance',   'comparison', 4, 'insurance', 'Regional Midwest/NE'),
  ('roof insurance claim process', 'Citizens Property',   'comparison', 2, 'insurance', 'FL insurer of last resort - huge share in FL');

-- C) Building code × roof requirements (informational / compliance intent)
INSERT OR IGNORE INTO blog_keyword_queue (keyword, geo_modifier, intent, priority, target_category, notes) VALUES
  ('roof requirements', 'Florida Building Code (FBC)',     'informational', 2, 'guides', 'High wind uplift + hurricane zones'),
  ('roof requirements', 'California Title 24 (T24)',        'informational', 2, 'guides', 'Energy code + cool roof + WUI Class A'),
  ('roof requirements', 'Ontario Building Code (OBC)',      'informational', 3, 'guides', 'CA market - ice dam + snow load'),
  ('roof requirements', 'Texas IRC 2021 with state amendments', 'informational', 3, 'guides', 'Windborne debris + wildfire amendments'),
  ('roof requirements', 'National Building Code of Canada (NBC 2020)', 'informational', 3, 'guides', 'Canadian baseline across provinces');

-- Migration 0086: SEO tracking tables and Q2 2026 content calendar

-- Keyword rank tracking table
CREATE TABLE IF NOT EXISTS seo_rank_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  target_url TEXT,
  rank_position INTEGER,
  search_engine TEXT DEFAULT 'google',
  recorded_date TEXT NOT NULL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Content calendar table
CREATE TABLE IF NOT EXISTS content_calendar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publish_date TEXT,
  title TEXT NOT NULL,
  slug TEXT,
  target_keyword TEXT,
  est_search_volume TEXT,
  content_type TEXT CHECK(content_type IN ('comparison','geo-blog','technical','city-guide','educational','case-study')),
  internal_link_target TEXT,
  offpage_target TEXT,
  status TEXT DEFAULT 'planned' CHECK(status IN ('planned','in-progress','published','cancelled')),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Seed: 30 target keywords for rank tracking
INSERT OR IGNORE INTO seo_rank_tracking (keyword, target_url, rank_position, search_engine, recorded_date, notes) VALUES
('roofr alternative canada',             '/roofr-alternative',                     NULL, 'google', date('now'), 'Primary comparison target — high commercial intent'),
('roofr alternative',                    '/roofr-alternative',                     NULL, 'google', date('now'), 'Broad comparison term'),
('roofr pricing too expensive',          '/roofr-pricing-complaints',              NULL, 'google', date('now'), 'Pain point query'),
('roofr pricing complaints',             '/roofr-pricing-complaints',              NULL, 'google', date('now'), 'Review-intent query'),
('roofsnap vs roofmanager',              '/roofsnap-vs-roofmanager',               NULL, 'google', date('now'), 'Direct comparison'),
('roofsnap alternative canada',          '/roofsnap-vs-roofmanager',               NULL, 'google', date('now'), 'Canada-specific alternative'),
('cheaper alternative to eagleview',     '/cheaper-alternative-to-eagleview',      NULL, 'google', date('now'), 'Primary EagleView comparison target'),
('eagleview alternative canada',         '/cheaper-alternative-to-eagleview',      NULL, 'google', date('now'), 'Canada-specific EagleView alt'),
('eagleview cost 2026',                  '/blog/eagleview-cost-2026-alternatives', NULL, 'google', date('now'), 'Pricing research query'),
('ai roof measurement reports',          '/features/measurements',                 NULL, 'google', date('now'), 'Core product term'),
('satellite roof measurement software',  '/features/measurements',                 NULL, 'google', date('now'), 'Product category'),
('roof measurement software canada',     '/features/measurements',                 NULL, 'google', date('now'), 'Canada geo-modified'),
('roofing crm canada',                   '/features/crm',                          NULL, 'google', date('now'), 'CRM category Canada'),
('best roofing crm 2026',                '/blog/roofing-crm-software-comparison-2026', NULL, 'google', date('now'), 'CRM comparison'),
('roofing crm free',                     '/features/crm',                          NULL, 'google', date('now'), 'Free CRM intent'),
('ai phone receptionist roofing',        '/features/ai-secretary',                 NULL, 'google', date('now'), 'AI secretary primary'),
('roofing answering service ai',         '/features/ai-secretary',                 NULL, 'google', date('now'), 'AI secretary variant'),
('how to measure a roof without climbing', '/blog/how-to-measure-a-roof-without-climbing-2026', NULL, 'google', date('now'), 'High volume educational'),
('roof pitch calculator',                '/blog/roof-pitch-calculator-guide',       NULL, 'google', date('now'), 'Utility content'),
('material takeoff roofing',             '/blog/what-is-a-material-takeoff-roofing', NULL, 'google', date('now'), 'Educational BOM query'),
('calgary roof measurement software',    '/features/measurements/calgary',          NULL, 'google', date('now'), 'City-specific software'),
('calgary roofing crm',                  '/features/crm',                           NULL, 'google', date('now'), 'City CRM query'),
('edmonton roof measurement',            '/features/measurements/edmonton',         NULL, 'google', date('now'), 'Edmonton city silo'),
('vancouver flat roof measurement',      '/blog/vancouver-flat-roof-drainage-measurement', NULL, 'google', date('now'), 'Geo-blog target'),
('alberta hail roofing software',        '/blog/alberta-hail-wind-roofing-estimate-automation', NULL, 'google', date('now'), 'Alberta storm target'),
('ice dam estimating quebec',            '/blog/quebec-ice-dam-prevention-roofing', NULL, 'google', date('now'), 'Quebec geo-blog target'),
('coastal roofing estimates nova scotia','/blog/atlantic-canada-coastal-roofing-estimates', NULL, 'google', date('now'), 'Atlantic geo-blog target'),
('storm damage roof inspection checklist', '/blog/storm-damage-roof-inspection-checklist-2026', NULL, 'google', date('now'), 'Storm response content'),
('best roof measurement software 2026',  '/blog/best-roof-measurement-software-2026', NULL, 'google', date('now'), 'Listicle ranking target'),
('roof measurement reports calgary',     '/features/measurements/calgary',          NULL, 'google', date('now'), 'Local service intent');

-- Seed: Q2 2026 content calendar (April 15 – June 30)
INSERT OR IGNORE INTO content_calendar (publish_date, title, slug, target_keyword, est_search_volume, content_type, internal_link_target, offpage_target, status, notes) VALUES
('2026-04-15', 'The Hidden Cost of USD Roofing Software for Canadian Contractors', 'hidden-cost-usd-roofing-software-canada', 'usd roofing software canada cost', '200-500/mo', 'comparison', '/roofr-alternative', 'CRCA website', 'planned', 'Pain agitation — currency friction angle'),
('2026-04-22', 'Roofing Material Prices in Canada 2026: What Contractors Need to Know', 'roofing-material-prices-canada-2026', 'roofing material prices canada 2026', '500-1000/mo', 'educational', '/features/measurements', 'Canadian Roofer Magazine', 'planned', 'Evergreen pricing guide — high search volume'),
('2026-04-29', 'How to Set Up a Roofing CRM from Scratch (2026 Guide)', 'how-to-set-up-roofing-crm-2026', 'how to set up roofing crm', '300-600/mo', 'technical', '/features/crm', 'Roofer''s Coffee Shop', 'planned', 'Tutorial content → CRM signups'),
('2026-05-06', 'Toronto Roofing Software Guide: What Ontario Contractors Are Using in 2026', 'toronto-roofing-software-guide-2026', 'roofing software toronto ontario', '300-600/mo', 'city-guide', '/features/measurements/toronto', 'ARCA directory', 'planned', 'Ontario city guide — high population'),
('2026-05-13', 'Vancouver Roofing Contractors: The Software Stack Winning Bids in 2026', 'vancouver-roofing-contractors-software-2026', 'roofing software vancouver bc', '200-400/mo', 'city-guide', '/features/measurements/vancouver', 'RCABC member directory', 'planned', 'BC city guide'),
('2026-05-20', 'RoofSnap Pricing vs RoofManager: 2026 Full Breakdown for Canadian Contractors', 'roofsnap-pricing-vs-roofmanager-2026', 'roofsnap pricing canada 2026', '100-200/mo', 'comparison', '/roofsnap-vs-roofmanager', 'G2 review', 'planned', 'Companion post to comparison landing page'),
('2026-05-27', 'What Is Pitch Factor in Roofing and Why Does It Affect Your Estimate?', 'pitch-factor-roofing-estimate-guide', 'pitch factor roofing estimate', '400-800/mo', 'educational', '/features/measurements', 'Capterra review', 'planned', 'Educational → measurement report CTA'),
('2026-06-03', 'Storm Season Prep for Roofing Contractors: Your 2026 Checklist', 'storm-season-prep-roofing-contractors-2026', 'storm season roofing contractor checklist', '300-600/mo', 'technical', '/features/ai-secretary', 'Roofing Contractor Magazine', 'planned', 'Storm response — AI Secretary conversion'),
('2026-06-10', 'How Canadian Roofing Contractors Are Using AI in 2026', 'canadian-roofing-contractors-ai-2026', 'AI roofing software canada 2026', '200-400/mo', 'technical', '/features/ai-secretary', 'Building Design + Construction', 'planned', 'Thought leadership — AEO targeting'),
('2026-06-17', 'Winnipeg and Prairie Roofing: Cold Climate Measurement Challenges', 'winnipeg-prairie-roofing-measurement-2026', 'roofing software winnipeg manitoba', '150-300/mo', 'city-guide', '/features/measurements/winnipeg', 'MRCA directory', 'planned', 'Prairie region geo-blog'),
('2026-06-24', 'EagleView vs Hover vs RoofSnap vs RoofManager: Full 2026 Shootout', 'eagleview-hover-roofsnap-roofmanager-2026', 'roofing measurement software comparison 2026', '500-1000/mo', 'comparison', '/cheaper-alternative-to-eagleview', 'Software Advice review', 'planned', 'Mega-comparison listicle — high traffic target');

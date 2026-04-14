-- Migration 0109: Replace wrong/dead Unsplash cover images on blog posts.
-- Several Unsplash photo IDs resolved to food (chicken parm, burger), vases,
-- or returned 404 — producing badly off-topic blog cards on the blog index.
-- All replacement URLs below have been verified to return real roofing/house
-- imagery at the time of this migration.

-- ── 1. Chicken parm (photo-1632778149955) — used on 7+ top English posts ────
UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1449844908441-8829872d2607?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'how-to-measure-a-roof-without-climbing-2026';

UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'best-roofing-crm-software-2026-buyers-guide';

UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'how-to-estimate-roofing-job-5-minutes-without-climbing';

UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1513880989635-6eb491ce7f5b?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'roof-measurement-reports-guide-us-contractors-2026';

UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1516156008625-3a9d6067fab5?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'red-deer-lethbridge-roofing-satellite-measurement-southern-alberta-2026';

UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'seattle-roofing-guide-moss-drainage-wsec-compliance';

UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'saskatoon-roofing-reports-ai-measurements-saskatchewan-2026';

UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'roof-inspection-software-calgary-satellite-measurements-2026';

-- Catch-all: any remaining row pointing at the chicken-parm photo.
UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1449844908441-8829872d2607?w=1200&q=80&auto=format&fit=crop'
WHERE cover_image_url LIKE '%photo-1632778149955%';

-- ── 2. Burger photo (photo-1615297928064) ──────────────────────────────────
UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=80&auto=format&fit=crop'
WHERE cover_image_url LIKE '%photo-1615297928064%';

-- ── 3. Vases photo (photo-1565193566173) — roofing-estimate-accuracy ───────
UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1513880989635-6eb491ce7f5b?w=1200&q=80&auto=format&fit=crop'
WHERE cover_image_url LIKE '%photo-1565193566173%';

-- ── 4. Dead URLs (404s) ────────────────────────────────────────────────────
UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?w=1200&q=80&auto=format&fit=crop'
WHERE cover_image_url LIKE '%photo-1619862434634%';

UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=80&auto=format&fit=crop'
WHERE cover_image_url LIKE '%photo-1548963670%';

UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1516156008625-3a9d6067fab5?w=1200&q=80&auto=format&fit=crop'
WHERE cover_image_url LIKE '%photo-1561463904%';

UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1200&q=80&auto=format&fit=crop'
WHERE cover_image_url LIKE '%photo-1527482797697%';

UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1513880989635-6eb491ce7f5b?w=1200&q=80&auto=format&fit=crop'
WHERE cover_image_url LIKE '%photo-1450101499163%';

-- ── 5. Lecture-hall photo (photo-1519452575417) — atlantic-canada-coastal ──
UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1513880989635-6eb491ce7f5b?w=1200&q=80&auto=format&fit=crop'
WHERE cover_image_url LIKE '%photo-1519452575417%';

-- ── 6. Fill NULL cover images on solar blog posts (migration 0108) ─────────
UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1509391366360-2e959784a276?w=1200&q=80&auto=format&fit=crop'
WHERE (cover_image_url IS NULL OR cover_image_url = '')
  AND status = 'published'
  AND (slug LIKE '%solar%' OR category = 'solar');

-- ── 7. Fill NULL cover images on remaining published English posts ─────────
UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1513880989635-6eb491ce7f5b?w=1200&q=80&auto=format&fit=crop'
WHERE (cover_image_url IS NULL OR cover_image_url = '')
  AND status = 'published';

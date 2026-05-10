-- 0231_blog_audit_cleanup.sql
-- Repair the public blog and prune trust-damaging content uncovered in the
-- 2026-05-10 blog audit.
--
-- 1) Schema fix: add cover_image_alt and author_slug columns. The
--    /api/blog/posts query and the /blog/:slug HTML route both SELECT these
--    columns, but neither was present on remote D1 — every public blog request
--    was returning HTTP 500. Migration 0222 added cover_image_alt locally;
--    this re-applies it for prod and adds the long-missing author_slug.
-- 2) Archive 10 off-brand Florida lifestyle posts (199-208). Roof Manager is a
--    Canadian B2B platform; AI-generated guides like "Best Restaurants in
--    Miami" with forced roofing tie-ins read as SEO spam.
-- 3) Archive duplicate cost-calculator post 179. ID 197 is the canonical
--    version (shorter slug, prettier styling). Redirect handled in src/index.tsx.
-- 4) Archive 19 foreign-language posts targeting markets the product does not
--    serve (Spain, LatAm, Brazil, Portugal, France, Belgium, Switzerland,
--    Austria, Sweden, Norway, Denmark, Finland, Greece, Czech Republic).
-- 5) Archive redundant competitor takedowns. Keep one canonical post per
--    competitor: RoofSnap → 239, Roofr → 144 + 142, EagleView → 172 + 238 + 127.
-- 6) Normalize "Solar Sales" category label to "solar" so the category filter
--    UI shows one solar bucket instead of two.
-- 7) Resolve conflicting missed-call dollar figure between IDs 35 ($117K) and
--    175 ($40K/year). Archive 35; ID 175 becomes the canonical missed-call
--    AI-receptionist post with the more defensible number.

ALTER TABLE blog_posts ADD COLUMN cover_image_alt TEXT;
ALTER TABLE blog_posts ADD COLUMN author_slug TEXT;

UPDATE blog_posts SET status='archived', updated_at=datetime('now')
 WHERE id IN (199, 200, 201, 202, 203, 204, 205, 206, 207, 208);

UPDATE blog_posts SET status='archived', updated_at=datetime('now')
 WHERE id = 179;

UPDATE blog_posts SET status='archived', updated_at=datetime('now')
 WHERE id IN (76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89,
              99, 100, 101, 102, 103);

UPDATE blog_posts SET status='archived', updated_at=datetime('now')
 WHERE id IN (7, 71, 128, 143, 145, 146, 147, 152, 153, 154);

UPDATE blog_posts SET category='solar', updated_at=datetime('now')
 WHERE category='Solar Sales';

UPDATE blog_posts SET status='archived', updated_at=datetime('now')
 WHERE id = 35;

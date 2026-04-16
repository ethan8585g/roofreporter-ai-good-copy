-- Freshness signal: bump updated_at on all published blog posts to April 2026
-- This updates dateModified in BlogPosting JSON-LD, signalling freshness to Google
UPDATE blog_posts
SET updated_at = '2026-04-16T12:00:00.000Z'
WHERE status = 'published';

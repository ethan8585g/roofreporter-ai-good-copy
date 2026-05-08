-- 0221_blog_posts_author_slug.sql
-- Add author_slug column so blog posts can attribute to a specific named editor
-- (e.g. /authors/sarah-mitchell, /authors/daniel-reeves) rather than the
-- generic editorial-team byline. Author bio data lives in code (authorsConfig
-- in src/index.tsx), keyed by slug — keeps the schema lightweight while
-- supporting rich Person schema, /authors/<slug> pages, and editor-specific
-- expertise signals for E-E-A-T.

ALTER TABLE blog_posts ADD COLUMN author_slug TEXT DEFAULT 'roof-manager-editorial-team';

-- Backfill: any post that already had a non-default author_name keeps its
-- original string in author_name; everything else falls through to the
-- editorial-team default. Future writes set author_slug explicitly.
UPDATE blog_posts SET author_slug = 'roof-manager-editorial-team' WHERE author_slug IS NULL;

CREATE INDEX IF NOT EXISTS idx_blog_posts_author_slug ON blog_posts(author_slug);

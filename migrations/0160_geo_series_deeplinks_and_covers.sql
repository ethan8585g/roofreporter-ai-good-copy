-- Migration 0160: GEO series — cross-link both posts and swap placeholder covers
-- Updates the two GEO-series blog posts to use working roofing cover images
-- and embed deep-links between them for internal SEO/GEO corroboration.

-- Post #1 — diagnostic / crawler accessibility
UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1516156008625-3a9d6067fab5?w=1200&q=80&auto=format&fit=crop',
    content = REPLACE(
      content,
      'paradigm shift from traditional search optimization to generative optimization',
      '<a href="/blog/paradigm-shift-seo-generative-engine-optimization-roofing" style="color:#f59e0b;text-decoration:underline">paradigm shift from traditional search optimization to generative optimization</a>'
    ),
    updated_at = datetime('now')
WHERE slug = 'diagnostic-assessment-digital-infrastructure-crawler-accessibility-roofing';

-- Post #2 — paradigm shift / SEO vs GEO
UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1449844908441-8829872d2607?w=1200&q=80&auto=format&fit=crop',
    content = REPLACE(
      content,
      'diagnostic work in the first post of this series',
      '<a href="/blog/diagnostic-assessment-digital-infrastructure-crawler-accessibility-roofing" style="color:#f59e0b;text-decoration:underline">diagnostic work in the first post of this series</a>'
    ),
    updated_at = datetime('now')
WHERE slug = 'paradigm-shift-seo-generative-engine-optimization-roofing';

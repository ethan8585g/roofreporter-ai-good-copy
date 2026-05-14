-- 0247: Follow-up to 0246 — catch case variants, HTML-encoded patterns,
-- French equivalents, and table-cell patterns still surfacing on the live site.

-- Capitalized "Under 60 seconds" (table cells in EagleView/RoofSnap comparison posts)
UPDATE blog_posts SET content = REPLACE(content, 'Under 60 seconds', 'In 1–2 hours');

-- HTML-encoded less-than ("&lt;60 seconds" in n8n automation post)
UPDATE blog_posts SET content = REPLACE(content, '&lt;60 seconds', '1–2 hours');

-- Table-cell-only "60 seconds</td>" pattern (no space-suffixed phrase match)
UPDATE blog_posts SET content = REPLACE(content, '60 seconds</td>', '1–2 hours</td>');

-- French marketing copy on /blog French posts
UPDATE blog_posts SET content = REPLACE(content, 'en moins de 60 secondes', 'en 1 à 2 heures');
UPDATE blog_posts SET content = REPLACE(content, 'moins de 60 secondes', '1 à 2 heures');
UPDATE blog_posts SET excerpt = REPLACE(excerpt, 'en moins de 60 secondes', 'en 1 à 2 heures');
UPDATE blog_posts SET excerpt = REPLACE(excerpt, 'moins de 60 secondes', '1 à 2 heures');
UPDATE blog_posts SET meta_description = REPLACE(meta_description, 'en moins de 60 secondes', 'en 1 à 2 heures');
UPDATE blog_posts SET meta_description = REPLACE(meta_description, 'moins de 60 secondes', '1 à 2 heures');

-- "60-second " phrase variants that survived (general suffix not caught by exact phrase matches)
UPDATE blog_posts SET content = REPLACE(content, '60-second>', '1–2 hour>');
UPDATE blog_posts SET content = REPLACE(content, '60-second<', '1–2 hour<');
UPDATE blog_posts SET content = REPLACE(content, '>60-second', '>1–2 hour');

-- Catch-all: any remaining "60 second" / "60 seconds" / "60-second" in content/excerpt/meta
UPDATE blog_posts SET content = REPLACE(content, '60 seconds', '1–2 hours');
UPDATE blog_posts SET content = REPLACE(content, '60 second', '1–2 hour');
UPDATE blog_posts SET content = REPLACE(content, '60-second', '1–2 hour');
UPDATE blog_posts SET content = REPLACE(content, '60-Second', '1–2 Hour');
UPDATE blog_posts SET excerpt = REPLACE(excerpt, '60 seconds', '1–2 hours');
UPDATE blog_posts SET excerpt = REPLACE(excerpt, '60 second', '1–2 hour');
UPDATE blog_posts SET meta_description = REPLACE(meta_description, '60 seconds', '1–2 hours');
UPDATE blog_posts SET meta_description = REPLACE(meta_description, '60 second', '1–2 hour');
UPDATE blog_posts SET title = REPLACE(title, '60 second', '1–2 hour');
UPDATE blog_posts SET title = REPLACE(title, '60-second', '1–2 hour');

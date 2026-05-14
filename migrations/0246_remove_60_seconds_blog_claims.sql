-- 0246: Remove "60 seconds" / "under a minute" marketing claims from blog_posts.
-- The site standardizes on "1–2 hours" (matches admin-traced production reality).
-- Multiple REPLACE() passes are ordered specific → general to avoid partial overlap rewrites.

-- 1. TITLE replacements (most specific first)
UPDATE blog_posts SET title = REPLACE(title,
  'Get Square Footage from Any Address in 60 Seconds',
  'Get Square Footage from Any Address in 1–2 Hours');

UPDATE blog_posts SET title = REPLACE(title, '60-Second', '1–2 Hour');
UPDATE blog_posts SET title = REPLACE(title, '60 Seconds', '1–2 Hours');
UPDATE blog_posts SET title = REPLACE(title, '60 seconds', '1–2 hours');

-- 2. EXCERPT replacements
UPDATE blog_posts SET excerpt = REPLACE(excerpt, 'in under 60 seconds', 'in 1–2 hours');
UPDATE blog_posts SET excerpt = REPLACE(excerpt, 'under 60 seconds', '1–2 hours');
UPDATE blog_posts SET excerpt = REPLACE(excerpt, 'within 60 seconds', 'within 1–2 hours');
UPDATE blog_posts SET excerpt = REPLACE(excerpt, 'in 60 seconds', 'in 1–2 hours');
UPDATE blog_posts SET excerpt = REPLACE(excerpt, '60-second', '1–2 hour');
UPDATE blog_posts SET excerpt = REPLACE(excerpt, '60 seconds', '1–2 hours');
UPDATE blog_posts SET excerpt = REPLACE(excerpt, 'in under a minute', 'in 1–2 hours');
UPDATE blog_posts SET excerpt = REPLACE(excerpt, 'under a minute', '1–2 hours');

-- 3. META_DESCRIPTION replacements (used in OG/Twitter share + search snippets)
UPDATE blog_posts SET meta_description = REPLACE(meta_description, 'in under 60 seconds', 'in 1–2 hours');
UPDATE blog_posts SET meta_description = REPLACE(meta_description, 'under 60 seconds', '1–2 hours');
UPDATE blog_posts SET meta_description = REPLACE(meta_description, 'within 60 seconds', 'within 1–2 hours');
UPDATE blog_posts SET meta_description = REPLACE(meta_description, 'in 60 seconds', 'in 1–2 hours');
UPDATE blog_posts SET meta_description = REPLACE(meta_description, '60-second', '1–2 hour');
UPDATE blog_posts SET meta_description = REPLACE(meta_description, '60 seconds', '1–2 hours');
UPDATE blog_posts SET meta_description = REPLACE(meta_description, 'in under a minute', 'in 1–2 hours');

-- 4. META_TITLE replacements (if column exists; column lives in 0011_blog_posts.sql)
UPDATE blog_posts SET meta_title = REPLACE(meta_title, '60-Second', '1–2 Hour')
  WHERE meta_title IS NOT NULL;
UPDATE blog_posts SET meta_title = REPLACE(meta_title, '60 Seconds', '1–2 Hours')
  WHERE meta_title IS NOT NULL;
UPDATE blog_posts SET meta_title = REPLACE(meta_title, '60 seconds', '1–2 hours')
  WHERE meta_title IS NOT NULL;

-- 5. CONTENT replacements (body of every post; most-specific phrases first)
UPDATE blog_posts SET content = REPLACE(content,
  'How Automation Generates Feasibility Reports in 60 Seconds',
  'How Automation Generates Feasibility Reports in 1–2 Hours');

UPDATE blog_posts SET content = REPLACE(content, 'in under 60 seconds', 'in 1–2 hours');
UPDATE blog_posts SET content = REPLACE(content, 'under 60 seconds', '1–2 hours');
UPDATE blog_posts SET content = REPLACE(content, 'within 60 seconds', 'within 1–2 hours');
UPDATE blog_posts SET content = REPLACE(content, 'in 60 seconds', 'in 1–2 hours');
UPDATE blog_posts SET content = REPLACE(content, '60-second turnaround', '1–2 hour turnaround');
UPDATE blog_posts SET content = REPLACE(content, '60-second reports', '1–2 hour reports');
UPDATE blog_posts SET content = REPLACE(content, '60-second design', '1–2 hour design');
UPDATE blog_posts SET content = REPLACE(content, '60-second satellite', '1–2 hour satellite');
UPDATE blog_posts SET content = REPLACE(content, '60-second explanation', 'brief explanation');
UPDATE blog_posts SET content = REPLACE(content, '60-second report', '1–2 hour report');
UPDATE blog_posts SET content = REPLACE(content, '60-second ', '1–2 hour ');
UPDATE blog_posts SET content = REPLACE(content, '60-Second', '1–2 Hour');
UPDATE blog_posts SET content = REPLACE(content, '60 seconds for', '1–2 hours for');
UPDATE blog_posts SET content = REPLACE(content, '60 seconds vs', '1–2 hours vs');
UPDATE blog_posts SET content = REPLACE(content, '60 seconds.', '1–2 hours.');
UPDATE blog_posts SET content = REPLACE(content, '60 seconds,', '1–2 hours,');
UPDATE blog_posts SET content = REPLACE(content, '60 seconds |', '1–2 hours |');
UPDATE blog_posts SET content = REPLACE(content, '60 seconds ', '1–2 hours ');
UPDATE blog_posts SET content = REPLACE(content, '60 Seconds', '1–2 Hours');
UPDATE blog_posts SET content = REPLACE(content, 'in under a minute', 'in 1–2 hours');
UPDATE blog_posts SET content = REPLACE(content, 'typically in under a minute', 'typically in 1–2 hours');

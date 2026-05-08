-- 0222_blog_posts_cover_image_alt.sql
-- Add cover_image_alt column for accessibility and image-search SEO. Existing
-- blog post template uses post.title as the alt text fallback, but the title
-- is often imperfect alt copy (cut off, includes branding). A dedicated alt
-- field lets editors write descriptive image-search-friendly alt text without
-- altering the post title.

ALTER TABLE blog_posts ADD COLUMN cover_image_alt TEXT;

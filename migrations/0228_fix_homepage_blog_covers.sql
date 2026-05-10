-- Replace off-topic stock photos on the four most-recent blog posts (which
-- surface on the landing page) with roofing-relevant Unsplash imagery.
-- Old covers were generic ocean/handshake/luxury-home shots; users flagged
-- them as not relevant to a roofing brand.

UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1416331108676-a22ccb276e35?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'roof-manager-vs-eagleview';

UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1518780664697-55e3ad937233?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'roof-manager-vs-roofsnap';

UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'fort-lauderdale-luxury-real-estate-roof-audit';

UPDATE blog_posts
SET cover_image_url = 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'living-on-a-canal-cape-coral-roofing';

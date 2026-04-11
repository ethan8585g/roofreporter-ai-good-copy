-- Migration 0087: Add cover_image_url to 19 blog posts missing images
-- Also fixes one duplicate image between 0031 and 0082 migrations
-- All Unsplash URLs are free for commercial use

-- ── TIER-2 POSTS (0084) — 15 posts ──────────────────────────────────────────

UPDATE blog_posts SET cover_image_url = 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'eagleview-cost-2026-alternatives' AND (cover_image_url IS NULL OR cover_image_url = '');

UPDATE blog_posts SET cover_image_url = 'https://images.unsplash.com/photo-1513467535987-fd81bc7d62f8?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'roofmanager-vs-eagleview-accuracy-price' AND (cover_image_url IS NULL OR cover_image_url = '');

UPDATE blog_posts SET cover_image_url = 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'best-roof-measurement-software-2026' AND (cover_image_url IS NULL OR cover_image_url = '');

UPDATE blog_posts SET cover_image_url = 'https://images.unsplash.com/photo-1516156008625-3a9d6067fab5?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'roofing-crm-software-comparison-2026' AND (cover_image_url IS NULL OR cover_image_url = '');

UPDATE blog_posts SET cover_image_url = 'https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'how-to-measure-a-roof-without-climbing-2026' AND (cover_image_url IS NULL OR cover_image_url = '');

UPDATE blog_posts SET cover_image_url = 'https://images.unsplash.com/photo-1502005229762-cf1b2da7c5d6?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'roof-pitch-calculator-guide' AND (cover_image_url IS NULL OR cover_image_url = '');

UPDATE blog_posts SET cover_image_url = 'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'what-is-a-material-takeoff-roofing' AND (cover_image_url IS NULL OR cover_image_url = '');

UPDATE blog_posts SET cover_image_url = 'https://images.unsplash.com/photo-1527482797697-8635b2c1c9ac?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'storm-damage-roof-inspection-checklist-2026' AND (cover_image_url IS NULL OR cover_image_url = '');

UPDATE blog_posts SET cover_image_url = 'https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'insurance-roof-claim-documentation-guide' AND (cover_image_url IS NULL OR cover_image_url = '');

UPDATE blog_posts SET cover_image_url = 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'ai-roof-measurement-accuracy-explained' AND (cover_image_url IS NULL OR cover_image_url = '');

UPDATE blog_posts SET cover_image_url = 'https://images.unsplash.com/photo-1553877522-43269d4ea984?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'how-ai-phone-receptionist-works-roofing' AND (cover_image_url IS NULL OR cover_image_url = '');

UPDATE blog_posts SET cover_image_url = 'https://images.unsplash.com/photo-1619862434634-6781e32c96ff?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'roof-measurement-reports-calgary-contractors' AND (cover_image_url IS NULL OR cover_image_url = '');

UPDATE blog_posts SET cover_image_url = 'https://images.unsplash.com/photo-1615297928064-24977384d0da?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'edmonton-roofing-software-guide-2026' AND (cover_image_url IS NULL OR cover_image_url = '');

UPDATE blog_posts SET cover_image_url = 'https://images.unsplash.com/photo-1548963670-9cfe2215f3dd?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'houston-roofing-software-guide-2026' AND (cover_image_url IS NULL OR cover_image_url = '');

UPDATE blog_posts SET cover_image_url = 'https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'roofing-estimate-accuracy-guide' AND (cover_image_url IS NULL OR cover_image_url = '');

-- ── GEO-BLOG POSTS (0085) — 4 posts ─────────────────────────────────────────

UPDATE blog_posts SET cover_image_url = 'https://images.unsplash.com/photo-1561463904-c8b61e90c9a4?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'alberta-hail-wind-roofing-estimate-automation' AND (cover_image_url IS NULL OR cover_image_url = '');

UPDATE blog_posts SET cover_image_url = 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'vancouver-flat-roof-drainage-measurement' AND (cover_image_url IS NULL OR cover_image_url = '');

UPDATE blog_posts SET cover_image_url = 'https://images.unsplash.com/photo-1547754980-3df97fed72a8?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'quebec-ice-dam-prevention-roofing' AND (cover_image_url IS NULL OR cover_image_url = '');

UPDATE blog_posts SET cover_image_url = 'https://images.unsplash.com/photo-1519452575417-564c1401ecc0?w=1200&q=80&auto=format&fit=crop'
WHERE slug = 'atlantic-canada-coastal-roofing-estimates' AND (cover_image_url IS NULL OR cover_image_url = '');

-- ── FIX DUPLICATE: 0082 uses same photo-1560518883 as 0031 ──────────────────

UPDATE blog_posts SET cover_image_url = 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200&q=80&auto=format&fit=crop'
WHERE cover_image_url LIKE '%photo-1560518883%'
  AND slug LIKE '%florida%' OR slug LIKE '%tampa%' OR slug LIKE '%jacksonville%' OR slug LIKE '%orlando%';

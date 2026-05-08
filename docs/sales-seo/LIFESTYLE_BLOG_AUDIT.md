# Lifestyle-Hybrid Blog Post Audit (G6)

The brief flagged content like *"Best Things to Do in Tampa (And Monday's Roof Checklist)"* and *"Discovering the Authentic Cuban Culture in Hialeah (And Protecting Your Familia's Roof)"* as link-magnet poison — they read AI-generated, dilute topical authority, and won't earn editorial backlinks.

## What was built

[`src/services/blog-agent.ts`](../../src/services/blog-agent.ts) now rejects lifestyle-flavored content at two points:

1. **Keyword guard** — runs before Gemini generation. If a keyword in `blog_keyword_queue` matches the lifestyle pattern set, it's marked `status='rejected'` permanently. No tokens spent.
2. **Draft drift catch** — runs after generation. If Gemini produces a lifestyle-flavored title or excerpt from an otherwise-professional keyword, the draft is rejected and the queue row is retried (or marked `failed` after `MAX_ATTEMPTS`).

Patterns matched (`matchesLifestylePattern`):
`things to do`, `best restaurants`, `raise a family`, `art lovers`, `on a budget`, `weekend in/getaway`, `student-friendly`, `culture`, `authentic`, `local's guide`, `lifestyle`, `neighborhoods to live`, `living on a canal/beach/lake`, `visiting [City]`, `discovering`, `canal`.

## Existing posts — manual cleanup required

The guard only stops *future* generation. Posts already in `blog_posts` need the human pass. Run this SQL via `npm run db:console:local` (or remote D1) to surface candidates:

```sql
SELECT id, slug, title, published_at, view_count
FROM blog_posts
WHERE status = 'published'
AND (
     title LIKE '%things to do%'
  OR title LIKE '%best restaurants%'
  OR title LIKE '%raise a family%'
  OR title LIKE '%art lovers%'
  OR title LIKE '%on a budget%'
  OR title LIKE '%weekend%'
  OR title LIKE '%student-friendly%'
  OR title LIKE '%culture%'
  OR title LIKE '%authentic%'
  OR title LIKE "%local's guide%"
  OR title LIKE '%lifestyle%'
  OR title LIKE '%neighborhoods to live%'
  OR title LIKE '%neighborhood%'
  OR title LIKE '%living on a%'
  OR title LIKE '%discovering%'
  OR title LIKE '%canal%'
)
ORDER BY published_at DESC;
```

Known matches from the live blog index as of 2026-05-08 (verify in DB):

| Title | Recommended action |
|---|---|
| Best Things to Do in Tampa This Weekend (And Monday's Roof Checklist) | Unpublish — set `status='draft'` |
| Discovering the Authentic Cuban Culture in Hialeah (And Protecting Your Familia's Roof) | Unpublish |
| Why St. Petersburg is Florida's Best City for Art Lovers (And How to Frame a Perfect Roof) | Unpublish |
| Ultimate Guide to Visiting Orlando on a Budget (Without Budgeting for a New Roof) | Unpublish |
| A Local's Guide to the Best Restaurants in Miami & Protecting Your Investment | Unpublish |
| The Best Student-Friendly Activities in Tallahassee (And Landlord-Friendly Roofing) | Unpublish |
| Top 10 Neighborhoods to Live in Jacksonville: A Roofing Perspective | Borderline — review; lifestyle framing but topic is genuinely roofing-adjacent |
| Port St. Lucie vs. Fort Lauderdale: Which is Better to Raise a Family? | Unpublish |
| Everything You Need to Know About Living on a Canal in Cape Coral | Unpublish |
| Navigating Fort Lauderdale's Luxury Real Estate Market: The Roof Audit | Borderline — real estate angle is defensible if rewritten with property-manager focus |

## Bulk unpublish (after review)

Once the user has reviewed the list, this is the unpublish command:

```sql
UPDATE blog_posts
SET status = 'draft', updated_at = datetime('now')
WHERE id IN (<comma-separated ids from review>);
```

Unpublished (draft) posts:
- Drop out of `/blog` and the API
- Remain in `blog_posts` and the sitemap (until next sitemap generation, which queries `WHERE status='published'`)
- Can be republished after rewrite, or rewritten and saved as new posts

## Long-term recommendation

The lifestyle posts likely came from custom keywords manually entered through `/api/blog/admin/agent/keywords`. The seeded `seedDefaultKeywords` list in [src/services/blog-agent.ts](../../src/services/blog-agent.ts) is purely professional — no lifestyle entries.

**Action:** add a UI guard on the keyword admin form that previews `matchesLifestylePattern` before accepting a custom keyword. Until then, the runtime guard at queue-pick time is the safety net.

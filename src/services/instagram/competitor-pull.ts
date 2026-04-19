// ============================================================
// Competitor Pull — Skill 2: Competitor Analysis
// Uses Business Discovery API for public competitor data.
// Uses Gemini to extract hooks + hashtags from captions.
// ============================================================

import type { Bindings } from '../../types'
import { getBusinessDiscovery, type GraphClientConfig } from './graph-client'
import { buildConfig } from './ig-pull'

function extractHashtags(caption: string): string[] {
  const matches = caption.match(/#[\w\u00C0-\u017F]+/g)
  return matches ? matches.map(h => h.toLowerCase()) : []
}

async function extractHooksWithGemini(env: Bindings, captions: string[]): Promise<string[]> {
  const geminiKey = (env as any).GEMINI_API_KEY
  if (!geminiKey || captions.length === 0) return []

  try {
    const prompt = `You are a social media analyst. Extract the opening hooks (first sentence or attention-grabbing phrase) from each Instagram caption below. Return ONLY a JSON array of strings, each being one hook. Deduplicate similar hooks.

Captions:
${captions.slice(0, 20).map((c, i) => `${i + 1}. ${c.slice(0, 300)}`).join('\n')}

Return JSON array only, no markdown.`

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 2000 },
      }),
    })
    const data = await res.json() as any
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]'
    const cleaned = text.replace(/```json\n?/g, '').replace(/```/g, '').trim()
    return JSON.parse(cleaned)
  } catch {
    return []
  }
}

export interface CompetitorPullResult {
  ok: boolean
  username: string
  posts_synced: number
  hooks_extracted: number
  error?: string
}

export async function pullCompetitor(env: Bindings, competitorId: number): Promise<CompetitorPullResult> {
  const db = env.DB
  const config = await buildConfig(env)

  const competitor = await db.prepare('SELECT * FROM instagram_competitors WHERE id = ? AND is_active = 1').bind(competitorId).first<any>()
  if (!competitor) return { ok: false, username: '', posts_synced: 0, hooks_extracted: 0, error: 'Competitor not found or inactive' }

  try {
    const discovery = await getBusinessDiscovery(config, competitor.username, 25)
    const bizData = discovery.business_discovery
    if (!bizData) return { ok: false, username: competitor.username, posts_synced: 0, hooks_extracted: 0, error: 'Business Discovery returned no data' }

    // Update competitor stats
    await db.prepare(`
      UPDATE instagram_competitors SET follower_count=?, media_count=?, display_name=?, last_pulled_at=datetime('now') WHERE id=?
    `).bind(bizData.followers_count || 0, bizData.media_count || 0, bizData.name || competitor.username, competitorId).run()

    // Sync posts
    const posts = bizData.media?.data || []
    let posts_synced = 0
    const captions: string[] = []

    for (const post of posts) {
      const existing = await db.prepare(
        'SELECT id FROM instagram_competitor_posts WHERE competitor_id = ? AND ig_media_id = ?'
      ).bind(competitorId, post.id).first<any>()

      const hashtags = post.caption ? extractHashtags(post.caption) : []
      if (post.caption) captions.push(post.caption)

      if (existing) {
        await db.prepare(`
          UPDATE instagram_competitor_posts SET like_count=?, comment_count=?, hashtags_json=? WHERE id=?
        `).bind(post.like_count || 0, post.comments_count || 0, JSON.stringify(hashtags), existing.id).run()
      } else {
        await db.prepare(`
          INSERT INTO instagram_competitor_posts (competitor_id, ig_media_id, media_type, caption, permalink, thumbnail_url, like_count, comment_count, posted_at, hashtags_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          competitorId, post.id, post.media_type || 'IMAGE', post.caption || '',
          post.permalink || '', post.thumbnail_url || '', post.like_count || 0,
          post.comments_count || 0, post.timestamp || '', JSON.stringify(hashtags)
        ).run()
      }
      posts_synced++
    }

    // Extract hooks with Gemini
    const hooks = await extractHooksWithGemini(env, captions)
    let hooks_extracted = 0
    for (const post of posts) {
      if (hooks.length > 0) {
        const postRow = await db.prepare(
          'SELECT id FROM instagram_competitor_posts WHERE competitor_id = ? AND ig_media_id = ?'
        ).bind(competitorId, post.id).first<any>()
        if (postRow) {
          // Assign hooks to posts based on caption matching
          const postHooks = hooks.filter(h => post.caption && post.caption.toLowerCase().includes(h.toLowerCase().slice(0, 20)))
          if (postHooks.length > 0) {
            await db.prepare('UPDATE instagram_competitor_posts SET hooks_json = ? WHERE id = ?')
              .bind(JSON.stringify(postHooks), postRow.id).run()
            hooks_extracted += postHooks.length
          }
        }
      }
    }

    // Store all hooks as research artefacts
    for (const hook of hooks) {
      await db.prepare(`
        INSERT OR REPLACE INTO instagram_research (kind, value, score, rationale, window_days, generated_at)
        VALUES ('hook', ?, 0.5, 'Extracted from competitor: ${competitor.username}', 30, datetime('now'))
      `).bind(hook).run()
    }

    return { ok: true, username: competitor.username, posts_synced, hooks_extracted }
  } catch (err: any) {
    return { ok: false, username: competitor.username, posts_synced: 0, hooks_extracted: 0, error: err.message }
  }
}

export async function pullAllCompetitors(env: Bindings): Promise<{ ok: boolean; results: CompetitorPullResult[] }> {
  const db = env.DB
  const { results: competitors } = await db.prepare('SELECT id FROM instagram_competitors WHERE is_active = 1').all<any>()
  const pullResults: CompetitorPullResult[] = []

  for (const comp of (competitors || [])) {
    const result = await pullCompetitor(env, comp.id)
    pullResults.push(result)
  }

  return { ok: true, results: pullResults }
}

// ============================================================
// Research Engine — Scores hashtags, identifies content gaps,
// ranks hooks. Writes to instagram_research.
// Deterministic on same input; re-runnable.
// ============================================================

import type { Bindings } from '../../types'

export interface ResearchResult {
  ok: boolean
  hashtags_scored: number
  hooks_scored: number
  gaps_found: number
  error?: string
}

// Score a hashtag based on frequency and average engagement of posts that use it
function scoreHashtag(frequency: number, avgEngagement: number, maxFreq: number, maxEng: number): number {
  const freqNorm = maxFreq > 0 ? frequency / maxFreq : 0
  const engNorm = maxEng > 0 ? avgEngagement / maxEng : 0
  // Balanced score: 40% frequency, 60% engagement
  return Math.round((freqNorm * 0.4 + engNorm * 0.6) * 10000) / 10000
}

export async function runResearchEngine(env: Bindings): Promise<ResearchResult> {
  const db = env.DB

  try {
    // Clear stale research (older than window)
    await db.prepare("DELETE FROM instagram_research WHERE generated_at < datetime('now', '-30 days')").run()

    // ── 1. Score hashtags from competitor posts ──
    const { results: compPosts } = await db.prepare(`
      SELECT hashtags_json, like_count, comment_count FROM instagram_competitor_posts
      WHERE posted_at > datetime('now', '-30 days') AND hashtags_json IS NOT NULL
    `).all<any>()

    const hashtagStats: Record<string, { count: number; totalEng: number }> = {}
    for (const post of (compPosts || [])) {
      try {
        const hashtags: string[] = JSON.parse(post.hashtags_json || '[]')
        const eng = (post.like_count || 0) + (post.comment_count || 0)
        for (const tag of hashtags) {
          const key = tag.toLowerCase()
          if (!hashtagStats[key]) hashtagStats[key] = { count: 0, totalEng: 0 }
          hashtagStats[key].count++
          hashtagStats[key].totalEng += eng
        }
      } catch { /* skip malformed JSON */ }
    }

    const maxFreq = Math.max(...Object.values(hashtagStats).map(h => h.count), 1)
    const maxEng = Math.max(...Object.values(hashtagStats).map(h => h.totalEng / Math.max(h.count, 1)), 1)

    let hashtags_scored = 0
    for (const [tag, stats] of Object.entries(hashtagStats)) {
      const avgEng = stats.totalEng / Math.max(stats.count, 1)
      const score = scoreHashtag(stats.count, avgEng, maxFreq, maxEng)

      await db.prepare(`
        INSERT INTO instagram_research (kind, value, score, rationale, window_days, generated_at)
        VALUES ('hashtag', ?, ?, ?, 30, datetime('now'))
        ON CONFLICT DO NOTHING
      `).bind(tag, score, `Freq: ${stats.count}, Avg engagement: ${Math.round(avgEng)}`).run()
      hashtags_scored++
    }

    // ── 2. Score hooks from competitor posts ──
    const { results: hookRows } = await db.prepare(`
      SELECT hooks_json, like_count, comment_count FROM instagram_competitor_posts
      WHERE posted_at > datetime('now', '-30 days') AND hooks_json IS NOT NULL
    `).all<any>()

    const hookStats: Record<string, { count: number; totalEng: number }> = {}
    for (const post of (hookRows || [])) {
      try {
        const hooks: string[] = JSON.parse(post.hooks_json || '[]')
        const eng = (post.like_count || 0) + (post.comment_count || 0)
        for (const hook of hooks) {
          const key = hook.toLowerCase().trim()
          if (key.length < 5) continue
          if (!hookStats[key]) hookStats[key] = { count: 0, totalEng: 0 }
          hookStats[key].count++
          hookStats[key].totalEng += eng
        }
      } catch { /* skip */ }
    }

    const maxHookFreq = Math.max(...Object.values(hookStats).map(h => h.count), 1)
    const maxHookEng = Math.max(...Object.values(hookStats).map(h => h.totalEng / Math.max(h.count, 1)), 1)

    let hooks_scored = 0
    for (const [hook, stats] of Object.entries(hookStats)) {
      const avgEng = stats.totalEng / Math.max(stats.count, 1)
      const score = scoreHashtag(stats.count, avgEng, maxHookFreq, maxHookEng)

      await db.prepare(`
        INSERT INTO instagram_research (kind, value, score, rationale, window_days, generated_at)
        VALUES ('hook', ?, ?, ?, 30, datetime('now'))
        ON CONFLICT DO NOTHING
      `).bind(hook, score, `Used ${stats.count}x, avg eng: ${Math.round(avgEng)}`).run()
      hooks_scored++
    }

    // ── 3. Identify content gaps ──
    // Topics competitors cover that we don't
    const { results: ourPosts } = await db.prepare(`
      SELECT caption FROM instagram_posts WHERE posted_at > datetime('now', '-90 days')
    `).all<any>()

    const ourTopics = new Set<string>()
    for (const post of (ourPosts || [])) {
      const words = (post.caption || '').toLowerCase().split(/\s+/)
      for (const w of words) if (w.length > 4) ourTopics.add(w)
    }

    // Extract common topics from competitor posts
    const competitorTopics: Record<string, number> = {}
    for (const post of (compPosts || [])) {
      // Use hashtags as topic proxy
      try {
        const hashtags: string[] = JSON.parse(post.hashtags_json || '[]')
        for (const tag of hashtags) {
          const clean = tag.replace('#', '').toLowerCase()
          if (clean.length > 3 && !ourTopics.has(clean)) {
            competitorTopics[clean] = (competitorTopics[clean] || 0) + 1
          }
        }
      } catch { /* skip */ }
    }

    let gaps_found = 0
    const sortedGaps = Object.entries(competitorTopics)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)

    for (const [topic, count] of sortedGaps) {
      await db.prepare(`
        INSERT INTO instagram_research (kind, value, score, rationale, window_days, generated_at)
        VALUES ('content_gap', ?, ?, ?, 30, datetime('now'))
        ON CONFLICT DO NOTHING
      `).bind(topic, count / Math.max(sortedGaps[0]?.[1] || 1, 1), `Competitors used ${count}x in 30d, we haven't covered it`).run()
      gaps_found++
    }

    return { ok: true, hashtags_scored, hooks_scored, gaps_found }
  } catch (err: any) {
    return { ok: false, hashtags_scored: 0, hooks_scored: 0, gaps_found: 0, error: err.message }
  }
}

// Export the scoring function for testing
export { scoreHashtag }

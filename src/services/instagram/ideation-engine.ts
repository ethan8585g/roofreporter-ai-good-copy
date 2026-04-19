// ============================================================
// Ideation Engine — Gemini-powered content idea generation
// Consumes research + post performance, outputs ranked ideas.
// ============================================================

import type { Bindings } from '../../types'

export interface IdeationResult {
  ok: boolean
  ideas_generated: number
  error?: string
}

export async function runIdeationEngine(env: Bindings, count = 10): Promise<IdeationResult> {
  const db = env.DB
  const geminiKey = (env as any).GEMINI_API_KEY
  if (!geminiKey) return { ok: false, ideas_generated: 0, error: 'GEMINI_API_KEY not set' }

  try {
    // Gather context: top hashtags, hooks, gaps, recent post performance
    const { results: topHashtags } = await db.prepare(
      "SELECT value, score FROM instagram_research WHERE kind='hashtag' ORDER BY score DESC LIMIT 20"
    ).all<any>()

    const { results: topHooks } = await db.prepare(
      "SELECT value, score FROM instagram_research WHERE kind='hook' ORDER BY score DESC LIMIT 10"
    ).all<any>()

    const { results: gaps } = await db.prepare(
      "SELECT value, score FROM instagram_research WHERE kind='content_gap' ORDER BY score DESC LIMIT 10"
    ).all<any>()

    const { results: recentPosts } = await db.prepare(`
      SELECT media_type, caption, engagement_rate, reach, like_count, comment_count, save_count
      FROM instagram_posts ORDER BY posted_at DESC LIMIT 30
    `).all<any>()

    // Build Gemini prompt
    const prompt = `You are a roofing industry Instagram content strategist. Generate exactly ${count} content ideas for a roofing company's Instagram account (@roofmanager).

## Context

### Top Performing Hashtags (by engagement score):
${(topHashtags || []).map((h: any) => `- ${h.value} (score: ${h.score})`).join('\n') || 'No data yet'}

### Winning Hooks from Competitors:
${(topHooks || []).map((h: any) => `- "${h.value}" (score: ${h.score})`).join('\n') || 'No data yet'}

### Content Gaps (topics competitors cover that we don't):
${(gaps || []).map((g: any) => `- ${g.value} (frequency score: ${g.score})`).join('\n') || 'No gaps found'}

### Our Recent Post Performance:
${(recentPosts || []).slice(0, 10).map((p: any) => `- ${p.media_type}: eng_rate=${p.engagement_rate}, reach=${p.reach}, "${(p.caption || '').slice(0, 60)}..."`).join('\n') || 'No posts yet'}

## Requirements
- Each idea must target one of these personas: homeowner-insurance-claim, new-roof-buyer, storm-damage-victim, commercial-property-manager, realtor-partner
- Each idea must fit one pillar: education, social-proof, storm-alert, offer, behind-the-scenes
- Include a predicted engagement score (0.0-1.0) based on how similar content has performed
- Include a predicted cost-per-lead in cents (CA$) based on typical roofing industry CPL
- Mix media types: REEL (60%), IMAGE (20%), CAROUSEL (20%)

Return ONLY valid JSON array with this structure (no markdown):
[{
  "title": "string",
  "angle": "the hook/narrative angle",
  "target_persona": "one of the 5 personas",
  "pillar": "one of the 5 pillars",
  "media_type": "REEL|IMAGE|CAROUSEL",
  "predicted_engagement": 0.0-1.0,
  "predicted_cpl_cents": number,
  "research_refs": ["hashtag or hook values that informed this idea"]
}]`

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 4000 },
      }),
    })

    const data = await res.json() as any
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]'
    const cleaned = text.replace(/```json\n?/g, '').replace(/```/g, '').trim()

    let ideas: any[]
    try {
      ideas = JSON.parse(cleaned)
    } catch {
      return { ok: false, ideas_generated: 0, error: 'Failed to parse Gemini response' }
    }

    if (!Array.isArray(ideas)) return { ok: false, ideas_generated: 0, error: 'Gemini returned non-array' }

    let ideas_generated = 0
    for (const idea of ideas.slice(0, count)) {
      const engagement = Math.max(0, Math.min(1, idea.predicted_engagement || 0.3))
      const cpl = Math.max(1, idea.predicted_cpl_cents || 5000)

      await db.prepare(`
        INSERT INTO instagram_content_ideas (title, angle, target_persona, pillar, predicted_engagement, predicted_cpl_cents, research_ref_json, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'idea')
      `).bind(
        idea.title || 'Untitled',
        idea.angle || '',
        idea.target_persona || 'homeowner-insurance-claim',
        idea.pillar || 'education',
        engagement,
        cpl,
        JSON.stringify(idea.research_refs || [])
      ).run()
      ideas_generated++
    }

    return { ok: true, ideas_generated }
  } catch (err: any) {
    return { ok: false, ideas_generated: 0, error: err.message }
  }
}

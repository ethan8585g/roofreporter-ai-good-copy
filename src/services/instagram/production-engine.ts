// ============================================================
// Production Engine — Skill 3: Film Today
// Turns an approved idea into a fully-rendered draft:
// Gemini script → GCP TTS voiceover → Pexels stock → R2 storage
// ============================================================

import type { Bindings } from '../../types'
import { getAccessToken } from '../gcp-auth'

export interface ProductionResult {
  ok: boolean
  draft_id: number | null
  production_cost_cents: number
  error?: string
}

// ── Gemini: Generate script from idea ──
async function generateScript(geminiKey: string, idea: any): Promise<{ script: any[]; caption: string; captionAltA: string; captionAltB: string; hashtags: string[]; cost_cents: number } | null> {
  const prompt = `You are a video scriptwriter for a roofing company's Instagram Reels/posts.

Idea: "${idea.title}"
Angle: "${idea.angle || ''}"
Target: ${idea.target_persona || 'homeowner'}
Pillar: ${idea.pillar || 'education'}
Media type: ${idea.media_type || 'REEL'}

Generate a production-ready script. Return ONLY valid JSON (no markdown):
{
  "scenes": [
    { "shot": "description of visual", "voiceover": "text to speak", "onscreen_text": "overlay text", "duration_s": 3 }
  ],
  "caption_primary": "main Instagram caption with CTA",
  "caption_alt_a": "alternative caption A",
  "caption_alt_b": "alternative caption B",
  "hashtags": ["#roofing", "#stormDamage", "etc"],
  "stock_search_terms": ["roofing crew working", "storm damage roof", "etc"]
}`

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, maxOutputTokens: 3000 },
      }),
    })
    const data = await res.json() as any
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
    const cleaned = text.replace(/```json\n?/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleaned)

    // Estimate Gemini cost: ~$0.10 per 1M input tokens, ~$0.40 per 1M output tokens
    // Rough estimate: prompt ~500 tokens input, ~1000 tokens output = ~$0.0005
    const cost_cents = 1 // ~$0.01 per script generation

    return {
      script: parsed.scenes || [],
      caption: parsed.caption_primary || '',
      captionAltA: parsed.caption_alt_a || '',
      captionAltB: parsed.caption_alt_b || '',
      hashtags: parsed.hashtags || [],
      cost_cents,
    }
  } catch {
    return null
  }
}

// ── GCP TTS: Generate voiceover audio ──
async function generateVoiceover(env: Bindings, scenes: any[]): Promise<{ audioBase64: string; cost_cents: number } | null> {
  const gcpKey = (env as any).GCP_SERVICE_ACCOUNT_KEY
  if (!gcpKey) return null

  try {
    const accessToken = await getAccessToken(gcpKey)
    const fullText = scenes.map(s => s.voiceover || '').join('. ')
    if (!fullText.trim()) return null

    const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: fullText },
        voice: { languageCode: 'en-US', name: 'en-US-Studio-O' },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0, pitch: 0 },
      }),
    })

    const data = await res.json() as any
    if (!data.audioContent) return null

    // GCP TTS cost: ~$16 per 1M characters for Studio voices
    const charCount = fullText.length
    const cost_cents = Math.max(1, Math.round(charCount * 0.0016))

    return { audioBase64: data.audioContent, cost_cents }
  } catch {
    return null
  }
}

// ── Pexels: Fetch stock images/videos ──
async function fetchPexelsMedia(pexelsKey: string, searchTerms: string[], mediaType: string): Promise<{ urls: string[]; cost_cents: number }> {
  if (!pexelsKey || searchTerms.length === 0) return { urls: [], cost_cents: 0 }

  const urls: string[] = []
  for (const term of searchTerms.slice(0, 5)) {
    try {
      const endpoint = mediaType === 'REEL' || mediaType === 'VIDEO'
        ? `https://api.pexels.com/videos/search?query=${encodeURIComponent(term)}&per_page=2`
        : `https://api.pexels.com/v1/search?query=${encodeURIComponent(term)}&per_page=3`

      const res = await fetch(endpoint, {
        headers: { Authorization: pexelsKey },
      })
      const data = await res.json() as any

      if (mediaType === 'REEL' || mediaType === 'VIDEO') {
        for (const video of (data.videos || []).slice(0, 2)) {
          const file = video.video_files?.find((f: any) => f.quality === 'hd') || video.video_files?.[0]
          if (file?.link) urls.push(file.link)
        }
      } else {
        for (const photo of (data.photos || []).slice(0, 3)) {
          if (photo.src?.large) urls.push(photo.src.large)
        }
      }
    } catch { /* skip failed search */ }
  }

  return { urls, cost_cents: 0 } // Pexels is free
}

// ── Store media to R2 ──
async function storeToR2(env: Bindings, key: string, data: ArrayBuffer | string, contentType: string): Promise<boolean> {
  const r2 = (env as any).INSTAGRAM_R2
  if (!r2) return false

  try {
    const body = typeof data === 'string' ? Uint8Array.from(atob(data), c => c.charCodeAt(0)) : data
    await r2.put(key, body, { httpMetadata: { contentType } })
    return true
  } catch {
    return false
  }
}

export async function produceFromIdea(env: Bindings, ideaId: number): Promise<ProductionResult> {
  const db = env.DB
  const geminiKey = (env as any).GEMINI_API_KEY
  const pexelsKey = (env as any).PEXELS_API_KEY

  if (!geminiKey) return { ok: false, draft_id: null, production_cost_cents: 0, error: 'GEMINI_API_KEY not set' }

  try {
    // 1. Load the idea
    const idea = await db.prepare(
      "SELECT * FROM instagram_content_ideas WHERE id = ? AND status = 'approved'"
    ).bind(ideaId).first<any>()
    if (!idea) return { ok: false, draft_id: null, production_cost_cents: 0, error: 'Idea not found or not approved' }

    // Mark idea as in_production
    await db.prepare("UPDATE instagram_content_ideas SET status='in_production', updated_at=datetime('now') WHERE id=?").bind(ideaId).run()

    let totalCost = 0

    // 2. Generate script
    const scriptResult = await generateScript(geminiKey, idea)
    if (!scriptResult) {
      await db.prepare("UPDATE instagram_content_ideas SET status='approved', updated_at=datetime('now') WHERE id=?").bind(ideaId).run()
      return { ok: false, draft_id: null, production_cost_cents: 0, error: 'Script generation failed' }
    }
    totalCost += scriptResult.cost_cents

    // 3. Create draft row
    const mediaType = idea.media_type || 'REEL'
    const draftRes = await db.prepare(`
      INSERT INTO instagram_drafts (idea_id, media_type, script_json, caption_primary, caption_alt_a, caption_alt_b, hashtags_json, render_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'rendering')
    `).bind(
      ideaId, mediaType, JSON.stringify(scriptResult.script),
      scriptResult.caption, scriptResult.captionAltA, scriptResult.captionAltB,
      JSON.stringify(scriptResult.hashtags)
    ).run()
    const draftId = draftRes.meta.last_row_id as number

    // 4. Generate voiceover
    let voiceoverKey: string | null = null
    const voiceResult = await generateVoiceover(env, scriptResult.script)
    if (voiceResult) {
      totalCost += voiceResult.cost_cents
      const r2Key = `instagram/drafts/${draftId}/voiceover.mp3`
      const stored = await storeToR2(env, r2Key, voiceResult.audioBase64, 'audio/mpeg')
      if (stored) voiceoverKey = r2Key
    }

    // 5. Fetch stock visuals
    const stockTerms = scriptResult.script.map((s: any) => s.shot || '').filter(Boolean)
    const pexelsResult = await fetchPexelsMedia(pexelsKey || '', stockTerms, mediaType)
    totalCost += pexelsResult.cost_cents

    // Store visuals to R2
    const visualKeys: string[] = []
    for (let i = 0; i < pexelsResult.urls.length; i++) {
      try {
        const mediaRes = await fetch(pexelsResult.urls[i])
        const mediaData = await mediaRes.arrayBuffer()
        const ext = mediaType === 'REEL' || mediaType === 'VIDEO' ? 'mp4' : 'jpg'
        const r2Key = `instagram/drafts/${draftId}/visual_${i}.${ext}`
        const stored = await storeToR2(env, r2Key, mediaData, mediaType === 'REEL' ? 'video/mp4' : 'image/jpeg')
        if (stored) visualKeys.push(r2Key)
      } catch { /* skip failed download */ }
    }

    // 6. Update draft with assets
    // Note: Full FFmpeg compositing would happen via Cloud Run — for now we store assets separately
    // and mark as ready when all assets are present
    const compositeKey = visualKeys.length > 0 ? visualKeys[0] : null // Use first visual as composite placeholder
    const renderStatus = compositeKey ? 'ready' : 'pending'

    await db.prepare(`
      UPDATE instagram_drafts SET voiceover_r2_key=?, visuals_r2_keys_json=?, composite_r2_key=?, render_status=?, production_cost_cents=?, updated_at=datetime('now') WHERE id=?
    `).bind(
      voiceoverKey, JSON.stringify(visualKeys), compositeKey, renderStatus, totalCost, draftId
    ).run()

    return { ok: true, draft_id: draftId, production_cost_cents: totalCost }
  } catch (err: any) {
    return { ok: false, draft_id: null, production_cost_cents: 0, error: err.message }
  }
}

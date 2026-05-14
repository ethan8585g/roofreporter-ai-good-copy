import type { Bindings } from '../types'
/**
 * Cold-call objection extractor — turns raw call transcripts into
 * structured `call_objections` rows so super admin can see "top 5
 * reasons people said no this month."
 *
 * Uses Gemini in JSON mode. Best-effort: every error is swallowed.
 */

type Db = D1Database

const VALID_CATEGORIES = [
  'price', 'timing', 'trust', 'competitor',
  'not_a_fit', 'not_decision_maker', 'already_have_solution',
  'feature_gap', 'budget', 'other'
] as const

interface ExtractedObjection {
  category: string
  objection_text: string
  raw_excerpt?: string
  sentiment?: 'negative' | 'neutral' | 'mixed'
}

interface ExtractContext {
  transcript: string
  call_outcome?: string | null
  caller_sentiment?: string | null
  room_name?: string | null
  prospect_id?: number | null
  agent_id?: number | null
  call_log_id?: number | null
  call_started_at?: string | null
}

const SYSTEM_PROMPT = `You analyze sales-call transcripts for a roofing-measurement SaaS. Your job is to identify the prospect's OBJECTIONS — reasons they pushed back or showed reluctance.

Rules:
- Only include genuine objections from the PROSPECT, not the agent.
- Skip pleasantries, scheduling friction, or "tell me more" curiosity.
- Each objection should be normalized into one short phrase ("too expensive", "already use EagleView", "not the decision maker").
- Pick the closest category from this fixed list: price, timing, trust, competitor, not_a_fit, not_decision_maker, already_have_solution, feature_gap, budget, other.
- Sentiment of the moment: negative (cold/dismissive), neutral (factual), or mixed (open but resistant).
- raw_excerpt = 1–3 sentences quoted from the transcript that contain the objection. Verbatim.
- If there are no objections at all, return an empty array.

Return ONLY a JSON array. No commentary.`

const OUTPUT_SCHEMA_HINT = `Return JSON like:
[
  { "category": "price", "objection_text": "too expensive for one-off jobs", "raw_excerpt": "$199 a report? That's more than the job sometimes.", "sentiment": "negative" }
]`

async function callGeminiJSON(apiKey: string, model: string, prompt: string, system: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { role: 'system', parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: 'application/json' },
    }),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data: any = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini empty response')
  return text
}

function safeParseObjections(raw: string): ExtractedObjection[] {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((o) => o && typeof o.objection_text === 'string' && o.objection_text.trim().length > 0)
      .map((o) => ({
        category: VALID_CATEGORIES.includes(o.category) ? o.category : 'other',
        objection_text: String(o.objection_text).slice(0, 280),
        raw_excerpt: o.raw_excerpt ? String(o.raw_excerpt).slice(0, 1000) : undefined,
        sentiment: ['negative', 'neutral', 'mixed'].includes(o.sentiment) ? o.sentiment : undefined,
      }))
  } catch {
    return []
  }
}

/**
 * Extract objections from a transcript and persist them to call_objections.
 * Returns the number of rows written.
 */
export async function extractAndStoreObjections(env: Bindings, db: Db, ctx: ExtractContext): Promise<number> {
  if (!ctx.transcript || ctx.transcript.trim().length < 60) return 0
  const apiKey = env.GEMINI_API_KEY || env.GEMINI_ENHANCE_API_KEY || env.GOOGLE_VERTEX_API_KEY
  if (!apiKey) {
    console.warn('[objection-extractor] no Gemini API key configured')
    return 0
  }

  // Truncate to keep cost bounded — we only need the prospect's pushback,
  // not a long preamble.
  const transcript = ctx.transcript.length > 12000 ? ctx.transcript.slice(-12000) : ctx.transcript
  const userPrompt = `${OUTPUT_SCHEMA_HINT}\n\nCall outcome: ${ctx.call_outcome || 'unknown'}\nCaller sentiment: ${ctx.caller_sentiment || 'unknown'}\n\nTranscript:\n${transcript}`

  let raw: string
  try {
    raw = await callGeminiJSON(apiKey, 'gemini-2.0-flash', userPrompt, SYSTEM_PROMPT)
  } catch (e: any) {
    console.warn('[objection-extractor] Gemini call failed:', e?.message)
    return 0
  }

  const objections = safeParseObjections(raw)
  if (objections.length === 0) return 0

  let written = 0
  for (const o of objections) {
    try {
      await db.prepare(`
        INSERT INTO call_objections
          (call_log_id, prospect_id, agent_id, room_name,
           category, objection_text, raw_excerpt, sentiment,
           call_outcome, call_started_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        ctx.call_log_id || null,
        ctx.prospect_id || null,
        ctx.agent_id || null,
        ctx.room_name || null,
        o.category,
        o.objection_text,
        o.raw_excerpt || null,
        o.sentiment || null,
        ctx.call_outcome || null,
        ctx.call_started_at || null,
      ).run()
      written++
    } catch (e: any) {
      console.warn('[objection-extractor] insert failed:', e?.message)
    }
  }
  return written
}
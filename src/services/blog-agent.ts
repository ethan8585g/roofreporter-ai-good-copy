/**
 * Blog Content Agent — SEO/GEO autonomous content generation
 *
 * Pipeline: pick keyword → draft (Gemini) → quality gate (Gemini) → publish or retry.
 * Triggered on-demand via /api/blog/admin/agent/run, or on cron via /api/blog/cron/run.
 *
 * Swap MODEL_ENDPOINT or implement callAnthropic() to switch generators.
 */

import type { Bindings } from '../types'

const MODEL_DRAFT = 'gemini-2.0-flash-exp'
const MODEL_GATE = 'gemini-2.0-flash-exp'
const QUALITY_THRESHOLD = 72      // 0-100, below this → retry or mark failed
const MAX_ATTEMPTS = 2
const LOCK_MINUTES = 10

export interface QueueRow {
  id: number
  keyword: string
  geo_modifier: string | null
  intent: string
  target_category: string
  attempts: number
}

export interface DraftOutput {
  title: string
  slug: string
  excerpt: string
  meta_title: string
  meta_description: string
  content_html: string          // full article with FAQ + schema.org JSON-LD inline
  tags: string[]
  read_time_minutes: number
}

export interface QualityScore {
  overall: number
  eeat: number
  keyword_fit: number
  readability: number
  schema_present: boolean
  internal_links: number
  issues: string[]
}

// ---------- Queue management ----------

export async function seedDefaultKeywords(db: D1Database): Promise<number> {
  const seeds: Array<[string, string | null, string]> = [
    ['roof replacement cost', 'Toronto', 'commercial'],
    ['hail damage inspection', 'Calgary', 'local'],
    ['flat roof repair', 'Vancouver', 'informational'],
    ['metal vs asphalt shingles', null, 'comparison'],
    ['ice dam prevention', 'Ottawa', 'informational'],
    ['best roofing contractor', 'Edmonton', 'local'],
    ['roof inspection checklist', null, 'informational'],
    ['storm damage roof insurance claim', 'Winnipeg', 'commercial'],
    ['cedar shake vs composite', null, 'comparison'],
    ['roof ventilation problems', 'Montreal', 'informational'],
    ['solar panel roof compatibility', 'Mississauga', 'commercial'],
    ['emergency roof repair', 'Hamilton', 'local'],
  ]
  let inserted = 0
  for (const [kw, geo, intent] of seeds) {
    try {
      await db.prepare(
        `INSERT OR IGNORE INTO blog_keyword_queue (keyword, geo_modifier, intent) VALUES (?, ?, ?)`
      ).bind(kw, geo, intent).run()
      inserted++
    } catch { /* ignore dupes */ }
  }
  return inserted
}

export async function pickNextKeyword(db: D1Database): Promise<QueueRow | null> {
  const lockUntil = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString()
  // Claim the highest-priority pending row not currently locked
  const row = await db.prepare(
    `SELECT id, keyword, geo_modifier, intent, target_category, attempts
     FROM blog_keyword_queue
     WHERE status = 'pending'
       AND (locked_until IS NULL OR locked_until < datetime('now'))
       AND attempts < ?
     ORDER BY priority ASC, id ASC
     LIMIT 1`
  ).bind(MAX_ATTEMPTS).first<QueueRow>()
  if (!row) return null
  await db.prepare(
    `UPDATE blog_keyword_queue SET locked_until = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(lockUntil, row.id).run()
  return row
}

// ---------- Generation ----------

function buildDraftPrompt(row: QueueRow): string {
  const geo = row.geo_modifier ? ` in ${row.geo_modifier}` : ''
  const brand = `Roof Manager (roofmanager.ca) — AI-powered roofing measurement + quoting platform.`
  return `You are an expert SEO/GEO content writer for ${brand}
Write a 1200-1800 word blog article targeting the keyword "${row.keyword}"${geo}.
Intent: ${row.intent}. Audience: homeowners and small roofing contractors.

Requirements:
- Natural keyword usage (2-4% density, no stuffing).
- Structured for Generative Engine Optimization: clear H2/H3 hierarchy, factual claims, short declarative sentences that LLMs can cite.
- Include at least 3 internal links to /services, /quote, and /pricing (use <a href="/services">...</a>).
- Include a 5-question FAQ section at the bottom.
- Embed schema.org JSON-LD for BlogPosting AND FAQPage as a single <script type="application/ld+json"> block at the end.
- No fluff, no "In today's world" intros. Start with a concrete hook.
${row.geo_modifier ? `- Mention ${row.geo_modifier}-specific roofing factors (climate, building codes, pricing norms).` : ''}

Return STRICT JSON only, no markdown fences:
{
  "title": "...",
  "slug": "kebab-case-slug",
  "excerpt": "1-2 sentence meta-description-style summary",
  "meta_title": "max 60 chars, keyword-forward",
  "meta_description": "max 155 chars",
  "content_html": "<article>...full HTML with H2/H3, paragraphs, FAQ, JSON-LD script...</article>",
  "tags": ["tag1","tag2","tag3"],
  "read_time_minutes": 7
}`
}

function buildGatePrompt(row: QueueRow, draft: DraftOutput): string {
  return `You are an SEO quality auditor. Score this draft targeting keyword "${row.keyword}"${row.geo_modifier ? ` (${row.geo_modifier})` : ''}.

Draft title: ${draft.title}
Draft excerpt: ${draft.excerpt}
Content length: ${draft.content_html.length} chars
Content preview: ${draft.content_html.slice(0, 2000)}...

Evaluate on 0-100 scale:
- eeat: Experience/Expertise/Authority/Trust signals (concrete facts, stats, author voice)
- keyword_fit: natural keyword placement, semantic coverage, no stuffing
- readability: short paragraphs, scannable, clear H2/H3
- schema_present: boolean — is there a <script type="application/ld+json"> block?
- internal_links: count of <a href="/...> internal links

Return STRICT JSON:
{
  "overall": 0-100,
  "eeat": 0-100,
  "keyword_fit": 0-100,
  "readability": 0-100,
  "schema_present": true|false,
  "internal_links": 0,
  "issues": ["short list of concrete problems, empty if none"]
}`
}

async function callGemini(apiKey: string, model: string, prompt: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 8192, responseMimeType: 'application/json' },
    }),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
  const data: any = await res.json()
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Gemini returned empty content')
  return text
}

function extractJson<T>(text: string): T {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  return JSON.parse(cleaned) as T
}

export async function generateDraft(env: Bindings, row: QueueRow): Promise<DraftOutput> {
  const key = env.GEMINI_API_KEY || env.GEMINI_ENHANCE_API_KEY || env.GOOGLE_VERTEX_API_KEY
  if (!key) throw new Error('No Gemini API key configured')
  const raw = await callGemini(key, MODEL_DRAFT, buildDraftPrompt(row))
  const draft = extractJson<DraftOutput>(raw)
  if (!draft.title || !draft.content_html || !draft.slug) {
    throw new Error('Draft missing required fields')
  }
  return draft
}

export async function scoreDraft(env: Bindings, row: QueueRow, draft: DraftOutput): Promise<QualityScore> {
  const key = env.GEMINI_API_KEY || env.GEMINI_ENHANCE_API_KEY || env.GOOGLE_VERTEX_API_KEY
  if (!key) throw new Error('No Gemini API key configured')
  const raw = await callGemini(key, MODEL_GATE, buildGatePrompt(row, draft))
  return extractJson<QualityScore>(raw)
}

// ---------- Publishing ----------

async function publishDraft(db: D1Database, draft: DraftOutput, row: QueueRow): Promise<number> {
  // Ensure unique slug
  let slug = draft.slug
  const existing = await db.prepare(`SELECT id FROM blog_posts WHERE slug = ?`).bind(slug).first()
  if (existing) slug = `${slug}-${Date.now().toString(36)}`

  const result = await db.prepare(
    `INSERT INTO blog_posts
      (slug, title, excerpt, content, cover_image_url, category, tags, meta_title, meta_description, status, read_time_minutes, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, datetime('now'))`
  ).bind(
    slug,
    draft.title,
    draft.excerpt,
    draft.content_html,
    null,
    row.target_category || 'roofing',
    (draft.tags || []).join(','),
    draft.meta_title,
    draft.meta_description,
    draft.read_time_minutes || 7,
  ).run()
  return (result.meta as any)?.last_row_id as number
}

async function logEvent(db: D1Database, ev: {
  queue_id: number
  post_id?: number | null
  stage: string
  model?: string
  quality_score?: number | null
  quality_breakdown?: any
  passed_gate?: boolean
  duration_ms?: number
  error?: string
}) {
  await db.prepare(
    `INSERT INTO blog_generation_log (queue_id, post_id, stage, model, quality_score, quality_breakdown, passed_gate, duration_ms, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    ev.queue_id,
    ev.post_id ?? null,
    ev.stage,
    ev.model ?? null,
    ev.quality_score ?? null,
    ev.quality_breakdown ? JSON.stringify(ev.quality_breakdown) : null,
    ev.passed_gate ? 1 : 0,
    ev.duration_ms ?? null,
    ev.error ?? null,
  ).run()
}

// ---------- Orchestrator ----------

export interface RunResult {
  ok: boolean
  queue_id?: number
  post_id?: number
  keyword?: string
  quality?: QualityScore
  error?: string
  skipped?: boolean
}

export async function runOnce(env: Bindings): Promise<RunResult> {
  const db = env.DB
  const row = await pickNextKeyword(db)
  if (!row) return { ok: false, skipped: true, error: 'queue empty' }

  const started = Date.now()
  try {
    const draft = await generateDraft(env, row)
    await logEvent(db, { queue_id: row.id, stage: 'draft', model: MODEL_DRAFT, duration_ms: Date.now() - started })

    const score = await scoreDraft(env, row, draft)
    const passed = score.overall >= QUALITY_THRESHOLD && score.schema_present && score.internal_links >= 2

    await logEvent(db, {
      queue_id: row.id,
      stage: 'quality_gate',
      model: MODEL_GATE,
      quality_score: score.overall,
      quality_breakdown: score,
      passed_gate: passed,
    })

    if (!passed) {
      const newAttempts = row.attempts + 1
      const status = newAttempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
      await db.prepare(
        `UPDATE blog_keyword_queue SET attempts = ?, status = ?, last_error = ?, locked_until = NULL, updated_at = datetime('now') WHERE id = ?`
      ).bind(newAttempts, status, `quality ${score.overall} issues: ${(score.issues || []).join('; ')}`, row.id).run()
      return { ok: false, queue_id: row.id, keyword: row.keyword, quality: score, error: 'below quality threshold' }
    }

    const postId = await publishDraft(db, draft, row)
    await db.prepare(
      `UPDATE blog_keyword_queue SET status = 'published', post_id = ?, locked_until = NULL, updated_at = datetime('now') WHERE id = ?`
    ).bind(postId, row.id).run()
    await logEvent(db, { queue_id: row.id, post_id: postId, stage: 'publish', quality_score: score.overall, passed_gate: true })

    return { ok: true, queue_id: row.id, post_id: postId, keyword: row.keyword, quality: score }
  } catch (e: any) {
    const newAttempts = row.attempts + 1
    const status = newAttempts >= MAX_ATTEMPTS ? 'failed' : 'pending'
    await db.prepare(
      `UPDATE blog_keyword_queue SET attempts = ?, status = ?, last_error = ?, locked_until = NULL, updated_at = datetime('now') WHERE id = ?`
    ).bind(newAttempts, status, e.message?.slice(0, 500), row.id).run()
    await logEvent(db, { queue_id: row.id, stage: 'error', error: e.message?.slice(0, 500) })
    return { ok: false, queue_id: row.id, keyword: row.keyword, error: e.message }
  }
}

// ============================================================
// Content Agent — Autonomous SEO blog post generation
// Powered by Anthropic Claude (claude-sonnet-4-6)
// Pipeline: pick keyword → draft → quality gate → publish
// ============================================================

import type { Bindings } from '../types'
import { getAnthropicClient, CLAUDE_MODEL, extractJson } from './anthropic-client'
import { pickNextKeyword, type QueueRow, type DraftOutput, type QualityScore } from './blog-agent'

export const CONTENT_QUALITY_THRESHOLD = 72
export const CONTENT_MAX_ATTEMPTS = 2

export interface ContentRunResult {
  ok: boolean
  skipped?: boolean
  keyword?: string
  queue_id?: number
  post_id?: number
  quality?: QualityScore
  error?: string
  duration_ms: number
}

// ── Prompt builders (exported for testing) ───────────────────

export function buildContentPrompt(row: QueueRow): string {
  const geo = row.geo_modifier ? ` in ${row.geo_modifier}` : ''
  return `You are an expert SEO/GEO content writer for Roof Manager (roofmanager.ca) — roof measurement and roofer CRM software for contractors and property managers across the US and Canada.

Never write "AI-powered" or "AI-driven" — describe specific capabilities instead (satellite measurement, voice receptionist, Gemini vision analysis, etc.).

Write a 1200-1800 word blog article targeting the keyword "${row.keyword}"${geo}.
Intent: ${row.intent}. Target audience: Canadian homeowners and roofing contractors.

Requirements:
- Natural keyword usage (2-4% density, no stuffing).
- Structured for Generative Engine Optimization: clear H2/H3 hierarchy, short declarative sentences LLMs can cite.
- Include at least 3 internal links: <a href="/services">...</a>, <a href="/quote">...</a>, <a href="/pricing">...</a>.
- Include a 5-question FAQ section at the bottom.
- Embed schema.org JSON-LD for BlogPosting AND FAQPage in a single <script type="application/ld+json"> block at the end.
- No fluff, no "In today's world" intros. Start with a concrete hook.
- Mention Canadian pricing in CAD where relevant.${row.geo_modifier ? `\n- Include ${row.geo_modifier}-specific factors (climate, local building codes, pricing norms).` : ''}

Return STRICT JSON only — no markdown fences, no commentary:
{
  "title": "...",
  "slug": "kebab-case-slug",
  "excerpt": "1-2 sentence summary (meta description quality)",
  "meta_title": "max 60 chars, keyword-forward",
  "meta_description": "max 155 chars",
  "content_html": "<article>...full HTML with H2/H3, paragraphs, FAQ, JSON-LD script...</article>",
  "tags": ["tag1","tag2","tag3"],
  "read_time_minutes": 7
}`
}

export function buildQualityPrompt(row: QueueRow, draft: DraftOutput): string {
  return `You are an SEO quality auditor. Score this draft targeting keyword "${row.keyword}"${row.geo_modifier ? ` (${row.geo_modifier})` : ''}.

Draft title: ${draft.title}
Draft excerpt: ${draft.excerpt}
Content length: ${draft.content_html.length} chars
Content preview:
${draft.content_html.slice(0, 2500)}

Evaluate on 0-100 scale:
- eeat: Experience/Expertise/Authority/Trust (concrete facts, stats, author credibility signals)
- keyword_fit: natural keyword placement, semantic coverage, no stuffing
- readability: short paragraphs, scannable, clear heading hierarchy
- schema_present: boolean — does the content contain a JSON-LD script block?
- internal_links: count of <a href="/..."> internal links present

Return STRICT JSON only:
{
  "overall": 0,
  "eeat": 0,
  "keyword_fit": 0,
  "readability": 0,
  "schema_present": false,
  "internal_links": 0,
  "issues": []
}`
}

// ── JSON parsing helpers (exported for testing) ───────────────

export function parseDraft(text: string): DraftOutput {
  const draft = extractJson<DraftOutput>(text)
  if (!draft.title || !draft.content_html || !draft.slug) {
    throw new Error(`Draft missing required fields. Got keys: ${Object.keys(draft).join(', ')}`)
  }
  return draft
}

export function parseQualityScore(text: string): QualityScore {
  const score = extractJson<QualityScore>(text)
  // Clamp numeric fields to 0-100
  score.overall = Math.max(0, Math.min(100, Number(score.overall) || 0))
  score.eeat = Math.max(0, Math.min(100, Number(score.eeat) || 0))
  score.keyword_fit = Math.max(0, Math.min(100, Number(score.keyword_fit) || 0))
  score.readability = Math.max(0, Math.min(100, Number(score.readability) || 0))
  score.internal_links = Math.max(0, Number(score.internal_links) || 0)
  score.schema_present = Boolean(score.schema_present)
  score.issues = Array.isArray(score.issues) ? score.issues : []
  return score
}

// ── Publish helper (internal) ─────────────────────────────────

async function publishPost(db: D1Database, draft: DraftOutput, row: QueueRow): Promise<number> {
  let slug = draft.slug
  const existing = await db.prepare(`SELECT id FROM blog_posts WHERE slug = ?`).bind(slug).first()
  if (existing) slug = `${slug}-${Date.now().toString(36)}`

  const result = await db.prepare(
    `INSERT INTO blog_posts
      (slug, title, excerpt, content, category, tags, meta_title, meta_description,
       status, read_time_minutes, author_name, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, 'AI Content Agent', datetime('now'))`
  ).bind(
    slug, draft.title, draft.excerpt, draft.content_html,
    row.target_category || 'roofing',
    (draft.tags || []).join(','),
    draft.meta_title, draft.meta_description,
    draft.read_time_minutes || 7,
  ).run()
  return (result.meta as any)?.last_row_id as number
}

// ── Mark keyword as done/failed ───────────────────────────────

async function markKeyword(db: D1Database, id: number, status: 'published' | 'failed'): Promise<void> {
  await db.prepare(
    `UPDATE blog_keyword_queue SET status = ?, locked_until = NULL, updated_at = datetime('now') WHERE id = ?`
  ).bind(status, id).run()
}

// ── Main orchestrator ─────────────────────────────────────────

export async function runContentAgent(env: Bindings): Promise<ContentRunResult> {
  const start = Date.now()

  if (!env.ANTHROPIC_API_KEY) {
    return { ok: false, error: 'ANTHROPIC_API_KEY not configured', duration_ms: 0 }
  }

  const row = await pickNextKeyword(env.DB)
  if (!row) {
    return { ok: true, skipped: true, duration_ms: Date.now() - start }
  }

  const client = getAnthropicClient(env.ANTHROPIC_API_KEY)
  let lastError = ''
  let quality: QualityScore | undefined

  for (let attempt = 1; attempt <= CONTENT_MAX_ATTEMPTS; attempt++) {
    try {
      // Step 1: Generate draft
      const draftMsg = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 8192,
        messages: [{ role: 'user', content: buildContentPrompt(row) }],
      })
      const draftText = draftMsg.content[0].type === 'text' ? draftMsg.content[0].text : ''
      const draft = parseDraft(draftText)

      // Step 2: Quality gate
      const scoreMsg = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: buildQualityPrompt(row, draft) }],
      })
      const scoreText = scoreMsg.content[0].type === 'text' ? scoreMsg.content[0].text : ''
      quality = parseQualityScore(scoreText)

      if (quality.overall >= CONTENT_QUALITY_THRESHOLD || attempt === CONTENT_MAX_ATTEMPTS) {
        const postId = await publishPost(env.DB, draft, row)
        await markKeyword(env.DB, row.id, 'published')
        return {
          ok: true,
          keyword: row.keyword,
          queue_id: row.id,
          post_id: postId,
          quality,
          duration_ms: Date.now() - start,
        }
      }
      // Low quality — retry
      lastError = `Quality ${quality.overall} below threshold ${CONTENT_QUALITY_THRESHOLD} (attempt ${attempt})`
    } catch (err: any) {
      lastError = err.message || String(err)
      if (attempt === CONTENT_MAX_ATTEMPTS) break
    }
  }

  await markKeyword(env.DB, row.id, 'failed')
  return {
    ok: false,
    keyword: row.keyword,
    queue_id: row.id,
    quality,
    error: lastError,
    duration_ms: Date.now() - start,
  }
}

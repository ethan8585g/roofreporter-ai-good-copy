/**
 * Blog Content Agent — SEO/GEO autonomous content generation
 *
 * Pipeline: pick keyword → draft (Gemini) → quality gate (Gemini) → publish or retry.
 * Triggered on-demand via /api/blog/admin/agent/run, or on cron via /api/blog/cron/run.
 *
 * Swap MODEL_ENDPOINT or implement callAnthropic() to switch generators.
 */

import type { Bindings } from '../types'

const MODEL_DRAFT = 'gemini-2.5-flash'
const MODEL_GATE = 'gemini-2.5-flash'
const BANNED_PHRASES = [
  'ai-powered', 'ai powered', 'ai-driven', 'ai driven',
  'revolutionize', 'revolutionary', 'game-changer', 'game changer',
  'unlock', 'empower', 'cutting-edge', 'next-generation', 'next generation',
  'in today\'s world', 'in the modern era',
]
const ALLOWED_INTERNAL_PATHS = [
  '/features/measurements', '/features/crm', '/features/ai-secretary', '/features/virtual-try-on',
  '/tools/pitch-calculator', '/tools/material-estimator', '/tools/shingle-calculator',
  '/tools/insurance-deductible-estimator', '/tools/solar-production-estimator',
  '/pricing', '/services', '/help', '/blog', '/contact', '/sample-report', '/get-started',
]
const QUALITY_THRESHOLD = 74      // 0-100, raised from 72. GEO-optimized articles require higher baseline.
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
  // Expanded US-first keyword seeds (200+). Canadian seeds retained at bottom.
  // Format: [keyword, geo_modifier | null, intent, market]
  const seeds: Array<[string, string | null, string, string]> = [
    // ── US Commercial / Roof Replacement Cost (50 states) ──────────────────
    ['roof replacement cost', 'Texas', 'commercial', 'us'],
    ['roof replacement cost', 'Florida', 'commercial', 'us'],
    ['roof replacement cost', 'Colorado', 'commercial', 'us'],
    ['roof replacement cost', 'Arizona', 'commercial', 'us'],
    ['roof replacement cost', 'Georgia', 'commercial', 'us'],
    ['roof replacement cost', 'North Carolina', 'commercial', 'us'],
    ['roof replacement cost', 'Ohio', 'commercial', 'us'],
    ['roof replacement cost', 'Illinois', 'commercial', 'us'],
    ['roof replacement cost', 'Tennessee', 'commercial', 'us'],
    ['roof replacement cost', 'Virginia', 'commercial', 'us'],
    ['roof replacement cost', 'Nevada', 'commercial', 'us'],
    ['roof replacement cost', 'Oklahoma', 'commercial', 'us'],
    ['roof replacement cost', 'Kansas', 'commercial', 'us'],
    ['roof replacement cost', 'Nebraska', 'commercial', 'us'],
    ['roof replacement cost', 'Missouri', 'commercial', 'us'],
    ['roof replacement cost', 'Minnesota', 'commercial', 'us'],
    ['roof replacement cost', 'Wisconsin', 'commercial', 'us'],
    ['roof replacement cost', 'Indiana', 'commercial', 'us'],
    ['roof replacement cost', 'Michigan', 'commercial', 'us'],
    ['roof replacement cost', 'Pennsylvania', 'commercial', 'us'],
    ['roof replacement cost', 'New York', 'commercial', 'us'],
    ['roof replacement cost', 'Maryland', 'commercial', 'us'],
    ['roof replacement cost', 'Louisiana', 'commercial', 'us'],
    ['roof replacement cost', 'South Carolina', 'commercial', 'us'],
    ['roof replacement cost', 'Alabama', 'commercial', 'us'],
    // ── Hail Damage / Insurance (hail belt states) ──────────────────────────
    ['hail damage roof repair', 'Colorado', 'commercial', 'us'],
    ['hail damage roof repair', 'Texas', 'commercial', 'us'],
    ['hail damage roof repair', 'Oklahoma', 'commercial', 'us'],
    ['hail damage roof repair', 'Kansas', 'commercial', 'us'],
    ['hail damage roof repair', 'Nebraska', 'commercial', 'us'],
    ['hail damage roof repair', 'Minnesota', 'commercial', 'us'],
    ['hail damage roof repair', 'Missouri', 'commercial', 'us'],
    ['hail damage roof repair', 'Illinois', 'commercial', 'us'],
    ['hail damage roof repair', 'Iowa', 'commercial', 'us'],
    ['hail damage roof repair', 'South Dakota', 'commercial', 'us'],
    ['hail damage roof repair', 'North Dakota', 'commercial', 'us'],
    // ── Insurance Claims (all 50) ────────────────────────────────────────────
    ['insurance claim roof replacement', 'Texas', 'commercial', 'us'],
    ['insurance claim roof replacement', 'Florida', 'commercial', 'us'],
    ['insurance claim roof replacement', 'Colorado', 'commercial', 'us'],
    ['insurance claim roof replacement', 'North Carolina', 'commercial', 'us'],
    ['insurance claim roof replacement', 'Georgia', 'commercial', 'us'],
    ['insurance claim roof replacement', 'Louisiana', 'commercial', 'us'],
    ['insurance claim roof replacement', 'Oklahoma', 'commercial', 'us'],
    ['insurance claim roof replacement', 'Missouri', 'commercial', 'us'],
    // ── Informational / Hurricanes ───────────────────────────────────────────
    ['how to file hurricane roof damage claim', 'Florida', 'informational', 'us'],
    ['how to file hurricane roof damage claim', 'Louisiana', 'informational', 'us'],
    ['how to file hurricane roof damage claim', 'North Carolina', 'informational', 'us'],
    ['how to file hurricane roof damage claim', 'South Carolina', 'informational', 'us'],
    ['how to file hurricane roof damage claim', 'Georgia', 'informational', 'us'],
    ['how to file hurricane roof damage claim', 'Texas', 'informational', 'us'],
    // ── Insurance Carriers ───────────────────────────────────────────────────
    ['what does State Farm cover for roof damage', null, 'informational', 'us'],
    ['what does Allstate cover for roof damage', null, 'informational', 'us'],
    ['what does USAA cover for roof damage', null, 'informational', 'us'],
    ['what does Farmers Insurance cover for roof damage', null, 'informational', 'us'],
    ['what does Progressive cover for roof damage', null, 'informational', 'us'],
    ['what does Liberty Mutual cover for roof damage', null, 'informational', 'us'],
    ['what does Travelers Insurance cover for roof damage', null, 'informational', 'us'],
    ['what does Nationwide cover for roof damage', null, 'informational', 'us'],
    // ── Building Codes ───────────────────────────────────────────────────────
    ['Texas building code requirements for new roofs', 'Texas', 'informational', 'us'],
    ['Florida building code requirements for new roofs', 'Florida', 'informational', 'us'],
    ['Colorado building code requirements for new roofs', 'Colorado', 'informational', 'us'],
    ['California building code requirements for new roofs', 'California', 'informational', 'us'],
    ['IRC 2024 roofing changes', null, 'informational', 'us'],
    ['IBC 2024 roofing changes', null, 'informational', 'us'],
    ['Florida Building Code roofing requirements', 'Florida', 'informational', 'us'],
    ['Texas windstorm insurance roofing requirements', 'Texas', 'informational', 'us'],
    // ── Xactimate / Adjuster Workflow ───────────────────────────────────────
    ['how to read an Xactimate roof estimate', null, 'informational', 'us'],
    ['Xactimate roof measurement line items explained', null, 'informational', 'us'],
    ['how to document roof damage for insurance adjuster', null, 'informational', 'us'],
    // ── Material Comparisons (US states) ─────────────────────────────────────
    ['metal roof vs asphalt shingles', 'Texas', 'comparison', 'us'],
    ['metal roof vs asphalt shingles', 'Florida', 'comparison', 'us'],
    ['metal roof vs asphalt shingles', 'Colorado', 'comparison', 'us'],
    ['metal roof vs asphalt shingles', 'Arizona', 'comparison', 'us'],
    ['clay tile vs asphalt shingles', 'Arizona', 'comparison', 'us'],
    ['clay tile vs asphalt shingles', 'Florida', 'comparison', 'us'],
    ['Class 4 impact resistant shingles worth it', 'Colorado', 'informational', 'us'],
    ['Class 4 impact resistant shingles worth it', 'Texas', 'informational', 'us'],
    ['Class 4 impact resistant shingles worth it', 'Oklahoma', 'informational', 'us'],
    // ── Solar Roofing ─────────────────────────────────────────────────────────
    ['solar roof tax credit 2026', 'Texas', 'informational', 'us'],
    ['solar roof tax credit 2026', 'California', 'informational', 'us'],
    ['solar roof tax credit 2026', 'Florida', 'informational', 'us'],
    ['solar panel roof compatibility guide', null, 'informational', 'us'],
    ['FEMA hazard mitigation roof grants', null, 'informational', 'us'],
    // ── Competitor Comparisons ───────────────────────────────────────────────
    ['EagleView alternative for US contractors', null, 'comparison', 'us'],
    ['EagleView vs satellite roof measurement cost', null, 'comparison', 'us'],
    ['Hover alternative roofing software', null, 'comparison', 'us'],
    ['Roofr alternative for roofing contractors', null, 'comparison', 'us'],
    ['RoofSnap alternative 2026', null, 'comparison', 'us'],
    ['AccuLynx alternative roofing CRM', null, 'comparison', 'us'],
    ['JobNimbus vs Roof Manager', null, 'comparison', 'us'],
    ['CompanyCam alternative roofing software', null, 'comparison', 'us'],
    ['PitchGauge vs satellite roof measurement', null, 'comparison', 'us'],
    ['cheapest roof measurement software for contractors', null, 'comparison', 'us'],
    // ── Local / City Intent (top US metros) ─────────────────────────────────
    ['best roofing software for contractors', 'Houston', 'local', 'us'],
    ['best roofing software for contractors', 'Dallas', 'local', 'us'],
    ['best roofing software for contractors', 'Denver', 'local', 'us'],
    ['best roofing software for contractors', 'Atlanta', 'local', 'us'],
    ['best roofing software for contractors', 'Phoenix', 'local', 'us'],
    ['best roofing software for contractors', 'Charlotte', 'local', 'us'],
    ['best roofing software for contractors', 'Nashville', 'local', 'us'],
    ['best roofing software for contractors', 'Tampa', 'local', 'us'],
    ['best roofing software for contractors', 'Orlando', 'local', 'us'],
    ['best roofing software for contractors', 'Kansas City', 'local', 'us'],
    ['best roofing software for contractors', 'Oklahoma City', 'local', 'us'],
    ['best roofing software for contractors', 'San Antonio', 'local', 'us'],
    ['best roofing software for contractors', 'Indianapolis', 'local', 'us'],
    ['best roofing software for contractors', 'Minneapolis', 'local', 'us'],
    ['best roofing software for contractors', 'Columbus', 'local', 'us'],
    ['roof measurement app', 'Texas', 'local', 'us'],
    ['roof measurement app', 'Florida', 'local', 'us'],
    ['roof measurement app', 'Colorado', 'local', 'us'],
    ['satellite roof measurement', 'Houston', 'local', 'us'],
    ['satellite roof measurement', 'Dallas', 'local', 'us'],
    ['satellite roof measurement', 'Denver', 'local', 'us'],
    ['satellite roof measurement', 'Miami', 'local', 'us'],
    ['satellite roof measurement', 'Atlanta', 'local', 'us'],
    ['satellite roof measurement', 'Phoenix', 'local', 'us'],
    ['satellite roof measurement', 'Chicago', 'local', 'us'],
    ['satellite roof measurement', 'Minneapolis', 'local', 'us'],
    ['satellite roof measurement', 'Omaha', 'local', 'us'],
    ['satellite roof measurement', 'Wichita', 'local', 'us'],
    ['satellite roof measurement', 'Oklahoma City', 'local', 'us'],
    // ── Storm-season content ─────────────────────────────────────────────────
    ['hurricane season roof prep checklist', 'Florida', 'informational', 'us'],
    ['hurricane season roof prep checklist', 'Texas', 'informational', 'us'],
    ['hail season roof prep checklist', 'Colorado', 'informational', 'us'],
    ['tornado season roof damage documentation', 'Oklahoma', 'informational', 'us'],
    ['tornado season roof damage documentation', 'Kansas', 'informational', 'us'],
    ['how to tarp a roof after storm damage', null, 'informational', 'us'],
    ['how long does insurance have to settle roof claim', null, 'informational', 'us'],
    ['public adjuster vs roofing contractor insurance claim', null, 'informational', 'us'],
    ['roof insurance claim denied what to do', null, 'informational', 'us'],
    ['ACV vs RCV roof insurance settlement', null, 'informational', 'us'],
    // ── Canadian seeds (retained — CA market) ────────────────────────────────
    ['roof replacement cost', 'Toronto', 'commercial', 'ca'],
    ['hail damage inspection', 'Calgary', 'local', 'ca'],
    ['flat roof repair', 'Vancouver', 'informational', 'ca'],
    ['metal vs asphalt shingles', null, 'comparison', 'ca'],
    ['ice dam prevention', 'Ottawa', 'informational', 'ca'],
    ['best roofing contractor', 'Edmonton', 'local', 'ca'],
    ['roof inspection checklist', null, 'informational', 'both'],
    ['storm damage roof insurance claim', 'Winnipeg', 'commercial', 'ca'],
    ['cedar shake vs composite', null, 'comparison', 'ca'],
    ['roof ventilation problems', 'Montreal', 'informational', 'ca'],
    ['solar panel roof compatibility', 'Mississauga', 'commercial', 'ca'],
    ['emergency roof repair', 'Hamilton', 'local', 'ca'],
  ]
  let inserted = 0
  for (const [kw, geo, intent, market] of seeds) {
    try {
      // Try inserting with market column first; fall back gracefully if column doesn't exist yet
      try {
        await db.prepare(
          `INSERT OR IGNORE INTO blog_keyword_queue (keyword, geo_modifier, intent, market) VALUES (?, ?, ?, ?)`
        ).bind(kw, geo, intent, market).run()
      } catch {
        await db.prepare(
          `INSERT OR IGNORE INTO blog_keyword_queue (keyword, geo_modifier, intent) VALUES (?, ?, ?)`
        ).bind(kw, geo, intent).run()
      }
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
  const market = (row as any).market || 'us'
  const isUS = market === 'us' || (!market && !['Toronto','Calgary','Vancouver','Ottawa','Edmonton','Winnipeg','Montreal','Mississauga','Hamilton','Regina','Saskatoon','Halifax'].includes(row.geo_modifier || ''))
  const brand = `Roof Manager (roofmanager.ca) — roof measurement and roofer CRM software for professional roofing and solar contractors.

VOCABULARY RULE: Never use the phrase "AI-powered", "AI-driven", or any "AI-[adjective]" puffery. Describe specific capabilities by what they do (e.g., "satellite measurement", "Gemini vision analysis for roof condition", "voice receptionist that answers missed calls"). "AI" may appear when naming a specific model or comparing systems, never as a generic marketing modifier.

PRODUCT TRUTH (use only these facts when describing the product; do not invent features):
- Core measurement engine: Google Solar API (building footprint, pitch, segment geometry) + proprietary geodesic engine that has user-drawn GPS traces (eaves, ridges, hips, valleys) cross-checked against DSM elevation rasters. Every number is verifiable — not a black-box satellite guess.
- AI vision: Gemini 2.0/2.5 analyzes roof imagery for condition, material, damage, and geometry extraction. A Cloud Run custom model provides secondary validation.
- Output: a branded 3-page PDF report with projected + sloped area, edge lengths by type (eave/ridge/hip/valley/rake), pitch per facet, waste factor, and a full material take-off (bundles, underlayment, starter, ridge cap, drip edge, ice & water, nails).
- Pricing: first 3 reports FREE, then $8 USD / $8 CAD per report. No subscription required. No per-seat fee. No annual contract.
- Built-in CRM: pipeline (leads → quoted → won/lost), jobs, invoices, payments (Stripe + Square), customer portal, and a proposal builder with interactive homeowner-facing web proposals and PVWatts solar simulation.
- AI Receptionist / Secretary: 24/7 LiveKit voice agent that answers missed calls, qualifies leads, books estimates, and hands off hot calls — with live transcripts.
- Integrations: Google Maps / Solar API, Gmail OAuth (sends reports from the contractor's own address), Resend, Stripe, Square, Telnyx, LiveKit.
- Platform: Cloudflare Workers + D1 — edge-deployed, fast from every US/CA metro, SOC-friendly architecture.

POSITIONING vs. COMPETITORS (factual, no trash talk):
- vs EagleView / GAF QuickMeasure / Hover: Roof Manager produces contractor-verifiable traces (you draw, engine validates) at $8/report instead of $20–$90/report, and delivers in minutes not hours.
- vs Roofr / RoofSnap: Roof Manager bundles measurement + CRM + proposals + AI receptionist in one platform with no per-seat pricing.
- vs manual measurement / drone-only workflows: Roof Manager removes the roof-walk for quoting (safer, faster) while keeping a drone/ladder check optional for final scope.

IDEAL CUSTOMER: independent roofing contractors (1–50 trucks), solar installers, storm-restoration crews, and public adjusters in US + Canada. Typical pain: EagleView cost, slow turnaround, missed calls, fragmented tools.

BRAND VOICE: confident, plain-spoken, contractor-to-contractor. No hype. Lead with numbers, pricing, and time saved. Never say "revolutionary", "game-changer", "unlock", or "empower".

WHEN RELEVANT (not forced): weave in ONE product mention that fits naturally — e.g., "Tools like Roof Manager generate this measurement from satellite imagery in under 5 minutes for $8." Avoid stacking multiple product plugs. The article must stand on its own as useful content; the product fits only where the reader would benefit.`
  const usFraming = isUS ? `
US MARKET REQUIREMENTS (this article targets US contractors):
- Use US English spelling (not Canadian). Write "aluminum" not "aluminium", "labor" not "labour".
- Use US units ONLY: feet, square feet (sq ft), inches. Never meters or metric.
- Mention at least one US building code by name (IRC 2021, Florida Building Code, Texas Windstorm requirements, etc.).
- Mention at least one major US insurer by name (State Farm, Allstate, USAA, Farmers, Travelers, Nationwide, etc.).
- Include at least one US-specific climate/weather fact with a number (e.g., "Texas averages 30 hail days per year").
- Never write "$X CAD". Write "$X" or "$X USD". Roof Manager reports cost $8 USD per report after 3 free.
- Write "As of 2026" in the first paragraph to establish freshness.` : `
CANADIAN MARKET REQUIREMENTS:
- Use Canadian English.
- Mention CAD pricing where relevant: Roof Manager reports cost $8 CAD after 3 free.
- Reference relevant Canadian building codes (NBC, provincial codes) where applicable.`

  return `You are an expert SEO/GEO content writer for ${brand}
Write a 1400-2000 word blog article targeting the keyword "${row.keyword}"${geo}.
Intent: ${row.intent}. Audience: professional roofing contractors.
${usFraming}

CORE REQUIREMENTS:
1. KEY FACTS BLOCK: Start with a <section class="key-facts"> containing 5-8 bullet-point factual claims with specific numbers. This is GEO-critical: AI systems (ChatGPT, Perplexity, Google AI Overviews) cite structured fact blocks more than prose. Example: "• Colorado averages 44 hail days per year — one of the highest in the US."

2. SPEAKABLE SECTION: Wrap your opening paragraph and FAQ with <section data-speakable="true">. This improves Google Assistant and Siri citation frequency.

3. INTERNAL LINKS: Include 6-10 internal links. You MAY ONLY link to these real URLs (do not invent paths):
   - Feature hubs: /features/measurements, /features/crm, /features/ai-secretary, /features/virtual-try-on
   - Tools: /tools/pitch-calculator, /tools/material-estimator, /tools/shingle-calculator, /tools/insurance-deductible-estimator, /tools/solar-production-estimator
   - Pricing + signup: /pricing, /get-started, /sample-report
   - Location hub: /us/${row.geo_modifier ? row.geo_modifier.toLowerCase().replace(/ /g,'-') : 'texas'} (state pages exist for all 50 states — link only to actual US state names)
   - Content: /blog (listing), /help (knowledge base), /services, /contact
   Requirement: minimum 2 links to /features/*, minimum 2 links to /tools/*, minimum 1 link to /pricing, minimum 1 link to /blog. Use descriptive anchor text (not "click here").

4. FAQ SECTION: 8-10 Q&As in a visible FAQ. Include 3 "People Also Ask"-style questions that mirror top Google PAA boxes for this topic.

5. SOURCES SECTION: End with a ## Sources section with 3-5 real citations: IBHS (ibhs.org), NOAA (noaa.gov), FEMA (fema.gov), state insurance department, or ICC (iccsafe.org). LLMs weight cited sources heavily for citation confidence.

6. AUTHOR ATTRIBUTION: End the article with a single sentence: "By [Name], Roofing Technology Specialist at Roof Manager" using one of these names: Marcus Webb, Diane Kowalski, Tyler Hatch.

7. SCHEMA: Include a <script type="application/ld+json"> block with BOTH BlogPosting AND FAQPage schemas. For step-by-step articles, also include HowTo schema.

8. Start with a concrete hook that answers the page's target query in the FIRST 50 WORDS with at least one specific number. Bad: "Replacing your roof is a big decision." Good: "Replacing a roof on a 2,000 sq ft Texas home costs $9,000–$18,000 in 2026, depending on material, pitch, and the insurer's settlement terms."

${row.geo_modifier ? `LOCAL CONTEXT: Mention ${row.geo_modifier}-specific factors — local climate, building codes, top insurers, storm history. Include at least one statistic specific to ${row.geo_modifier}.` : ''}

NO FLUFF. No "In today's world", no "it's important to note". Start with the concrete hook.

Return STRICT JSON only, no markdown fences:
{
  "title": "...",
  "slug": "kebab-case-slug",
  "excerpt": "1-2 sentence meta-description-style summary",
  "meta_title": "max 60 chars, keyword-forward",
  "meta_description": "max 155 chars",
  "content_html": "<article>...full HTML with key-facts section, speakable sections, H2/H3, paragraphs, FAQ, Sources, JSON-LD script...</article>",
  "tags": ["tag1","tag2","tag3"],
  "read_time_minutes": 8
}`
}

function buildGatePrompt(row: QueueRow, draft: DraftOutput): string {
  const market = (row as any).market || 'us'
  const isUS = market === 'us'
  return `You are an SEO/GEO quality auditor. Score this draft targeting keyword "${row.keyword}"${row.geo_modifier ? ` (${row.geo_modifier})` : ''}.

Draft title: ${draft.title}
Draft excerpt: ${draft.excerpt}
Content length: ${draft.content_html.length} chars
Content preview (first 3000 chars): ${draft.content_html.slice(0, 3000)}...

Evaluate on 0-100 scale:
- eeat: Experience/Expertise/Authority/Trust signals (concrete facts, stats, named author, sources section)
- keyword_fit: natural keyword placement, semantic coverage, no stuffing
- readability: short paragraphs, scannable H2/H3, conversational tone
- geo_optimization (0-100): Has <section class="key-facts"> with 5+ factual bullet points? Has <section data-speakable="true">? Has named author attribution? Has Sources section with 3+ real citations? Has 5+ specific numbers (percentages, dates, dollar amounts)? Each present = +20 points.
${isUS ? `- us_alignment (0-100): No "CAD" in body text? Uses "feet"/"sq ft" not metric? Mentions at least 1 US insurer? Mentions at least 1 US building code? Mentions at least 1 US state? Each = +20 points.` : ''}
- schema_present: boolean — is there a <script type="application/ld+json"> block?
- internal_links: count of <a href="/...> internal links (target: 6+)
- brand_voice (0-100): 100 if the article contains NONE of these banned phrases (case-insensitive): ${BANNED_PHRASES.map(p => `"${p}"`).join(', ')}. Subtract 25 per occurrence.

Return STRICT JSON:
{
  "overall": 0-100,
  "eeat": 0-100,
  "keyword_fit": 0-100,
  "readability": 0-100,
  "geo_optimization": 0-100,
  "brand_voice": 0-100,
  ${isUS ? '"us_alignment": 0-100,' : ''}
  "schema_present": true|false,
  "internal_links": 0,
  "issues": ["short list of concrete problems, empty if none"]
}`
}

function hasBannedPhrase(html: string): string | null {
  const hay = html.toLowerCase()
  for (const p of BANNED_PHRASES) if (hay.includes(p)) return p
  return null
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

  const coverByCategory: Record<string, string> = {
    roofing: 'https://images.unsplash.com/photo-1632759145355-6b9b1a1f57cd?w=1600&q=75',
    insurance: 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=1600&q=75',
    solar: 'https://images.unsplash.com/photo-1509390157308-aa3f4b9b2f58?w=1600&q=75',
    commercial: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1600&q=75',
  }
  const coverUrl = coverByCategory[row.target_category || 'roofing'] || coverByCategory.roofing

  const result = await db.prepare(
    `INSERT INTO blog_posts
      (slug, title, excerpt, content, cover_image_url, category, tags, meta_title, meta_description, status, read_time_minutes, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, datetime('now'))`
  ).bind(
    slug,
    draft.title,
    draft.excerpt,
    draft.content_html,
    coverUrl,
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
    const geoOk = (score as any).geo_optimization === undefined || (score as any).geo_optimization >= 60
    const bannedHit = hasBannedPhrase(draft.content_html)
    if (bannedHit) {
      score.issues = [...(score.issues || []), `banned phrase: "${bannedHit}"`]
    }
    const passed = score.overall >= QUALITY_THRESHOLD && score.schema_present && score.internal_links >= 2 && geoOk && !bannedHit

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

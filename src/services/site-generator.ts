// ============================================================
// Website Builder — AI Copy Generation via Gemini
// Generates 5-page roofing contractor website content
// ============================================================

import type { WBIntakeFormData, WBGeneratedSiteContent } from '../types'
import { callGemini } from './gemini'
import { getAccessToken, getProjectId } from './gcp-auth'

interface GeminiEnv {
  GEMINI_API_KEY?: string
  GCP_SERVICE_ACCOUNT_JSON?: string
  GOOGLE_VERTEX_API_KEY?: string
}

export async function generateSiteCopy(
  intake: WBIntakeFormData,
  env: GeminiEnv
): Promise<WBGeneratedSiteContent> {
  // Build auth credentials (same pattern as analyzeRoofGeometry)
  let accessToken: string | undefined
  let project: string | undefined
  let location = 'us-central1'
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_VERTEX_API_KEY

  if (env.GCP_SERVICE_ACCOUNT_JSON) {
    try {
      accessToken = await getAccessToken(env.GCP_SERVICE_ACCOUNT_JSON)
      project = getProjectId(env.GCP_SERVICE_ACCOUNT_JSON) || undefined
    } catch (e: any) {
      console.warn('[SiteGenerator] Service account auth failed:', e.message)
    }
  }

  if (!apiKey && !accessToken) {
    throw new Error('No Gemini credentials available')
  }

  const reviewsText = intake.google_reviews && intake.google_reviews.length > 0
    ? intake.google_reviews
        .slice(0, 3)
        .map(r => `"${r.text}" — ${r.author}, ${r.rating}/5 stars`)
        .join('\n')
    : 'No reviews provided yet'

  const prompt = buildPrompt(intake, reviewsText)

  const result = await callGemini({
    apiKey,
    accessToken,
    project,
    location,
    model: 'gemini-2.0-flash',
    timeoutMs: 60000,
    systemInstruction: {
      parts: [{
        text: `You are a professional copywriter specializing in roofing contractor websites.
You write conversion-optimized, SEO-friendly copy that builds trust with homeowners.
Your tone matches the brand vibe: ${intake.brand_vibe}.
- professional: trustworthy, expert, formal but warm
- bold: confident, direct, aggressive with CTAs
- friendly: approachable, community-focused, personable
Always use the contractor's actual business name, city, and services. Never use placeholder text.
Write as if speaking directly to a homeowner who needs roof work.
IMPORTANT: Return ONLY valid JSON matching the exact schema requested. No markdown, no code fences, no explanation.`
      }]
    },
    contents: [{
      role: 'user',
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8000,
      responseMimeType: 'application/json'
    }
  })

  // Parse JSON from Gemini response
  let text = typeof result === 'string' ? result : ''
  if (!text && result?.candidates?.[0]?.content?.parts?.[0]?.text) {
    text = result.candidates[0].content.parts[0].text
  }

  // Strip markdown code fences if present
  text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()

  const parsed = JSON.parse(text) as WBGeneratedSiteContent
  if (!parsed.home || !parsed.services || !parsed.about || !parsed.contact) {
    throw new Error('AI response missing required pages')
  }

  return parsed
}

function buildPrompt(intake: WBIntakeFormData, reviewsText: string): string {
  return `Generate complete website copy for a roofing contractor with these details:

BUSINESS INFO:
- Business Name: ${intake.business_name}
- Location: ${intake.city}, ${intake.province}${intake.zip ? ' ' + intake.zip : ''}
- Phone: ${intake.phone}
- Email: ${intake.email}
- Years in Business: ${intake.years_in_business || 'Established'}
- Owner: ${intake.owner_name || 'Not specified'}
- License: ${intake.license_number || 'Licensed & Insured'}

SERVICES OFFERED:
${intake.services_offered.map(s => `- ${s}`).join('\n')}

SERVICE AREAS:
${intake.service_areas.map(a => `- ${a}`).join('\n')}

CERTIFICATIONS:
${intake.certifications.length > 0 ? intake.certifications.map(c => `- ${c}`).join('\n') : '- Licensed & Insured'}

BRAND VIBE: ${intake.brand_vibe}

COMPANY STORY: ${intake.company_story || `${intake.business_name} has been serving ${intake.city} and surrounding areas${intake.years_in_business ? ' for ' + intake.years_in_business + ' years' : ''}, providing quality roofing services to homeowners.`}

CUSTOMER REVIEWS:
${reviewsText}

Generate copy for all 5 pages as a JSON object with keys: home, services, about, service_areas, contact.
Each page has: meta_title (60 chars max, include city), meta_description (160 chars max), sections (array).

PAGE SECTION TYPES AND DATA FORMATS:

HOME PAGE sections (in order):
1. type: "hero" — data: { headline, subheadline, cta_primary_text, cta_secondary_text, trust_line }
2. type: "trust_bar" — data: { items: [{icon, text}] } (3-4 trust signals)
3. type: "services_grid" — data: { headline, subheadline, services: [{name, description, icon_name}] }
4. type: "about_snippet" — data: { headline, body, cta_text }
5. type: "reviews" — data: { headline, reviews: [{author, rating, text}] }
6. type: "stats" — data: { items: [{number, label}] }
7. type: "cta_banner" — data: { headline, subheadline, cta_text, cta_url: "/contact" }

SERVICES PAGE sections:
1. type: "hero" — data: { headline, subheadline }
2. type: "service_list" — data: { services: [{name, headline, description, benefits: [string]}] }
3. type: "cta_banner" — data: { headline, cta_text, cta_url: "/contact" }

ABOUT PAGE sections:
1. type: "hero" — data: { headline, subheadline }
2. type: "story" — data: { headline, paragraphs: [string], owner_name }
3. type: "certifications" — data: { headline, items: [{name, description}] }
4. type: "reviews" — data: { headline, reviews: [{author, rating, text}] }
5. type: "cta_banner" — data: { headline, cta_text, cta_url: "/contact" }

SERVICE AREAS PAGE sections:
1. type: "hero" — data: { headline, subheadline }
2. type: "city_list" — data: { headline, cities: [{name, description}] }
3. type: "cta_banner" — data: { headline, cta_text }

CONTACT PAGE sections:
1. type: "hero" — data: { headline, subheadline }
2. type: "contact_form" — data: { headline, phone: "${intake.phone}", email: "${intake.email}", address_line: "${intake.address || intake.city + ', ' + intake.province}", hours: "Mon-Fri 7AM-6PM, Sat 8AM-2PM" }
3. type: "faq" — data: { headline, items: [{question, answer}] } (3-5 roofing questions)

Make all copy specific, compelling, and conversion-focused. Use the business name, city, and services throughout.`
}

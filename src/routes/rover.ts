// ============================================================
// ROVER AI — Backend API Routes
// Public chatbot for visitors + Authenticated AI Assistant for customers
// Uses OpenAI-compatible API with model fallback chain
// Stores every conversation in D1 for admin review
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { validateAdminSession } from './auth'
import { sendGmailOAuth2 } from '../services/email'

export const roverRoutes = new Hono<{ Bindings: Bindings }>()

// ============================================================
// MODEL CONFIGURATION
// ============================================================
const GEMINI_MODEL = 'gemini-2.0-flash'
const GEMINI_REST_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// ============================================================
// ROVER SYSTEM PROMPT — Comprehensive Roof Manager expert
// ============================================================
const ROVER_SYSTEM_PROMPT = `You are Rover 🐕, the friendly and knowledgeable AI sales assistant for Roof Manager — Canada's #1 AI-powered roof measurement report platform.

YOUR PERSONALITY:
- Warm, professional, and enthusiastic about helping roofing professionals succeed
- You genuinely believe Roof Manager saves contractors time and money
- You use casual but professional language — approachable yet knowledgeable
- You keep responses concise: 2-4 sentences unless the topic requires more detail
- You always end with a helpful follow-up question or call-to-action

YOUR PRIMARY GOALS (in order):
1. Answer the visitor's question accurately and helpfully
2. Qualify the lead — understand their business, volume, and needs
3. Move them toward signing up at /customer/login (3 FREE reports, no credit card)
4. Collect their name, email, and company naturally during conversation
5. If you truly cannot help, guide them to the contact form or email sales@roofmanager.ca

═══════════════════════════════════════════════════
ABOUT ROOF MANAGER — KNOW THIS INSIDE AND OUT
═══════════════════════════════════════════════════

WHAT WE ARE:
Roof Manager is an AI-powered roof measurement platform that generates detailed, professional roof reports from satellite imagery in under 60 seconds. We use Google's Solar API for real satellite data — these are NOT estimates or guesswork. We serve roofing professionals, estimators, home inspectors, insurance adjusters, solar installers, and property managers worldwide — anywhere Google satellite imagery is available, including Canada, the United States, and many other countries.

HEADQUARTERS: Alberta, Canada
WEBSITE: roofmanager.ca (also at roofing-measurement-tool.pages.dev)
EMAIL: sales@roofmanager.ca
PARENT COMPANY: Reuse Canada — an innovative recycling and sustainable building products company

═══════════════════════════════════════════════════
PRICING — BE EXACT, NO GUESSING
═══════════════════════════════════════════════════

FREE TRIAL:
- 3 FREE roof measurement reports when you sign up
- No credit card required — just name and email
- Full-featured reports, same as paid version
- Sign up at: /customer/login

AFTER FREE TRIAL:
- $8 CAD per Roof Measurement Report
- Instant delivery (< 60 seconds)
- Credit packs available for volume users (bulk discounts)
- All payments processed via Square (Visa, Mastercard, Amex, Apple Pay, Google Pay, Cash App)

ROOFER SECRETARY (AI Phone Answering Service):
- $249/month (CAD for Canadians, USD for Americans)
- AI answers your business calls 24/7
- Routes calls to the right department
- Provides call transcripts and summaries
- Never miss a lead again

═══════════════════════════════════════════════════
WHAT'S IN A ROOF REPORT — DETAILED BREAKDOWN
═══════════════════════════════════════════════════

Every report includes:
1. TRUE 3D ROOF AREA — Not just footprint, but actual sloped surface area in sq ft and sq m
2. ROOF PITCH ANALYSIS — Pitch ratio for each segment, overall roof pitch
3. SEGMENT BREAKDOWN — Individual measurements for every roof plane/facet
4. EDGE MEASUREMENTS (Critical for estimating):
   - Total Ridge length (ft)
   - Total Hip length (ft)
   - Total Valley length (ft)
   - Total Eave length (ft)
   - Total Rake length (ft)
5. MATERIAL BILL OF MATERIALS (BOM):
   - Gross squares (roofing squares)
   - Bundle count
   - Total material cost estimate (CAD, Alberta pricing)
   - Complexity classification
6. SOLAR POTENTIAL ANALYSIS:
   - Annual sunshine hours
   - Recommended panel count
   - Yearly energy production estimate (kWh)
7. SATELLITE IMAGERY — Actual Google Solar API satellite image of the property
8. CONFIDENCE SCORING — Imagery quality rating, confidence score, field verification recommendation
9. DOWNLOADABLE PDF — Professional, branded report ready to share with clients

ACCURACY:
- Typically within 2-5% of manual measurements
- Uses Google's Solar API with HIGH quality satellite imagery
- Best accuracy in urban/suburban areas with good satellite coverage
- We recommend field verification for complex or unusual roofs

═══════════════════════════════════════════════════
PLATFORM FEATURES — FULL TOOLKIT
═══════════════════════════════════════════════════

CUSTOMER PORTAL (/customer/login):
- Order reports by entering any address (worldwide coverage wherever Google satellite imagery exists)
- View order history and download past reports
- Track report generation status in real-time
- Manage your account and billing

CUSTOM BRANDING:
- Add your company logo to every report
- Customize colors and company info
- Present reports to YOUR clients with YOUR brand
- Professional look, zero design work

CRM TOOLS (Built-in Customer Management):
- Customer database management
- Create and send proposals
- Generate invoices with line items
- Job tracking and scheduling
- Sales pipeline management
- Track customer communications
- Full business workflow in one platform

D2D MANAGER (Door-to-Door Sales):
- Map-based territory tracking
- Plan and manage door-to-door sales routes
- Track knock results and follow-ups
- Perfect for storm damage canvassing

ROOFER SECRETARY (AI Phone Service):
- 24/7 AI-powered call answering
- Intelligent call routing to departments
- Automated call transcripts and summaries
- Scheduling assistance
- Never miss a potential customer call
- $249/month

BLOG (/blog):
- Roofing industry insights and best practices
- Marketing tips for roofing businesses
- Technology updates and product news

═══════════════════════════════════════════════════
COVERAGE & DELIVERY
═══════════════════════════════════════════════════

COVERAGE — 40+ COUNTRIES:
- North America & Caribbean: United States (covers 95%+ of all buildings), Canada, Mexico, Puerto Rico, The Bahamas, Antigua and Barbuda
- Europe: Austria, Belgium, Czechia, Denmark, Finland, France, Germany, Greece, Ireland, Italy, Norway, Poland, Portugal, Spain, Sweden, Switzerland, United Kingdom
- Asia-Pacific: Australia, Indonesia, Japan, Malaysia, New Zealand, Philippines, Taiwan, Thailand
- South America: Brazil, Colombia, Peru
- Best coverage is in urban and suburban areas worldwide
- Rural areas may have limited satellite imagery availability
- If imagery isn't available, we'll let you know — no charge

DELIVERY:
- Reports arrive in under 60 seconds, GUARANTEED
- Instant download as PDF
- Access reports anytime from your dashboard

═══════════════════════════════════════════════════
WHO USES ROOFREPORTERAI
═══════════════════════════════════════════════════

- Roofing contractors & estimators (our biggest user group)
- Home inspectors
- Insurance adjusters and claim processors
- Real estate agents and home sellers
- Solar panel installers
- Property management companies
- General contractors

═══════════════════════════════════════════════════
COMPETITIVE ADVANTAGES
═══════════════════════════════════════════════════

vs. Manual Measurement:
- Save 1-2 hours per roof (no ladder, no tape measure, no safety risk)
- Get measurements in < 60 seconds vs. 2-4 hours on-site
- Consistent accuracy without human error
- Measure ANY property from your office or truck

vs. EagleView / Hover / Other Aerial Measurement:
- $8 per report vs. $15-$50+ per report with competitors
- Instant delivery vs. 24-72 hour wait times
- No subscription lock-in — pay per report
- Built-in CRM, invoicing, and D2D tools (competitors don't offer this)
- Canadian-focused with CAD pricing and Alberta material costs

vs. Drone Measurements:
- No equipment needed ($0 startup vs. $1000+ drone)
- No pilot license or certifications required
- Instant results vs. flight time + processing time
- Works in any weather, any time

═══════════════════════════════════════════════════
COMMON QUESTIONS — ANSWER THESE CONFIDENTLY
═══════════════════════════════════════════════════

Q: "How accurate is it?"
A: Typically within 2-5% of manual measurements. We use Google's Solar API satellite data — real imagery, not estimates. For most standard residential roofs, accuracy is excellent. We always include a confidence score and recommend field verification for complex structures.

Q: "What areas do you cover?"
A: We're available in 40+ countries across 4 regions. North America & Caribbean: USA (95%+ building coverage), Canada, Mexico, Puerto Rico, The Bahamas, Antigua & Barbuda. Europe: UK, France, Germany, Spain, Italy, Portugal, Belgium, Austria, Switzerland, Denmark, Sweden, Norway, Finland, Ireland, Poland, Czechia, Greece. Asia-Pacific: Australia, Japan, New Zealand, Indonesia, Malaysia, Philippines, Taiwan, Thailand. South America: Brazil, Colombia, Peru. Best coverage is in urban/suburban areas. If imagery isn't available for a specific address, you won't be charged.

Q: "How fast are reports?"
A: Under 60 seconds, guaranteed. As soon as you enter the address and confirm, the report generates immediately. You can download the PDF right away.

Q: "Can I try it for free?"
A: Absolutely! Sign up at /customer/login — you get 3 completely free roof reports, no credit card required. Same full-featured reports that paid customers get.

Q: "What if I need a lot of reports?"
A: We offer credit packs for volume users at discounted rates. After your 3 free reports, each additional report is $8 CAD. If you're doing 50+ reports a month, reach out to sales@roofmanager.ca and we can discuss volume pricing.

Q: "Can I brand the reports with my company logo?"
A: Yes! Through your customer portal, you can add your company logo, name, and contact info to every report. Your clients will see YOUR brand, not ours.

Q: "Do you have an API?"
A: We're working on API access for high-volume users and integration partners. Contact sales@roofmanager.ca if you're interested — you'd be a great candidate for early access.

Q: "Is my data secure?"
A: Yes. All payments are processed through Square's secure platform. Your reports and customer data are stored on Cloudflare's global network with enterprise-grade security.

Q: "What payment methods do you accept?"
A: We accept Visa, Mastercard, American Express, Apple Pay, Google Pay, and Cash App — all through Square's secure checkout.

Q: "Can I use this for insurance claims?"
A: Our reports include detailed measurements, edge breakdowns, and material BOMs that many adjusters find useful. While we recommend confirming with your specific insurance company, our reports provide the detailed data claims often require.

═══════════════════════════════════════════════════
RESPONSE GUIDELINES
═══════════════════════════════════════════════════

1. ALWAYS answer the visitor's question FIRST, then add your sales angle
2. Keep responses 2-4 sentences unless the question needs more detail
3. Use specific numbers and facts — $8 per report, < 60 seconds, 3 free reports
4. NEVER make up features, pricing, or capabilities not listed above
5. If you genuinely don't know something, say: "That's a great question! I'd recommend reaching out to our team at sales@roofmanager.ca or filling out the contact form so we can get you the right answer."
6. Always try to understand what brought them to the site and what their business does
7. If they mention company size, estimate volume, or specific needs, note this — they're a qualified lead
8. End responses with a question or clear next step when natural
9. If they seem ready to try, push them to sign up: "Want to give it a spin? Head to /customer/login — your 3 free reports are waiting!"
10. Be honest — if a feature doesn't exist yet, say "we're working on that" rather than making promises`

// ============================================================
// AI CALL — OpenAI API (api.openai.com) via OPENAI_API_KEY
// One key, one endpoint, no fallbacks.
// ============================================================
async function callAI(
  env: any,
  messages: any[],
  maxTokens: number = 1000,
  temperature: number = 0.7
): Promise<{ content: string; model: string; tokensUsed: number; responseTimeMs: number }> {
  const apiKey = env.OPENAI_API_KEY
  if (!apiKey) throw new Error('No OPENAI_API_KEY configured')

  const startTime = Date.now()
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  })
  const responseTimeMs = Date.now() - startTime

  if (!response.ok) {
    const errText = await response.text()
    console.error('[Rover] OpenAI failed:', response.status, errText.slice(0, 300))
    throw new Error(`OpenAI ${response.status}: ${errText.slice(0, 300)}`)
  }

  const data: any = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (!content || content.trim() === '') throw new Error('OpenAI returned empty response')

  return {
    content: content.trim(),
    model: 'gpt-4o-mini',
    tokensUsed: data.usage?.total_tokens || 0,
    responseTimeMs,
  }
}

// ============================================================
// PUBLIC ENDPOINTS — No auth required (visitor-facing)
// ============================================================

// POST /api/rover/chat — Send a message to Rover
roverRoutes.post('/chat', async (c) => {
  try {
    const body = await c.req.json()
    const { session_id, message, page_url } = body

    if (!session_id || !message) {
      return c.json({ error: 'session_id and message are required' }, 400)
    }

    // Get or create conversation
    let conversation = await c.env.DB.prepare(
      'SELECT * FROM rover_conversations WHERE session_id = ?'
    ).bind(session_id).first()

    if (!conversation) {
      const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown'
      const ua = c.req.header('user-agent') || 'unknown'

      await c.env.DB.prepare(`
        INSERT INTO rover_conversations (session_id, visitor_ip, visitor_user_agent, page_url, status, first_message_at, last_message_at)
        VALUES (?, ?, ?, ?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(session_id, ip, ua, page_url || null).run()

      conversation = await c.env.DB.prepare(
        'SELECT * FROM rover_conversations WHERE session_id = ?'
      ).bind(session_id).first()
    }

    if (!conversation) {
      return c.json({ error: 'Failed to create conversation' }, 500)
    }

    const conversationId = conversation.id as number

    // Store user message
    await c.env.DB.prepare(`
      INSERT INTO rover_messages (conversation_id, role, content)
      VALUES (?, 'user', ?)
    `).bind(conversationId, message).run()

    // Get conversation history (last 20 messages for context)
    const history = await c.env.DB.prepare(`
      SELECT role, content FROM rover_messages 
      WHERE conversation_id = ? 
      ORDER BY created_at ASC 
      LIMIT 20
    `).bind(conversationId).all()

    // Build messages array for AI
    const messages: any[] = [
      { role: 'system', content: ROVER_SYSTEM_PROMPT }
    ]

    // Check if this is the first user message (greeting context)
    const isFirstMessage = (history.results || []).filter((m: any) => m.role === 'user').length <= 1

    if (isFirstMessage) {
      messages.push({
        role: 'assistant',
        content: "Hey there! 🐕 I'm Rover, your Roof Manager expert helper! How can I help you today?"
      })
    }

    // Add conversation history
    for (const msg of (history.results || [])) {
      messages.push({ role: msg.role, content: msg.content })
    }

    try {
      const result = await callAI(c.env, messages, 1000, 0.7)
      if (!result) throw new Error('No result')

      // Store assistant reply
      await c.env.DB.prepare(`
        INSERT INTO rover_messages (conversation_id, role, content, tokens_used, model, response_time_ms)
        VALUES (?, 'assistant', ?, ?, ?, ?)
      `).bind(conversationId, result.content, result.tokensUsed, result.model, result.responseTimeMs).run()

      // Update conversation
      await c.env.DB.prepare(`
        UPDATE rover_conversations 
        SET message_count = message_count + 2, 
            last_message_at = CURRENT_TIMESTAMP, 
            updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).bind(conversationId).run()

      // Extract lead info from the message
      await extractLeadInfo(c.env.DB, conversationId, message)

      return c.json({ reply: result.content, session_id })

    } catch (aiError: any) {
      // All AI models failed — use intelligent fallback
      console.error('[Rover] All AI models failed:', aiError.message)
      
      const fallback = getFallbackResponse(message)
      
      await c.env.DB.prepare(`
        INSERT INTO rover_messages (conversation_id, role, content, model)
        VALUES (?, 'assistant', ?, 'fallback-smart')
      `).bind(conversationId, fallback).run()

      await c.env.DB.prepare(`
        UPDATE rover_conversations SET message_count = message_count + 2, last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?
      `).bind(conversationId).run()

      return c.json({ reply: fallback, session_id, show_contact_form: true })
    }

  } catch (err: any) {
    console.error('Rover chat error:', err)
    return c.json({ 
      error: 'Chat service temporarily unavailable', 
      reply: "I'm having a quick technical hiccup! You can reach our team at sales@roofmanager.ca or sign up at /customer/login for 3 free reports. We'll be back in just a moment!",
      show_contact_form: true,
      session_id: (await c.req.json().catch(() => ({}))).session_id
    }, 200) // Return 200 so frontend can display the message
  }
})

// ============================================================
// SMART FALLBACK — Keyword-based responses when AI is down
// ============================================================
function getFallbackResponse(message: string): string {
  const msg = message.toLowerCase()

  if (msg.includes('price') || msg.includes('cost') || msg.includes('how much') || msg.includes('pricing')) {
    return "Great question! Our roof reports are just $8 CAD each — and you get 3 FREE reports when you sign up (no credit card needed)! We also offer credit packs for volume discounts. Want to try it out? Head to /customer/login to claim your free reports! 🏠"
  }
  
  if (msg.includes('free') || msg.includes('trial') || msg.includes('try')) {
    return "Absolutely! You get 3 completely FREE roof measurement reports when you sign up — no credit card required. They're the same full-featured reports our paying customers get. Sign up at /customer/login and you'll have your first report in under 60 seconds! 🎉"
  }

  if (msg.includes('report') && (msg.includes('what') || msg.includes('include') || msg.includes('in a'))) {
    return "Our reports are packed with data! You get true 3D roof area, pitch analysis, segment breakdown, edge measurements (ridge, hip, valley, eave, rake), a full material Bill of Materials with Alberta pricing, solar potential, and satellite imagery — all in a downloadable PDF. Ready to see one? Sign up at /customer/login for 3 free reports! 📊"
  }

  if (msg.includes('accurate') || msg.includes('accuracy') || msg.includes('reliable')) {
    return "Our reports are typically within 2-5% of manual measurements! We use Google's Solar API with real satellite imagery — not estimates. Each report includes a confidence score too. Want to test it against one of your manually measured properties? Get 3 free reports at /customer/login! 🎯"
  }

  if (msg.includes('cover') || msg.includes('area') || msg.includes('where') || msg.includes('location') || msg.includes('canada')) {
    return "We're available in 40+ countries! 🌍 North America (USA, Canada, Mexico, Caribbean), Europe (UK, France, Germany, Spain, Italy + 12 more), Asia-Pacific (Australia, Japan, NZ + 5 more), and South America (Brazil, Colombia, Peru). The US has 95%+ building coverage. See all countries at /coverage. Try it free at /customer/login — 3 reports on us!"
  }

  if (msg.includes('fast') || msg.includes('quick') || msg.includes('how long') || msg.includes('delivery') || msg.includes('time')) {
    return "Lightning fast! Reports arrive in under 60 seconds, guaranteed. Enter the address, confirm, and download your PDF — that's it. No waiting hours or days like some competitors. Try it now at /customer/login with 3 free reports! ⚡"
  }

  if (msg.includes('brand') || msg.includes('logo') || msg.includes('custom')) {
    return "You can absolutely brand the reports with YOUR company logo and info! Through your customer portal, add your logo, company name, and contact details. Your clients will see a professional report under your brand. Set it up when you sign up at /customer/login! 🎨"
  }

  if (msg.includes('crm') || msg.includes('customer management') || msg.includes('invoice') || msg.includes('proposal')) {
    return "We have a full built-in CRM suite! Manage customers, create proposals, generate invoices, track jobs, and manage your sales pipeline — all included with your account. No extra software needed. Check it out at /customer/login! 💼"
  }

  if (msg.includes('phone') || msg.includes('secretary') || msg.includes('call') || msg.includes('answer')) {
    return "Our Roofer Secretary is an AI-powered phone answering service for $249/month! It answers your business calls 24/7, routes them to the right department, and gives you full call transcripts. Never miss a lead again! Email sales@roofmanager.ca to learn more. 📞"
  }

  if (msg.includes('d2d') || msg.includes('door') || msg.includes('canvass') || msg.includes('territory')) {
    return "Our D2D Manager is built for roofing door-to-door sales! It includes map-based territory tracking, route planning, and knock result tracking. Perfect for storm damage canvassing teams. It's included in your account — sign up at /customer/login! 🗺️"
  }

  if (msg.includes('contact') || msg.includes('email') || msg.includes('talk') || msg.includes('human') || msg.includes('support') || msg.includes('help')) {
    return "I'd love to connect you with our team! You can email us at sales@roofmanager.ca or fill out the contact form below and someone will get back to you right away. Is there anything specific you'd like to ask them about? 📧"
  }

  if (msg.includes('eagleview') || msg.includes('hover') || msg.includes('competitor') || msg.includes('compare') || msg.includes('vs') || msg.includes('versus')) {
    return "Great comparison question! Roof Manager is $8/report vs. $15-$50+ with competitors, with instant delivery (< 60 seconds vs. 24-72 hours), and includes built-in CRM, invoicing, and D2D tools that others don't offer. Plus 3 free reports to test it out at /customer/login! 🏆"
  }

  if (msg.includes('drone')) {
    return "Unlike drones, Roof Manager requires zero equipment ($0 startup vs. $1000+), no pilot license, works in any weather, and delivers results in under 60 seconds. It's the fastest, most affordable way to get accurate roof measurements. Try it free at /customer/login! 🚀"
  }

  if (msg.includes('api') || msg.includes('integration') || msg.includes('developer')) {
    return "We're working on API access for high-volume users and integration partners! If you're interested in API access, please email sales@roofmanager.ca — you'd be a great candidate for early access. In the meantime, our web portal handles everything you need at /customer/login! 🔌"
  }

  if (msg.includes('payment') || msg.includes('visa') || msg.includes('credit card') || msg.includes('pay')) {
    return "We accept all major payment methods through Square's secure checkout: Visa, Mastercard, American Express, Apple Pay, Google Pay, and Cash App. And remember — your first 3 reports are completely free with no credit card required! Sign up at /customer/login 💳"
  }

  if (msg.includes('insurance') || msg.includes('claim') || msg.includes('adjuster')) {
    return "Many insurance adjusters find our reports extremely useful! We provide detailed measurements, edge breakdowns, material BOMs, and confidence scores — exactly the kind of data claims require. Try it with 3 free reports at /customer/login to see if it fits your workflow! 🏥"
  }

  if (msg.includes('solar') || msg.includes('panel') || msg.includes('energy')) {
    return "Every report includes solar potential analysis! You'll see annual sunshine hours, recommended panel count, and yearly energy production estimates. Perfect for solar installers looking to give clients quick assessments. Try it free at /customer/login! ☀️"
  }

  // Default fallback — prompt contact form
  return "That's a great question! I want to make sure you get the most accurate answer. You can reach our team directly at sales@roofmanager.ca, or fill out the contact form below and we'll get back to you quickly. In the meantime, you can try 3 free roof reports at /customer/login — no credit card needed! 😊"
}

// POST /api/rover/end — End a conversation
roverRoutes.post('/end', async (c) => {
  try {
    const { session_id } = await c.req.json()
    if (!session_id) return c.json({ error: 'session_id required' }, 400)

    const conversation = await c.env.DB.prepare(
      'SELECT id, message_count FROM rover_conversations WHERE session_id = ?'
    ).bind(session_id).first()

    if (conversation && (conversation.message_count as number) >= 4) {
      const msgs = await c.env.DB.prepare(
        'SELECT role, content FROM rover_messages WHERE conversation_id = ? ORDER BY created_at ASC'
      ).bind(conversation.id).all()

      const transcript = (msgs.results || [])
        .map((m: any) => `${m.role === 'user' ? 'Visitor' : 'Rover'}: ${m.content}`)
        .join('\n')

      try {
        const result = await callAI(c.env, [
          {
            role: 'system',
            content: 'Summarize this customer chat conversation in 1-2 sentences. Focus on: what the visitor wanted, whether they seem like a qualified lead, and any contact info they shared. Be concise.'
          },
          { role: 'user', content: transcript }
        ], 200, 0.3)

        if (result.content) {
          await c.env.DB.prepare(
            'UPDATE rover_conversations SET summary = ? WHERE session_id = ?'
          ).bind(result.content, session_id).run()
        }
      } catch (e) { /* summary generation is best-effort */ }
    }

    await c.env.DB.prepare(`
      UPDATE rover_conversations
      SET status = 'ended', ended_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE session_id = ?
    `).bind(session_id).run()

    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// POST /api/rover/lead — Visitor voluntarily submits contact info (from contact form)
roverRoutes.post('/lead', async (c) => {
  try {
    const { session_id, name, email, phone, company, message } = await c.req.json()
    
    // If no session, create a conversation for the lead
    let conversationId: number | null = null
    
    if (session_id) {
      const conv = await c.env.DB.prepare(
        'SELECT id FROM rover_conversations WHERE session_id = ?'
      ).bind(session_id).first()
      conversationId = conv?.id as number || null
    }

    if (!conversationId && (email || phone)) {
      // Create a new conversation for this contact form submission
      const newSessionId = session_id || `contact_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
      await c.env.DB.prepare(`
        INSERT INTO rover_conversations (session_id, visitor_name, visitor_email, visitor_phone, visitor_company, 
          status, lead_status, lead_score, first_message_at, last_message_at)
        VALUES (?, ?, ?, ?, ?, 'ended', 'qualified', 70, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).bind(newSessionId, name || null, email || null, phone || null, company || null).run()

      const conv = await c.env.DB.prepare(
        'SELECT id FROM rover_conversations WHERE session_id = ?'
      ).bind(newSessionId).first()
      conversationId = conv?.id as number || null

      // Store the contact form message
      if (conversationId && message) {
        await c.env.DB.prepare(`
          INSERT INTO rover_messages (conversation_id, role, content)
          VALUES (?, 'user', ?)
        `).bind(conversationId, `[CONTACT FORM] ${message}`).run()
      }
    }

    if (conversationId) {
      const updates: string[] = []
      const values: any[] = []

      if (name) { updates.push('visitor_name = ?'); values.push(name) }
      if (email) { updates.push('visitor_email = ?'); values.push(email) }
      if (phone) { updates.push('visitor_phone = ?'); values.push(phone) }
      if (company) { updates.push('visitor_company = ?'); values.push(company) }

      if (updates.length > 0) {
        updates.push("lead_status = 'qualified'")
        updates.push("lead_score = MAX(lead_score, 70)")
        updates.push('updated_at = CURRENT_TIMESTAMP')
        values.push(conversationId)

        await c.env.DB.prepare(
          `UPDATE rover_conversations SET ${updates.join(', ')} WHERE id = ?`
        ).bind(...values).run()
      }
    }

    // Try to send notification email to admin
    try {
      await sendLeadNotification(c.env, { name, email, phone, company, message })
    } catch (e) {
      // Best effort notification
    }

    return c.json({ success: true, message: 'Thank you! Our team will get back to you shortly.' })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// Helper to send lead notification email
async function sendLeadNotification(env: any, lead: { name?: string; email?: string; phone?: string; company?: string; message?: string }) {
  const clientId = env.GMAIL_CLIENT_ID
  let clientSecret = env.GMAIL_CLIENT_SECRET || ''
  let refreshToken = env.GMAIL_REFRESH_TOKEN || ''
  // Fallback: check DB for tokens
  if (!refreshToken || !clientSecret) {
    try {
      const dbRefresh = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key = 'gmail_refresh_token' AND master_company_id = 1").first()
      if (dbRefresh?.setting_value) refreshToken = dbRefresh.setting_value
      const dbSecret = await env.DB.prepare("SELECT setting_value FROM settings WHERE setting_key = 'gmail_client_secret' AND master_company_id = 1").first()
      if (dbSecret?.setting_value) clientSecret = dbSecret.setting_value
    } catch {}
  }
  if (clientId && clientSecret && refreshToken) {
    const html = `
<div style="max-width:600px;margin:0 auto;font-family:Inter,system-ui,sans-serif">
  <div style="background:#7c3aed;padding:24px;border-radius:12px 12px 0 0">
    <h1 style="color:white;font-size:18px;margin:0">🐕 New Rover Chat Lead</h1>
    <p style="color:#c4b5fd;font-size:13px;margin:4px 0 0">From Rover AI Chat Widget</p>
  </div>
  <div style="background:white;padding:24px;border:1px solid #e2e8f0;border-top:none">
    <table style="width:100%;border-collapse:collapse">
      ${lead.name ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:100px"><strong>Name</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b">${lead.name}</td></tr>` : ''}
      ${lead.email ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px"><strong>Email</strong></td><td style="padding:8px 0;font-size:14px"><a href="mailto:${lead.email}" style="color:#0ea5e9">${lead.email}</a></td></tr>` : ''}
      ${lead.phone ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px"><strong>Phone</strong></td><td style="padding:8px 0;font-size:14px"><a href="tel:${lead.phone}" style="color:#0ea5e9">${lead.phone}</a></td></tr>` : ''}
      ${lead.company ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px"><strong>Company</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b">${lead.company}</td></tr>` : ''}
      ${lead.message ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;vertical-align:top"><strong>Message</strong></td><td style="padding:8px 0;font-size:14px;color:#1e293b">${lead.message}</td></tr>` : ''}
    </table>
  </div>
  <div style="background:#f8fafc;padding:16px;border-radius:0 0 12px 12px;border:1px solid #e2e8f0;border-top:none;text-align:center">
    <a href="https://www.roofmanager.ca/super-admin" style="color:#0ea5e9;font-size:12px;font-weight:600">View in Super Admin Dashboard</a>
  </div>
</div>`
    await sendGmailOAuth2(clientId, clientSecret, refreshToken, 'sales@roofmanager.ca', `🐕 Rover Chat Lead: ${lead.name || lead.email || 'Unknown'}`, html, 'sales@roofmanager.ca').catch((e: any) => console.warn('[Rover Lead Email] Failed:', e.message))
  } else {
    console.log('[Rover Lead] Gmail not configured, lead:', JSON.stringify(lead))
  }
}

// GET /api/rover/history — Get conversation history for a session
roverRoutes.get('/history', async (c) => {
  try {
    const sessionId = c.req.query('session_id')
    if (!sessionId) return c.json({ error: 'session_id required' }, 400)

    const conversation = await c.env.DB.prepare(
      'SELECT id, status FROM rover_conversations WHERE session_id = ?'
    ).bind(sessionId).first()

    if (!conversation) return c.json({ messages: [] })

    const msgs = await c.env.DB.prepare(
      'SELECT role, content, created_at FROM rover_messages WHERE conversation_id = ? ORDER BY created_at ASC'
    ).bind(conversation.id).all()

    return c.json({ 
      messages: msgs.results || [],
      status: conversation.status
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ============================================================
// ADMIN ENDPOINTS — Require admin auth
// ============================================================

// GET /api/rover/admin/conversations — List all conversations
roverRoutes.get('/admin/conversations', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Admin auth required' }, 401)

  try {
    const page = parseInt(c.req.query('page') || '1')
    const limit = parseInt(c.req.query('limit') || '25')
    const status = c.req.query('status')
    const leadStatus = c.req.query('lead_status')
    const search = c.req.query('search')
    const offset = (page - 1) * limit

    let where = 'WHERE 1=1'
    const params: any[] = []

    if (status) { where += ' AND rc.status = ?'; params.push(status) }
    if (leadStatus) { where += ' AND rc.lead_status = ?'; params.push(leadStatus) }
    if (search) {
      where += ` AND (rc.visitor_name LIKE ? OR rc.visitor_email LIKE ? OR rc.summary LIKE ?)`
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }

    const countResult = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM rover_conversations rc ${where}`
    ).bind(...params).first()

    const conversations = await c.env.DB.prepare(`
      SELECT rc.*, 
        (SELECT content FROM rover_messages WHERE conversation_id = rc.id AND role = 'user' ORDER BY created_at ASC LIMIT 1) as first_user_message
      FROM rover_conversations rc
      ${where}
      ORDER BY rc.last_message_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all()

    return c.json({
      conversations: conversations.results || [],
      total: (countResult as any)?.total || 0,
      page,
      limit,
      pages: Math.ceil(((countResult as any)?.total || 0) / limit)
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// GET /api/rover/admin/conversations/:id — Get full conversation
roverRoutes.get('/admin/conversations/:id', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Admin auth required' }, 401)

  try {
    const id = c.req.param('id')
    const conversation = await c.env.DB.prepare(
      'SELECT * FROM rover_conversations WHERE id = ?'
    ).bind(id).first()

    if (!conversation) return c.json({ error: 'Conversation not found' }, 404)

    const messages = await c.env.DB.prepare(
      'SELECT * FROM rover_messages WHERE conversation_id = ? ORDER BY created_at ASC'
    ).bind(id).all()

    return c.json({
      conversation,
      messages: messages.results || []
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// PATCH /api/rover/admin/conversations/:id — Update conversation
roverRoutes.patch('/admin/conversations/:id', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Admin auth required' }, 401)

  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const { admin_notes, lead_status, tags, status } = body

    const updates: string[] = ['updated_at = CURRENT_TIMESTAMP']
    const values: any[] = []

    if (admin_notes !== undefined) { updates.push('admin_notes = ?'); values.push(admin_notes) }
    if (lead_status) { updates.push('lead_status = ?'); values.push(lead_status) }
    if (tags !== undefined) { updates.push('tags = ?'); values.push(tags) }
    if (status) { updates.push('status = ?'); values.push(status) }

    values.push(id)

    await c.env.DB.prepare(
      `UPDATE rover_conversations SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...values).run()

    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// DELETE /api/rover/admin/conversations/:id — Delete a conversation
roverRoutes.delete('/admin/conversations/:id', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Admin auth required' }, 401)

  try {
    const id = c.req.param('id')
    await c.env.DB.prepare('DELETE FROM rover_messages WHERE conversation_id = ?').bind(id).run()
    await c.env.DB.prepare('DELETE FROM rover_conversations WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// GET /api/rover/admin/stats — Dashboard stats
roverRoutes.get('/admin/stats', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Admin auth required' }, 401)

  try {
    const stats = await c.env.DB.prepare(`
      SELECT 
        COUNT(*) as total_conversations,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_conversations,
        SUM(CASE WHEN status = 'ended' THEN 1 ELSE 0 END) as ended_conversations,
        SUM(message_count) as total_messages,
        AVG(message_count) as avg_messages_per_conversation,
        SUM(CASE WHEN lead_status = 'qualified' THEN 1 ELSE 0 END) as qualified_leads,
        SUM(CASE WHEN lead_status = 'converted' THEN 1 ELSE 0 END) as converted_leads,
        SUM(CASE WHEN visitor_email IS NOT NULL THEN 1 ELSE 0 END) as emails_collected,
        SUM(CASE WHEN visitor_phone IS NOT NULL THEN 1 ELSE 0 END) as phones_collected,
        SUM(CASE WHEN created_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END) as today_conversations,
        SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) as week_conversations,
        SUM(CASE WHEN created_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END) as month_conversations
      FROM rover_conversations
    `).first()

    const tokenStats = await c.env.DB.prepare(`
      SELECT 
        SUM(tokens_used) as total_tokens,
        AVG(response_time_ms) as avg_response_time
      FROM rover_messages 
      WHERE role = 'assistant' AND model != 'fallback' AND model != 'fallback-smart'
    `).first()

    const recent = await c.env.DB.prepare(`
      SELECT id, session_id, visitor_name, visitor_email, status, lead_status, 
             message_count, summary, lead_score, created_at, last_message_at
      FROM rover_conversations 
      ORDER BY last_message_at DESC 
      LIMIT 10
    `).all()

    return c.json({
      stats: stats || {},
      token_stats: tokenStats || {},
      recent: recent.results || []
    })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// ============================================================
// HELPER: Extract lead info from user messages
// ============================================================
async function extractLeadInfo(db: D1Database, conversationId: number, message: string) {
  try {
    const emailMatch = message.match(/[\w.-]+@[\w.-]+\.\w{2,}/i)
    if (emailMatch) {
      await db.prepare(
        'UPDATE rover_conversations SET visitor_email = ?, lead_status = ?, lead_score = MAX(lead_score, 70), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND visitor_email IS NULL'
      ).bind(emailMatch[0], 'qualified', conversationId).run()
    }

    const phoneMatch = message.match(/(?:\+?1[-.\s]?)?(?:\(?[2-9]\d{2}\)?[-.\s]?)?[2-9]\d{2}[-.\s]?\d{4}/)
    if (phoneMatch) {
      await db.prepare(
        'UPDATE rover_conversations SET visitor_phone = ?, lead_score = MAX(lead_score, 60), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND visitor_phone IS NULL'
      ).bind(phoneMatch[0], conversationId).run()
    }

    const companyKeywords = /(?:my company|our company|i work (?:for|at)|we are|our business|our firm)\s+(?:is\s+)?([A-Z][\w\s&.-]+)/i
    const companyMatch = message.match(companyKeywords)
    if (companyMatch) {
      await db.prepare(
        'UPDATE rover_conversations SET visitor_company = ?, lead_score = MAX(lead_score, 65), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND visitor_company IS NULL'
      ).bind(companyMatch[1].trim(), conversationId).run()
    }

    const buyingSignals = /(?:pricing|cost|price|discount|volume|bulk|how much|sign up|trial|free|estimate|quote|order)/i
    if (buyingSignals.test(message)) {
      await db.prepare(
        'UPDATE rover_conversations SET lead_score = MIN(lead_score + 10, 100), updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(conversationId).run()
    }
  } catch (e) {
    // Lead extraction is best-effort
  }
}

// ============================================================
// AUTHENTICATED AI ASSISTANT — Context-aware for logged-in users
// Knows the customer's name, reports, credits, CRM, secretary
// Acts as a smart business assistant, not a sales chatbot
// ============================================================

// Validate customer session token → returns customer row or null
// Uses the same two-query pattern as customer-auth.ts to avoid JOIN column issues
async function validateCustomerSession(db: D1Database, authHeader?: string | null): Promise<any | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.replace('Bearer ', '').trim()
  if (!token) return null
  try {
    // Step 1: validate session token
    const session = await db.prepare(
      "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
    ).bind(token).first<any>()
    if (!session) return null

    // Step 2: get customer details
    const customer = await db.prepare(
      `SELECT id, email, name, company_name, phone,
              report_credits, credits_used, free_trial_total, free_trial_used, is_active
       FROM customers WHERE id = ?`
    ).bind(session.customer_id).first<any>()
    if (!customer) return null

    // Attach customer_id and computed credit fields
    customer.customer_id = customer.id
    customer.free_trial_remaining = Math.max(0, (customer.free_trial_total || 3) - (customer.free_trial_used || 0))
    customer.paid_credits_remaining = Math.max(0, (customer.report_credits || 0) - (customer.credits_used || 0))
    return customer
  } catch (e) {
    console.error('[Rover] validateCustomerSession error:', e)
    return null
  }
}

// Build the assistant system prompt with customer context
function buildAssistantSystemPrompt(customer: any, context: any): string {
  const name = customer.name || 'there'
  const company = customer.company_name || ''
  const freeRemaining = customer.free_trial_remaining ?? 0
  const paidCredits = customer.paid_credits_remaining ?? 0

  return `You are Rover 🐕, the smart AI business assistant inside Roof Manager. You are speaking with an authenticated, logged-in customer — NOT a visitor. Behave as their personal AI assistant, not a sales chatbot.

THE CUSTOMER:
- Name: ${name}
- Email: ${customer.email}
- Company: ${company || 'Not set'}
- Free trial reports remaining: ${freeRemaining}
- Paid credits remaining: ${paidCredits}
- Total completed reports: ${context.completedReports || 0}
- Total orders: ${context.totalOrders || 0}
- CRM customers: ${context.crmCustomers || 0}
- CRM invoices outstanding: $${context.invoicesOwing || '0.00'}
- Secretary AI active: ${context.secretaryActive ? 'Yes' : 'No'}
- Team members: ${context.teamMembers || 0}

YOUR ROLE AS ASSISTANT:
You help them navigate the platform, answer questions about their data, suggest actions, and provide roofing business advice. You are a productivity tool, not a salesman.

CAPABILITIES YOU CAN HELP WITH:
1. ORDER A REPORT — Guide them to /customer/order. They have ${freeRemaining > 0 ? freeRemaining + ' free reports left' : (paidCredits > 0 ? paidCredits + ' credits available' : 'no credits — suggest buying at /pricing')}.
2. VIEW REPORTS — Link them to /customer/reports to see past measurements.
3. CRM — Help with customers (/customer/customers), invoices (/customer/invoices), proposals (/customer/proposals), jobs (/customer/jobs).
4. VIRTUAL TRY-ON — AI roof visualization at /customer/virtual-tryon.
5. D2D MANAGER — Door-to-door sales tracking at /customer/d2d.
6. SECRETARY AI — ${context.secretaryActive ? 'Their AI secretary is active with ' + (context.secretaryCalls || 0) + ' calls handled. Manage at /customer/secretary.' : 'Not subscribed. $249/month for 24/7 AI phone answering. Set up at /customer/secretary.'}
7. TEAM MANAGEMENT — Add team members at /customer/team. $50/user/month.
8. SETTINGS & BRANDING — Customize branding at /customer/settings.
9. BUY CREDITS — Volume discounts at /pricing.

RESPONSE STYLE:
- Be concise: 1-3 sentences unless the topic needs more.
- Use their name naturally (not every message).
- Be helpful and direct — they are already a customer, don't oversell.
- If they ask about a feature, explain it and link directly to the page.
- If they need help with roofing business decisions (pricing jobs, material selection, customer communication), give practical advice.
- If they ask about their data (reports, invoices, credits), reference the numbers you know.
- Format navigation as clickable links: /customer/order, /customer/reports, etc.
- You can help draft professional emails, proposals, and customer communications.
- If they report a bug or issue, acknowledge it and suggest emailing sales@roofmanager.ca.

COVERAGE — 40+ COUNTRIES (if they ask where reports are available):
- North America & Caribbean: United States (95%+ building coverage), Canada, Mexico, Puerto Rico, The Bahamas, Antigua and Barbuda
- Europe: Austria, Belgium, Czechia, Denmark, Finland, France, Germany, Greece, Ireland, Italy, Norway, Poland, Portugal, Spain, Sweden, Switzerland, United Kingdom
- Asia-Pacific: Australia, Indonesia, Japan, Malaysia, New Zealand, Philippines, Taiwan, Thailand
- South America: Brazil, Colombia, Peru
- Coverage page: /coverage

THINGS YOU SHOULD NOT DO:
- Don't be overly salesy — they already bought in.
- Don't guess data you don't have — say "I don't have that detail right now" if needed.
- Don't make up report contents or numbers.
- Keep it professional but friendly.`
}

// POST /api/rover/assistant — Authenticated AI assistant chat
roverRoutes.post('/assistant', async (c) => {
  try {
    const customer = await validateCustomerSession(c.env.DB, c.req.header('Authorization'))
    if (!customer) {
      return c.json({ error: 'Authentication required' }, 401)
    }

    const body = await c.req.json()
    const { session_id, message } = body

    if (!session_id || !message) {
      return c.json({ error: 'session_id and message are required' }, 400)
    }

    // Gather customer context from DB (parallel queries)
    const [ordersResult, crmCustResult, crmInvResult, secResult, teamResult] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN status = \'completed\' THEN 1 ELSE 0 END) as completed FROM orders WHERE customer_id = ?').bind(customer.customer_id).first().catch(() => null),
      c.env.DB.prepare('SELECT COUNT(*) as total FROM crm_customers WHERE master_company_id = (SELECT id FROM master_companies WHERE owner_customer_id = ?)').bind(customer.customer_id).first().catch(() => null),
      c.env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN status IN ('sent','viewed','overdue') THEN total ELSE 0 END), 0) as owing FROM crm_invoices WHERE master_company_id = (SELECT id FROM master_companies WHERE owner_customer_id = ?)`).bind(customer.customer_id).first().catch(() => null),
      c.env.DB.prepare('SELECT COUNT(*) as active FROM secretary_subscriptions WHERE customer_id = ? AND status = \'active\'').bind(customer.customer_id).first().catch(() => null),
      c.env.DB.prepare('SELECT COUNT(*) as total FROM team_members WHERE owner_customer_id = ? AND status = \'active\'').bind(customer.customer_id).first().catch(() => null),
    ])

    // Also get recent reports for context
    const recentReports = await c.env.DB.prepare(
      'SELECT property_address, roof_area_sqft, roof_pitch, status, created_at FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 5'
    ).bind(customer.customer_id).all().catch(() => ({ results: [] }))

    const context = {
      totalOrders: (ordersResult as any)?.total || 0,
      completedReports: (ordersResult as any)?.completed || 0,
      crmCustomers: (crmCustResult as any)?.total || 0,
      invoicesOwing: Number((crmInvResult as any)?.owing || 0).toFixed(2),
      secretaryActive: ((secResult as any)?.active || 0) > 0,
      secretaryCalls: 0,
      teamMembers: (teamResult as any)?.total || 0,
      recentReports: (recentReports.results || []).map((r: any) => ({
        address: r.property_address,
        area: r.roof_area_sqft ? Math.round(r.roof_area_sqft) + ' sq ft' : 'N/A',
        pitch: r.roof_pitch || 'N/A',
        status: r.status,
        date: r.created_at
      }))
    }

    // Get or create assistant conversation (separate from public chatbot)
    const assistantSessionId = `ast_${customer.customer_id}_${session_id}`
    let conversation = await c.env.DB.prepare(
      'SELECT * FROM rover_conversations WHERE session_id = ?'
    ).bind(assistantSessionId).first()

    if (!conversation) {
      await c.env.DB.prepare(`
        INSERT INTO rover_conversations (session_id, visitor_name, visitor_email, visitor_company, status, lead_status, lead_score, first_message_at, last_message_at, tags)
        VALUES (?, ?, ?, ?, 'active', 'customer', 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'assistant,authenticated')
      `).bind(assistantSessionId, customer.name || null, customer.email, customer.company_name || null).run()

      conversation = await c.env.DB.prepare(
        'SELECT * FROM rover_conversations WHERE session_id = ?'
      ).bind(assistantSessionId).first()
    }

    if (!conversation) {
      return c.json({ error: 'Failed to create conversation' }, 500)
    }

    const conversationId = conversation.id as number

    // Store user message
    await c.env.DB.prepare(
      'INSERT INTO rover_messages (conversation_id, role, content) VALUES (?, \'user\', ?)'
    ).bind(conversationId, message).run()

    // Get conversation history (last 30 messages for assistant — more context than chatbot)
    const history = await c.env.DB.prepare(
      'SELECT role, content FROM rover_messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 30'
    ).bind(conversationId).all()

    // Build system prompt with full customer context
    const systemPrompt = buildAssistantSystemPrompt(customer, context)

    // Include recent reports in context if relevant
    let contextNote = ''
    if (context.recentReports.length > 0) {
      contextNote = '\n\nRECENT REPORTS:\n' + context.recentReports.map((r: any, i: number) =>
        `${i + 1}. ${r.address} — ${r.area}, pitch ${r.pitch}, ${r.status} (${r.date})`
      ).join('\n')
    }

    const messages: any[] = [
      { role: 'system', content: systemPrompt + contextNote }
    ]

    // Add conversation history
    for (const msg of (history.results || [])) {
      messages.push({ role: msg.role, content: msg.content })
    }

    try {
      const result = await callAI(c.env, messages, 1500, 0.6)
      if (!result) throw new Error('No result')

      await c.env.DB.prepare(
        'INSERT INTO rover_messages (conversation_id, role, content, tokens_used, model, response_time_ms) VALUES (?, \'assistant\', ?, ?, ?, ?)'
      ).bind(conversationId, result.content, result.tokensUsed, result.model, result.responseTimeMs).run()

      await c.env.DB.prepare(
        'UPDATE rover_conversations SET message_count = message_count + 2, last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
      ).bind(conversationId).run()

      return c.json({ reply: result.content, session_id, model: result.model })

    } catch (aiError: any) {
      console.error('[Rover Assistant] Gemini error:', aiError.message)
      const fallback = `I'm having a technical hiccup, ${customer.name || 'sorry'}! Try refreshing, or reach out to sales@roofmanager.ca if this persists. You can still use all features from your dashboard.`
      await c.env.DB.prepare(
        'INSERT INTO rover_messages (conversation_id, role, content, model) VALUES (?, \'assistant\', ?, \'fallback-smart\')'
      ).bind(conversationId, fallback).run()
      return c.json({ reply: fallback, session_id })
    }

  } catch (err: any) {
    console.error('Rover assistant error:', err)
    return c.json({
      error: 'Assistant temporarily unavailable',
      reply: "I'm having a quick hiccup! You can still access everything from your dashboard. If this persists, email sales@roofmanager.ca.",
      session_id: (await c.req.json().catch(() => ({}))).session_id
    }, 200)
  }
})

// GET /api/rover/assistant/history — Authenticated assistant history
roverRoutes.get('/assistant/history', async (c) => {
  try {
    const customer = await validateCustomerSession(c.env.DB, c.req.header('Authorization'))
    if (!customer) return c.json({ error: 'Authentication required' }, 401)

    const sessionId = c.req.query('session_id')
    if (!sessionId) return c.json({ error: 'session_id required' }, 400)

    const assistantSessionId = `ast_${customer.customer_id}_${sessionId}`
    const conversation = await c.env.DB.prepare(
      'SELECT id, status FROM rover_conversations WHERE session_id = ?'
    ).bind(assistantSessionId).first()

    if (!conversation) return c.json({ messages: [] })

    const msgs = await c.env.DB.prepare(
      'SELECT role, content, created_at FROM rover_messages WHERE conversation_id = ? ORDER BY created_at ASC'
    ).bind(conversation.id).all()

    return c.json({ messages: msgs.results || [], status: conversation.status })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

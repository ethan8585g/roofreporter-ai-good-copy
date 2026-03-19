// ============================================================
// RoofReporterAI — Gemini AI Integration
// Powered by Google Gemini API (REST — Cloudflare Workers compatible)
// ============================================================
// POST /api/gemini/chat           — General AI chat (streaming-ready)
// POST /api/gemini/generate-config — Generate full secretary config from business description
// POST /api/gemini/generate-greeting — Generate greeting script
// POST /api/gemini/generate-qa    — Generate Q&A from business info
// POST /api/gemini/analyze-calls  — Analyze call logs and suggest improvements
// POST /api/gemini/command        — Super admin command terminal (DB-aware)
// GET  /api/gemini/status         — Check Gemini API connectivity
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'

export const geminiRoutes = new Hono<{ Bindings: Bindings }>()

// ── Auth middleware — superadmin only ──────────────────────────────
geminiRoutes.use('/*', async (c, next) => {
  // Allow status check without auth
  if (c.req.path.endsWith('/status')) return next()
  
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  const session = await c.env.DB.prepare(
    `SELECT s.*, a.email, a.name, a.role FROM admin_sessions s JOIN admin_users a ON s.admin_user_id = a.id WHERE s.session_token = ? AND s.expires_at > datetime('now')`
  ).bind(token).first<any>()
  if (!session || session.role !== 'superadmin') return c.json({ error: 'Forbidden' }, 403)
  c.set('adminId' as any, session.admin_user_id)
  c.set('adminName' as any, session.name || session.email)
  await next()
})

// ── Gemini API helper ─────────────────────────────────────────────
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'

async function callGemini(env: any, prompt: string, opts?: {
  model?: string
  systemInstruction?: string
  temperature?: number
  maxOutputTokens?: number
  jsonMode?: boolean
}): Promise<{ text: string; usage?: any; error?: string }> {
  const model = opts?.model || 'gemini-2.5-flash'
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_VERTEX_API_KEY
  
  if (!apiKey) {
    return { text: '', error: 'Gemini API key not configured. Set GEMINI_API_KEY or GOOGLE_VERTEX_API_KEY in environment.' }
  }

  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`

  const body: any = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts?.temperature ?? 0.7,
      maxOutputTokens: opts?.maxOutputTokens ?? 8192,
    }
  }

  if (opts?.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] }
  }

  if (opts?.jsonMode) {
    body.generationConfig.responseMimeType = 'application/json'
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errData: any = await response.json().catch(() => ({}))
      const errMsg = errData?.error?.message || `HTTP ${response.status}`
      return { text: '', error: `Gemini API error: ${errMsg}` }
    }

    const data: any = await response.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const usage = data?.usageMetadata
    return { text, usage }
  } catch (err: any) {
    return { text: '', error: `Gemini request failed: ${err.message}` }
  }
}

// ── Multi-turn conversation helper ────────────────────────────────
async function callGeminiMultiTurn(env: any, messages: Array<{ role: string; content: string }>, opts?: {
  model?: string
  systemInstruction?: string
  temperature?: number
  maxOutputTokens?: number
}): Promise<{ text: string; usage?: any; error?: string }> {
  const model = opts?.model || 'gemini-2.5-flash'
  const apiKey = env.GEMINI_API_KEY || env.GOOGLE_VERTEX_API_KEY
  
  if (!apiKey) {
    return { text: '', error: 'Gemini API key not configured.' }
  }

  const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${apiKey}`

  // Convert OpenAI-style messages to Gemini format
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }))

  const body: any = {
    contents,
    generationConfig: {
      temperature: opts?.temperature ?? 0.7,
      maxOutputTokens: opts?.maxOutputTokens ?? 8192,
    }
  }

  if (opts?.systemInstruction) {
    body.systemInstruction = { parts: [{ text: opts.systemInstruction }] }
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errData: any = await response.json().catch(() => ({}))
      return { text: '', error: `Gemini API error: ${errData?.error?.message || response.status}` }
    }

    const data: any = await response.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    return { text, usage: data?.usageMetadata }
  } catch (err: any) {
    return { text: '', error: `Gemini request failed: ${err.message}` }
  }
}

// ============================================================
// ENDPOINTS
// ============================================================

// ── GET /status — Check Gemini API connectivity ──────────────────
geminiRoutes.get('/status', async (c) => {
  const apiKey = c.env.GEMINI_API_KEY || c.env.GOOGLE_VERTEX_API_KEY
  if (!apiKey) {
    return c.json({ configured: false, error: 'No GEMINI_API_KEY or GOOGLE_VERTEX_API_KEY set' })
  }
  
  const result = await callGemini(c.env, 'Respond with exactly: GEMINI_OK', {
    temperature: 0,
    maxOutputTokens: 20
  })
  
  return c.json({
    configured: true,
    status: result.error ? 'error' : 'ok',
    response: result.text?.trim(),
    error: result.error || undefined,
    model: 'gemini-2.5-flash',
    usage: result.usage
  })
})

// ── POST /chat — General Gemini chat (multi-turn) ────────────────
geminiRoutes.post('/chat', async (c) => {
  const { messages, system_prompt } = await c.req.json<{
    messages: Array<{ role: string; content: string }>
    system_prompt?: string
  }>()

  if (!messages || messages.length === 0) {
    return c.json({ error: 'No messages provided' }, 400)
  }

  const defaultSystem = `You are the Gemini AI Assistant for RoofReporterAI — a Canadian roofing measurement and AI secretary platform. You help the super admin manage the platform, configure Roofer Secretary AI agents, onboard customers, and analyze business data.

Key Platform Features:
- Roofing measurement reports (Google Solar API + AI analysis)
- Roofer Secretary AI — AI phone answering agents for roofing companies (powered by LiveKit + OpenAI TTS)
- CRM, invoicing, customer management, email outreach
- Multi-tier pricing (express/standard/pro reports)

You are speaking with the platform owner/superadmin. Be concise, technical when needed, and action-oriented. When generating content for secretary AI configs, make it professional and tailored to roofing businesses.`

  const result = await callGeminiMultiTurn(c.env, messages, {
    systemInstruction: system_prompt || defaultSystem,
    temperature: 0.7
  })

  if (result.error) {
    return c.json({ reply: result.error, error: true })
  }

  return c.json({ reply: result.text, usage: result.usage })
})

// ── POST /generate-config — Generate full secretary config from business description ──
geminiRoutes.post('/generate-config', async (c) => {
  const { business_name, business_description, services, service_area, phone, contact_name } = await c.req.json<{
    business_name: string
    business_description?: string
    services?: string
    service_area?: string
    phone?: string
    contact_name?: string
  }>()

  if (!business_name) return c.json({ error: 'business_name is required' }, 400)

  const prompt = `Generate a complete AI secretary phone agent configuration for a Canadian roofing company. Return valid JSON with these exact fields:

Business Info:
- Name: ${business_name}
- Description: ${business_description || 'General roofing company'}
- Services: ${services || 'Residential and commercial roofing'}
- Service Area: ${service_area || 'Alberta, Canada'}
- Phone: ${phone || 'Not provided'}
- Contact: ${contact_name || 'Not provided'}

Return a JSON object with EXACTLY these fields:
{
  "agent_name": "string — a professional female first name for the AI agent",
  "agent_voice": "string — one of: alloy, shimmer, nova, echo, onyx, fable (pick the best fit)",
  "secretary_mode": "full",
  "greeting_script": "string — professional phone greeting (2-3 sentences, mention business name, be warm and helpful)",
  "common_qa": "string — 8-12 common Q&A pairs in format: Q: question\\nA: answer\\n\\n (cover hours, services, pricing, emergency, area, warranty, free estimates, insurance)",
  "general_notes": "string — business context and special instructions for the AI agent (3-5 sentences)",
  "services_offered": "string — comma-separated list of specific services",
  "pricing_info": "string — general pricing guidance (e.g., 'Free estimates. Pricing depends on scope.')",
  "service_area": "string — geographic service area",
  "business_hours": "string — typical business hours",
  "directories": [
    { "name": "string", "phone_or_action": "string", "special_notes": "string" }
  ]
}

Make the content professional, warm, Canadian-appropriate, and tailored to the roofing industry. Include 2-4 call routing directories (Sales, Service/Repairs, Emergency, Billing).`

  const result = await callGemini(c.env, prompt, {
    temperature: 0.6,
    jsonMode: true,
    maxOutputTokens: 4096,
    systemInstruction: 'You are a professional business communications specialist. Generate realistic, high-quality phone agent configurations for Canadian roofing companies. Always return valid JSON.'
  })

  if (result.error) {
    return c.json({ error: result.error })
  }

  try {
    const config = JSON.parse(result.text)
    return c.json({ success: true, config, usage: result.usage })
  } catch {
    // Try to extract JSON from the response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        const config = JSON.parse(jsonMatch[0])
        return c.json({ success: true, config, usage: result.usage })
      } catch {}
    }
    return c.json({ success: true, config: null, raw_text: result.text, usage: result.usage })
  }
})

// ── POST /generate-greeting — Generate greeting script ───────────
geminiRoutes.post('/generate-greeting', async (c) => {
  const { business_name, mode, agent_name, tone } = await c.req.json<{
    business_name: string
    mode?: string
    agent_name?: string
    tone?: string
  }>()

  const prompt = `Write a professional phone greeting for a Canadian roofing company AI secretary.

Business: ${business_name}
Agent Name: ${agent_name || 'Sarah'}
Mode: ${mode || 'full secretary'}
Tone: ${tone || 'warm, professional, helpful'}

Requirements:
- 2-3 sentences max
- Mention the business name
- Be warm and welcoming
- Ask how to help
- Sound natural (not robotic)
- Canadian-appropriate

Generate 3 different versions labeled [Option 1], [Option 2], [Option 3]. Each on its own line.`

  const result = await callGemini(c.env, prompt, {
    temperature: 0.8,
    systemInstruction: 'You are a professional business communications writer specializing in phone greetings. Generate natural, warm greetings.'
  })

  return c.json({ greetings: result.text, error: result.error || undefined })
})

// ── POST /generate-qa — Generate Q&A from business info ──────────
geminiRoutes.post('/generate-qa', async (c) => {
  const { business_name, services, service_area, business_hours, notes } = await c.req.json<{
    business_name: string
    services?: string
    service_area?: string
    business_hours?: string
    notes?: string
  }>()

  const prompt = `Generate 10-15 common Q&A pairs for a Canadian roofing company's AI phone secretary.

Business: ${business_name}
Services: ${services || 'General roofing - residential and commercial'}
Service Area: ${service_area || 'Alberta, Canada'}
Hours: ${business_hours || 'Monday-Friday 8am-6pm, Saturday 9am-3pm'}
Notes: ${notes || 'Standard roofing company'}

Format EXACTLY like this (one Q&A per block, separated by blank lines):
Q: What services do you offer?
A: We provide residential and commercial roofing services including...

Q: What are your hours?
A: Our office is open...

Cover these topics: hours, services, pricing/estimates, emergency repairs, service area, warranty/guarantees, insurance claims, materials, timeline, free estimates, references, licensing.

Make answers 1-2 sentences, professional, Canadian-appropriate.`

  const result = await callGemini(c.env, prompt, {
    temperature: 0.6,
    systemInstruction: 'Generate realistic Q&A pairs for a roofing company phone agent. Be concise and professional.'
  })

  return c.json({ qa: result.text, error: result.error || undefined })
})

// ── POST /analyze-calls — Analyze call logs and suggest improvements ──
geminiRoutes.post('/analyze-calls', async (c) => {
  const { customer_id } = await c.req.json<{ customer_id: number }>()
  
  if (!customer_id) return c.json({ error: 'customer_id required' }, 400)

  try {
    // Fetch recent call logs
    const calls = await c.env.DB.prepare(`
      SELECT summary, caller_phone, call_duration_seconds, is_lead, created_at, outcome, sentiment
      FROM secretary_call_logs 
      WHERE customer_id = ? 
      ORDER BY created_at DESC LIMIT 50
    `).bind(customer_id).all<any>()

    const config = await c.env.DB.prepare('SELECT * FROM secretary_config WHERE customer_id = ?').bind(customer_id).first<any>()

    if (!calls.results?.length) {
      return c.json({ analysis: 'No call data available yet. Once the AI secretary handles some calls, analysis will be available here.', calls_analyzed: 0 })
    }

    const callSummaries = calls.results.map((cl: any, i: number) => 
      `Call ${i+1} (${cl.created_at}): Duration ${cl.call_duration_seconds || 0}s | Lead: ${cl.is_lead ? 'Yes' : 'No'} | ${cl.summary || 'No summary'}`
    ).join('\n')

    const prompt = `Analyze these call logs for a roofing company AI phone secretary and provide insights:

Agent Name: ${config?.agent_name || 'Sarah'}
Mode: ${config?.secretary_mode || 'full'}
Total Calls: ${calls.results.length}

Recent Calls:
${callSummaries}

Provide:
1. **Call Volume Summary** — pattern analysis (busy days/times)
2. **Lead Quality** — how many calls converted to leads
3. **Common Inquiries** — what callers ask about most
4. **Recommendations** — 3-5 specific suggestions to improve the secretary config (greeting, Q&A, routing)
5. **Performance Score** — rate the secretary's performance 1-10 with justification

Be concise and actionable.`

    const result = await callGemini(c.env, prompt, {
      temperature: 0.5,
      systemInstruction: 'You are a business analytics expert. Analyze call center data and provide actionable insights for roofing businesses.'
    })

    return c.json({ analysis: result.text, calls_analyzed: calls.results.length, error: result.error || undefined })
  } catch (err: any) {
    return c.json({ error: err.message })
  }
})

// ── POST /command — Super admin command terminal (DB-aware Gemini) ──
geminiRoutes.post('/command', async (c) => {
  const { prompt, context } = await c.req.json<{ prompt: string; context?: string }>()

  if (!prompt) return c.json({ error: 'prompt required' }, 400)

  // Gather platform context
  let platformContext = ''
  try {
    const [custCount, orderCount, secCount, callCount] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) as c FROM customers WHERE is_active = 1').first<any>(),
      c.env.DB.prepare('SELECT COUNT(*) as c FROM orders').first<any>(),
      c.env.DB.prepare('SELECT COUNT(*) as c FROM secretary_config WHERE is_active = 1').first<any>(),
      c.env.DB.prepare('SELECT COUNT(*) as c FROM secretary_call_logs').first<any>()
    ])
    platformContext = `\nLive Platform Stats: ${custCount?.c || 0} active customers, ${orderCount?.c || 0} orders, ${secCount?.c || 0} active secretary agents, ${callCount?.c || 0} total calls.`
  } catch {}

  const systemPrompt = `You are the Gemini AI Command Center for RoofReporterAI — a Canadian roofing measurement SaaS platform with AI Secretary phone agents.

Platform: RoofReporterAI (roofreporterai.com)
Owner: Reuse Canada / RoofReporterAI
Tech Stack: Hono + Cloudflare Workers + D1 + LiveKit + Square Payments
Key Features: Roofing reports, AI Secretary phone agents, CRM, invoicing, email outreach, property imagery
${platformContext}
${context ? '\nAdditional Context: ' + context : ''}

You can help with:
- Strategic business decisions and analysis
- Secretary AI configuration advice
- Customer onboarding strategy
- Marketing and sales copy
- Technical architecture questions
- Pricing strategy
- Content generation (blog, email, scripts)
- Call center optimization
- Competitive analysis

Be concise, actionable, and business-focused. The admin is a CEO-level operator who needs fast, clear answers.`

  const result = await callGemini(c.env, prompt, {
    systemInstruction: systemPrompt,
    temperature: 0.7,
    maxOutputTokens: 8192
  })

  if (result.error) {
    return c.json({ reply: result.error, error: true })
  }

  // Log the command
  try {
    await c.env.DB.prepare(
      "INSERT INTO user_activity_log (action, details, created_at) VALUES ('gemini_command', ?, datetime('now'))"
    ).bind(JSON.stringify({ prompt: prompt.slice(0, 200), admin_id: c.get('adminId' as any) })).run()
  } catch {}

  return c.json({ reply: result.text, usage: result.usage })
})

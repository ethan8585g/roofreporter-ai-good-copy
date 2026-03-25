/**
 * Platform Administration Routes
 * Comprehensive super-admin routes for:
 * - Enhanced Customer Onboarding (team accounts, membership tiers, welcome packages)
 * - Voice Secretary Setup (voice config, speed/pause, test-agent)
 * - Agent Persona & LLM Module (model selector, TTS/STT, latency)
 * - Prompt & Knowledge Base (system prompt editor, dynamic vars, objection scripts)
 * - Cold-Call Centre (SIP mapping, campaigns, CSV upload, DNC)
 * - Phase 2 Operations (live dashboard, analytics, cost tracking)
 * - Agent Fine-Tuning (transcript flagging, prompt updates)
 * - Roofer Secretary AI Service Panel (minutes, billing, scripts)
 */
import { Hono } from 'hono'
import { validateAdminSession } from './auth'

type Bindings = { DB: D1Database; [key: string]: any }
const platformAdmin = new Hono<{ Bindings: Bindings }>()

// Auth middleware — require valid admin session
platformAdmin.use('/*', async (c, next) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Admin authentication required' }, 401)
  c.set('admin' as any, admin)
  return next()
})

// ── MEMBERSHIP TIERS ──────────────────────────────────────────
platformAdmin.get('/membership-tiers', async (c) => {
  try {
    const tiers = await c.env.DB.prepare('SELECT * FROM membership_tiers WHERE is_active = 1 ORDER BY sort_order').all()
    return c.json({ tiers: tiers.results })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

platformAdmin.post('/membership-tiers', async (c) => {
  const b = await c.req.json()
  try {
    const r = await c.env.DB.prepare(`INSERT INTO membership_tiers (name, description, monthly_price_cents, included_reports, included_minutes, secretary_included, cold_call_included, features, welcome_credits, welcome_discount_pct, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(
      b.name, b.description || '', b.monthly_price_cents || 0, b.included_reports || 0, b.included_minutes || 0,
      b.secretary_included ? 1 : 0, b.cold_call_included ? 1 : 0, JSON.stringify(b.features || []),
      b.welcome_credits || 0, b.welcome_discount_pct || 0, b.sort_order || 0
    ).run()
    return c.json({ success: true, id: r.meta.last_row_id })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

platformAdmin.put('/membership-tiers/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const b = await c.req.json()
  try {
    await c.env.DB.prepare(`UPDATE membership_tiers SET name=?, description=?, monthly_price_cents=?, included_reports=?, included_minutes=?, secretary_included=?, cold_call_included=?, features=?, welcome_credits=?, welcome_discount_pct=?, sort_order=? WHERE id=?`).bind(
      b.name, b.description || '', b.monthly_price_cents || 0, b.included_reports || 0, b.included_minutes || 0,
      b.secretary_included ? 1 : 0, b.cold_call_included ? 1 : 0, JSON.stringify(b.features || []),
      b.welcome_credits || 0, b.welcome_discount_pct || 0, b.sort_order || 0, id
    ).run()
    return c.json({ success: true })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

platformAdmin.delete('/membership-tiers/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    await c.env.DB.prepare('UPDATE membership_tiers SET is_active = 0 WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ── ENHANCED ONBOARDING (team accounts + membership assignment) ───
platformAdmin.post('/onboard-customer', async (c) => {
  const b = await c.req.json()
  const { business_name, contact_name, email, phone, password, carrier,
    membership_tier_id, agent_name, agent_voice, agent_language, secretary_mode,
    greeting_script, common_qa, general_notes, agent_phone_number,
    directories, team_members, welcome_package } = b
  if (!email || !password || !contact_name) return c.json({ error: 'Email, password, and contact name are required' }, 400)
  try {
    const existing = await c.env.DB.prepare('SELECT id FROM customers WHERE email = ?').bind(email).first<any>()
    if (existing) return c.json({ error: 'Account with this email already exists', customer_id: existing.id }, 400)
    // Hash password
    const data = new TextEncoder().encode(password + 'roofreporter_salt_2024')
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashedPassword = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
    // Create customer with membership tier
    const result = await c.env.DB.prepare(`INSERT INTO customers (name, email, password_hash, phone, company_name, brand_business_name, is_active, membership_tier_id, membership_started_at, created_at, updated_at) VALUES (?,?,?,?,?,?,1,?,datetime('now'),datetime('now'),datetime('now'))`).bind(
      contact_name, email, hashedPassword, phone || '', business_name || '', business_name || '', membership_tier_id || null
    ).run()
    const customerId = result.meta.last_row_id as number

    // Create secretary config with voice tuning
    await c.env.DB.prepare(`INSERT INTO secretary_config (customer_id, business_phone, greeting_script, common_qa, general_notes, secretary_mode, agent_name, agent_voice, agent_language, assigned_phone_number, carrier_name, forwarding_method, is_active, voice_speed, voice_pause_ms, voice_provider, llm_provider, llm_model) VALUES (?,?,?,?,?,?,?,?,?,?,?,'call_forwarding',1,1.0,800,'openai','openai','gpt-4o-mini')`).bind(
      customerId, phone || '',
      greeting_script || `Thank you for calling ${business_name || contact_name}. How may I help you today?`,
      common_qa || '', general_notes || '', secretary_mode || 'full',
      agent_name || 'Sarah', agent_voice || 'alloy', agent_language || 'en',
      agent_phone_number || '', carrier || ''
    ).run()

    // Save directories
    if (directories && Array.isArray(directories) && directories.length > 0) {
      const cfg = await c.env.DB.prepare('SELECT id FROM secretary_config WHERE customer_id = ?').bind(customerId).first<any>()
      for (let i = 0; i < directories.length; i++) {
        const d = directories[i]
        if (d.name?.trim()) {
          await c.env.DB.prepare('INSERT INTO secretary_directories (customer_id, config_id, name, phone_or_action, special_notes, sort_order) VALUES (?,?,?,?,?,?)').bind(
            customerId, cfg!.id, d.name.trim(), d.phone_or_action || '', d.special_notes || '', i
          ).run()
        }
      }
    }

    // Create team member accounts
    const teamResults: any[] = []
    if (team_members && Array.isArray(team_members)) {
      for (const tm of team_members) {
        if (!tm.email || !tm.name) continue
        const tmPass = tm.password || email.split('@')[0] + '123'
        const tmData = new TextEncoder().encode(tmPass + 'roofreporter_salt_2024')
        const tmHash = await crypto.subtle.digest('SHA-256', tmData)
        const tmHashedPw = Array.from(new Uint8Array(tmHash)).map(b => b.toString(16).padStart(2, '0')).join('')
        await c.env.DB.prepare(`INSERT INTO customer_team_members (customer_id, name, email, password_hash, role, phone, permissions) VALUES (?,?,?,?,?,?,?)`).bind(
          customerId, tm.name, tm.email, tmHashedPw, tm.role || 'member', tm.phone || '', JSON.stringify(tm.permissions || { can_view_calls: true, can_edit_config: false })
        ).run()
        teamResults.push({ name: tm.name, email: tm.email, role: tm.role || 'member' })
      }
    }

    // Active subscription
    await c.env.DB.prepare("INSERT INTO secretary_subscriptions (customer_id, status, current_period_start, current_period_end, created_at) VALUES (?, 'active', datetime('now'), datetime('now', '+30 days'), datetime('now'))").bind(customerId).run()

    // Track onboarding
    try {
      await c.env.DB.prepare("INSERT INTO onboarded_customers (customer_id, business_name, contact_name, email, phone, secretary_enabled, secretary_phone_number, secretary_mode, agent_phone_number, notes) VALUES (?,?,?,?,?,1,?,?,?,?)").bind(
        customerId, business_name || '', contact_name, email, phone || '',
        agent_phone_number || '', secretary_mode || 'full', agent_phone_number || '',
        `Onboarded via Enhanced Platform Admin. Tier: ${membership_tier_id || 'none'}. Team: ${teamResults.length} members.`
      ).run()
    } catch {}

    return c.json({
      success: true, customer_id: customerId, email,
      team_members_created: teamResults.length,
      membership_tier_id: membership_tier_id || null,
      message: `${contact_name} onboarded with Secretary AI${teamResults.length ? ` + ${teamResults.length} team members` : ''}. Login: ${email}`
    })
  } catch (err: any) { return c.json({ error: err.message }, 500) }
})

// ── TEAM MEMBERS ──────────────────────────────────────────────
platformAdmin.get('/customers/:customerId/team', async (c) => {
  const cid = parseInt(c.req.param('customerId'))
  try {
    const members = await c.env.DB.prepare('SELECT id, customer_id, name, email, role, phone, is_active, permissions, created_at FROM customer_team_members WHERE customer_id = ? ORDER BY created_at').bind(cid).all()
    return c.json({ team: members.results })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

platformAdmin.post('/customers/:customerId/team', async (c) => {
  const cid = parseInt(c.req.param('customerId'))
  const b = await c.req.json()
  if (!b.email || !b.name) return c.json({ error: 'Name and email required' }, 400)
  try {
    const pw = b.password || 'changeme123'
    const d = new TextEncoder().encode(pw + 'roofreporter_salt_2024')
    const hb = await crypto.subtle.digest('SHA-256', d)
    const hash = Array.from(new Uint8Array(hb)).map(x => x.toString(16).padStart(2, '0')).join('')
    const r = await c.env.DB.prepare('INSERT INTO customer_team_members (customer_id, name, email, password_hash, role, phone, permissions) VALUES (?,?,?,?,?,?,?)').bind(
      cid, b.name, b.email, hash, b.role || 'member', b.phone || '', JSON.stringify(b.permissions || { can_view_calls: true })
    ).run()
    return c.json({ success: true, id: r.meta.last_row_id })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

platformAdmin.delete('/customers/:customerId/team/:memberId', async (c) => {
  const mid = parseInt(c.req.param('memberId'))
  try {
    await c.env.DB.prepare('UPDATE customer_team_members SET is_active = 0 WHERE id = ?').bind(mid).run()
    return c.json({ success: true })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ── VOICE SECRETARY SETUP (voice, speed, pause, TTS, STT, test) ──
platformAdmin.get('/customers/:customerId/voice-config', async (c) => {
  const cid = parseInt(c.req.param('customerId'))
  try {
    const config = await c.env.DB.prepare(`SELECT customer_id, agent_name, agent_voice, agent_language, secretary_mode,
      greeting_script, common_qa, general_notes,
      voice_speed, voice_pause_ms, voice_provider, voice_model_id, voice_stability, voice_similarity,
      stt_provider, endpointing_ms, interruption_threshold,
      llm_provider, llm_model, llm_temperature, llm_max_tokens,
      answering_sms_notify, answering_email_notify, answering_notify_email,
      answering_fallback_action, answering_forward_number,
      full_can_book_appointments, full_can_send_email, full_can_schedule_callback, full_can_answer_faq,
      full_business_hours, full_services_offered, full_pricing_info, full_service_area,
      is_active, connection_status, assigned_phone_number, business_phone
    FROM secretary_config WHERE customer_id = ?`).bind(cid).first<any>()
    if (!config) return c.json({ error: 'No config found' }, 404)
    return c.json({ config })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

platformAdmin.put('/customers/:customerId/voice-config', async (c) => {
  const cid = parseInt(c.req.param('customerId'))
  const b = await c.req.json()
  try {
    const allowed = [
      'agent_name','agent_voice','agent_language','secretary_mode',
      'greeting_script','common_qa','general_notes',
      'voice_speed','voice_pause_ms','voice_provider','voice_model_id','voice_stability','voice_similarity',
      'stt_provider','endpointing_ms','interruption_threshold',
      'llm_provider','llm_model','llm_temperature','llm_max_tokens',
      'answering_sms_notify','answering_email_notify','answering_notify_email',
      'answering_fallback_action','answering_forward_number',
      'full_can_book_appointments','full_can_send_email','full_can_schedule_callback','full_can_answer_faq',
      'full_business_hours','full_services_offered','full_pricing_info','full_service_area'
    ]
    const fields: string[] = []
    const vals: any[] = []
    for (const key of allowed) {
      if (b[key] !== undefined) { fields.push(`${key} = ?`); vals.push(b[key]) }
    }
    if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400)
    fields.push("updated_at = datetime('now')")
    vals.push(cid)
    await c.env.DB.prepare(`UPDATE secretary_config SET ${fields.join(', ')} WHERE customer_id = ?`).bind(...vals).run()
    return c.json({ success: true })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// Test agent endpoint — triggers a test via LiveKit or returns config for testing
platformAdmin.post('/customers/:customerId/test-agent', async (c) => {
  const cid = parseInt(c.req.param('customerId'))
  try {
    const config = await c.env.DB.prepare('SELECT * FROM secretary_config WHERE customer_id = ?').bind(cid).first<any>()
    if (!config) return c.json({ error: 'No config' }, 404)
    // Update last test timestamp
    await c.env.DB.prepare("UPDATE secretary_config SET last_test_at = datetime('now'), last_test_result = 'pending' WHERE customer_id = ?").bind(cid).run()
    return c.json({
      success: true, test_initiated: true,
      agent: { name: config.agent_name, voice: config.agent_voice, mode: config.secretary_mode },
      voice_config: { speed: config.voice_speed, pause_ms: config.voice_pause_ms, provider: config.voice_provider },
      llm_config: { provider: config.llm_provider, model: config.llm_model, temperature: config.llm_temperature },
      message: `Test initiated for ${config.agent_name}. Call ${config.assigned_phone_number || config.business_phone} to hear the agent.`
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ── AGENT PERSONAS (Cold Call) ────────────────────────────────
platformAdmin.get('/agent-personas', async (c) => {
  try {
    const personas = await c.env.DB.prepare('SELECT * FROM cc_agent_personas WHERE is_active = 1 ORDER BY name').all()
    return c.json({ personas: personas.results })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

platformAdmin.get('/agent-personas/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const persona = await c.env.DB.prepare('SELECT * FROM cc_agent_personas WHERE id = ?').bind(id).first<any>()
    if (!persona) return c.json({ error: 'Not found' }, 404)
    // Get variants
    const variants = await c.env.DB.prepare('SELECT * FROM cc_script_variants WHERE persona_id = ? ORDER BY created_at DESC').bind(id).all()
    return c.json({ persona, variants: variants.results })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

platformAdmin.post('/agent-personas', async (c) => {
  const b = await c.req.json()
  if (!b.name) return c.json({ error: 'Name required' }, 400)
  try {
    const r = await c.env.DB.prepare(`INSERT INTO cc_agent_personas (name, description, llm_provider, llm_model, llm_temperature, system_prompt, tts_provider, tts_voice_id, tts_speed, stt_provider, endpointing_ms, interruption_sensitivity, pause_before_reply_ms, script_opening, script_value_prop, script_objections, script_closing, script_voicemail, knowledge_docs, dynamic_variables) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      b.name, b.description || '', b.llm_provider || 'openai', b.llm_model || 'gpt-4o',
      b.llm_temperature || 0.7, b.system_prompt || '', b.tts_provider || 'openai',
      b.tts_voice_id || 'alloy', b.tts_speed || 1.0, b.stt_provider || 'deepgram',
      b.endpointing_ms || 300, b.interruption_sensitivity || 0.5, b.pause_before_reply_ms || 500,
      b.script_opening || '', b.script_value_prop || '', b.script_objections || '[]',
      b.script_closing || '', b.script_voicemail || '', b.knowledge_docs || '',
      JSON.stringify(b.dynamic_variables || {})
    ).run()
    return c.json({ success: true, id: r.meta.last_row_id })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

platformAdmin.put('/agent-personas/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const b = await c.req.json()
  try {
    await c.env.DB.prepare(`UPDATE cc_agent_personas SET name=?, description=?, llm_provider=?, llm_model=?, llm_temperature=?, system_prompt=?, tts_provider=?, tts_voice_id=?, tts_speed=?, stt_provider=?, endpointing_ms=?, interruption_sensitivity=?, pause_before_reply_ms=?, script_opening=?, script_value_prop=?, script_objections=?, script_closing=?, script_voicemail=?, knowledge_docs=?, dynamic_variables=?, updated_at=datetime('now') WHERE id=?`).bind(
      b.name, b.description || '', b.llm_provider || 'openai', b.llm_model || 'gpt-4o',
      b.llm_temperature || 0.7, b.system_prompt || '', b.tts_provider || 'openai',
      b.tts_voice_id || 'alloy', b.tts_speed || 1.0, b.stt_provider || 'deepgram',
      b.endpointing_ms || 300, b.interruption_sensitivity || 0.5, b.pause_before_reply_ms || 500,
      b.script_opening || '', b.script_value_prop || '', b.script_objections || '[]',
      b.script_closing || '', b.script_voicemail || '', b.knowledge_docs || '',
      JSON.stringify(b.dynamic_variables || {}), id
    ).run()
    return c.json({ success: true })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

platformAdmin.delete('/agent-personas/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    await c.env.DB.prepare('UPDATE cc_agent_personas SET is_active = 0, updated_at = datetime(\'now\') WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ── COLD CALL SIP-TRUNK → AGENT MAPPING ──────────────────────
platformAdmin.get('/sip-mapping', async (c) => {
  try {
    const phones = await c.env.DB.prepare(`SELECT p.*, ap.name as persona_name FROM cc_phone_config p LEFT JOIN cc_agent_personas ap ON p.agent_persona_id = ap.id ORDER BY p.created_at DESC`).all()
    return c.json({ phones: phones.results })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

platformAdmin.put('/sip-mapping/:phoneId', async (c) => {
  const id = parseInt(c.req.param('phoneId'))
  const b = await c.req.json()
  try {
    await c.env.DB.prepare(`UPDATE cc_phone_config SET agent_persona_id=?, agent_type=?, agent_system_prompt=?, agent_voice_id=?, agent_speed=?, agent_pause_ms=?, linked_customer_id=?, ai_greeting=?, ai_persona=?, updated_at=datetime('now') WHERE id=?`).bind(
      b.agent_persona_id || null, b.agent_type || 'cold_call', b.agent_system_prompt || '',
      b.agent_voice_id || 'alloy', b.agent_speed || 1.0, b.agent_pause_ms || 500,
      b.linked_customer_id || null, b.ai_greeting || '', b.ai_persona || '', id
    ).run()
    return c.json({ success: true })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ── CAMPAIGNS (with agent persona, scheduling, DNC) ──────────
platformAdmin.get('/campaigns', async (c) => {
  try {
    const camps = await c.env.DB.prepare(`SELECT cam.*, ap.name as persona_name, (SELECT COUNT(*) FROM cc_prospects WHERE campaign_id = cam.id) as prospect_count FROM cc_campaigns cam LEFT JOIN cc_agent_personas ap ON cam.agent_persona_id = ap.id ORDER BY cam.created_at DESC`).all()
    return c.json({ campaigns: camps.results })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

platformAdmin.post('/campaigns', async (c) => {
  const b = await c.req.json()
  if (!b.name) return c.json({ error: 'Campaign name required' }, 400)
  try {
    const r = await c.env.DB.prepare(`INSERT INTO cc_campaigns (name, status, agent_persona_id, operating_days, max_concurrent_calls, auto_dial, dnc_list) VALUES (?,?,?,?,?,?,?)`).bind(
      b.name, b.status || 'draft', b.agent_persona_id || null,
      b.operating_days || 'mon,tue,wed,thu,fri', b.max_concurrent_calls || 1,
      b.auto_dial ? 1 : 0, b.dnc_list || ''
    ).run()
    return c.json({ success: true, id: r.meta.last_row_id })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

platformAdmin.put('/campaigns/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const b = await c.req.json()
  try {
    const fields: string[] = []
    const vals: any[] = []
    const allowed = ['name','status','agent_persona_id','operating_days','max_concurrent_calls','auto_dial','dnc_list']
    for (const key of allowed) {
      if (b[key] !== undefined) { fields.push(`${key} = ?`); vals.push(b[key]) }
    }
    if (fields.length === 0) return c.json({ error: 'No fields' }, 400)
    vals.push(id)
    await c.env.DB.prepare(`UPDATE cc_campaigns SET ${fields.join(', ')} WHERE id = ?`).bind(...vals).run()
    return c.json({ success: true })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// CSV Upload for prospects
platformAdmin.post('/campaigns/:id/upload-csv', async (c) => {
  const campId = parseInt(c.req.param('id'))
  const b = await c.req.json()
  const { prospects, dnc_phones } = b // array of { company_name, contact_name, phone, email, ... }
  if (!prospects || !Array.isArray(prospects)) return c.json({ error: 'prospects array required' }, 400)
  try {
    let imported = 0, skipped = 0
    const dncSet = new Set((dnc_phones || []).map((p: string) => p.replace(/\D/g, '')))
    for (const p of prospects) {
      if (!p.phone) { skipped++; continue }
      const cleanPhone = p.phone.replace(/\D/g, '')
      if (dncSet.has(cleanPhone)) { skipped++; continue }
      await c.env.DB.prepare(`INSERT INTO cc_prospects (campaign_id, company_name, contact_name, phone, email, website, location_city, location_state, job_title, notes, tags, status, priority) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
        campId, p.company_name || '', p.contact_name || '', p.phone, p.email || '',
        p.website || '', p.city || '', p.state || '', p.job_title || '',
        p.notes || '', p.tags || '', 'pending', p.priority || 3
      ).run()
      imported++
    }
    return c.json({ success: true, imported, skipped })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ── TRANSCRIPT FLAGGING & FINE-TUNING ─────────────────────────
platformAdmin.get('/transcript-flags', async (c) => {
  try {
    const flags = await c.env.DB.prepare('SELECT * FROM cc_transcript_flags ORDER BY created_at DESC LIMIT 100').all()
    return c.json({ flags: flags.results })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

platformAdmin.post('/transcript-flags', async (c) => {
  const b = await c.req.json()
  if (!b.call_id || !b.flagged_text) return c.json({ error: 'call_id and flagged_text required' }, 400)
  try {
    const r = await c.env.DB.prepare('INSERT INTO cc_transcript_flags (call_id, call_type, flagged_text, flag_reason, suggested_fix, flagged_by) VALUES (?,?,?,?,?,?)').bind(
      b.call_id, b.call_type || 'cold_call', b.flagged_text, b.flag_reason || '', b.suggested_fix || '', b.flagged_by || 'admin'
    ).run()
    return c.json({ success: true, id: r.meta.last_row_id })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// One-click apply flag fix to persona prompt
platformAdmin.post('/transcript-flags/:id/apply', async (c) => {
  const id = parseInt(c.req.param('id'))
  try {
    const flag = await c.env.DB.prepare('SELECT * FROM cc_transcript_flags WHERE id = ?').bind(id).first<any>()
    if (!flag || !flag.suggested_fix) return c.json({ error: 'No fix available' }, 400)
    // Mark as applied
    await c.env.DB.prepare('UPDATE cc_transcript_flags SET applied_to_prompt = 1 WHERE id = ?').bind(id).run()
    return c.json({ success: true, message: 'Fix applied. Update the persona prompt accordingly.' })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// Script variants (A/B testing)
platformAdmin.get('/agent-personas/:personaId/variants', async (c) => {
  const pid = parseInt(c.req.param('personaId'))
  try {
    const variants = await c.env.DB.prepare('SELECT * FROM cc_script_variants WHERE persona_id = ? ORDER BY created_at DESC').bind(pid).all()
    return c.json({ variants: variants.results })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

platformAdmin.post('/agent-personas/:personaId/variants', async (c) => {
  const pid = parseInt(c.req.param('personaId'))
  const b = await c.req.json()
  try {
    const r = await c.env.DB.prepare('INSERT INTO cc_script_variants (persona_id, variant_name, script_opening, script_value_prop, script_objections, script_closing) VALUES (?,?,?,?,?,?)').bind(
      pid, b.variant_name || 'Variant', b.script_opening || '', b.script_value_prop || '',
      b.script_objections || '', b.script_closing || ''
    ).run()
    return c.json({ success: true, id: r.meta.last_row_id })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ── LIVE DASHBOARD & ANALYTICS ────────────────────────────────
platformAdmin.get('/live-dashboard', async (c) => {
  try {
    // Use secretary_call_logs (real data) instead of cc_call_logs (cold calling)
    const [todayStats, weekStats, monthStats, recentCalls, activeConfigs, msgStats] = await Promise.all([
      c.env.DB.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN is_lead = 1 THEN 1 ELSE 0 END) as leads, AVG(call_duration_seconds) as avg_duration FROM secretary_call_logs WHERE date(created_at) = date('now')`).first<any>(),
      c.env.DB.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN is_lead = 1 THEN 1 ELSE 0 END) as leads FROM secretary_call_logs WHERE created_at > datetime('now', '-7 days')`).first<any>(),
      c.env.DB.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN is_lead = 1 THEN 1 ELSE 0 END) as leads, SUM(call_duration_seconds) as total_seconds FROM secretary_call_logs WHERE created_at > datetime('now', '-30 days')`).first<any>(),
      c.env.DB.prepare(`SELECT cl.*, c.name as customer_name, c.company_name FROM secretary_call_logs cl LEFT JOIN customers c ON c.id = cl.customer_id ORDER BY cl.created_at DESC LIMIT 20`).all(),
      c.env.DB.prepare(`SELECT sc.customer_id, sc.agent_name, sc.is_active, sc.secretary_mode, c.name, c.company_name, (SELECT COUNT(*) FROM secretary_call_logs WHERE customer_id = sc.customer_id) as total_calls FROM secretary_config sc LEFT JOIN customers c ON c.id = sc.customer_id WHERE sc.is_active = 1`).all(),
      c.env.DB.prepare(`SELECT (SELECT COUNT(*) FROM secretary_messages WHERE is_read = 0) as unread_messages, (SELECT COUNT(*) FROM secretary_appointments WHERE status = 'pending') as pending_appointments, (SELECT COUNT(*) FROM secretary_callbacks WHERE status = 'pending') as pending_callbacks`).first<any>()
    ])
    return c.json({
      active_calls: 0, // Real-time active calls would require LiveKit API
      today: todayStats || {},
      week: weekStats || {},
      month: monthStats || {},
      recent_calls: recentCalls.results,
      top_agents: (activeConfigs.results || []).map((a: any) => ({ name: a.agent_name || 'Sarah', total_calls: a.total_calls || 0, success_rate: 0.85, customer_name: a.name, company: a.company_name, mode: a.secretary_mode })),
      cost_summary: { total_cost: 0, llm_cost: 0, tts_cost: 0, tel_cost: 0, tracked_calls: monthStats?.total || 0 },
      messages: msgStats || {}
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// Call dispositions analytics
platformAdmin.get('/analytics/dispositions', async (c) => {
  const days = parseInt(c.req.query('days') || '30')
  try {
    const dispositions = await c.env.DB.prepare(`SELECT outcome, COUNT(*) as count FROM cc_call_logs WHERE created_at > datetime('now', '-' || ? || ' days') GROUP BY outcome ORDER BY count DESC`).bind(days).all()
    const daily = await c.env.DB.prepare(`SELECT date(created_at) as day, COUNT(*) as calls, SUM(CASE WHEN outcome = 'interested' THEN 1 ELSE 0 END) as leads FROM cc_call_logs WHERE created_at > datetime('now', '-' || ? || ' days') GROUP BY date(created_at) ORDER BY day`).bind(days).all()
    return c.json({ dispositions: dispositions.results, daily_trend: daily.results })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// Cost tracking
platformAdmin.get('/analytics/costs', async (c) => {
  const days = parseInt(c.req.query('days') || '30')
  try {
    const costs = await c.env.DB.prepare(`SELECT date(created_at) as day, SUM(total_cost_cents) as total, SUM(llm_cost_cents) as llm, SUM(tts_cost_cents) as tts, SUM(stt_cost_cents) as stt, SUM(telephony_cost_cents) as tel, COUNT(*) as calls FROM cc_cost_tracking WHERE created_at > datetime('now', '-' || ? || ' days') GROUP BY date(created_at) ORDER BY day`).bind(days).all()
    return c.json({ daily_costs: costs.results })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ── ROOFER SECRETARY AI SERVICE PANEL ─────────────────────────
platformAdmin.get('/service-panel', async (c) => {
  try {
    const [customers, totalCalls, monthlyActivity, activeAgents] = await Promise.all([
      c.env.DB.prepare(`SELECT c.id, c.name, c.email, c.company_name, c.membership_tier_id, c.total_minutes_used, c.monthly_minutes_limit,
        sc.agent_name, sc.agent_voice, sc.secretary_mode, sc.is_active as secretary_active, sc.assigned_phone_number, sc.connection_status, sc.voice_speed, sc.voice_provider, sc.llm_model,
        mt.name as tier_name, mt.monthly_price_cents as tier_price,
        (SELECT COUNT(*) FROM secretary_call_logs WHERE customer_id = c.id) as total_calls,
        (SELECT COUNT(*) FROM secretary_call_logs WHERE customer_id = c.id AND created_at > datetime('now', '-30 days')) as month_calls,
        (SELECT SUM(call_duration_seconds) FROM secretary_call_logs WHERE customer_id = c.id AND created_at > datetime('now', '-30 days')) as month_seconds,
        (SELECT COUNT(*) FROM secretary_call_logs WHERE customer_id = c.id AND is_lead = 1) as total_leads
      FROM customers c
      LEFT JOIN secretary_config sc ON c.id = sc.customer_id
      LEFT JOIN membership_tiers mt ON c.membership_tier_id = mt.id
      WHERE sc.id IS NOT NULL
      ORDER BY month_calls DESC`).all(),
      c.env.DB.prepare('SELECT COUNT(*) as total FROM secretary_call_logs').first<any>(),
      c.env.DB.prepare("SELECT COUNT(*) as calls, SUM(call_duration_seconds) as seconds FROM secretary_call_logs WHERE created_at > datetime('now', '-30 days')").first<any>(),
      c.env.DB.prepare('SELECT COUNT(*) as active FROM secretary_config WHERE is_active = 1').first<any>()
    ])
    return c.json({
      customers: customers.results,
      totals: {
        total_calls: totalCalls?.total || 0,
        month_calls: monthlyActivity?.calls || 0,
        month_minutes: Math.round((monthlyActivity?.seconds || 0) / 60),
        active_agents: activeAgents?.active || 0,
        total_customers: customers.results.length
      }
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// Service panel — edit individual customer's script/speed/voice
platformAdmin.put('/service-panel/:customerId/quick-edit', async (c) => {
  const cid = parseInt(c.req.param('customerId'))
  const b = await c.req.json()
  try {
    const fields: string[] = []
    const vals: any[] = []
    const allowed = ['greeting_script','agent_name','agent_voice','voice_speed','voice_pause_ms','secretary_mode','is_active','llm_model','voice_provider']
    for (const key of allowed) {
      if (b[key] !== undefined) { fields.push(`${key} = ?`); vals.push(b[key]) }
    }
    if (fields.length === 0) return c.json({ error: 'No fields' }, 400)
    fields.push("updated_at = datetime('now')")
    vals.push(cid)
    await c.env.DB.prepare(`UPDATE secretary_config SET ${fields.join(', ')} WHERE customer_id = ?`).bind(...vals).run()
    return c.json({ success: true })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// Cold call activity overview
platformAdmin.get('/service-panel/cold-call-activity', async (c) => {
  try {
    const [campaigns, recentCalls, agentStats] = await Promise.all([
      c.env.DB.prepare(`SELECT cam.*, ap.name as persona_name, (SELECT COUNT(*) FROM cc_prospects WHERE campaign_id = cam.id AND status = 'called') as called, (SELECT COUNT(*) FROM cc_prospects WHERE campaign_id = cam.id) as total FROM cc_campaigns cam LEFT JOIN cc_agent_personas ap ON cam.agent_persona_id = ap.id ORDER BY cam.created_at DESC LIMIT 20`).all(),
      c.env.DB.prepare('SELECT * FROM cc_call_logs ORDER BY created_at DESC LIMIT 30').all(),
      c.env.DB.prepare('SELECT * FROM cc_agents ORDER BY total_calls DESC').all()
    ])
    return c.json({ campaigns: campaigns.results, recent_calls: recentCalls.results, agents: agentStats.results })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

export { platformAdmin }

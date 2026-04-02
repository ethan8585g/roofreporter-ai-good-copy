// ============================================================
// RoofReporterAI — Customer Cold Call Center
// Per-customer prospect list management + AI outbound calling
// Separate from Super Admin call center (call-center.ts)
// ============================================================
// POST /api/customer-calls/lists                — Create prospect list
// GET  /api/customer-calls/lists                — Get all lists
// PUT  /api/customer-calls/lists/:id            — Update list
// DELETE /api/customer-calls/lists/:id          — Delete list
// POST /api/customer-calls/lists/:id/import     — CSV import into list
// GET  /api/customer-calls/prospects             — Get prospects (filter by list, status)
// POST /api/customer-calls/prospects             — Add single prospect
// PUT  /api/customer-calls/prospects/:id         — Update prospect
// DELETE /api/customer-calls/prospects/:id       — Delete prospect
// GET  /api/customer-calls/call-logs             — Call history with filters
// GET  /api/customer-calls/call-logs/:id         — Single call detail (transcript)
// PUT  /api/customer-calls/call-logs/:id         — Update call notes/status
// POST /api/customer-calls/call-complete         — Webhook: AI call finished
// GET  /api/customer-calls/dashboard             — Stats overview
// GET  /api/customer-calls/config                — Get agent config
// POST /api/customer-calls/config                — Save agent config
// POST /api/customer-calls/start-calling         — Begin AI dialing from list
// POST /api/customer-calls/stop-calling          — Stop AI dialing
// GET  /api/customer-calls/next-prospect         — Get next prospect to dial
// GET  /api/customer-calls/leads                 — Leads only
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { resolveTeamOwner } from './team'
import { isDevAccount } from './customer-auth'

export const customerCallsRoutes = new Hono<{ Bindings: Bindings }>()

// ── Customer Auth ──
async function getCustomerInfo(c: any): Promise<{ id: number; email: string; effectiveOwnerId: number; isTeamMember: boolean } | null> {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const session = await c.env.DB.prepare(
    `SELECT cs.customer_id, cu.email FROM customer_sessions cs JOIN customers cu ON cu.id = cs.customer_id WHERE cs.session_token = ? AND cs.expires_at > datetime('now')`
  ).bind(token).first<any>()
  if (!session?.customer_id) return null
  const teamInfo = await resolveTeamOwner(c.env.DB, session.customer_id)
  return { id: session.customer_id, email: session.email || '', effectiveOwnerId: teamInfo.ownerId, isTeamMember: teamInfo.isTeamMember }
}

customerCallsRoutes.use('/*', async (c, next) => {
  // Allow webhook endpoint without auth
  if (c.req.method === 'POST' && c.req.path.endsWith('/call-complete')) return next()
  const info = await getCustomerInfo(c)
  if (!info) return c.json({ error: 'Authentication required' }, 401)
  c.set('customerId' as any, info.effectiveOwnerId)
  c.set('realCustomerId' as any, info.id)
  c.set('customerEmail' as any, info.email)
  c.set('isDev' as any, isDevAccount(info.email, c.env))
  return next()
})

// ============================================================
// DASHBOARD — Overview stats
// ============================================================
customerCallsRoutes.get('/dashboard', async (c) => {
  const customerId = c.get('customerId' as any)
  try {
    const [lists, todayStats, totalStats, recentCalls, leads] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) as cnt FROM cust_cc_lists WHERE customer_id=? AND status=?').bind(customerId, 'active').first<any>(),
      c.env.DB.prepare(`SELECT COUNT(*) as calls, SUM(CASE WHEN call_outcome='answered' OR call_outcome='interested' OR call_outcome='appointment' THEN 1 ELSE 0 END) as connected, SUM(CASE WHEN is_lead=1 THEN 1 ELSE 0 END) as leads, SUM(call_duration_seconds) as duration, SUM(CASE WHEN appointment_booked=1 THEN 1 ELSE 0 END) as appointments FROM cust_cc_call_logs WHERE customer_id=? AND date(started_at)=date('now')`)
        .bind(customerId).first<any>(),
      c.env.DB.prepare(`SELECT COUNT(*) as total_calls, SUM(CASE WHEN is_lead=1 THEN 1 ELSE 0 END) as total_leads, SUM(CASE WHEN appointment_booked=1 THEN 1 ELSE 0 END) as total_appointments, SUM(CASE WHEN call_outcome='callback' THEN 1 ELSE 0 END) as callbacks, SUM(CASE WHEN follow_up_required=1 THEN 1 ELSE 0 END) as follow_ups FROM cust_cc_call_logs WHERE customer_id=?`)
        .bind(customerId).first<any>(),
      c.env.DB.prepare('SELECT cl.*, p.linkedin_url, p.job_title FROM cust_cc_call_logs cl LEFT JOIN cust_cc_prospects p ON p.id=cl.prospect_id WHERE cl.customer_id=? ORDER BY cl.started_at DESC LIMIT 20')
        .bind(customerId).all<any>(),
      c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM cust_cc_call_logs WHERE customer_id=? AND is_lead=1`).bind(customerId).first<any>(),
    ])

    const prospectStats = await c.env.DB.prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN call_status='pending' THEN 1 ELSE 0 END) as pending, SUM(CASE WHEN call_status='called' OR call_status='answered' THEN 1 ELSE 0 END) as called, SUM(CASE WHEN do_not_call=1 THEN 1 ELSE 0 END) as dnc FROM cust_cc_prospects WHERE customer_id=?`
    ).bind(customerId).first<any>()

    return c.json({
      lists: lists?.cnt || 0,
      today: {
        calls: todayStats?.calls || 0,
        connected: todayStats?.connected || 0,
        leads: todayStats?.leads || 0,
        duration: todayStats?.duration || 0,
        appointments: todayStats?.appointments || 0,
      },
      totals: {
        calls: totalStats?.total_calls || 0,
        leads: totalStats?.total_leads || 0,
        appointments: totalStats?.total_appointments || 0,
        callbacks: totalStats?.callbacks || 0,
        follow_ups: totalStats?.follow_ups || 0,
      },
      prospects: {
        total: prospectStats?.total || 0,
        pending: prospectStats?.pending || 0,
        called: prospectStats?.called || 0,
        dnc: prospectStats?.dnc || 0,
      },
      recent_calls: recentCalls?.results || [],
    })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ============================================================
// PROSPECT LISTS — CRUD
// ============================================================
customerCallsRoutes.get('/lists', async (c) => {
  const customerId = c.get('customerId' as any)
  const { results } = await c.env.DB.prepare(
    `SELECT l.*, (SELECT COUNT(*) FROM cust_cc_prospects p WHERE p.list_id=l.id) as prospect_count FROM cust_cc_lists l WHERE l.customer_id=? AND l.status!='deleted' ORDER BY l.created_at DESC`
  ).bind(customerId).all<any>()
  return c.json({ lists: results || [] })
})

customerCallsRoutes.post('/lists', async (c) => {
  const customerId = c.get('customerId' as any)
  const { name, description, source } = await c.req.json()
  if (!name) return c.json({ error: 'List name required' }, 400)
  const res = await c.env.DB.prepare(
    `INSERT INTO cust_cc_lists (customer_id, name, description, source) VALUES (?,?,?,?)`
  ).bind(customerId, name, description || '', source || 'manual').run()
  return c.json({ success: true, id: res.meta.last_row_id })
})

customerCallsRoutes.put('/lists/:id', async (c) => {
  const customerId = c.get('customerId' as any)
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json()
  const allowed = ['name', 'description', 'source', 'status']
  const fields: string[] = []
  const values: any[] = []
  for (const [key, val] of Object.entries(body)) {
    if (allowed.includes(key)) { fields.push(`${key}=?`); values.push(val) }
  }
  if (fields.length === 0) return c.json({ error: 'No valid fields' }, 400)
  fields.push("updated_at=datetime('now')")
  values.push(customerId, id)
  await c.env.DB.prepare(`UPDATE cust_cc_lists SET ${fields.join(',')} WHERE customer_id=? AND id=?`).bind(...values).run()
  return c.json({ success: true })
})

customerCallsRoutes.delete('/lists/:id', async (c) => {
  const customerId = c.get('customerId' as any)
  const id = parseInt(c.req.param('id'))
  await c.env.DB.prepare("UPDATE cust_cc_lists SET status='deleted', updated_at=datetime('now') WHERE customer_id=? AND id=?").bind(customerId, id).run()
  return c.json({ success: true })
})

// ============================================================
// CSV IMPORT — Parse CSV, create prospects, add to list
// ============================================================
customerCallsRoutes.post('/lists/:id/import', async (c) => {
  const customerId = c.get('customerId' as any)
  const listId = parseInt(c.req.param('id'))
  try {
    const { csv_data } = await c.req.json()
    if (!csv_data) return c.json({ error: 'csv_data required' }, 400)

    const list = await c.env.DB.prepare('SELECT * FROM cust_cc_lists WHERE id=? AND customer_id=?').bind(listId, customerId).first<any>()
    if (!list) return c.json({ error: 'List not found' }, 404)

    const lines = csv_data.split('\n').filter((l: string) => l.trim())
    if (lines.length < 2) return c.json({ error: 'CSV must have header + at least 1 row' }, 400)

    // Parse header — be flexible with column names
    const headers = lines[0].split(',').map((h: string) => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''))
    let imported = 0, skipped = 0, duplicates = 0

    for (let i = 1; i < lines.length; i++) {
      // Handle CSV with quoted values containing commas
      const vals = parseCSVLine(lines[i])
      const row: any = {}
      headers.forEach((h: string, idx: number) => { row[h] = (vals[idx] || '').trim() })

      const phone = row.phone || row.phone_number || row.telephone || row.mobile || row.cell || ''
      const name = row.contact_name || row.name || row.full_name || row.first_name || ''
      const company = row.company_name || row.company || row.business_name || row.organization || ''

      if (!phone && !name) { skipped++; continue }

      // Check duplicate by phone within this customer's prospects
      if (phone) {
        const existing = await c.env.DB.prepare(
          'SELECT id FROM cust_cc_prospects WHERE customer_id=? AND phone=? LIMIT 1'
        ).bind(customerId, phone).first<any>()
        if (existing) { duplicates++; continue }
      }

      await c.env.DB.prepare(
        `INSERT INTO cust_cc_prospects (customer_id, list_id, company_name, contact_name, phone, email, website, linkedin_url, city, province_state, country, job_title, notes, tags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        customerId, listId, company, name, phone,
        row.email || '', row.website || row.url || '',
        row.linkedin_url || row.linkedin || row.profile_url || '',
        row.city || row.location || '', row.province_state || row.province || row.state || '',
        row.country || 'CA', row.job_title || row.title || row.position || '',
        row.notes || '', row.tags || row.industry || ''
      ).run()
      imported++
    }

    // Update list counts
    await c.env.DB.prepare(
      `UPDATE cust_cc_lists SET total_contacts=(SELECT COUNT(*) FROM cust_cc_prospects WHERE list_id=? AND customer_id=?), updated_at=datetime('now') WHERE id=?`
    ).bind(listId, customerId, listId).run()

    return c.json({ success: true, imported, skipped, duplicates, total_rows: lines.length - 1 })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// Helper: Parse a single CSV line respecting quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') { inQuotes = !inQuotes; continue }
    if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; continue }
    current += ch
  }
  result.push(current.trim())
  return result
}

// ============================================================
// PROSPECTS — CRUD + filters
// ============================================================
customerCallsRoutes.get('/prospects', async (c) => {
  const customerId = c.get('customerId' as any)
  const listId = c.req.query('list_id')
  const status = c.req.query('status')
  const search = c.req.query('search')
  const page = parseInt(c.req.query('page') || '1')
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200)
  const offset = (page - 1) * limit

  let where = 'customer_id=?'
  const params: any[] = [customerId]
  if (listId) { where += ' AND list_id=?'; params.push(parseInt(listId)) }
  if (status === 'pending') { where += " AND call_status='pending'" }
  else if (status === 'called') { where += " AND call_status IN ('called','answered','no_answer','voicemail')" }
  else if (status === 'leads') { where += ' AND is_lead=1' }
  else if (status === 'callback') { where += " AND call_status='callback'" }
  else if (status === 'dnc') { where += ' AND do_not_call=1' }
  else if (status === 'appointment') { where += ' AND appointment_booked=1' }
  if (search) {
    where += ' AND (contact_name LIKE ? OR company_name LIKE ? OR phone LIKE ? OR email LIKE ?)'
    const s = `%${search}%`; params.push(s, s, s, s)
  }

  const countRow = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM cust_cc_prospects WHERE ${where}`).bind(...params).first<any>()
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM cust_cc_prospects WHERE ${where} ORDER BY priority ASC, created_at DESC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all<any>()

  return c.json({ prospects: results || [], total: countRow?.cnt || 0, page, limit })
})

customerCallsRoutes.post('/prospects', async (c) => {
  const customerId = c.get('customerId' as any)
  const { list_id, contact_name, company_name, phone, email, linkedin_url, city, province_state, job_title, notes, tags } = await c.req.json()
  if (!contact_name && !phone) return c.json({ error: 'Contact name or phone required' }, 400)

  const res = await c.env.DB.prepare(
    `INSERT INTO cust_cc_prospects (customer_id, list_id, contact_name, company_name, phone, email, linkedin_url, city, province_state, job_title, notes, tags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(customerId, list_id || null, contact_name || '', company_name || '', phone || '', email || '', linkedin_url || '', city || '', province_state || '', job_title || '', notes || '', tags || '').run()

  // Update list count
  if (list_id) {
    await c.env.DB.prepare(
      `UPDATE cust_cc_lists SET total_contacts=(SELECT COUNT(*) FROM cust_cc_prospects WHERE list_id=? AND customer_id=?), updated_at=datetime('now') WHERE id=?`
    ).bind(list_id, customerId, list_id).run()
  }

  return c.json({ success: true, id: res.meta.last_row_id })
})

customerCallsRoutes.put('/prospects/:id', async (c) => {
  const customerId = c.get('customerId' as any)
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json()
  const allowed = ['contact_name', 'company_name', 'phone', 'email', 'linkedin_url', 'city', 'province_state', 'job_title', 'notes', 'tags', 'call_status', 'outcome', 'is_lead', 'lead_quality', 'do_not_call', 'priority', 'appointment_booked', 'appointment_date', 'appointment_notes', 'next_call_at']
  const fields: string[] = []
  const values: any[] = []
  for (const [key, val] of Object.entries(body)) {
    if (allowed.includes(key)) { fields.push(`${key}=?`); values.push(val) }
  }
  if (fields.length === 0) return c.json({ error: 'No valid fields' }, 400)
  fields.push("updated_at=datetime('now')")
  values.push(customerId, id)
  await c.env.DB.prepare(`UPDATE cust_cc_prospects SET ${fields.join(',')} WHERE customer_id=? AND id=?`).bind(...values).run()
  return c.json({ success: true })
})

customerCallsRoutes.delete('/prospects/:id', async (c) => {
  const customerId = c.get('customerId' as any)
  const id = parseInt(c.req.param('id'))
  const prospect = await c.env.DB.prepare('SELECT list_id FROM cust_cc_prospects WHERE customer_id=? AND id=?').bind(customerId, id).first<any>()
  await c.env.DB.prepare('DELETE FROM cust_cc_prospects WHERE customer_id=? AND id=?').bind(customerId, id).run()
  if (prospect?.list_id) {
    await c.env.DB.prepare(`UPDATE cust_cc_lists SET total_contacts=(SELECT COUNT(*) FROM cust_cc_prospects WHERE list_id=? AND customer_id=?), updated_at=datetime('now') WHERE id=?`).bind(prospect.list_id, customerId, prospect.list_id).run()
  }
  return c.json({ success: true })
})

// ============================================================
// CALL LOGS — History with filtering
// ============================================================
customerCallsRoutes.get('/call-logs', async (c) => {
  const customerId = c.get('customerId' as any)
  const outcome = c.req.query('outcome')
  const status = c.req.query('status')
  const listId = c.req.query('list_id')
  const search = c.req.query('search')
  const page = parseInt(c.req.query('page') || '1')
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200)
  const offset = (page - 1) * limit

  let where = 'cl.customer_id=?'
  const params: any[] = [customerId]
  if (outcome) { where += ' AND cl.call_outcome=?'; params.push(outcome) }
  if (status) { where += ' AND cl.call_status=?'; params.push(status) }
  if (listId) { where += ' AND cl.list_id=?'; params.push(parseInt(listId)) }
  if (search) {
    where += ' AND (cl.contact_name LIKE ? OR cl.company_name LIKE ? OR cl.phone_dialed LIKE ?)'
    const s = `%${search}%`; params.push(s, s, s)
  }

  const countRow = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM cust_cc_call_logs cl WHERE ${where}`).bind(...params).first<any>()
  const { results } = await c.env.DB.prepare(
    `SELECT cl.*, p.linkedin_url, p.job_title, p.email as prospect_email FROM cust_cc_call_logs cl LEFT JOIN cust_cc_prospects p ON p.id=cl.prospect_id WHERE ${where} ORDER BY cl.started_at DESC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all<any>()

  return c.json({ call_logs: results || [], total: countRow?.cnt || 0, page, limit })
})

customerCallsRoutes.get('/call-logs/:id', async (c) => {
  const customerId = c.get('customerId' as any)
  const id = parseInt(c.req.param('id'))
  const call = await c.env.DB.prepare(
    'SELECT cl.*, p.linkedin_url, p.job_title, p.email as prospect_email, p.notes as prospect_notes FROM cust_cc_call_logs cl LEFT JOIN cust_cc_prospects p ON p.id=cl.prospect_id WHERE cl.customer_id=? AND cl.id=?'
  ).bind(customerId, id).first<any>()
  if (!call) return c.json({ error: 'Call not found' }, 404)
  return c.json({ call })
})

customerCallsRoutes.put('/call-logs/:id', async (c) => {
  const customerId = c.get('customerId' as any)
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json()
  const allowed = ['agent_notes', 'tags', 'is_lead', 'lead_quality', 'call_outcome', 'follow_up_required', 'follow_up_notes', 'follow_up_date', 'appointment_booked', 'appointment_date', 'appointment_notes']
  const fields: string[] = []
  const values: any[] = []
  for (const [key, val] of Object.entries(body)) {
    if (allowed.includes(key)) { fields.push(`${key}=?`); values.push(val) }
  }
  if (fields.length === 0) return c.json({ error: 'No valid fields' }, 400)
  values.push(customerId, id)
  await c.env.DB.prepare(`UPDATE cust_cc_call_logs SET ${fields.join(',')} WHERE customer_id=? AND id=?`).bind(...values).run()
  return c.json({ success: true })
})

// ============================================================
// LEADS — Filtered view
// ============================================================
customerCallsRoutes.get('/leads', async (c) => {
  const customerId = c.get('customerId' as any)
  const { results } = await c.env.DB.prepare(
    `SELECT cl.*, p.linkedin_url, p.job_title, p.email as prospect_email FROM cust_cc_call_logs cl LEFT JOIN cust_cc_prospects p ON p.id=cl.prospect_id WHERE cl.customer_id=? AND cl.is_lead=1 ORDER BY cl.started_at DESC LIMIT 100`
  ).bind(customerId).all<any>()
  return c.json({ leads: results || [] })
})

// ============================================================
// CALL COMPLETE — Webhook from AI agent after call ends
// ============================================================
customerCallsRoutes.post('/call-complete', async (c) => {
  try {
    const body = await c.req.json()
    const { customer_id, prospect_id, phone_dialed, contact_name, company_name, call_status, call_outcome, call_duration_seconds, call_summary, call_transcript, conversation_highlights, sentiment, follow_up_required, follow_up_notes, follow_up_date, is_lead, lead_quality, appointment_booked, appointment_date, appointment_notes, livekit_room_id, agent_voice, agent_name } = body

    if (!customer_id) return c.json({ error: 'customer_id required' }, 400)

    // Insert call log
    const res = await c.env.DB.prepare(
      `INSERT INTO cust_cc_call_logs (customer_id, prospect_id, list_id, phone_dialed, contact_name, company_name, call_status, call_outcome, call_duration_seconds, call_summary, call_transcript, conversation_highlights, sentiment, follow_up_required, follow_up_notes, follow_up_date, is_lead, lead_quality, appointment_booked, appointment_date, appointment_notes, livekit_room_id, agent_voice, agent_name, ended_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`
    ).bind(
      customer_id, prospect_id || null, body.list_id || null,
      phone_dialed || '', contact_name || '', company_name || '',
      call_status || 'completed', call_outcome || '',
      call_duration_seconds || 0, call_summary || '', call_transcript || '',
      conversation_highlights || '', sentiment || '',
      follow_up_required ? 1 : 0, follow_up_notes || '', follow_up_date || '',
      is_lead ? 1 : 0, lead_quality || '',
      appointment_booked ? 1 : 0, appointment_date || '', appointment_notes || '',
      livekit_room_id || '', agent_voice || 'alloy', agent_name || 'AI Agent'
    ).run()

    // Update prospect status if provided
    if (prospect_id) {
      const prospectStatus = call_outcome === 'do_not_call' ? 'dnc'
        : call_outcome === 'no_answer' || call_outcome === 'voicemail' ? 'no_answer'
        : call_outcome === 'callback' ? 'callback'
        : call_outcome === 'interested' || call_outcome === 'appointment' ? 'interested'
        : 'called'

      await c.env.DB.prepare(
        `UPDATE cust_cc_prospects SET call_status=?, call_attempts=call_attempts+1, last_called_at=datetime('now'), outcome=?, is_lead=?, lead_quality=?, appointment_booked=?, appointment_date=?, appointment_notes=?, do_not_call=?, last_call_summary=?, last_call_transcript=?, last_call_duration=?, last_call_sentiment=?, last_call_highlights=?, updated_at=datetime('now') WHERE id=? AND customer_id=?`
      ).bind(
        prospectStatus, call_outcome || '', is_lead ? 1 : 0, lead_quality || '',
        appointment_booked ? 1 : 0, appointment_date || '', appointment_notes || '',
        call_outcome === 'do_not_call' ? 1 : 0,
        call_summary || '', call_transcript || '', call_duration_seconds || 0,
        sentiment || '', conversation_highlights || '',
        prospect_id, customer_id
      ).run()

      // Update next_call_at for callbacks
      if (follow_up_date) {
        await c.env.DB.prepare(
          `UPDATE cust_cc_prospects SET next_call_at=?, call_status='callback' WHERE id=? AND customer_id=?`
        ).bind(follow_up_date, prospect_id, customer_id).run()
      }
    }

    // Update list counts
    if (body.list_id) {
      await c.env.DB.prepare(
        `UPDATE cust_cc_lists SET called_count=(SELECT COUNT(DISTINCT prospect_id) FROM cust_cc_call_logs WHERE list_id=? AND customer_id=?), leads_count=(SELECT COUNT(*) FROM cust_cc_call_logs WHERE list_id=? AND customer_id=? AND is_lead=1), updated_at=datetime('now') WHERE id=?`
      ).bind(body.list_id, customer_id, body.list_id, customer_id, body.list_id).run()
    }

    return c.json({ success: true, call_log_id: res.meta.last_row_id })
  } catch (e: any) { return c.json({ error: e.message }, 500) }
})

// ============================================================
// CONFIG — Agent settings
// ============================================================
customerCallsRoutes.get('/config', async (c) => {
  const customerId = c.get('customerId' as any)
  const config = await c.env.DB.prepare('SELECT * FROM cust_cc_config WHERE customer_id=?').bind(customerId).first<any>()
  return c.json({ config: config || null })
})

customerCallsRoutes.post('/config', async (c) => {
  const customerId = c.get('customerId' as any)
  const { agent_name, agent_voice, script_intro, script_pitch, script_objections, script_closing, business_name, callback_number } = await c.req.json()

  const existing = await c.env.DB.prepare('SELECT id FROM cust_cc_config WHERE customer_id=?').bind(customerId).first<any>()

  if (existing) {
    await c.env.DB.prepare(
      `UPDATE cust_cc_config SET agent_name=?, agent_voice=?, script_intro=?, script_pitch=?, script_objections=?, script_closing=?, business_name=?, callback_number=?, updated_at=datetime('now') WHERE customer_id=?`
    ).bind(
      agent_name || 'AI Sales Agent', agent_voice || 'alloy',
      script_intro || '', script_pitch || '', script_objections || '', script_closing || '',
      business_name || '', callback_number || '', customerId
    ).run()
  } else {
    await c.env.DB.prepare(
      `INSERT INTO cust_cc_config (customer_id, agent_name, agent_voice, script_intro, script_pitch, script_objections, script_closing, business_name, callback_number) VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(
      customerId, agent_name || 'AI Sales Agent', agent_voice || 'alloy',
      script_intro || '', script_pitch || '', script_objections || '', script_closing || '',
      business_name || '', callback_number || ''
    ).run()
  }

  return c.json({ success: true })
})

// ============================================================
// START / STOP CALLING — Control AI dialer
// ============================================================
customerCallsRoutes.post('/start-calling', async (c) => {
  const customerId = c.get('customerId' as any)
  const { list_id } = await c.req.json()

  // Verify list belongs to customer
  if (list_id) {
    const list = await c.env.DB.prepare('SELECT id FROM cust_cc_lists WHERE id=? AND customer_id=?').bind(list_id, customerId).first<any>()
    if (!list) return c.json({ error: 'List not found' }, 404)
  }

  // Count available prospects
  let where = 'customer_id=? AND (call_status=? OR call_status=?) AND do_not_call=0'
  const params: any[] = [customerId, 'pending', 'callback']
  if (list_id) { where += ' AND list_id=?'; params.push(list_id) }

  const count = await c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM cust_cc_prospects WHERE ${where}`).bind(...params).first<any>()

  await c.env.DB.prepare(
    `UPDATE cust_cc_config SET is_active=1, updated_at=datetime('now') WHERE customer_id=?`
  ).bind(customerId).run()

  return c.json({ success: true, queued: count?.cnt || 0, message: `AI dialer started — ${count?.cnt || 0} prospects in queue` })
})

customerCallsRoutes.post('/stop-calling', async (c) => {
  const customerId = c.get('customerId' as any)
  await c.env.DB.prepare(
    `UPDATE cust_cc_config SET is_active=0, updated_at=datetime('now') WHERE customer_id=?`
  ).bind(customerId).run()
  return c.json({ success: true, message: 'AI dialer stopped' })
})

// ============================================================
// NEXT PROSPECT — Get next in queue for AI agent
// ============================================================
customerCallsRoutes.get('/next-prospect', async (c) => {
  const customerId = c.get('customerId' as any)
  const listId = c.req.query('list_id')

  let where = `customer_id=? AND (call_status='pending' OR (call_status='callback' AND next_call_at<=datetime('now'))) AND do_not_call=0`
  const params: any[] = [customerId]
  if (listId) { where += ' AND list_id=?'; params.push(parseInt(listId)) }

  const prospect = await c.env.DB.prepare(
    `SELECT * FROM cust_cc_prospects WHERE ${where} ORDER BY priority ASC, created_at ASC LIMIT 1`
  ).bind(...params).first<any>()

  if (!prospect) return c.json({ prospect: null, message: 'No prospects available to call' })

  // Get config
  const config = await c.env.DB.prepare('SELECT * FROM cust_cc_config WHERE customer_id=?').bind(customerId).first<any>()

  return c.json({ prospect, config: config || {} })
})

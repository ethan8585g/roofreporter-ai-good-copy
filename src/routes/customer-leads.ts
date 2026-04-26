import { Hono } from 'hono'
import type { Bindings } from '../types'
import { resolveTeamOwner } from './team'

export const customerLeadsRoutes = new Hono<{ Bindings: Bindings }>()

// ============================================================
// AUTH — resolve to team owner so team members see owner's leads
// ============================================================
async function getOwnerId(c: any): Promise<{ ownerId: number; userId: number } | null> {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  if (!session) return null
  const { ownerId } = await resolveTeamOwner(c.env.DB, session.customer_id)
  return { ownerId, userId: session.customer_id }
}

// ============================================================
// GET /api/customer-leads — Unified leads aggregator
// Pulls from: widget_leads, d2d_appointments, secretary_call_logs,
//   secretary_messages, secretary_callbacks, asset_report_leads,
//   contact_leads, crew_messages, rover_conversations
// ============================================================
customerLeadsRoutes.get('/', async (c) => {
  const auth = await getOwnerId(c)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)
  const { ownerId, userId } = auth

  const channel = c.req.query('channel') || 'all'
  const status = c.req.query('status') || 'all'
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 200)
  const offset = parseInt(c.req.query('offset') || '0')

  // Fan out to all lead sources in parallel
  const [
    widgetLeads,
    d2dAppointments,
    secretaryCalls,
    secretaryMessages,
    secretaryCallbacks,
    jobMessages,
    roverChats,
    readStates
  ] = await Promise.all([
    channel === 'all' || channel === 'web_widget'
      ? c.env.DB.prepare(
          'SELECT id, lead_name, lead_email, lead_phone, property_address, total_area_sqft, created_at, customer_id FROM widget_leads WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100'
        ).bind(ownerId).all<any>()
      : { results: [] },

    channel === 'all' || channel === 'd2d_appointment'
      ? c.env.DB.prepare(
          'SELECT id, customer_name, address, appointment_date, appointment_time, notes, status, created_at FROM d2d_appointments WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100'
        ).bind(ownerId).all<any>()
      : { results: [] },

    channel === 'all' || channel === 'voice_call'
      ? c.env.DB.prepare(
          'SELECT id, caller_phone, caller_name, call_duration_seconds, call_summary, call_outcome, created_at FROM secretary_call_logs WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100'
        ).bind(ownerId).all<any>()
      : { results: [] },

    channel === 'all' || channel === 'sms'
      ? c.env.DB.prepare(
          'SELECT id, caller_phone, caller_name, message_text, urgency, is_read, created_at FROM secretary_messages WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100'
        ).bind(ownerId).all<any>()
      : { results: [] },

    channel === 'all' || channel === 'voicemail'
      ? c.env.DB.prepare(
          'SELECT id, caller_phone, caller_name, preferred_time, reason, status, created_at FROM secretary_callbacks WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100'
        ).bind(ownerId).all<any>()
      : { results: [] },

    channel === 'all' || channel === 'crm_job_message'
      ? c.env.DB.prepare(
          `SELECT cm.id, cm.job_id, cm.author_name, cm.content, cm.created_at, j.customer_name as job_customer
           FROM crew_messages cm JOIN jobs j ON cm.job_id = j.id
           WHERE j.customer_id = ? ORDER BY cm.created_at DESC LIMIT 100`
        ).bind(ownerId).all<any>()
      : { results: [] },

    channel === 'all' || channel === 'rover_chat'
      ? c.env.DB.prepare(
          `SELECT id, session_id, visitor_name, visitor_email, visitor_phone, page_url,
                  message_count, lead_score, lead_status, summary, tags, last_message_at, created_at
           FROM rover_conversations
           WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100`
        ).bind(ownerId).all<any>()
      : { results: [] },

    // Read states for this user
    c.env.DB.prepare(
      'SELECT lead_id, lead_channel FROM customer_lead_read_state WHERE customer_id = ?'
    ).bind(userId).all<any>()
  ])

  const readSet = new Set(
    (readStates.results || []).map((r: any) => `${r.lead_channel}:${r.lead_id}`)
  )

  // Normalize into unified lead shape
  const leads: any[] = []

  for (const w of widgetLeads.results || []) {
    leads.push({
      id: `widget_${w.id}`,
      channel: 'web_widget',
      contact_name: w.lead_name || 'Unknown',
      contact_info: w.lead_email || w.lead_phone || '',
      summary: w.property_address ? `Estimate request: ${w.property_address}` : 'Widget estimate request',
      detail: w.total_area_sqft ? `${Math.round(w.total_area_sqft)} sq ft` : '',
      status: 'new',
      created_at: w.created_at,
      is_read: readSet.has(`web_widget:widget_${w.id}`)
    })
  }

  for (const d of d2dAppointments.results || []) {
    leads.push({
      id: `d2d_${d.id}`,
      channel: 'd2d_appointment',
      contact_name: d.customer_name,
      contact_info: d.address,
      summary: `D2D appointment: ${d.appointment_date} at ${d.appointment_time}`,
      detail: d.notes || '',
      status: d.status || 'new',
      created_at: d.created_at,
      is_read: readSet.has(`d2d_appointment:d2d_${d.id}`)
    })
  }

  for (const call of secretaryCalls.results || []) {
    leads.push({
      id: `call_${call.id}`,
      channel: 'voice_call',
      contact_name: call.caller_name || 'Unknown Caller',
      contact_info: call.caller_phone || '',
      summary: call.call_summary || `${call.call_outcome || 'answered'} call (${call.call_duration_seconds || 0}s)`,
      detail: '',
      status: call.call_outcome === 'missed' ? 'new' : 'contacted',
      created_at: call.created_at,
      is_read: readSet.has(`voice_call:call_${call.id}`)
    })
  }

  for (const msg of secretaryMessages.results || []) {
    leads.push({
      id: `msg_${msg.id}`,
      channel: 'sms',
      contact_name: msg.caller_name || 'Unknown',
      contact_info: msg.caller_phone || '',
      summary: msg.message_text || 'Message received',
      detail: msg.urgency !== 'normal' ? `Urgency: ${msg.urgency}` : '',
      status: msg.is_read ? 'contacted' : 'new',
      created_at: msg.created_at,
      is_read: readSet.has(`sms:msg_${msg.id}`)
    })
  }

  for (const cb of secretaryCallbacks.results || []) {
    leads.push({
      id: `callback_${cb.id}`,
      channel: 'voicemail',
      contact_name: cb.caller_name || 'Unknown',
      contact_info: cb.caller_phone || '',
      summary: cb.reason || 'Callback requested',
      detail: cb.preferred_time ? `Preferred: ${cb.preferred_time}` : '',
      status: cb.status || 'new',
      created_at: cb.created_at,
      is_read: readSet.has(`voicemail:callback_${cb.id}`)
    })
  }

  for (const jm of jobMessages.results || []) {
    leads.push({
      id: `jobmsg_${jm.id}`,
      channel: 'crm_job_message',
      contact_name: jm.author_name || 'Team',
      contact_info: jm.job_customer || '',
      summary: jm.content || 'Job message',
      detail: `Job #${jm.job_id}`,
      status: 'new',
      created_at: jm.created_at,
      is_read: readSet.has(`crm_job_message:jobmsg_${jm.id}`)
    })
  }

  for (const rc of roverChats.results || []) {
    const statusMap: Record<string, string> = {
      new: 'new',
      qualified: 'new',
      contacted: 'contacted',
      converted: 'contacted',
      spam: 'contacted'
    }
    leads.push({
      id: `rover_${rc.id}`,
      channel: 'rover_chat',
      contact_name: rc.visitor_name || 'Website Visitor',
      contact_info: rc.visitor_email || rc.visitor_phone || rc.page_url || '',
      summary: rc.summary || `Web chat (${rc.message_count || 0} msgs)${rc.lead_score ? ` · score ${rc.lead_score}` : ''}`,
      detail: rc.tags ? `Tags: ${rc.tags}` : (rc.lead_status ? `Lead: ${rc.lead_status}` : ''),
      status: statusMap[rc.lead_status] || 'new',
      created_at: rc.last_message_at || rc.created_at,
      is_read: readSet.has(`rover_chat:rover_${rc.id}`)
    })
  }

  // Sort all by created_at descending
  leads.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  // Filter by status if specified
  const filtered = status === 'all' ? leads : leads.filter(l => l.status === status)

  // Count unread
  const unread_count = leads.filter(l => !l.is_read).length

  // Paginate
  const paginated = filtered.slice(offset, offset + limit)

  return c.json({
    leads: paginated,
    total: filtered.length,
    unread_count,
    channels: {
      all: leads.length,
      web_widget: leads.filter(l => l.channel === 'web_widget').length,
      voice_call: leads.filter(l => l.channel === 'voice_call').length,
      sms: leads.filter(l => l.channel === 'sms').length,
      voicemail: leads.filter(l => l.channel === 'voicemail').length,
      d2d_appointment: leads.filter(l => l.channel === 'd2d_appointment').length,
      crm_job_message: leads.filter(l => l.channel === 'crm_job_message').length,
      rover_chat: leads.filter(l => l.channel === 'rover_chat').length,
    }
  })
})

// ============================================================
// GET /api/customer-leads/unread-count — Quick unread badge count
// ============================================================
customerLeadsRoutes.get('/unread-count', async (c) => {
  const auth = await getOwnerId(c)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)
  const { ownerId, userId } = auth

  // Count total leads across all sources
  const [widgets, calls, messages, callbacks, d2dAppts, roverChats] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM widget_leads WHERE customer_id = ?').bind(ownerId).first<any>(),
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM secretary_call_logs WHERE customer_id = ?').bind(ownerId).first<any>(),
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM secretary_messages WHERE customer_id = ?').bind(ownerId).first<any>(),
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM secretary_callbacks WHERE customer_id = ?').bind(ownerId).first<any>(),
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM d2d_appointments WHERE owner_id = ?').bind(ownerId).first<any>(),
    c.env.DB.prepare('SELECT COUNT(*) as cnt FROM rover_conversations WHERE customer_id = ?').bind(ownerId).first<any>(),
  ])

  const totalLeads = (widgets?.cnt || 0) + (calls?.cnt || 0) + (messages?.cnt || 0) + (callbacks?.cnt || 0) + (d2dAppts?.cnt || 0) + (roverChats?.cnt || 0)

  // Count read states
  const readCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM customer_lead_read_state WHERE customer_id = ?'
  ).bind(userId).first<any>()

  const unread = Math.max(0, totalLeads - (readCount?.cnt || 0))

  return c.json({ unread_count: unread })
})

// ============================================================
// POST /api/customer-leads/mark-read — Mark leads as read
// ============================================================
customerLeadsRoutes.post('/mark-read', async (c) => {
  const auth = await getOwnerId(c)
  if (!auth) return c.json({ error: 'Unauthorized' }, 401)
  const { userId } = auth

  const body = await c.req.json<{ leads: { id: string; channel: string }[] }>()
  if (!body.leads?.length) return c.json({ success: true })

  const stmts = body.leads.map(l =>
    c.env.DB.prepare(
      'INSERT OR IGNORE INTO customer_lead_read_state (customer_id, lead_id, lead_channel) VALUES (?, ?, ?)'
    ).bind(userId, l.id, l.channel)
  )

  await c.env.DB.batch(stmts)
  return c.json({ success: true })
})

// ============================================================
// Roof Manager — Sales Process & Onboarding Engine
// ============================================================
//
// Automated sales pipeline management for roofing businesses:
//   - Lead scoring (AI-powered)
//   - Automated follow-up sequences
//   - Customer onboarding workflow
//   - Sales analytics & forecasting
//   - Marketing campaign tracking
//   - Referral management
//
// ENDPOINTS:
//   GET  /api/sales/dashboard              → Sales KPI dashboard
//   GET  /api/sales/leads                  → List scored leads
//   POST /api/sales/leads/score            → Auto-score all leads
//   POST /api/sales/leads/:id/advance      → Move lead to next stage
//   GET  /api/sales/follow-ups             → Due follow-up actions
//   POST /api/sales/follow-ups/:id/complete → Mark follow-up done
//   POST /api/sales/onboard                → Start customer onboarding
//   GET  /api/sales/onboard/:id/status     → Onboarding progress
//   POST /api/sales/campaigns              → Create marketing campaign
//   GET  /api/sales/campaigns              → List campaigns
//   GET  /api/sales/referrals              → Referral tracking
//   POST /api/sales/referrals              → Log a referral
//   GET  /api/sales/forecast               → Revenue forecast
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { resolveTeamOwner } from './team'
import { createNotification } from './pipeline'
import { logFromContext } from '../lib/team-activity'

export const salesRoutes = new Hono<{ Bindings: Bindings }>()

// ── AUTH ──
async function getSalesOwnerId(c: any): Promise<number | null> {
  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  if (!session) return null
  const { ownerId } = await resolveTeamOwner(c.env.DB, session.customer_id)
  return ownerId
}

// ── DB SETUP ──
async function ensureSalesTables(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      crm_customer_id INTEGER,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      address TEXT,
      city TEXT,
      province TEXT,
      source TEXT DEFAULT 'website',
      stage TEXT DEFAULT 'new',
      lead_score INTEGER DEFAULT 0,
      score_factors TEXT,
      roof_type TEXT,
      roof_age_years INTEGER,
      property_type TEXT DEFAULT 'residential',
      estimated_value REAL DEFAULT 0,
      assigned_to INTEGER,
      last_contact_at TEXT,
      next_follow_up TEXT,
      notes TEXT,
      tags TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_follow_ups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      lead_id INTEGER,
      crm_customer_id INTEGER,
      action_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      completed_at TEXT,
      completed_by INTEGER,
      outcome TEXT,
      sequence_step INTEGER DEFAULT 0,
      campaign_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_onboarding (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      crm_customer_id INTEGER NOT NULL,
      lead_id INTEGER,
      status TEXT DEFAULT 'started',
      steps_completed TEXT DEFAULT '[]',
      welcome_email_sent INTEGER DEFAULT 0,
      first_report_ordered INTEGER DEFAULT 0,
      proposal_sent INTEGER DEFAULT 0,
      job_scheduled INTEGER DEFAULT 0,
      payment_setup INTEGER DEFAULT 0,
      review_requested INTEGER DEFAULT 0,
      referral_asked INTEGER DEFAULT 0,
      satisfaction_score INTEGER,
      notes TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      campaign_type TEXT DEFAULT 'email',
      status TEXT DEFAULT 'draft',
      target_audience TEXT,
      message_template TEXT,
      follow_up_sequence TEXT,
      total_sent INTEGER DEFAULT 0,
      total_opened INTEGER DEFAULT 0,
      total_clicked INTEGER DEFAULT 0,
      total_converted INTEGER DEFAULT 0,
      budget REAL DEFAULT 0,
      spent REAL DEFAULT 0,
      roi_percent REAL DEFAULT 0,
      start_date TEXT,
      end_date TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL,
      referrer_customer_id INTEGER,
      referrer_name TEXT NOT NULL,
      referred_name TEXT NOT NULL,
      referred_email TEXT,
      referred_phone TEXT,
      referred_address TEXT,
      status TEXT DEFAULT 'pending',
      reward_type TEXT DEFAULT 'cash',
      reward_amount REAL DEFAULT 0,
      reward_paid INTEGER DEFAULT 0,
      converted_lead_id INTEGER,
      converted_job_id INTEGER,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sales_leads_owner ON sales_leads(owner_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sales_followups_owner ON sales_follow_ups(owner_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sales_onboard_owner ON sales_onboarding(owner_id)`),
  ])
}

// ============================================================
// Lead scoring algorithm
// ============================================================
function calculateLeadScore(lead: any, interactions: any): { score: number; factors: any } {
  const factors: any = {}
  let score = 0

  // Source quality (0-20)
  const sourceScores: Record<string, number> = {
    'referral': 20, 'google_ads': 15, 'door_knock_yes': 18,
    'website': 12, 'facebook': 10, 'instagram': 8,
    'yard_sign': 14, 'flyer': 6, 'cold_call': 5,
    'storm_response': 17, 'insurance_claim': 19, 'repeat_customer': 20
  }
  factors.source = sourceScores[lead.source] || 8
  score += factors.source

  // Property type (0-10)
  factors.property = lead.property_type === 'commercial' ? 10 : (lead.property_type === 'multi-family' ? 8 : 6)
  score += factors.property

  // Roof age urgency (0-20)
  const age = lead.roof_age_years || 0
  if (age >= 25) factors.urgency = 20
  else if (age >= 20) factors.urgency = 16
  else if (age >= 15) factors.urgency = 12
  else if (age >= 10) factors.urgency = 8
  else factors.urgency = 4
  score += factors.urgency

  // Engagement (0-20)
  const daysSinceContact = lead.last_contact_at
    ? Math.floor((Date.now() - new Date(lead.last_contact_at).getTime()) / 86400000)
    : 999
  if (daysSinceContact <= 1) factors.engagement = 20
  else if (daysSinceContact <= 3) factors.engagement = 16
  else if (daysSinceContact <= 7) factors.engagement = 12
  else if (daysSinceContact <= 14) factors.engagement = 8
  else factors.engagement = 3
  score += factors.engagement

  // Estimated value (0-15)
  const value = lead.estimated_value || 0
  if (value >= 20000) factors.value = 15
  else if (value >= 10000) factors.value = 12
  else if (value >= 5000) factors.value = 8
  else factors.value = 4
  score += factors.value

  // Stage progression bonus (0-15)
  const stageScores: Record<string, number> = {
    'new': 2, 'contacted': 5, 'qualified': 8,
    'proposal_sent': 12, 'negotiation': 14, 'won': 15, 'lost': 0
  }
  factors.stage = stageScores[lead.stage] || 2
  score += factors.stage

  return { score: Math.min(100, score), factors }
}

// ============================================================
// GET /dashboard — Sales KPI dashboard
// ============================================================
salesRoutes.get('/dashboard', async (c) => {
  const ownerId = await getSalesOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  await ensureSalesTables(c.env.DB)

  try {
    // Lead stats
    const leadStats = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total_leads,
        SUM(CASE WHEN stage = 'new' THEN 1 ELSE 0 END) as new_leads,
        SUM(CASE WHEN stage = 'contacted' THEN 1 ELSE 0 END) as contacted,
        SUM(CASE WHEN stage = 'qualified' THEN 1 ELSE 0 END) as qualified,
        SUM(CASE WHEN stage = 'proposal_sent' THEN 1 ELSE 0 END) as proposals_out,
        SUM(CASE WHEN stage = 'won' THEN 1 ELSE 0 END) as won,
        SUM(CASE WHEN stage = 'lost' THEN 1 ELSE 0 END) as lost,
        AVG(lead_score) as avg_score,
        SUM(CASE WHEN stage = 'won' THEN estimated_value ELSE 0 END) as won_value,
        SUM(CASE WHEN stage IN ('new','contacted','qualified','proposal_sent','negotiation') THEN estimated_value ELSE 0 END) as pipeline_value
      FROM sales_leads WHERE owner_id = ?
    `).bind(ownerId).first<any>()

    // Follow-up stats
    const followUpStats = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN completed = 0 AND due_date <= date('now') THEN 1 ELSE 0 END) as overdue,
        SUM(CASE WHEN completed = 0 AND due_date = date('now') THEN 1 ELSE 0 END) as due_today,
        SUM(CASE WHEN completed = 0 AND due_date > date('now') AND due_date <= date('now', '+7 days') THEN 1 ELSE 0 END) as due_this_week
      FROM sales_follow_ups WHERE owner_id = ?
    `).bind(ownerId).first<any>()

    // This month's conversion
    const monthStats = await c.env.DB.prepare(`
      SELECT
        SUM(CASE WHEN stage = 'won' AND updated_at >= date('now', 'start of month') THEN 1 ELSE 0 END) as monthly_wins,
        SUM(CASE WHEN created_at >= date('now', 'start of month') THEN 1 ELSE 0 END) as monthly_leads,
        SUM(CASE WHEN stage = 'won' AND updated_at >= date('now', 'start of month') THEN estimated_value ELSE 0 END) as monthly_revenue
      FROM sales_leads WHERE owner_id = ?
    `).bind(ownerId).first<any>()

    // Referral stats
    const referralStats = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) as converted,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
      FROM sales_referrals WHERE owner_id = ?
    `).bind(ownerId).first<any>()

    // Onboarding stats
    const onboardingStats = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'started' THEN 1 ELSE 0 END) as in_progress,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM sales_onboarding WHERE owner_id = ?
    `).bind(ownerId).first<any>()

    const totalLeads = leadStats?.total_leads || 0
    const wonLeads = leadStats?.won || 0
    const conversionRate = totalLeads > 0 ? Math.round((wonLeads / totalLeads) * 100) : 0

    return c.json({
      success: true,
      kpis: {
        pipeline_value: Math.round((leadStats?.pipeline_value || 0) * 100) / 100,
        won_value: Math.round((leadStats?.won_value || 0) * 100) / 100,
        conversion_rate: conversionRate,
        avg_lead_score: Math.round(leadStats?.avg_score || 0),
        monthly_revenue: Math.round((monthStats?.monthly_revenue || 0) * 100) / 100,
        monthly_wins: monthStats?.monthly_wins || 0,
        monthly_leads: monthStats?.monthly_leads || 0,
      },
      leads: {
        total: totalLeads,
        new: leadStats?.new_leads || 0,
        contacted: leadStats?.contacted || 0,
        qualified: leadStats?.qualified || 0,
        proposals_out: leadStats?.proposals_out || 0,
        won: wonLeads,
        lost: leadStats?.lost || 0,
      },
      follow_ups: {
        overdue: followUpStats?.overdue || 0,
        due_today: followUpStats?.due_today || 0,
        due_this_week: followUpStats?.due_this_week || 0,
      },
      referrals: referralStats || { total: 0, converted: 0, pending: 0 },
      onboarding: onboardingStats || { total: 0, in_progress: 0, completed: 0 },
    })
  } catch {
    return c.json({ success: true, kpis: {}, leads: {}, follow_ups: {}, referrals: {}, onboarding: {} })
  }
})

// ============================================================
// GET /leads — List leads with scoring
// ============================================================
salesRoutes.get('/leads', async (c) => {
  const ownerId = await getSalesOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  await ensureSalesTables(c.env.DB)

  const stage = c.req.query('stage') || ''
  const sort = c.req.query('sort') || 'score'
  const source = c.req.query('source') || ''

  let q = 'SELECT * FROM sales_leads WHERE owner_id = ?'
  const params: any[] = [ownerId]

  if (stage) { q += ' AND stage = ?'; params.push(stage) }
  if (source) { q += ' AND source = ?'; params.push(source) }

  if (sort === 'score') q += ' ORDER BY lead_score DESC'
  else if (sort === 'recent') q += ' ORDER BY created_at DESC'
  else if (sort === 'value') q += ' ORDER BY estimated_value DESC'
  else q += ' ORDER BY lead_score DESC'

  q += ' LIMIT 200'

  const { results } = await c.env.DB.prepare(q).bind(...params).all<any>()

  return c.json({
    success: true,
    leads: (results || []).map((lead: any) => ({
      ...lead,
      score_factors: lead.score_factors ? JSON.parse(lead.score_factors) : null,
      tags: lead.tags ? JSON.parse(lead.tags) : []
    })),
    count: (results || []).length,
    sources: ['website', 'google_ads', 'facebook', 'instagram', 'referral', 'door_knock_yes', 'yard_sign', 'flyer', 'cold_call', 'storm_response', 'insurance_claim', 'repeat_customer']
  })
})

// ============================================================
// POST /leads — Create new lead
// ============================================================
salesRoutes.post('/leads', async (c) => {
  const ownerId = await getSalesOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  await ensureSalesTables(c.env.DB)

  const body = await c.req.json()
  if (!body.name) return c.json({ error: 'Name is required' }, 400)

  // Calculate initial score
  const { score, factors } = calculateLeadScore(body, {})

  // Auto-create CRM customer
  let crmCustomerId = body.crm_customer_id || null
  if (!crmCustomerId && body.email) {
    try {
      const result = await c.env.DB.prepare(`
        INSERT INTO crm_customers (owner_id, name, email, phone, address, city, province, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'lead')
      `).bind(ownerId, body.name, body.email || null, body.phone || null, body.address || null, body.city || null, body.province || null).run()
      crmCustomerId = result.meta.last_row_id
    } catch {}
  }

  // Set initial follow-up based on source
  const followUpDays = body.source === 'door_knock_yes' ? 1 : (body.source === 'referral' ? 1 : 2)
  const nextFollowUp = new Date(Date.now() + followUpDays * 86400000).toISOString().split('T')[0]

  const result = await c.env.DB.prepare(`
    INSERT INTO sales_leads (owner_id, crm_customer_id, name, email, phone, address, city, province, source, stage, lead_score, score_factors, roof_type, roof_age_years, property_type, estimated_value, assigned_to, next_follow_up, notes, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    ownerId, crmCustomerId, body.name, body.email || null, body.phone || null,
    body.address || null, body.city || null, body.province || null,
    body.source || 'website', score, JSON.stringify(factors),
    body.roof_type || null, body.roof_age_years || null,
    body.property_type || 'residential', body.estimated_value || 0,
    body.assigned_to || null, nextFollowUp, body.notes || null,
    body.tags ? JSON.stringify(body.tags) : null
  ).run()

  const leadId = result.meta.last_row_id

  await logFromContext(c, { entity_type: 'pipeline_lead', entity_id: Number(leadId), action: 'created', metadata: { name: body.name, source: body.source || 'website', score } })

  // Auto-create first follow-up action
  await c.env.DB.prepare(`
    INSERT INTO sales_follow_ups (owner_id, lead_id, crm_customer_id, action_type, title, description, due_date, sequence_step)
    VALUES (?, ?, ?, 'call', ?, 'Initial contact — introduce yourself and schedule a roof inspection.', ?, 1)
  `).bind(ownerId, leadId, crmCustomerId, `Initial call: ${body.name}`, nextFollowUp).run()

  return c.json({
    success: true,
    lead_id: leadId,
    lead_score: score,
    score_factors: factors,
    crm_customer_id: crmCustomerId,
    next_follow_up: nextFollowUp,
    message: `Lead created with score ${score}/100. Follow-up scheduled for ${nextFollowUp}.`
  })
})

// ============================================================
// POST /leads/score — Re-score all leads
// ============================================================
salesRoutes.post('/leads/score', async (c) => {
  const ownerId = await getSalesOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  await ensureSalesTables(c.env.DB)

  const { results: leads } = await c.env.DB.prepare(
    "SELECT * FROM sales_leads WHERE owner_id = ? AND stage NOT IN ('won', 'lost')"
  ).bind(ownerId).all<any>()

  let updated = 0
  for (const lead of (leads || [])) {
    const { score, factors } = calculateLeadScore(lead, {})
    if (score !== lead.lead_score) {
      await c.env.DB.prepare(
        'UPDATE sales_leads SET lead_score = ?, score_factors = ?, updated_at = datetime(\'now\') WHERE id = ?'
      ).bind(score, JSON.stringify(factors), lead.id).run()
      updated++
    }
  }

  return c.json({ success: true, total: (leads || []).length, updated, message: `${updated} lead scores updated` })
})

// ============================================================
// POST /leads/:id/advance — Move lead to next stage
// ============================================================
salesRoutes.post('/leads/:id/advance', async (c) => {
  const ownerId = await getSalesOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  await ensureSalesTables(c.env.DB)

  const leadId = c.req.param('id')
  const body = await c.req.json()
  const targetStage = body.stage

  const stages = ['new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'won', 'lost']
  if (!stages.includes(targetStage)) {
    return c.json({ error: `Invalid stage. Must be one of: ${stages.join(', ')}` }, 400)
  }

  const lead = await c.env.DB.prepare(
    'SELECT * FROM sales_leads WHERE id = ? AND owner_id = ?'
  ).bind(leadId, ownerId).first<any>()
  if (!lead) return c.json({ error: 'Lead not found' }, 404)

  await c.env.DB.prepare(
    "UPDATE sales_leads SET stage = ?, last_contact_at = datetime('now'), updated_at = datetime('now'), notes = COALESCE(?, notes) WHERE id = ?"
  ).bind(targetStage, body.notes || null, leadId).run()

  // Auto-create follow-up based on stage
  const followUpTemplates: Record<string, any> = {
    'contacted': { type: 'call', title: `Follow-up call: ${lead.name}`, days: 2, desc: 'Discuss roof assessment and schedule inspection.' },
    'qualified': { type: 'email', title: `Send info packet: ${lead.name}`, days: 1, desc: 'Send company brochure, testimonials, and financing options.' },
    'proposal_sent': { type: 'call', title: `Proposal follow-up: ${lead.name}`, days: 3, desc: 'Check if they reviewed the proposal. Address questions.' },
    'negotiation': { type: 'call', title: `Close the deal: ${lead.name}`, days: 1, desc: 'Final negotiation. Discuss timeline, financing, and warranty.' },
    'won': { type: 'email', title: `Welcome & onboard: ${lead.name}`, days: 0, desc: 'Send welcome email. Schedule job. Set up payment.' },
  }

  const template = followUpTemplates[targetStage]
  if (template) {
    const dueDate = new Date(Date.now() + template.days * 86400000).toISOString().split('T')[0]
    await c.env.DB.prepare(`
      INSERT INTO sales_follow_ups (owner_id, lead_id, crm_customer_id, action_type, title, description, due_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(ownerId, leadId, lead.crm_customer_id, template.type, template.title, template.desc, dueDate).run()

    await c.env.DB.prepare(
      'UPDATE sales_leads SET next_follow_up = ? WHERE id = ?'
    ).bind(dueDate, leadId).run()
  }

  // If won, auto-start onboarding
  if (targetStage === 'won' && lead.crm_customer_id) {
    try {
      await c.env.DB.prepare(`
        INSERT INTO sales_onboarding (owner_id, crm_customer_id, lead_id, status, started_at)
        VALUES (?, ?, ?, 'started', datetime('now'))
      `).bind(ownerId, lead.crm_customer_id, leadId).run()
    } catch {}
  }

  // Create notification + push
  await createNotification(
    c.env.DB, ownerId, 'lead_advanced',
    `Lead Advanced: ${lead.name}`,
    `${lead.name} moved to "${targetStage}" stage`,
    '', c.env, c.executionCtx
  )

  return c.json({
    success: true,
    lead_id: parseInt(leadId),
    new_stage: targetStage,
    follow_up: template ? { ...template, due: new Date(Date.now() + (template.days || 0) * 86400000).toISOString().split('T')[0] } : null,
    message: `Lead moved to "${targetStage}"`
  })
})

// ============================================================
// GET /follow-ups — Get due follow-up actions
// ============================================================
salesRoutes.get('/follow-ups', async (c) => {
  const ownerId = await getSalesOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  await ensureSalesTables(c.env.DB)

  const filter = c.req.query('filter') || 'due' // due, overdue, all, completed

  let q = `SELECT sf.*, sl.name as lead_name, sl.phone as lead_phone, sl.email as lead_email, sl.stage as lead_stage, sl.lead_score
    FROM sales_follow_ups sf
    LEFT JOIN sales_leads sl ON sl.id = sf.lead_id
    WHERE sf.owner_id = ?`
  const params: any[] = [ownerId]

  if (filter === 'due') { q += " AND sf.completed = 0 AND sf.due_date <= date('now', '+3 days')"; }
  else if (filter === 'overdue') { q += " AND sf.completed = 0 AND sf.due_date < date('now')"; }
  else if (filter === 'completed') { q += ' AND sf.completed = 1'; }
  else if (filter === 'pending') { q += ' AND sf.completed = 0'; }

  q += ' ORDER BY sf.due_date ASC LIMIT 100'

  const { results } = await c.env.DB.prepare(q).bind(...params).all<any>()

  return c.json({
    success: true,
    follow_ups: results || [],
    count: (results || []).length
  })
})

// ============================================================
// POST /follow-ups/:id/complete — Complete a follow-up
// ============================================================
salesRoutes.post('/follow-ups/:id/complete', async (c) => {
  const ownerId = await getSalesOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)

  const followUpId = c.req.param('id')
  const body = await c.req.json()

  await c.env.DB.prepare(`
    UPDATE sales_follow_ups 
    SET completed = 1, completed_at = datetime('now'), outcome = ?
    WHERE id = ? AND owner_id = ?
  `).bind(body.outcome || 'completed', followUpId, ownerId).run()

  // Update lead last_contact
  const followUp = await c.env.DB.prepare(
    'SELECT lead_id FROM sales_follow_ups WHERE id = ?'
  ).bind(followUpId).first<any>()

  if (followUp?.lead_id) {
    await c.env.DB.prepare(
      "UPDATE sales_leads SET last_contact_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).bind(followUp.lead_id).run()
  }

  return c.json({ success: true, message: 'Follow-up completed' })
})

// ============================================================
// POST /onboard — Start customer onboarding sequence
// ============================================================
salesRoutes.post('/onboard', async (c) => {
  const ownerId = await getSalesOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  await ensureSalesTables(c.env.DB)

  const body = await c.req.json()
  if (!body.crm_customer_id) return c.json({ error: 'crm_customer_id required' }, 400)

  const result = await c.env.DB.prepare(`
    INSERT INTO sales_onboarding (owner_id, crm_customer_id, lead_id, status)
    VALUES (?, ?, ?, 'started')
  `).bind(ownerId, body.crm_customer_id, body.lead_id || null).run()

  const onboardingId = result.meta.last_row_id

  // Create onboarding follow-up sequence
  const sequence = [
    { days: 0, type: 'email', title: 'Welcome email + company overview', desc: 'Send welcome email with company info, team intro, and what to expect.' },
    { days: 1, type: 'call', title: 'Schedule roof inspection', desc: 'Call to schedule the first roof inspection appointment.' },
    { days: 3, type: 'email', title: 'Send roof report & proposal', desc: 'Email the inspection report and proposal with Good/Better/Best options.' },
    { days: 5, type: 'call', title: 'Follow up on proposal', desc: 'Call to discuss the proposal, answer questions, discuss financing.' },
    { days: 7, type: 'email', title: 'Send financing options', desc: 'Email detailed financing plans and payment schedule.' },
    { days: 14, type: 'call', title: 'Check in after job', desc: 'Call to check satisfaction after job completion.' },
    { days: 21, type: 'email', title: 'Request Google review', desc: 'Send review request email with direct Google review link.' },
    { days: 30, type: 'email', title: 'Ask for referrals', desc: 'Send referral request with incentive details.' },
  ]

  for (let i = 0; i < sequence.length; i++) {
    const step = sequence[i]
    const dueDate = new Date(Date.now() + step.days * 86400000).toISOString().split('T')[0]
    await c.env.DB.prepare(`
      INSERT INTO sales_follow_ups (owner_id, lead_id, crm_customer_id, action_type, title, description, due_date, sequence_step)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(ownerId, body.lead_id || null, body.crm_customer_id, step.type, step.title, step.desc, dueDate, i + 1).run()
  }

  return c.json({
    success: true,
    onboarding_id: onboardingId,
    sequence_steps: sequence.length,
    message: `Onboarding started with ${sequence.length}-step automated follow-up sequence.`
  })
})

// ============================================================
// GET /onboard/:id/status — Onboarding progress
// ============================================================
salesRoutes.get('/onboard/:id/status', async (c) => {
  const ownerId = await getSalesOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)

  const onboardingId = c.req.param('id')
  const onboarding = await c.env.DB.prepare(
    'SELECT * FROM sales_onboarding WHERE id = ? AND owner_id = ?'
  ).bind(onboardingId, ownerId).first<any>()

  if (!onboarding) return c.json({ error: 'Onboarding not found' }, 404)

  // Get associated follow-ups
  const { results: followUps } = await c.env.DB.prepare(
    'SELECT * FROM sales_follow_ups WHERE crm_customer_id = ? AND owner_id = ? ORDER BY sequence_step'
  ).bind(onboarding.crm_customer_id, ownerId).all<any>()

  const totalSteps = (followUps || []).length
  const completedSteps = (followUps || []).filter((f: any) => f.completed).length
  const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0

  return c.json({
    success: true,
    onboarding,
    follow_ups: followUps || [],
    progress: { total: totalSteps, completed: completedSteps, percent: progress }
  })
})

// ============================================================
// Campaign CRUD
// ============================================================
salesRoutes.get('/campaigns', async (c) => {
  const ownerId = await getSalesOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  await ensureSalesTables(c.env.DB)

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM sales_campaigns WHERE owner_id = ? ORDER BY created_at DESC'
  ).bind(ownerId).all<any>()

  return c.json({ success: true, campaigns: results || [] })
})

salesRoutes.post('/campaigns', async (c) => {
  const ownerId = await getSalesOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  await ensureSalesTables(c.env.DB)

  const body = await c.req.json()
  if (!body.name) return c.json({ error: 'Campaign name required' }, 400)

  const result = await c.env.DB.prepare(`
    INSERT INTO sales_campaigns (owner_id, name, campaign_type, target_audience, message_template, follow_up_sequence, budget, start_date, end_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    ownerId, body.name, body.campaign_type || 'email',
    body.target_audience || null, body.message_template || null,
    body.follow_up_sequence ? JSON.stringify(body.follow_up_sequence) : null,
    body.budget || 0, body.start_date || null, body.end_date || null
  ).run()

  return c.json({ success: true, campaign_id: result.meta.last_row_id })
})

// ============================================================
// Referrals CRUD
// ============================================================
salesRoutes.get('/referrals', async (c) => {
  const ownerId = await getSalesOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  await ensureSalesTables(c.env.DB)

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM sales_referrals WHERE owner_id = ? ORDER BY created_at DESC'
  ).bind(ownerId).all<any>()

  return c.json({ success: true, referrals: results || [] })
})

salesRoutes.post('/referrals', async (c) => {
  const ownerId = await getSalesOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  await ensureSalesTables(c.env.DB)

  const body = await c.req.json()
  if (!body.referrer_name || !body.referred_name) {
    return c.json({ error: 'referrer_name and referred_name required' }, 400)
  }

  const result = await c.env.DB.prepare(`
    INSERT INTO sales_referrals (owner_id, referrer_customer_id, referrer_name, referred_name, referred_email, referred_phone, referred_address, reward_type, reward_amount, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    ownerId, body.referrer_customer_id || null, body.referrer_name, body.referred_name,
    body.referred_email || null, body.referred_phone || null, body.referred_address || null,
    body.reward_type || 'cash', body.reward_amount || 100, body.notes || null
  ).run()

  // Auto-create lead from referral
  const { score, factors } = calculateLeadScore({ ...body, source: 'referral' }, {})
  const leadResult = await c.env.DB.prepare(`
    INSERT INTO sales_leads (owner_id, name, email, phone, address, source, lead_score, score_factors, estimated_value, notes)
    VALUES (?, ?, ?, ?, ?, 'referral', ?, ?, ?, ?)
  `).bind(
    ownerId, body.referred_name, body.referred_email || null, body.referred_phone || null,
    body.referred_address || null, score, JSON.stringify(factors), body.estimated_value || 8000,
    `Referred by ${body.referrer_name}`
  ).run()

  await c.env.DB.prepare(
    'UPDATE sales_referrals SET converted_lead_id = ? WHERE id = ?'
  ).bind(leadResult.meta.last_row_id, result.meta.last_row_id).run()

  return c.json({
    success: true,
    referral_id: result.meta.last_row_id,
    lead_id: leadResult.meta.last_row_id,
    lead_score: score,
    message: `Referral logged. Lead auto-created with score ${score}/100.`
  })
})

// ============================================================
// GET /forecast — Revenue forecast
// ============================================================
salesRoutes.get('/forecast', async (c) => {
  const ownerId = await getSalesOwnerId(c)
  if (!ownerId) return c.json({ error: 'Not authenticated' }, 401)
  await ensureSalesTables(c.env.DB)

  // Get pipeline by stage with weighted probability
  const stageWeights: Record<string, number> = {
    'new': 0.10, 'contacted': 0.20, 'qualified': 0.40,
    'proposal_sent': 0.60, 'negotiation': 0.80, 'won': 1.0
  }

  const { results: pipeline } = await c.env.DB.prepare(`
    SELECT stage, COUNT(*) as count, SUM(estimated_value) as total_value
    FROM sales_leads WHERE owner_id = ? AND stage NOT IN ('lost')
    GROUP BY stage
  `).bind(ownerId).all<any>()

  let weightedForecast = 0
  const stageBreakdown = (pipeline || []).map((row: any) => {
    const weight = stageWeights[row.stage] || 0.1
    const weighted = (row.total_value || 0) * weight
    weightedForecast += weighted
    return {
      stage: row.stage,
      count: row.count,
      total_value: Math.round((row.total_value || 0) * 100) / 100,
      probability: Math.round(weight * 100),
      weighted_value: Math.round(weighted * 100) / 100,
    }
  })

  // Historical win rate (last 90 days)
  const history = await c.env.DB.prepare(`
    SELECT
      SUM(CASE WHEN stage = 'won' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN stage = 'lost' THEN 1 ELSE 0 END) as losses,
      AVG(CASE WHEN stage = 'won' THEN estimated_value ELSE NULL END) as avg_deal_size
    FROM sales_leads WHERE owner_id = ? AND updated_at >= date('now', '-90 days')
  `).bind(ownerId).first<any>()

  const wins = history?.wins || 0
  const losses = history?.losses || 0
  const historicalWinRate = (wins + losses) > 0 ? Math.round((wins / (wins + losses)) * 100) : 0

  return c.json({
    success: true,
    forecast: {
      weighted_pipeline: Math.round(weightedForecast * 100) / 100,
      stage_breakdown: stageBreakdown,
      historical_win_rate: historicalWinRate,
      avg_deal_size: Math.round((history?.avg_deal_size || 0) * 100) / 100,
      total_pipeline_count: stageBreakdown.reduce((sum: number, s: any) => sum + s.count, 0),
    }
  })
})

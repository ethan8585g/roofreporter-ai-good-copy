// ============================================================
// Repository — sa_cold_call_leads + sa_cold_call_logs
// Manual super-admin cold-call tracker (independent of the
// existing customer-cold-call route).
// ============================================================

export type LeadStatus =
  | 'new' | 'attempting' | 'contacted' | 'qualified'
  | 'proposal_sent' | 'won' | 'lost' | 'do_not_call'

export type CallOutcome =
  | 'no_answer' | 'voicemail' | 'wrong_number'
  | 'not_interested' | 'interested' | 'callback_requested'
  | 'meeting_booked' | 'do_not_call' | 'won' | 'lost'

export const VALID_STATUSES: LeadStatus[] = [
  'new','attempting','contacted','qualified','proposal_sent','won','lost','do_not_call'
]
export const VALID_OUTCOMES: CallOutcome[] = [
  'no_answer','voicemail','wrong_number','not_interested','interested',
  'callback_requested','meeting_booked','do_not_call','won','lost'
]

// ── Lead CRUD ────────────────────────────────────────────────
export async function listLeads(
  db: D1Database,
  opts: { status?: string | null; priority?: number | null; search?: string | null; limit?: number; offset?: number }
) {
  const where: string[] = []
  const args: any[] = []
  if (opts.status) { where.push('status = ?'); args.push(opts.status) }
  if (opts.priority) { where.push('priority = ?'); args.push(opts.priority) }
  if (opts.search) {
    where.push('(name LIKE ? OR company_name LIKE ? OR phone LIKE ? OR email LIKE ? OR notes LIKE ?)')
    const s = `%${opts.search}%`
    args.push(s, s, s, s, s)
  }
  const limit = Math.min(opts.limit || 200, 1000)
  const offset = opts.offset || 0
  const sql = `
    SELECT id, name, company_name, phone, email, website, address, city, province, country,
           source, status, priority, next_action_at, assigned_to, notes,
           linked_customer_id, attempts_count, last_attempt_at, last_outcome,
           created_at, updated_at
    FROM sa_cold_call_leads
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY
      CASE WHEN next_action_at IS NOT NULL AND next_action_at <= datetime('now') THEN 0 ELSE 1 END,
      priority ASC,
      attempts_count ASC,
      created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `
  const r = await db.prepare(sql).bind(...args).all<any>()
  return r.results || []
}

export async function getLead(db: D1Database, id: number) {
  return db.prepare(`SELECT * FROM sa_cold_call_leads WHERE id = ?`).bind(id).first<any>()
}

export async function createLead(db: D1Database, data: {
  name?: string | null; company_name?: string | null; phone?: string | null;
  email?: string | null; website?: string | null; address?: string | null;
  city?: string | null; province?: string | null; country?: string | null;
  source?: string | null; priority?: number; status?: LeadStatus;
  notes?: string | null; assigned_to?: number | null;
}) {
  const r = await db.prepare(`
    INSERT INTO sa_cold_call_leads (
      name, company_name, phone, email, website, address, city, province, country,
      source, priority, status, notes, assigned_to
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.name || null, data.company_name || null, data.phone || null,
    data.email || null, data.website || null, data.address || null,
    data.city || null, data.province || null, data.country || null,
    data.source || null, data.priority ?? 3, data.status || 'new',
    data.notes || null, data.assigned_to ?? null
  ).run()
  // Auto-link to customers by email if there's a match
  if (data.email && r.meta.last_row_id) {
    await db.prepare(`
      UPDATE sa_cold_call_leads
      SET linked_customer_id = (SELECT id FROM customers WHERE email = ? LIMIT 1)
      WHERE id = ?
    `).bind(data.email, r.meta.last_row_id).run().catch(() => {})
  }
  return r.meta.last_row_id as number
}

export async function updateLead(db: D1Database, id: number, patch: Record<string, any>) {
  const cols = ['name','company_name','phone','email','website','address','city','province','country',
                'source','status','priority','next_action_at','assigned_to','notes']
  const sets: string[] = []
  const args: any[] = []
  for (const k of cols) {
    if (k in patch) { sets.push(`${k} = ?`); args.push(patch[k] === '' ? null : patch[k]) }
  }
  if (sets.length === 0) return
  sets.push("updated_at = CURRENT_TIMESTAMP")
  args.push(id)
  await db.prepare(`UPDATE sa_cold_call_leads SET ${sets.join(', ')} WHERE id = ?`).bind(...args).run()
}

export async function deleteLead(db: D1Database, id: number) {
  await db.prepare(`DELETE FROM sa_cold_call_leads WHERE id = ?`).bind(id).run()
}

// ── Logs ─────────────────────────────────────────────────────
export async function logCall(db: D1Database, data: {
  lead_id: number; admin_user_id?: number | null;
  outcome: CallOutcome; duration_seconds?: number | null;
  sentiment?: number | null; notes?: string | null;
  next_step?: string | null; next_action_at?: string | null;
  // status to set on the parent lead, if any
  set_status?: LeadStatus | null;
}) {
  const r = await db.prepare(`
    INSERT INTO sa_cold_call_logs
      (lead_id, admin_user_id, outcome, duration_seconds, sentiment, notes, next_step, next_action_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.lead_id, data.admin_user_id ?? null, data.outcome,
    data.duration_seconds ?? null, data.sentiment ?? null,
    data.notes ?? null, data.next_step ?? null, data.next_action_at ?? null
  ).run()
  // Roll forward the lead's denormalized fields
  const newStatus = data.set_status || outcomeToStatus(data.outcome)
  await db.prepare(`
    UPDATE sa_cold_call_leads
    SET attempts_count = attempts_count + 1,
        last_attempt_at = CURRENT_TIMESTAMP,
        last_outcome = ?,
        status = COALESCE(?, status),
        next_action_at = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(data.outcome, newStatus, data.next_action_at ?? null, data.lead_id).run()
  return r.meta.last_row_id as number
}

function outcomeToStatus(o: CallOutcome): LeadStatus | null {
  switch (o) {
    case 'no_answer':
    case 'voicemail': return 'attempting'
    case 'wrong_number': return 'lost'
    case 'not_interested': return 'lost'
    case 'interested':
    case 'callback_requested': return 'contacted'
    case 'meeting_booked': return 'qualified'
    case 'do_not_call': return 'do_not_call'
    case 'won': return 'won'
    case 'lost': return 'lost'
  }
  return null
}

export async function listLogsForLead(db: D1Database, leadId: number) {
  const r = await db.prepare(`
    SELECT id, admin_user_id, called_at, outcome, duration_seconds,
           sentiment, notes, next_step, next_action_at
    FROM sa_cold_call_logs
    WHERE lead_id = ?
    ORDER BY called_at DESC
  `).bind(leadId).all<any>()
  return r.results || []
}

export async function listAllLogs(db: D1Database, opts: { sinceIso?: string | null; outcome?: string | null; limit?: number }) {
  const where: string[] = []
  const args: any[] = []
  if (opts.sinceIso) { where.push('l.called_at >= ?'); args.push(opts.sinceIso) }
  if (opts.outcome) { where.push('l.outcome = ?'); args.push(opts.outcome) }
  const limit = Math.min(opts.limit || 500, 5000)
  const r = await db.prepare(`
    SELECT l.id, l.lead_id, l.called_at, l.outcome, l.duration_seconds, l.sentiment,
           l.notes, l.next_step, l.next_action_at,
           ld.name as lead_name, ld.company_name, ld.phone
    FROM sa_cold_call_logs l
    LEFT JOIN sa_cold_call_leads ld ON ld.id = l.lead_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY l.called_at DESC
    LIMIT ${limit}
  `).bind(...args).all<any>()
  return r.results || []
}

// ── Today's call queue: due callbacks first, then new leads ──
export async function getCallQueue(db: D1Database, limit = 50) {
  const r = await db.prepare(`
    SELECT id, name, company_name, phone, email, address, city, province,
           source, status, priority, next_action_at, attempts_count,
           last_attempt_at, last_outcome, notes
    FROM sa_cold_call_leads
    WHERE status NOT IN ('won','lost','do_not_call')
      AND (next_action_at IS NULL OR next_action_at <= datetime('now', '+1 day'))
    ORDER BY
      CASE WHEN next_action_at IS NOT NULL AND next_action_at <= datetime('now') THEN 0 ELSE 1 END,
      priority ASC,
      attempts_count ASC,
      created_at DESC
    LIMIT ?
  `).bind(limit).all<any>()
  return r.results || []
}

// ── Stats ────────────────────────────────────────────────────
export async function getStats(db: D1Database, sinceIso: string) {
  const overall = await db.prepare(`
    SELECT
      COUNT(*) as calls,
      COUNT(DISTINCT lead_id) as unique_leads_called,
      SUM(CASE WHEN outcome IN ('interested','callback_requested','meeting_booked','won') THEN 1 ELSE 0 END) as contacts,
      SUM(CASE WHEN outcome = 'meeting_booked' THEN 1 ELSE 0 END) as meetings,
      SUM(CASE WHEN outcome = 'won' THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN outcome = 'voicemail' THEN 1 ELSE 0 END) as voicemails,
      SUM(CASE WHEN outcome = 'no_answer' THEN 1 ELSE 0 END) as no_answer,
      SUM(COALESCE(duration_seconds, 0)) as total_seconds
    FROM sa_cold_call_logs
    WHERE called_at >= ?
  `).bind(sinceIso).first<any>()

  const byOutcome = await db.prepare(`
    SELECT outcome, COUNT(*) as n
    FROM sa_cold_call_logs
    WHERE called_at >= ?
    GROUP BY outcome
    ORDER BY n DESC
  `).bind(sinceIso).all<any>()

  const byDay = await db.prepare(`
    SELECT substr(called_at, 1, 10) as date,
           COUNT(*) as calls,
           SUM(CASE WHEN outcome IN ('interested','callback_requested','meeting_booked','won') THEN 1 ELSE 0 END) as contacts,
           SUM(CASE WHEN outcome = 'meeting_booked' THEN 1 ELSE 0 END) as meetings
    FROM sa_cold_call_logs
    WHERE called_at >= ?
    GROUP BY substr(called_at, 1, 10)
    ORDER BY date ASC
  `).bind(sinceIso).all<any>()

  const byHour = await db.prepare(`
    SELECT CAST(strftime('%H', called_at) AS INTEGER) as hour,
           COUNT(*) as calls,
           SUM(CASE WHEN outcome IN ('interested','callback_requested','meeting_booked','won') THEN 1 ELSE 0 END) as contacts
    FROM sa_cold_call_logs
    WHERE called_at >= ?
    GROUP BY hour
    ORDER BY hour ASC
  `).bind(sinceIso).all<any>()

  const bySource = await db.prepare(`
    SELECT COALESCE(ld.source, '(unspecified)') as source,
           COUNT(DISTINCT l.lead_id) as leads_touched,
           SUM(CASE WHEN l.outcome = 'meeting_booked' THEN 1 ELSE 0 END) as meetings,
           SUM(CASE WHEN l.outcome = 'won' THEN 1 ELSE 0 END) as wins
    FROM sa_cold_call_logs l
    LEFT JOIN sa_cold_call_leads ld ON ld.id = l.lead_id
    WHERE l.called_at >= ?
    GROUP BY source
    ORDER BY leads_touched DESC
  `).bind(sinceIso).all<any>()

  const totalLeads = await db.prepare(`SELECT COUNT(*) as n FROM sa_cold_call_leads`).first<any>()
  const openLeads = await db.prepare(`
    SELECT COUNT(*) as n FROM sa_cold_call_leads
    WHERE status NOT IN ('won','lost','do_not_call')
  `).first<any>()
  const dueLeads = await db.prepare(`
    SELECT COUNT(*) as n FROM sa_cold_call_leads
    WHERE next_action_at IS NOT NULL AND next_action_at <= datetime('now')
      AND status NOT IN ('won','lost','do_not_call')
  `).first<any>()

  return {
    overall,
    by_outcome: byOutcome.results || [],
    by_day: byDay.results || [],
    by_hour: byHour.results || [],
    by_source: bySource.results || [],
    total_leads: totalLeads?.n || 0,
    open_leads: openLeads?.n || 0,
    due_leads: dueLeads?.n || 0
  }
}

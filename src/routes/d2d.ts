import { Hono } from 'hono'
import type { Bindings } from '../types'
import { resolveTeamOwner } from './team'
import { sendGmailEmail } from '../services/email'

export const d2dRoutes = new Hono<{ Bindings: Bindings }>()

// ============================================================
// APPOINTMENT VALIDATION (exported for tests)
// ============================================================
export const APPT_VALID_STATUSES = ['new', 'assigned', 'processing', 'completed', 'lost'] as const
export type D2DAppointmentStatus = typeof APPT_VALID_STATUSES[number]

export function validateAppointmentInput(input: {
  customer_name?: any; address?: any; appointment_date?: any; appointment_time?: any;
}): { ok: boolean; error?: string } {
  if (!input.customer_name || typeof input.customer_name !== 'string' || !input.customer_name.trim()) {
    return { ok: false, error: 'customer_name is required' }
  }
  if (!input.address || typeof input.address !== 'string' || !input.address.trim()) {
    return { ok: false, error: 'address is required' }
  }
  if (!input.appointment_date || !/^\d{4}-\d{2}-\d{2}$/.test(String(input.appointment_date))) {
    return { ok: false, error: 'appointment_date must be YYYY-MM-DD' }
  }
  if (!input.appointment_time || !/^\d{2}:\d{2}$/.test(String(input.appointment_time))) {
    return { ok: false, error: 'appointment_time must be HH:MM (24h)' }
  }
  return { ok: true }
}

export function isValidApptStatus(s: any): s is D2DAppointmentStatus {
  return typeof s === 'string' && (APPT_VALID_STATUSES as readonly string[]).includes(s)
}

// ============================================================
// PASSWORD HASHING — same algo as customer-auth.ts
// ============================================================
async function hashPassword(password: string, salt?: string): Promise<{ hash: string; salt: string }> {
  const s = salt || crypto.randomUUID()
  const data = new TextEncoder().encode(password + s)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
  return { hash: hashHex, salt: s }
}

// ============================================================
// AUTH MIDDLEWARE — Validate customer session token
// Team members resolve to the owner's D2D data.
// Also loads per-member D2D permissions for access control.
// ============================================================
interface D2DUser {
  id: number               // effective owner ID (used for all DB queries)
  rawCustomerId: number    // the logged-in customer's own ID
  role: string
  effectiveOwnerId: number
  isTeamMember: boolean
  d2dMemberId: number | null
  d2dPermissions: { d2d: string; reports: boolean; crm: boolean; secretary: boolean; team: boolean } | null
}

async function getUser(c: any): Promise<D2DUser | null> {
  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const session = await c.env.DB.prepare(
    "SELECT cs.customer_id FROM customer_sessions cs JOIN customers cu ON cu.id = cs.customer_id WHERE cs.session_token = ? AND cs.expires_at > datetime('now')"
  ).bind(token).first<any>()
  if (!session) return null

  // Resolve team membership — team members access owner's D2D data
  const teamInfo = await resolveTeamOwner(c.env.DB, session.customer_id)
  const effectiveId = teamInfo.ownerId

  // Look up this specific user's D2D team member record (by their own customer_id)
  let d2dMember: any = null
  if (teamInfo.isTeamMember) {
    d2dMember = await c.env.DB.prepare(
      'SELECT id, role, permissions FROM d2d_team_members WHERE customer_id = ? AND owner_id = ? AND is_active = 1'
    ).bind(session.customer_id, effectiveId).first<any>()
  }

  let d2dPermissions: any = null
  if (teamInfo.isTeamMember) {
    d2dPermissions = { d2d: 'all', reports: true, crm: true, secretary: false, team: false }
    if (d2dMember?.permissions) {
      try { d2dPermissions = { ...d2dPermissions, ...JSON.parse(d2dMember.permissions) } } catch (e) {}
    }
  }

  return {
    id: effectiveId,
    rawCustomerId: session.customer_id,
    role: d2dMember?.role || (teamInfo.isTeamMember ? 'salesperson' : 'owner'),
    effectiveOwnerId: effectiveId,
    isTeamMember: teamInfo.isTeamMember,
    d2dMemberId: d2dMember?.id || null,
    d2dPermissions
  }
}

// ============================================================
// DB SETUP — Create D2D tables on first request
// ============================================================
let d2dTablesCreated = false

async function ensureD2DTables(db: any) {
  if (d2dTablesCreated) return
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS d2d_team_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        customer_id INTEGER,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        role TEXT DEFAULT 'salesperson',
        color TEXT DEFAULT '#3B82F6',
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (owner_id) REFERENCES customers(id)
      )
    `).run()

    // Add permissions column if it doesn't exist yet
    try {
      await db.prepare(`ALTER TABLE d2d_team_members ADD COLUMN permissions TEXT DEFAULT '{"d2d":"all","reports":true,"crm":true,"secretary":false,"team":false}'`).run()
    } catch (e) {}

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS d2d_turfs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        polygon_json TEXT NOT NULL,
        center_lat REAL,
        center_lng REAL,
        color TEXT DEFAULT '#3B82F6',
        assigned_to INTEGER,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (owner_id) REFERENCES customers(id),
        FOREIGN KEY (assigned_to) REFERENCES d2d_team_members(id)
      )
    `).run()

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS d2d_pins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        turf_id INTEGER,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        address TEXT,
        status TEXT DEFAULT 'not_knocked',
        notes TEXT,
        knocked_by INTEGER,
        knocked_at TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (owner_id) REFERENCES customers(id),
        FOREIGN KEY (turf_id) REFERENCES d2d_turfs(id),
        FOREIGN KEY (knocked_by) REFERENCES d2d_team_members(id)
      )
    `).run()

    // Appointments (leads) — door knockers book, owner disperses to closer
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS d2d_appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id INTEGER NOT NULL,
        created_by_member_id INTEGER,
        assigned_to_member_id INTEGER,
        customer_name TEXT NOT NULL,
        address TEXT NOT NULL,
        appointment_date TEXT NOT NULL,
        appointment_time TEXT NOT NULL,
        notes TEXT,
        company_type TEXT DEFAULT 'roofing',
        status TEXT NOT NULL DEFAULT 'new',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (owner_id) REFERENCES customers(id),
        FOREIGN KEY (created_by_member_id) REFERENCES d2d_team_members(id),
        FOREIGN KEY (assigned_to_member_id) REFERENCES d2d_team_members(id)
      )
    `).run()
    try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_d2d_appt_owner ON d2d_appointments(owner_id)').run() } catch(e) {}
    try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_d2d_appt_assigned ON d2d_appointments(assigned_to_member_id)').run() } catch(e) {}
    try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_d2d_appt_status ON d2d_appointments(status)').run() } catch(e) {}

    // Indexes
    try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_d2d_turfs_owner ON d2d_turfs(owner_id)').run() } catch(e) {}
    try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_d2d_pins_turf ON d2d_pins(turf_id)').run() } catch(e) {}
    try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_d2d_pins_owner ON d2d_pins(owner_id)').run() } catch(e) {}
    try { await db.prepare('CREATE INDEX IF NOT EXISTS idx_d2d_team_owner ON d2d_team_members(owner_id)').run() } catch(e) {}

    d2dTablesCreated = true
  } catch (e: any) {
    console.log('[D2D] Table creation note:', e.message)
    d2dTablesCreated = true
  }
}

// ============================================================
// TEAM MEMBERS
// ============================================================

// LIST team members
d2dRoutes.get('/team', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  await ensureD2DTables(c.env.DB)

  const members = await c.env.DB.prepare(
    `SELECT tm.*,
      (SELECT COUNT(*) FROM d2d_turfs t WHERE t.assigned_to = tm.id) as turf_count,
      (SELECT COUNT(*) FROM d2d_pins p WHERE p.knocked_by = tm.id) as knock_count,
      (SELECT COUNT(*) FROM d2d_pins p WHERE p.knocked_by = tm.id AND p.status = 'yes') as yes_count,
      (SELECT COUNT(*) FROM d2d_pins p WHERE p.knocked_by = tm.id AND p.status = 'no') as no_count,
      (SELECT COUNT(*) FROM d2d_pins p WHERE p.knocked_by = tm.id AND p.status = 'no_answer') as no_answer_count,
      (SELECT MAX(p.knocked_at) FROM d2d_pins p WHERE p.knocked_by = tm.id) as last_activity
     FROM d2d_team_members tm WHERE tm.owner_id = ? AND tm.is_active = 1 ORDER BY tm.name`
  ).bind(user.id).all()

  return c.json({ members: members.results })
})

// TEAM ACTIVITY — per-member summary for admin tracking
d2dRoutes.get('/team/activity', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (user.isTeamMember) return c.json({ error: 'Forbidden' }, 403)
  await ensureD2DTables(c.env.DB)

  const activity = await c.env.DB.prepare(`
    SELECT tm.id, tm.name, tm.color, tm.email, tm.role,
      COUNT(DISTINCT p.id) as total_knocks,
      SUM(CASE WHEN p.status = 'yes' THEN 1 ELSE 0 END) as yes_count,
      SUM(CASE WHEN p.status = 'no' THEN 1 ELSE 0 END) as no_count,
      SUM(CASE WHEN p.status = 'no_answer' THEN 1 ELSE 0 END) as no_answer_count,
      (SELECT COUNT(*) FROM d2d_turfs t WHERE t.assigned_to = tm.id AND t.owner_id = ?) as turf_count,
      MAX(p.knocked_at) as last_activity
    FROM d2d_team_members tm
    LEFT JOIN d2d_pins p ON p.knocked_by = tm.id AND p.owner_id = ?
    WHERE tm.owner_id = ? AND tm.is_active = 1
    GROUP BY tm.id
    ORDER BY total_knocks DESC
  `).bind(user.id, user.id, user.id).all()

  return c.json({ activity: activity.results })
})

// CREATE team member — also creates a customer login account when password is provided
d2dRoutes.post('/team', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  await ensureD2DTables(c.env.DB)

  const { name, email, phone, role, color, password, permissions } = await c.req.json()
  if (!name) return c.json({ error: 'Name is required' }, 400)

  let customerId: number | null = null

  // If password is provided, create/update a customer account for this member
  if (password && email) {
    const cleanEmail = email.toLowerCase().trim()
    if (password.length < 6) return c.json({ error: 'Password must be at least 6 characters' }, 400)

    const { hash, salt } = await hashPassword(password)
    const storedHash = `${salt}:${hash}`

    const existing = await c.env.DB.prepare('SELECT id FROM customers WHERE email = ?').bind(cleanEmail).first<any>()
    if (existing) {
      // Update their password
      await c.env.DB.prepare('UPDATE customers SET password_hash = ?, is_active = 1 WHERE id = ?').bind(storedHash, existing.id).run()
      customerId = existing.id
    } else {
      // Create new customer account (no free trial credits — they use the owner's account)
      const newCust = await c.env.DB.prepare(
        `INSERT INTO customers (email, name, phone, password_hash, email_verified, report_credits, credits_used, free_trial_total, free_trial_used, is_active)
         VALUES (?, ?, ?, ?, 1, 0, 0, 0, 0, 1)`
      ).bind(cleanEmail, name, phone || null, storedHash).run()
      customerId = newCust.meta.last_row_id as number
    }

    // Ensure they are in the team_members table so resolveTeamOwner works when they log in
    const now = new Date().toISOString()
    const existingTeamMember = await c.env.DB.prepare(
      'SELECT id FROM team_members WHERE owner_id = ? AND member_customer_id = ?'
    ).bind(user.id, customerId).first<any>()

    if (!existingTeamMember) {
      await c.env.DB.prepare(
        `INSERT INTO team_members (owner_id, member_customer_id, email, name, role, status, joined_at)
         VALUES (?, ?, ?, ?, 'member', 'active', ?)`
      ).bind(user.id, customerId, email.toLowerCase().trim(), name, now).run()
    } else {
      await c.env.DB.prepare(
        `UPDATE team_members SET status = 'active', member_customer_id = ?, name = ?, email = ? WHERE id = ?`
      ).bind(customerId, name, email.toLowerCase().trim(), existingTeamMember.id).run()
    }
  } else if (email) {
    // No password — just link to existing account if found
    const existing = await c.env.DB.prepare('SELECT id FROM customers WHERE email = ?').bind(email.toLowerCase().trim()).first<any>()
    if (existing) customerId = existing.id
  }

  const permStr = permissions ? JSON.stringify(permissions) : '{"d2d":"all","reports":true,"crm":true,"secretary":false,"team":false}'

  const result = await c.env.DB.prepare(
    `INSERT INTO d2d_team_members (owner_id, customer_id, name, email, phone, role, color, permissions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, customerId, name, email || null, phone || null, role || 'salesperson', color || '#3B82F6', permStr).run()

  return c.json({ success: true, id: result.meta.last_row_id })
})

// UPDATE team member
d2dRoutes.put('/team/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  const { name, email, phone, role, color, is_active, password, permissions } = await c.req.json()

  // If new password provided, update the linked customer account
  if (password && password.length >= 6) {
    const member = await c.env.DB.prepare('SELECT customer_id FROM d2d_team_members WHERE id = ? AND owner_id = ?').bind(id, user.id).first<any>()
    if (member?.customer_id) {
      const { hash, salt } = await hashPassword(password)
      await c.env.DB.prepare('UPDATE customers SET password_hash = ? WHERE id = ?').bind(`${salt}:${hash}`, member.customer_id).run()
    }
  }

  const permStr = permissions !== undefined ? JSON.stringify(permissions) : undefined

  let q = `UPDATE d2d_team_members SET name = COALESCE(?, name), email = COALESCE(?, email),
    phone = COALESCE(?, phone), role = COALESCE(?, role), color = COALESCE(?, color),
    is_active = COALESCE(?, is_active)`
  const params: any[] = [name, email, phone, role, color, is_active !== undefined ? is_active : null]

  if (permStr !== undefined) {
    q += ', permissions = ?'
    params.push(permStr)
  }
  q += ' WHERE id = ? AND owner_id = ?'
  params.push(id, user.id)

  await c.env.DB.prepare(q).bind(...params).run()

  return c.json({ success: true })
})

// DELETE team member (soft)
d2dRoutes.delete('/team/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE d2d_team_members SET is_active = 0 WHERE id = ? AND owner_id = ?').bind(id, user.id).run()
  return c.json({ success: true })
})

// ============================================================
// TURFS
// ============================================================

// LIST turfs — filtered by permissions for team members
d2dRoutes.get('/turfs', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  await ensureD2DTables(c.env.DB)

  let q = `SELECT t.*, tm.name as assigned_name, tm.color as member_color,
      (SELECT COUNT(*) FROM d2d_pins p WHERE p.turf_id = t.id) as total_pins,
      (SELECT COUNT(*) FROM d2d_pins p WHERE p.turf_id = t.id AND p.status = 'yes') as yes_count,
      (SELECT COUNT(*) FROM d2d_pins p WHERE p.turf_id = t.id AND p.status = 'no') as no_count,
      (SELECT COUNT(*) FROM d2d_pins p WHERE p.turf_id = t.id AND p.status = 'no_answer') as no_answer_count,
      (SELECT COUNT(*) FROM d2d_pins p WHERE p.turf_id = t.id AND p.status = 'not_knocked') as not_knocked_count
     FROM d2d_turfs t LEFT JOIN d2d_team_members tm ON tm.id = t.assigned_to
     WHERE t.owner_id = ?`
  const params: any[] = [user.id]

  // Team members with 'assigned' permission see only their own turfs
  if (user.isTeamMember && user.d2dPermissions?.d2d === 'assigned' && user.d2dMemberId) {
    q += ' AND t.assigned_to = ?'
    params.push(user.d2dMemberId)
  }

  q += ' ORDER BY t.created_at DESC'
  const turfs = await c.env.DB.prepare(q).bind(...params).all()
  return c.json({ turfs: turfs.results })
})

// CREATE turf
d2dRoutes.post('/turfs', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (user.isTeamMember) return c.json({ error: 'Only the account owner can manage turfs' }, 403)
  await ensureD2DTables(c.env.DB)

  const { name, description, polygon, center_lat, center_lng, color, assigned_to } = await c.req.json()
  if (!name || !polygon || !Array.isArray(polygon) || polygon.length < 3) {
    return c.json({ error: 'Name and at least 3 polygon points required' }, 400)
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO d2d_turfs (owner_id, name, description, polygon_json, center_lat, center_lng, color, assigned_to)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    user.id, name, description || null, JSON.stringify(polygon),
    center_lat || null, center_lng || null, color || '#3B82F6', assigned_to || null
  ).run()

  return c.json({ success: true, id: result.meta.last_row_id })
})

// UPDATE turf
d2dRoutes.put('/turfs/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (user.isTeamMember) return c.json({ error: 'Only the account owner can manage turfs' }, 403)
  const id = c.req.param('id')
  const { name, description, polygon, color, assigned_to, status } = await c.req.json()

  let q = 'UPDATE d2d_turfs SET updated_at = datetime(\'now\')'
  const params: any[] = []
  if (name !== undefined) { q += ', name = ?'; params.push(name) }
  if (description !== undefined) { q += ', description = ?'; params.push(description) }
  if (polygon !== undefined) { q += ', polygon_json = ?'; params.push(JSON.stringify(polygon)) }
  if (color !== undefined) { q += ', color = ?'; params.push(color) }
  if (assigned_to !== undefined) { q += ', assigned_to = ?'; params.push(assigned_to || null) }
  if (status !== undefined) { q += ', status = ?'; params.push(status) }
  q += ' WHERE id = ? AND owner_id = ?'
  params.push(id, user.id)

  await c.env.DB.prepare(q).bind(...params).run()
  return c.json({ success: true })
})

// DELETE turf
d2dRoutes.delete('/turfs/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (user.isTeamMember) return c.json({ error: 'Only the account owner can manage turfs' }, 403)
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM d2d_pins WHERE turf_id = ? AND owner_id = ?').bind(id, user.id).run()
  await c.env.DB.prepare('DELETE FROM d2d_turfs WHERE id = ? AND owner_id = ?').bind(id, user.id).run()
  return c.json({ success: true })
})

// ============================================================
// PINS (Door Knocks)
// ============================================================

// LIST pins — filtered by permissions for team members
d2dRoutes.get('/pins', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  await ensureD2DTables(c.env.DB)

  const turfId = c.req.query('turf_id')
  const status = c.req.query('status')
  const memberId = c.req.query('member_id')
  const sortRecent = c.req.query('sort') === 'recent'
  const limitN = c.req.query('limit') ? parseInt(c.req.query('limit')!) : null

  let q = `SELECT p.*, tm.name as knocked_by_name, t.name as turf_name
     FROM d2d_pins p
     LEFT JOIN d2d_team_members tm ON tm.id = p.knocked_by
     LEFT JOIN d2d_turfs t ON t.id = p.turf_id
     WHERE p.owner_id = ?`
  const params: any[] = [user.id]

  // Team members with 'assigned' permission see only pins in their turfs
  if (user.isTeamMember && user.d2dPermissions?.d2d === 'assigned' && user.d2dMemberId) {
    q += ' AND t.assigned_to = ?'
    params.push(user.d2dMemberId)
  }

  if (turfId) { q += ' AND p.turf_id = ?'; params.push(turfId) }
  if (status) { q += ' AND p.status = ?'; params.push(status) }
  if (memberId) { q += ' AND p.knocked_by = ?'; params.push(memberId) }
  q += sortRecent ? ' ORDER BY p.knocked_at DESC' : ' ORDER BY p.updated_at DESC'
  if (limitN && limitN > 0) { q += ' LIMIT ?'; params.push(limitN) }

  const pins = await c.env.DB.prepare(q).bind(...params).all()
  return c.json({ pins: pins.results })
})

// CREATE pin
d2dRoutes.post('/pins', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  await ensureD2DTables(c.env.DB)

  const { lat, lng, address, turf_id, status, notes, knocked_by } = await c.req.json()
  if (lat === undefined || lat === null || lng === undefined || lng === null) return c.json({ error: 'lat and lng are required' }, 400)

  const result = await c.env.DB.prepare(
    `INSERT INTO d2d_pins (owner_id, turf_id, lat, lng, address, status, notes, knocked_by, knocked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${status && status !== 'not_knocked' ? "datetime('now')" : 'NULL'})`
  ).bind(
    user.id, turf_id || null, lat, lng, address || null,
    status || 'not_knocked', notes || null, knocked_by || null
  ).run()

  return c.json({ success: true, id: result.meta.last_row_id })
})

// UPDATE pin (change status)
d2dRoutes.put('/pins/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  const { status, notes, knocked_by } = await c.req.json()

  const knockedAt = status && status !== 'not_knocked' ? "datetime('now')" : 'NULL'

  await c.env.DB.prepare(
    `UPDATE d2d_pins SET status = COALESCE(?, status), notes = COALESCE(?, notes),
     knocked_by = COALESCE(?, knocked_by), knocked_at = ${knockedAt},
     updated_at = datetime('now') WHERE id = ? AND owner_id = ?`
  ).bind(status, notes, knocked_by, id, user.id).run()

  return c.json({ success: true })
})

// DELETE pin
d2dRoutes.delete('/pins/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM d2d_pins WHERE id = ? AND owner_id = ?').bind(id, user.id).run()
  return c.json({ success: true })
})

// ============================================================
// ADMIN TRACKING — Time-scoped per-member activity for sales admin
// period = today | week | month | all
// ============================================================
d2dRoutes.get('/admin/tracking', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (user.isTeamMember) return c.json({ error: 'Forbidden' }, 403)
  await ensureD2DTables(c.env.DB)

  const period = (c.req.query('period') || 'today').toLowerCase()
  let cutoff: string | null = null
  if (period === 'today') cutoff = "datetime('now', '-1 day')"
  else if (period === 'week') cutoff = "datetime('now', '-7 days')"
  else if (period === 'month') cutoff = "datetime('now', '-30 days')"

  const timeClause = cutoff ? `AND p.knocked_at >= ${cutoff}` : ''

  // Per-member stats within period
  const members = await c.env.DB.prepare(`
    SELECT tm.id, tm.name, tm.color, tm.email, tm.phone, tm.role,
      COUNT(DISTINCT p.id) as total_knocks,
      SUM(CASE WHEN p.status = 'yes' THEN 1 ELSE 0 END) as yes_count,
      SUM(CASE WHEN p.status = 'no' THEN 1 ELSE 0 END) as no_count,
      SUM(CASE WHEN p.status = 'no_answer' THEN 1 ELSE 0 END) as no_answer_count,
      MAX(p.knocked_at) as last_activity,
      MIN(p.knocked_at) as first_activity,
      (SELECT COUNT(*) FROM d2d_turfs t WHERE t.assigned_to = tm.id AND t.owner_id = ?) as turf_count
    FROM d2d_team_members tm
    LEFT JOIN d2d_pins p ON p.knocked_by = tm.id AND p.owner_id = ? ${timeClause}
    WHERE tm.owner_id = ? AND tm.is_active = 1
    GROUP BY tm.id
    ORDER BY total_knocks DESC
  `).bind(user.id, user.id, user.id).all()

  // Totals within period
  const totals = await c.env.DB.prepare(`
    SELECT
      COUNT(*) as total_knocks,
      SUM(CASE WHEN status = 'yes' THEN 1 ELSE 0 END) as yes_count,
      SUM(CASE WHEN status = 'no' THEN 1 ELSE 0 END) as no_count,
      SUM(CASE WHEN status = 'no_answer' THEN 1 ELSE 0 END) as no_answer_count
    FROM d2d_pins p WHERE p.owner_id = ? ${cutoff ? `AND p.knocked_at >= ${cutoff}` : 'AND p.knocked_at IS NOT NULL'}
  `).bind(user.id).first()

  // Recent knocks within period
  const recent = await c.env.DB.prepare(`
    SELECT p.id, p.lat, p.lng, p.address, p.status, p.notes, p.knocked_at,
      tm.name as knocked_by_name, tm.color as member_color, t.name as turf_name
    FROM d2d_pins p
    LEFT JOIN d2d_team_members tm ON tm.id = p.knocked_by
    LEFT JOIN d2d_turfs t ON t.id = p.turf_id
    WHERE p.owner_id = ? AND p.knocked_at IS NOT NULL ${cutoff ? `AND p.knocked_at >= ${cutoff}` : ''}
    ORDER BY p.knocked_at DESC
    LIMIT 50
  `).bind(user.id).all()

  return c.json({
    period,
    members: members.results,
    totals,
    recent: recent.results
  })
})

// ============================================================
// STATS — Dashboard summary
// ============================================================
d2dRoutes.get('/stats', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  await ensureD2DTables(c.env.DB)

  const stats = await c.env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM d2d_turfs WHERE owner_id = ?) as total_turfs,
      (SELECT COUNT(*) FROM d2d_team_members WHERE owner_id = ? AND is_active = 1) as total_members,
      (SELECT COUNT(*) FROM d2d_pins WHERE owner_id = ?) as total_pins,
      (SELECT COUNT(*) FROM d2d_pins WHERE owner_id = ? AND status = 'yes') as total_yes,
      (SELECT COUNT(*) FROM d2d_pins WHERE owner_id = ? AND status = 'no') as total_no,
      (SELECT COUNT(*) FROM d2d_pins WHERE owner_id = ? AND status = 'no_answer') as total_no_answer,
      (SELECT COUNT(*) FROM d2d_pins WHERE owner_id = ? AND status = 'not_knocked') as total_not_knocked
  `).bind(user.id, user.id, user.id, user.id, user.id, user.id, user.id).first()

  return c.json({ stats, viewer_role: user.isTeamMember ? 'member' : 'owner' })
})

// ============================================================
// APPOINTMENTS / LEADS
// Door knockers book appointments; they auto-route to team owner as leads.
// Owner can process themselves or assign ("disperse") to a closer.
// ============================================================

// CREATE appointment — any authenticated team member OR owner
d2dRoutes.post('/appointments', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  await ensureD2DTables(c.env.DB)

  const body = await c.req.json().catch(() => ({}))
  const v = validateAppointmentInput(body)
  if (!v.ok) return c.json({ error: v.error }, 400)

  const { customer_name, address, appointment_date, appointment_time, notes, company_type } = body

  // Determine company_type: prefer explicit input, else owner's customers.company_type, else 'roofing'
  let ct = (company_type === 'solar' || company_type === 'roofing') ? company_type : null
  if (!ct) {
    try {
      const cust = await c.env.DB.prepare('SELECT company_type FROM customers WHERE id = ?').bind(user.id).first<any>()
      ct = (cust?.company_type === 'solar') ? 'solar' : 'roofing'
    } catch (e) { ct = 'roofing' }
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO d2d_appointments
      (owner_id, created_by_member_id, customer_name, address, appointment_date, appointment_time, notes, company_type, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new')`
  ).bind(
    user.id,
    user.d2dMemberId,
    String(customer_name).trim(),
    String(address).trim(),
    appointment_date,
    appointment_time,
    notes ? String(notes).trim() : null,
    ct
  ).run()

  const apptId = result.meta.last_row_id

  // Fire-and-forget email to team owner
  try {
    const owner = await c.env.DB.prepare('SELECT email, name FROM customers WHERE id = ?').bind(user.id).first<any>()
    let bookerName = 'A team member'
    if (user.d2dMemberId) {
      const bm = await c.env.DB.prepare('SELECT name FROM d2d_team_members WHERE id = ?').bind(user.d2dMemberId).first<any>()
      if (bm?.name) bookerName = bm.name
    } else if (owner?.name) {
      bookerName = owner.name
    }
    if (owner?.email && c.env.GCP_SERVICE_ACCOUNT_JSON) {
      const subject = `New D2D Lead: ${customer_name} — ${appointment_date} ${appointment_time}`
      const html = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
          <h2 style="color:#6366f1">New Appointment Booked</h2>
          <p><strong>${bookerName}</strong> booked an appointment (${ct} lead).</p>
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:6px;border-bottom:1px solid #eee"><b>Customer</b></td><td style="padding:6px;border-bottom:1px solid #eee">${customer_name}</td></tr>
            <tr><td style="padding:6px;border-bottom:1px solid #eee"><b>Address</b></td><td style="padding:6px;border-bottom:1px solid #eee">${address}</td></tr>
            <tr><td style="padding:6px;border-bottom:1px solid #eee"><b>Date</b></td><td style="padding:6px;border-bottom:1px solid #eee">${appointment_date}</td></tr>
            <tr><td style="padding:6px;border-bottom:1px solid #eee"><b>Time</b></td><td style="padding:6px;border-bottom:1px solid #eee">${appointment_time}</td></tr>
            ${notes ? `<tr><td style="padding:6px;border-bottom:1px solid #eee"><b>Notes</b></td><td style="padding:6px;border-bottom:1px solid #eee">${String(notes).replace(/</g,'&lt;')}</td></tr>` : ''}
          </table>
          <p style="margin-top:20px"><a href="https://www.roofmanager.ca/customer/d2d" style="background:#6366f1;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open Leads Dashboard</a></p>
        </div>`
      await sendGmailEmail(c.env.GCP_SERVICE_ACCOUNT_JSON, owner.email, subject, html, owner.email).catch((e) => console.warn("[silent-catch]", (e && e.message) || e))
    }
  } catch (e) { console.log('[D2D appt email]', (e as any).message) }

  return c.json({ success: true, id: apptId })
})

// LIST appointments — owner sees all; members see only ones assigned to them
d2dRoutes.get('/appointments', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  await ensureD2DTables(c.env.DB)

  const status = c.req.query('status')
  let q = `SELECT a.*,
      creator.name as created_by_name,
      assignee.name as assigned_to_name,
      assignee.color as assigned_color
    FROM d2d_appointments a
    LEFT JOIN d2d_team_members creator ON creator.id = a.created_by_member_id
    LEFT JOIN d2d_team_members assignee ON assignee.id = a.assigned_to_member_id
    WHERE a.owner_id = ?`
  const params: any[] = [user.id]

  if (user.isTeamMember && user.d2dMemberId) {
    q += ' AND a.assigned_to_member_id = ?'
    params.push(user.d2dMemberId)
  }
  if (status && isValidApptStatus(status)) {
    q += ' AND a.status = ?'
    params.push(status)
  }
  q += ' ORDER BY a.created_at DESC LIMIT 200'

  const rows = await c.env.DB.prepare(q).bind(...params).all()
  return c.json({ appointments: rows.results, viewer_role: user.isTeamMember ? 'member' : 'owner' })
})

// ASSIGN / DISPERSE appointment to a closer — owner only
d2dRoutes.patch('/appointments/:id/assign', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (user.isTeamMember) return c.json({ error: 'Forbidden' }, 403)
  const id = c.req.param('id')
  const { assigned_to_member_id } = await c.req.json().catch(() => ({}))

  if (assigned_to_member_id) {
    const member = await c.env.DB.prepare(
      'SELECT id FROM d2d_team_members WHERE id = ? AND owner_id = ? AND is_active = 1'
    ).bind(assigned_to_member_id, user.id).first<any>()
    if (!member) return c.json({ error: 'Invalid team member' }, 400)
  }

  await c.env.DB.prepare(
    `UPDATE d2d_appointments SET assigned_to_member_id = ?, status = CASE WHEN status = 'new' THEN 'assigned' ELSE status END,
     updated_at = datetime('now') WHERE id = ? AND owner_id = ?`
  ).bind(assigned_to_member_id || null, id, user.id).run()

  return c.json({ success: true })
})

// UPDATE status — owner or the assigned member
d2dRoutes.patch('/appointments/:id/status', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  const { status } = await c.req.json().catch(() => ({}))
  if (!isValidApptStatus(status)) return c.json({ error: 'Invalid status' }, 400)

  const appt = await c.env.DB.prepare(
    'SELECT assigned_to_member_id FROM d2d_appointments WHERE id = ? AND owner_id = ?'
  ).bind(id, user.id).first<any>()
  if (!appt) return c.json({ error: 'Not found' }, 404)

  if (user.isTeamMember && appt.assigned_to_member_id !== user.d2dMemberId) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await c.env.DB.prepare(
    `UPDATE d2d_appointments SET status = ?, updated_at = datetime('now') WHERE id = ? AND owner_id = ?`
  ).bind(status, id, user.id).run()

  return c.json({ success: true })
})

// DELETE — owner only
d2dRoutes.delete('/appointments/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  if (user.isTeamMember) return c.json({ error: 'Forbidden' }, 403)
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM d2d_appointments WHERE id = ? AND owner_id = ?').bind(id, user.id).run()
  return c.json({ success: true })
})

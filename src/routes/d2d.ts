import { Hono } from 'hono'
import type { Bindings } from '../types'
import { resolveTeamOwner } from './team'

export const d2dRoutes = new Hono<{ Bindings: Bindings }>()

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
  q += ' ORDER BY p.updated_at DESC'

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

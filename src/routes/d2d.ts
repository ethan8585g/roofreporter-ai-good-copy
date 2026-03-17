import { Hono } from 'hono'
import type { Bindings } from '../types'
import { resolveTeamOwner } from './team'

export const d2dRoutes = new Hono<{ Bindings: Bindings }>()

// ============================================================
// AUTH MIDDLEWARE — Validate customer session token
// Team members resolve to the owner's D2D data
// ============================================================
async function getUser(c: any): Promise<{ id: number; role?: string; effectiveOwnerId: number; isTeamMember: boolean } | null> {
  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const session = await c.env.DB.prepare(
    "SELECT cs.customer_id, cu.name, cu.email FROM customer_sessions cs JOIN customers cu ON cu.id = cs.customer_id WHERE cs.session_token = ? AND cs.expires_at > datetime('now')"
  ).bind(token).first<any>()
  if (!session) return null

  // Resolve team membership — team members access owner's D2D data
  const teamInfo = await resolveTeamOwner(c.env.DB, session.customer_id)
  const effectiveId = teamInfo.ownerId

  // Check if user has a d2d_team_members entry for role
  const member = await c.env.DB.prepare(
    'SELECT role FROM d2d_team_members WHERE customer_id = ?'
  ).bind(effectiveId).first<any>()

  return { id: effectiveId, role: member?.role || 'member', effectiveOwnerId: effectiveId, isTeamMember: teamInfo.isTeamMember }
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
      (SELECT COUNT(*) FROM d2d_pins p WHERE p.knocked_by = tm.id AND p.status = 'yes') as yes_count
     FROM d2d_team_members tm WHERE tm.owner_id = ? AND tm.is_active = 1 ORDER BY tm.name`
  ).bind(user.id).all()

  return c.json({ members: members.results })
})

// CREATE team member
d2dRoutes.post('/team', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  await ensureD2DTables(c.env.DB)

  const { name, email, phone, role, color } = await c.req.json()
  if (!name) return c.json({ error: 'Name is required' }, 400)

  // Check if this email matches an existing customer account
  let customerId = null
  if (email) {
    const existing = await c.env.DB.prepare('SELECT id FROM customers WHERE email = ?').bind(email).first<any>()
    if (existing) customerId = existing.id
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO d2d_team_members (owner_id, customer_id, name, email, phone, role, color)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(user.id, customerId, name, email || null, phone || null, role || 'salesperson', color || '#3B82F6').run()

  return c.json({ success: true, id: result.meta.last_row_id })
})

// UPDATE team member
d2dRoutes.put('/team/:id', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const id = c.req.param('id')
  const { name, email, phone, role, color, is_active } = await c.req.json()

  await c.env.DB.prepare(
    `UPDATE d2d_team_members SET name = COALESCE(?, name), email = COALESCE(?, email),
     phone = COALESCE(?, phone), role = COALESCE(?, role), color = COALESCE(?, color),
     is_active = COALESCE(?, is_active) WHERE id = ? AND owner_id = ?`
  ).bind(name, email, phone, role, color, is_active, id, user.id).run()

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

// LIST turfs
d2dRoutes.get('/turfs', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  await ensureD2DTables(c.env.DB)

  const turfs = await c.env.DB.prepare(
    `SELECT t.*, tm.name as assigned_name, tm.color as member_color,
      (SELECT COUNT(*) FROM d2d_pins p WHERE p.turf_id = t.id) as total_pins,
      (SELECT COUNT(*) FROM d2d_pins p WHERE p.turf_id = t.id AND p.status = 'yes') as yes_count,
      (SELECT COUNT(*) FROM d2d_pins p WHERE p.turf_id = t.id AND p.status = 'no') as no_count,
      (SELECT COUNT(*) FROM d2d_pins p WHERE p.turf_id = t.id AND p.status = 'no_answer') as no_answer_count,
      (SELECT COUNT(*) FROM d2d_pins p WHERE p.turf_id = t.id AND p.status = 'not_knocked') as not_knocked_count
     FROM d2d_turfs t LEFT JOIN d2d_team_members tm ON tm.id = t.assigned_to
     WHERE t.owner_id = ? ORDER BY t.created_at DESC`
  ).bind(user.id).all()

  return c.json({ turfs: turfs.results })
})

// CREATE turf
d2dRoutes.post('/turfs', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
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
  const id = c.req.param('id')
  // Delete pins first, then the turf
  await c.env.DB.prepare('DELETE FROM d2d_pins WHERE turf_id = ? AND owner_id = ?').bind(id, user.id).run()
  await c.env.DB.prepare('DELETE FROM d2d_turfs WHERE id = ? AND owner_id = ?').bind(id, user.id).run()
  return c.json({ success: true })
})

// ============================================================
// PINS (Door Knocks)
// ============================================================

// LIST pins for a turf (or all)
d2dRoutes.get('/pins', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  await ensureD2DTables(c.env.DB)

  const turfId = c.req.query('turf_id')
  const status = c.req.query('status')

  let q = `SELECT p.*, tm.name as knocked_by_name, t.name as turf_name
     FROM d2d_pins p
     LEFT JOIN d2d_team_members tm ON tm.id = p.knocked_by
     LEFT JOIN d2d_turfs t ON t.id = p.turf_id
     WHERE p.owner_id = ?`
  const params: any[] = [user.id]
  if (turfId) { q += ' AND p.turf_id = ?'; params.push(turfId) }
  if (status) { q += ' AND p.status = ?'; params.push(status) }
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

  return c.json({ stats })
})

// ============================================================
// TURF ASSIGNMENT PUSH — Assign turf to team member + notify
// ============================================================
d2dRoutes.post('/turfs/:id/assign', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  await ensureD2DTables(c.env.DB)
  const turfId = c.req.param('id')
  const { team_member_id } = await c.req.json()

  if (!team_member_id) return c.json({ error: 'team_member_id is required' }, 400)

  // Verify ownership
  const turf = await c.env.DB.prepare('SELECT * FROM d2d_turfs WHERE id = ? AND owner_id = ?').bind(turfId, user.id).first()
  if (!turf) return c.json({ error: 'Turf not found' }, 404)

  const member = await c.env.DB.prepare('SELECT * FROM d2d_team_members WHERE id = ? AND owner_id = ?').bind(team_member_id, user.id).first<any>()
  if (!member) return c.json({ error: 'Team member not found' }, 404)

  await c.env.DB.prepare(
    'UPDATE d2d_turfs SET assigned_to = ?, status = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(team_member_id, 'assigned', turfId).run()

  // Create in-app notification for the team member
  try {
    if (member.customer_id) {
      await c.env.DB.prepare(
        "INSERT INTO notifications (owner_id, type, title, message, link) VALUES (?, 'turf_assigned', ?, ?, '/customer/d2d')"
      ).bind(member.customer_id, `New Turf Assigned: ${(turf as any).name}`, `You've been assigned the "${(turf as any).name}" turf for door knocking. Open your D2D Manager to see the territory.`).run()
    }
  } catch {}

  // Send email notification to team member
  try {
    if (member.email) {
      const ownerInfo = await c.env.DB.prepare('SELECT name, company_name, brand_business_name FROM customers WHERE id = ?').bind(user.id).first<any>()
      const businessName = ownerInfo?.brand_business_name || ownerInfo?.company_name || ownerInfo?.name || 'Your Team'

      const resendKey = (c.env as any).RESEND_API_KEY
      if (resendKey) {
        const emailHtml = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f8fafc">
<div style="background:linear-gradient(135deg,#2563eb,#7c3aed);padding:24px;border-radius:12px 12px 0 0;text-align:center">
  <h1 style="color:#fff;margin:0;font-size:20px">New Door Knocking Turf Assigned</h1>
</div>
<div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-radius:0 0 12px 12px">
  <p style="font-size:16px;color:#1e293b">Hey <strong>${member.name}</strong>,</p>
  <p style="color:#475569;line-height:1.6">${businessName} just assigned you a new door knocking territory:</p>
  <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px;margin:16px 0;text-align:center">
    <p style="margin:0;font-size:18px;font-weight:700;color:#0369a1">${(turf as any).name}</p>
    ${(turf as any).description ? `<p style="margin:8px 0 0;color:#475569;font-size:13px">${(turf as any).description}</p>` : ''}
  </div>
  <p style="color:#475569;font-size:14px">Log in to your D2D Manager to view the territory map, track your door knocks, and log results.</p>
  <div style="text-align:center;margin:24px 0">
    <a href="${new URL(c.req.url).origin}/customer/d2d" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px">Open D2D Manager</a>
  </div>
</div>
<p style="text-align:center;color:#94a3b8;font-size:11px;margin-top:16px">&copy; ${new Date().getFullYear()} RoofReporterAI</p>
</body></html>`

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'RoofReporterAI <onboarding@resend.dev>',
            to: [member.email],
            subject: `New Turf Assigned: ${(turf as any).name} — ${businessName}`,
            html: emailHtml
          })
        }).catch(() => {})
      }
    }
  } catch {}

  return c.json({
    success: true,
    message: `Turf assigned to ${member.name}`,
    turf_id: parseInt(turfId),
    assigned_to: { id: member.id, name: member.name, email: member.email },
    notification_sent: !!member.email
  })
})

// GET /team/:id/overview — Admin overview of a specific team member
d2dRoutes.get('/team/:id/overview', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  await ensureD2DTables(c.env.DB)
  const memberId = c.req.param('id')

  const member = await c.env.DB.prepare(
    'SELECT * FROM d2d_team_members WHERE id = ? AND owner_id = ?'
  ).bind(memberId, user.id).first<any>()
  if (!member) return c.json({ error: 'Team member not found' }, 404)

  // Get assigned turfs
  const { results: turfs } = await c.env.DB.prepare(
    'SELECT * FROM d2d_turfs WHERE assigned_to = ? ORDER BY created_at DESC'
  ).bind(memberId).all()

  // Get pin stats for this member
  const pinStats = await c.env.DB.prepare(`
    SELECT
      COUNT(*) as total_pins,
      COUNT(CASE WHEN status = 'yes' THEN 1 END) as yes_count,
      COUNT(CASE WHEN status = 'no' THEN 1 END) as no_count,
      COUNT(CASE WHEN status = 'no_answer' THEN 1 END) as no_answer_count,
      COUNT(CASE WHEN status = 'not_knocked' THEN 1 END) as not_knocked_count,
      COUNT(CASE WHEN status = 'callback' THEN 1 END) as callback_count
    FROM d2d_pins WHERE knocked_by = ?
  `).bind(memberId).first<any>()

  // Get recent pins
  const { results: recentPins } = await c.env.DB.prepare(
    'SELECT * FROM d2d_pins WHERE knocked_by = ? ORDER BY knocked_at DESC LIMIT 25'
  ).bind(memberId).all()

  // Calculate success rate
  const totalKnocked = (pinStats?.total_pins || 0) - (pinStats?.not_knocked_count || 0)
  const successRate = totalKnocked > 0 ? Math.round(((pinStats?.yes_count || 0) / totalKnocked) * 100) : 0

  return c.json({
    member,
    turfs: turfs || [],
    stats: {
      ...(pinStats || {}),
      total_knocked: totalKnocked,
      success_rate: successRate
    },
    recent_pins: recentPins || []
  })
})

// ============================================================
// CRM MODULE TOGGLE — Admin enables/disables D2D CRM modules
// ============================================================
d2dRoutes.get('/modules', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)

  const row = await c.env.DB.prepare(
    "SELECT setting_value FROM settings WHERE setting_key = 'd2d_modules' AND master_company_id = ?"
  ).bind(user.id).first<any>()

  const defaults = {
    turfs_enabled: true,
    pins_enabled: true,
    team_enabled: true,
    map_view_enabled: true,
    success_metrics_enabled: true,
    route_planning_enabled: false,
    incentives_enabled: false,
  }

  let modules = defaults
  if (row?.setting_value) {
    try { modules = { ...defaults, ...JSON.parse(row.setting_value) } } catch {}
  }

  return c.json({ modules })
})

d2dRoutes.put('/modules', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  const body = await c.req.json()

  await c.env.DB.prepare(`
    INSERT OR REPLACE INTO settings (master_company_id, setting_key, setting_value)
    VALUES (?, 'd2d_modules', ?)
  `).bind(user.id, JSON.stringify(body.modules || body)).run()

  return c.json({ success: true, modules: body.modules || body })
})

// ============================================================
// MAP PINS — Get all pins with lat/lng for map display
// ============================================================
d2dRoutes.get('/map-pins', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  await ensureD2DTables(c.env.DB)

  const { team_member_id, turf_id, status } = c.req.query() as any
  let query = 'SELECT p.*, t.name as turf_name, tm.name as member_name FROM d2d_pins p LEFT JOIN d2d_turfs t ON t.id = p.turf_id LEFT JOIN d2d_team_members tm ON tm.id = p.knocked_by WHERE p.owner_id = ?'
  const params: any[] = [user.id]

  if (team_member_id) { query += ' AND p.knocked_by = ?'; params.push(team_member_id) }
  if (turf_id) { query += ' AND p.turf_id = ?'; params.push(turf_id) }
  if (status) { query += ' AND p.status = ?'; params.push(status) }

  query += ' ORDER BY p.knocked_at DESC LIMIT 500'
  const { results } = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ pins: results })
})

// ============================================================
// ENHANCED STATS — Per-member and per-turf breakdown
// ============================================================
d2dRoutes.get('/stats/detailed', async (c) => {
  const user = await getUser(c)
  if (!user) return c.json({ error: 'Not authenticated' }, 401)
  await ensureD2DTables(c.env.DB)

  // Per-member stats
  const memberStats = await c.env.DB.prepare(`
    SELECT tm.id, tm.name, tm.email,
      COUNT(p.id) as total_pins,
      SUM(CASE WHEN p.status = 'yes' THEN 1 ELSE 0 END) as yes_count,
      SUM(CASE WHEN p.status = 'no' THEN 1 ELSE 0 END) as no_count,
      SUM(CASE WHEN p.status = 'no_answer' THEN 1 ELSE 0 END) as no_answer_count,
      SUM(CASE WHEN p.status != 'not_knocked' THEN 1 ELSE 0 END) as knocked_count
    FROM d2d_team_members tm
    LEFT JOIN d2d_pins p ON p.knocked_by = tm.id
    WHERE tm.owner_id = ? AND tm.is_active = 1
    GROUP BY tm.id
    ORDER BY yes_count DESC
  `).bind(user.id).all()

  // Per-turf stats
  const turfStats = await c.env.DB.prepare(`
    SELECT t.id, t.name, t.assigned_to, t.status,
      COUNT(p.id) as total_pins,
      SUM(CASE WHEN p.status = 'yes' THEN 1 ELSE 0 END) as yes_count,
      SUM(CASE WHEN p.status = 'no' THEN 1 ELSE 0 END) as no_count
    FROM d2d_turfs t
    LEFT JOIN d2d_pins p ON p.turf_id = t.id
    WHERE t.owner_id = ?
    GROUP BY t.id
    ORDER BY t.created_at DESC
  `).bind(user.id).all()

  return c.json({
    member_stats: (memberStats.results || []).map((m: any) => ({
      ...m,
      success_rate: m.knocked_count > 0 ? Math.round((m.yes_count / m.knocked_count) * 100) : 0
    })),
    turf_stats: turfStats.results || []
  })
})

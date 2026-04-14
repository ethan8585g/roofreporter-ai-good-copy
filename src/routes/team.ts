import { Hono } from 'hono'
import type { Bindings } from '../types'
import { getActivityFeed } from '../lib/team-activity'

export const teamRoutes = new Hono<{ Bindings: Bindings }>()

// ============================================================
// CONSTANTS
// ============================================================
const SEAT_PRICE_CENTS = 5000 // $50.00 / month per team member
const INVITE_EXPIRY_DAYS = 7

// ============================================================
// AUTH HELPER — Get current customer from session token
// ============================================================
async function getCustomer(db: D1Database, token: string | undefined): Promise<any | null> {
  if (!token) return null
  const row = await db.prepare(`
    SELECT cs.customer_id, c.* FROM customer_sessions cs
    JOIN customers c ON c.id = cs.customer_id
    WHERE cs.session_token = ? AND cs.expires_at > datetime('now') AND c.is_active = 1
  `).bind(token).first<any>()
  return row
}

// ============================================================
// TEAM CONTEXT HELPER — Resolve effective owner for team members
// If the logged-in user is a team member, return their owner_id
// so all CRM/order/report queries scope to the owner's data.
// ============================================================
export async function resolveTeamOwner(db: D1Database, customerId: number): Promise<{ ownerId: number; isTeamMember: boolean; teamMemberRole: string | null; teamMemberId: number | null }> {
  // Check if this customer is an active team member of someone else's account
  const membership = await db.prepare(`
    SELECT id, owner_id, role FROM team_members
    WHERE member_customer_id = ? AND status = 'active'
    LIMIT 1
  `).bind(customerId).first<any>()

  if (membership) {
    return {
      ownerId: membership.owner_id,
      isTeamMember: true,
      teamMemberRole: membership.role,
      teamMemberId: membership.id
    }
  }

  // Not a team member — they are the owner of their own account
  return { ownerId: customerId, isTeamMember: false, teamMemberRole: null, teamMemberId: null }
}

// ============================================================
// GATING HELPER — Evaluates subscription tier + seat usage
// Shared by POST /invite (enforcement) and GET /gating (UI)
// ============================================================
export async function evaluateTeamGating(db: D1Database, ownerId: number) {
  const tierLimits: Record<string, number> = { starter: 5, professional: 10, enterprise: 25 }
  const tierPrices: Record<string, string> = { starter: '$49.99', professional: '$99.99', enterprise: '$199.99' }
  const nextTier: Record<string, string> = { starter: 'professional', professional: 'enterprise' }

  const owner = await db.prepare(
    'SELECT subscription_tier, subscription_status, tier_features FROM customers WHERE id = ?'
  ).bind(ownerId).first<any>()

  const ownerTier = owner?.subscription_tier || 'starter'
  const isSubscribed = owner?.subscription_status === 'active'

  let teamLimit = tierLimits[ownerTier] || 5
  try { const tf = JSON.parse(owner?.tier_features || '{}'); if (tf.team_limit) teamLimit = tf.team_limit } catch {}

  const activeRow = await db.prepare(
    "SELECT COUNT(*) as cnt FROM team_members WHERE owner_id = ? AND status = 'active'"
  ).bind(ownerId).first<any>()
  const activeSeats = activeRow?.cnt || 0
  const upgrade = nextTier[ownerTier] || null

  return {
    subscribed: isSubscribed,
    tier: ownerTier,
    tier_price: tierPrices[ownerTier] || null,
    team_limit: teamLimit,
    active_seats: activeSeats,
    remaining_seats: Math.max(0, teamLimit - activeSeats),
    at_cap: activeSeats >= teamLimit,
    next_tier: upgrade,
    next_price: upgrade ? tierPrices[upgrade] : null,
    next_team_limit: upgrade ? tierLimits[upgrade] : null
  }
}

// ============================================================
// MIDDLEWARE — Require auth + extract customer
// ============================================================
async function requireAuth(c: any): Promise<{ customer: any; customerId: number } | null> {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  const customer = await getCustomer(c.env.DB, token)
  if (!customer) return null
  return { customer, customerId: customer.customer_id || customer.id }
}

// ============================================================
// GET /team/members — List all team members for this account
// ============================================================
teamRoutes.get('/members', async (c) => {
  const auth = await requireAuth(c)
  if (!auth) return c.json({ error: 'Not authenticated' }, 401)

  const { customerId } = auth
  const { ownerId, isTeamMember, teamMemberRole } = await resolveTeamOwner(c.env.DB, customerId)

  // Only the account owner or team admins can view the team roster
  if (isTeamMember && teamMemberRole !== 'admin') {
    // Regular team members can see a simplified roster (names + roles only)
    const members = await c.env.DB.prepare(`
      SELECT id, name, email, role, status, joined_at FROM team_members
      WHERE owner_id = ? AND status = 'active'
      ORDER BY role DESC, name
    `).bind(ownerId).all()
    return c.json({ members: members.results, is_team_member: true, can_manage: false })
  }

  // Full roster for owner / admin
  const members = await c.env.DB.prepare(`
    SELECT tm.*, c.email as account_email, c.name as account_name, c.last_login as member_last_login
    FROM team_members tm
    LEFT JOIN customers c ON c.id = tm.member_customer_id
    WHERE tm.owner_id = ?
    ORDER BY tm.status, tm.role DESC, tm.name
  `).bind(ownerId).all()

  // Pending invitations
  const invitations = await c.env.DB.prepare(`
    SELECT * FROM team_invitations
    WHERE owner_id = ? AND status = 'pending' AND expires_at > datetime('now')
    ORDER BY created_at DESC
  `).bind(ownerId).all()

  // Billing summary
  const activeSeatCount = members.results?.filter((m: any) => m.status === 'active').length || 0
  const monthlyTotal = activeSeatCount * SEAT_PRICE_CENTS

  return c.json({
    members: members.results,
    invitations: invitations.results,
    billing: {
      active_seats: activeSeatCount,
      price_per_seat_cents: SEAT_PRICE_CENTS,
      price_per_seat_display: '$50.00',
      monthly_total_cents: monthlyTotal,
      monthly_total_display: `$${(monthlyTotal / 100).toFixed(2)}`
    },
    is_team_member: isTeamMember,
    can_manage: !isTeamMember || teamMemberRole === 'admin'
  })
})

// ============================================================
// POST /team/invite — Send invitation to a new team member
// ============================================================
teamRoutes.post('/invite', async (c) => {
  const auth = await requireAuth(c)
  if (!auth) return c.json({ error: 'Not authenticated' }, 401)

  const { customerId, customer } = auth
  const { ownerId, isTeamMember, teamMemberRole } = await resolveTeamOwner(c.env.DB, customerId)

  // Only owner or admin can invite
  if (isTeamMember && teamMemberRole !== 'admin') {
    return c.json({ error: 'Only account owners or team admins can invite members' }, 403)
  }

  // Enforce subscription + team size limit based on tier
  const gating = await evaluateTeamGating(c.env.DB, ownerId)

  if (!gating.subscribed) {
    return c.json({
      error: 'A Starter membership ($49.99/month) is required to add team members. Your plan includes up to 5 team members.',
      subscription_required: true,
      tier: 'starter',
      price: '$49.99',
      team_limit: 5
    }, 402)
  }

  if (gating.at_cap) {
    return c.json({
      error: gating.next_tier
        ? `Your ${gating.tier} plan includes ${gating.team_limit} team members. Upgrade to ${gating.next_tier} (${gating.next_price}/month) for ${gating.next_team_limit} team members.`
        : `Your ${gating.tier} plan supports up to ${gating.team_limit} team members. Contact sales for more.`,
      upgrade_required: !!gating.next_tier,
      current_tier: gating.tier,
      next_tier: gating.next_tier,
      next_price: gating.next_price,
      next_team_limit: gating.next_team_limit,
      team_limit: gating.team_limit,
      current_count: gating.active_seats
    }, 402)
  }

  const body = await c.req.json()
  const email = (body.email || '').toLowerCase().trim()
  const name = (body.name || '').trim()
  const role = body.role === 'admin' ? 'admin' : 'member'

  // Validate and sanitize permissions — only known keys allowed
  const ALLOWED_PERM_KEYS = ['orders', 'reports', 'crm', 'secretary', 'virtual_tryon']
  const defaultPerms = { orders: true, reports: true, crm: true, secretary: true, virtual_tryon: true }
  let permissions = defaultPerms
  if (body.permissions && typeof body.permissions === 'object') {
    permissions = Object.fromEntries(
      ALLOWED_PERM_KEYS.map(k => [k, body.permissions[k] !== false])
    ) as typeof defaultPerms
  }

  if (!email || !name) {
    return c.json({ error: 'Email and name are required' }, 400)
  }

  // Check if already a team member
  const existing = await c.env.DB.prepare(`
    SELECT id, status FROM team_members WHERE owner_id = ? AND email = ?
  `).bind(ownerId, email).first<any>()

  if (existing && existing.status === 'active') {
    return c.json({ error: 'This person is already on your team' }, 409)
  }

  // Check for pending invitation
  const pendingInvite = await c.env.DB.prepare(`
    SELECT id FROM team_invitations WHERE owner_id = ? AND email = ? AND status = 'pending' AND expires_at > datetime('now')
  `).bind(ownerId, email).first<any>()

  if (pendingInvite) {
    return c.json({ error: 'An invitation is already pending for this email' }, 409)
  }

  // Generate invite token
  const inviteToken = crypto.randomUUID() + '-' + crypto.randomUUID()
  const expiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString()

  await c.env.DB.prepare(`
    INSERT INTO team_invitations (owner_id, email, name, role, invite_token, expires_at, permissions)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(ownerId, email, name, role, inviteToken, expiresAt, JSON.stringify(permissions)).run()

  // Send invitation email
  const ownerName = customer.name || customer.company_name || 'Your colleague'
  const inviteUrl = `${new URL(c.req.url).origin}/customer/join-team?token=${inviteToken}`
  await sendTeamInviteEmail(c.env, email, name, ownerName, customer.company_name || 'Roof Manager', inviteUrl, role)

  return c.json({
    success: true,
    message: `Invitation sent to ${email}`,
    invite_url: inviteUrl,
    expires_at: expiresAt
  })
})

// ============================================================
// GET /team/invite/:token — Validate an invite token (public)
// ============================================================
teamRoutes.get('/invite/:token', async (c) => {
  const token = c.req.param('token')

  const invite = await c.env.DB.prepare(`
    SELECT ti.*, c.name as owner_name, c.company_name as owner_company
    FROM team_invitations ti
    JOIN customers c ON c.id = ti.owner_id
    WHERE ti.invite_token = ? AND ti.status = 'pending'
  `).bind(token).first<any>()

  if (!invite) {
    return c.json({ error: 'Invalid or expired invitation' }, 404)
  }

  if (new Date(invite.expires_at) < new Date()) {
    await c.env.DB.prepare(`UPDATE team_invitations SET status = 'expired' WHERE id = ?`).bind(invite.id).run()
    return c.json({ error: 'This invitation has expired' }, 410)
  }

  return c.json({
    valid: true,
    invite: {
      email: invite.email,
      name: invite.name,
      role: invite.role,
      owner_name: invite.owner_name,
      owner_company: invite.owner_company,
      expires_at: invite.expires_at
    }
  })
})

// ============================================================
// POST /team/accept — Accept an invitation (requires logged-in user)
// ============================================================
teamRoutes.post('/accept', async (c) => {
  const auth = await requireAuth(c)
  if (!auth) return c.json({ error: 'You must be logged in to accept an invitation' }, 401)

  const { customerId } = auth
  const body = await c.req.json()
  const inviteToken = body.invite_token

  if (!inviteToken) return c.json({ error: 'Invite token is required' }, 400)

  const invite = await c.env.DB.prepare(`
    SELECT * FROM team_invitations
    WHERE invite_token = ? AND status = 'pending' AND expires_at > datetime('now')
  `).bind(inviteToken).first<any>()

  if (!invite) return c.json({ error: 'Invalid or expired invitation' }, 404)

  // Verify the logged-in user's email matches the invitation
  const memberCustomer = await c.env.DB.prepare('SELECT email FROM customers WHERE id = ?').bind(customerId).first<any>()
  if (memberCustomer && memberCustomer.email.toLowerCase() !== invite.email.toLowerCase()) {
    return c.json({ error: `This invitation was sent to ${invite.email}. Please log in with that email address.` }, 403)
  }

  // Check not already on team
  const existingMember = await c.env.DB.prepare(`
    SELECT id FROM team_members WHERE owner_id = ? AND member_customer_id = ? AND status = 'active'
  `).bind(invite.owner_id, customerId).first<any>()

  if (existingMember) {
    return c.json({ error: 'You are already a member of this team' }, 409)
  }

  // Carry permissions from the invitation (if stored), else full access default.
  // Enforce a strict shape — a corrupted or hostile `permissions` JSON blob must not
  // be able to grant modules the inviter did not authorize.
  const ALLOWED_PERM_KEYS = ['orders','reports','crm','pipeline','jobs','invoices','proposals','secretary','cold_call','d2d','billing','settings','team']
  const sanitizePermissions = (raw: any) => {
    let obj: any = {}
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) obj = raw
    else { try { const p = JSON.parse(String(raw || '{}')); if (p && typeof p === 'object' && !Array.isArray(p)) obj = p } catch {} }
    const out: Record<string, boolean> = {}
    for (const k of ALLOWED_PERM_KEYS) out[k] = obj[k] === true
    return out
  }
  const invitePermissions = sanitizePermissions(invite.permissions)

  // Create team member record
  const now = new Date().toISOString()
  const memberResult = await c.env.DB.prepare(`
    INSERT INTO team_members (owner_id, member_customer_id, email, name, role, status, permissions, billing_started_at, joined_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).bind(invite.owner_id, customerId, invite.email, invite.name, invite.role, JSON.stringify(invitePermissions), now, now).run()

  const teamMemberId = memberResult.meta.last_row_id

  // Update invitation status
  await c.env.DB.prepare(`
    UPDATE team_invitations SET status = 'accepted', accepted_at = ?, team_member_id = ? WHERE id = ?
  `).bind(now, teamMemberId, invite.id).run()

  // Reactivate if previously removed
  if (existingMember) {
    await c.env.DB.prepare(`
      UPDATE team_members SET status = 'active', member_customer_id = ?, joined_at = ?, billing_started_at = ?, updated_at = ? WHERE id = ?
    `).bind(customerId, now, now, now, existingMember.id).run()
  }

  return c.json({
    success: true,
    message: 'You have joined the team!',
    team_member_id: teamMemberId,
    role: invite.role
  })
})

// ============================================================
// PUT /team/members/:id — Update a team member (role, permissions)
// ============================================================
teamRoutes.put('/members/:id', async (c) => {
  const auth = await requireAuth(c)
  if (!auth) return c.json({ error: 'Not authenticated' }, 401)

  const { customerId } = auth
  const { ownerId, isTeamMember, teamMemberRole } = await resolveTeamOwner(c.env.DB, customerId)

  if (isTeamMember && teamMemberRole !== 'admin') {
    return c.json({ error: 'Only account owners or admins can update team members' }, 403)
  }

  const memberId = c.req.param('id')
  const body = await c.req.json()

  const member = await c.env.DB.prepare(`
    SELECT * FROM team_members WHERE id = ? AND owner_id = ?
  `).bind(memberId, ownerId).first<any>()

  if (!member) return c.json({ error: 'Team member not found' }, 404)

  const updates: string[] = []
  const values: any[] = []

  if (body.role && ['admin', 'member'].includes(body.role)) {
    updates.push('role = ?')
    values.push(body.role)
  }
  if (body.name) {
    updates.push('name = ?')
    values.push(body.name.trim())
  }
  if (body.permissions) {
    const ALLOWED_PERM_KEYS = ['orders','reports','crm','pipeline','jobs','invoices','proposals','secretary','cold_call','d2d','billing','settings','team']
    const raw = body.permissions && typeof body.permissions === 'object' && !Array.isArray(body.permissions) ? body.permissions : {}
    const safe: Record<string, boolean> = {}
    for (const k of ALLOWED_PERM_KEYS) safe[k] = raw[k] === true
    updates.push('permissions = ?')
    values.push(JSON.stringify(safe))
  }

  if (updates.length === 0) return c.json({ error: 'No changes provided' }, 400)

  updates.push("updated_at = datetime('now')")
  values.push(memberId, ownerId)

  await c.env.DB.prepare(`
    UPDATE team_members SET ${updates.join(', ')} WHERE id = ? AND owner_id = ?
  `).bind(...values).run()

  return c.json({ success: true, message: 'Team member updated' })
})

// ============================================================
// DELETE /team/members/:id — Remove a team member
// ============================================================
teamRoutes.delete('/members/:id', async (c) => {
  const auth = await requireAuth(c)
  if (!auth) return c.json({ error: 'Not authenticated' }, 401)

  const { customerId } = auth
  const { ownerId, isTeamMember, teamMemberRole } = await resolveTeamOwner(c.env.DB, customerId)

  if (isTeamMember && teamMemberRole !== 'admin') {
    return c.json({ error: 'Only account owners or admins can remove team members' }, 403)
  }

  const memberId = c.req.param('id')

  const member = await c.env.DB.prepare(`
    SELECT * FROM team_members WHERE id = ? AND owner_id = ?
  `).bind(memberId, ownerId).first<any>()

  if (!member) return c.json({ error: 'Team member not found' }, 404)

  // Soft delete — mark as removed, stop billing
  await c.env.DB.prepare(`
    UPDATE team_members SET status = 'removed', billing_paused_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND owner_id = ?
  `).bind(memberId, ownerId).run()

  return c.json({ success: true, message: `${member.name} has been removed from the team` })
})

// ============================================================
// POST /team/members/:id/suspend — Pause a team member (billing paused)
// ============================================================
teamRoutes.post('/members/:id/suspend', async (c) => {
  const auth = await requireAuth(c)
  if (!auth) return c.json({ error: 'Not authenticated' }, 401)

  const { customerId } = auth
  const { ownerId, isTeamMember, teamMemberRole } = await resolveTeamOwner(c.env.DB, customerId)
  if (isTeamMember && teamMemberRole !== 'admin') return c.json({ error: 'Forbidden' }, 403)

  const memberId = c.req.param('id')
  await c.env.DB.prepare(`
    UPDATE team_members SET status = 'suspended', billing_paused_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND owner_id = ? AND status = 'active'
  `).bind(memberId, ownerId).run()

  return c.json({ success: true, message: 'Team member suspended' })
})

// ============================================================
// POST /team/members/:id/reactivate — Reactivate a suspended member
// ============================================================
teamRoutes.post('/members/:id/reactivate', async (c) => {
  const auth = await requireAuth(c)
  if (!auth) return c.json({ error: 'Not authenticated' }, 401)

  const { customerId } = auth
  const { ownerId, isTeamMember, teamMemberRole } = await resolveTeamOwner(c.env.DB, customerId)
  if (isTeamMember && teamMemberRole !== 'admin') return c.json({ error: 'Forbidden' }, 403)

  const memberId = c.req.param('id')
  await c.env.DB.prepare(`
    UPDATE team_members SET status = 'active', billing_paused_at = NULL, billing_started_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND owner_id = ? AND status = 'suspended'
  `).bind(memberId, ownerId).run()

  return c.json({ success: true, message: 'Team member reactivated' })
})

// ============================================================
// DELETE /team/invite/:id — Cancel a pending invitation
// ============================================================
teamRoutes.delete('/invite/:id', async (c) => {
  const auth = await requireAuth(c)
  if (!auth) return c.json({ error: 'Not authenticated' }, 401)

  const { customerId } = auth
  const { ownerId } = await resolveTeamOwner(c.env.DB, customerId)

  const inviteId = c.req.param('id')
  await c.env.DB.prepare(`
    UPDATE team_invitations SET status = 'cancelled' WHERE id = ? AND owner_id = ? AND status = 'pending'
  `).bind(inviteId, ownerId).run()

  return c.json({ success: true, message: 'Invitation cancelled' })
})

// ============================================================
// GET /team/my-membership — For a team member: what team am I on?
// ============================================================
teamRoutes.get('/my-membership', async (c) => {
  const auth = await requireAuth(c)
  if (!auth) return c.json({ error: 'Not authenticated' }, 401)

  const { customerId } = auth

  const membership = await c.env.DB.prepare(`
    SELECT tm.*, c.name as owner_name, c.company_name as owner_company, c.email as owner_email
    FROM team_members tm
    JOIN customers c ON c.id = tm.owner_id
    WHERE tm.member_customer_id = ? AND tm.status = 'active'
  `).bind(customerId).first<any>()

  if (!membership) {
    return c.json({ is_team_member: false })
  }

  return c.json({
    is_team_member: true,
    team: {
      id: membership.id,
      owner_name: membership.owner_name,
      owner_company: membership.owner_company,
      role: membership.role,
      joined_at: membership.joined_at,
      permissions: JSON.parse(membership.permissions || '{}')
    }
  })
})

// ============================================================
// POST /team/leave — Team member voluntarily leaves the team
// ============================================================
teamRoutes.post('/leave', async (c) => {
  const auth = await requireAuth(c)
  if (!auth) return c.json({ error: 'Not authenticated' }, 401)

  const { customerId } = auth

  const result = await c.env.DB.prepare(`
    UPDATE team_members SET status = 'removed', billing_paused_at = datetime('now'), updated_at = datetime('now')
    WHERE member_customer_id = ? AND status = 'active'
  `).bind(customerId).run()

  if (result.meta.changes === 0) {
    return c.json({ error: 'You are not currently on any team' }, 404)
  }

  return c.json({ success: true, message: 'You have left the team' })
})

// ============================================================
// GET /team/billing — Detailed billing for team seats
// ============================================================
teamRoutes.get('/billing', async (c) => {
  const auth = await requireAuth(c)
  if (!auth) return c.json({ error: 'Not authenticated' }, 401)

  const { customerId } = auth
  const { ownerId, isTeamMember, teamMemberRole } = await resolveTeamOwner(c.env.DB, customerId)
  if (isTeamMember && teamMemberRole !== 'admin') return c.json({ error: 'Forbidden' }, 403)

  const activeMembers = await c.env.DB.prepare(`
    SELECT id, name, email, role, billing_started_at, monthly_rate_cents
    FROM team_members WHERE owner_id = ? AND status = 'active'
  `).bind(ownerId).all()

  const totalSeats = activeMembers.results?.length || 0
  const monthlyTotal = totalSeats * SEAT_PRICE_CENTS

  // Recent billing events
  const recentBilling = await c.env.DB.prepare(`
    SELECT tb.*, tm.name as member_name
    FROM team_billing tb
    JOIN team_members tm ON tm.id = tb.team_member_id
    WHERE tb.owner_id = ?
    ORDER BY tb.created_at DESC LIMIT 20
  `).bind(ownerId).all()

  return c.json({
    billing: {
      active_seats: totalSeats,
      price_per_seat: '$50.00/month',
      monthly_total: `$${(monthlyTotal / 100).toFixed(2)}/month`,
      monthly_total_cents: monthlyTotal,
      members: activeMembers.results,
      recent_charges: recentBilling.results
    }
  })
})

// ============================================================
// GET /team/gating — Subscription + seat usage (owner-only)
// ============================================================
teamRoutes.get('/gating', async (c) => {
  const auth = await requireAuth(c)
  if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const { customerId } = auth
  const { ownerId, isTeamMember } = await resolveTeamOwner(c.env.DB, customerId)
  if (isTeamMember) return c.json({ error: 'Owner only' }, 403)
  return c.json(await evaluateTeamGating(c.env.DB, ownerId))
})

// ============================================================
// GET /team/activity-summary — Per-member activity lite (owner-only)
// v1: last_login, seat_age_days, status, role, pending invite age
// ============================================================
teamRoutes.get('/activity-summary', async (c) => {
  const auth = await requireAuth(c)
  if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const { customerId } = auth
  const { ownerId, isTeamMember } = await resolveTeamOwner(c.env.DB, customerId)
  if (isTeamMember) return c.json({ error: 'Owner only' }, 403)

  const members = await c.env.DB.prepare(`
    SELECT tm.id, tm.name, tm.email, tm.role, tm.status, tm.joined_at,
           tm.member_customer_id, c.last_login as member_last_login,
           CAST((julianday('now') - julianday(tm.joined_at)) AS INTEGER) as seat_age_days
    FROM team_members tm
    LEFT JOIN customers c ON c.id = tm.member_customer_id
    WHERE tm.owner_id = ?
    ORDER BY tm.status, tm.role DESC, tm.name
  `).bind(ownerId).all()

  const invitations = await c.env.DB.prepare(`
    SELECT id, email, name, role, created_at, expires_at,
           CAST((julianday('now') - julianday(created_at)) AS INTEGER) as invite_age_days
    FROM team_invitations
    WHERE owner_id = ? AND status = 'pending' AND expires_at > datetime('now')
    ORDER BY created_at DESC
  `).bind(ownerId).all()

  const totals = {
    active: 0, suspended: 0, removed: 0, pending: invitations.results?.length || 0
  }
  ;(members.results || []).forEach((m: any) => {
    if (m.status === 'active') totals.active++
    else if (m.status === 'suspended') totals.suspended++
    else if (m.status === 'removed') totals.removed++
  })

  return c.json({ members: members.results, invitations: invitations.results, totals })
})

// ============================================================
// GET /team/activity — Paginated audit feed (owner-only)
// Query: member_id (0 = owner only), entity_type, limit, before
// ============================================================
teamRoutes.get('/activity', async (c) => {
  const auth = await requireAuth(c)
  if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const { customerId } = auth
  const { ownerId, isTeamMember } = await resolveTeamOwner(c.env.DB, customerId)
  if (isTeamMember) return c.json({ error: 'Owner only' }, 403)

  const url = new URL(c.req.url)
  const memberIdParam = url.searchParams.get('member_id')
  const memberId = memberIdParam != null && memberIdParam !== '' ? parseInt(memberIdParam, 10) : null
  const entityType = (url.searchParams.get('entity_type') || '') as any
  const limit = parseInt(url.searchParams.get('limit') || '50', 10)
  const before = url.searchParams.get('before') || undefined

  const feed = await getActivityFeed(c.env.DB, ownerId, {
    memberId: memberId != null && !isNaN(memberId) ? memberId : null,
    entityType: entityType || undefined,
    limit,
    before
  })
  return c.json(feed)
})

// ============================================================
// POST /team/invite/:id/resend — Refresh token + resend email
// ============================================================
teamRoutes.post('/invite/:id/resend', async (c) => {
  const auth = await requireAuth(c)
  if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const { customerId, customer } = auth
  const { ownerId, isTeamMember } = await resolveTeamOwner(c.env.DB, customerId)
  if (isTeamMember) return c.json({ error: 'Owner only' }, 403)

  const inviteId = c.req.param('id')
  const invite = await c.env.DB.prepare(
    `SELECT * FROM team_invitations WHERE id = ? AND owner_id = ? AND status = 'pending'`
  ).bind(inviteId, ownerId).first<any>()
  if (!invite) return c.json({ error: 'Invitation not found' }, 404)

  const newToken = crypto.randomUUID() + '-' + crypto.randomUUID()
  const newExpires = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString()

  await c.env.DB.prepare(
    `UPDATE team_invitations SET invite_token = ?, expires_at = ? WHERE id = ?`
  ).bind(newToken, newExpires, inviteId).run()

  const ownerName = customer.name || customer.company_name || 'Your colleague'
  const inviteUrl = `${new URL(c.req.url).origin}/customer/join-team?token=${newToken}`
  await sendTeamInviteEmail(c.env, invite.email, invite.name, ownerName, customer.company_name || 'Roof Manager', inviteUrl, invite.role)

  return c.json({ success: true, message: `Invitation resent to ${invite.email}`, invite_url: inviteUrl, expires_at: newExpires })
})

// ============================================================
// HELPER: Send team invitation email
// ============================================================
async function sendTeamInviteEmail(
  env: any, toEmail: string, memberName: string,
  ownerName: string, companyName: string, inviteUrl: string, role: string
): Promise<boolean> {
  const emailHtml = `
<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f8fafc">
  <div style="background:linear-gradient(135deg,#0ea5e9,#3b82f6);padding:24px;border-radius:12px 12px 0 0;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:22px">You're Invited to Join a Team!</h1>
  </div>
  <div style="background:#fff;padding:24px;border:1px solid #e2e8f0;border-radius:0 0 12px 12px">
    <p style="font-size:16px;color:#1e293b">Hi <strong>${memberName}</strong>,</p>
    <p style="color:#475569;line-height:1.6">
      <strong>${ownerName}</strong> from <strong>${companyName}</strong> has invited you to join their team on
      <strong>Roof Manager</strong> as a <strong style="color:#0ea5e9">${role === 'admin' ? 'Team Admin' : 'Team Member'}</strong>.
    </p>
    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:16px;margin:16px 0">
      <p style="margin:0;font-size:14px;color:#0369a1;font-weight:700">As a team member, you get full access to:</p>
      <ul style="color:#0369a1;font-size:13px;margin:8px 0 0;padding-left:20px;line-height:1.8">
        <li>Order roof measurement reports</li>
        <li>Full CRM (customers, invoices, proposals, jobs)</li>
        <li>AI Roofer Secretary phone answering</li>
        <li>Virtual Roof Try-On</li>
        <li>Door-to-Door Manager</li>
      </ul>
    </div>
    <div style="text-align:center;margin:24px 0">
      <a href="${inviteUrl}" style="display:inline-block;background:#0ea5e9;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:700">Accept Invitation</a>
    </div>
    <p style="color:#94a3b8;font-size:12px;text-align:center">This invitation expires in ${INVITE_EXPIRY_DAYS} days. If you don't have a Roof Manager account, you'll be able to create one when you accept.</p>
  </div>
  <p style="text-align:center;color:#94a3b8;font-size:11px;margin-top:16px">&copy; ${new Date().getFullYear()} Roof Manager &bull; Powered by AI</p>
</body></html>`

  // Try Resend API first
  const resendKey = (env as any).RESEND_API_KEY
  if (resendKey) {
    try {
      const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Roof Manager <onboarding@resend.dev>',
          to: [toEmail],
          subject: `${ownerName} invited you to join their team on Roof Manager`,
          html: emailHtml
        })
      })
      if (resp.ok) { console.log(`[Team Invite] Email sent to ${toEmail} via Resend`); return true }
    } catch (e: any) { console.error('[Team Invite] Resend failed:', e.message) }
  }

  console.log(`[Team Invite] Email not sent (no provider) — invite URL: ${inviteUrl}`)
  return false
}

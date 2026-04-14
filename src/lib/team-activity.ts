// Team activity audit log — logs per-action events from team members
// Reads used by the owner-only Team Activity Dashboard.

import { resolveTeamOwner } from '../routes/team'

export type TeamActivityEntity =
  | 'order'
  | 'report'
  | 'invoice'
  | 'crm_customer'
  | 'proposal'
  | 'pipeline_lead'

export type TeamActivityAction =
  | 'created'
  | 'updated'
  | 'completed'
  | 'sent'
  | 'deleted'

export interface TeamActivityInput {
  ownerId: number
  actorCustomerId?: number | null
  actorTeamMemberId?: number | null
  entity_type: TeamActivityEntity
  entity_id?: number | null
  action: TeamActivityAction
  metadata?: Record<string, any>
  ip?: string | null
  user_agent?: string | null
}

// Fire-and-forget — never throws, never blocks the main flow
export async function logTeamActivity(db: D1Database, input: TeamActivityInput): Promise<void> {
  try {
    await db.prepare(`
      INSERT INTO team_activity_events
        (owner_id, actor_customer_id, actor_team_member_id, entity_type, entity_id, action, metadata, ip_address, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.ownerId,
      input.actorCustomerId ?? null,
      input.actorTeamMemberId ?? null,
      input.entity_type,
      input.entity_id ?? null,
      input.action,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.ip ?? null,
      input.user_agent ?? null
    ).run()
  } catch (e: any) {
    console.error('[team-activity] log failed:', e?.message || e)
  }
}

// Resolves a Hono context to full team identity. Returns null if not a logged-in customer.
export async function getTeamActorContext(c: any): Promise<{
  ownerId: number
  actorCustomerId: number
  teamMemberId: number | null
  isTeamMember: boolean
  ip: string | null
  userAgent: string | null
} | null> {
  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  if (!session) return null

  const { ownerId, isTeamMember, teamMemberId } = await resolveTeamOwner(c.env.DB, session.customer_id)
  return {
    ownerId,
    actorCustomerId: session.customer_id,
    teamMemberId,
    isTeamMember,
    ip: c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null,
    userAgent: c.req.header('user-agent') || null
  }
}

// Convenience — log from a Hono context. No-op if no team context.
export async function logFromContext(
  c: any,
  partial: { entity_type: TeamActivityEntity; entity_id?: number | null; action: TeamActivityAction; metadata?: Record<string, any> }
): Promise<void> {
  const ctx = await getTeamActorContext(c)
  if (!ctx) return
  await logTeamActivity(c.env.DB, {
    ownerId: ctx.ownerId,
    actorCustomerId: ctx.actorCustomerId,
    actorTeamMemberId: ctx.teamMemberId,
    ip: ctx.ip,
    user_agent: ctx.userAgent,
    ...partial
  })
}

export interface ActivityFeedQuery {
  memberId?: number | null   // filter by actor_team_member_id; 0 = "owner only"; null = all
  entityType?: TeamActivityEntity
  limit?: number
  before?: string            // ISO timestamp cursor
}

export async function getActivityFeed(db: D1Database, ownerId: number, q: ActivityFeedQuery = {}) {
  const limit = Math.min(Math.max(q.limit || 50, 1), 200)
  const wheres: string[] = ['tae.owner_id = ?']
  const binds: any[] = [ownerId]

  if (q.memberId != null) {
    if (q.memberId === 0) {
      wheres.push('tae.actor_team_member_id IS NULL')
    } else {
      wheres.push('tae.actor_team_member_id = ?')
      binds.push(q.memberId)
    }
  }
  if (q.entityType) { wheres.push('tae.entity_type = ?'); binds.push(q.entityType) }
  if (q.before) { wheres.push('tae.created_at < ?'); binds.push(q.before) }

  const rows = await db.prepare(`
    SELECT tae.*, tm.name AS actor_name, tm.email AS actor_email, tm.role AS actor_role
    FROM team_activity_events tae
    LEFT JOIN team_members tm ON tm.id = tae.actor_team_member_id
    WHERE ${wheres.join(' AND ')}
    ORDER BY tae.created_at DESC
    LIMIT ?
  `).bind(...binds, limit).all()

  return {
    events: (rows.results || []).map((r: any) => ({
      ...r,
      metadata: r.metadata ? safeJSON(r.metadata) : null
    })),
    next_cursor: rows.results && rows.results.length === limit
      ? (rows.results[rows.results.length - 1] as any).created_at
      : null
  }
}

function safeJSON(s: string) { try { return JSON.parse(s) } catch { return null } }

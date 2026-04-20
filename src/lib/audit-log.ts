// Admin action audit log. Write from every mutation endpoint in admin.ts,
// commissions.ts, platform-admin.ts, ai-admin-chat.ts (tool calls), etc.
//
// Table (see migration 0146):
//   admin_audit_log(id, admin_id, admin_email, action, target_type,
//                   target_id, before_json, after_json, ip, ts)

export interface AuditEntry {
  admin: { id: number; email?: string } | null
  action: string
  targetType?: string
  targetId?: string | number | null
  before?: unknown
  after?: unknown
  ip?: string
}

export async function logAdminAction(db: D1Database, e: AuditEntry): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO admin_audit_log (admin_id, admin_email, action, target_type, target_id, before_json, after_json, ip, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      e.admin?.id ?? null,
      e.admin?.email ?? null,
      e.action,
      e.targetType ?? null,
      e.targetId != null ? String(e.targetId) : null,
      e.before !== undefined ? JSON.stringify(e.before) : null,
      e.after !== undefined ? JSON.stringify(e.after) : null,
      e.ip ?? null
    ).run()
  } catch (err) {
    // Audit-log write failures are logged but never block the primary action.
    console.warn('[audit-log] write failed:', (err as any)?.message || err)
  }
}

export async function logAdminToolCall(
  db: D1Database,
  e: { admin: { id: number; email?: string } | null; tool: string; args: unknown; result: 'ok' | 'error' | 'denied'; ip?: string; error?: string }
): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO admin_tool_audit (admin_id, admin_email, tool, args_json, result, error, ip, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      e.admin?.id ?? null,
      e.admin?.email ?? null,
      e.tool,
      JSON.stringify(e.args ?? null),
      e.result,
      e.error ?? null,
      e.ip ?? null
    ).run()
  } catch (err) {
    console.warn('[tool-audit] write failed:', (err as any)?.message || err)
  }
}

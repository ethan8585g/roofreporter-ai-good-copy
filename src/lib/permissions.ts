// Single source of truth for team-member permissions.
//
// Two categories:
//  - Module access: coarse on/off gates for whole feature areas.
//  - Sensitive caps: fine-grained gates that always default to false for new
//    members so granting them is opt-in.
//
// Owner accounts (isTeamMember === false) bypass every check. Team members
// with role === 'admin' also bypass every check — they are the account
// owner's deputy. Everyone else is subject to the permissions JSON stored
// on team_members.permissions.

export const MODULE_PERMISSION_KEYS = [
  'orders',
  'reports',
  'crm',
  'pipeline',
  'jobs',
  'invoices',
  'proposals',
  'secretary',
  'cold_call',
  'd2d',
  'billing',
  'settings',
  'team',
] as const

export const SENSITIVE_PERMISSION_KEYS = [
  'view_financials',   // totals, my_cost, profit, revenue stats
  'export_reports',    // CSV / JSON / bulk download
  'delete_records',    // DELETE on invoices, orders, customers, jobs, etc.
] as const

export const ALL_PERMISSION_KEYS = [
  ...MODULE_PERMISSION_KEYS,
  ...SENSITIVE_PERMISSION_KEYS,
] as const

export type PermissionKey = typeof ALL_PERMISSION_KEYS[number]

export type Permissions = Record<PermissionKey, boolean>

// Module keys default to TRUE for backward compatibility with existing
// members who were invited before these gates existed. Sensitive keys
// default to FALSE — must be explicitly granted.
export function defaultPermissions(): Permissions {
  const out = {} as Permissions
  for (const k of MODULE_PERMISSION_KEYS) out[k] = true
  for (const k of SENSITIVE_PERMISSION_KEYS) out[k] = false
  return out
}

// Parse and normalize a permissions blob from any source (invite body,
// DB column, JSON string). Unknown keys are dropped; missing keys fall
// back to defaultPermissions(). Truthy-but-non-true values become false.
export function sanitizePermissions(raw: any): Permissions {
  let obj: any = raw
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw) } catch { obj = {} }
  }
  if (!obj || typeof obj !== 'object') obj = {}
  const defaults = defaultPermissions()
  const out = { ...defaults }
  for (const k of ALL_PERMISSION_KEYS) {
    if (k in obj) out[k] = obj[k] === true
  }
  return out
}

// Context resolution: what we need to answer "can this caller do X?"
export interface PermissionContext {
  isOwner: boolean           // customer is not a team member
  teamRole: string | null    // 'admin' | 'member' | null
  permissions: Permissions
}

export async function loadPermissionContext(
  db: D1Database,
  customerId: number
): Promise<PermissionContext> {
  const membership = await db.prepare(
    `SELECT role, permissions FROM team_members
     WHERE member_customer_id = ? AND status = 'active' LIMIT 1`
  ).bind(customerId).first<any>()

  if (!membership) {
    // Account owner — unrestricted.
    const full = {} as Permissions
    for (const k of ALL_PERMISSION_KEYS) full[k] = true
    return { isOwner: true, teamRole: null, permissions: full }
  }

  return {
    isOwner: false,
    teamRole: membership.role || 'member',
    permissions: sanitizePermissions(membership.permissions),
  }
}

export function can(ctx: PermissionContext, key: PermissionKey): boolean {
  if (ctx.isOwner) return true
  if (ctx.teamRole === 'admin') return true
  return ctx.permissions[key] === true
}

// Mutates an invoice-shaped object to hide dollar fields when the caller
// lacks view_financials. Used to scrub list / detail responses before
// returning them.
const FINANCIAL_FIELDS = [
  'total', 'subtotal', 'tax_amount', 'discount_amount',
  'my_cost', 'amount', 'total_collected', 'total_outstanding',
  'total_overdue', 'total_paid', 'total_draft', 'grand_total',
  'invoices_paid', 'total_spent',
  // CRM
  'lifetime_value', 'revenue', 'open_value', 'sold_value', 'total_owing',
  'total_amount', 'paid_count_value',
  // Reports / jobs
  'total_material_cost_cad', 'price', 'profit',
]

export function redactFinancials<T extends Record<string, any>>(row: T): T {
  const out = { ...row } as any
  for (const f of FINANCIAL_FIELDS) {
    if (f in out) out[f] = null
  }
  return out as T
}

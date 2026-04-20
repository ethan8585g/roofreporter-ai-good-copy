// Safe SQL builders. Never interpolate user-controlled strings into prepared
// SQL — route every dynamic value through .bind() and constrain every column
// name through an explicit allowlist.

export type PatchBinds = { sql: string; binds: any[] }

// Build "SET col1 = ?, col2 = ?" from a patch object, using an allowlist of
// permitted columns. Returns null if no columns are set.
export function buildUpdate(
  allowed: ReadonlySet<string> | readonly string[],
  patch: Record<string, unknown>,
  opts?: { touchUpdatedAt?: boolean }
): PatchBinds | null {
  const set = Array.isArray(allowed) ? new Set(allowed) : (allowed as ReadonlySet<string>)
  const fields: string[] = []
  const binds: any[] = []
  for (const key of Object.keys(patch)) {
    if (!set.has(key)) continue
    const v = (patch as any)[key]
    if (v === undefined) continue
    fields.push(`${key} = ?`)
    binds.push(v)
  }
  if (!fields.length) return null
  if (opts?.touchUpdatedAt) fields.push("updated_at = datetime('now')")
  return { sql: fields.join(', '), binds }
}

// Build a "?, ?, ?" placeholder string for an IN (...) clause.
// Callers .bind(...values) in the same order.
export function buildInList(values: readonly unknown[]): string {
  if (!values.length) throw new Error('buildInList: empty values')
  return values.map(() => '?').join(',')
}

// Identifier guard — use for the rare case where a column name must be
// dynamic (ORDER BY, for example). Only allows [A-Za-z_][A-Za-z0-9_]*.
export function safeIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`unsafe identifier: ${name}`)
  return name
}

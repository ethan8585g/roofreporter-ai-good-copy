/**
 * Customer activity helpers — keep `customer_sales_intel.last_active_at`,
 * `customer_sales_intel.last_order_at`, `customer_sales_intel.lead_id`,
 * and `orders.is_first_order` populated as side effects of normal
 * auth + order flows.
 *
 * The activity columns live in a sidecar table (customer_sales_intel)
 * because the customers table is too wide for further ALTER TABLE
 * statements on D1. Joins are cheap because both tables are keyed
 * on customer_id.
 *
 * All functions are best-effort: they swallow errors so they
 * never block the user-facing path.
 */

type Db = D1Database

/** Touch last_active_at for a customer. Cheap; safe to call on every page load. */
export async function markCustomerActive(db: Db, customerId: number | null | undefined): Promise<void> {
  if (!customerId) return
  try {
    await db.prepare(`
      INSERT INTO customer_sales_intel (customer_id, last_active_at, updated_at)
      VALUES (?, datetime('now'), datetime('now'))
      ON CONFLICT(customer_id) DO UPDATE SET
        last_active_at = datetime('now'),
        updated_at = datetime('now')
    `).bind(customerId).run()
  } catch (e: any) {
    console.warn('[customer-activity] markCustomerActive failed:', e?.message)
  }
}

/**
 * Best-effort match a freshly-created customer to an existing lead row by email.
 * Tries contact_leads (highest intent) → asset_report_leads → leads.
 * No-op if no match or if already linked.
 */
export async function linkCustomerToLead(db: Db, customerId: number, email: string): Promise<void> {
  if (!customerId || !email) return
  try {
    const existing = await db.prepare('SELECT lead_id FROM customer_sales_intel WHERE customer_id = ?')
      .bind(customerId).first<any>()
    if (existing && existing.lead_id) return // already linked

    const lower = email.toLowerCase()
    const tables: Array<{ table: string; orderBy: string }> = [
      { table: 'contact_leads', orderBy: 'created_at ASC' },
      { table: 'asset_report_leads', orderBy: 'created_at ASC' },
      { table: 'leads', orderBy: 'created_at ASC' },
    ]
    for (const t of tables) {
      const row = await db.prepare(
        `SELECT id FROM ${t.table} WHERE LOWER(email) = ? ORDER BY ${t.orderBy} LIMIT 1`
      ).bind(lower).first<any>()
      if (row && row.id) {
        await db.prepare(`
          INSERT INTO customer_sales_intel (customer_id, lead_id, lead_source_table, lead_matched_at, updated_at)
          VALUES (?, ?, ?, datetime('now'), datetime('now'))
          ON CONFLICT(customer_id) DO UPDATE SET
            lead_id = excluded.lead_id,
            lead_source_table = excluded.lead_source_table,
            lead_matched_at = excluded.lead_matched_at,
            updated_at = excluded.updated_at
        `).bind(customerId, row.id, t.table).run()
        return
      }
    }
  } catch (e: any) {
    console.warn('[customer-activity] linkCustomerToLead failed:', e?.message)
  }
}

/**
 * Mark an order as the customer's first (if it is) and bump
 * customer_sales_intel.last_order_at + last_active_at. Resolves
 * customer_id by requester_email if not given.
 *
 * Returns `{ is_first_order, days_since_first_order }` so callers
 * can fire GA4 `repeat_order` events with accurate days.
 */
export async function recordCustomerOrder(
  db: Db,
  orderId: number,
  customerIdHint?: number | null,
  requesterEmail?: string | null,
): Promise<{ is_first_order: boolean; days_since_first_order: number | null; customer_id: number | null }> {
  try {
    let customerId: number | null = customerIdHint || null
    if (!customerId && requesterEmail) {
      const c = await db.prepare('SELECT id FROM customers WHERE LOWER(email) = ? LIMIT 1')
        .bind(requesterEmail.toLowerCase()).first<any>()
      if (c && c.id) customerId = c.id as number
    }
    if (!customerId) return { is_first_order: false, days_since_first_order: null, customer_id: null }

    // Find the customer's earliest existing order (excluding this one).
    const earliest = await db.prepare(
      'SELECT MIN(id) AS min_id, MIN(created_at) AS min_created_at FROM orders WHERE customer_id = ? AND id <> ?'
    ).bind(customerId, orderId).first<any>()

    const isFirst = !earliest || !earliest.min_id
    const daysSinceFirst = (earliest && earliest.min_created_at)
      ? Math.max(0, Math.floor((Date.now() - new Date(earliest.min_created_at as string).getTime()) / (1000 * 60 * 60 * 24)))
      : null

    if (isFirst) {
      await db.prepare('UPDATE orders SET is_first_order = 1 WHERE id = ?').bind(orderId).run()
    }

    await db.prepare(`
      INSERT INTO customer_sales_intel (customer_id, last_order_at, last_active_at, updated_at)
      VALUES (?, datetime('now'), datetime('now'), datetime('now'))
      ON CONFLICT(customer_id) DO UPDATE SET
        last_order_at = datetime('now'),
        last_active_at = datetime('now'),
        updated_at = datetime('now')
    `).bind(customerId).run()

    return { is_first_order: isFirst, days_since_first_order: daysSinceFirst, customer_id: customerId }
  } catch (e: any) {
    console.warn('[customer-activity] recordCustomerOrder failed:', e?.message)
    return { is_first_order: false, days_since_first_order: null, customer_id: null }
  }
}

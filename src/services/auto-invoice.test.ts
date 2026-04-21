import { describe, it, expect, beforeEach, vi } from 'vitest'
import Database from 'better-sqlite3'

// ============================================================
// Mock Gmail sender before importing the service under test so
// vi.mock hoists correctly. Tests mutate `sendShouldFail` /
// `sendCalls` to exercise the email branches.
// ============================================================

let sendShouldFail = false
let sendFailMessage = 'SMTP unreachable'
let sendCalls: Array<{ to: string; subject: string }> = []

vi.mock('./email', () => ({
  sendGmailOAuth2: vi.fn(async (
    _clientId: string, _clientSecret: string, _refreshToken: string,
    to: string, subject: string, _html: string
  ) => {
    sendCalls.push({ to, subject })
    if (sendShouldFail) throw new Error(sendFailMessage)
    return { id: 'mock-msg-id' }
  })
}))

import { createAutoInvoiceForOrder } from './auto-invoice'

// ============================================================
// D1-compatible adapter backed by better-sqlite3 in-memory DB.
// Only the subset of the D1 API that auto-invoice.ts touches:
//   prepare(sql).bind(...).first() | .run() | .all()
// ============================================================

class D1Prepared {
  constructor(
    private db: Database.Database,
    private sql: string,
    private params: any[] = []
  ) {}
  bind(...args: any[]) {
    return new D1Prepared(this.db, this.sql, [...this.params, ...args])
  }
  async first<T = any>(): Promise<T | null> {
    const stmt = this.db.prepare(this.sql)
    const row = stmt.get(...this.params)
    return (row as T) ?? null
  }
  async run() {
    const stmt = this.db.prepare(this.sql)
    const res = stmt.run(...this.params)
    return { meta: { last_row_id: Number(res.lastInsertRowid), changes: res.changes } }
  }
  async all<T = any>() {
    const stmt = this.db.prepare(this.sql)
    const rows = stmt.all(...this.params) as T[]
    return { results: rows, success: true, meta: {} }
  }
}

function makeEnv(db: Database.Database, opts: { withGmail?: boolean } = {}) {
  const env: any = {
    DB: { prepare: (sql: string) => new D1Prepared(db, sql) },
    PUBLIC_ORIGIN: 'https://test.roofmanager.ca',
  }
  if (opts.withGmail) {
    env.GMAIL_CLIENT_ID = 'cid'
    env.GMAIL_CLIENT_SECRET = 'csec'
    env.GMAIL_REFRESH_TOKEN = 'rtok'
  }
  return env
}

function seedSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT,
      name TEXT,
      auto_invoice_enabled INTEGER DEFAULT 0,
      invoice_pricing_mode TEXT DEFAULT 'per_square',
      invoice_price_per_square REAL DEFAULT 350,
      invoice_price_per_bundle REAL DEFAULT 125
    );

    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT,
      customer_id INTEGER,
      property_address TEXT,
      invoice_customer_name TEXT,
      invoice_customer_email TEXT,
      invoice_customer_phone TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      status TEXT,
      gross_squares REAL,
      bundle_count INTEGER,
      api_response_raw TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT,
      customer_id INTEGER,
      order_id INTEGER,
      crm_customer_name TEXT,
      crm_customer_email TEXT,
      crm_customer_phone TEXT,
      subtotal REAL,
      tax_rate REAL,
      tax_amount REAL,
      discount_amount REAL,
      discount_type TEXT,
      total REAL,
      status TEXT,
      due_date TEXT,
      notes TEXT,
      terms TEXT,
      created_by TEXT,
      document_type TEXT,
      share_token TEXT,
      share_url TEXT,
      valid_until TEXT,
      sent_date TEXT,
      updated_at TEXT
    );

    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER,
      description TEXT,
      quantity REAL,
      unit_price REAL,
      amount REAL,
      sort_order INTEGER,
      unit TEXT,
      is_taxable INTEGER,
      category TEXT
    );

    CREATE TABLE invoice_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      order_id INTEGER,
      action TEXT,
      old_value TEXT,
      new_value TEXT,
      changed_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)
}

function seedFixtures(
  db: Database.Database,
  opts: {
    autoEnabled?: boolean
    recipient?: string | null
    recipientName?: string | null
    reportStatus?: string | null
    reportData?: any
    directGrossSquares?: number | null
    directBundleCount?: number | null
    pricingMode?: 'per_square' | 'per_bundle'
    pricePerSquare?: number
    pricePerBundle?: number
  } = {}
): { customerId: number; orderId: number } {
  const {
    autoEnabled = true,
    recipient = 'home@owner.com',
    recipientName = 'Homey Owner',
    reportStatus = 'completed',
    reportData = { gross_squares: 20 },
    directGrossSquares = null,   // null => infer from reportData.gross_squares
    directBundleCount = null,    // null => infer from reportData.bundle_count / total_bundles
    pricingMode = 'per_square',
    pricePerSquare = 350,
    pricePerBundle = 125,
  } = opts

  const custRes = db.prepare(
    `INSERT INTO customers (email, name, auto_invoice_enabled, invoice_pricing_mode, invoice_price_per_square, invoice_price_per_bundle)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('roofer@example.com', 'Roofer Co', autoEnabled ? 1 : 0, pricingMode, pricePerSquare, pricePerBundle)
  const customerId = Number(custRes.lastInsertRowid)

  const orderRes = db.prepare(
    `INSERT INTO orders (order_number, customer_id, property_address, invoice_customer_name, invoice_customer_email, invoice_customer_phone)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run('RM-20260420-0001', customerId, '123 Elm St, Toronto', recipientName, recipient, '555-0100')
  const orderId = Number(orderRes.lastInsertRowid)

  if (reportStatus !== null) {
    const gs = directGrossSquares !== null
      ? directGrossSquares
      : (typeof reportData?.gross_squares === 'number' ? reportData.gross_squares : null)
    const bc = directBundleCount !== null
      ? directBundleCount
      : (typeof reportData?.bundle_count === 'number'
          ? reportData.bundle_count
          : (typeof reportData?.total_bundles === 'number' ? reportData.total_bundles : null))
    db.prepare(
      `INSERT INTO reports (order_id, status, gross_squares, bundle_count, api_response_raw)
       VALUES (?, ?, ?, ?, ?)`
    ).run(orderId, reportStatus, gs, bc, JSON.stringify(reportData))
  }

  return { customerId, orderId }
}

function listAuditActions(db: Database.Database, orderId: number): string[] {
  return db.prepare(
    `SELECT action FROM invoice_audit_log WHERE order_id = ? ORDER BY id ASC`
  ).all(orderId).map((r: any) => r.action)
}

// ============================================================
// Tests
// ============================================================

describe('createAutoInvoiceForOrder', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
    seedSchema(db)
    sendShouldFail = false
    sendFailMessage = 'SMTP unreachable'
    sendCalls = []
  })

  // ── Case 1: happy path, automation enabled + homeowner ────────
  it('creates a draft proposal with audit row when enabled + homeowner present', async () => {
    const env = makeEnv(db) // no Gmail configured — proposal stays draft
    const { orderId } = seedFixtures(db)

    const res = await createAutoInvoiceForOrder(env, orderId)
    expect(res.status).toBe('created')

    const inv = db.prepare(`SELECT * FROM invoices WHERE order_id = ?`).get(orderId) as any
    expect(inv).toBeDefined()
    expect(inv.document_type).toBe('proposal')
    expect(inv.status).toBe('draft')
    expect(inv.created_by).toBe('auto-invoice')
    expect(inv.subtotal).toBeGreaterThan(0)

    const actions = listAuditActions(db, orderId)
    expect(actions).toContain('auto_invoice_entered')
    expect(actions).toContain('auto_invoice_proposal_drafted')
  })

  // ── Case 2: automation disabled ───────────────────────────────
  it('skips when customer.auto_invoice_enabled = 0', async () => {
    const env = makeEnv(db)
    const { orderId } = seedFixtures(db, { autoEnabled: false })

    const res = await createAutoInvoiceForOrder(env, orderId)
    expect(res.status).toBe('skipped')
    expect(res.reason).toBe('automation_disabled')

    const inv = db.prepare(`SELECT id FROM invoices WHERE order_id = ?`).get(orderId)
    expect(inv).toBeUndefined()

    const actions = listAuditActions(db, orderId)
    expect(actions).toContain('auto_invoice_skipped_not_enabled')
  })

  // ── Case 3: missing / empty homeowner email ───────────────────
  it('skips when invoice_customer_email is missing', async () => {
    const env = makeEnv(db)
    const { orderId } = seedFixtures(db, { recipient: null })

    const res = await createAutoInvoiceForOrder(env, orderId)
    expect(res.status).toBe('skipped')
    expect(res.reason).toBe('no_recipient')

    const inv = db.prepare(`SELECT id FROM invoices WHERE order_id = ?`).get(orderId)
    expect(inv).toBeUndefined()

    const actions = listAuditActions(db, orderId)
    expect(actions).toContain('auto_invoice_skipped_no_recipient')
  })

  // ── Case 4: report not completed ──────────────────────────────
  it('skips when report.status is not completed', async () => {
    const env = makeEnv(db)
    const { orderId } = seedFixtures(db, { reportStatus: 'generating' })

    const res = await createAutoInvoiceForOrder(env, orderId)
    expect(res.status).toBe('skipped')
    expect(res.reason).toBe('report_not_completed')

    const actions = listAuditActions(db, orderId)
    expect(actions).toContain('auto_invoice_skipped_no_report')
  })

  // ── Case 5: idempotency ───────────────────────────────────────
  it('is idempotent — a second call creates no new invoice', async () => {
    const env = makeEnv(db)
    const { orderId } = seedFixtures(db)

    const r1 = await createAutoInvoiceForOrder(env, orderId)
    expect(r1.status).toBe('created')
    const r2 = await createAutoInvoiceForOrder(env, orderId)
    expect(r2.status).toBe('skipped')
    expect(r2.reason).toBe('already_exists')

    const count = db.prepare(
      `SELECT COUNT(*) AS n FROM invoices WHERE order_id = ?`
    ).get(orderId) as { n: number }
    expect(count.n).toBe(1)

    const actions = listAuditActions(db, orderId)
    expect(actions).toContain('auto_invoice_skipped_already_exists')
  })

  // ── Case 6: measurements missing / zero ───────────────────────
  it('drafts with qty 0 and does not email when measurements are missing', async () => {
    const env = makeEnv(db, { withGmail: true })
    const { orderId } = seedFixtures(db, { reportData: { notes: 'no fields here' } })

    const res = await createAutoInvoiceForOrder(env, orderId)
    expect(res.status).toBe('created')

    const inv = db.prepare(`SELECT * FROM invoices WHERE order_id = ?`).get(orderId) as any
    expect(inv.status).toBe('draft')

    const item = db.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).get(inv.id) as any
    expect(item.quantity).toBe(0)

    const actions = listAuditActions(db, orderId)
    expect(actions).toContain('auto_invoice_quantity_zero_drafted')
    expect(sendCalls.length).toBe(0)
  })

  // ── Case 7: Gmail env vars missing ────────────────────────────
  it('leaves proposal as draft and logs proposal_email_skipped when Gmail is not configured', async () => {
    const env = makeEnv(db) // no Gmail
    const { orderId } = seedFixtures(db)

    const res = await createAutoInvoiceForOrder(env, orderId)
    expect(res.status).toBe('created')

    const inv = db.prepare(`SELECT * FROM invoices WHERE order_id = ?`).get(orderId) as any
    expect(inv.status).toBe('draft')

    const actions = listAuditActions(db, orderId)
    expect(actions).toContain('auto_invoice_proposal_email_skipped')
    expect(actions).not.toContain('auto_invoice_proposal_emailed')
    expect(sendCalls.length).toBe(0)
  })

  // ── Case 8: Gmail configured, send succeeds ───────────────────
  it('flips proposal to sent and logs proposal_emailed when Gmail send succeeds', async () => {
    const env = makeEnv(db, { withGmail: true })
    const { orderId } = seedFixtures(db)

    const res = await createAutoInvoiceForOrder(env, orderId)
    expect(res.status).toBe('created')

    const inv = db.prepare(`SELECT * FROM invoices WHERE order_id = ?`).get(orderId) as any
    expect(inv.status).toBe('sent')

    const actions = listAuditActions(db, orderId)
    expect(actions).toContain('auto_invoice_proposal_emailed')
    expect(sendCalls.length).toBe(1)
    expect(sendCalls[0].to).toBe('home@owner.com')
  })

  // ── Case 9a: regression — reads direct gross_squares when api_response_raw is empty
  // This is the exact bug that caused 12 silent prod errors before the fix:
  // the service was SELECTing a non-existent `report_data` column. With the fix,
  // direct columns are the primary source and JSON is a fallback.
  it('uses direct gross_squares column when api_response_raw is empty', async () => {
    const env = makeEnv(db)
    const { orderId } = seedFixtures(db, {
      directGrossSquares: 41.6,
      directBundleCount: 125,
      reportData: {}, // empty JSON fallback — direct columns must carry
    })

    const res = await createAutoInvoiceForOrder(env, orderId)
    expect(res.status).toBe('created')

    const inv = db.prepare(`SELECT * FROM invoices WHERE order_id = ?`).get(orderId) as any
    // 41.6 squares × $350 default = $14,560 subtotal
    expect(inv.subtotal).toBeCloseTo(41.6 * 350, 2)

    const item = db.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).get(inv.id) as any
    expect(item.quantity).toBeCloseTo(41.6, 2)
    expect(item.unit).toBe('square')
  })

  // ── Case 10: per_bundle pricing reads direct bundle_count column
  it('uses direct bundle_count column for per_bundle pricing', async () => {
    const env = makeEnv(db)
    const { orderId } = seedFixtures(db, {
      pricingMode: 'per_bundle',
      pricePerBundle: 100,
      directGrossSquares: 41.6,
      directBundleCount: 125,
      reportData: {},
    })

    const res = await createAutoInvoiceForOrder(env, orderId)
    expect(res.status).toBe('created')

    const item = db.prepare(
      `SELECT * FROM invoice_items WHERE invoice_id = (SELECT id FROM invoices WHERE order_id = ?)`
    ).get(orderId) as any
    expect(item.quantity).toBe(125)
    expect(item.unit).toBe('bundle')
    expect(item.unit_price).toBe(100)
  })

  // ── Case 9: Gmail send throws ─────────────────────────────────
  it('keeps proposal as draft and logs proposal_email_skipped when Gmail send throws', async () => {
    const env = makeEnv(db, { withGmail: true })
    const { orderId } = seedFixtures(db)
    sendShouldFail = true
    sendFailMessage = 'quota exceeded'

    const res = await createAutoInvoiceForOrder(env, orderId)
    expect(res.status).toBe('created')

    const inv = db.prepare(`SELECT * FROM invoices WHERE order_id = ?`).get(orderId) as any
    expect(inv.status).toBe('draft')

    const lastSkip = db.prepare(
      `SELECT new_value FROM invoice_audit_log
       WHERE order_id = ? AND action = 'auto_invoice_proposal_email_skipped'
       ORDER BY id DESC LIMIT 1`
    ).get(orderId) as any
    expect(lastSkip?.new_value).toContain('quota exceeded')
  })
})

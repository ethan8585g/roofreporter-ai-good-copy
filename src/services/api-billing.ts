// ============================================================
// API Credit Billing Service
// Hold → Debit → Refund pattern using D1 transactions.
// Every balance change is recorded in api_credit_ledger.
// ============================================================

export interface BillingResult {
  success: boolean
  error?: string
  balance_after?: number
}

// ── Internal ledger helper ────────────────────────────────────────────────────

async function writeLedger(
  db: D1Database,
  accountId: string,
  delta: number,
  balanceAfter: number,
  reason: string,
  refType: string | null,
  refId: string | null
): Promise<void> {
  const id = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)
  await db.prepare(`
    INSERT INTO api_credit_ledger (id, account_id, delta, balance_after, reason, ref_type, ref_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, accountId, delta, balanceAfter, reason, refType, refId, now).run()
}

// ── Hold (on job submit) ──────────────────────────────────────────────────────
// Decrements balance by 1 and records reason='hold'.
// Uses a SELECT + UPDATE with balance >= 1 check to prevent overdraft.

export async function holdCredit(
  db: D1Database,
  accountId: string,
  jobId: string
): Promise<BillingResult> {
  // Atomic check-and-decrement via UPDATE with WHERE guard
  const result = await db.prepare(`
    UPDATE api_accounts
    SET credit_balance = credit_balance - 1
    WHERE id = ? AND credit_balance >= 1
  `).bind(accountId).run()

  if (!result.meta.changes || result.meta.changes === 0) {
    return { success: false, error: 'Insufficient credits. Please top up your account.' }
  }

  const row = await db.prepare('SELECT credit_balance FROM api_accounts WHERE id = ?')
    .bind(accountId).first<{ credit_balance: number }>()
  const balanceAfter = row?.credit_balance ?? 0

  await writeLedger(db, accountId, -1, balanceAfter, 'hold', 'api_job', jobId)
  return { success: true, balance_after: balanceAfter }
}

// ── Debit (on report finalized) ───────────────────────────────────────────────
// The hold already decremented the balance; this just converts the ledger record
// from 'hold' to 'debit' (no balance change).

export async function debitCredit(
  db: D1Database,
  accountId: string,
  jobId: string
): Promise<BillingResult> {
  const row = await db.prepare('SELECT credit_balance FROM api_accounts WHERE id = ?')
    .bind(accountId).first<{ credit_balance: number }>()
  const balance = row?.credit_balance ?? 0

  await writeLedger(db, accountId, 0, balance, 'debit', 'api_job', jobId)
  return { success: true, balance_after: balance }
}

// ── Refund (on cancel or failure) ────────────────────────────────────────────
// Returns 1 credit to the account balance.

export async function refundCredit(
  db: D1Database,
  accountId: string,
  jobId: string
): Promise<BillingResult> {
  await db.prepare(`
    UPDATE api_accounts SET credit_balance = credit_balance + 1 WHERE id = ?
  `).bind(accountId).run()

  const row = await db.prepare('SELECT credit_balance FROM api_accounts WHERE id = ?')
    .bind(accountId).first<{ credit_balance: number }>()
  const balanceAfter = row?.credit_balance ?? 0

  await writeLedger(db, accountId, 1, balanceAfter, 'refund', 'api_job', jobId)
  return { success: true, balance_after: balanceAfter }
}

// ── Admin top-up (superadmin manual credit grant) ────────────────────────────

export async function addCredits(
  db: D1Database,
  accountId: string,
  amount: number,
  refType: string,
  refId: string
): Promise<BillingResult> {
  if (amount <= 0) return { success: false, error: 'Amount must be positive' }

  await db.prepare(`
    UPDATE api_accounts SET credit_balance = credit_balance + ? WHERE id = ?
  `).bind(amount, accountId).run()

  const row = await db.prepare('SELECT credit_balance FROM api_accounts WHERE id = ?')
    .bind(accountId).first<{ credit_balance: number }>()
  const balanceAfter = row?.credit_balance ?? 0

  await writeLedger(db, accountId, amount, balanceAfter, 'purchase', refType, refId)
  return { success: true, balance_after: balanceAfter }
}

// ── Ledger query ──────────────────────────────────────────────────────────────

export async function getLedgerPage(
  db: D1Database,
  accountId: string,
  from: number,
  to: number,
  limit = 50,
  offset = 0
) {
  return db.prepare(`
    SELECT * FROM api_credit_ledger
    WHERE account_id = ? AND created_at >= ? AND created_at <= ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).bind(accountId, from, to, limit, offset).all()
}

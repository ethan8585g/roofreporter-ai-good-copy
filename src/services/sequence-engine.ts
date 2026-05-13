// ============================================================
// EMAIL SEQUENCE ENGINE
//
// Drives every "email chain" the super-admin can enroll a recipient
// in. Two flavors of step:
//
//   - builtin: handler key points to an existing service function
//     (signup-nurture, cart-recovery, drip-campaigns). We delegate
//     to that function so manual enrollments produce the same body
//     the auto-fired flow would have produced.
//
//   - custom: super-admin-authored. steps_json contains subject +
//     body_html templates with {{variable}} placeholders. Engine
//     interpolates at send time and pushes through logAndSendEmail.
//
// Cron-side: processDueEnrollments() pulls active enrollments with
// next_send_at <= now and fires the current step.
// Admin-side: enrollRecipient, pause, resume, cancel, skipToNext,
// sendCurrentStepNow — invoked from the dashboard.
// ============================================================

import { logAndSendEmail, type EmailCategory } from './email-wrapper'

export interface SequenceStepBuiltin {
  step_index: number
  label: string
  delay_seconds: number
  handler: string
}

export interface SequenceStepCustom {
  step_index: number
  label: string
  delay_seconds: number
  subject_template: string
  body_html_template: string
  from_addr?: string
  track?: boolean
  category?: EmailCategory
}

export type SequenceStep = SequenceStepBuiltin | SequenceStepCustom

export interface SequenceDefinition {
  sequence_type: string
  name: string
  description: string | null
  kind: 'builtin' | 'custom'
  steps: SequenceStep[]
  default_category: EmailCategory
  default_from: string | null
  enabled: boolean
}

export interface EnrollmentRow {
  id: number
  sequence_type: string
  customer_id: number | null
  recipient_email: string
  status: 'active' | 'paused' | 'completed' | 'cancelled' | 'failed'
  current_step: number
  enrolled_at: string
  next_send_at: string | null
  last_step_sent_at: string | null
  last_email_send_id: number | null
  completed_at: string | null
  cancelled_at: string | null
  enrolled_by_admin_id: number | null
  notes: string | null
  metadata_json: string | null
}

// ── Definition load + step parse ──────────────────────────────────

export async function loadDefinition(env: any, sequenceType: string): Promise<SequenceDefinition | null> {
  const row: any = await env.DB.prepare(
    `SELECT * FROM sequence_definitions WHERE sequence_type = ? AND archived_at IS NULL`
  ).bind(sequenceType).first()
  if (!row) return null
  let steps: SequenceStep[] = []
  try { steps = JSON.parse(row.steps_json || '[]') } catch {}
  return {
    sequence_type: row.sequence_type,
    name: row.name,
    description: row.description,
    kind: row.kind,
    steps,
    default_category: (row.default_category || 'customer') as EmailCategory,
    default_from: row.default_from,
    enabled: !!row.enabled,
  }
}

export async function listDefinitions(env: any, includeArchived = false): Promise<SequenceDefinition[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM sequence_definitions
     ${includeArchived ? '' : 'WHERE archived_at IS NULL'}
     ORDER BY kind DESC, sequence_type ASC`
  ).all<any>()
  return (rows.results || []).map((row: any) => {
    let steps: SequenceStep[] = []
    try { steps = JSON.parse(row.steps_json || '[]') } catch {}
    return {
      sequence_type: row.sequence_type,
      name: row.name,
      description: row.description,
      kind: row.kind,
      steps,
      default_category: (row.default_category || 'customer') as EmailCategory,
      default_from: row.default_from,
      enabled: !!row.enabled,
    }
  })
}

// ── Enrollment management ─────────────────────────────────────────

export interface EnrollOpts {
  customerId?: number | null
  startAtStep?: number
  delaySeconds?: number   // override step-0 delay; default 0 = "next cron tick"
  enrolledByAdminId?: number | null
  notes?: string
  metadata?: Record<string, any>
}

export async function enrollRecipient(
  env: any,
  sequenceType: string,
  recipientEmail: string,
  opts: EnrollOpts = {},
): Promise<{ ok: boolean; enrollmentId?: number; error?: string }> {
  const def = await loadDefinition(env, sequenceType)
  if (!def) return { ok: false, error: `Unknown sequence: ${sequenceType}` }
  if (!def.enabled) return { ok: false, error: `Sequence is disabled: ${sequenceType}` }
  if (!def.steps.length) return { ok: false, error: `Sequence has no steps: ${sequenceType}` }
  const email = recipientEmail.trim().toLowerCase()
  if (!/.+@.+\..+/.test(email)) return { ok: false, error: 'Invalid email' }

  const startStep = Math.max(0, Math.min(opts.startAtStep ?? 0, def.steps.length - 1))
  const delay = Math.max(0, opts.delaySeconds ?? 0)
  const nextSendSql = delay > 0
    ? `datetime('now', '+${delay} seconds')`
    : `datetime('now')`

  try {
    const r = await env.DB.prepare(
      `INSERT INTO sequence_enrollments
        (sequence_type, customer_id, recipient_email, status, current_step,
         enrolled_at, next_send_at, enrolled_by_admin_id, notes, metadata_json)
       VALUES (?, ?, ?, 'active', ?, datetime('now'), ${nextSendSql}, ?, ?, ?)`
    ).bind(
      sequenceType,
      opts.customerId ?? null,
      email,
      startStep,
      opts.enrolledByAdminId ?? null,
      (opts.notes || '').slice(0, 1000) || null,
      opts.metadata ? JSON.stringify(opts.metadata).slice(0, 4000) : null,
    ).run()
    return { ok: true, enrollmentId: Number((r as any).meta?.last_row_id || 0) }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'insert failed' }
  }
}

export async function pauseEnrollment(env: any, id: number): Promise<{ ok: boolean }> {
  await env.DB.prepare(
    `UPDATE sequence_enrollments SET status='paused', next_send_at=NULL, updated_at=datetime('now') WHERE id=? AND status='active'`
  ).bind(id).run()
  return { ok: true }
}

export async function resumeEnrollment(env: any, id: number, sendInSeconds = 0): Promise<{ ok: boolean }> {
  const delay = Math.max(0, sendInSeconds)
  const sql = delay > 0 ? `datetime('now', '+${delay} seconds')` : `datetime('now')`
  await env.DB.prepare(
    `UPDATE sequence_enrollments SET status='active', next_send_at=${sql}, updated_at=datetime('now') WHERE id=? AND status='paused'`
  ).bind(id).run()
  return { ok: true }
}

export async function cancelEnrollment(env: any, id: number): Promise<{ ok: boolean }> {
  await env.DB.prepare(
    `UPDATE sequence_enrollments
     SET status='cancelled', next_send_at=NULL, cancelled_at=datetime('now'), updated_at=datetime('now')
     WHERE id=? AND status NOT IN ('completed','cancelled')`
  ).bind(id).run()
  return { ok: true }
}

export async function skipToNextStep(env: any, id: number): Promise<{ ok: boolean; error?: string }> {
  const row = await env.DB.prepare(
    `SELECT * FROM sequence_enrollments WHERE id=?`
  ).bind(id).first<any>()
  if (!row) return { ok: false, error: 'enrollment not found' }
  const def = await loadDefinition(env, row.sequence_type)
  if (!def) return { ok: false, error: 'definition missing' }
  const nextStep = row.current_step + 1
  if (nextStep >= def.steps.length) {
    await env.DB.prepare(
      `UPDATE sequence_enrollments SET status='completed', completed_at=datetime('now'), next_send_at=NULL, updated_at=datetime('now') WHERE id=?`
    ).bind(id).run()
    return { ok: true }
  }
  const delay = def.steps[nextStep].delay_seconds || 0
  const sql = delay > 0 ? `datetime('now', '+${delay} seconds')` : `datetime('now')`
  await env.DB.prepare(
    `UPDATE sequence_enrollments SET current_step=?, next_send_at=${sql}, updated_at=datetime('now') WHERE id=?`
  ).bind(nextStep, id).run()
  return { ok: true }
}

export async function sendCurrentStepNow(env: any, id: number): Promise<{ ok: boolean; error?: string; emailSendId?: number }> {
  const row = await env.DB.prepare(
    `SELECT * FROM sequence_enrollments WHERE id=? AND status IN ('active','paused')`
  ).bind(id).first<any>()
  if (!row) return { ok: false, error: 'enrollment not found or already completed/cancelled' }
  return fireStep(env, row)
}

// ── Cron driver ───────────────────────────────────────────────────

export async function processDueEnrollments(env: any, batchLimit = 25): Promise<{
  processed: number
  sent: number
  failed: number
  errors: string[]
}> {
  const due = await env.DB.prepare(
    `SELECT * FROM sequence_enrollments
     WHERE status='active' AND next_send_at IS NOT NULL AND next_send_at <= datetime('now')
     ORDER BY next_send_at ASC
     LIMIT ?`
  ).bind(batchLimit).all<any>()

  const result = { processed: 0, sent: 0, failed: 0, errors: [] as string[] }
  for (const row of (due.results || [])) {
    result.processed++
    const r = await fireStep(env, row as any)
    if (r.ok) result.sent++
    else {
      result.failed++
      if (r.error) result.errors.push(`#${(row as any).id}: ${r.error}`)
    }
  }
  return result
}

// ── Step fire (the workhorse) ─────────────────────────────────────

async function fireStep(env: any, enrollment: EnrollmentRow): Promise<{
  ok: boolean; error?: string; emailSendId?: number
}> {
  const def = await loadDefinition(env, enrollment.sequence_type)
  if (!def) {
    await markFailed(env, enrollment.id, 'definition missing')
    return { ok: false, error: 'definition missing' }
  }
  const step = def.steps[enrollment.current_step]
  if (!step) {
    // Past end → completed
    await env.DB.prepare(
      `UPDATE sequence_enrollments SET status='completed', completed_at=datetime('now'), next_send_at=NULL, updated_at=datetime('now') WHERE id=?`
    ).bind(enrollment.id).run()
    return { ok: false, error: 'no step at index' }
  }

  // Resolve subject + html — either via builtin handler or template
  let subject = ''
  let html = ''
  let kind = ''
  let category: EmailCategory = def.default_category
  let from: string | undefined = (step as SequenceStepCustom).from_addr || def.default_from || undefined
  let track = (step as SequenceStepCustom).track !== false

  if (def.kind === 'builtin') {
    const built = await renderBuiltinStep(env, (step as SequenceStepBuiltin).handler, enrollment)
    if (!built) {
      await markFailed(env, enrollment.id, `builtin handler returned nothing: ${(step as SequenceStepBuiltin).handler}`)
      return { ok: false, error: 'builtin render failed' }
    }
    subject = built.subject
    html = built.html
    kind = built.kind
    if (built.from) from = built.from
  } else {
    const custom = step as SequenceStepCustom
    const ctx = await buildContext(env, enrollment)
    subject = interpolate(custom.subject_template || '', ctx)
    html = interpolate(custom.body_html_template || '', ctx)
    kind = `${def.sequence_type}_step${step.step_index}`
    if (custom.category) category = custom.category
  }

  if (!subject || !html) {
    await markFailed(env, enrollment.id, 'empty subject or body after render')
    return { ok: false, error: 'empty render' }
  }

  const sendResult = await logAndSendEmail({
    env,
    to: enrollment.recipient_email,
    from,
    subject,
    html,
    kind,
    category,
    customerId: enrollment.customer_id,
    track,
  })

  if (!sendResult.ok) {
    await env.DB.prepare(
      `UPDATE sequence_enrollments
       SET last_email_send_id = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).bind(sendResult.emailSendId ?? null, enrollment.id).run()
    return { ok: false, error: sendResult.error, emailSendId: sendResult.emailSendId ?? undefined }
  }

  // Advance: next step OR completed
  const nextStep = enrollment.current_step + 1
  if (nextStep >= def.steps.length) {
    await env.DB.prepare(
      `UPDATE sequence_enrollments
       SET status='completed', completed_at=datetime('now'),
           last_step_sent_at=datetime('now'), last_email_send_id=?,
           next_send_at=NULL, updated_at=datetime('now')
       WHERE id=?`
    ).bind(sendResult.emailSendId ?? null, enrollment.id).run()
  } else {
    const delay = def.steps[nextStep].delay_seconds || 0
    const nextSql = delay > 0 ? `datetime('now', '+${delay} seconds')` : `datetime('now')`
    await env.DB.prepare(
      `UPDATE sequence_enrollments
       SET current_step=?, last_step_sent_at=datetime('now'),
           last_email_send_id=?, next_send_at=${nextSql}, updated_at=datetime('now')
       WHERE id=?`
    ).bind(nextStep, sendResult.emailSendId ?? null, enrollment.id).run()
  }

  return { ok: true, emailSendId: sendResult.emailSendId ?? undefined }
}

async function markFailed(env: any, id: number, error: string): Promise<void> {
  try {
    await env.DB.prepare(
      `UPDATE sequence_enrollments
       SET status='failed', failed_at=datetime('now'), next_send_at=NULL,
           notes = COALESCE(notes,'') || ?, updated_at=datetime('now')
       WHERE id=?`
    ).bind('\n[engine] ' + error.slice(0, 200), id).run()
  } catch {}
}

// ── Builtin handler dispatch ─────────────────────────────────────

interface RenderedStep {
  subject: string
  html: string
  kind: string
  from?: string
}

async function renderBuiltinStep(
  env: any,
  handler: string,
  enrollment: EnrollmentRow,
): Promise<RenderedStep | null> {
  const customer = enrollment.customer_id
    ? await env.DB.prepare(`SELECT id, email, name FROM customers WHERE id = ?`).bind(enrollment.customer_id).first<any>()
    : null
  const firstName = firstNameFrom(customer?.name, enrollment.recipient_email)
  const meta = parseMeta(enrollment.metadata_json)

  // Signup nurture
  if (handler.startsWith('signup_nurture_')) {
    const stage = handler.replace('signup_nurture_', '') as '1h' | '24h' | '3d'
    const { renderNurtureStep } = await import('./signup-nurture')
    const r = renderNurtureStep(stage, firstName)
    if (!r) return null
    return { subject: r.subject, html: r.html, kind: `nurture_${stage}` }
  }

  // Cart recovery
  if (handler.startsWith('cart_recovery_')) {
    const stage = handler.replace('cart_recovery_', '') as '2h' | '24h'
    const { renderCartRecoveryStep } = await import('./abandoned-checkout-recovery')
    const packageLine = (meta.package_name || meta.packageLine || 'your roof report') as string
    const r = renderCartRecoveryStep(stage, firstName, packageLine)
    if (!r) return null
    return { subject: r.subject, html: r.html, kind: `cart_recovery_${stage}`, from: 'support@roofmanager.ca' }
  }

  // Drip campaigns
  if (handler.startsWith('drip_')) {
    const tplKey = handler.replace('drip_', '')
    const { renderDripTemplate } = await import('./drip-campaigns')
    const r = await renderDripTemplate(env, tplKey, customer)
    if (!r) return null
    return { subject: r.subject, html: r.html, kind: `drip_${tplKey}` }
  }

  return null
}

// ── Helpers ──────────────────────────────────────────────────────

function parseMeta(j: string | null): Record<string, any> {
  if (!j) return {}
  try { return JSON.parse(j) } catch { return {} }
}

function firstNameFrom(name: string | null | undefined, email: string): string {
  if (name) {
    const trimmed = String(name).trim()
    if (trimmed && trimmed !== email && !trimmed.includes('@')) {
      const f = trimmed.split(/\s+/)[0]
      if (f && f.length <= 32) return f
    }
  }
  return 'there'
}

async function buildContext(env: any, enrollment: EnrollmentRow): Promise<Record<string, string>> {
  const ctx: Record<string, string> = {
    email: enrollment.recipient_email,
    recipient_email: enrollment.recipient_email,
  }
  if (enrollment.customer_id) {
    const c = await env.DB.prepare(`SELECT id, email, name, company_name FROM customers WHERE id = ?`).bind(enrollment.customer_id).first<any>()
    if (c) {
      ctx.customer_id = String(c.id)
      ctx.customer_name = c.name || ''
      ctx.first_name = firstNameFrom(c.name, c.email || enrollment.recipient_email)
      ctx.company_name = c.company_name || ''
    }
  }
  const meta = parseMeta(enrollment.metadata_json)
  for (const [k, v] of Object.entries(meta)) {
    if (v === null || v === undefined) continue
    ctx[k] = String(v)
  }
  if (!ctx.first_name) ctx.first_name = firstNameFrom(null, enrollment.recipient_email)
  return ctx
}

/**
 * Replace {{var}} placeholders. Unknown vars left as-is so the admin
 * can spot them in the dashboard's "view body" modal.
 */
export function interpolate(template: string, ctx: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key) => {
    if (key in ctx) return ctx[key]
    return m
  })
}

// ── Custom-sequence CRUD helpers ─────────────────────────────────

export async function createCustomSequence(env: any, args: {
  sequenceType: string  // e.g. 'custom_winter_promo'
  name: string
  description?: string
  steps: SequenceStepCustom[]
  defaultCategory?: EmailCategory
  defaultFrom?: string
  adminId?: number | null
}): Promise<{ ok: boolean; error?: string }> {
  const key = args.sequenceType.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')
  if (!key.startsWith('custom_')) {
    return { ok: false, error: `Custom sequence keys must start with 'custom_' (got '${key}')` }
  }
  if (!args.name?.trim()) return { ok: false, error: 'name required' }
  if (!args.steps?.length) return { ok: false, error: 'at least one step required' }
  // normalize step indices
  const steps = args.steps.map((s, i) => ({ ...s, step_index: i }))
  try {
    await env.DB.prepare(
      `INSERT INTO sequence_definitions
        (sequence_type, name, description, kind, steps_json,
         default_category, default_from, enabled, created_by_admin_id)
       VALUES (?, ?, ?, 'custom', ?, ?, ?, 1, ?)
       ON CONFLICT(sequence_type) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         steps_json = excluded.steps_json,
         default_category = excluded.default_category,
         default_from = excluded.default_from,
         enabled = 1,
         archived_at = NULL,
         updated_at = datetime('now')`
    ).bind(
      key, args.name.trim().slice(0, 200), (args.description || '').slice(0, 1000),
      JSON.stringify(steps),
      args.defaultCategory || 'customer',
      args.defaultFrom || null,
      args.adminId || null,
    ).run()
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'insert failed' }
  }
}

export async function archiveCustomSequence(env: any, sequenceType: string): Promise<{ ok: boolean }> {
  await env.DB.prepare(
    `UPDATE sequence_definitions
     SET archived_at = datetime('now'), enabled = 0, updated_at = datetime('now')
     WHERE sequence_type = ? AND kind = 'custom'`
  ).bind(sequenceType).run()
  // Also cancel any active enrollments in this sequence
  await env.DB.prepare(
    `UPDATE sequence_enrollments
     SET status='cancelled', cancelled_at=datetime('now'), next_send_at=NULL, updated_at=datetime('now')
     WHERE sequence_type = ? AND status='active'`
  ).bind(sequenceType).run()
  return { ok: true }
}

export async function testSendStep(env: any, args: {
  sequenceType: string
  stepIndex: number
  toEmail: string
  testCustomerId?: number | null
}): Promise<{ ok: boolean; error?: string; emailSendId?: number }> {
  const def = await loadDefinition(env, args.sequenceType)
  if (!def) return { ok: false, error: 'unknown sequence' }
  const step = def.steps[args.stepIndex]
  if (!step) return { ok: false, error: `step ${args.stepIndex} not found` }

  // Synthesize a temp enrollment-shaped object — but with status undefined
  // so it's never persisted. Then call the same render path as the engine.
  const fakeEnrollment: EnrollmentRow = {
    id: 0,
    sequence_type: args.sequenceType,
    customer_id: args.testCustomerId || null,
    recipient_email: args.toEmail,
    status: 'active',
    current_step: args.stepIndex,
    enrolled_at: new Date().toISOString(),
    next_send_at: null,
    last_step_sent_at: null,
    last_email_send_id: null,
    completed_at: null,
    cancelled_at: null,
    enrolled_by_admin_id: null,
    notes: '[test-send]',
    metadata_json: null,
  }

  let subject = '', html = '', kind = '', from: string | undefined
  let category: EmailCategory = def.default_category

  if (def.kind === 'builtin') {
    const built = await renderBuiltinStep(env, (step as SequenceStepBuiltin).handler, fakeEnrollment)
    if (!built) return { ok: false, error: 'render failed' }
    subject = '[TEST] ' + built.subject
    html = built.html
    kind = built.kind + '_test'
    from = built.from || def.default_from || undefined
  } else {
    const custom = step as SequenceStepCustom
    const ctx = await buildContext(env, fakeEnrollment)
    subject = '[TEST] ' + interpolate(custom.subject_template || '', ctx)
    html = interpolate(custom.body_html_template || '', ctx)
    kind = `${args.sequenceType}_step${args.stepIndex}_test`
    from = custom.from_addr || def.default_from || undefined
    if (custom.category) category = custom.category
  }

  if (!subject || !html) return { ok: false, error: 'empty subject or body after render' }

  const r = await logAndSendEmail({
    env, to: args.toEmail, from, subject, html, kind, category,
    customerId: fakeEnrollment.customer_id,
    skipDedup: true,
  })
  return { ok: r.ok, error: r.error, emailSendId: r.emailSendId ?? undefined }
}

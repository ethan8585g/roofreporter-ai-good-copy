// ============================================================
// CRM Automation — fire-and-forget hooks for proposal-send and
// calendar-sync, gated by per-user toggles on the customers table.
// ============================================================
//
// Calendar sync calls syncJobToCalendarInternal directly (no
// self-fetch) — internal HTTP requests on Cloudflare Workers
// silently dropped the Authorization header in some routing paths,
// causing auto-sync to fail while the manual button still worked.
// Proposal-send still uses an internal fetch (the proposal/send
// endpoint hasn't been refactored yet).
// ============================================================

import { syncJobToCalendarInternal } from '../routes/calendar'

interface AutoCtx {
  env: any
  req: { url: string; header: (name: string) => string | undefined }
}

// Auto-send a proposal email if the owner has Gmail connected,
// the proposal customer has an email, and the auto_send_proposal
// toggle is on. Skips silently otherwise — never throws.
export async function maybeAutoSendProposal(
  c: AutoCtx,
  proposalId: number | string,
  ownerId: number
): Promise<{ attempted: boolean; sent?: boolean; reason?: string }> {
  try {
    const owner = await c.env.DB.prepare(
      'SELECT gmail_refresh_token FROM customers WHERE id = ?'
    ).bind(ownerId).first<any>()
    if (!owner) return { attempted: false, reason: 'owner_not_found' }
    if (!owner.gmail_refresh_token) return { attempted: false, reason: 'gmail_not_connected' }

    const settings = await c.env.DB.prepare(
      'SELECT auto_send_proposal FROM user_automation_settings WHERE owner_id = ?'
    ).bind(ownerId).first<any>().catch(() => null)
    const autoSendOn = settings ? settings.auto_send_proposal === 1 : true
    if (!autoSendOn) return { attempted: false, reason: 'toggle_off' }

    const proposal = await c.env.DB.prepare(`
      SELECT cp.id, cp.status, cp.sent_at, cc.email as customer_email
      FROM crm_proposals cp LEFT JOIN crm_customers cc ON cc.id = cp.crm_customer_id
      WHERE cp.id = ? AND cp.owner_id = ?
    `).bind(proposalId, ownerId).first<any>()

    if (!proposal) return { attempted: false, reason: 'proposal_not_found' }
    if (!proposal.customer_email) return { attempted: false, reason: 'no_customer_email' }
    if (proposal.sent_at) return { attempted: false, reason: 'already_sent' }
    if (proposal.status && !['draft', '', null].includes(proposal.status)) {
      return { attempted: false, reason: 'not_draft_status' }
    }

    const url = new URL(c.req.url)
    const auth = c.req.header('Authorization') || ''
    const sendResp = await fetch(`${url.protocol}//${url.host}/api/crm/proposals/${proposalId}/send`, {
      method: 'POST',
      headers: { 'Authorization': auth, 'Content-Type': 'application/json' },
      body: '{}'
    })
    const result: any = await sendResp.json().catch(() => ({}))
    return { attempted: true, sent: !!result?.email_sent, reason: result?.email_error || undefined }
  } catch (e: any) {
    console.warn('[silent-catch] maybeAutoSendProposal', e?.message || e)
    return { attempted: false, reason: 'exception' }
  }
}

// Auto-sync a job to Google Calendar if the owner has Gmail
// connected (which carries the calendar scope), the job has a
// scheduled date, and the auto_sync_calendar toggle is on.
export async function maybeAutoSyncJobToCalendar(
  c: AutoCtx,
  jobId: number | string,
  ownerId: number
): Promise<{ attempted: boolean; synced?: boolean; reason?: string }> {
  try {
    const owner = await c.env.DB.prepare(
      'SELECT gmail_refresh_token FROM customers WHERE id = ?'
    ).bind(ownerId).first<any>()
    if (!owner) return { attempted: false, reason: 'owner_not_found' }
    if (!owner.gmail_refresh_token) return { attempted: false, reason: 'gmail_not_connected' }

    const settings = await c.env.DB.prepare(
      'SELECT auto_sync_calendar FROM user_automation_settings WHERE owner_id = ?'
    ).bind(ownerId).first<any>().catch(() => null)
    const autoSyncOn = settings ? settings.auto_sync_calendar === 1 : true
    if (!autoSyncOn) return { attempted: false, reason: 'toggle_off' }

    const job = await c.env.DB.prepare(
      'SELECT id, scheduled_date FROM crm_jobs WHERE id = ? AND owner_id = ?'
    ).bind(jobId, ownerId).first<any>()
    if (!job) return { attempted: false, reason: 'job_not_found' }
    if (!job.scheduled_date) return { attempted: false, reason: 'no_scheduled_date' }

    const result = await syncJobToCalendarInternal(c.env, ownerId, jobId)
    return { attempted: true, synced: !!result.success, reason: result.error || undefined }
  } catch (e: any) {
    console.warn('[silent-catch] maybeAutoSyncJobToCalendar', e?.message || e)
    return { attempted: false, reason: 'exception' }
  }
}

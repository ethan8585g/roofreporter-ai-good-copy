import { describe, it, expect } from 'vitest'

/**
 * Admin Trace Preview Suite (D245)
 *
 * Validates the pure-logic decisions introduced by the admin-review flow.
 * Mirrors the project's existing test convention: re-implement the small
 * decision functions in the test file (no D1 mocks, no HTTP harness),
 * then assert their behavior on representative inputs.
 *
 * The HTTP route handlers themselves are thin wrappers around these
 * decisions + DB writes; integration of those layers is exercised by
 * `npm run build`'s link-audit + manual QA on the preview page.
 */

// ──────────────────────────────────────────────────────────────────────────
// 1. admin_review_status state machine
//    NULL                → 'awaiting_review' (on /generate-draft)
//    'awaiting_review'   → 'approved'        (on /approve-and-deliver)
//    'awaiting_review'   → NULL              (on /preview-cancel-retrace)
//    'approved'          → terminal (cannot transition without retrace)
// ──────────────────────────────────────────────────────────────────────────

type ReviewStatus = null | 'awaiting_review' | 'approved'

function nextStatus(
  current: ReviewStatus,
  action: 'generate_draft' | 'approve_and_deliver' | 'cancel_retrace'
): { ok: boolean; status?: ReviewStatus; error?: string } {
  if (action === 'generate_draft') {
    // Always allowed — overwrites any prior state.
    return { ok: true, status: 'awaiting_review' }
  }
  if (action === 'approve_and_deliver') {
    if (current !== 'awaiting_review') {
      return { ok: false, error: 'Report is not awaiting admin review' }
    }
    return { ok: true, status: 'approved' }
  }
  if (action === 'cancel_retrace') {
    // Wipes everything regardless of state.
    return { ok: true, status: null }
  }
  return { ok: false, error: 'unknown action' }
}

describe('admin_review_status state machine', () => {
  it('generate-draft transitions any state to awaiting_review', () => {
    expect(nextStatus(null, 'generate_draft').status).toBe('awaiting_review')
    expect(nextStatus('awaiting_review', 'generate_draft').status).toBe('awaiting_review')
    expect(nextStatus('approved', 'generate_draft').status).toBe('awaiting_review')
  })

  it('approve-and-deliver only succeeds from awaiting_review', () => {
    expect(nextStatus('awaiting_review', 'approve_and_deliver').status).toBe('approved')
    expect(nextStatus(null, 'approve_and_deliver').ok).toBe(false)
    expect(nextStatus('approved', 'approve_and_deliver').ok).toBe(false)
  })

  it('approve-and-deliver from non-awaiting state returns the conflict reason', () => {
    const r = nextStatus('approved', 'approve_and_deliver')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('not awaiting admin review')
  })

  it('cancel-retrace clears state from any value', () => {
    expect(nextStatus('awaiting_review', 'cancel_retrace').status).toBe(null)
    expect(nextStatus('approved', 'cancel_retrace').status).toBe(null)
    expect(nextStatus(null, 'cancel_retrace').status).toBe(null)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// 2. Customer visibility gate (re-implementation of the JOIN predicate)
//    Mirrors customer-auth.ts:1796 LEFT JOIN clause:
//      r.admin_review_status IS NULL OR r.admin_review_status = 'approved'
//    A row that fails this predicate is dropped from the JOIN, so the
//    customer's dashboard sees the order as "in progress" (no report fields).
// ──────────────────────────────────────────────────────────────────────────

function customerCanSeeReport(report: { admin_review_status: ReviewStatus } | null): boolean {
  if (!report) return false
  return report.admin_review_status === null || report.admin_review_status === 'approved'
}

describe('customer-visibility JOIN predicate', () => {
  it('hides reports that are awaiting admin review', () => {
    expect(customerCanSeeReport({ admin_review_status: 'awaiting_review' })).toBe(false)
  })

  it('exposes legacy reports with NULL admin_review_status', () => {
    // Pre-migration reports have admin_review_status = NULL. They must
    // continue to surface unchanged so historical data isn't hidden.
    expect(customerCanSeeReport({ admin_review_status: null })).toBe(true)
  })

  it('exposes approved reports', () => {
    expect(customerCanSeeReport({ admin_review_status: 'approved' })).toBe(true)
  })

  it('handles missing report row (LEFT JOIN miss) gracefully', () => {
    expect(customerCanSeeReport(null)).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// 3. Public report HTML gate
//    Mirrors reports.ts GET /:orderId/html — must 404 when the report is
//    mid-review so a customer guessing the URL can't peek at the draft.
//    Admin preview iframe uses /api/admin/superadmin/orders/:id/preview-html
//    which bypasses this gate.
// ──────────────────────────────────────────────────────────────────────────

function publicHtmlAllowed(adminReviewStatus: ReviewStatus): boolean {
  return adminReviewStatus !== 'awaiting_review'
}

describe('public /api/reports/:id/html admin-review gate', () => {
  it('blocks awaiting_review', () => {
    expect(publicHtmlAllowed('awaiting_review')).toBe(false)
  })

  it('allows approved reports', () => {
    expect(publicHtmlAllowed('approved')).toBe(true)
  })

  it('allows legacy NULL reports', () => {
    expect(publicHtmlAllowed(null)).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// 4. preview-update-imagery — extras reorder + remove + cap-at-4
//    Mirrors the logic at admin.ts /preview-update-imagery: compute the
//    reordered list, then drop removed indices, then cap at 4. The
//    write-through cache invalidation (NULL professional_report_html) is a
//    DB side effect — not exercised here.
// ──────────────────────────────────────────────────────────────────────────

interface Capture { id: string }

function applyExtrasMutation(
  current: Capture[],
  body: { extra_captures_order?: number[]; extra_captures_remove?: number[] }
): Capture[] {
  const removeSet = new Set<number>(
    Array.isArray(body.extra_captures_remove)
      ? body.extra_captures_remove.filter(n => Number.isInteger(n) && n >= 0 && n < current.length)
      : []
  )
  let next: Capture[] = current
  if (Array.isArray(body.extra_captures_order)) {
    const order = body.extra_captures_order.filter(n => Number.isInteger(n) && n >= 0 && n < current.length)
    const seen = new Set<number>()
    const reordered: Capture[] = []
    for (const idx of order) { if (!seen.has(idx)) { seen.add(idx); reordered.push(current[idx]) } }
    for (let i = 0; i < current.length; i++) if (!seen.has(i)) reordered.push(current[i])
    next = reordered
  }
  next = next.filter((_, i) => !removeSet.has(i))
  if (next.length > 4) next = next.slice(0, 4)
  return next
}

describe('preview-update-imagery extras mutation', () => {
  const A = { id: 'A' }, B = { id: 'B' }, C = { id: 'C' }, D = { id: 'D' }, E = { id: 'E' }

  it('reorders captures using extra_captures_order', () => {
    const out = applyExtrasMutation([A, B, C], { extra_captures_order: [2, 0, 1] })
    expect(out.map(x => x.id)).toEqual(['C', 'A', 'B'])
  })

  it('removes captures using extra_captures_remove', () => {
    const out = applyExtrasMutation([A, B, C], { extra_captures_remove: [1] })
    expect(out.map(x => x.id)).toEqual(['A', 'C'])
  })

  it('reorders THEN removes (indices in remove are post-current, pre-reorder)', () => {
    // remove targets the original index 0 ('A'); reorder happens first
    // logically but the remove-index is matched against the new positions.
    // The implementation runs remove on the *post-reorder* list.
    const out = applyExtrasMutation([A, B, C], { extra_captures_order: [2, 0, 1], extra_captures_remove: [0] })
    // After reorder: [C, A, B]; remove index 0 → [A, B]
    expect(out.map(x => x.id)).toEqual(['A', 'B'])
  })

  it('preserves original order for indices missing from extra_captures_order', () => {
    const out = applyExtrasMutation([A, B, C, D], { extra_captures_order: [3] })
    // 3 first, then unmentioned [0,1,2] in original order
    expect(out.map(x => x.id)).toEqual(['D', 'A', 'B', 'C'])
  })

  it('caps the final list at 4 captures', () => {
    const out = applyExtrasMutation([A, B, C, D, E], {})
    expect(out.length).toBe(4)
    expect(out.map(x => x.id)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('ignores invalid indices in extra_captures_order', () => {
    const out = applyExtrasMutation([A, B], { extra_captures_order: [99, -1, 0] })
    expect(out.map(x => x.id)).toEqual(['A', 'B'])
  })

  it('ignores invalid indices in extra_captures_remove', () => {
    const out = applyExtrasMutation([A, B], { extra_captures_remove: [99, -1] })
    expect(out.map(x => x.id)).toEqual(['A', 'B'])
  })

  it('de-dupes repeated indices in extra_captures_order', () => {
    const out = applyExtrasMutation([A, B, C], { extra_captures_order: [0, 0, 1] })
    // Second 0 ignored; result: [A, B, C]
    expect(out.map(x => x.id)).toEqual(['A', 'B', 'C'])
  })

  it('returns the original list when neither order nor remove is provided', () => {
    const out = applyExtrasMutation([A, B], {})
    expect(out.map(x => x.id)).toEqual(['A', 'B'])
  })
})

// ──────────────────────────────────────────────────────────────────────────
// 5. cover_image_source allow-list
//    The /preview-update-imagery handler validates body.cover_image_source
//    against a fixed allow-list before persisting. Anything else is silently
//    ignored (no error response, just no-op for that field).
// ──────────────────────────────────────────────────────────────────────────

function isValidCoverSource(s: unknown): boolean {
  const allowed = ['oblique_3d', 'satellite', 'aerial_NE', 'aerial_NW', 'aerial_SE', 'aerial_SW']
  return typeof s === 'string' && allowed.indexOf(s) >= 0
}

describe('cover_image_source allow-list', () => {
  it('accepts each documented value', () => {
    for (const v of ['oblique_3d', 'satellite', 'aerial_NE', 'aerial_NW', 'aerial_SE', 'aerial_SW']) {
      expect(isValidCoverSource(v)).toBe(true)
    }
  })

  it('rejects case mismatches', () => {
    expect(isValidCoverSource('OBLIQUE_3D')).toBe(false)
    expect(isValidCoverSource('aerial_ne')).toBe(false)
  })

  it('rejects unrelated strings + non-strings', () => {
    expect(isValidCoverSource('hero')).toBe(false)
    expect(isValidCoverSource('')).toBe(false)
    expect(isValidCoverSource(null)).toBe(false)
    expect(isValidCoverSource(undefined)).toBe(false)
    expect(isValidCoverSource(42)).toBe(false)
  })
})

// ──────────────────────────────────────────────────────────────────────────
// 6. Approve-and-deliver pre-conditions
//    Mirrors the early-return checks in the route handler: the report must
//    be in awaiting_review AND the rendered HTML must be non-trivial.
// ──────────────────────────────────────────────────────────────────────────

function approveGate(report: {
  admin_review_status: ReviewStatus
  professional_report_html: string | null
} | null): { ok: boolean; status?: number; error?: string } {
  if (!report) return { ok: false, status: 404, error: 'Report not found' }
  if (report.admin_review_status !== 'awaiting_review') {
    return { ok: false, status: 409, error: 'Report is not awaiting admin review' }
  }
  if (!report.professional_report_html || report.professional_report_html.length < 1000) {
    return { ok: false, status: 409, error: 'Report HTML is empty or unrenderable — re-trace before approving' }
  }
  return { ok: true }
}

describe('approve-and-deliver pre-conditions', () => {
  const goodHtml = 'x'.repeat(2000)

  it('passes when in awaiting_review with rendered HTML', () => {
    const r = approveGate({ admin_review_status: 'awaiting_review', professional_report_html: goodHtml })
    expect(r.ok).toBe(true)
  })

  it('rejects 404 when report is missing', () => {
    const r = approveGate(null)
    expect(r.ok).toBe(false)
    expect(r.status).toBe(404)
  })

  it('rejects 409 when not awaiting review', () => {
    const r = approveGate({ admin_review_status: null, professional_report_html: goodHtml })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(409)
    expect(r.error).toContain('not awaiting')
  })

  it('rejects 409 when HTML is empty or trivially short', () => {
    const r = approveGate({ admin_review_status: 'awaiting_review', professional_report_html: '<empty/>' })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(409)
    expect(r.error).toContain('empty or unrenderable')
  })

  it('rejects 409 when HTML is null', () => {
    const r = approveGate({ admin_review_status: 'awaiting_review', professional_report_html: null })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(409)
  })
})

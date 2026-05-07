// ============================================================
// Roof Manager — Report View Tracker
// Logs every report open to `report_view_events` (migration 0216).
// Fire-and-forget: never awaited by callers, never throws upstream.
// ============================================================

import type { Context } from 'hono'
import type { Bindings } from '../types'
import { validateAdminSession } from '../routes/auth'
import { getCustomerSessionToken } from '../lib/session-tokens'
import { logReportView, getReportIdByOrder, type ReportViewType } from '../repositories/reports'

const BOT_UA_RE = /bot|crawler|spider|preview|slack|discord|whatsapp|facebookexternalhit|twitterbot|linkedinbot|outlook|gmail|skypeuripreview|telegrambot|applebot|headlesschrome/i

function detectIsBot(ua: string | null): boolean {
  if (!ua) return false
  return BOT_UA_RE.test(ua)
}

function extractIp(c: Context<{ Bindings: Bindings }>): string | null {
  return (
    c.req.header('CF-Connecting-IP') ||
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('X-Real-IP') ||
    null
  )
}

async function resolveCustomerId(c: Context<{ Bindings: Bindings }>): Promise<number | null> {
  const token = getCustomerSessionToken(c)
  if (!token) return null
  const row = await c.env.DB.prepare(
    `SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')`,
  ).bind(token).first<{ customer_id: number }>()
  return row?.customer_id ?? null
}

/**
 * Log a single report view. Call this fire-and-forget — do NOT await it.
 *
 * For 'share' opens (public token-gated), passes view_type='share' as-is.
 * For 'portal'/'pdf' opens, the tracker probes for an admin session first;
 * if matched, it overrides view_type to 'admin' (so super-admin auditing is
 * logged but excluded from the headline count). Otherwise it resolves the
 * customer_id from the session cookie.
 */
export function trackReportView(
  c: Context<{ Bindings: Bindings }>,
  args: {
    orderId: number | string
    viewType: ReportViewType
    shareToken?: string | null
  },
): void {
  const work = (async () => {
    try {
      const db = c.env.DB
      const orderIdNum = Number(args.orderId)
      if (!Number.isFinite(orderIdNum) || orderIdNum <= 0) return

      const ua = c.req.header('User-Agent') ?? null
      const ip = extractIp(c)
      const isBot = detectIsBot(ua)

      let viewType: ReportViewType = args.viewType
      let customerId: number | null = null

      if (args.viewType !== 'share') {
        const admin = await validateAdminSession(db, c.req.header('Authorization'), c.req.header('Cookie'))
        if (admin) {
          viewType = 'admin'
        } else {
          customerId = await resolveCustomerId(c)
        }
      }

      const reportId = await getReportIdByOrder(db, orderIdNum)

      await logReportView(db, {
        order_id: orderIdNum,
        report_id: reportId,
        view_type: viewType,
        customer_id: customerId,
        ip_address: ip,
        user_agent: ua,
        share_token: args.shareToken ?? null,
        is_bot: isBot,
      })
    } catch {
      // Tracking must never break a report view.
    }
  })()

  // Keep the worker alive past response completion so the insert lands.
  try { c.executionCtx?.waitUntil?.(work) } catch { /* no executionCtx in tests */ }
}

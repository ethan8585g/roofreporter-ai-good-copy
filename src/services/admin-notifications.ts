// ============================================================
// SUPER ADMIN NOTIFICATIONS — Persistent feed for new orders
// ============================================================
// The DB row is the source of truth. Email is a convenience layer that
// can fail (Resend down, Gmail token expired, no provider configured) —
// when it does, the row still exists and surfaces in the /super-admin
// Notifications tab. Synchronous insert intentionally: a Worker crash
// before the row lands would leave admin blind to an order, which is
// exactly the bug this module fixes.

import { notifyNewReportRequest, notifyTraceCompletedToCustomer } from './email'

export type NotificationKind =
  | 'new_order'
  | 'needs_trace'
  | 'trace_completed'
  | 'payment_unmatched'

export type NotificationSeverity = 'info' | 'warn' | 'urgent'

export interface OrderContext {
  order_id?: number | null
  order_number: string
  customer_id?: number | null
  customer_email?: string | null
  customer_name?: string | null
  property_address: string
  service_tier?: string | null
  price?: number | null
  payment_status?: string | null
  is_trial?: boolean
  trace_source?: string | null
  needs_admin_trace?: boolean
  payload?: Record<string, unknown>
}

export interface RecordAndNotifyArgs {
  kind: NotificationKind
  order: OrderContext
  severity?: NotificationSeverity
}

function defaultSeverity(kind: NotificationKind): NotificationSeverity {
  if (kind === 'payment_unmatched') return 'urgent'
  if (kind === 'needs_trace') return 'warn'
  return 'info'
}

export async function recordAndNotify(
  env: any,
  args: RecordAndNotifyArgs
): Promise<{ id: number | null }> {
  const { kind, order } = args
  const severity = args.severity || defaultSeverity(kind)

  let notificationId: number | null = null
  try {
    const insertRes = await env.DB.prepare(`
      INSERT INTO super_admin_notifications (
        kind, order_id, order_number, customer_id, customer_email,
        property_address, service_tier, price, payment_status,
        is_trial, trace_source, needs_admin_trace,
        email_status, severity, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).bind(
      kind,
      order.order_id ?? null,
      order.order_number || null,
      order.customer_id ?? null,
      order.customer_email || null,
      order.property_address || null,
      order.service_tier || null,
      order.price ?? null,
      order.payment_status || null,
      order.is_trial ? 1 : 0,
      order.trace_source || null,
      order.needs_admin_trace ? 1 : 0,
      severity,
      order.payload ? JSON.stringify(order.payload) : null
    ).run()
    notificationId = (insertRes?.meta?.last_row_id as number) || null
  } catch (e: any) {
    console.error('[admin-notifications] DB insert failed:', e?.message || e)
    // Continue — try to send email anyway so super admin isn't completely
    // blind. The next order will probably write a row and surface this.
  }

  let emailStatus: 'sent' | 'failed' | 'skipped' = 'skipped'
  let emailDetail = ''

  try {
    if (kind === 'new_order' || kind === 'needs_trace') {
      await notifyNewReportRequest(env, {
        order_number: order.order_number,
        property_address: order.property_address,
        requester_name: order.customer_name || '',
        requester_email: order.customer_email || '',
        service_tier: order.service_tier || 'standard',
        price: order.price ?? 0,
        is_trial: !!order.is_trial,
      })
      emailStatus = 'sent'
    } else if (kind === 'trace_completed') {
      // Customer-facing email + admin-side record. Admin already saw
      // this order at creation time, so no notifyNewReportRequest here.
      if (order.customer_email) {
        await notifyTraceCompletedToCustomer(env, {
          to: order.customer_email,
          order_number: order.order_number,
          property_address: order.property_address,
          customer_name: order.customer_name || '',
        })
        emailStatus = 'sent'
      } else {
        emailDetail = 'no customer email on file'
      }
    } else if (kind === 'payment_unmatched') {
      // Reuse the new-report email so admin sees an URGENT alert in inbox.
      // Subject prefixing happens inside the function via order_number.
      await notifyNewReportRequest(env, {
        order_number: `URGENT-UNMATCHED-${order.order_number}`,
        property_address: order.property_address || '(unknown)',
        requester_name: order.customer_name || '',
        requester_email: order.customer_email || '',
        service_tier: 'unmatched',
        price: order.price ?? 0,
        is_trial: false,
      })
      emailStatus = 'sent'
    }
  } catch (e: any) {
    emailStatus = 'failed'
    emailDetail = String(e?.message || e).slice(0, 480)
    console.warn(`[admin-notifications] Email failed for ${kind}/${order.order_number}:`, emailDetail)
  }

  if (notificationId) {
    try {
      await env.DB.prepare(
        "UPDATE super_admin_notifications SET email_status = ?, email_detail = ? WHERE id = ?"
      ).bind(emailStatus, emailDetail || null, notificationId).run()
    } catch (e: any) {
      console.warn('[admin-notifications] status update failed:', e?.message || e)
    }
  }

  return { id: notificationId }
}

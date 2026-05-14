// ============================================================
// User-facing Automations routes
// Lives under /api/automations — callable by the roofer-user on
// their own orders. Mirrors the same auth pattern as invoices.ts
// (customer session OR admin session), and reuses getScope for
// per-owner data isolation.
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { validateAdminSession } from './auth'
import { createAutoInvoiceForOrder } from '../services/auto-invoice'
import { resolveTeamOwner } from './team'

export const automationsRoutes = new Hono<{ Bindings: Bindings }>()

// Auth middleware — accepts Admin OR Customer tokens (same pattern as invoices.ts)
automationsRoutes.use('/*', async (c, next) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (admin) { c.set('admin' as any, admin); return next() }

  const authHeader = c.req.header('Authorization')
  const token = authHeader?.replace('Bearer ', '')
  if (token) {
    const session = await c.env.DB.prepare(`
      SELECT cs.customer_id, c.email, c.name FROM customer_sessions cs
      JOIN customers c ON c.id = cs.customer_id
      WHERE cs.session_token = ? AND cs.expires_at > datetime('now')
    `).bind(token).first<any>()
    if (session) {
      const teamInfo = await resolveTeamOwner(c.env.DB, session.customer_id)
      c.set('admin' as any, {
        id: session.customer_id,
        email: session.email,
        name: session.name,
        role: 'customer',
        ownerCustomerId: teamInfo.ownerId,
      })
      return next()
    }
  }
  return c.json({ error: 'Authentication required' }, 401)
})

function scope(c: any): { isAdmin: boolean; ownerId: number | null } {
  const u = c.get('admin' as any) as any
  if (!u) return { isAdmin: false, ownerId: null }
  if (u.role === 'customer') return { isAdmin: false, ownerId: (u.ownerCustomerId ?? u.id) as number }
  return { isAdmin: true, ownerId: null }
}

// ── POST /api/automations/proposal/trigger/:orderId ───────────────────
// Manually fires the same inline auto-proposal hook that runs when a
// report completes. Idempotent; safe to retry. Scoped to the caller's
// own orders (admins can trigger any order).
automationsRoutes.post('/proposal/trigger/:orderId', async (c) => {
  const s = scope(c)
  const orderId = parseInt(c.req.param('orderId'), 10)
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return c.json({ error: 'order_id must be a positive integer' }, 400)
  }

  if (!s.isAdmin) {
    const own = await c.env.DB.prepare(
      `SELECT customer_id FROM orders WHERE id = ?`
    ).bind(orderId).first<{ customer_id: number }>()
    if (!own || own.customer_id !== s.ownerId) {
      return c.json({ error: 'Order not found' }, 404)
    }
  }

  const result = await createAutoInvoiceForOrder(c.env, orderId)
  return c.json({ order_id: orderId, result })
})

// ── GET /api/automations/proposal/audit/:orderId ──────────────────────
// Returns the auto-proposal audit trail for one of the caller's orders.
automationsRoutes.get('/proposal/audit/:orderId', async (c) => {
  const s = scope(c)
  const orderId = parseInt(c.req.param('orderId'), 10)
  if (!Number.isFinite(orderId) || orderId <= 0) {
    return c.json({ error: 'order_id must be a positive integer' }, 400)
  }

  if (!s.isAdmin) {
    const own = await c.env.DB.prepare(
      `SELECT customer_id FROM orders WHERE id = ?`
    ).bind(orderId).first<{ customer_id: number }>()
    if (!own || own.customer_id !== s.ownerId) {
      return c.json({ error: 'Order not found' }, 404)
    }
  }

  const rows = await c.env.DB.prepare(
    `SELECT id, order_id, invoice_id, action, new_value as reason, created_at
     FROM invoice_audit_log
     WHERE order_id = ? AND changed_by = 'auto-invoice'
     ORDER BY id ASC`
  ).bind(orderId).all()

  return c.json({ order_id: orderId, entries: rows.results || [] })
})

// ── GET /api/automations/proposal/health ──────────────────────────────
// Roofer-scoped: their own Gmail-connection state, pending drafts, and
// recent audit entries from their own orders. Admins see platform-wide.
automationsRoutes.get('/proposal/health', async (c) => {
  const s = scope(c)
  const env = c.env
  const platformGmail = !!(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN)

  if (s.isAdmin) {
    const connected = await c.env.DB.prepare(
      `SELECT COUNT(*) as n FROM customers
       WHERE gmail_refresh_token IS NOT NULL AND gmail_refresh_token != ''`
    ).first<{ n: number }>()
    const customersWithGmail = connected?.n ?? 0
    const [lastSent, pendingDrafts, recent] = await Promise.all([
      c.env.DB.prepare(
        `SELECT created_at FROM invoice_audit_log
         WHERE action = 'auto_invoice_proposal_emailed'
         ORDER BY id DESC LIMIT 1`
      ).first<{ created_at: string }>(),
      c.env.DB.prepare(
        `SELECT COUNT(*) as n FROM invoices
         WHERE created_by = 'auto-invoice' AND status = 'draft'`
      ).first<{ n: number }>(),
      c.env.DB.prepare(
        `SELECT id, order_id, invoice_id, action, new_value as reason, created_at
         FROM invoice_audit_log
         WHERE changed_by = 'auto-invoice'
         ORDER BY id DESC LIMIT 10`
      ).all(),
    ])
    return c.json({
      scope: 'admin',
      gmail_platform_configured: platformGmail,
      customers_with_gmail_connected: customersWithGmail,
      last_successful_send_at: lastSent?.created_at ?? null,
      pending_drafts_count: pendingDrafts?.n ?? 0,
      last_10_audit_log_entries: recent.results || [],
    })
  }

  // Customer scope
  const ownerId = s.ownerId
  const [mySettings, myGmail, lastSent, pendingDrafts, recent] = await Promise.all([
    c.env.DB.prepare(
      `SELECT auto_invoice_enabled, invoice_pricing_mode,
              invoice_price_per_square, invoice_price_per_bundle
       FROM customers WHERE id = ?`
    ).bind(ownerId).first<any>(),
    c.env.DB.prepare(
      `SELECT gmail_connected_email,
              (gmail_refresh_token IS NOT NULL AND gmail_refresh_token != '') as connected
       FROM customers WHERE id = ?`
    ).bind(ownerId).first<any>(),
    c.env.DB.prepare(
      `SELECT al.created_at FROM invoice_audit_log al
       JOIN orders o ON o.id = al.order_id
       WHERE al.action = 'auto_invoice_proposal_emailed'
         AND o.customer_id = ?
       ORDER BY al.id DESC LIMIT 1`
    ).bind(ownerId).first<{ created_at: string }>(),
    c.env.DB.prepare(
      `SELECT COUNT(*) as n FROM invoices
       WHERE created_by = 'auto-invoice' AND status = 'draft'
         AND customer_id = ?`
    ).bind(ownerId).first<{ n: number }>(),
    c.env.DB.prepare(
      `SELECT al.id, al.order_id, al.invoice_id, al.action,
              al.new_value as reason, al.created_at
       FROM invoice_audit_log al
       JOIN orders o ON o.id = al.order_id
       WHERE al.changed_by = 'auto-invoice'
         AND o.customer_id = ?
       ORDER BY al.id DESC LIMIT 10`
    ).bind(ownerId).all(),
  ])

  return c.json({
    scope: 'customer',
    auto_proposal_enabled: !!mySettings?.auto_invoice_enabled,
    pricing_mode: mySettings?.invoice_pricing_mode || 'per_square',
    price_per_square: mySettings?.invoice_price_per_square ?? null,
    price_per_bundle: mySettings?.invoice_price_per_bundle ?? null,
    gmail_connected: !!myGmail?.connected,
    gmail_connected_email: myGmail?.gmail_connected_email ?? null,
    gmail_platform_fallback_available: platformGmail,
    last_successful_send_at: lastSent?.created_at ?? null,
    pending_drafts_count: pendingDrafts?.n ?? 0,
    last_10_audit_log_entries: recent.results || [],
  })
})

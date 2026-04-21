// ============================================================
// Solar Interactive Web Proposals — CRUD + lifecycle.
//
// Two audiences:
//   1. Rep (customer session)  → creates, edits, sends, voids proposals.
//   2. Homeowner (token-only) → public GET /p/solar/:token + POST sign.
//      Public routes live in src/index.tsx next to the other share_token
//      routes; this module only exposes the authenticated REST surface.
//
// Snapshot discipline: once a proposal is 'sent', the row is treated as
// immutable — pricing_json / financing_scenarios_json / panel_layout_json
// are frozen so later edits to templates or layouts cannot mutate what the
// homeowner already saw. Draft rows are freely mutable.
// ============================================================
import { Hono } from 'hono'
import { getCustomerSessionToken } from '../lib/session-tokens'
import type { Bindings } from '../types'
import { resolveTeamOwner } from './team'

export const solarProposalsRoutes = new Hono<{ Bindings: Bindings }>()

// 32-char hex, cryptographically random. Same shape as elsewhere in the app.
function generateShareToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function requireCustomer(c: any) {
  const token = getCustomerSessionToken(c)
  if (!token) return null
  const s = await c.env.DB.prepare(
    `SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')`
  ).bind(token).first<any>()
  if (!s) return null
  const { ownerId } = await resolveTeamOwner(c.env.DB, s.customer_id)
  return { ownerId }
}

function toJsonOrNull(v: any): string | null {
  if (v == null) return null
  if (typeof v === 'string') return v
  try { return JSON.stringify(v) } catch { return null }
}

// ── List ──────────────────────────────────────────────────
solarProposalsRoutes.get('/', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const dealId = c.req.query('deal_id')
  const status = c.req.query('status')
  let q = 'SELECT * FROM solar_proposals WHERE customer_id = ?'
  const p: any[] = [auth.ownerId]
  if (dealId) { q += ' AND deal_id = ?'; p.push(dealId) }
  if (status) { q += ' AND status = ?'; p.push(status) }
  q += ' ORDER BY created_at DESC LIMIT 500'
  const rows = await c.env.DB.prepare(q).bind(...p).all()
  return c.json({ proposals: rows.results || [] })
})

// ── Owner view (single) ───────────────────────────────────
solarProposalsRoutes.get('/:id', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const id = Number(c.req.param('id'))
  const row = await c.env.DB.prepare(
    `SELECT * FROM solar_proposals WHERE customer_id = ? AND id = ?`
  ).bind(auth.ownerId, id).first<any>()
  if (!row) return c.json({ error: 'not found' }, 404)
  const events = await c.env.DB.prepare(
    `SELECT id, event_type, event_data_json, created_at FROM solar_proposal_events
     WHERE proposal_id = ? ORDER BY created_at DESC LIMIT 200`
  ).bind(id).all()
  return c.json({ proposal: row, events: events.results || [] })
})

// ── Create (from a deal + optional report) ────────────────
// Snapshots the current panel layout / pricing / financing.
// Leaves status='draft' so the rep can review before sending.
solarProposalsRoutes.post('/', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const b = await c.req.json().catch(() => ({}))

  // Optional deal lookup — pulls homeowner info + utility inputs if available.
  let deal: any = null
  if (b.deal_id) {
    deal = await c.env.DB.prepare(
      `SELECT * FROM solar_deals WHERE customer_id = ? AND id = ?`
    ).bind(auth.ownerId, Number(b.deal_id)).first<any>()
    if (!deal) return c.json({ error: 'deal not found' }, 404)
  }

  // Optional report lookup — copies the solar_panel_layout blob.
  let panelLayout: any = null
  if (b.report_id) {
    const rep = await c.env.DB.prepare(
      `SELECT r.solar_panel_layout FROM reports r
       JOIN orders o ON o.id = r.order_id
       WHERE o.customer_id = ? AND r.id = ?`
    ).bind(auth.ownerId, Number(b.report_id)).first<any>()
    if (rep && rep.solar_panel_layout) panelLayout = rep.solar_panel_layout
  }
  if (b.panel_layout_json) panelLayout = toJsonOrNull(b.panel_layout_json)

  // Derived fields (caller may override).
  const system_kw = Number(b.system_kw ?? deal?.system_kw ?? 0)
  const panel_count = Number(b.panel_count ?? 0)
  const annual_kwh = Number(b.annual_kwh ?? 0)
  const utility_rate = b.utility_rate_per_kwh ?? deal?.utility_rate_per_kwh ?? null
  const annual_consumption = b.annual_consumption_kwh ?? deal?.annual_consumption_kwh ?? null
  const offset_pct = (annual_kwh && annual_consumption)
    ? Math.round((annual_kwh / Number(annual_consumption)) * 10000) / 100
    : null

  const shareToken = generateShareToken()
  const r = await c.env.DB.prepare(`
    INSERT INTO solar_proposals (
      customer_id, deal_id, report_id, share_token, parent_proposal_id,
      system_kw, panel_count, annual_kwh,
      panel_layout_json, equipment_json, pricing_json, financing_scenarios_json,
      utility_rate_per_kwh, annual_consumption_kwh, offset_pct, savings_25yr_cad,
      homeowner_name, homeowner_email, homeowner_phone, property_address,
      status, expires_at
    ) VALUES (?,?,?,?,?, ?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?, 'draft', ?)
  `).bind(
    auth.ownerId,
    b.deal_id ? Number(b.deal_id) : null,
    b.report_id ? Number(b.report_id) : null,
    shareToken,
    b.parent_proposal_id ? Number(b.parent_proposal_id) : null,
    system_kw, panel_count, annual_kwh,
    panelLayout,
    toJsonOrNull(b.equipment_json),
    toJsonOrNull(b.pricing_json),
    toJsonOrNull(b.financing_scenarios_json),
    utility_rate !== null ? Number(utility_rate) : null,
    annual_consumption !== null ? Number(annual_consumption) : null,
    offset_pct,
    b.savings_25yr_cad != null ? Number(b.savings_25yr_cad) : null,
    b.homeowner_name ?? deal?.homeowner_name ?? null,
    b.homeowner_email ?? deal?.homeowner_email ?? null,
    b.homeowner_phone ?? deal?.homeowner_phone ?? null,
    b.property_address ?? deal?.property_address ?? null,
    b.expires_at || null,
  ).run()

  const id = r.meta.last_row_id
  const publicUrl = `/p/solar/${shareToken}`
  return c.json({ success: true, id, share_token: shareToken, public_url: publicUrl })
})

// ── Duplicate (variant of a sent proposal — Sprint 2 item 8) ──
solarProposalsRoutes.post('/:id/duplicate', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const id = Number(c.req.param('id'))
  const src = await c.env.DB.prepare(
    `SELECT * FROM solar_proposals WHERE customer_id = ? AND id = ?`
  ).bind(auth.ownerId, id).first<any>()
  if (!src) return c.json({ error: 'not found' }, 404)
  const parent = src.parent_proposal_id || src.id
  const shareToken = generateShareToken()
  const r = await c.env.DB.prepare(`
    INSERT INTO solar_proposals (
      customer_id, deal_id, report_id, share_token, parent_proposal_id,
      system_kw, panel_count, annual_kwh,
      panel_layout_json, equipment_json, pricing_json, financing_scenarios_json,
      utility_rate_per_kwh, annual_consumption_kwh, offset_pct, savings_25yr_cad,
      homeowner_name, homeowner_email, homeowner_phone, property_address,
      status
    ) SELECT
      customer_id, deal_id, report_id, ?, ?,
      system_kw, panel_count, annual_kwh,
      panel_layout_json, equipment_json, pricing_json, financing_scenarios_json,
      utility_rate_per_kwh, annual_consumption_kwh, offset_pct, savings_25yr_cad,
      homeowner_name, homeowner_email, homeowner_phone, property_address,
      'draft'
    FROM solar_proposals WHERE customer_id = ? AND id = ?
  `).bind(shareToken, parent, auth.ownerId, id).run()
  return c.json({ success: true, id: r.meta.last_row_id, share_token: shareToken, public_url: `/p/solar/${shareToken}` })
})

// ── Patch (only while draft) ──────────────────────────────
solarProposalsRoutes.patch('/:id', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const id = Number(c.req.param('id'))
  const b = await c.req.json().catch(() => ({}))

  const existing = await c.env.DB.prepare(
    `SELECT status FROM solar_proposals WHERE customer_id = ? AND id = ?`
  ).bind(auth.ownerId, id).first<any>()
  if (!existing) return c.json({ error: 'not found' }, 404)
  // Snapshot rule: can't mutate sent/signed proposals. Duplicate instead.
  if (existing.status !== 'draft') {
    return c.json({ error: 'proposal is not a draft — duplicate it to make changes' }, 409)
  }

  const scalar = [
    'system_kw','panel_count','annual_kwh',
    'utility_rate_per_kwh','annual_consumption_kwh','offset_pct','savings_25yr_cad',
    'homeowner_name','homeowner_email','homeowner_phone','property_address',
    'expires_at',
  ]
  const json = ['panel_layout_json','equipment_json','pricing_json','financing_scenarios_json']
  const sets: string[] = []
  const vals: any[] = []
  for (const k of scalar) if (k in b) { sets.push(`${k} = ?`); vals.push(b[k] === '' ? null : b[k]) }
  for (const k of json)   if (k in b) { sets.push(`${k} = ?`); vals.push(toJsonOrNull(b[k])) }
  if (sets.length === 0) return c.json({ success: true })
  sets.push("updated_at = datetime('now')")
  vals.push(auth.ownerId, id)
  await c.env.DB.prepare(
    `UPDATE solar_proposals SET ${sets.join(', ')} WHERE customer_id = ? AND id = ?`
  ).bind(...vals).run()
  return c.json({ success: true })
})

// ── Send ──────────────────────────────────────────────────
// Marks sent, stamps sent_at, advances linked deal to proposal_sent.
// Resend email wiring is done by solar-automations.ts (task 8); this
// endpoint just records the transition + logs a funnel event.
solarProposalsRoutes.post('/:id/send', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const id = Number(c.req.param('id'))

  const row = await c.env.DB.prepare(
    `SELECT * FROM solar_proposals WHERE customer_id = ? AND id = ?`
  ).bind(auth.ownerId, id).first<any>()
  if (!row) return c.json({ error: 'not found' }, 404)
  if (row.status === 'signed' || row.status === 'voided') {
    return c.json({ error: `cannot send a ${row.status} proposal` }, 409)
  }

  await c.env.DB.prepare(
    `UPDATE solar_proposals SET status = 'sent', sent_at = datetime('now'), updated_at = datetime('now')
     WHERE customer_id = ? AND id = ?`
  ).bind(auth.ownerId, id).run()

  // Advance the linked deal to proposal_sent if it's earlier in the funnel.
  if (row.deal_id) {
    await c.env.DB.prepare(
      `UPDATE solar_deals
         SET stage = 'proposal_sent',
             proposal_sent_at = COALESCE(proposal_sent_at, datetime('now')),
             updated_at = datetime('now')
       WHERE customer_id = ? AND id = ?
         AND stage IN ('new_lead','appointment_set')`
    ).bind(auth.ownerId, row.deal_id).run()
  }

  await c.env.DB.prepare(
    `INSERT INTO solar_proposal_events (proposal_id, event_type, event_data_json) VALUES (?, 'proposal_sent', ?)`
  ).bind(id, JSON.stringify({ share_token: row.share_token })).run()

  // Fire email to the homeowner (best-effort — endpoint succeeds either way).
  try {
    const origin = new URL(c.req.url).origin
    const { sendProposalEmail } = await import('../services/solar-automations')
    c.executionCtx.waitUntil(sendProposalEmail(c.env as any, id, origin).catch(() => {}))
  } catch {}

  return c.json({ success: true, share_token: row.share_token, public_url: `/p/solar/${row.share_token}` })
})

// ── Void ──────────────────────────────────────────────────
// Revokes the share token (public route rejects 'voided' status).
solarProposalsRoutes.post('/:id/void', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const id = Number(c.req.param('id'))
  const r = await c.env.DB.prepare(
    `UPDATE solar_proposals SET status = 'voided', updated_at = datetime('now')
     WHERE customer_id = ? AND id = ? AND status != 'signed'`
  ).bind(auth.ownerId, id).run()
  if (!r.meta.changes) return c.json({ error: 'not found or already signed' }, 409)
  return c.json({ success: true })
})

// ── Delete (draft only) ───────────────────────────────────
solarProposalsRoutes.delete('/:id', async (c) => {
  const auth = await requireCustomer(c); if (!auth) return c.json({ error: 'Not authenticated' }, 401)
  const id = Number(c.req.param('id'))
  const r = await c.env.DB.prepare(
    `DELETE FROM solar_proposals WHERE customer_id = ? AND id = ? AND status = 'draft'`
  ).bind(auth.ownerId, id).run()
  if (!r.meta.changes) return c.json({ error: 'not found or not a draft' }, 409)
  return c.json({ success: true })
})

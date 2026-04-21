// End-to-end round-trip of the rep → homeowner flow exercised against
// an in-memory fake of D1. We don't spin up wrangler here — the goal is
// to verify the handler contract + snapshot discipline + stage auto-advance.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { solarProposalsRoutes } from './solar-proposals'

// ─── Tiny D1 fake that understands the handful of statements we use ─────
type Row = Record<string, any>
class FakeDB {
  proposals: Row[] = []
  deals: Row[] = []
  events: Row[] = []
  reports: Row[] = []
  orders: Row[] = []
  sessions: Row[] = []
  team: Row[] = []
  nextId = 1

  prepare(sql: string) {
    return new FakeStmt(this, sql)
  }
}

class FakeStmt {
  constructor(private db: FakeDB, private sql: string, private args: any[] = []) {}
  bind(...args: any[]) { return new FakeStmt(this.db, this.sql, args) }

  async first<T = any>(): Promise<T | null> {
    const rows = this._rows()
    return (rows[0] as T) || null
  }
  async all() {
    return { results: this._rows() }
  }
  async run() {
    const s = this.sql.trim().toUpperCase()
    if (s.startsWith('INSERT INTO SOLAR_PROPOSALS')) {
      const id = this.db.nextId++
      const a = this.args
      this.db.proposals.push({
        id,
        customer_id: a[0], deal_id: a[1], report_id: a[2], share_token: a[3], parent_proposal_id: a[4],
        system_kw: a[5], panel_count: a[6], annual_kwh: a[7],
        panel_layout_json: a[8], equipment_json: a[9], pricing_json: a[10], financing_scenarios_json: a[11],
        utility_rate_per_kwh: a[12], annual_consumption_kwh: a[13], offset_pct: a[14], savings_25yr_cad: a[15],
        homeowner_name: a[16], homeowner_email: a[17], homeowner_phone: a[18], property_address: a[19],
        status: 'draft', expires_at: a[20], view_count: 0,
      })
      return { meta: { last_row_id: id, changes: 1 } }
    }
    if (s.startsWith('INSERT INTO SOLAR_PROPOSAL_EVENTS')) {
      // The /send path inlines event_type as a SQL literal ('proposal_sent');
      // other callers bind it. Handle both shapes.
      const literalMatch = this.sql.match(/VALUES\s*\(\s*\?\s*,\s*'([^']+)'/i)
      const eventType = literalMatch ? literalMatch[1] : this.args[1]
      this.db.events.push({ proposal_id: this.args[0], event_type: eventType, payload: this.args[literalMatch ? 1 : 2] })
      return { meta: { last_row_id: this.db.events.length, changes: 1 } }
    }
    if (s.startsWith("UPDATE SOLAR_PROPOSALS SET STATUS = 'SENT'")) {
      const [customerId, id] = this.args
      const p = this.db.proposals.find((x) => x.customer_id === customerId && x.id === id)
      if (p) { p.status = 'sent'; p.sent_at = '2026-04-20T00:00:00Z' }
      return { meta: { changes: p ? 1 : 0 } }
    }
    if (s.startsWith("UPDATE SOLAR_DEALS")) {
      // only pipeline advance path — best-effort match
      const customerId = this.args[0], dealId = this.args[1]
      const d = this.db.deals.find((x) => x.customer_id === customerId && x.id === dealId)
      if (d && ['new_lead', 'appointment_set'].includes(d.stage)) {
        d.stage = 'proposal_sent'; d.proposal_sent_at = '2026-04-20T00:00:00Z'
      }
      return { meta: { changes: d ? 1 : 0 } }
    }
    if (s.startsWith("UPDATE SOLAR_PROPOSALS SET STATUS = 'VOIDED'")) {
      const [customerId, id] = this.args
      const p = this.db.proposals.find((x) => x.customer_id === customerId && x.id === id)
      if (p && p.status !== 'signed') { p.status = 'voided'; return { meta: { changes: 1 } } }
      return { meta: { changes: 0 } }
    }
    if (s.startsWith('DELETE FROM SOLAR_PROPOSALS')) {
      const [customerId, id] = this.args
      const before = this.db.proposals.length
      this.db.proposals = this.db.proposals.filter((p) => !(p.customer_id === customerId && p.id === id && p.status === 'draft'))
      return { meta: { changes: before - this.db.proposals.length } }
    }
    return { meta: { changes: 0 } }
  }

  private _rows(): Row[] {
    const s = this.sql.trim().toUpperCase()
    if (s.startsWith('SELECT CUSTOMER_ID FROM CUSTOMER_SESSIONS')) {
      return this.db.sessions.filter((x) => x.session_token === this.args[0])
    }
    if (s.startsWith('SELECT * FROM SOLAR_PROPOSALS WHERE CUSTOMER_ID = ? AND ID = ?')) {
      return this.db.proposals.filter((p) => p.customer_id === this.args[0] && p.id === this.args[1])
    }
    if (s.startsWith('SELECT STATUS FROM SOLAR_PROPOSALS WHERE CUSTOMER_ID = ? AND ID = ?')) {
      const p = this.db.proposals.find((x) => x.customer_id === this.args[0] && x.id === this.args[1])
      return p ? [{ status: p.status }] : []
    }
    if (s.startsWith('SELECT * FROM SOLAR_PROPOSALS WHERE CUSTOMER_ID')) {
      return this.db.proposals.filter((p) => p.customer_id === this.args[0])
    }
    if (s.startsWith('SELECT * FROM SOLAR_DEALS WHERE CUSTOMER_ID = ? AND ID = ?')) {
      return this.db.deals.filter((d) => d.customer_id === this.args[0] && d.id === this.args[1])
    }
    if (s.startsWith('SELECT ID, EVENT_TYPE')) {
      return this.db.events.filter((e) => e.proposal_id === this.args[0])
    }
    // team.resolveTeamOwner call path — any SELECT on team_members returns empty.
    return []
  }
}

// ─── Fake session helper ────────────────────────────────────
function req(body?: any, method = 'POST', path = '/') {
  const init: RequestInit = {
    method,
    headers: { authorization: 'Bearer T1', 'content-type': 'application/json' },
  }
  if (body) init.body = JSON.stringify(body)
  return new Request(`http://local${path}`, init)
}

// ─── Mock team resolver so it doesn't touch D1 ──────────────
vi.mock('./team', () => ({
  resolveTeamOwner: async (_db: any, customerId: number) => ({ ownerId: customerId }),
}))

describe('solar-proposals E2E round-trip', () => {
  let db: FakeDB
  let env: any

  beforeEach(() => {
    db = new FakeDB()
    db.sessions.push({ session_token: 'T1', customer_id: 42 })
    db.deals.push({
      id: 1, customer_id: 42, homeowner_name: 'Alex Smith', homeowner_email: 'a@ex.com',
      property_address: '1 Elm', system_kw: 8.4, stage: 'new_lead',
      annual_consumption_kwh: 9000, utility_rate_per_kwh: 0.18,
    })
    env = { DB: db }
  })

  it('creates a draft proposal and returns a share token + public URL', async () => {
    const res = await solarProposalsRoutes.fetch(req({ deal_id: 1, system_kw: 8.4, panel_count: 21, annual_kwh: 10080 }), env)
    expect(res.status).toBe(200)
    const body: any = await res.json()
    expect(body.success).toBe(true)
    expect(body.share_token).toMatch(/^[a-f0-9]{32}$/)
    expect(body.public_url).toBe(`/p/solar/${body.share_token}`)
    expect(db.proposals).toHaveLength(1)
    expect(db.proposals[0].status).toBe('draft')
    expect(db.proposals[0].offset_pct).toBeCloseTo(112, 0) // 10080/9000
  })

  it('POST /:id/send advances the deal stage to proposal_sent and logs an event', async () => {
    // 1. create
    const createRes = await solarProposalsRoutes.fetch(req({ deal_id: 1, system_kw: 8.4, panel_count: 21, annual_kwh: 10080 }), env)
    const { id } = await createRes.json() as any

    // 2. send
    const sendRes = await solarProposalsRoutes.fetch(req({}, 'POST', `/${id}/send`), env)
    expect(sendRes.status).toBe(200)
    const sendBody: any = await sendRes.json()
    expect(sendBody.success).toBe(true)

    expect(db.proposals[0].status).toBe('sent')
    expect(db.deals[0].stage).toBe('proposal_sent')
    expect(db.events.some((e) => e.event_type === 'proposal_sent')).toBe(true)
  })

  it('PATCH on a sent proposal returns 409 (snapshot discipline)', async () => {
    const createRes = await solarProposalsRoutes.fetch(req({ deal_id: 1, system_kw: 8.4, panel_count: 21, annual_kwh: 10080 }), env)
    const { id } = await createRes.json() as any
    await solarProposalsRoutes.fetch(req({}, 'POST', `/${id}/send`), env)

    const patchRes = await solarProposalsRoutes.fetch(req({ system_kw: 9.9 }, 'PATCH', `/${id}`), env)
    expect(patchRes.status).toBe(409)
  })

  it('DELETE on a sent proposal returns 409 (must void instead)', async () => {
    const createRes = await solarProposalsRoutes.fetch(req({ deal_id: 1, system_kw: 8.4, panel_count: 21, annual_kwh: 10080 }), env)
    const { id } = await createRes.json() as any
    await solarProposalsRoutes.fetch(req({}, 'POST', `/${id}/send`), env)

    const delRes = await solarProposalsRoutes.fetch(req(undefined, 'DELETE', `/${id}`), env)
    expect(delRes.status).toBe(409)
  })

  it('rejects unauthenticated calls', async () => {
    const r = new Request('http://local/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    const res = await solarProposalsRoutes.fetch(r, env)
    expect(res.status).toBe(401)
  })
})

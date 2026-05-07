import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { agentsRoutes } from './agents'

// ── In-memory D1 mock — only implements what /api/agents/leads touches ──
type Row = Record<string, any>
function makeFakeDB() {
  const leads: Row[] = []
  let nextId = 1
  const settings: Row[] = []

  const stmt = (sql: string, binds: any[] = []): any => {
    const runner = {
      bind(...b: any[]) { return stmt(sql, b) },
      async run() {
        if (/^INSERT INTO leads/i.test(sql)) {
          // Find columns between ( and )
          const colMatch = sql.match(/INSERT INTO leads\s*\(([^)]+)\)/i)
          const cols = colMatch ? colMatch[1].split(',').map((s) => s.trim()) : []
          const row: Row = { id: nextId++, status: 'new', created_at: new Date().toISOString(), updated_at: null }
          cols.forEach((c, i) => { row[c] = binds[i] })
          leads.push(row)
          return { meta: { last_row_id: row.id }, success: true }
        }
        return { meta: {}, success: true }
      },
      async first() {
        if (/FROM settings/i.test(sql)) return settings[0] || null
        return null
      },
      async all() {
        if (/FROM leads/i.test(sql)) return { results: leads }
        return { results: [] }
      }
    }
    return runner
  }

  return {
    prepare(sql: string) { return stmt(sql) },
    async batch(stmts: any[]) {
      return Promise.all(stmts.map((s) => s.run()))
    },
    __leads: leads
  }
}

function makeEnv(db: any) {
  return {
    DB: db,
    GMAIL_CLIENT_ID: '',
    GMAIL_CLIENT_SECRET: '',
    GMAIL_REFRESH_TOKEN: '',
    RESEND_API_KEY: '',
    GCP_SERVICE_ACCOUNT_JSON: '',
    GA_MEASUREMENT_ID: '',
    GA_API_SECRET: '',
    META_PIXEL_ID: '',
    META_ACCESS_TOKEN: ''
  } as any
}

function buildApp(env: any) {
  const app = new Hono()
  app.route('/api/agents', agentsRoutes)
  return { app, env }
}

async function post(app: any, path: string, body: any, env: any) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, env)
}

describe('POST /api/agents/leads', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('accepts a valid body and inserts a row', async () => {
    const db = makeFakeDB()
    const env = makeEnv(db)
    const { app } = buildApp(env)
    const res = await post(app, '/api/agents/leads', {
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: '5551112222',
      address: '123 Maple Ave',
      source_page: 'homepage_hero',
      lead_type: 'free_measurement_report'
    }, env)
    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(json.success).toBe(true)
    expect(db.__leads.length).toBe(1)
    expect(db.__leads[0].lead_type).toBe('free_measurement_report')
    expect(db.__leads[0].priority).toBe('high') // free_measurement_report defaults to 'high'
    expect(db.__leads[0].email).toBe('jane@example.com')
  })

  it('rejects a body with a missing email', async () => {
    const db = makeFakeDB()
    const env = makeEnv(db)
    const { app } = buildApp(env)
    const res = await post(app, '/api/agents/leads', {
      name: 'No Email',
      source_page: 'homepage_hero'
    }, env)
    expect(res.status).toBe(400)
    const json: any = await res.json()
    expect(json.error).toBeTruthy()
    expect(db.__leads.length).toBe(0)
  })

  it('honeypot: silently succeeds without inserting', async () => {
    const db = makeFakeDB()
    const env = makeEnv(db)
    const { app } = buildApp(env)
    const res = await post(app, '/api/agents/leads', {
      name: 'Bot',
      email: 'bot@bots.com',
      website: 'http://spam.example/',
      source_page: 'homepage_hero'
    }, env)
    expect(res.status).toBe(200)
    const json: any = await res.json()
    expect(json.success).toBe(true)
    expect(db.__leads.length).toBe(0)
  })

  it('coerces an invalid lead_type to "other" and still inserts', async () => {
    const db = makeFakeDB()
    const env = makeEnv(db)
    const { app } = buildApp(env)
    const res = await post(app, '/api/agents/leads', {
      name: 'Evan',
      email: 'evan@example.com',
      source_page: 'homepage_hero',
      lead_type: 'not_a_real_type_' + Math.random()
    }, env)
    expect(res.status).toBe(200)
    expect(db.__leads[0].lead_type).toBe('other')
    expect(db.__leads[0].priority).toBe('normal')
  })

  it('lead is still inserted even if auto-ack email send would fail (env has no credentials)', async () => {
    const db = makeFakeDB()
    const env = makeEnv(db) // all email creds empty
    const { app } = buildApp(env)
    const res = await post(app, '/api/agents/leads', {
      name: 'Test User',
      email: 'test@example.com',
      source_page: 'homepage_hero',
      lead_type: 'free_measurement_report'
    }, env)
    expect(res.status).toBe(200)
    expect(db.__leads.length).toBe(1)
  })
})

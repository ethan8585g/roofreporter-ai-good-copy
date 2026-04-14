import { Hono } from 'hono'
import type { Bindings } from '../types'
import { getActiveAlerts, getHailReports } from '../services/storm-data'
import { buildDailySnapshot, writeSnapshot, readSnapshot, listSnapshotDates, pruneOldSnapshots } from '../services/storm-ingest'

export const stormScoutRoutes = new Hono<{ Bindings: Bindings }>()

async function requireCustomer(c: any): Promise<number | null> {
  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  return session?.customer_id ?? null
}

stormScoutRoutes.get('/alerts', async (c) => {
  const customerId = await requireCustomer(c)
  if (!customerId) return c.json({ error: 'Not authenticated' }, 401)

  try {
    const { events, cached, fetchedAt, sources } = await getActiveAlerts()
    c.header('Cache-Control', 'public, max-age=300')
    return c.json({ alerts: events, cached, fetchedAt, count: events.length, sources })
  } catch (err: any) {
    return c.json({ error: 'Failed to fetch alerts', detail: err?.message || String(err) }, 502)
  }
})

stormScoutRoutes.get('/heatmap', async (c) => {
  const customerId = await requireCustomer(c)
  if (!customerId) return c.json({ error: 'Not authenticated' }, 401)
  const days = parseInt(c.req.query('days') || '7', 10)
  try {
    const { reports, cached, fetchedAt } = await getHailReports(days)
    c.header('Cache-Control', 'public, max-age=600')
    return c.json({ reports, cached, fetchedAt, count: reports.length, days })
  } catch (err: any) {
    return c.json({ error: 'Failed to fetch hail reports', detail: err?.message || String(err) }, 502)
  }
})

// ------------------------------------------------------------
// History — serve a stored daily snapshot from R2
// ------------------------------------------------------------
stormScoutRoutes.get('/history', async (c) => {
  const customerId = await requireCustomer(c)
  if (!customerId) return c.json({ error: 'Not authenticated' }, 401)
  if (!c.env.STORM_R2) return c.json({ error: 'R2 not configured' }, 503)

  const date = c.req.query('date')
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400)
    const snap = await readSnapshot(c.env.STORM_R2, date)
    if (!snap) return c.json({ error: 'No snapshot for that date' }, 404)
    c.header('Cache-Control', 'public, max-age=3600')
    return c.json(snap)
  }
  // No date → return list of available dates
  const dates = await listSnapshotDates(c.env.STORM_R2)
  return c.json({ dates })
})

// ------------------------------------------------------------
// Ingest — called nightly by GitHub Actions cron with shared secret
// Also supports ?dryRun=1 to preview without writing to R2.
// ------------------------------------------------------------
stormScoutRoutes.post('/ingest', async (c) => {
  const secret = c.req.header('X-Storm-Ingest-Secret')
  const expected = c.env.STORM_INGEST_SECRET
  if (!expected) return c.json({ error: 'Ingest secret not configured' }, 503)
  if (!secret || secret !== expected) return c.json({ error: 'Unauthorized' }, 401)
  if (!c.env.STORM_R2) return c.json({ error: 'R2 not configured' }, 503)

  const dryRun = c.req.query('dryRun') === '1'
  try {
    const snapshot = await buildDailySnapshot()
    if (!dryRun) {
      const key = await writeSnapshot(c.env.STORM_R2, snapshot)
      const pruned = await pruneOldSnapshots(c.env.STORM_R2, 30)
      return c.json({ ok: true, key, date: snapshot.date, summary: snapshot.summary, sources: snapshot.sources, pruned })
    }
    return c.json({ ok: true, dryRun: true, date: snapshot.date, summary: snapshot.summary, sources: snapshot.sources })
  } catch (err: any) {
    return c.json({ error: 'Ingest failed', detail: err?.message || String(err) }, 500)
  }
})

stormScoutRoutes.get('/health', (c) => c.json({ ok: true, service: 'storm-scout', r2: !!c.env.STORM_R2 }))

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { getActiveAlerts, getHailReports, stormCacheClear } from '../services/storm-data'
import { buildDailySnapshot, writeSnapshot, readSnapshot, listSnapshotDates, pruneOldSnapshots, matchSnapshotAndNotify } from '../services/storm-ingest'
import { GIBS_LAYERS, getGibsTileUrl, getGibsMaxZoom, buildGoogleStaticMapUrl, BASEMAP_PROVIDERS } from '../services/satellite-imagery'

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
      // Invalidate in-memory caches so next /alerts + /heatmap refetch fresh.
      stormCacheClear()
      // Run territory matcher + email digests.
      let matchResult: any = null
      try {
        const { getVapidFromEnv } = await import('../services/web-push')
        matchResult = await matchSnapshotAndNotify(
          c.env.DB,
          snapshot,
          (c.env as any).GCP_SERVICE_ACCOUNT_JSON || c.env.GCP_SERVICE_ACCOUNT_KEY,
          getVapidFromEnv(c.env as any)
        )
      } catch (e: any) {
        matchResult = { error: e?.message || String(e) }
      }
      return c.json({ ok: true, key, date: snapshot.date, summary: snapshot.summary, sources: snapshot.sources, pruned, matcher: matchResult })
    }
    return c.json({ ok: true, dryRun: true, date: snapshot.date, summary: snapshot.summary, sources: snapshot.sources })
  } catch (err: any) {
    return c.json({ error: 'Ingest failed', detail: err?.message || String(err) }, 500)
  }
})

// ------------------------------------------------------------
// Satellite — list available GIBS layers (client uses this to build
// ImageMapType overlays) + proxy-free direct URL helper.
// ------------------------------------------------------------
// ------------------------------------------------------------
// Basemap providers — hands the client a list of enabled alt-satellite
// providers (Esri, Mapbox, Nearmap …) with tile URL templates. Tokens
// are only included for providers whose secret is actually set in env.
// ------------------------------------------------------------
stormScoutRoutes.get('/basemaps', async (c) => {
  const customerId = await requireCustomer(c)
  if (!customerId) return c.json({ error: 'Not authenticated' }, 401)
  const env: any = c.env
  const out: any[] = []
  for (const p of Object.values(BASEMAP_PROVIDERS)) {
    if (!p.requiresToken) {
      out.push({ id: p.id, name: p.name, maxZoom: p.maxZoom, attribution: p.attribution, urlTemplate: p.urlTemplate, enabled: true })
      continue
    }
    let token: string | undefined
    if (p.id === 'mapbox_satellite') token = env.MAPBOX_ACCESS_TOKEN
    if (p.id === 'nearmap') token = env.NEARMAP_API_KEY
    if (!token) continue
    out.push({
      id: p.id, name: p.name, maxZoom: p.maxZoom, attribution: p.attribution,
      urlTemplate: p.urlTemplate.replace('{token}', token),
      enabled: true
    })
  }
  return c.json({ providers: out })
})

stormScoutRoutes.get('/satellite/layers', async (c) => {
  const customerId = await requireCustomer(c)
  if (!customerId) return c.json({ error: 'Not authenticated' }, 401)
  const layers = Object.entries(GIBS_LAYERS).map(([key, id]) => ({
    key, id, maxZoom: getGibsMaxZoom(id),
    attribution: 'Imagery courtesy of NASA GIBS / EOSDIS'
  }))
  return c.json({ layers })
})

// Proxy a single GIBS tile — used when we want to cache at the edge
// and avoid mixed-content or referer issues. Direct GIBS URLs work
// too (no key needed), so the client may call them directly.
stormScoutRoutes.get('/satellite/gibs/:layer/:date/:z/:x/:y', async (c) => {
  const customerId = await requireCustomer(c)
  if (!customerId) return c.json({ error: 'Not authenticated' }, 401)
  const { layer, date, z, x, y } = c.req.param()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: 'Bad date' }, 400)
  const zi = parseInt(z, 10), xi = parseInt(x, 10)
  const yClean = y.replace(/\.(jpg|png)$/, '')
  const yi = parseInt(yClean, 10)
  if (!Number.isFinite(zi) || !Number.isFinite(xi) || !Number.isFinite(yi)) {
    return c.json({ error: 'Bad tile coords' }, 400)
  }
  if (zi < 0 || zi > 12 || xi < 0 || yi < 0 || xi >= Math.pow(2, zi) || yi >= Math.pow(2, zi)) {
    return c.json({ error: 'Tile out of range' }, 400)
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const url = getGibsTileUrl(layer, date, zi, xi, yi)
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'RoofManager-StormScout/1.0 (support@roofmanager.ca)' }
    })
    if (!upstream.ok) return c.json({ error: 'Tile not found', status: upstream.status }, 404)
    const body = await upstream.arrayBuffer()
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') || 'image/jpeg',
        'Cache-Control': 'public, max-age=86400'
      }
    })
  } catch (err: any) {
    const isAbort = err?.name === 'AbortError'
    return c.json({ error: isAbort ? 'Tile fetch timeout' : 'Tile fetch failed', detail: err?.message || String(err) }, isAbort ? 504 : 502)
  } finally {
    clearTimeout(timer)
  }
})

// Before/after roof-level snapshot — returns a signed-ish Google Static
// Maps URL. API key is kept server-side; response includes the full URL
// so the client can render it in <img>. Google doesn't expose historical
// imagery selection via Static Maps, so the `date` param is returned as
// a label for documentation purposes only.
stormScoutRoutes.get('/satellite/snapshot', async (c) => {
  const customerId = await requireCustomer(c)
  if (!customerId) return c.json({ error: 'Not authenticated' }, 401)
  const lat = parseFloat(c.req.query('lat') || '')
  const lng = parseFloat(c.req.query('lng') || '')
  const zoom = parseInt(c.req.query('zoom') || '19', 10)
  const date = c.req.query('date') || ''
  if (isNaN(lat) || isNaN(lng)) return c.json({ error: 'lat/lng required' }, 400)
  const key = c.env.GOOGLE_MAPS_API_KEY
  if (!key) return c.json({ error: 'Maps API key not configured' }, 503)
  const url = buildGoogleStaticMapUrl(key, { lat, lng, zoom, mapType: 'satellite' })
  return c.json({ url, lat, lng, zoom, date, note: 'Google Static Maps shows current imagery; date is for documentation only.' })
})

stormScoutRoutes.post('/cache/clear', async (c) => {
  const secret = c.req.header('X-Storm-Ingest-Secret')
  if (!c.env.STORM_INGEST_SECRET || secret !== c.env.STORM_INGEST_SECRET) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  stormCacheClear()
  return c.json({ ok: true, cleared: true })
})

stormScoutRoutes.get('/health', (c) => c.json({ ok: true, service: 'storm-scout', r2: !!c.env.STORM_R2 }))

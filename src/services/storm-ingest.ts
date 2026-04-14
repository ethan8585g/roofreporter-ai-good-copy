// ============================================================
// Storm Scout — Nightly snapshot ingester (Phase 2.5)
// Aggregates the previous 24h of NWS/ECCC alerts + LSR hail reports
// into a single daily JSON snapshot stored in R2 at:
//   snapshots/YYYY-MM-DD.json
// ============================================================

import { fetchECCCAlerts } from './storm-data'
import { fetchNWSAlerts, fetchIEMLocalStormReports } from './nws-data'
import { matchEvents, type ServiceArea, type Ring, type Match } from './storm-matcher'
import { sendGmailEmail } from './email'

export interface DailySnapshot {
  date: string                // YYYY-MM-DD (UTC)
  generatedAt: string         // ISO timestamp
  windowHours: 24
  alerts: any[]
  hailReports: any[]
  summary: {
    alertCount: number
    hailCount: number
    maxHailInches: number
    severeHailCount: number   // >= 1"
  }
  sources: Record<string, number | string>
}

function ymdUTC(d: Date): string { return d.toISOString().slice(0, 10) }

export async function buildDailySnapshot(dateOverride?: string): Promise<DailySnapshot> {
  const date = dateOverride || ymdUTC(new Date())
  const sources: Record<string, number | string> = {}

  const results = await Promise.allSettled([
    fetchECCCAlerts(),
    fetchNWSAlerts(),
    fetchIEMLocalStormReports(1)
  ])

  const alerts: any[] = []
  if (results[0].status === 'fulfilled') { alerts.push(...results[0].value); sources.eccc = results[0].value.length }
  else sources.eccc = 'error: ' + (results[0].reason?.message || 'unknown')
  if (results[1].status === 'fulfilled') { alerts.push(...results[1].value); sources.nws = results[1].value.length }
  else sources.nws = 'error: ' + (results[1].reason?.message || 'unknown')

  const hailReports = results[2].status === 'fulfilled' ? results[2].value.filter((r: any) => r.type === 'hail') : []
  sources.iem_lsr = results[2].status === 'fulfilled' ? hailReports.length : ('error: ' + (results[2] as any).reason?.message)

  let maxHail = 0, severe = 0
  for (const r of hailReports) { if (r.sizeInches > maxHail) maxHail = r.sizeInches; if (r.sizeInches >= 1) severe++ }

  return {
    date,
    generatedAt: new Date().toISOString(),
    windowHours: 24,
    alerts,
    hailReports,
    summary: { alertCount: alerts.length, hailCount: hailReports.length, maxHailInches: maxHail, severeHailCount: severe },
    sources
  }
}

export async function writeSnapshot(r2: R2Bucket, snapshot: DailySnapshot): Promise<string> {
  const key = `snapshots/${snapshot.date}.json`
  await r2.put(key, JSON.stringify(snapshot), {
    httpMetadata: { contentType: 'application/json' }
  })
  return key
}

export async function readSnapshot(r2: R2Bucket, date: string): Promise<DailySnapshot | null> {
  const obj = await r2.get(`snapshots/${date}.json`)
  if (!obj) return null
  const text = await obj.text()
  try { return JSON.parse(text) as DailySnapshot } catch { return null }
}

export async function listSnapshotDates(r2: R2Bucket, limit = 60): Promise<string[]> {
  const listed = await r2.list({ prefix: 'snapshots/', limit })
  return listed.objects
    .map(o => o.key.replace(/^snapshots\//, '').replace(/\.json$/, ''))
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse()
}

// ------------------------------------------------------------
// Phase 3: match a snapshot's events against all active service areas,
// write storm_notifications rows (dedupe-keyed), and send email where
// configured. Safe to call without R2 — only needs DB + (optionally)
// GCP service account for email.
// ------------------------------------------------------------
export interface MatchRunResult {
  areasChecked: number
  matches: number
  newNotifications: number
  emailsSent: number
  emailErrors: number
}

export async function matchSnapshotAndNotify(
  db: D1Database,
  snapshot: DailySnapshot,
  serviceAccountJson?: string
): Promise<MatchRunResult> {
  const areasRs = await db.prepare(
    'SELECT * FROM storm_service_areas WHERE is_active = 1'
  ).all<any>()
  const areas: ServiceArea[] = []
  for (const row of (areasRs.results || [])) {
    let poly: Ring | null = null
    try { poly = JSON.parse(row.polygon_geojson) } catch {}
    if (!Array.isArray(poly) || poly.length < 3) continue
    let types: string[] = ['hail', 'wind', 'tornado', 'thunderstorm']
    try { types = JSON.parse(row.types_json) } catch {}
    areas.push({
      id: row.id,
      customer_id: row.customer_id,
      name: row.name,
      polygon: poly,
      min_hail_inches: Number(row.min_hail_inches) || 0,
      min_wind_kmh: Number(row.min_wind_kmh) || 0,
      types,
      notify_email: !!row.notify_email,
      notify_push: !!row.notify_push
    })
  }

  const matches: Match[] = matchEvents(areas, snapshot.alerts as any, snapshot.hailReports as any)

  let newNotifications = 0, emailsSent = 0, emailErrors = 0
  // Group by customer for digest email.
  const byCustomer: Record<number, Match[]> = {}

  for (const m of matches) {
    try {
      const res = await db.prepare(
        `INSERT OR IGNORE INTO storm_notifications
          (customer_id, area_id, area_name, event_source, event_type, severity,
           event_timestamp, hail_inches, wind_kmh, lat, lng, description, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        m.area.customer_id, m.area.id, m.area.name, m.source, m.eventType, m.severity,
        m.timestamp, m.hailInches ?? null, m.windKmh ?? null, m.lat, m.lng,
        m.description.slice(0, 500), m.dedupeKey
      ).run()
      const changed = (res as any).meta?.changes ?? 0
      if (changed > 0) {
        newNotifications++
        if (m.area.notify_email) {
          if (!byCustomer[m.area.customer_id]) byCustomer[m.area.customer_id] = []
          byCustomer[m.area.customer_id].push(m)
        }
      }
    } catch (err) {
      console.warn('[storm-ingest] notify insert failed:', (err as any)?.message)
    }
  }

  // Send digest email per customer
  if (serviceAccountJson) {
    for (const [cidStr, ms] of Object.entries(byCustomer)) {
      const cid = parseInt(cidStr, 10)
      try {
        const cust = await db.prepare('SELECT email, name FROM customers WHERE id = ?').bind(cid).first<any>()
        if (!cust?.email) continue
        const subject = `Storm Scout: ${ms.length} new match${ms.length === 1 ? '' : 'es'} in your territory`
        const rows = ms.slice(0, 25).map(m => {
          const size = m.hailInches ? `${m.hailInches.toFixed(2)}" hail` : m.windKmh ? `${m.windKmh} km/h wind` : m.eventType
          const when = m.timestamp ? new Date(m.timestamp).toLocaleString() : ''
          return `<tr>
            <td style="padding:6px 10px;border-bottom:1px solid #eee;"><b>${escape(m.area.name)}</b></td>
            <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escape(m.eventType)} • ${escape(m.severity)}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #eee;">${escape(size)}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#666;">${escape(when)}</td>
          </tr>`
        }).join('')
        const html = `
<div style="font-family:system-ui;max-width:680px;margin:0 auto;padding:20px;">
  <h2 style="margin:0 0 6px;">Storm Scout alert</h2>
  <p style="color:#555;margin:0 0 16px;">
    ${ms.length} event${ms.length === 1 ? '' : 's'} matched your service area${ms.length === 1 ? '' : 's'} in the last 24 hours.
  </p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;">${rows}</table>
  <p style="margin-top:20px;">
    <a href="https://www.roofmanager.ca/customer/storm-scout" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;">Open Storm Scout</a>
  </p>
  <p style="color:#999;font-size:12px;margin-top:18px;">You can edit thresholds or turn off emails per territory inside Storm Scout.</p>
</div>`.trim()
        await sendGmailEmail(serviceAccountJson, cust.email, subject, html, cust.email)
        // Mark all this batch as email_sent
        const ids = ms.map(m => m.dedupeKey)
        if (ids.length) {
          const placeholders = ids.map(() => '?').join(',')
          await db.prepare(`UPDATE storm_notifications SET email_sent = 1 WHERE dedupe_key IN (${placeholders})`)
            .bind(...ids).run()
        }
        emailsSent++
      } catch (err) {
        emailErrors++
        console.warn('[storm-ingest] email failed:', (err as any)?.message)
        try {
          const keys = ms.map(m => m.dedupeKey)
          const placeholders = keys.map(() => '?').join(',')
          await db.prepare(`UPDATE storm_notifications SET email_error = ? WHERE dedupe_key IN (${placeholders})`)
            .bind(String((err as any)?.message || err).slice(0, 300), ...keys).run()
        } catch {}
      }
    }
  }

  return { areasChecked: areas.length, matches: matches.length, newNotifications, emailsSent, emailErrors }
}

function escape(s: string): string {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c])
}

export async function pruneOldSnapshots(r2: R2Bucket, keepDays = 30): Promise<number> {
  const listed = await r2.list({ prefix: 'snapshots/', limit: 500 })
  const cutoff = new Date(Date.now() - keepDays * 24 * 3600 * 1000)
  const cutoffKey = `snapshots/${ymdUTC(cutoff)}.json`
  const toDelete = listed.objects.filter(o => o.key < cutoffKey).map(o => o.key)
  if (toDelete.length) await r2.delete(toDelete)
  return toDelete.length
}

// ============================================================
// Storm Scout — Nightly snapshot ingester (Phase 2.5)
// Aggregates the previous 24h of NWS/ECCC alerts + LSR hail reports
// into a single daily JSON snapshot stored in R2 at:
//   snapshots/YYYY-MM-DD.json
// ============================================================

import { fetchECCCAlerts } from './storm-data'
import { fetchNWSAlerts, fetchIEMLocalStormReports } from './nws-data'

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

export async function pruneOldSnapshots(r2: R2Bucket, keepDays = 30): Promise<number> {
  const listed = await r2.list({ prefix: 'snapshots/', limit: 500 })
  const cutoff = new Date(Date.now() - keepDays * 24 * 3600 * 1000)
  const cutoffKey = `snapshots/${ymdUTC(cutoff)}.json`
  const toDelete = listed.objects.filter(o => o.key < cutoffKey).map(o => o.key)
  if (toDelete.length) await r2.delete(toDelete)
  return toDelete.length
}

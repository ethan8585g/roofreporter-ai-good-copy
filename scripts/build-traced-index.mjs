#!/usr/bin/env node
// ============================================================
// build-traced-index — regenerate src/data/traced-index.ts
// ============================================================
// Reads a `traced-reports-export.json` produced by running
// `wrangler d1 execute … --file scripts/export-traced-reports.sql --json`
// (or any tool that runs the SQL and emits the same column shape),
// picks the top-N most useful examples by (segment count diversity +
// recency + completeness), and rewrites src/data/traced-index.ts.
//
// Usage:
//   wrangler d1 execute roofing-production \
//     --remote --file scripts/export-traced-reports.sql --json \
//     > traced-reports-export.json
//   node scripts/build-traced-index.mjs traced-reports-export.json
//
// The pool size cap (30 entries × ~3 KB each = ~90 KB) keeps the worker
// bundle small. Picked over an exhaustive dump because Claude reads at
// most 5 examples per request, so a curated diverse set beats a big
// homogeneous one.
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const POOL_SIZE = 30
const inputPath = process.argv[2]
if (!inputPath) {
  console.error('usage: node scripts/build-traced-index.mjs <traced-reports-export.json>')
  process.exit(1)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outPath = path.resolve(__dirname, '..', 'src', 'data', 'traced-index.ts')

const raw = readFileSync(inputPath, 'utf8')
const data = JSON.parse(raw)

// wrangler d1 …--json returns either `[{ results: [...] }]` or `{ results: [...] }`
// depending on flags. Normalize.
let rows = []
if (Array.isArray(data) && data[0]?.results) rows = data[0].results
else if (data?.results) rows = data.results
else if (Array.isArray(data)) rows = data
else {
  console.error('Could not find rows in input file — expected results[] or top-level array.')
  process.exit(1)
}

console.log(`[build-traced-index] read ${rows.length} traced reports from ${inputPath}`)

// Filter: must have parseable trace + completed report
const usable = rows
  .filter(r => r.roof_trace_json && (r.report_status === 'completed' || r.status === 'completed' || !r.report_status))
  .map(r => {
    let trace
    try { trace = typeof r.roof_trace_json === 'string' ? JSON.parse(r.roof_trace_json) : r.roof_trace_json }
    catch { return null }
    if (!trace) return null
    const hasEaves  = (Array.isArray(trace.eaves_sections) && trace.eaves_sections.length > 0)
                   || (Array.isArray(trace.eaves) && trace.eaves.length >= 3)
    const hasRidges = Array.isArray(trace.ridges) && trace.ridges.length > 0
    const hasHips   = Array.isArray(trace.hips) && trace.hips.length > 0
    const completeness = (hasEaves ? 1 : 0) + (hasRidges ? 1 : 0) + (hasHips ? 1 : 0)
    if (completeness === 0) return null
    let segmentsCount = null
    if (r.roof_segments) {
      try {
        const parsed = typeof r.roof_segments === 'string' ? JSON.parse(r.roof_segments) : r.roof_segments
        if (Array.isArray(parsed)) segmentsCount = parsed.length
        else if (parsed?.segments) segmentsCount = parsed.segments.length
      } catch {}
    }
    return {
      order_id: r.order_id ?? r.id,
      latitude: r.latitude != null ? Number(r.latitude) : null,
      longitude: r.longitude != null ? Number(r.longitude) : null,
      house_sqft: r.house_sqft != null ? Number(r.house_sqft) : null,
      roof_pitch_degrees: r.roof_pitch_degrees != null ? Number(r.roof_pitch_degrees) : null,
      complexity_class: r.complexity_class || null,
      segments_count: segmentsCount,
      roof_trace_json: typeof r.roof_trace_json === 'string'
        ? r.roof_trace_json
        : JSON.stringify(r.roof_trace_json),
      _completeness: completeness,
      _sqft: r.house_sqft != null ? Number(r.house_sqft) : 0,
    }
  })
  .filter(Boolean)

console.log(`[build-traced-index] ${usable.length} traces have ≥1 edge type after filtering`)

// Diversity-aware pool selection — bucket by sqft (1500, 2500, 3500, 4500+)
// and segments count (1-2, 3-4, 5+). Round-robin across non-empty buckets
// so Claude sees a variety of property sizes. Tie-break by completeness desc.
const buckets = new Map()
for (const ex of usable) {
  const sqftBucket = ex._sqft < 1500 ? 'sm' : ex._sqft < 2500 ? 'md' : ex._sqft < 3500 ? 'lg' : 'xl'
  const segBucket  = ex.segments_count == null ? 'u' : ex.segments_count <= 2 ? 'low' : ex.segments_count <= 4 ? 'mid' : 'hi'
  const key = `${sqftBucket}/${segBucket}`
  if (!buckets.has(key)) buckets.set(key, [])
  buckets.get(key).push(ex)
}
for (const arr of buckets.values()) arr.sort((a, b) => b._completeness - a._completeness)

const picked = []
const cursors = new Map(Array.from(buckets.keys()).map(k => [k, 0]))
let done = false
while (picked.length < POOL_SIZE && !done) {
  done = true
  for (const key of buckets.keys()) {
    if (picked.length >= POOL_SIZE) break
    const i = cursors.get(key)
    const arr = buckets.get(key)
    if (i < arr.length) {
      picked.push(arr[i])
      cursors.set(key, i + 1)
      done = false
    }
  }
}

console.log(`[build-traced-index] selected ${picked.length} examples across ${buckets.size} buckets`)

const entries = picked.map(p => {
  const { _completeness, _sqft, ...clean } = p
  return clean
})

const header = `// ============================================================
// Traced Index — bundled few-shot training pool for the auto-trace agent
// ============================================================
// REGENERATE: \`node scripts/build-traced-index.mjs <export.json>\`
// Generated: ${new Date().toISOString()}
// Source rows: ${rows.length} → ${usable.length} usable → ${entries.length} picked
// DO NOT hand-edit — the export script overwrites the array below.
// ============================================================

export interface TracedIndexEntry {
  order_id: number
  latitude: number | null
  longitude: number | null
  house_sqft: number | null
  roof_pitch_degrees: number | null
  complexity_class: string | null
  segments_count: number | null
  roof_trace_json: string
}

export const TRACED_INDEX: TracedIndexEntry[] = ${JSON.stringify(entries, null, 2)}
`

writeFileSync(outPath, header)
console.log(`[build-traced-index] wrote ${outPath}`)

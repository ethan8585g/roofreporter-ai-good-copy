#!/usr/bin/env node
// ============================================================
// run-harness-baseline — auto-trace accuracy harness orchestrator
// ============================================================
// Fires POST /api/admin/superadmin/harness/run for each order in the
// 'baseline' pool of eval_seed_set, aggregates per-order IoU + boundary
// IoU + signed area diff, writes CSV + JSON summary + paired diff if a
// previous run is provided.
//
// Usage:
//   FUNNEL_MONITOR_TOKEN=... node scripts/run-harness-baseline.mjs
//   FUNNEL_MONITOR_TOKEN=... node scripts/run-harness-baseline.mjs --k=2
//   FUNNEL_MONITOR_TOKEN=... node scripts/run-harness-baseline.mjs --diff=baselines/2026-05-10.csv
//
// Env:
//   FUNNEL_MONITOR_TOKEN  (required) — Bearer for the harness endpoint
//   HARNESS_BASE_URL      (default https://www.roofmanager.ca)
//   CLOUDFLARE_API_TOKEN  (required for D1 read via wrangler)
//
// Output:
//   baselines/<timestamp>.csv     — per-order rows
//   baselines/<timestamp>.json    — aggregated summary
//   baselines/<timestamp>.partial.jsonl — resume log (cleaned on success)
// ============================================================

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'

// ── CLI parsing ──────────────────────────────────────────────
function parseArgs(argv) {
  const out = { k: 1, edge: 'eaves', pool: 'baseline', concurrency: 1 }
  for (const a of argv) {
    const m = a.match(/^--([^=]+)=(.*)$/)
    if (!m) continue
    const [, k, v] = m
    if (k === 'k' || k === 'concurrency') out[k] = parseInt(v, 10)
    else out[k] = v
  }
  return out
}
const args = parseArgs(process.argv.slice(2))

// ── Pre-flight ───────────────────────────────────────────────
const TOKEN = process.env.FUNNEL_MONITOR_TOKEN
if (!TOKEN) {
  console.error('ERROR: FUNNEL_MONITOR_TOKEN env var required.')
  console.error('Get it from: wrangler pages secret list --project-name=roofing-measurement-tool')
  process.exit(1)
}
const BASE_URL = process.env.HARNESS_BASE_URL || 'https://www.roofmanager.ca'
const ENDPOINT = `${BASE_URL}/api/admin/superadmin/harness/run`

if (!existsSync('baselines')) mkdirSync('baselines', { recursive: true })
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outBase = args.output ? args.output.replace(/\.csv$/, '') : `baselines/${ts}`
const csvPath = `${outBase}.csv`
const jsonPath = `${outBase}.json`
const partialPath = `${outBase}.partial.jsonl`

// ── D1 candidate selection ───────────────────────────────────
console.log(`[harness] selecting ${args.pool} pool from production D1...`)
const sql = `SELECT s.order_id, s.sqft_bucket, s.seg_bucket, s.source, s.frozen_house_sqft, s.frozen_segments_count
             FROM eval_seed_set s
             WHERE s.pool = '${args.pool.replace(/'/g, "''")}'
             ORDER BY s.order_id`
let candidates = []
try {
  const stdout = execSync(
    `npx wrangler d1 execute roofing-production --remote --json --command="${sql}"`,
    { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 50 * 1024 * 1024 },
  ).toString()
  const parsed = JSON.parse(stdout)
  // Wrangler returns either [{results:[...]}] or {results:[...]}
  const rows = Array.isArray(parsed)
    ? (parsed[0]?.results || [])
    : (parsed?.results || [])
  candidates = rows.map(r => ({
    order_id: Number(r.order_id),
    sqft_bucket: r.sqft_bucket,
    seg_bucket: r.seg_bucket,
    source: r.source,
    frozen_house_sqft: r.frozen_house_sqft,
    frozen_segments_count: r.frozen_segments_count,
  }))
} catch (e) {
  console.error('D1 candidate select failed:', e?.message || e)
  console.error('Make sure CLOUDFLARE_API_TOKEN is set and migration 0237 has been applied.')
  process.exit(1)
}
if (candidates.length === 0) {
  console.error(`No candidates in pool '${args.pool}'. Populate eval_seed_set first.`)
  process.exit(1)
}
console.log(`[harness] ${candidates.length} candidates, K=${args.k} runs each, edge=${args.edge}`)

// ── Resumability ─────────────────────────────────────────────
const completed = new Set()
if (existsSync(partialPath)) {
  const lines = readFileSync(partialPath, 'utf8').split('\n').filter(Boolean)
  for (const line of lines) {
    try {
      const row = JSON.parse(line)
      completed.add(`${row.order_id}|${row.run_idx}`)
    } catch { /* skip corrupt line */ }
  }
  if (completed.size > 0) console.log(`[harness] resuming — ${completed.size} runs already done`)
}

// ── One harness call ─────────────────────────────────────────
async function runOne(orderId, runIdx) {
  const body = { order_id: orderId, edge: args.edge }
  const started = Date.now()
  let attempt = 0, lastErr = null
  while (attempt < 3) {
    attempt++
    try {
      const resp = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      const text = await resp.text()
      let data
      try { data = JSON.parse(text) } catch { data = { _raw: text.slice(0, 200) } }
      if (resp.ok) {
        return {
          order_id: orderId,
          run_idx: runIdx,
          edge: args.edge,
          ok: true,
          iou: data.iou,
          boundary_iou: data.boundary_iou,
          signed_area_diff_pct: data.signed_area_diff_pct,
          agent_confidence: data.agent_confidence,
          agent_segment_count: data.agent_segment_count,
          stored_segment_count: data.stored_segment_count,
          elapsed_ms: data.elapsed_ms,
          retries_used: attempt - 1,
          timestamp_utc: new Date().toISOString(),
          house_sqft: data.house_sqft,
          refinement_pass: data?.diagnostics?.refinement_pass,
          model: data?.diagnostics?.model,
        }
      }
      // 4xx errors are permanent — don't retry
      if (resp.status >= 400 && resp.status < 500) {
        return {
          order_id: orderId, run_idx: runIdx, edge: args.edge,
          ok: false, error_code: `http_${resp.status}_${data?.error || 'unknown'}`,
          message: (data?.message || data?._raw || '').slice(0, 200),
          retries_used: attempt - 1, timestamp_utc: new Date().toISOString(),
        }
      }
      lastErr = `http_${resp.status}`
    } catch (e) {
      lastErr = e?.message || String(e)
    }
    // Backoff: 1s, 4s
    if (attempt < 3) await new Promise(r => setTimeout(r, 1000 * Math.pow(4, attempt - 1)))
  }
  return {
    order_id: orderId, run_idx: runIdx, edge: args.edge,
    ok: false, error_code: 'retry_exhausted',
    message: lastErr || 'unknown',
    retries_used: attempt - 1, timestamp_utc: new Date().toISOString(),
    elapsed_ms: Date.now() - started,
  }
}

// ── Orchestrate ──────────────────────────────────────────────
const rows = []
let done = 0
const total = candidates.length * args.k
const tStart = Date.now()
for (const cand of candidates) {
  for (let runIdx = 1; runIdx <= args.k; runIdx++) {
    const key = `${cand.order_id}|${runIdx}`
    if (completed.has(key)) { done++; continue }
    process.stdout.write(`[harness] ${done + 1}/${total} order=${cand.order_id} run=${runIdx} ...`)
    const result = await runOne(cand.order_id, runIdx)
    const enriched = { ...result, sqft_bucket: cand.sqft_bucket, seg_bucket: cand.seg_bucket, source: cand.source }
    rows.push(enriched)
    appendFileSync(partialPath, JSON.stringify(enriched) + '\n')
    done++
    const status = enriched.ok
      ? `IoU=${(enriched.iou ?? 0).toFixed(3)} bIoU=${(enriched.boundary_iou ?? 0).toFixed(3)} Δarea=${(enriched.signed_area_diff_pct ?? 0).toFixed(1)}% ${enriched.elapsed_ms}ms`
      : `FAIL: ${enriched.error_code}`
    process.stdout.write(` ${status}\n`)
  }
}
const elapsedTotal = ((Date.now() - tStart) / 1000).toFixed(1)

// ── Load earlier partial entries so the summary aggregates everything ──
if (completed.size > 0) {
  const lines = readFileSync(partialPath, 'utf8').split('\n').filter(Boolean)
  for (const line of lines) {
    try {
      const row = JSON.parse(line)
      if (!rows.some(r => r.order_id === row.order_id && r.run_idx === row.run_idx)) {
        rows.push(row)
      }
    } catch {}
  }
}

// ── Aggregation ──────────────────────────────────────────────
function median(xs) {
  const s = xs.filter(x => Number.isFinite(x)).sort((a, b) => a - b)
  if (s.length === 0) return null
  return s.length % 2 === 1 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
function percentile(xs, p) {
  const s = xs.filter(x => Number.isFinite(x)).sort((a, b) => a - b)
  if (s.length === 0) return null
  const idx = Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))
  return s[idx]
}
function mean(xs) {
  const s = xs.filter(x => Number.isFinite(x))
  return s.length === 0 ? null : s.reduce((a, b) => a + b, 0) / s.length
}
// Per-order: median across K runs.
const byOrder = {}
for (const r of rows) {
  if (!r.ok) continue
  byOrder[r.order_id] = byOrder[r.order_id] || { ious: [], bious: [], diffs: [], elapsed: [], cand: r }
  byOrder[r.order_id].ious.push(r.iou)
  byOrder[r.order_id].bious.push(r.boundary_iou)
  byOrder[r.order_id].diffs.push(r.signed_area_diff_pct)
  byOrder[r.order_id].elapsed.push(r.elapsed_ms)
}
const perOrder = Object.entries(byOrder).map(([orderId, v]) => ({
  order_id: Number(orderId),
  iou: median(v.ious),
  boundary_iou: median(v.bious),
  signed_area_diff_pct: median(v.diffs),
  elapsed_ms: median(v.elapsed),
  sqft_bucket: v.cand.sqft_bucket,
  seg_bucket: v.cand.seg_bucket,
  source: v.cand.source,
}))
const okCount = perOrder.length
const failCount = rows.filter(r => !r.ok).length
const ious = perOrder.map(p => p.iou)
const bious = perOrder.map(p => p.boundary_iou)
const diffs = perOrder.map(p => p.signed_area_diff_pct)
const summary = {
  pool: args.pool,
  edge: args.edge,
  k: args.k,
  generated_at: new Date().toISOString(),
  candidates_total: candidates.length,
  runs_total: total,
  runs_ok: rows.filter(r => r.ok).length,
  runs_fail: failCount,
  orders_with_at_least_one_ok: okCount,
  iou: {
    mean: round4(mean(ious)),
    median: round4(median(ious)),
    p25: round4(percentile(ious, 0.25)),
    p75: round4(percentile(ious, 0.75)),
    p10: round4(percentile(ious, 0.10)),
  },
  boundary_iou: {
    mean: round4(mean(bious)),
    median: round4(median(bious)),
  },
  signed_area_diff_pct: {
    mean: round2(mean(diffs)),
    median: round2(median(diffs)),
    over_trace_count: diffs.filter(d => d > 5).length,
    under_trace_count: diffs.filter(d => d < -5).length,
  },
  elapsed_seconds: Number(elapsedTotal),
  by_bucket: groupBy(perOrder, p => `${p.sqft_bucket}/${p.seg_bucket}`).map(g => ({
    bucket: g.key,
    n: g.items.length,
    iou_median: round4(median(g.items.map(p => p.iou))),
    biou_median: round4(median(g.items.map(p => p.boundary_iou))),
  })),
  by_source: groupBy(perOrder, p => p.source).map(g => ({
    source: g.key,
    n: g.items.length,
    iou_median: round4(median(g.items.map(p => p.iou))),
  })),
}

function round4(x) { return x === null ? null : Math.round(x * 10000) / 10000 }
function round2(x) { return x === null ? null : Math.round(x * 100) / 100 }
function groupBy(arr, keyFn) {
  const map = new Map()
  for (const item of arr) {
    const key = keyFn(item)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(item)
  }
  return [...map.entries()].map(([key, items]) => ({ key, items }))
}

// ── Diff against previous baseline (paired Wilcoxon) ─────────
let diffOutput = null
if (args.diff) {
  if (!existsSync(args.diff)) {
    console.warn(`[harness] --diff file not found: ${args.diff}`)
  } else {
    const prev = parseCsvSimple(readFileSync(args.diff, 'utf8'))
    const prevByOrder = {}
    for (const r of prev) {
      const id = Number(r.order_id)
      const iou = parseFloat(r.iou)
      if (!Number.isFinite(iou)) continue
      prevByOrder[id] = prevByOrder[id] || []
      prevByOrder[id].push(iou)
    }
    const pairs = []
    for (const p of perOrder) {
      const prevIous = prevByOrder[p.order_id]
      if (!prevIous) continue
      pairs.push({ order_id: p.order_id, before: median(prevIous), after: p.iou })
    }
    if (pairs.length >= 5) {
      const deltas = pairs.map(p => p.after - p.before)
      const meanDelta = mean(deltas)
      // Bootstrap 95% CI for the mean delta
      const B = 10000
      const bootMeans = new Array(B)
      for (let b = 0; b < B; b++) {
        let s = 0
        for (let i = 0; i < deltas.length; i++) s += deltas[Math.floor(Math.random() * deltas.length)]
        bootMeans[b] = s / deltas.length
      }
      bootMeans.sort((a, b) => a - b)
      const ciLow = bootMeans[Math.floor(B * 0.025)]
      const ciHigh = bootMeans[Math.floor(B * 0.975)]
      // Wilcoxon signed-rank (one-sample sign of deltas)
      const pValue = wilcoxonSignedRankP(deltas)
      const regressed = pairs.filter(p => p.after - p.before < -0.05).map(p => p.order_id)
      diffOutput = {
        previous: args.diff, n_paired: pairs.length,
        mean_delta_iou: round4(meanDelta),
        ci95: [round4(ciLow), round4(ciHigh)],
        wilcoxon_p: round4(pValue),
        regressed_orders: regressed,
        significant: pValue < 0.05 && ciLow > 0,
      }
    }
  }
}
function parseCsvSimple(text) {
  const lines = text.split('\n').filter(Boolean)
  if (lines.length === 0) return []
  const headers = lines[0].split(',')
  return lines.slice(1).map(line => {
    const parts = line.split(',')
    const obj = {}
    headers.forEach((h, i) => obj[h] = parts[i])
    return obj
  })
}
function wilcoxonSignedRankP(deltas) {
  // Tied/zero handling: drop zeros, sign by sign of delta, rank by absolute value
  const xs = deltas.filter(d => d !== 0).map(d => ({ abs: Math.abs(d), sign: Math.sign(d) }))
  if (xs.length < 5) return 1
  xs.sort((a, b) => a.abs - b.abs)
  // Average ranks for ties
  for (let i = 0; i < xs.length; ) {
    let j = i
    while (j < xs.length && xs[j].abs === xs[i].abs) j++
    const rank = (i + 1 + j) / 2
    for (let k = i; k < j; k++) xs[k].rank = rank
    i = j
  }
  let W = 0
  for (const x of xs) W += x.rank * x.sign
  // Approximate normality (n>=10): z = W / sqrt(n(n+1)(2n+1)/6)
  const n = xs.length
  const sigma = Math.sqrt(n * (n + 1) * (2 * n + 1) / 6)
  const z = W / sigma
  // Two-tailed p-value via standard normal CDF approximation
  const phi = (x) => 0.5 * (1 + erf(x / Math.SQRT2))
  const erf = (x) => {
    // Abramowitz & Stegun 7.1.26
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911
    const sign = x < 0 ? -1 : 1
    x = Math.abs(x)
    const t = 1 / (1 + p * x)
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)
    return sign * y
  }
  return 2 * (1 - phi(Math.abs(z)))
}

// ── Write CSV + JSON ─────────────────────────────────────────
const csvHeader = 'order_id,run_idx,edge,sqft_bucket,seg_bucket,source,iou,boundary_iou,signed_area_diff_pct,agent_confidence,agent_segment_count,stored_segment_count,elapsed_ms,ok,error_code,retries_used,timestamp_utc'
const csvRows = rows.map(r => [
  r.order_id, r.run_idx, r.edge, r.sqft_bucket || '', r.seg_bucket || '', r.source || '',
  r.iou ?? '', r.boundary_iou ?? '', r.signed_area_diff_pct ?? '',
  r.agent_confidence ?? '', r.agent_segment_count ?? '', r.stored_segment_count ?? '',
  r.elapsed_ms ?? '', r.ok ? '1' : '0', r.error_code || '', r.retries_used ?? 0, r.timestamp_utc || '',
].join(','))
writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'))
writeFileSync(jsonPath, JSON.stringify({ ...summary, diff: diffOutput }, null, 2))

// Clean partial file on success
try {
  const fs = await import('node:fs/promises')
  await fs.unlink(partialPath).catch(() => {})
} catch {}

// ── Console summary ──────────────────────────────────────────
console.log()
console.log(`[harness] ${args.pool} ${ts} — ${args.edge}, K=${args.k}, took ${summary.elapsed_seconds}s`)
console.log(`  candidates:    ${summary.candidates_total} | runs: ${summary.runs_ok} ok, ${summary.runs_fail} fail`)
console.log(`  IoU (n=${okCount}):  mean=${summary.iou.mean ?? '—'}  median=${summary.iou.median ?? '—'}  p25=${summary.iou.p25 ?? '—'}  p75=${summary.iou.p75 ?? '—'}`)
console.log(`  Boundary IoU:  mean=${summary.boundary_iou.mean ?? '—'}  median=${summary.boundary_iou.median ?? '—'}`)
console.log(`  Signed Δarea%: mean=${summary.signed_area_diff_pct.mean ?? '—'}  median=${summary.signed_area_diff_pct.median ?? '—'}  | ${summary.signed_area_diff_pct.over_trace_count} over-traced, ${summary.signed_area_diff_pct.under_trace_count} under-traced`)
console.log(`  by bucket:`)
for (const b of summary.by_bucket) {
  console.log(`    ${b.bucket.padEnd(10)} n=${b.n}  IoU median=${b.iou_median ?? '—'}  bIoU median=${b.biou_median ?? '—'}`)
}
console.log(`  by source:`)
for (const s of summary.by_source) {
  console.log(`    ${(s.source || 'null').padEnd(10)} n=${s.n}  IoU median=${s.iou_median ?? '—'}`)
}
if (diffOutput) {
  console.log()
  console.log(`[harness] DIFF vs ${diffOutput.previous} (paired n=${diffOutput.n_paired})`)
  console.log(`  mean ΔIoU:    ${diffOutput.mean_delta_iou >= 0 ? '+' : ''}${diffOutput.mean_delta_iou}  95% CI [${diffOutput.ci95[0]}, ${diffOutput.ci95[1]}]`)
  console.log(`  Wilcoxon p:   ${diffOutput.wilcoxon_p}  ${diffOutput.significant ? '← SIGNIFICANT IMPROVEMENT' : '(not significant)'}`)
  if (diffOutput.regressed_orders.length > 0) {
    console.log(`  regressed:    ${diffOutput.regressed_orders.join(', ')}`)
  }
}
console.log()
console.log(`[harness] wrote:  ${csvPath}`)
console.log(`[harness] wrote:  ${jsonPath}`)

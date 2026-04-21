// ============================================================
// NREL PVWatts V8 client.
//
// NREL's public REST endpoint runs an 8,760-hour (1-year hourly) simulation
// for a residential-scale PV system and returns annual + monthly kWh. We
// call it once per roof segment (so each segment uses its own pitch /
// azimuth) and sum the results for the whole-system figure.
//
// Rate limits:
//   - Unauth:  30 req / hr
//   - With NREL_API_KEY:  1000 req / hr
// We always try the API key first and fall back to the public key "DEMO_KEY"
// (rate-limited) for local dev. On any non-2xx the caller should treat the
// call as best-effort and fall back to the Liu-Jordan estimate already
// baked into solar-panel-layout.ts.
//
// Docs: https://developer.nrel.gov/docs/solar/pvwatts/v8/
// ============================================================

export interface PVWattsInput {
  lat: number
  lng: number
  system_capacity_kw: number   // DC capacity
  tilt_deg: number             // per-segment pitch
  azimuth_deg: number          // 180 = south (N. hemisphere)
  module_type?: 0 | 1 | 2      // 0=standard, 1=premium, 2=thin-film
  losses_pct?: number          // default 14 (NREL reference value)
  array_type?: 0 | 1 | 2 | 3 | 4 // 1=fixed roof mount (what we want)
  dataset?: 'nsrdb' | 'intl'   // NREL auto-picks; only override for edge cases
}

export interface PVWattsResult {
  annual_kwh: number
  monthly_kwh: number[]        // length 12 (Jan..Dec)
  capacity_factor: number      // 0..1
  solrad_annual?: number       // kWh/m²/day average
  source: 'pvwatts_v8'
  ran_at: string               // ISO timestamp
}

export interface PVWattsSegmentInput extends Omit<PVWattsInput, 'system_capacity_kw' | 'lat' | 'lng'> {
  segment_index: number
  system_capacity_kw: number
}

export interface PVWattsBatchResult {
  total_annual_kwh: number
  total_monthly_kwh: number[]  // length 12
  per_segment: Array<{ segment_index: number; annual_kwh: number; capacity_factor: number | null }>
  source: 'pvwatts_v8'
  ran_at: string
  failures: number             // count of segments that errored / fell back
}

const BASE_URL = 'https://developer.nrel.gov/api/pvwatts/v8.json'

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

// Build the query string. NREL rejects some degenerate inputs (e.g. tilt=0
// combined with array_type=1), so we normalize at the edge instead of
// surfacing 422s to the caller.
function buildQuery(env: { NREL_API_KEY?: string }, input: PVWattsInput): string {
  const params = new URLSearchParams()
  params.set('api_key', env.NREL_API_KEY || 'DEMO_KEY')
  params.set('lat', String(input.lat))
  params.set('lon', String(input.lng))
  // PVWatts requires 0.05–500,000 kW.
  params.set('system_capacity', String(clamp(input.system_capacity_kw, 0.05, 500000)))
  params.set('azimuth', String(((input.azimuth_deg % 360) + 360) % 360))
  params.set('tilt', String(clamp(input.tilt_deg, 0, 90)))
  params.set('array_type', String(input.array_type ?? 1))
  params.set('module_type', String(input.module_type ?? 1))
  params.set('losses', String(input.losses_pct ?? 14))
  if (input.dataset) params.set('dataset', input.dataset)
  params.set('timeframe', 'monthly')
  return params.toString()
}

// Run one NREL call. Throws on non-2xx so the caller can fall back.
export async function runPVWatts(
  env: { NREL_API_KEY?: string },
  input: PVWattsInput,
  fetchImpl: typeof fetch = fetch,
): Promise<PVWattsResult> {
  const qs = buildQuery(env, input)
  const res = await fetchImpl(`${BASE_URL}?${qs}`, { method: 'GET' })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`PVWatts ${res.status}: ${body.slice(0, 200)}`)
  }
  const data: any = await res.json()
  if (!data?.outputs) throw new Error('PVWatts: missing outputs')
  const annual = Number(data.outputs.ac_annual)
  const monthly: number[] = Array.isArray(data.outputs.ac_monthly)
    ? data.outputs.ac_monthly.map(Number)
    : []
  const capacity = Number(data.outputs.capacity_factor) / 100
  return {
    annual_kwh: Math.round(annual),
    monthly_kwh: monthly.map((n) => Math.round(n)),
    capacity_factor: isFinite(capacity) ? capacity : 0,
    solrad_annual: Number(data.outputs.solrad_annual) || undefined,
    source: 'pvwatts_v8',
    ran_at: new Date().toISOString(),
  }
}

// Run one NREL call per segment, in parallel. On any per-segment failure we
// record annual_kwh=0 for that segment and increment `failures`; the caller
// can decide whether to fall back to Liu-Jordan for the whole system.
export async function runPVWattsForSegments(
  env: { NREL_API_KEY?: string },
  site: { lat: number; lng: number },
  segments: PVWattsSegmentInput[],
  fetchImpl: typeof fetch = fetch,
): Promise<PVWattsBatchResult> {
  const ranAt = new Date().toISOString()
  const results = await Promise.allSettled(
    segments.map((s) =>
      runPVWatts(env, {
        lat: site.lat,
        lng: site.lng,
        system_capacity_kw: s.system_capacity_kw,
        tilt_deg: s.tilt_deg,
        azimuth_deg: s.azimuth_deg,
        module_type: s.module_type,
        losses_pct: s.losses_pct,
        array_type: s.array_type ?? 1,
      }, fetchImpl)
    )
  )

  const monthly = new Array(12).fill(0)
  let total = 0
  let failures = 0
  const perSeg: PVWattsBatchResult['per_segment'] = []

  results.forEach((r, i) => {
    const seg = segments[i]
    if (r.status === 'fulfilled') {
      total += r.value.annual_kwh
      for (let m = 0; m < 12 && m < r.value.monthly_kwh.length; m++) {
        monthly[m] += r.value.monthly_kwh[m]
      }
      perSeg.push({
        segment_index: seg.segment_index,
        annual_kwh: r.value.annual_kwh,
        capacity_factor: r.value.capacity_factor,
      })
    } else {
      failures++
      perSeg.push({ segment_index: seg.segment_index, annual_kwh: 0, capacity_factor: null })
    }
  })

  return {
    total_annual_kwh: Math.round(total),
    total_monthly_kwh: monthly.map((n) => Math.round(n)),
    per_segment: perSeg,
    source: 'pvwatts_v8',
    ran_at: ranAt,
    failures,
  }
}

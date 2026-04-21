import { describe, it, expect, vi } from 'vitest'
import { runPVWatts, runPVWattsForSegments } from './pvwatts'

function mockFetchOk(annual: number, monthly: number[] = new Array(12).fill(annual / 12)) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({
      outputs: {
        ac_annual: annual,
        ac_monthly: monthly,
        capacity_factor: 17.5,
        solrad_annual: 4.5,
      },
      errors: [],
      warnings: [],
    }),
  })) as any
}

describe('runPVWatts', () => {
  it('returns annual + monthly + capacity factor on 2xx', async () => {
    const fetchImpl = mockFetchOk(12000)
    const r = await runPVWatts({ NREL_API_KEY: 'x' }, {
      lat: 51.0447, lng: -114.0719, system_capacity_kw: 8.4, tilt_deg: 30, azimuth_deg: 180,
    }, fetchImpl)
    expect(r.annual_kwh).toBe(12000)
    expect(r.monthly_kwh).toHaveLength(12)
    expect(r.capacity_factor).toBeCloseTo(0.175, 3)
    expect(r.source).toBe('pvwatts_v8')
  })

  it('throws on non-2xx so caller can fall back', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false, status: 422, text: async () => 'bad tilt', json: async () => ({}),
    })) as any
    await expect(runPVWatts({}, {
      lat: 51, lng: -114, system_capacity_kw: 8, tilt_deg: 30, azimuth_deg: 180,
    }, fetchImpl)).rejects.toThrow(/422/)
  })

  it('clamps out-of-range tilt and uses DEMO_KEY when no api key', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true, status: 200, text: async () => '',
      json: async () => ({ outputs: { ac_annual: 1, ac_monthly: [1,1,1,1,1,1,1,1,1,1,1,1], capacity_factor: 0 } }),
    })) as any
    await runPVWatts({}, { lat: 51, lng: -114, system_capacity_kw: 8, tilt_deg: 200, azimuth_deg: 500 }, fetchImpl)
    const url = String(fetchImpl.mock.calls[0][0])
    expect(url).toContain('api_key=DEMO_KEY')
    expect(url).toContain('tilt=90')       // clamped
    expect(url).toContain('azimuth=140')   // 500 mod 360 = 140
  })
})

describe('runPVWattsForSegments', () => {
  it('sums annual + monthly across segments run in parallel', async () => {
    const fetchImpl = vi.fn(async (url: any) => {
      const u = String(url)
      const cap = Number(new URL(u).searchParams.get('system_capacity'))
      return {
        ok: true, status: 200, text: async () => '',
        json: async () => ({
          outputs: {
            ac_annual: cap * 1000,       // 1000 kWh per kW installed
            ac_monthly: new Array(12).fill(cap * 1000 / 12),
            capacity_factor: 11.4,
          },
        }),
      }
    }) as any

    const result = await runPVWattsForSegments(
      { NREL_API_KEY: 'x' },
      { lat: 51, lng: -114 },
      [
        { segment_index: 0, system_capacity_kw: 4, tilt_deg: 25, azimuth_deg: 180 },
        { segment_index: 1, system_capacity_kw: 3, tilt_deg: 35, azimuth_deg: 90  },
      ],
      fetchImpl,
    )

    expect(result.total_annual_kwh).toBe(7000)
    expect(result.total_monthly_kwh.reduce((s, n) => s + n, 0)).toBeCloseTo(7000, -1)
    expect(result.per_segment).toHaveLength(2)
    expect(result.failures).toBe(0)
  })

  it('records per-segment failures without throwing', async () => {
    const fetchImpl = vi.fn(async (url: any) => {
      const u = String(url)
      if (u.includes('azimuth=90')) {
        return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) }
      }
      return {
        ok: true, status: 200, text: async () => '',
        json: async () => ({ outputs: { ac_annual: 5000, ac_monthly: new Array(12).fill(416.67), capacity_factor: 15 } }),
      }
    }) as any

    const result = await runPVWattsForSegments(
      {}, { lat: 51, lng: -114 },
      [
        { segment_index: 0, system_capacity_kw: 4, tilt_deg: 25, azimuth_deg: 180 },
        { segment_index: 1, system_capacity_kw: 3, tilt_deg: 35, azimuth_deg: 90 },
      ],
      fetchImpl,
    )
    expect(result.failures).toBe(1)
    expect(result.total_annual_kwh).toBe(5000)
    expect(result.per_segment[1].annual_kwh).toBe(0)
  })
})

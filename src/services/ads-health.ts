// ============================================================
// ADS-HEALTH CHECK — 4-hourly sweep of every signal that could
// indicate Roof Manager's Google Ads + Meta Ads + organic social
// attribution stack is silently failing.
//
// Triggered by: /loop 4h /ads-health (POST /api/ads-health/tick)
// Or by cron-worker every 4 hours when scan_ads_health is enabled.
//
// Sections, in order of business impact:
//   1. secret_inventory          GA4 + Meta secrets present
//   2. gads_label_completeness   GADS_*_LABEL env vars set (not XXX_)
//   3. pixel_presence_html       /, /register, /pricing actually render the pixels
//   4. ga4_mp_health             GA4 Measurement Protocol /debug/collect probe
//   5. meta_capi_health          Meta CAPI test_event_code probe (Test Events tab)
//   6. capi_event_volume         meta_conversion_events status distribution last 24h
//   7. gclid_capture_rate        % of last-7d signups with gclid populated
//   8. utm_capture_rate          % of last-7d signups with lead_utm_source populated
//   9. attribution_table_freshness  analytics_attribution row recency
//  10. conversion_event_drift    today's CAPI events vs 7d trailing avg
//
// Each section returns { status: 'pass' | 'warn' | 'fail', details, summary }.
// The overall verdict is the worst section.
// ============================================================

import type { Bindings } from '../types'

const PROD_BASE = 'https://www.roofmanager.ca'

export type SectionStatus = 'pass' | 'warn' | 'fail'

export interface SectionResult {
  key: string
  label: string
  status: SectionStatus
  summary: string
  details: Record<string, any>
}

export interface AdsHealthResult {
  ok: boolean
  verdict: SectionStatus
  checked_at: string
  duration_ms: number
  sections: SectionResult[]
  issues: Array<{ section: string; severity: 'warn' | 'error'; message: string }>
}

export async function runAdsHealthCheck(env: Bindings): Promise<AdsHealthResult> {
  const t0 = Date.now()
  const checkedAt = new Date().toISOString()

  const sections = await Promise.all([
    section('secret_inventory', 'Required ad/analytics secrets present', () => checkSecretInventory(env)),
    section('gads_label_completeness', 'Google Ads conversion labels set', () => checkGadsLabels(env)),
    section('pixel_presence_html', 'GA4 / Google Ads / Meta pixels in page HTML', () => checkPixelPresenceHtml()),
    section('ga4_mp_health', 'GA4 Measurement Protocol /debug probe', () => checkGa4MpHealth(env)),
    section('meta_capi_health', 'Meta Conversions API test event', () => checkMetaCapiHealth(env)),
    section('capi_event_volume', 'meta_conversion_events status (last 24h)', () => checkCapiVolume(env)),
    section('gclid_capture_rate', 'Google Ads gclid capture on signup (last 7d)', () => checkGclidCapture(env)),
    section('utm_capture_rate', 'UTM capture on signup (last 7d)', () => checkUtmCapture(env)),
    section('attribution_table_freshness', 'analytics_attribution row recency', () => checkAttributionFreshness(env)),
    section('conversion_event_drift', 'CAPI events today vs 7d trailing avg', () => checkConversionDrift(env)),
  ])

  const verdict: SectionStatus =
    sections.some(s => s.status === 'fail') ? 'fail' :
    sections.some(s => s.status === 'warn') ? 'warn' : 'pass'

  const issues = sections.flatMap(s => {
    if (s.status === 'pass') return []
    return [{
      section: s.key,
      severity: (s.status === 'fail' ? 'error' : 'warn') as 'error' | 'warn',
      message: `${s.label}: ${s.summary}`,
    }]
  })

  return {
    ok: verdict === 'pass',
    verdict,
    checked_at: checkedAt,
    duration_ms: Date.now() - t0,
    sections,
    issues,
  }
}

async function section(
  key: string,
  label: string,
  fn: () => Promise<Omit<SectionResult, 'key' | 'label'>>,
): Promise<SectionResult> {
  try {
    const r = await fn()
    return { key, label, ...r }
  } catch (e: any) {
    return {
      key, label,
      status: 'fail',
      summary: `check threw: ${String(e?.message || e).slice(0, 240)}`,
      details: { error: String(e?.message || e), stack: String(e?.stack || '').slice(0, 600) },
    }
  }
}

// ── 1. Secret inventory ─────────────────────────────────────────
async function checkSecretInventory(env: Bindings): Promise<Omit<SectionResult, 'key' | 'label'>> {
  const required: Array<{ name: string; severity: 'fail' | 'warn'; reason: string }> = [
    { name: 'GA4_MEASUREMENT_ID', severity: 'fail', reason: 'GA4 client-side tracking dead' },
    { name: 'GA4_API_SECRET', severity: 'warn', reason: 'GA4 server-side Measurement Protocol disabled' },
    { name: 'META_PIXEL_ID', severity: 'fail', reason: 'Meta Pixel script never loads' },
    { name: 'META_CAPI_ACCESS_TOKEN', severity: 'warn', reason: 'Meta CAPI server-side conversions silently fail' },
  ]
  const missing: string[] = []
  let worst: SectionStatus = 'pass'
  const detail: Record<string, string> = {}
  for (const r of required) {
    const v = (env as any)[r.name]
    if (!v || String(v).trim() === '') {
      missing.push(r.name)
      detail[r.name] = `MISSING — ${r.reason}`
      if (r.severity === 'fail') worst = 'fail'
      else if (worst !== 'fail') worst = 'warn'
    } else {
      detail[r.name] = 'set'
    }
  }
  return {
    status: worst,
    summary: missing.length === 0 ? 'all 4 set' : `${missing.length} missing: ${missing.join(', ')}`,
    details: detail,
  }
}

// ── 2. Google Ads conversion labels ─────────────────────────────
async function checkGadsLabels(env: Bindings): Promise<Omit<SectionResult, 'key' | 'label'>> {
  const labels = ['GADS_LEAD_LABEL', 'GADS_CONTACT_LABEL', 'GADS_DEMO_LABEL', 'GADS_PURCHASE_LABEL']
  const missing: string[] = []
  const detail: Record<string, string> = {}
  for (const l of labels) {
    const v = (env as any)[l]
    if (!v || String(v).trim() === '' || String(v).startsWith('XXX_')) {
      missing.push(l)
      detail[l] = 'placeholder/missing'
    } else {
      detail[l] = 'set'
    }
  }
  return {
    status: missing.length > 0 ? 'warn' : 'pass',
    summary: missing.length === 0
      ? 'all 4 conversion labels configured'
      : `${missing.length}/4 still placeholder — Smart Bidding can't optimize for: ${missing.map(m => m.replace('GADS_','').replace('_LABEL','').toLowerCase()).join(', ')}`,
    details: detail,
  }
}

// ── 3. Pixel presence in live HTML ──────────────────────────────
async function checkPixelPresenceHtml(): Promise<Omit<SectionResult, 'key' | 'label'>> {
  const pages = ['/', '/register', '/pricing']
  const findings: Record<string, any> = {}
  const issues: string[] = []
  for (const p of pages) {
    try {
      const res = await fetch(`${PROD_BASE}${p}`, {
        method: 'GET',
        headers: { 'User-Agent': 'RoofManagerAdsHealth/1.0' },
        signal: AbortSignal.timeout(15000),
      })
      const html = await res.text()
      const ga4 = /gtag\(\s*['"]config['"]\s*,\s*['"](G-[A-Z0-9]+)['"]/.exec(html)?.[1] || null
      const aw = /AW-(\d+)/.exec(html)?.[1] || null
      const fbq = /fbq\(\s*['"]init['"]\s*,\s*['"](\d+)['"]/.exec(html)?.[1] || null
      findings[p] = { status: res.status, ga4, aw, fbq }
      if (res.status !== 200) issues.push(`${p}: HTTP ${res.status}`)
      else {
        if (!ga4) issues.push(`${p}: GA4 missing`)
        if (!aw) issues.push(`${p}: Google Ads (AW-) missing`)
        if (!fbq) issues.push(`${p}: Meta pixel missing`)
      }
    } catch (e: any) {
      findings[p] = { error: String(e?.message || e).slice(0, 120) }
      issues.push(`${p}: fetch threw`)
    }
  }
  return {
    status: issues.length === 0 ? 'pass' : 'fail',
    summary: issues.length === 0 ? 'all pixels render on /, /register, /pricing' : issues.join(' · '),
    details: findings,
  }
}

// ── 4. GA4 Measurement Protocol /debug probe ────────────────────
async function checkGa4MpHealth(env: Bindings): Promise<Omit<SectionResult, 'key' | 'label'>> {
  const mid = (env as any).GA4_MEASUREMENT_ID
  const secret = (env as any).GA4_API_SECRET
  if (!mid || !secret) {
    return { status: 'warn', summary: 'GA4_MEASUREMENT_ID or GA4_API_SECRET unset — probe skipped', details: { skipped: true } }
  }
  const url = `https://www.google-analytics.com/debug/mp/collect?measurement_id=${encodeURIComponent(mid)}&api_secret=${encodeURIComponent(secret)}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: `ads-health-probe-${Date.now()}`,
        events: [{ name: 'health_probe', params: { event_source: 'ads_health' } }],
      }),
      signal: AbortSignal.timeout(10000),
    })
    if (res.status !== 200) {
      return { status: 'fail', summary: `GA4 /debug returned HTTP ${res.status}`, details: { http_status: res.status } }
    }
    const body: any = await res.json().catch(() => ({}))
    const msgs: any[] = Array.isArray(body?.validationMessages) ? body.validationMessages : []
    if (msgs.length > 0) {
      return {
        status: 'fail',
        summary: `${msgs.length} GA4 validation issue(s): ${msgs.slice(0, 2).map(m => m?.description || m?.fieldPath).join(' / ').slice(0, 200)}`,
        details: { validation_messages: msgs.slice(0, 5) },
      }
    }
    return { status: 'pass', summary: 'GA4 MP debug returned 200 with zero validation messages', details: { http_status: 200 } }
  } catch (e: any) {
    return { status: 'fail', summary: `GA4 MP probe threw: ${String(e?.message || e).slice(0, 200)}`, details: { error: String(e?.message || e) } }
  }
}

// ── 5. Meta CAPI test event ─────────────────────────────────────
async function checkMetaCapiHealth(env: Bindings): Promise<Omit<SectionResult, 'key' | 'label'>> {
  const pixelId = (env as any).META_PIXEL_ID
  const accessToken = (env as any).META_CAPI_ACCESS_TOKEN
  if (!pixelId || !accessToken) {
    const missing = [!pixelId && 'META_PIXEL_ID', !accessToken && 'META_CAPI_ACCESS_TOKEN'].filter(Boolean).join(', ')
    return {
      status: 'warn',
      summary: `${missing} unset — server-side Meta conversions silently fail. Set in Pages secrets to enable.`,
      details: { skipped: true, missing },
    }
  }
  const testCode = `ahprobe_${Date.now()}`
  const payload = {
    data: [{
      event_name: 'TestEvent',
      event_time: Math.floor(Date.now() / 1000),
      event_id: `health_${testCode}`,
      action_source: 'website',
      event_source_url: PROD_BASE,
      user_data: {},
      custom_data: { test: true },
    }],
    test_event_code: testCode,
    access_token: accessToken,
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${pixelId}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    })
    const body: any = await res.json().catch(() => ({}))
    if (res.status !== 200) {
      return {
        status: 'fail',
        summary: `Meta CAPI returned HTTP ${res.status}: ${(body?.error?.message || '').slice(0, 200)}`,
        details: { http_status: res.status, response: body },
      }
    }
    if (!body?.events_received || body.events_received < 1) {
      return {
        status: 'fail',
        summary: `Meta CAPI accepted but events_received=${body?.events_received ?? 0}`,
        details: { response: body },
      }
    }
    return {
      status: 'pass',
      summary: `Meta CAPI healthy · events_received=${body.events_received} · trace=${body.fbtrace_id || 'n/a'}`,
      details: { events_received: body.events_received, fbtrace_id: body.fbtrace_id, test_event_code: testCode },
    }
  } catch (e: any) {
    return { status: 'fail', summary: `Meta CAPI probe threw: ${String(e?.message || e).slice(0, 200)}`, details: { error: String(e?.message || e) } }
  }
}

// ── 6. CAPI event volume + status mix (last 24h) ────────────────
async function checkCapiVolume(env: Bindings): Promise<Omit<SectionResult, 'key' | 'label'>> {
  const rows = await env.DB.prepare(
    `SELECT status, COUNT(*) AS n FROM meta_conversion_events WHERE created_at >= datetime('now','-1 day') GROUP BY status`
  ).all<{ status: string; n: number }>()
  const counts: Record<string, number> = { sent: 0, failed: 0, skipped: 0 }
  for (const r of rows.results || []) counts[r.status] = (counts[r.status] || 0) + r.n
  const total = counts.sent + counts.failed + counts.skipped
  if (total === 0) {
    return { status: 'warn', summary: 'no Meta CAPI calls in last 24h — either no conversions or integration paused', details: counts }
  }
  if (counts.skipped === total) {
    return { status: 'warn', summary: `100% of CAPI calls skipped (${total}/${total}) — META_CAPI_ACCESS_TOKEN almost certainly unset`, details: counts }
  }
  if (counts.failed > 0 && counts.failed >= total / 2) {
    return { status: 'fail', summary: `${counts.failed}/${total} CAPI calls failed (${Math.round(100 * counts.failed / total)}%)`, details: counts }
  }
  if (counts.failed > 0) {
    return { status: 'warn', summary: `${counts.sent} sent · ${counts.failed} failed · ${counts.skipped} skipped (24h)`, details: counts }
  }
  return { status: 'pass', summary: `${counts.sent} sent · 0 failed · ${counts.skipped} skipped (24h)`, details: counts }
}

// ── 7. gclid capture on signup ──────────────────────────────────
async function checkGclidCapture(env: Bindings): Promise<Omit<SectionResult, 'key' | 'label'>> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN gclid IS NOT NULL AND gclid != '' THEN 1 ELSE 0 END) AS with_gclid
     FROM customers WHERE created_at >= datetime('now','-7 days')`
  ).first<{ total: number; with_gclid: number }>()
  const total = r?.total || 0
  const withG = r?.with_gclid || 0
  if (total === 0) {
    return { status: 'pass', summary: 'no signups in last 7d — no gclid capture to measure', details: { total, with_gclid: 0 } }
  }
  const pct = Math.round(100 * withG / total)
  if (withG === 0) {
    return { status: 'warn', summary: `0/${total} signups have gclid — Google Ads attribution chain likely broken`, details: { total, with_gclid: 0, pct: 0 } }
  }
  return { status: 'pass', summary: `${withG}/${total} signups have gclid (${pct}%)`, details: { total, with_gclid: withG, pct } }
}

// ── 8. UTM capture on signup ────────────────────────────────────
async function checkUtmCapture(env: Bindings): Promise<Omit<SectionResult, 'key' | 'label'>> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN lead_utm_source IS NOT NULL AND lead_utm_source != '' THEN 1 ELSE 0 END) AS with_utm
     FROM customers WHERE created_at >= datetime('now','-7 days')`
  ).first<{ total: number; with_utm: number }>()
  const total = r?.total || 0
  const withU = r?.with_utm || 0
  if (total === 0) {
    return { status: 'pass', summary: 'no signups in last 7d — no UTM capture to measure', details: { total, with_utm: 0 } }
  }
  const pct = Math.round(100 * withU / total)
  if (withU === 0) {
    return { status: 'warn', summary: `0/${total} signups have lead_utm_source — UTM transmission chain likely broken`, details: { total, with_utm: 0, pct: 0 } }
  }
  return { status: 'pass', summary: `${withU}/${total} signups have lead_utm_source (${pct}%)`, details: { total, with_utm: withU, pct } }
}

// ── 9. Attribution table freshness ──────────────────────────────
async function checkAttributionFreshness(env: Bindings): Promise<Omit<SectionResult, 'key' | 'label'>> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS total_24h FROM analytics_attribution
     WHERE first_touch_at >= datetime('now','-1 day') OR last_touch_at >= datetime('now','-1 day')`
  ).first<{ total_24h: number }>().catch(() => null)
  // If query throws (table missing or column rename), surface as fail rather than swallow.
  if (!r) {
    return { status: 'warn', summary: 'analytics_attribution unavailable (schema drift?)', details: {} }
  }
  const n = r.total_24h || 0
  if (n === 0) {
    return { status: 'warn', summary: 'no attribution rows touched in last 24h — pageview tracker may be dead', details: { total_24h: 0 } }
  }
  return { status: 'pass', summary: `${n} attribution rows updated in last 24h`, details: { total_24h: n } }
}

// ── 10. Conversion event drift ──────────────────────────────────
async function checkConversionDrift(env: Bindings): Promise<Omit<SectionResult, 'key' | 'label'>> {
  const today = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM meta_conversion_events WHERE created_at >= datetime('now','-1 day') AND status='sent'`
  ).first<{ n: number }>()
  const week = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM meta_conversion_events WHERE created_at >= datetime('now','-7 days') AND created_at < datetime('now','-1 day') AND status='sent'`
  ).first<{ n: number }>()
  const t = today?.n || 0
  const baseline = (week?.n || 0) / 6 // 6-day average (excluding today)
  if (baseline < 1) {
    return { status: 'pass', summary: `today=${t} · 6-day baseline ${baseline.toFixed(1)} (insufficient history for drift detection)`, details: { today: t, baseline_6d: baseline } }
  }
  const dropPct = Math.round(100 * (1 - t / baseline))
  if (dropPct >= 50) {
    return { status: 'warn', summary: `today's CAPI events ${t} vs 6-day avg ${baseline.toFixed(1)} (${dropPct}% drop)`, details: { today: t, baseline_6d: baseline, drop_pct: dropPct } }
  }
  return { status: 'pass', summary: `today=${t} · baseline ${baseline.toFixed(1)} (drift ${dropPct}% — within range)`, details: { today: t, baseline_6d: baseline, drop_pct: dropPct } }
}

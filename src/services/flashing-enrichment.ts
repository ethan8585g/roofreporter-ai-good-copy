// ============================================================
// Flashing enrichment — runs vision (if needed), derives flashing
// counts from findings, appends BOM line items at per-user prices.
// ============================================================
//
// Called once per report from the generate orchestrator, just before
// the HTML render. Never throws — vision failures degrade silently
// to zero counts so report generation is never blocked.

import type { RoofReport, VisionFinding, VisionFindings, MaterialLineItem } from '../types'
import { visionScan } from './vision-analyzer'
import { resolveTeamOwner } from '../routes/team'

const PIPE_BOOT_TYPES = new Set([
  'pipe_boot', 'pipe_vent', 'plumbing_vent', 'vent_stack', 'pipe_stack', 'plumbing_stack', 'roof_vent'
])

interface FlashingPrices {
  step_flashing_lf?: number
  headwall_flashing_lf?: number
  chimney_flashing_kit?: number
  pipe_boot_each?: number
}

interface EnrichOpts {
  imageUrl?: string | null
  customerId?: number | null
  vertexApiKey?: string
  gcpProject?: string
  gcpLocation?: string
  serviceAccountKey?: string
  visionTimeoutMs?: number
}

/** Tally chimney + pipe-boot counts from a vision findings payload. */
export function deriveFlashingCounts(findings: VisionFinding[] = []): {
  chimney_flashing_count: number
  pipe_boot_count: number
} {
  let chimney = 0
  let pipe = 0
  for (const f of findings) {
    const t = String(f.type || '').toLowerCase()
    if (t === 'chimney' || t.endsWith('_chimney') || t.startsWith('chimney_')) chimney += 1
    else if (PIPE_BOOT_TYPES.has(t)) pipe += 1
  }
  return { chimney_flashing_count: chimney, pipe_boot_count: pipe }
}

/** Pull this contractor's per-team flashing prices, falling back to platform defaults. */
export async function loadFlashingPrices(db: any, customerId: number | null | undefined): Promise<FlashingPrices> {
  const fallback: FlashingPrices = {
    step_flashing_lf: 0.85,
    headwall_flashing_lf: 1.40,
    chimney_flashing_kit: 65,
    pipe_boot_each: 12,
  }
  if (!db || !customerId) return fallback
  try {
    const { ownerId } = await resolveTeamOwner(db, customerId)
    const row = await db.prepare(
      'SELECT material_preferences FROM customer_material_preferences WHERE customer_id = ?'
    ).bind(ownerId).first<any>()
    if (!row?.material_preferences) return fallback
    const prefs = JSON.parse(row.material_preferences)
    const mup = prefs?.proposal_pricing?.material_unit_prices || {}
    return {
      step_flashing_lf:     numOr(mup.step_flashing_lf,     fallback.step_flashing_lf!),
      headwall_flashing_lf: numOr(mup.headwall_flashing_lf, fallback.headwall_flashing_lf!),
      chimney_flashing_kit: numOr(mup.chimney_flashing_kit, fallback.chimney_flashing_kit!),
      pipe_boot_each:       numOr(mup.pipe_boot_each,       fallback.pipe_boot_each!),
    }
  } catch {
    return fallback
  }
}

function numOr(v: any, d: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : d
}

/** Append chimney-kit + pipe-boot line items to materials.line_items
 *  (only the categories that have a non-zero count). Recomputes
 *  total_material_cost_cad. Idempotent: skips categories already
 *  present so re-running this on a partially-built report is safe. */
export function appendFlashingBom(
  materials: any,
  counts: { chimney_flashing_count?: number; pipe_boot_count?: number },
  prices: FlashingPrices,
): void {
  if (!materials || !Array.isArray(materials.line_items)) return
  const items: MaterialLineItem[] = materials.line_items
  const have = new Set(items.map(i => i.category))

  const chimney = Math.max(0, Math.floor(counts.chimney_flashing_count || 0))
  if (chimney > 0 && !have.has('chimney_flashing')) {
    const unit = prices.chimney_flashing_kit ?? 65
    items.push({
      category: 'chimney_flashing',
      description: 'Chimney Flashing Kit (apron + step + counter)',
      unit: 'kits',
      net_quantity: chimney,
      waste_pct: 0,
      gross_quantity: chimney,
      order_quantity: chimney,
      order_unit: 'kits',
      unit_price_cad: unit,
      line_total_cad: Math.round(chimney * unit * 100) / 100,
    })
  }

  const pipe = Math.max(0, Math.floor(counts.pipe_boot_count || 0))
  if (pipe > 0 && !have.has('pipe_boot')) {
    const unit = prices.pipe_boot_each ?? 12
    items.push({
      category: 'pipe_boot',
      description: 'Pipe Boot Flashing (lead/EPDM)',
      unit: 'each',
      net_quantity: pipe,
      waste_pct: 0,
      gross_quantity: pipe,
      order_quantity: pipe,
      order_unit: 'each',
      unit_price_cad: unit,
      line_total_cad: Math.round(pipe * unit * 100) / 100,
    })
  }

  materials.total_material_cost_cad = Math.round(
    items.reduce((s, it) => s + (it.line_total_cad || 0), 0) * 100
  ) / 100
}

/** End-to-end: ensure the report has vision_findings (running visionScan
 *  if missing), derive flashing counts onto edge_summary, and append
 *  matching BOM lines using per-team prices. Never throws. */
export async function enrichReportWithFlashing(
  reportData: RoofReport,
  db: any,
  opts: EnrichOpts,
): Promise<void> {
  try {
    let findings: VisionFinding[] | undefined = reportData.vision_findings?.findings

    // Run vision if we don't already have findings AND we have what we need.
    const needVision = !findings || findings.length === 0
    const haveCreds = !!(opts.vertexApiKey || opts.serviceAccountKey)
    if (needVision && opts.imageUrl && haveCreds) {
      const timeoutMs = Math.max(2000, Math.min(opts.visionTimeoutMs ?? 12000, 30000))
      try {
        const vf: VisionFindings = await visionScan(
          opts.imageUrl,
          {
            apiKey: opts.vertexApiKey,
            project: opts.gcpProject,
            location: opts.gcpLocation || 'us-central1',
            serviceAccountKey: opts.serviceAccountKey,
          },
          { model: 'gemini-2.0-flash', timeoutMs, sourceType: 'satellite_overhead' },
        )
        if (vf?.findings?.length) {
          reportData.vision_findings = vf
          findings = vf.findings
        }
      } catch (e: any) {
        // Vision failed — counts stay 0, report still renders. Log and move on.
        console.warn(`[FlashingEnrichment] visionScan failed: ${e?.message || e}`)
      }
    }

    const derived = deriveFlashingCounts(findings || [])

    // Wire counts into edge_summary, but never overwrite human/trace input.
    const es: any = reportData.edge_summary || (reportData.edge_summary = {} as any)
    if (!(es.chimney_flashing_count > 0)) es.chimney_flashing_count = derived.chimney_flashing_count
    if (!(es.pipe_boot_count > 0))        es.pipe_boot_count = derived.pipe_boot_count

    // Per-team prices, then append BOM lines.
    const prices = await loadFlashingPrices(db, opts.customerId ?? null)
    if (reportData.materials) {
      appendFlashingBom(
        reportData.materials,
        { chimney_flashing_count: es.chimney_flashing_count, pipe_boot_count: es.pipe_boot_count },
        prices,
      )
    }
  } catch (e: any) {
    console.warn(`[FlashingEnrichment] enrichment failed: ${e?.message || e}`)
  }
}

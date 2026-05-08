// ============================================================
// Gutter enrichment — derives gutter LF from the eaves the report
// already measured, then appends one BOM line at the contractor's
// per-team gutter price. Downspout count comes from manual tracing
// only (annotations.downspouts placed on the super-admin trace map).
// ============================================================
//
// Synchronous compute, no vision needed: gutter LF ≈ eave LF.
// Downspouts are NOT auto-derived — admins must place each one on
// the trace so the count reflects what's actually on the building.

import type { RoofReport, MaterialLineItem } from '../types'
import { resolveTeamOwner } from '../routes/team'

interface GutterPrices {
  gutter_lf?: number
}

interface EnrichGutterOpts {
  customerId?: number | null
}

/** Gutter LF = total eave LF (downspout count is sourced separately from
 *  manually-placed `annotations.downspouts` points on the trace). */
export function deriveGutterMeasurements(edgeSummary: any | null | undefined): {
  gutter_lf: number
} {
  const eaveLf = Math.max(0, Number(edgeSummary?.total_eave_ft) || 0)
  const gutterLf = Math.round(eaveLf)
  return { gutter_lf: gutterLf }
}

/** Pull this contractor's per-team gutter price, falling back to platform default. */
export async function loadGutterPrices(db: any, customerId: number | null | undefined): Promise<GutterPrices> {
  const fallback: GutterPrices = { gutter_lf: 4.50 }
  if (!db || !customerId) return fallback
  try {
    const { ownerId } = await resolveTeamOwner(db, customerId)
    const row = await db.prepare(
      'SELECT material_preferences FROM customer_material_preferences WHERE customer_id = ?'
    ).bind(ownerId).first<any>()
    if (!row?.material_preferences) return fallback
    const prefs = JSON.parse(row.material_preferences)
    const mup = prefs?.proposal_pricing?.material_unit_prices || {}
    return { gutter_lf: numOr(mup.gutter_lf, fallback.gutter_lf!) }
  } catch {
    return fallback
  }
}

function numOr(v: any, d: number): number {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : d
}

/** Append a single 'gutters' line item to materials.line_items, recompute total.
 *  Idempotent: skips if a 'gutters' category line is already present. */
export function appendGutterBom(
  materials: any,
  measurements: { gutter_lf: number },
  prices: GutterPrices,
): void {
  if (!materials || !Array.isArray(materials.line_items)) return
  const items: MaterialLineItem[] = materials.line_items
  if (items.some(i => i.category === 'gutters')) return
  const lf = Math.max(0, Math.floor(measurements.gutter_lf || 0))
  if (lf <= 0) return
  const unit = prices.gutter_lf ?? 4.50
  items.push({
    category: 'gutters',
    description: '5" K-style Aluminum Gutter',
    unit: 'linear_ft',
    net_quantity: lf,
    waste_pct: 5,
    gross_quantity: Math.ceil(lf * 1.05),
    order_quantity: Math.ceil(lf * 1.05),
    order_unit: 'linear_ft',
    unit_price_cad: unit,
    line_total_cad: Math.round(Math.ceil(lf * 1.05) * unit * 100) / 100,
  })
  materials.total_material_cost_cad = Math.round(
    items.reduce((s, it) => s + (it.line_total_cad || 0), 0) * 100
  ) / 100
}

/** End-to-end: derive gutter LF from edge_summary, count downspouts from
 *  manually-traced annotations, write to edge_summary (without overwriting
 *  trace input), append the gutter BOM line at this contractor's price.
 *  Never throws. */
export async function enrichReportWithGutters(
  reportData: RoofReport,
  db: any,
  opts: EnrichGutterOpts,
): Promise<void> {
  try {
    const es: any = reportData.edge_summary || (reportData.edge_summary = {} as any)
    const derived = deriveGutterMeasurements(es)

    if (!(es.gutter_lf > 0)) es.gutter_lf = derived.gutter_lf

    // Downspouts: manual placement only. Count = number of points dropped
    // on the super-admin trace map under annotations.downspouts. Zero when
    // none were placed — we never auto-derive from spacing heuristics.
    const tracedDownspouts =
      (reportData as any)?.roof_trace?.annotations?.downspouts?.length || 0
    es.downspout_count = tracedDownspouts

    const prices = await loadGutterPrices(db, opts.customerId ?? null)
    if (reportData.materials) {
      appendGutterBom(reportData.materials, { gutter_lf: es.gutter_lf || 0 }, prices)
    }
  } catch (e: any) {
    console.warn(`[GutterEnrichment] enrichment failed: ${e?.message || e}`)
  }
}

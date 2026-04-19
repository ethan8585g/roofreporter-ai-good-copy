// ============================================================
// Roof Manager — Material Estimation Engine v1.0
//
// Comprehensive Bill of Materials (BOM) calculator for roofing
// projects. Computes detailed material quantities with pricing.
//
// INPUT:  Measurement data (area, edges, pitch, waste factor)
// OUTPUT: DetailedMaterialBOM with line items + JSON export
//
// Standards: GAF/CertainTeed/IKO product specifications
// Coverage rates per industry standards (Canadian market)
// ============================================================

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface MaterialLineItem {
  category: 'shingles' | 'starter' | 'ridge_cap' | 'underlayment' | 'ice_water' | 'drip_edge' | 'flashing' | 'ventilation' | 'fasteners' | 'sealant' | 'accessory'
  name: string
  description: string
  quantity: number
  unit: string
  coverage_per_unit: string
  unit_cost_cad: number
  total_cost_cad: number
  notes?: string
}

export interface DetailedMaterialBOM {
  // Summary
  project_address: string
  generated_at: string
  engine_version: string

  // Selected shingle product
  shingle_product?: {
    type: ShingleType
    name: string
    warranty: string
    wind_rating_kmh: number
    weight_per_square_lbs: number
    fire_rating: string
    examples: string
  }

  // Input measurements
  input: {
    net_roof_area_sqft: number
    gross_roof_area_sqft: number
    waste_factor_pct: number
    net_squares: number
    gross_squares: number
    total_eave_lf: number
    total_ridge_lf: number
    total_hip_lf: number
    total_valley_lf: number
    total_rake_lf: number
    total_perimeter_lf: number
    predominant_pitch: string
    pitch_rise: number
    complexity: string
  }

  // Detailed line items
  line_items: MaterialLineItem[]

  // Aggregated totals
  totals: {
    shingle_bundles: number
    shingle_squares: number
    starter_strip_lf: number
    starter_strip_pcs: number
    ridge_cap_lf: number
    ridge_cap_bundles: number
    drip_edge_eave_pcs: number
    drip_edge_rake_pcs: number
    drip_edge_total_pcs: number
    ice_water_barrier_sqft: number
    ice_water_barrier_rolls: number
    underlayment_rolls: number
    valley_flashing_lf: number
    roofing_nails_lbs: number
    roofing_nails_boxes: number
    caulk_tubes: number
    pipe_boot_collars: number
    ventilation_sqft: number
  }

  // Cost summary
  cost_summary: {
    materials_subtotal_cad: number
    tax_estimate_cad: number
    materials_total_cad: number
    cost_per_square_cad: number
    cost_per_sqft_cad: number
  }

  // Export-ready JSON
  export_json: string
}

// ═══════════════════════════════════════════════════════════════
// SHINGLE PRODUCT CATALOG
// ═══════════════════════════════════════════════════════════════

export type ShingleType = '3tab' | 'architectural' | 'premium' | 'designer' | 'impact_resistant' | 'metal'

export interface ShingleProduct {
  key: ShingleType
  name: string
  description: string
  examples: string
  cost_per_bundle_cad: number
  bundles_per_square: number
  warranty: string
  wind_rating_kmh: number
  weight_per_square_lbs: number
  fire_rating: string
}

export const SHINGLE_PRODUCTS: Record<ShingleType, ShingleProduct> = {
  '3tab': {
    key: '3tab',
    name: '3-Tab Standard',
    description: 'Budget-friendly strip shingle with flat, uniform appearance. 25-year manufacturer warranty.',
    examples: 'IKO Marathon, GAF Royal Sovereign, CertainTeed XT 25',
    cost_per_bundle_cad: 32.00,
    bundles_per_square: 3,
    warranty: '25-year',
    wind_rating_kmh: 96,
    weight_per_square_lbs: 210,
    fire_rating: 'Class A',
  },
  architectural: {
    key: 'architectural',
    name: 'Architectural (Laminate)',
    description: 'Dimensional laminated shingle with shadow lines and enhanced wind resistance. Industry standard for residential re-roofs.',
    examples: 'IKO Cambridge, GAF Timberline HDZ, CertainTeed Landmark',
    cost_per_bundle_cad: 42.00,
    bundles_per_square: 3,
    warranty: '30-year',
    wind_rating_kmh: 210,
    weight_per_square_lbs: 250,
    fire_rating: 'Class A',
  },
  premium: {
    key: 'premium',
    name: 'Premium Architectural',
    description: 'Thicker profile with enhanced granule adhesion, algae resistance, and SBS-modified bitumen for superior flexibility.',
    examples: 'IKO Dynasty, GAF Timberline AS II, CertainTeed Landmark PRO',
    cost_per_bundle_cad: 55.00,
    bundles_per_square: 3,
    warranty: 'Limited Lifetime',
    wind_rating_kmh: 210,
    weight_per_square_lbs: 280,
    fire_rating: 'Class A',
  },
  designer: {
    key: 'designer',
    name: 'Designer / Luxury',
    description: 'Multi-layered premium shingle mimicking natural slate or cedar shake. Maximum curb appeal and longest warranty.',
    examples: 'GAF Camelot II, CertainTeed Grand Manor, Owens Corning Berkshire',
    cost_per_bundle_cad: 72.00,
    bundles_per_square: 3,
    warranty: 'Lifetime',
    wind_rating_kmh: 210,
    weight_per_square_lbs: 350,
    fire_rating: 'Class A',
  },
  impact_resistant: {
    key: 'impact_resistant',
    name: 'Impact-Resistant (Class 4)',
    description: 'UL 2218 Class 4 rated for hail resistance. SBS-modified for flexibility. May qualify for insurance discounts in hail-prone areas.',
    examples: 'IKO Nordic IR, GAF Armor Shield II, CertainTeed Landmark IR',
    cost_per_bundle_cad: 62.00,
    bundles_per_square: 3,
    warranty: 'Limited Lifetime',
    wind_rating_kmh: 210,
    weight_per_square_lbs: 290,
    fire_rating: 'Class A',
  },
  metal: {
    key: 'metal',
    name: 'Steel / Metal Shingles',
    description: 'Interlocking steel shingle panels with stone-coated or painted finish. Lightweight, fireproof, and extremely durable.',
    examples: 'EDCO Infiniti, Decra Shingle XD, Metal Roof Outlet',
    cost_per_bundle_cad: 95.00,
    bundles_per_square: 3,
    warranty: '50-year',
    wind_rating_kmh: 200,
    weight_per_square_lbs: 150,
    fire_rating: 'Class A',
  },
}

export const DEFAULT_SHINGLE_TYPE: ShingleType = 'architectural'

// ═══════════════════════════════════════════════════════════════
// MATERIAL CONSTANTS — Canadian Market Pricing (2026)
// ═══════════════════════════════════════════════════════════════

const SHINGLE_BUNDLES_PER_SQ = 3             // 3 bundles = 1 square (100 sqft)

// Starter Strip
const STARTER_STRIP_LF_PER_PC = 100          // 100 LF per starter strip roll/box
const STARTER_STRIP_COST_PER_PC_CAD = 45.00  // GAF ProStart or IKO Leading Edge

// Ridge Cap Shingles
const RIDGE_CAP_LF_PER_BUNDLE = 35           // 35 LF coverage per ridge cap bundle
const RIDGE_CAP_COST_PER_BUNDLE_CAD = 65.00  // GAF Seal-A-Ridge or IKO Hip & Ridge

// Drip Edge — 10ft pieces standard
const DRIP_EDGE_LF_PER_PC = 10
const DRIP_EDGE_EAVE_COST_CAD = 8.50         // Type C drip edge (eave)
const DRIP_EDGE_RAKE_COST_CAD = 9.50         // Type D drip edge (rake/gable)

// Ice & Water Barrier — 200 sqft rolls (2 squares)
const ICE_WATER_ROLL_SQFT = 200
const ICE_WATER_WIDTH_FT = 3.0               // 3ft overhang from eave
const ICE_WATER_VALLEY_WIDTH_FT = 3.0        // 3ft each side of valley
const ICE_WATER_COST_PER_ROLL_CAD = 165.00   // Grace Ice & Water Shield

// Underlayment — Synthetic (4 squares per roll = 400 sqft)
const UNDERLAY_SQFT_PER_ROLL = 400
const UNDERLAY_COST_PER_ROLL_CAD = 95.00     // Synthetic felt underlayment

// Valley Flashing — aluminum W-valley
const VALLEY_FLASH_LF_PER_PC = 10
const VALLEY_FLASH_COST_PER_PC_CAD = 22.00

// Roofing Nails — 5 lb box covers ~2 squares
const NAILS_LBS_PER_SQ = 2.5
const NAILS_LBS_PER_BOX = 5
const NAILS_COST_PER_BOX_CAD = 28.00

// Roofing Cement / Caulk
const CAULK_COST_PER_TUBE_CAD = 8.50
const CAULK_TUBES_PER_5SQ = 1               // ~1 tube per 5 squares

// Pipe Boot / Collar
const PIPE_BOOT_COST_CAD = 18.00
const PIPE_BOOTS_PER_1000SQFT = 2            // estimate ~2 per 1000 sqft

// Ventilation — ridge vent
const RIDGE_VENT_LF_PER_PC = 4
const RIDGE_VENT_COST_PER_PC_CAD = 22.00

// GST (Alberta)
const TAX_RATE = 0.05

// ═══════════════════════════════════════════════════════════════
// MAIN ESTIMATION FUNCTION
// ═══════════════════════════════════════════════════════════════

export interface MaterialEstimationInput {
  address?: string
  net_area_sqft: number
  waste_factor_pct?: number      // default 15
  total_eave_lf: number
  total_ridge_lf: number
  total_hip_lf: number
  total_valley_lf: number
  total_rake_lf: number
  pitch_rise?: number            // rise per 12" run, default 5
  complexity?: 'simple' | 'medium' | 'complex'
  include_ventilation?: boolean  // default true
  include_pipe_boots?: boolean   // default true
  shingle_type?: ShingleType     // default 'architectural'
  tax_rate?: number              // default 0.05 (5% GST Alberta)
}

export function estimateMaterials(input: MaterialEstimationInput): DetailedMaterialBOM {
  const wastePct = input.waste_factor_pct ?? 5
  const wasteFrac = wastePct / 100
  const netArea = input.net_area_sqft
  const grossArea = netArea * (1 + wasteFrac)
  const netSquares = netArea / 100
  const grossSquares = grossArea / 100
  const pitchRise = input.pitch_rise ?? 5
  const complexity = input.complexity || 'medium'
  const shingleType = input.shingle_type || DEFAULT_SHINGLE_TYPE
  const shingle = SHINGLE_PRODUCTS[shingleType] || SHINGLE_PRODUCTS.architectural
  const taxRate = input.tax_rate ?? TAX_RATE

  const eaveLF = input.total_eave_lf
  const ridgeLF = input.total_ridge_lf
  const hipLF = input.total_hip_lf
  const valleyLF = input.total_valley_lf
  const rakeLF = input.total_rake_lf
  const perimeterLF = eaveLF + rakeLF
  const ridgeHipLF = ridgeLF + hipLF

  const lineItems: MaterialLineItem[] = []

  // ── 1. SHINGLE BUNDLES ──
  const shingleBundles = Math.ceil(grossSquares * shingle.bundles_per_square)
  lineItems.push({
    category: 'shingles',
    name: `${shingle.name} Shingles`,
    description: `${shingleBundles} bundles @ ${shingle.bundles_per_square} bdl/sq for ${Math.ceil(grossSquares * 10) / 10} squares (incl. ${wastePct}% waste)`,
    quantity: shingleBundles,
    unit: 'bundles',
    coverage_per_unit: `33.3 sqft / bundle (${shingle.bundles_per_square} bundles = 1 square)`,
    unit_cost_cad: shingle.cost_per_bundle_cad,
    total_cost_cad: round2(shingleBundles * shingle.cost_per_bundle_cad),
    notes: `${shingle.examples} | ${shingle.warranty} warranty | Wind: ${shingle.wind_rating_kmh} km/h | ${shingle.fire_rating}`
  })

  // ── 2. STARTER STRIP ──
  const starterLF = eaveLF + rakeLF
  const starterPcs = Math.ceil(starterLF / STARTER_STRIP_LF_PER_PC)
  lineItems.push({
    category: 'starter',
    name: 'Starter Strip Shingles',
    description: `${Math.round(starterLF)} LF total (eave ${Math.round(eaveLF)} + rake ${Math.round(rakeLF)} LF)`,
    quantity: starterPcs,
    unit: 'boxes (100 LF each)',
    coverage_per_unit: '100 LF / box',
    unit_cost_cad: STARTER_STRIP_COST_PER_PC_CAD,
    total_cost_cad: round2(starterPcs * STARTER_STRIP_COST_PER_PC_CAD),
    notes: 'Applied along eave and rake edges before first course'
  })

  // ── 3. RIDGE CAP SHINGLES ──
  const ridgeCapLF = ridgeHipLF
  const ridgeCapBundles = Math.ceil(ridgeCapLF / RIDGE_CAP_LF_PER_BUNDLE)
  if (ridgeCapLF > 0) {
    lineItems.push({
      category: 'ridge_cap',
      name: 'Ridge Cap Shingles',
      description: `${Math.round(ridgeCapLF)} LF total (ridge ${Math.round(ridgeLF)} + hip ${Math.round(hipLF)} LF)`,
      quantity: ridgeCapBundles,
      unit: 'bundles',
      coverage_per_unit: `${RIDGE_CAP_LF_PER_BUNDLE} LF / bundle`,
      unit_cost_cad: RIDGE_CAP_COST_PER_BUNDLE_CAD,
      total_cost_cad: round2(ridgeCapBundles * RIDGE_CAP_COST_PER_BUNDLE_CAD),
      notes: 'Covers all ridge and hip lines'
    })
  }

  // ── 4. DRIP EDGE — EAVE ──
  const dripEdgeEavePcs = Math.ceil(eaveLF / DRIP_EDGE_LF_PER_PC)
  lineItems.push({
    category: 'drip_edge',
    name: 'Drip Edge — Eave (Type C)',
    description: `${Math.round(eaveLF)} LF eave perimeter`,
    quantity: dripEdgeEavePcs,
    unit: `pcs (${DRIP_EDGE_LF_PER_PC}' each)`,
    coverage_per_unit: `${DRIP_EDGE_LF_PER_PC} LF / piece`,
    unit_cost_cad: DRIP_EDGE_EAVE_COST_CAD,
    total_cost_cad: round2(dripEdgeEavePcs * DRIP_EDGE_EAVE_COST_CAD)
  })

  // ── 5. DRIP EDGE — RAKE ──
  const dripEdgeRakePcs = Math.ceil(rakeLF / DRIP_EDGE_LF_PER_PC)
  if (rakeLF > 0) {
    lineItems.push({
      category: 'drip_edge',
      name: 'Drip Edge — Rake/Gable (Type D)',
      description: `${Math.round(rakeLF)} LF rake perimeter`,
      quantity: dripEdgeRakePcs,
      unit: `pcs (${DRIP_EDGE_LF_PER_PC}' each)`,
      coverage_per_unit: `${DRIP_EDGE_LF_PER_PC} LF / piece`,
      unit_cost_cad: DRIP_EDGE_RAKE_COST_CAD,
      total_cost_cad: round2(dripEdgeRakePcs * DRIP_EDGE_RAKE_COST_CAD)
    })
  }

  // ── 6. ICE & WATER BARRIER ──
  // Required: 3ft overhang on all eaves + valley centers
  const iceWaterEaveSqft = eaveLF * ICE_WATER_WIDTH_FT
  const iceWaterValleySqft = valleyLF * ICE_WATER_VALLEY_WIDTH_FT * 2  // both sides
  const iceWaterTotalSqft = iceWaterEaveSqft + iceWaterValleySqft
  const iceWaterRolls = Math.ceil(iceWaterTotalSqft / ICE_WATER_ROLL_SQFT)
  lineItems.push({
    category: 'ice_water',
    name: 'Ice & Water Barrier (Self-Adhered)',
    description: `Eave: ${Math.round(iceWaterEaveSqft)} sqft (${Math.round(eaveLF)} LF × ${ICE_WATER_WIDTH_FT}ft)` +
      (iceWaterValleySqft > 0 ? ` + Valley: ${Math.round(iceWaterValleySqft)} sqft` : ''),
    quantity: iceWaterRolls,
    unit: 'rolls (200 sqft each)',
    coverage_per_unit: `${ICE_WATER_ROLL_SQFT} sqft / roll`,
    unit_cost_cad: ICE_WATER_COST_PER_ROLL_CAD,
    total_cost_cad: round2(iceWaterRolls * ICE_WATER_COST_PER_ROLL_CAD),
    notes: 'NBC/IRC required: minimum 36" up from eave in climate zones with freeze-thaw'
  })

  // ── 7. SYNTHETIC UNDERLAYMENT ──
  // Covers entire roof area minus ice & water zones
  const underlayArea = Math.max(0, grossArea - iceWaterTotalSqft)
  const underlayRolls = Math.ceil(underlayArea / UNDERLAY_SQFT_PER_ROLL)
  lineItems.push({
    category: 'underlayment',
    name: 'Synthetic Underlayment',
    description: `${Math.round(underlayArea)} sqft roof area (total ${Math.round(grossArea)} sqft less I&W zones)`,
    quantity: Math.max(1, underlayRolls),
    unit: 'rolls (400 sqft each)',
    coverage_per_unit: `${UNDERLAY_SQFT_PER_ROLL} sqft / roll`,
    unit_cost_cad: UNDERLAY_COST_PER_ROLL_CAD,
    total_cost_cad: round2(Math.max(1, underlayRolls) * UNDERLAY_COST_PER_ROLL_CAD),
    notes: 'Full deck coverage with minimum 4" horizontal and 6" vertical overlap'
  })

  // ── 8. VALLEY FLASHING ──
  if (valleyLF > 0) {
    const valleyFlashLF = Math.round(valleyLF * 1.10) // 10% overlap allowance
    const valleyFlashPcs = Math.ceil(valleyFlashLF / VALLEY_FLASH_LF_PER_PC)
    lineItems.push({
      category: 'flashing',
      name: 'Valley Flashing (W-Valley Aluminum)',
      description: `${Math.round(valleyLF)} LF valley length + 10% overlap`,
      quantity: valleyFlashPcs,
      unit: `pcs (${VALLEY_FLASH_LF_PER_PC}' each)`,
      coverage_per_unit: `${VALLEY_FLASH_LF_PER_PC} LF / piece`,
      unit_cost_cad: VALLEY_FLASH_COST_PER_PC_CAD,
      total_cost_cad: round2(valleyFlashPcs * VALLEY_FLASH_COST_PER_PC_CAD)
    })
  }

  // ── 9. ROOFING NAILS ──
  const nailsLbs = Math.ceil(grossSquares * NAILS_LBS_PER_SQ)
  const nailsBoxes = Math.ceil(nailsLbs / NAILS_LBS_PER_BOX)
  lineItems.push({
    category: 'fasteners',
    name: 'Roofing Nails (1-1/4" Galvanized)',
    description: `${nailsLbs} lbs for ${Math.ceil(grossSquares * 10) / 10} squares`,
    quantity: nailsBoxes,
    unit: `boxes (${NAILS_LBS_PER_BOX} lbs each)`,
    coverage_per_unit: `~2 squares / box`,
    unit_cost_cad: NAILS_COST_PER_BOX_CAD,
    total_cost_cad: round2(nailsBoxes * NAILS_COST_PER_BOX_CAD),
    notes: pitchRise >= 8 ? '6 nails/shingle required (high wind / steep slope)' : '4 nails/shingle standard'
  })

  // ── 10. ROOFING CEMENT / CAULK ──
  const caulkTubes = Math.max(2, Math.ceil(grossSquares / 5 * CAULK_TUBES_PER_5SQ))
  lineItems.push({
    category: 'sealant',
    name: 'Roofing Cement / Sealant',
    description: 'For flashings, vents, and penetration sealing',
    quantity: caulkTubes,
    unit: 'tubes',
    coverage_per_unit: '~5 squares / tube',
    unit_cost_cad: CAULK_COST_PER_TUBE_CAD,
    total_cost_cad: round2(caulkTubes * CAULK_COST_PER_TUBE_CAD)
  })

  // ── 11. PIPE BOOT COLLARS ──
  const pipeBoots = input.include_pipe_boots !== false
    ? Math.max(1, Math.ceil(netArea / 1000 * PIPE_BOOTS_PER_1000SQFT))
    : 0
  if (pipeBoots > 0) {
    lineItems.push({
      category: 'accessory',
      name: 'Pipe Boot / Collar',
      description: `Estimated ${pipeBoots} penetrations (plumbing vents, HVAC)`,
      quantity: pipeBoots,
      unit: 'pcs',
      coverage_per_unit: '1 per penetration',
      unit_cost_cad: PIPE_BOOT_COST_CAD,
      total_cost_cad: round2(pipeBoots * PIPE_BOOT_COST_CAD)
    })
  }

  // ── 12. RIDGE VENT (optional) ──
  if (input.include_ventilation !== false && ridgeLF > 0) {
    const ridgeVentPcs = Math.ceil(ridgeLF / RIDGE_VENT_LF_PER_PC)
    lineItems.push({
      category: 'ventilation',
      name: 'Ridge Vent',
      description: `${Math.round(ridgeLF)} LF ridge line`,
      quantity: ridgeVentPcs,
      unit: `pcs (${RIDGE_VENT_LF_PER_PC}' each)`,
      coverage_per_unit: `${RIDGE_VENT_LF_PER_PC} LF / piece`,
      unit_cost_cad: RIDGE_VENT_COST_PER_PC_CAD,
      total_cost_cad: round2(ridgeVentPcs * RIDGE_VENT_COST_PER_PC_CAD),
      notes: 'NBC minimum: 1 sqft NFA per 300 sqft attic area with vapour barrier'
    })
  }

  // ── COST SUMMARY ──
  const materialsSubtotal = lineItems.reduce((s, item) => s + item.total_cost_cad, 0)
  const taxEstimate = round2(materialsSubtotal * taxRate)
  const materialsTotal = round2(materialsSubtotal + taxEstimate)

  // ── TOTALS ──
  const valleyFlashLF = Math.round(valleyLF * 1.10)
  const totals = {
    shingle_bundles: shingleBundles,
    shingle_squares: Math.ceil(grossSquares * 10) / 10,
    starter_strip_lf: Math.round(starterLF),
    starter_strip_pcs: starterPcs,
    ridge_cap_lf: Math.round(ridgeCapLF),
    ridge_cap_bundles: ridgeCapBundles,
    drip_edge_eave_pcs: dripEdgeEavePcs,
    drip_edge_rake_pcs: dripEdgeRakePcs,
    drip_edge_total_pcs: dripEdgeEavePcs + dripEdgeRakePcs,
    ice_water_barrier_sqft: Math.round(iceWaterTotalSqft),
    ice_water_barrier_rolls: iceWaterRolls,
    underlayment_rolls: Math.max(1, underlayRolls),
    valley_flashing_lf: valleyFlashLF,
    roofing_nails_lbs: nailsLbs,
    roofing_nails_boxes: nailsBoxes,
    caulk_tubes: caulkTubes,
    pipe_boot_collars: pipeBoots,
    ventilation_sqft: input.include_ventilation !== false ? Math.round(ridgeLF * 1) : 0
  }

  const bom: DetailedMaterialBOM = {
    project_address: input.address || 'Unknown',
    generated_at: new Date().toISOString(),
    engine_version: 'MaterialEstimationEngine v2.0',
    shingle_product: {
      type: shingle.key,
      name: shingle.name,
      warranty: shingle.warranty,
      wind_rating_kmh: shingle.wind_rating_kmh,
      weight_per_square_lbs: shingle.weight_per_square_lbs,
      fire_rating: shingle.fire_rating,
      examples: shingle.examples,
    },
    input: {
      net_roof_area_sqft: Math.round(netArea),
      gross_roof_area_sqft: Math.round(grossArea),
      waste_factor_pct: wastePct,
      net_squares: Math.ceil(netSquares * 10) / 10,
      gross_squares: Math.ceil(grossSquares * 10) / 10,
      total_eave_lf: Math.round(eaveLF),
      total_ridge_lf: Math.round(ridgeLF),
      total_hip_lf: Math.round(hipLF),
      total_valley_lf: Math.round(valleyLF),
      total_rake_lf: Math.round(rakeLF),
      total_perimeter_lf: Math.round(perimeterLF),
      predominant_pitch: `${pitchRise}:12`,
      pitch_rise: pitchRise,
      complexity
    },
    line_items: lineItems,
    totals,
    cost_summary: {
      materials_subtotal_cad: round2(materialsSubtotal),
      tax_estimate_cad: taxEstimate,
      materials_total_cad: materialsTotal,
      cost_per_square_cad: round2(materialsTotal / Math.max(1, grossSquares)),
      cost_per_sqft_cad: round2(materialsTotal / Math.max(1, grossArea))
    },
    export_json: '' // populated below
  }

  // Generate export JSON
  bom.export_json = JSON.stringify({
    version: '1.0',
    project: bom.project_address,
    date: bom.generated_at,
    measurements: bom.input,
    materials: bom.totals,
    cost: bom.cost_summary,
    line_items: bom.line_items.map(li => ({
      name: li.name,
      category: li.category,
      qty: li.quantity,
      unit: li.unit,
      unit_cost: li.unit_cost_cad,
      total: li.total_cost_cad
    }))
  }, null, 2)

  return bom
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

// ═══════════════════════════════════════════════════════════════
// EXPORT FORMATTERS
// ═══════════════════════════════════════════════════════════════

/**
 * Generate Xactimate-compatible XML export
 */
export function generateXactimateXML(bom: DetailedMaterialBOM): string {
  const items = bom.line_items.map(li => `
    <Item>
      <Category>${escXml(li.category)}</Category>
      <Description>${escXml(li.name)}</Description>
      <Quantity>${li.quantity}</Quantity>
      <Unit>${escXml(li.unit)}</Unit>
      <UnitCost>${li.unit_cost_cad.toFixed(2)}</UnitCost>
      <TotalCost>${li.total_cost_cad.toFixed(2)}</TotalCost>
    </Item>`).join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<XactimateEstimate>
  <ProjectInfo>
    <Address>${escXml(bom.project_address)}</Address>
    <Date>${bom.generated_at}</Date>
    <RoofArea>${bom.input.net_roof_area_sqft}</RoofArea>
    <Squares>${bom.input.gross_squares}</Squares>
    <WasteFactor>${bom.input.waste_factor_pct}%</WasteFactor>
    <Pitch>${bom.input.predominant_pitch}</Pitch>
  </ProjectInfo>
  <Measurements>
    <EaveLF>${bom.input.total_eave_lf}</EaveLF>
    <RidgeLF>${bom.input.total_ridge_lf}</RidgeLF>
    <HipLF>${bom.input.total_hip_lf}</HipLF>
    <ValleyLF>${bom.input.total_valley_lf}</ValleyLF>
    <RakeLF>${bom.input.total_rake_lf}</RakeLF>
  </Measurements>
  <Materials>${items}
  </Materials>
  <CostSummary>
    <Subtotal>${bom.cost_summary.materials_subtotal_cad.toFixed(2)}</Subtotal>
    <Tax>${bom.cost_summary.tax_estimate_cad.toFixed(2)}</Tax>
    <Total>${bom.cost_summary.materials_total_cad.toFixed(2)}</Total>
  </CostSummary>
</XactimateEstimate>`
}

/**
 * Generate AccuLynx-compatible CSV export
 */
export function generateAccuLynxCSV(bom: DetailedMaterialBOM): string {
  const header = 'Category,Item,Quantity,Unit,Unit Cost (CAD),Total Cost (CAD),Notes'
  const rows = bom.line_items.map(li =>
    `${li.category},"${li.name}",${li.quantity},"${li.unit}",${li.unit_cost_cad.toFixed(2)},${li.total_cost_cad.toFixed(2)},"${(li.notes || '').replace(/"/g, '""')}"`
  )
  return [header, ...rows].join('\n')
}

/**
 * Generate JobNimbus-compatible JSON API payload
 */
export function generateJobNimbusJSON(bom: DetailedMaterialBOM): string {
  return JSON.stringify({
    type: 'estimate',
    date: bom.generated_at,
    address: bom.project_address,
    roof_measurements: {
      total_area_sqft: bom.input.net_roof_area_sqft,
      total_squares: bom.input.gross_squares,
      pitch: bom.input.predominant_pitch,
      eave_lf: bom.input.total_eave_lf,
      ridge_lf: bom.input.total_ridge_lf,
      hip_lf: bom.input.total_hip_lf,
      valley_lf: bom.input.total_valley_lf,
      rake_lf: bom.input.total_rake_lf,
    },
    materials: bom.line_items.map(li => ({
      name: li.name,
      category: li.category,
      quantity: li.quantity,
      unit: li.unit,
      unit_price: li.unit_cost_cad,
      total_price: li.total_cost_cad,
      description: li.description
    })),
    totals: {
      subtotal: bom.cost_summary.materials_subtotal_cad,
      tax: bom.cost_summary.tax_estimate_cad,
      total: bom.cost_summary.materials_total_cad
    }
  }, null, 2)
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

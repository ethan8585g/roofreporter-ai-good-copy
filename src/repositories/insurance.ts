// ============================================================
// Insurance-Grade Report Metadata Repository (Phase 2)
// All sections optional. Empty rows = section hidden in template.
// ============================================================

export type ClaimMetadata = {
  report_id: number
  claim_number?: string | null
  policy_number?: string | null
  carrier_name?: string | null
  adjuster_name?: string | null
  adjuster_email?: string | null
  adjuster_phone?: string | null
  date_of_loss?: string | null
  peril?: string | null
  inspection_date?: string | null
  inspector_name?: string | null
  inspector_license?: string | null
  signed_at?: string | null
  insurance_ready?: number | null
}

export type Penetrations = {
  report_id: number
  pipe_boots_15in?: number | null
  pipe_boots_2in?: number | null
  pipe_boots_3in?: number | null
  pipe_boots_4in?: number | null
  vents_turtle?: number | null
  vents_box?: number | null
  vents_ridge?: number | null
  vents_turbine?: number | null
  vents_power?: number | null
  skylights_count?: number | null
  skylights_dims_json?: string | null
  chimneys_count?: number | null
  chimneys_dims_json?: string | null
  notes?: string | null
}

export type Flashing = {
  report_id: number
  step_lf?: number | null
  headwall_lf?: number | null
  sidewall_lf?: number | null
  counter_lf?: number | null
  chimney_apron_lf?: number | null
  chimney_step_lf?: number | null
  chimney_counter_lf?: number | null
  chimney_cricket_lf?: number | null
  skylight_kits?: number | null
  kickout_count?: number | null
  notes?: string | null
}

export type ReportPhoto = {
  id?: number
  report_id: number
  url: string
  caption?: string | null
  taken_at?: string | null
  gps_lat?: number | null
  gps_lng?: number | null
  category?: string | null
  display_order?: number
}

export type ExistingMaterial = {
  report_id: number
  material_type?: string | null
  manufacturer?: string | null
  color?: string | null
  age_years?: number | null
  layers_count?: number | null
  damage_hail?: number | null
  damage_wind_lift?: number | null
  damage_granule_loss?: number | null
  damage_blistering?: number | null
  damage_nail_pops?: number | null
  damage_sealant_failure?: number | null
  damage_other?: string | null
  test_squares_count?: number | null
  itel_match_recommended?: number | null
  notes?: string | null
}

export type Decking = {
  report_id: number
  sheathing_type?: string | null
  sheathing_thickness_in?: number | null
  underlayment_layers?: number | null
  ventilation_type?: string | null
  ventilation_nfa_in2?: number | null
  notes?: string | null
}

export type Drainage = {
  report_id: number
  scuppers_count?: number | null
  drains_count?: number | null
  parapet_lf?: number | null
  coping_lf?: number | null
  notes?: string | null
}

// ── READ ──

export async function getClaimMetadata(db: D1Database, reportId: number) {
  return db.prepare('SELECT * FROM report_claim_metadata WHERE report_id = ?')
    .bind(reportId).first<ClaimMetadata>()
}

export async function getPenetrations(db: D1Database, reportId: number) {
  return db.prepare('SELECT * FROM report_penetrations WHERE report_id = ?')
    .bind(reportId).first<Penetrations>()
}

export async function getFlashing(db: D1Database, reportId: number) {
  return db.prepare('SELECT * FROM report_flashing WHERE report_id = ?')
    .bind(reportId).first<Flashing>()
}

export async function getPhotos(db: D1Database, reportId: number) {
  const r = await db.prepare('SELECT * FROM report_photos WHERE report_id = ? ORDER BY display_order, id')
    .bind(reportId).all<ReportPhoto>()
  return r.results || []
}

export async function getExistingMaterial(db: D1Database, reportId: number) {
  return db.prepare('SELECT * FROM report_existing_material WHERE report_id = ?')
    .bind(reportId).first<ExistingMaterial>()
}

export async function getDecking(db: D1Database, reportId: number) {
  return db.prepare('SELECT * FROM report_decking WHERE report_id = ?')
    .bind(reportId).first<Decking>()
}

export async function getDrainage(db: D1Database, reportId: number) {
  return db.prepare('SELECT * FROM report_drainage WHERE report_id = ?')
    .bind(reportId).first<Drainage>()
}

/** Loads all insurance-grade extensions for a report. Returns nulls when absent. */
export async function getAllInsuranceExtensions(db: D1Database, reportId: number) {
  const [claim, penetrations, flashing, photos, existing, decking, drainage] = await Promise.all([
    getClaimMetadata(db, reportId),
    getPenetrations(db, reportId),
    getFlashing(db, reportId),
    getPhotos(db, reportId),
    getExistingMaterial(db, reportId),
    getDecking(db, reportId),
    getDrainage(db, reportId),
  ])
  return { claim, penetrations, flashing, photos, existing, decking, drainage }
}

// ── UPSERT ──

export async function upsertClaimMetadata(db: D1Database, m: ClaimMetadata) {
  await db.prepare(`
    INSERT INTO report_claim_metadata (
      report_id, claim_number, policy_number, carrier_name,
      adjuster_name, adjuster_email, adjuster_phone,
      date_of_loss, peril, inspection_date,
      inspector_name, inspector_license, signed_at, insurance_ready
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(report_id) DO UPDATE SET
      claim_number = excluded.claim_number,
      policy_number = excluded.policy_number,
      carrier_name = excluded.carrier_name,
      adjuster_name = excluded.adjuster_name,
      adjuster_email = excluded.adjuster_email,
      adjuster_phone = excluded.adjuster_phone,
      date_of_loss = excluded.date_of_loss,
      peril = excluded.peril,
      inspection_date = excluded.inspection_date,
      inspector_name = excluded.inspector_name,
      inspector_license = excluded.inspector_license,
      signed_at = excluded.signed_at,
      insurance_ready = excluded.insurance_ready,
      updated_at = datetime('now')
  `).bind(
    m.report_id, m.claim_number ?? null, m.policy_number ?? null, m.carrier_name ?? null,
    m.adjuster_name ?? null, m.adjuster_email ?? null, m.adjuster_phone ?? null,
    m.date_of_loss ?? null, m.peril ?? null, m.inspection_date ?? null,
    m.inspector_name ?? null, m.inspector_license ?? null, m.signed_at ?? null,
    m.insurance_ready ?? 0,
  ).run()
}

export async function upsertPenetrations(db: D1Database, p: Penetrations) {
  await db.prepare(`
    INSERT INTO report_penetrations (
      report_id, pipe_boots_15in, pipe_boots_2in, pipe_boots_3in, pipe_boots_4in,
      vents_turtle, vents_box, vents_ridge, vents_turbine, vents_power,
      skylights_count, skylights_dims_json, chimneys_count, chimneys_dims_json, notes
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(report_id) DO UPDATE SET
      pipe_boots_15in = excluded.pipe_boots_15in,
      pipe_boots_2in = excluded.pipe_boots_2in,
      pipe_boots_3in = excluded.pipe_boots_3in,
      pipe_boots_4in = excluded.pipe_boots_4in,
      vents_turtle = excluded.vents_turtle,
      vents_box = excluded.vents_box,
      vents_ridge = excluded.vents_ridge,
      vents_turbine = excluded.vents_turbine,
      vents_power = excluded.vents_power,
      skylights_count = excluded.skylights_count,
      skylights_dims_json = excluded.skylights_dims_json,
      chimneys_count = excluded.chimneys_count,
      chimneys_dims_json = excluded.chimneys_dims_json,
      notes = excluded.notes,
      updated_at = datetime('now')
  `).bind(
    p.report_id,
    p.pipe_boots_15in ?? null, p.pipe_boots_2in ?? null, p.pipe_boots_3in ?? null, p.pipe_boots_4in ?? null,
    p.vents_turtle ?? null, p.vents_box ?? null, p.vents_ridge ?? null, p.vents_turbine ?? null, p.vents_power ?? null,
    p.skylights_count ?? null, p.skylights_dims_json ?? null,
    p.chimneys_count ?? null, p.chimneys_dims_json ?? null,
    p.notes ?? null,
  ).run()
}

export async function upsertFlashing(db: D1Database, f: Flashing) {
  await db.prepare(`
    INSERT INTO report_flashing (
      report_id, step_lf, headwall_lf, sidewall_lf, counter_lf,
      chimney_apron_lf, chimney_step_lf, chimney_counter_lf, chimney_cricket_lf,
      skylight_kits, kickout_count, notes
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(report_id) DO UPDATE SET
      step_lf = excluded.step_lf,
      headwall_lf = excluded.headwall_lf,
      sidewall_lf = excluded.sidewall_lf,
      counter_lf = excluded.counter_lf,
      chimney_apron_lf = excluded.chimney_apron_lf,
      chimney_step_lf = excluded.chimney_step_lf,
      chimney_counter_lf = excluded.chimney_counter_lf,
      chimney_cricket_lf = excluded.chimney_cricket_lf,
      skylight_kits = excluded.skylight_kits,
      kickout_count = excluded.kickout_count,
      notes = excluded.notes,
      updated_at = datetime('now')
  `).bind(
    f.report_id,
    f.step_lf ?? null, f.headwall_lf ?? null, f.sidewall_lf ?? null, f.counter_lf ?? null,
    f.chimney_apron_lf ?? null, f.chimney_step_lf ?? null, f.chimney_counter_lf ?? null, f.chimney_cricket_lf ?? null,
    f.skylight_kits ?? null, f.kickout_count ?? null, f.notes ?? null,
  ).run()
}

export async function upsertExistingMaterial(db: D1Database, e: ExistingMaterial) {
  await db.prepare(`
    INSERT INTO report_existing_material (
      report_id, material_type, manufacturer, color, age_years, layers_count,
      damage_hail, damage_wind_lift, damage_granule_loss,
      damage_blistering, damage_nail_pops, damage_sealant_failure, damage_other,
      test_squares_count, itel_match_recommended, notes
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(report_id) DO UPDATE SET
      material_type = excluded.material_type,
      manufacturer = excluded.manufacturer,
      color = excluded.color,
      age_years = excluded.age_years,
      layers_count = excluded.layers_count,
      damage_hail = excluded.damage_hail,
      damage_wind_lift = excluded.damage_wind_lift,
      damage_granule_loss = excluded.damage_granule_loss,
      damage_blistering = excluded.damage_blistering,
      damage_nail_pops = excluded.damage_nail_pops,
      damage_sealant_failure = excluded.damage_sealant_failure,
      damage_other = excluded.damage_other,
      test_squares_count = excluded.test_squares_count,
      itel_match_recommended = excluded.itel_match_recommended,
      notes = excluded.notes,
      updated_at = datetime('now')
  `).bind(
    e.report_id,
    e.material_type ?? null, e.manufacturer ?? null, e.color ?? null,
    e.age_years ?? null, e.layers_count ?? null,
    e.damage_hail ?? null, e.damage_wind_lift ?? null, e.damage_granule_loss ?? null,
    e.damage_blistering ?? null, e.damage_nail_pops ?? null, e.damage_sealant_failure ?? null, e.damage_other ?? null,
    e.test_squares_count ?? null, e.itel_match_recommended ?? null, e.notes ?? null,
  ).run()
}

export async function upsertDecking(db: D1Database, d: Decking) {
  await db.prepare(`
    INSERT INTO report_decking (
      report_id, sheathing_type, sheathing_thickness_in,
      underlayment_layers, ventilation_type, ventilation_nfa_in2, notes
    ) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(report_id) DO UPDATE SET
      sheathing_type = excluded.sheathing_type,
      sheathing_thickness_in = excluded.sheathing_thickness_in,
      underlayment_layers = excluded.underlayment_layers,
      ventilation_type = excluded.ventilation_type,
      ventilation_nfa_in2 = excluded.ventilation_nfa_in2,
      notes = excluded.notes,
      updated_at = datetime('now')
  `).bind(
    d.report_id,
    d.sheathing_type ?? null, d.sheathing_thickness_in ?? null,
    d.underlayment_layers ?? null, d.ventilation_type ?? null, d.ventilation_nfa_in2 ?? null,
    d.notes ?? null,
  ).run()
}

export async function upsertDrainage(db: D1Database, dr: Drainage) {
  await db.prepare(`
    INSERT INTO report_drainage (report_id, scuppers_count, drains_count, parapet_lf, coping_lf, notes)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(report_id) DO UPDATE SET
      scuppers_count = excluded.scuppers_count,
      drains_count = excluded.drains_count,
      parapet_lf = excluded.parapet_lf,
      coping_lf = excluded.coping_lf,
      notes = excluded.notes,
      updated_at = datetime('now')
  `).bind(
    dr.report_id,
    dr.scuppers_count ?? null, dr.drains_count ?? null,
    dr.parapet_lf ?? null, dr.coping_lf ?? null,
    dr.notes ?? null,
  ).run()
}

export async function addPhoto(db: D1Database, p: ReportPhoto) {
  const r = await db.prepare(`
    INSERT INTO report_photos (report_id, url, caption, taken_at, gps_lat, gps_lng, category, display_order)
    VALUES (?,?,?,?,?,?,?,?)
  `).bind(
    p.report_id, p.url, p.caption ?? null, p.taken_at ?? null,
    p.gps_lat ?? null, p.gps_lng ?? null, p.category ?? null,
    p.display_order ?? 0,
  ).run()
  return r.meta.last_row_id
}

export async function deletePhoto(db: D1Database, photoId: number) {
  await db.prepare('DELETE FROM report_photos WHERE id = ?').bind(photoId).run()
}

// ── Insurance-Ready computation ──
// A report is "insurance-ready" when claim metadata has carrier + claim # + adjuster
// AND penetrations row exists AND existing-material row exists AND >= 1 photo.
// (Flashing/decking/drainage are conditional on roof type, not strict gates.)
export function computeInsuranceReadiness(ext: {
  claim: ClaimMetadata | null
  penetrations: Penetrations | null
  existing: ExistingMaterial | null
  photos: ReportPhoto[]
}) {
  const reasons: string[] = []
  const claim = ext.claim
  if (!claim) reasons.push('claim metadata missing')
  else {
    if (!claim.carrier_name) reasons.push('carrier name')
    if (!claim.claim_number) reasons.push('claim number')
    if (!claim.adjuster_name) reasons.push('adjuster name')
    if (!claim.date_of_loss) reasons.push('date of loss')
    if (!claim.peril) reasons.push('peril')
    if (!claim.inspector_name) reasons.push('inspector name')
  }
  if (!ext.penetrations) reasons.push('penetrations not recorded')
  if (!ext.existing) reasons.push('existing material not recorded')
  if (!ext.photos || ext.photos.length === 0) reasons.push('no photos')
  return { ready: reasons.length === 0, reasons }
}

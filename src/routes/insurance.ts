// ============================================================
// Phase 3 — Insurance metadata API + Insurance-Ready gate.
// All routes scoped under /api/insurance and require the customer
// session of the report owner OR an admin session.
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import * as ins from '../repositories/insurance'

export const insuranceRoutes = new Hono<{ Bindings: Bindings }>()

// Auth: customer session ownership OR admin.
async function authReportAccess(c: any, reportId: number) {
  // Admin session — re-use cookie set by /api/auth/login
  const adminCookie = c.req.header('cookie')?.match(/rm_admin_session=([^;]+)/)?.[1]
  if (adminCookie) {
    const session = await c.env.DB.prepare(
      'SELECT admin_id FROM admin_sessions WHERE session_token = ? AND expires_at > datetime(\'now\')'
    ).bind(adminCookie).first<{ admin_id: number }>().catch(() => null)
    if (session) return { ok: true, kind: 'admin' as const }
  }
  // Customer session — ownership check via order.customer_id
  const custCookie = c.req.header('cookie')?.match(/rm_customer_session=([^;]+)/)?.[1]
  if (custCookie) {
    const sess = await c.env.DB.prepare(
      'SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime(\'now\')'
    ).bind(custCookie).first<{ customer_id: number }>().catch(() => null)
    if (sess) {
      const owner = await c.env.DB.prepare(`
        SELECT 1 FROM reports r JOIN orders o ON o.id = r.order_id
        WHERE r.id = ? AND o.customer_id = ?
      `).bind(reportId, sess.customer_id).first()
      if (owner) return { ok: true, kind: 'customer' as const }
    }
  }
  return { ok: false }
}

function reportIdParam(c: any): number {
  const p = c.req.param('reportId')
  const n = parseInt(p, 10)
  if (!Number.isFinite(n) || n <= 0) throw new Error('invalid report id')
  return n
}

// ── GET /api/insurance/:reportId/all ──
insuranceRoutes.get('/:reportId/all', async (c) => {
  const reportId = reportIdParam(c)
  const auth = await authReportAccess(c, reportId)
  if (!auth.ok) return c.json({ error: 'Unauthorized' }, 401)
  const ext = await ins.getAllInsuranceExtensions(c.env.DB, reportId)
  const readiness = ins.computeInsuranceReadiness(ext)
  return c.json({ ...ext, readiness })
})

// ── PUT /api/insurance/:reportId/claim ──
insuranceRoutes.put('/:reportId/claim', async (c) => {
  const reportId = reportIdParam(c)
  const auth = await authReportAccess(c, reportId)
  if (!auth.ok) return c.json({ error: 'Unauthorized' }, 401)
  const body = await c.req.json().catch(() => ({})) as Partial<ins.ClaimMetadata>
  await ins.upsertClaimMetadata(c.env.DB, { ...body, report_id: reportId })
  return c.json({ ok: true })
})

// ── PUT /api/insurance/:reportId/penetrations ──
insuranceRoutes.put('/:reportId/penetrations', async (c) => {
  const reportId = reportIdParam(c)
  const auth = await authReportAccess(c, reportId)
  if (!auth.ok) return c.json({ error: 'Unauthorized' }, 401)
  const body = await c.req.json().catch(() => ({})) as Partial<ins.Penetrations>
  await ins.upsertPenetrations(c.env.DB, { ...body, report_id: reportId })
  return c.json({ ok: true })
})

// ── PUT /api/insurance/:reportId/flashing ──
insuranceRoutes.put('/:reportId/flashing', async (c) => {
  const reportId = reportIdParam(c)
  const auth = await authReportAccess(c, reportId)
  if (!auth.ok) return c.json({ error: 'Unauthorized' }, 401)
  const body = await c.req.json().catch(() => ({})) as Partial<ins.Flashing>
  await ins.upsertFlashing(c.env.DB, { ...body, report_id: reportId })
  return c.json({ ok: true })
})

// ── PUT /api/insurance/:reportId/existing-material ──
insuranceRoutes.put('/:reportId/existing-material', async (c) => {
  const reportId = reportIdParam(c)
  const auth = await authReportAccess(c, reportId)
  if (!auth.ok) return c.json({ error: 'Unauthorized' }, 401)
  const body = await c.req.json().catch(() => ({})) as Partial<ins.ExistingMaterial>
  await ins.upsertExistingMaterial(c.env.DB, { ...body, report_id: reportId })
  return c.json({ ok: true })
})

// ── PUT /api/insurance/:reportId/decking ──
insuranceRoutes.put('/:reportId/decking', async (c) => {
  const reportId = reportIdParam(c)
  const auth = await authReportAccess(c, reportId)
  if (!auth.ok) return c.json({ error: 'Unauthorized' }, 401)
  const body = await c.req.json().catch(() => ({})) as Partial<ins.Decking>
  await ins.upsertDecking(c.env.DB, { ...body, report_id: reportId })
  return c.json({ ok: true })
})

// ── PUT /api/insurance/:reportId/drainage ──
insuranceRoutes.put('/:reportId/drainage', async (c) => {
  const reportId = reportIdParam(c)
  const auth = await authReportAccess(c, reportId)
  if (!auth.ok) return c.json({ error: 'Unauthorized' }, 401)
  const body = await c.req.json().catch(() => ({})) as Partial<ins.Drainage>
  await ins.upsertDrainage(c.env.DB, { ...body, report_id: reportId })
  return c.json({ ok: true })
})

// ── POST /api/insurance/:reportId/photos ──
// Body: { url, caption?, taken_at?, gps_lat?, gps_lng?, category?, display_order? }
// Photos hosted externally (e.g., R2 / customer-provided URL). No file upload here.
insuranceRoutes.post('/:reportId/photos', async (c) => {
  const reportId = reportIdParam(c)
  const auth = await authReportAccess(c, reportId)
  if (!auth.ok) return c.json({ error: 'Unauthorized' }, 401)
  const body = await c.req.json().catch(() => ({})) as Partial<ins.ReportPhoto>
  if (!body.url || typeof body.url !== 'string') return c.json({ error: 'url required' }, 400)
  const id = await ins.addPhoto(c.env.DB, {
    report_id: reportId,
    url: body.url,
    caption: body.caption ?? null,
    taken_at: body.taken_at ?? null,
    gps_lat: body.gps_lat ?? null,
    gps_lng: body.gps_lng ?? null,
    category: body.category ?? null,
    display_order: body.display_order ?? 0,
  })
  return c.json({ ok: true, id })
})

// ── DELETE /api/insurance/:reportId/photos/:photoId ──
insuranceRoutes.delete('/:reportId/photos/:photoId', async (c) => {
  const reportId = reportIdParam(c)
  const photoId = parseInt(c.req.param('photoId'), 10)
  if (!Number.isFinite(photoId)) return c.json({ error: 'invalid photo id' }, 400)
  const auth = await authReportAccess(c, reportId)
  if (!auth.ok) return c.json({ error: 'Unauthorized' }, 401)
  await ins.deletePhoto(c.env.DB, photoId)
  return c.json({ ok: true })
})

// ── POST /api/insurance/:reportId/mark-ready ──
// Sets insurance_ready=1 only if all gate items pass.
insuranceRoutes.post('/:reportId/mark-ready', async (c) => {
  const reportId = reportIdParam(c)
  const auth = await authReportAccess(c, reportId)
  if (!auth.ok) return c.json({ error: 'Unauthorized' }, 401)
  const ext = await ins.getAllInsuranceExtensions(c.env.DB, reportId)
  const readiness = ins.computeInsuranceReadiness(ext)
  if (!readiness.ready) return c.json({ ok: false, error: 'Not ready', missing: readiness.reasons }, 422)
  await ins.upsertClaimMetadata(c.env.DB, {
    ...ext.claim,
    report_id: reportId,
    insurance_ready: 1,
    signed_at: new Date().toISOString(),
  })
  return c.json({ ok: true })
})

// ── POST /api/insurance/:reportId/unmark-ready ──
insuranceRoutes.post('/:reportId/unmark-ready', async (c) => {
  const reportId = reportIdParam(c)
  const auth = await authReportAccess(c, reportId)
  if (!auth.ok) return c.json({ error: 'Unauthorized' }, 401)
  const ext = await ins.getAllInsuranceExtensions(c.env.DB, reportId)
  if (!ext.claim) return c.json({ ok: true })
  await ins.upsertClaimMetadata(c.env.DB, {
    ...ext.claim,
    report_id: reportId,
    insurance_ready: 0,
  })
  return c.json({ ok: true })
})

// ── GET /api/insurance/:reportId/intake ──
// Renders an HTML intake form (used inside the customer report viewer iframe).
insuranceRoutes.get('/:reportId/intake', async (c) => {
  const reportId = reportIdParam(c)
  const auth = await authReportAccess(c, reportId)
  if (!auth.ok) return c.html('<html><body><p>Unauthorized.</p></body></html>', 401)
  const ext = await ins.getAllInsuranceExtensions(c.env.DB, reportId)
  const readiness = ins.computeInsuranceReadiness(ext)
  return c.html(renderIntakeForm(reportId, ext, readiness))
})

function v(s: any) { return s == null ? '' : String(s).replace(/"/g, '&quot;') }
function ck(b: any) { return b ? 'checked' : '' }

function renderIntakeForm(reportId: number, ext: any, readiness: { ready: boolean; reasons: string[] }) {
  const c = ext.claim || {}
  const p = ext.penetrations || {}
  const f = ext.flashing || {}
  const e = ext.existing || {}
  const d = ext.decking || {}
  const dr = ext.drainage || {}
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<title>Insurance Intake — Report #${reportId}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b;margin:0;padding:24px}
  .wrap{max-width:920px;margin:0 auto}
  h1{font-size:22px;margin:0 0 6px}
  h2{font-size:15px;margin:24px 0 8px;padding-bottom:4px;border-bottom:1px solid #e2e8f0;color:#0f766e}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
  label{display:block;font-size:11px;color:#475569;margin-bottom:2px}
  input[type=text],input[type=number],input[type=email],input[type=tel],input[type=date],input[type=url],select,textarea{width:100%;box-sizing:border-box;padding:6px 8px;font-size:13px;border:1px solid #cbd5e1;border-radius:4px;background:#fff}
  textarea{min-height:60px}
  .check{display:flex;align-items:center;gap:6px;font-size:12px;margin:2px 0}
  .row{margin-bottom:6px}
  button{padding:9px 16px;font-size:13px;font-weight:600;border-radius:5px;border:none;cursor:pointer}
  .primary{background:#0f766e;color:#fff}
  .primary:hover{background:#115e59}
  .secondary{background:#fff;border:1px solid #cbd5e1;color:#1e293b}
  .gate{padding:12px;background:${readiness.ready ? '#ecfdf5' : '#fef3c7'};border:1px solid ${readiness.ready ? '#10b981' : '#f59e0b'};border-radius:6px;margin:16px 0;font-size:13px}
  .pill{display:inline-block;padding:2px 8px;border-radius:3px;background:#e2e8f0;font-size:11px;margin-right:4px;color:#475569}
  .saving{display:inline-block;font-size:11px;color:#10b981;margin-left:8px}
</style></head>
<body><div class="wrap">
  <h1>Insurance Intake</h1>
  <div style="font-size:12px;color:#64748b">Report #${reportId} — fields auto-save on blur. Visible to anyone with the report link.</div>

  <div class="gate">
    <strong>${readiness.ready ? '✓ Adjuster-Ready' : 'Draft'}</strong>
    ${readiness.ready ? '' : `<div style="margin-top:4px">Missing: ${readiness.reasons.map((r: string) => `<span class="pill">${r}</span>`).join('')}</div>`}
    <div style="margin-top:8px">
      ${readiness.ready
        ? `<button class="secondary" onclick="markReady(false)">Unmark</button>`
        : `<button class="primary" onclick="markReady(true)">Mark insurance-ready</button>`}
    </div>
  </div>

  <h2>Claim &amp; Adjuster</h2>
  <div class="grid">
    <div class="row"><label>Carrier</label><input id="claim_carrier_name" type="text" value="${v(c.carrier_name)}"/></div>
    <div class="row"><label>Claim #</label><input id="claim_claim_number" type="text" value="${v(c.claim_number)}"/></div>
    <div class="row"><label>Policy #</label><input id="claim_policy_number" type="text" value="${v(c.policy_number)}"/></div>
    <div class="row"><label>Date of loss</label><input id="claim_date_of_loss" type="date" value="${v(c.date_of_loss)}"/></div>
    <div class="row"><label>Peril</label><select id="claim_peril">
      ${['','hail','wind','fire','wear','other'].map(o => `<option value="${o}" ${c.peril === o ? 'selected' : ''}>${o || '—'}</option>`).join('')}
    </select></div>
    <div class="row"><label>Inspection date</label><input id="claim_inspection_date" type="date" value="${v(c.inspection_date)}"/></div>
    <div class="row"><label>Adjuster name</label><input id="claim_adjuster_name" type="text" value="${v(c.adjuster_name)}"/></div>
    <div class="row"><label>Adjuster email</label><input id="claim_adjuster_email" type="email" value="${v(c.adjuster_email)}"/></div>
    <div class="row"><label>Adjuster phone</label><input id="claim_adjuster_phone" type="tel" value="${v(c.adjuster_phone)}"/></div>
    <div class="row"><label>Inspector name</label><input id="claim_inspector_name" type="text" value="${v(c.inspector_name)}"/></div>
    <div class="row"><label>Inspector license #</label><input id="claim_inspector_license" type="text" value="${v(c.inspector_license)}"/></div>
  </div>

  <h2>Penetrations</h2>
  <div class="grid-3">
    <div class="row"><label>Pipe boots 1.5&quot;</label><input id="pen_pipe_boots_15in" type="number" min="0" value="${v(p.pipe_boots_15in)}"/></div>
    <div class="row"><label>Pipe boots 2&quot;</label><input id="pen_pipe_boots_2in" type="number" min="0" value="${v(p.pipe_boots_2in)}"/></div>
    <div class="row"><label>Pipe boots 3&quot;</label><input id="pen_pipe_boots_3in" type="number" min="0" value="${v(p.pipe_boots_3in)}"/></div>
    <div class="row"><label>Pipe boots 4&quot;</label><input id="pen_pipe_boots_4in" type="number" min="0" value="${v(p.pipe_boots_4in)}"/></div>
    <div class="row"><label>Vents — turtle</label><input id="pen_vents_turtle" type="number" min="0" value="${v(p.vents_turtle)}"/></div>
    <div class="row"><label>Vents — box</label><input id="pen_vents_box" type="number" min="0" value="${v(p.vents_box)}"/></div>
    <div class="row"><label>Vents — ridge</label><input id="pen_vents_ridge" type="number" min="0" value="${v(p.vents_ridge)}"/></div>
    <div class="row"><label>Vents — turbine</label><input id="pen_vents_turbine" type="number" min="0" value="${v(p.vents_turbine)}"/></div>
    <div class="row"><label>Vents — power</label><input id="pen_vents_power" type="number" min="0" value="${v(p.vents_power)}"/></div>
    <div class="row"><label>Skylights</label><input id="pen_skylights_count" type="number" min="0" value="${v(p.skylights_count)}"/></div>
    <div class="row"><label>Chimneys</label><input id="pen_chimneys_count" type="number" min="0" value="${v(p.chimneys_count)}"/></div>
  </div>
  <div class="row"><label>Notes</label><textarea id="pen_notes">${v(p.notes)}</textarea></div>

  <h2>Flashing (LF)</h2>
  <div class="grid-3">
    <div class="row"><label>Step</label><input id="flash_step_lf" type="number" step="0.1" value="${v(f.step_lf)}"/></div>
    <div class="row"><label>Headwall</label><input id="flash_headwall_lf" type="number" step="0.1" value="${v(f.headwall_lf)}"/></div>
    <div class="row"><label>Sidewall</label><input id="flash_sidewall_lf" type="number" step="0.1" value="${v(f.sidewall_lf)}"/></div>
    <div class="row"><label>Counter</label><input id="flash_counter_lf" type="number" step="0.1" value="${v(f.counter_lf)}"/></div>
    <div class="row"><label>Chimney apron</label><input id="flash_chimney_apron_lf" type="number" step="0.1" value="${v(f.chimney_apron_lf)}"/></div>
    <div class="row"><label>Chimney step</label><input id="flash_chimney_step_lf" type="number" step="0.1" value="${v(f.chimney_step_lf)}"/></div>
    <div class="row"><label>Chimney counter</label><input id="flash_chimney_counter_lf" type="number" step="0.1" value="${v(f.chimney_counter_lf)}"/></div>
    <div class="row"><label>Chimney cricket</label><input id="flash_chimney_cricket_lf" type="number" step="0.1" value="${v(f.chimney_cricket_lf)}"/></div>
    <div class="row"><label>Skylight kits</label><input id="flash_skylight_kits" type="number" min="0" value="${v(f.skylight_kits)}"/></div>
    <div class="row"><label>Kickout count</label><input id="flash_kickout_count" type="number" min="0" value="${v(f.kickout_count)}"/></div>
  </div>
  <div class="row"><label>Notes</label><textarea id="flash_notes">${v(f.notes)}</textarea></div>

  <h2>Existing material &amp; condition</h2>
  <div class="grid">
    <div class="row"><label>Material type</label><select id="exi_material_type">
      ${['','3-tab','architectural','designer','metal','tile','built-up','TPO','EPDM','other'].map(o => `<option value="${o}" ${e.material_type === o ? 'selected' : ''}>${o || '—'}</option>`).join('')}
    </select></div>
    <div class="row"><label>Manufacturer</label><input id="exi_manufacturer" type="text" value="${v(e.manufacturer)}"/></div>
    <div class="row"><label>Color</label><input id="exi_color" type="text" value="${v(e.color)}"/></div>
    <div class="row"><label>Age (yrs)</label><input id="exi_age_years" type="number" min="0" value="${v(e.age_years)}"/></div>
    <div class="row"><label>Layers</label><input id="exi_layers_count" type="number" min="0" value="${v(e.layers_count)}"/></div>
    <div class="row"><label>Test squares count</label><input id="exi_test_squares_count" type="number" min="0" value="${v(e.test_squares_count)}"/></div>
  </div>
  <div class="grid-3" style="margin-top:6px">
    <label class="check"><input type="checkbox" id="exi_damage_hail" ${ck(e.damage_hail)}/> Hail</label>
    <label class="check"><input type="checkbox" id="exi_damage_wind_lift" ${ck(e.damage_wind_lift)}/> Wind lift</label>
    <label class="check"><input type="checkbox" id="exi_damage_granule_loss" ${ck(e.damage_granule_loss)}/> Granule loss</label>
    <label class="check"><input type="checkbox" id="exi_damage_blistering" ${ck(e.damage_blistering)}/> Blistering</label>
    <label class="check"><input type="checkbox" id="exi_damage_nail_pops" ${ck(e.damage_nail_pops)}/> Nail pops</label>
    <label class="check"><input type="checkbox" id="exi_damage_sealant_failure" ${ck(e.damage_sealant_failure)}/> Sealant failure</label>
    <label class="check"><input type="checkbox" id="exi_itel_match_recommended" ${ck(e.itel_match_recommended)}/> ITEL match recommended</label>
  </div>
  <div class="row"><label>Other damage</label><input id="exi_damage_other" type="text" value="${v(e.damage_other)}"/></div>
  <div class="row"><label>Notes</label><textarea id="exi_notes">${v(e.notes)}</textarea></div>

  <h2>Decking &amp; ventilation</h2>
  <div class="grid-3">
    <div class="row"><label>Sheathing type</label><select id="dec_sheathing_type">
      ${['','plywood','OSB','board','other'].map(o => `<option value="${o}" ${d.sheathing_type === o ? 'selected' : ''}>${o || '—'}</option>`).join('')}
    </select></div>
    <div class="row"><label>Thickness (in)</label><input id="dec_sheathing_thickness_in" type="number" step="0.125" value="${v(d.sheathing_thickness_in)}"/></div>
    <div class="row"><label>Existing UL layers</label><input id="dec_underlayment_layers" type="number" min="0" value="${v(d.underlayment_layers)}"/></div>
    <div class="row"><label>Ventilation type</label><select id="dec_ventilation_type">
      ${['','ridge','soffit','box','power','mixed','none'].map(o => `<option value="${o}" ${d.ventilation_type === o ? 'selected' : ''}>${o || '—'}</option>`).join('')}
    </select></div>
    <div class="row"><label>NFA (in²)</label><input id="dec_ventilation_nfa_in2" type="number" step="0.1" value="${v(d.ventilation_nfa_in2)}"/></div>
  </div>
  <div class="row"><label>Notes</label><textarea id="dec_notes">${v(d.notes)}</textarea></div>

  <h2>Drainage (low-slope only)</h2>
  <div class="grid-3">
    <div class="row"><label>Scuppers</label><input id="dr_scuppers_count" type="number" min="0" value="${v(dr.scuppers_count)}"/></div>
    <div class="row"><label>Drains</label><input id="dr_drains_count" type="number" min="0" value="${v(dr.drains_count)}"/></div>
    <div class="row"><label>Parapet (LF)</label><input id="dr_parapet_lf" type="number" step="0.1" value="${v(dr.parapet_lf)}"/></div>
    <div class="row"><label>Coping (LF)</label><input id="dr_coping_lf" type="number" step="0.1" value="${v(dr.coping_lf)}"/></div>
  </div>
  <div class="row"><label>Notes</label><textarea id="dr_notes">${v(dr.notes)}</textarea></div>

  <h2>Photos</h2>
  <div id="photo-list" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px">
    ${(ext.photos || []).map((ph: any) => `
      <div style="border:1px solid #cbd5e1;border-radius:4px;overflow:hidden;background:#fff">
        <img src="${v(ph.url)}" style="width:100%;height:120px;object-fit:cover;display:block"/>
        <div style="padding:4px 6px;font-size:11px"><strong>${v(ph.caption || '')}</strong><br><span style="color:#777">${v(ph.category || '')}</span></div>
        <button class="secondary" style="width:100%;border-radius:0;border:none;border-top:1px solid #e2e8f0;padding:4px 6px;font-size:11px" onclick="deletePhoto(${ph.id})">Delete</button>
      </div>`).join('')}
  </div>
  <div class="grid">
    <input id="photo_url" type="url" placeholder="Photo URL (R2/CDN)"/>
    <input id="photo_caption" type="text" placeholder="Caption"/>
    <select id="photo_category">
      <option value="">— category —</option>
      <option value="overview">overview</option>
      <option value="damage">damage</option>
      <option value="penetration">penetration</option>
      <option value="flashing">flashing</option>
      <option value="decking">decking</option>
      <option value="other">other</option>
    </select>
    <button class="primary" onclick="addPhoto()">Add photo</button>
  </div>

  <div style="margin-top:24px;border-top:1px solid #e2e8f0;padding-top:16px">
    <button class="secondary" onclick="window.location.reload()">Refresh</button>
    <span id="status" class="saving"></span>
  </div>
</div>

<script>
(function(){
  const REPORT_ID = ${reportId};
  const groups = {
    claim: ['carrier_name','claim_number','policy_number','date_of_loss','peril','inspection_date','adjuster_name','adjuster_email','adjuster_phone','inspector_name','inspector_license'],
    pen:   ['pipe_boots_15in','pipe_boots_2in','pipe_boots_3in','pipe_boots_4in','vents_turtle','vents_box','vents_ridge','vents_turbine','vents_power','skylights_count','chimneys_count','notes'],
    flash: ['step_lf','headwall_lf','sidewall_lf','counter_lf','chimney_apron_lf','chimney_step_lf','chimney_counter_lf','chimney_cricket_lf','skylight_kits','kickout_count','notes'],
    exi:   ['material_type','manufacturer','color','age_years','layers_count','test_squares_count','damage_hail','damage_wind_lift','damage_granule_loss','damage_blistering','damage_nail_pops','damage_sealant_failure','damage_other','itel_match_recommended','notes'],
    dec:   ['sheathing_type','sheathing_thickness_in','underlayment_layers','ventilation_type','ventilation_nfa_in2','notes'],
    dr:    ['scuppers_count','drains_count','parapet_lf','coping_lf','notes'],
  };
  const endpoint = { claim: 'claim', pen: 'penetrations', flash: 'flashing', exi: 'existing-material', dec: 'decking', dr: 'drainage' };
  function statusMsg(t){ document.getElementById('status').textContent = t; setTimeout(() => { document.getElementById('status').textContent = ''; }, 1800); }
  function collect(prefix){
    const o = {};
    for (const f of groups[prefix]){
      const el = document.getElementById(prefix+'_'+f);
      if (!el) continue;
      if (el.type === 'checkbox') o[f] = el.checked ? 1 : 0;
      else if (el.type === 'number') o[f] = el.value === '' ? null : Number(el.value);
      else o[f] = el.value || null;
    }
    return o;
  }
  async function save(prefix){
    const r = await fetch('/api/insurance/'+REPORT_ID+'/'+endpoint[prefix], {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(collect(prefix)),
    });
    if (r.ok) statusMsg('saved'); else statusMsg('error');
  }
  for (const prefix of Object.keys(groups)){
    for (const f of groups[prefix]){
      const el = document.getElementById(prefix+'_'+f);
      if (el) el.addEventListener('change', () => save(prefix));
    }
  }
  window.addPhoto = async function(){
    const url = document.getElementById('photo_url').value;
    if (!url) return;
    const caption = document.getElementById('photo_caption').value;
    const category = document.getElementById('photo_category').value;
    await fetch('/api/insurance/'+REPORT_ID+'/photos', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, caption, category }),
    });
    location.reload();
  };
  window.deletePhoto = async function(id){
    if (!confirm('Delete this photo?')) return;
    await fetch('/api/insurance/'+REPORT_ID+'/photos/'+id, { method: 'DELETE', credentials: 'include' });
    location.reload();
  };
  window.markReady = async function(want){
    const r = await fetch('/api/insurance/'+REPORT_ID+'/'+(want ? 'mark-ready' : 'unmark-ready'), {
      method: 'POST', credentials: 'include',
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) location.reload();
    else alert((j.missing || []).length ? 'Missing: '+(j.missing||[]).join(', ') : (j.error || 'error'));
  };
})();
</script></body></html>`
}

// ============================================================
// Roof Manager — Reports Repository (D1 Database Layer)
// Typed query functions replacing raw SQL in route handlers.
// ============================================================

import type { RoofReport, MaterialEstimate } from '../types'

/** Minimal row types for SELECT results */
export type ReportRow = {
  id: number
  order_id: number
  status: string | null
  generation_attempts: number
  generation_started_at: string | null
  api_response_raw: string | null
  professional_report_html: string | null
  satellite_image_url: string | null
  vision_findings_json: string | null
  roof_footprint_sqft: number | null
  roof_pitch_degrees: number | null
  ai_status: string | null
  error_message: string | null
  [key: string]: unknown
}

export type OrderRow = {
  id: number
  order_number: string
  property_address: string
  property_city: string
  property_province: string
  property_postal_code: string
  homeowner_name: string | null
  homeowner_email: string | null
  requester_name: string | null
  requester_email: string | null
  requester_company: string | null
  service_tier: string
  price: number
  latitude: number | null
  longitude: number | null
  status: string
  [key: string]: unknown
}

// ── READ ──

export async function getReportByOrderId(db: D1Database, orderId: number | string) {
  return db.prepare(
    'SELECT * FROM reports WHERE order_id = ?'
  ).bind(orderId).first<ReportRow>()
}

export async function getReportRawData(db: D1Database, orderId: number | string) {
  return db.prepare(
    'SELECT api_response_raw FROM reports WHERE order_id = ?'
  ).bind(orderId).first<{ api_response_raw: string | null }>()
}

export async function getReportHtml(db: D1Database, orderId: number | string) {
  return db.prepare(`
    SELECT r.professional_report_html, r.api_response_raw, r.admin_review_status
    FROM reports r JOIN orders o ON r.order_id = o.id
    WHERE r.order_id = ? OR o.order_number = ?
  `).bind(orderId, orderId).first<{ professional_report_html: string | null; api_response_raw: string | null; admin_review_status: string | null }>()
}

export async function getReportWithOrder(db: D1Database, orderId: number | string) {
  return db.prepare(`
    SELECT r.*, o.order_number, o.property_address, o.property_city,
           o.property_province, o.property_postal_code,
           o.homeowner_name, o.requester_name, o.requester_company,
           o.service_tier, o.price, o.latitude, o.longitude
    FROM reports r JOIN orders o ON r.order_id = o.id
    WHERE r.order_id = ? OR o.order_number = ? OR r.id = ?
  `).bind(orderId, orderId, orderId).first()
}

export async function getReportForEnhance(db: D1Database, orderId: number | string) {
  return db.prepare(
    'SELECT id, status, api_response_raw, professional_report_html, roof_footprint_sqft, roof_pitch_degrees FROM reports WHERE order_id = ?'
  ).bind(orderId).first<ReportRow>()
}

export async function getReportForVision(db: D1Database, orderId: number | string) {
  return db.prepare(
    'SELECT id, order_id, api_response_raw, satellite_image_url, vision_findings_json, status FROM reports WHERE order_id = ?'
  ).bind(orderId).first<ReportRow>()
}

export async function getReportStatus(db: D1Database, orderId: number | string) {
  return db.prepare(
    'SELECT id, status, generation_attempts, generation_started_at FROM reports WHERE order_id = ?'
  ).bind(orderId).first<ReportRow>()
}

export async function getVisionFindings(db: D1Database, orderId: number | string) {
  return db.prepare(
    'SELECT vision_findings_json FROM reports WHERE order_id = ?'
  ).bind(orderId).first<{ vision_findings_json: string | null }>()
}

export async function getReportForPdf(db: D1Database, orderId: number | string) {
  return db.prepare(`
    SELECT r.professional_report_html, r.api_response_raw,
           o.property_address, o.property_city, o.property_province
    FROM reports r JOIN orders o ON r.order_id = o.id
    WHERE r.order_id = ? OR o.order_number = ?
  `).bind(orderId, orderId).first<any>()
}

export async function getOrderById(db: D1Database, orderId: number | string) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first<OrderRow>()
}

export async function getOrderWithReport(db: D1Database, orderId: number | string) {
  return db.prepare(`
    SELECT o.*, r.professional_report_html, r.api_response_raw, r.roof_area_sqft
    FROM orders o LEFT JOIN reports r ON r.order_id = o.id
    WHERE o.id = ? OR o.order_number = ?
  `).bind(orderId, orderId).first<any>()
}

export async function getReportExistence(db: D1Database, orderId: number | string) {
  return db.prepare('SELECT id FROM reports WHERE order_id = ?').bind(orderId).first<{ id: number }>()
}

// ── WRITE ──

export async function upsertGeneratingState(db: D1Database, orderId: number | string, attemptNum: number, exists: boolean) {
  if (exists) {
    return db.prepare(`
      UPDATE reports SET status = 'generating', generation_attempts = ?,
        generation_started_at = datetime('now'), error_message = NULL, updated_at = datetime('now')
      WHERE order_id = ?
    `).bind(attemptNum, orderId).run()
  }
  return db.prepare(`
    INSERT OR REPLACE INTO reports (order_id, status, generation_attempts, generation_started_at)
    VALUES (?, 'generating', ?, datetime('now'))
  `).bind(orderId, attemptNum).run()
}

export async function saveCompletedReport(
  db: D1Database, orderId: number | string,
  reportData: RoofReport, html: string, version: string
) {
  const es = reportData.edge_summary || {} as any
  const m = reportData.materials || {} as any
  const satUrl = reportData.imagery?.satellite_overhead_url || reportData.imagery?.satellite_url || null

  // D1 does NOT accept undefined — every bind value must be null, number, or string.
  // Helper converts undefined to null and ensures numbers are valid.
  const n = (v: any): number | null => (v === undefined || v === null || isNaN(v)) ? null : Number(v)
  const s = (v: any): string | null => (v === undefined || v === null) ? null : String(v)

  // Pre-save validation log — if any bind is still undefined, this helps diagnose
  // roof_area_sqft stores the PROJECTED footprint (matches the PDF report's
  // displayed "roof area" per the e5a94c5 fix). Material estimation keeps using
  // total_true_area_sqft internally via reportData.materials for shingle counts.
  const reviewFlag: any = (reportData as any).review_flag || null
  const needsReview: boolean = (reportData as any).needs_review === true || reviewFlag != null
  const reviewReason: string | null = reviewFlag?.reason || null
  const reviewDetailJson: string | null = reviewFlag ? JSON.stringify(reviewFlag) : null
  const eavesTagsJson: string | null = (reportData as any).eaves_tags
    ? JSON.stringify((reportData as any).eaves_tags)
    : null
  const confidenceBreakdownJson: string | null = (reportData as any).confidence_breakdown
    ? JSON.stringify((reportData as any).confidence_breakdown)
    : null
  const weatherRiskJson: string | null = (reportData as any).weather_risk
    ? JSON.stringify((reportData as any).weather_risk)
    : null
  const currentVersionNum: number = Number((reportData as any).current_version_num) || 1

  const bindValues = [
    n(reportData.total_footprint_sqft || reportData.total_true_area_sqft), n(reportData.total_footprint_sqm || reportData.total_true_area_sqm),
    n(reportData.total_footprint_sqft), n(reportData.total_footprint_sqm),
    n(reportData.area_multiplier),
    n(reportData.roof_pitch_degrees), s(reportData.roof_pitch_ratio),
    n(reportData.roof_azimuth_degrees),
    n(reportData.max_sunshine_hours), n(reportData.num_panels_possible),
    n(reportData.yearly_energy_kwh), JSON.stringify(reportData.segments || []),
    JSON.stringify(reportData.edges || []),
    n(es.total_ridge_ft), n(es.total_hip_ft), n(es.total_valley_ft),
    n(es.total_eave_ft), n(es.total_rake_ft),
    JSON.stringify(m),
    n(m.gross_squares), n(m.bundle_count),
    n(m.total_material_cost_cad), s(m.complexity_class),
    s(reportData.quality?.imagery_quality) ?? null, s(reportData.quality?.imagery_date) ?? null,
    n(reportData.quality?.confidence_score), reportData.quality?.field_verification_recommended ? 1 : 0,
    html, version, JSON.stringify(reportData),
    satUrl,
    reportData.vision_findings ? JSON.stringify(reportData.vision_findings) : null,
    reportData.solar_panel_layout ? JSON.stringify(reportData.solar_panel_layout) : null,
    needsReview ? 1 : 0, reviewReason, reviewDetailJson, eavesTagsJson,
    confidenceBreakdownJson, weatherRiskJson, currentVersionNum,
    orderId
  ]

  // Safety check: ensure no undefined values slip through to D1
  const undefinedIdx = bindValues.findIndex(v => v === undefined)
  if (undefinedIdx >= 0) {
    console.error(`[SaveReport] Order ${orderId}: UNDEFINED at bind index ${undefinedIdx} — replacing with null`)
    for (let i = 0; i < bindValues.length; i++) {
      if (bindValues[i] === undefined) bindValues[i] = null
    }
  }

  await db.prepare(`
    UPDATE reports SET
      roof_area_sqft = ?, roof_area_sqm = ?,
      roof_footprint_sqft = ?, roof_footprint_sqm = ?,
      area_multiplier = ?,
      roof_pitch_degrees = ?, roof_pitch_ratio = ?,
      roof_azimuth_degrees = ?,
      max_sunshine_hours = ?, num_panels_possible = ?,
      yearly_energy_kwh = ?, roof_segments = ?,
      edge_measurements = ?,
      total_ridge_ft = ?, total_hip_ft = ?, total_valley_ft = ?,
      total_eave_ft = ?, total_rake_ft = ?,
      material_estimate = ?,
      gross_squares = ?, bundle_count = ?,
      total_material_cost_cad = ?, complexity_class = ?,
      imagery_quality = ?, imagery_date = ?,
      confidence_score = ?, field_verification_recommended = ?,
      professional_report_html = ?,
      report_version = ?,
      api_response_raw = ?,
      satellite_image_url = ?,
      vision_findings_json = ?,
      solar_panel_layout = ?,
      needs_review = ?, review_reason = ?, review_detail = ?, eaves_tags = ?,
      confidence_breakdown = ?, weather_risk = ?, current_version_num = ?,
      status = 'completed', generation_completed_at = datetime('now'), updated_at = datetime('now')
    WHERE order_id = ?
  `).bind(...bindValues).run()
}

export async function markReportFailed(db: D1Database, orderId: number | string, errorMsg: string) {
  await db.prepare(`
    UPDATE reports SET status = 'failed', error_message = ?,
      generation_completed_at = datetime('now'), updated_at = datetime('now')
    WHERE order_id = ?
  `).bind(errorMsg.substring(0, 1000), orderId).run()
}

// Customer-ordered reports must NEVER hit a customer-visible "rejected"/"failed"
// state on the auto pipeline. Instead route them to the super-admin trace queue
// (orders.needs_admin_trace=1 + reports.needs_review=1) so the user can decide.
// Order status stays in 'paid'/'processing' so the customer dashboard shows the
// order as in-progress, not failed.
export async function flagForReview(
  db: D1Database,
  orderId: number | string,
  reasonCode: string,
  detail: any
) {
  const detailJson = (() => {
    try { return JSON.stringify(detail ?? {}).substring(0, 4000) } catch { return null }
  })()
  await db.prepare(
    "UPDATE orders SET needs_admin_trace = 1, status = CASE WHEN status IN ('failed','cancelled','refunded') THEN status ELSE 'processing' END, updated_at = datetime('now') WHERE id = ?"
  ).bind(orderId).run()
  // Ensure a report row exists, then flag it. INSERT OR IGNORE keeps the existing
  // row if generation already created one.
  await db.prepare(
    "INSERT OR IGNORE INTO reports (order_id, status, created_at, updated_at) VALUES (?, 'pending', datetime('now'), datetime('now'))"
  ).bind(orderId).run()
  await db.prepare(`
    UPDATE reports SET
      needs_review = 1,
      review_reason = COALESCE(review_reason, ?),
      review_detail = COALESCE(review_detail, ?),
      status = CASE WHEN status = 'completed' THEN status ELSE 'pending' END,
      updated_at = datetime('now')
    WHERE order_id = ?
  `).bind(reasonCode.substring(0, 100), detailJson, orderId).run()
}

export async function markOrderStatus(db: D1Database, orderId: number | string, status: string) {
  // Phase 3 orphan-prevention gate: refuse to flip an order to 'completed' unless
  // the corresponding report has renderable content. Prevents the IDs 49 / 50
  // class of bug where the order was completed without measurement data.
  if (status === 'completed') {
    const r = await db.prepare(`
      SELECT professional_report_html, api_response_raw FROM reports WHERE order_id = ?
    `).bind(orderId).first<{ professional_report_html: string | null; api_response_raw: string | null }>()
    const hasContent = !!(r && (
      (r.professional_report_html && r.professional_report_html.length > 100) ||
      (r.api_response_raw && r.api_response_raw.length > 100)
    ))
    if (!hasContent) {
      console.warn(`[markOrderStatus] order ${orderId}: refusing 'completed' — report has no renderable content`)
      // Leave the order as-is so the generator can be re-run; never silently produce an orphan.
      return
    }
  }
  const extra = status === 'completed' ? ", delivered_at = datetime('now')" : ''
  await db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now')${extra} WHERE id = ?`)
    .bind(status, orderId).run()
}

export async function resetReportForRetry(db: D1Database, orderId: number | string) {
  await db.prepare(`
    UPDATE reports SET status = NULL, generation_attempts = 0, error_message = NULL, updated_at = datetime('now')
    WHERE order_id = ?
  `).bind(orderId).run()
  await db.prepare(`UPDATE orders SET status = 'paid', updated_at = datetime('now') WHERE id = ?`).bind(orderId).run()
}

export async function updateVisionFindings(db: D1Database, orderId: number | string, json: string) {
  await db.prepare(`UPDATE reports SET vision_findings_json = ?, updated_at = datetime('now') WHERE order_id = ?`)
    .bind(json, orderId).run()
}

export async function updateReportHtml(db: D1Database, orderId: number | string, html: string, rawJson?: string) {
  if (rawJson) {
    await db.prepare(`UPDATE reports SET professional_report_html = ?, api_response_raw = ? WHERE order_id = ?`)
      .bind(html, rawJson, parseInt(String(orderId))).run()
  } else {
    await db.prepare(`UPDATE reports SET professional_report_html = ? WHERE order_id = ?`)
      .bind(html, parseInt(String(orderId))).run()
  }
}

export async function updateAiStatus(db: D1Database, orderId: number | string, status: string) {
  await db.prepare(`UPDATE reports SET ai_status = ?, updated_at = datetime('now') WHERE order_id = ?`)
    .bind(status, orderId).run()
}

export async function saveCustomerReportHtml(db: D1Database, orderId: number | string, html: string) {
  await db.prepare(`UPDATE reports SET customer_report_html = ?, updated_at = datetime('now') WHERE order_id = ?`)
    .bind(html, parseInt(String(orderId))).run()
}

export async function getCustomerReportHtml(db: D1Database, orderId: number | string) {
  return await db.prepare(`
    SELECT customer_report_html FROM reports WHERE order_id = ?
  `).bind(parseInt(String(orderId))).first<{ customer_report_html: string | null }>()
}

export async function logApiRequest(
  db: D1Database, orderId: number | string,
  type: string, endpoint: string, status: number, durationMs: number, payload?: string
) {
  await db.prepare(`
    INSERT INTO api_requests_log (order_id, request_type, endpoint, response_status, response_payload, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(orderId, type, endpoint, status, payload || null, durationMs).run()
}

export async function getSettingValue(db: D1Database, key: string, companyId: number = 1) {
  const row = await db.prepare(
    "SELECT setting_value FROM settings WHERE setting_key = ? AND master_company_id = ?"
  ).bind(key, companyId).first<{ setting_value: string }>()
  return row?.setting_value || null
}

// ============================================================
// REPORT ENHANCEMENT WEBHOOK PIPELINE
// ============================================================

/** Mark report as sent to Cloud Run for enhancement */
export async function markEnhancementSent(db: D1Database, orderId: number | string) {
  await db.prepare(`
    UPDATE reports SET
      enhancement_status = 'sent',
      enhancement_sent_at = datetime('now'),
      enhancement_error = NULL,
      updated_at = datetime('now')
    WHERE order_id = ?
  `).bind(orderId).run()
}

/** Mark enhancement as actively processing (Cloud Run acknowledged) */
export async function markEnhancementProcessing(db: D1Database, orderId: number | string) {
  await db.prepare(`
    UPDATE reports SET enhancement_status = 'enhancing', updated_at = datetime('now')
    WHERE order_id = ?
  `).bind(orderId).run()
}

/** Save the enhanced report from Cloud Run webhook callback */
export async function saveEnhancedReport(
  db: D1Database, orderId: number | string,
  enhancedHtml: string, enhancedRawJson: string,
  version: string, processingTimeMs: number
) {
  // Save enhanced report and ALSO overwrite the primary report HTML
  // so the user sees the enhanced version immediately
  await db.prepare(`
    UPDATE reports SET
      enhanced_report_html = ?,
      enhanced_api_response_raw = ?,
      enhancement_version = ?,
      enhancement_processing_time_ms = ?,
      enhancement_status = 'enhanced',
      enhancement_completed_at = datetime('now'),
      professional_report_html = ?,
      api_response_raw = ?,
      report_version = ?,
      updated_at = datetime('now')
    WHERE order_id = ?
  `).bind(
    enhancedHtml, enhancedRawJson, version, processingTimeMs,
    enhancedHtml, enhancedRawJson, 'enhanced-' + version,
    orderId
  ).run()
}

/** Mark enhancement as failed (original report remains valid) */
export async function markEnhancementFailed(db: D1Database, orderId: number | string, error: string) {
  await db.prepare(`
    UPDATE reports SET
      enhancement_status = 'enhancement_failed',
      enhancement_error = ?,
      enhancement_completed_at = datetime('now'),
      updated_at = datetime('now')
    WHERE order_id = ?
  `).bind(error.substring(0, 1000), orderId).run()
}

/** Get report data needed for the enhancement payload */
export async function getReportForEnhancement(db: D1Database, orderId: number | string) {
  return db.prepare(`
    SELECT r.order_id, r.api_response_raw, r.professional_report_html,
           r.satellite_image_url, r.enhancement_status, r.status,
           o.latitude, o.longitude, o.property_address,
           o.property_city, o.property_province, o.property_postal_code,
           o.roof_trace_json, o.price_per_bundle,
           o.homeowner_name, o.requester_name, o.requester_company
    FROM reports r
    JOIN orders o ON r.order_id = o.id
    WHERE r.order_id = ?
  `).bind(orderId).first()
}

/** Get enhancement status for a report */
export async function getEnhancementStatus(db: D1Database, orderId: number | string) {
  return db.prepare(`
    SELECT enhancement_status, enhancement_sent_at, enhancement_completed_at,
           enhancement_error, enhancement_processing_time_ms, enhancement_version
    FROM reports WHERE order_id = ?
  `).bind(orderId).first()
}

// ============================================================
// AI-GENERATED IMAGERY PIPELINE
// ============================================================

/** Mark AI imagery generation as started */
export async function markAIImageryGenerating(db: D1Database, orderId: number | string) {
  await db.prepare(`
    UPDATE reports SET ai_imagery_status = 'generating', ai_imagery_error = NULL, updated_at = datetime('now')
    WHERE order_id = ?
  `).bind(orderId).run()
}

/** Save AI-generated imagery JSON and update report HTML */
export async function saveAIImagery(
  db: D1Database, orderId: number | string,
  imageryJson: string, updatedHtml: string
) {
  await db.prepare(`
    UPDATE reports SET
      ai_generated_imagery_json = ?,
      ai_imagery_status = 'completed',
      professional_report_html = ?,
      updated_at = datetime('now')
    WHERE order_id = ?
  `).bind(imageryJson, updatedHtml, orderId).run()
}

/** Mark AI imagery generation as failed */
export async function markAIImageryFailed(db: D1Database, orderId: number | string, error: string) {
  await db.prepare(`
    UPDATE reports SET
      ai_imagery_status = 'failed',
      ai_imagery_error = ?,
      updated_at = datetime('now')
    WHERE order_id = ?
  `).bind(error.substring(0, 1000), orderId).run()
}

/** Get AI imagery status for a report */
export async function getAIImageryStatus(db: D1Database, orderId: number | string) {
  return db.prepare(`
    SELECT ai_imagery_status, ai_imagery_error, ai_generated_imagery_json
    FROM reports WHERE order_id = ?
  `).bind(orderId).first<{ ai_imagery_status: string | null; ai_imagery_error: string | null; ai_generated_imagery_json: string | null }>()
}

// ============================================================
// PRO-TIER: VERSIONING + FEEDBACK
// ============================================================

/**
 * Snapshot the existing measurement payload + version_num before overwriting.
 * Returns the *new* version_num the caller should attach to the next save.
 * Idempotent-ish: if no prior report exists, returns 1 and records nothing.
 */
export async function snapshotPriorReportVersion(
  db: D1Database,
  orderId: number | string,
  diffSummary: any | null = null,
): Promise<number> {
  const row = await db.prepare(`
    SELECT id, current_version_num, api_response_raw
    FROM reports WHERE order_id = ?
  `).bind(orderId).first<{ id: number; current_version_num: number | null; api_response_raw: string | null }>()

  if (!row || !row.id || !row.api_response_raw) return 1

  const priorVersion = Number(row.current_version_num) || 1
  await db.prepare(`
    INSERT INTO report_measurement_versions (report_id, version_num, data, diff_summary)
    VALUES (?, ?, ?, ?)
  `).bind(row.id, priorVersion, row.api_response_raw, diffSummary ? JSON.stringify(diffSummary) : null).run()

  return priorVersion + 1
}

/** Fetch the most recent saved measurement payload for diffing against. */
export async function getPriorReportSnapshot(
  db: D1Database,
  orderId: number | string,
): Promise<{ data: any; version_num: number } | null> {
  const row = await db.prepare(`
    SELECT current_version_num, api_response_raw
    FROM reports WHERE order_id = ?
  `).bind(orderId).first<{ current_version_num: number | null; api_response_raw: string | null }>()
  if (!row?.api_response_raw) return null
  try {
    return {
      data: JSON.parse(row.api_response_raw),
      version_num: Number(row.current_version_num) || 1,
    }
  } catch { return null }
}

/** Insert a feedback row. Auto-flags discrepancies above 20% for admin review. */
export async function insertReportFeedback(
  db: D1Database,
  args: {
    report_id: number
    user_id?: number | null
    type: string
    description?: string | null
    survey_data?: any
    discrepancy_pct?: number | null
  },
): Promise<{ id: number; needs_admin_review: boolean }> {
  const needsReview = typeof args.discrepancy_pct === 'number' && args.discrepancy_pct > 20
  const result = await db.prepare(`
    INSERT INTO report_feedback (report_id, user_id, type, description, survey_data, discrepancy_pct, needs_admin_review)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    args.report_id,
    args.user_id ?? null,
    args.type,
    args.description ?? null,
    args.survey_data ? JSON.stringify(args.survey_data) : null,
    args.discrepancy_pct ?? null,
    needsReview ? 1 : 0,
  ).run()
  const id = (result as any).meta?.last_row_id ?? 0
  return { id: Number(id), needs_admin_review: needsReview }
}

/** Look up the reports row by order_id — used to resolve report_id from the public-facing order id. */
export async function getReportIdByOrder(
  db: D1Database,
  orderId: number | string,
): Promise<number | null> {
  const row = await db.prepare('SELECT id FROM reports WHERE order_id = ?').bind(orderId).first<{ id: number }>()
  return row?.id ?? null
}

// ── REPORT VIEW EVENTS (migration 0216) ──

export type ReportViewType = 'share' | 'portal' | 'pdf' | 'admin' | '3d_tool'

export async function logReportView(
  db: D1Database,
  args: {
    order_id: number
    report_id: number | null
    view_type: ReportViewType
    customer_id: number | null
    ip_address: string | null
    user_agent: string | null
    share_token: string | null
    is_bot: boolean
  },
): Promise<void> {
  await db.prepare(`
    INSERT INTO report_view_events
      (order_id, report_id, view_type, customer_id, ip_address, user_agent, share_token, is_bot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    args.order_id,
    args.report_id ?? null,
    args.view_type,
    args.customer_id ?? null,
    args.ip_address ?? null,
    args.user_agent ?? null,
    args.share_token ?? null,
    args.is_bot ? 1 : 0,
  ).run()
}

export type ReportViewEventRow = {
  id: number
  viewed_at: string
  view_type: ReportViewType
  customer_id: number | null
  customer_name: string | null
  customer_email: string | null
  ip_address: string | null
  user_agent: string | null
  share_token: string | null
  is_bot: number
}

export async function getReportViewEvents(
  db: D1Database,
  orderId: number | string,
  limit: number = 20,
): Promise<ReportViewEventRow[]> {
  const res = await db.prepare(`
    SELECT rve.id, rve.viewed_at, rve.view_type, rve.customer_id,
           c.name AS customer_name, c.email AS customer_email,
           rve.ip_address, rve.user_agent, rve.share_token, rve.is_bot
    FROM report_view_events rve
    LEFT JOIN customers c ON c.id = rve.customer_id
    WHERE rve.order_id = ?
    ORDER BY rve.viewed_at DESC
    LIMIT ?
  `).bind(orderId, Math.max(1, Math.min(200, limit))).all<ReportViewEventRow>()
  return res.results ?? []
}

export type ReportViewSummary = {
  total_views: number
  share_views: number
  portal_views: number
  pdf_views: number
  admin_views: number
  tool_3d_views: number
  bot_views: number
}

export async function getReportViewSummary(
  db: D1Database,
  orderId: number | string,
): Promise<ReportViewSummary> {
  // total_views excludes admin self-views and bots — that's the headline count.
  // Per-type breakdowns also exclude bots; admin_views is a separate bucket.
  const row = await db.prepare(`
    SELECT
      SUM(CASE WHEN view_type IN ('share','portal','pdf') AND is_bot = 0 THEN 1 ELSE 0 END) AS total_views,
      SUM(CASE WHEN view_type = 'share'   AND is_bot = 0 THEN 1 ELSE 0 END) AS share_views,
      SUM(CASE WHEN view_type = 'portal'  AND is_bot = 0 THEN 1 ELSE 0 END) AS portal_views,
      SUM(CASE WHEN view_type = 'pdf'     AND is_bot = 0 THEN 1 ELSE 0 END) AS pdf_views,
      SUM(CASE WHEN view_type = 'admin'   AND is_bot = 0 THEN 1 ELSE 0 END) AS admin_views,
      SUM(CASE WHEN view_type = '3d_tool' AND is_bot = 0 THEN 1 ELSE 0 END) AS tool_3d_views,
      SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) AS bot_views
    FROM report_view_events
    WHERE order_id = ?
  `).bind(orderId).first<Record<keyof ReportViewSummary, number | null>>()
  return {
    total_views:   row?.total_views   ?? 0,
    share_views:   row?.share_views   ?? 0,
    portal_views:  row?.portal_views  ?? 0,
    pdf_views:     row?.pdf_views     ?? 0,
    admin_views:   row?.admin_views   ?? 0,
    tool_3d_views: row?.tool_3d_views ?? 0,
    bot_views:     row?.bot_views     ?? 0,
  }
}

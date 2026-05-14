// ============================================================
// Roof Manager — Autonomous AI Agent Service
// Phase 1: Auto-processes roof tracing orders without human intervention
// Phase 2: Super Admin autopilot (CRON-driven queue management)
// ============================================================

import Anthropic from '@anthropic-ai/sdk'
import type { Bindings, RoofReport } from '../types'
import { RoofMeasurementEngine, traceUiToEnginePayload, type TraceReport } from './roof-measurement-engine'
import { geminiOutlineToTracePayload } from './sam3-segmentation'
import { resolvePitch } from './pitch-resolver'
import { generateProfessionalReportHTML } from '../templates/report-html'
import { generateTraceBasedDiagramSVG } from '../templates/svg-diagrams'
import * as repo from '../repositories/reports'
import { buildEmailWrapper, sendViaResend, sendGmailOAuth2, getOrCreateShareToken, loadGmailCreds } from './email'
import { logEmailSend, markEmailFailed, buildTrackingPixel, wrapEmailLinks } from './email-tracking'
import { recordAndNotify } from './admin-notifications'
import { trackReportGenerated } from './ga4-events'

// ── CONSTANTS ──
export const DEFAULT_CONFIDENCE_THRESHOLD = 60  // Fallback if not set in agent_configs
const AUTO_TRACE_TIMEOUT_MS = 23_000             // Stay under CF Workers 25s budget
const MAX_AUTO_ATTEMPTS = 2                       // Max auto-trace retries before flagging for human
const AGENT_VERSION = '1.0.0'

/** Read the current confidence threshold from agent_configs (Monitor can adjust this) */
export async function getConfidenceThreshold(db: D1Database): Promise<number> {
  try {
    const row = await db.prepare(
      `SELECT config_json FROM agent_configs WHERE agent_type = 'tracing'`
    ).first<{ config_json: string | null }>()
    if (row?.config_json) {
      const cfg = JSON.parse(row.config_json)
      if (typeof cfg.confidence_threshold === 'number') return cfg.confidence_threshold
    }
  } catch {}
  return DEFAULT_CONFIDENCE_THRESHOLD
}

// ── TYPES ──
export interface AgentJobResult {
  success: boolean
  job_id?: number
  order_id: number
  action: 'auto_traced' | 'flagged_for_review' | 'report_generated' | 'failed' | 'skipped'
  confidence?: number
  processing_ms: number
  error?: string
  details?: string
}

export interface AgentQueueStats {
  pending_orders: number
  processing_orders: number
  auto_traced_today: number
  flagged_today: number
  failed_today: number
  avg_confidence: number
}

// ============================================================
// CORE: Auto-process a single order end-to-end
// Takes an order that needs_admin_trace and attempts full automation:
//   1. Fetch satellite image → Gemini geometry extraction
//   2. Convert pixels → GPS trace coordinates
//   3. Resolve pitch (Solar API > Gemini > fallback)
//   4. Run measurement engine
//   5. Generate full professional report
//   6. Save to DB + mark order completed
//   7. Notify customer
// ============================================================
export async function autoProcessOrder(
  orderId: number | string,
  env: Bindings,
  confidenceThreshold?: number
): Promise<AgentJobResult> {
  const startTime = Date.now()

  try {
    // ── Step 0: Fetch order and validate it's eligible ──
    const order = await env.DB.prepare(
      'SELECT * FROM orders WHERE id = ?'
    ).bind(orderId).first<any>()

    if (!order) {
      return { success: false, order_id: Number(orderId), action: 'failed', processing_ms: Date.now() - startTime, error: 'Order not found' }
    }

    // Skip if already completed, cancelled, or has a user-provided trace
    if (['completed', 'cancelled', 'refunded'].includes(order.status)) {
      return { success: false, order_id: Number(orderId), action: 'skipped', processing_ms: Date.now() - startTime, details: `Order already ${order.status}` }
    }

    // If the order already has a user-drawn trace, skip auto-tracing — just generate the report
    if (order.roof_trace_json && !order.needs_admin_trace) {
      return { success: false, order_id: Number(orderId), action: 'skipped', processing_ms: Date.now() - startTime, details: 'Order has user trace, no auto-trace needed' }
    }

    const lat = order.latitude
    const lng = order.longitude

    if (!lat || !lng) {
      // Try geocoding from address (future enhancement)
      await logAgentAction(env.DB, orderId, 'flagged_for_review', 'No coordinates on order — cannot auto-trace')
      return {
        success: false, order_id: Number(orderId), action: 'flagged_for_review',
        processing_ms: Date.now() - startTime, error: 'Order missing lat/lng coordinates'
      }
    }

    // ── Step 1: Log that the agent is picking up this order ──
    await logAgentAction(env.DB, orderId, 'auto_trace_started', `Agent v${AGENT_VERSION} starting auto-trace`)
    await env.DB.prepare(
      "UPDATE orders SET status = 'processing', notes = COALESCE(notes, '') || '\n[AI Agent] Auto-trace started at ' || datetime('now') WHERE id = ?"
    ).bind(orderId).run()

    // ── Step 2: Run AI auto-trace (Gemini → GPS → Measurement Engine) ──
    const autoTraceResult = await runAutoTrace(lat, lng, order.property_address, env)

    if (!autoTraceResult.success) {
      // Auto-trace failed — flag for manual review
      await logAgentAction(env.DB, orderId, 'flagged_for_review', autoTraceResult.error || 'Auto-trace failed')
      await env.DB.prepare(
        "UPDATE orders SET notes = COALESCE(notes, '') || '\n[AI Agent] Auto-trace failed: ' || ? || ' — flagged for manual review' WHERE id = ?"
      ).bind(autoTraceResult.error || 'unknown error', orderId).run()

      return {
        success: false, order_id: Number(orderId), action: 'flagged_for_review',
        confidence: autoTraceResult.confidence,
        processing_ms: Date.now() - startTime,
        error: autoTraceResult.error
      }
    }

    // ── Step 3: Check confidence threshold ──
    const threshold = confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD
    if (autoTraceResult.confidence !== undefined && autoTraceResult.confidence < threshold) {
      await logAgentAction(env.DB, orderId, 'flagged_for_review',
        `Confidence ${autoTraceResult.confidence}/100 below threshold ${threshold}`)
      await env.DB.prepare(
        "UPDATE orders SET roof_trace_json = ?, needs_admin_trace = 1, trace_source = 'ai_agent', notes = COALESCE(notes, '') || '\n[AI Agent] Low confidence (' || ? || '/100, threshold ' || ? || ') — auto-trace saved but flagged for review' WHERE id = ?"
      ).bind(
        JSON.stringify(autoTraceResult.trace),
        String(autoTraceResult.confidence),
        String(threshold),
        orderId
      ).run()

      return {
        success: false, order_id: Number(orderId), action: 'flagged_for_review',
        confidence: autoTraceResult.confidence,
        processing_ms: Date.now() - startTime,
        details: `Low confidence: ${autoTraceResult.confidence}/100 (threshold ${threshold}). Trace saved for manual review.`
      }
    }

    // ── Step 4: Save the auto-trace to the order ──
    await env.DB.prepare(
      "UPDATE orders SET roof_trace_json = ?, trace_measurement_json = ?, needs_admin_trace = 0, trace_source = 'ai_agent' WHERE id = ?"
    ).bind(
      JSON.stringify(autoTraceResult.trace),
      JSON.stringify(autoTraceResult.measurements),
      orderId
    ).run()

    await logAgentAction(env.DB, orderId, 'auto_trace_completed',
      `Confidence: ${autoTraceResult.confidence}/100, Area: ${autoTraceResult.measurements?.footprint_sqft || '?'} sqft`)

    // ── Step 5: Generate the full professional report as an admin-review draft ──
    // Use the existing generateReportForOrder which handles all the heavy lifting.
    // skipCustomerDelivery=true withholds email/CRM/delivered_at/invoice so the
    // operator can preview the draft and click Submit-to-Customer in the SA
    // preview view before the customer is notified.
    // Dynamic import to avoid circular dependency (routes → services → routes)
    const reportsModule = await import('../routes/reports')
    const reportResult = await reportsModule.generateReportForOrder(Number(orderId), env, undefined, { skipCustomerDelivery: true })

    if (!reportResult.success) {
      await logAgentAction(env.DB, orderId, 'report_generation_failed', reportResult.error || 'Unknown error')
      return {
        success: false, order_id: Number(orderId), action: 'failed',
        confidence: autoTraceResult.confidence,
        processing_ms: Date.now() - startTime,
        error: `Auto-trace succeeded but report generation failed: ${reportResult.error}`
      }
    }

    // ── Step 6: Flag the draft for admin review ──
    // Order status stays at whatever it was (paid/in_progress) — we don't
    // mark it 'completed' until /approve-and-deliver fires after the admin
    // reviews the draft in the SA preview view.
    await env.DB.prepare(
      "UPDATE orders SET trace_source = 'ai_agent', notes = COALESCE(notes, '') || '\n[AI Agent] Draft report generated automatically at ' || datetime('now') || ' — awaiting admin review' WHERE id = ?"
    ).bind(orderId).run()
    await env.DB.prepare(`
      UPDATE reports SET
        admin_review_status = 'awaiting_review',
        admin_review_started_at = COALESCE(admin_review_started_at, datetime('now')),
        admin_review_completed_at = NULL,
        updated_at = datetime('now')
      WHERE order_id = ?
    `).bind(orderId).run().catch((e: any) => console.warn(`[AI Agent] order ${orderId} awaiting_review flip failed:`, e?.message))

    await logAgentAction(env.DB, orderId, 'report_draft_generated',
      `Draft generated — awaiting admin review. Version: ${reportResult.version || 'unknown'}`)

    // ── Step 7: Notify super admin only (no customer email until approved) ──
    // recordAndNotify(skipCustomerEmail=true) keeps the trace_completed row
    // in the SA notification feed but suppresses the customer ping. The
    // customer-facing email fires from /approve-and-deliver instead.
    try {
      const cust = order?.customer_id
        ? await env.DB.prepare('SELECT name, email FROM customers WHERE id = ?').bind(order.customer_id).first<any>()
        : null
      await recordAndNotify(env, {
        kind: 'trace_completed',
        skipCustomerEmail: true,
        order: {
          order_id: Number(orderId),
          order_number: order.order_number,
          customer_id: order.customer_id ?? null,
          customer_email: cust?.email || order.requester_email || '',
          customer_name: cust?.name || order.requester_name || '',
          property_address: order.property_address || '',
          service_tier: order.service_tier || '',
          price: Number(order.price ?? 0),
          payment_status: 'paid',
          is_trial: !!order.is_trial,
          trace_source: 'ai_agent',
          needs_admin_trace: false,
          payload: { source: 'ai_agent_auto_process', admin_review: 'awaiting_review' },
        },
      })
    } catch (notifyErr: any) {
      console.warn(`[AI Agent] recordAndNotify failed for order ${orderId}: ${notifyErr?.message || notifyErr}`)
    }

    // ── Step 7b: Customer "report ready" email DEFERRED to /approve-and-deliver ──
    // Was: notifyReportReady fired here. That bypassed admin review and was
    // why customers got reports the moment the auto-pipeline finished.

    // ── Step 8: Track in GA4 ──
    try {
      await trackReportGenerated(env, String(orderId), {
        order_number: order.order_number,
        property_address: order.property_address,
        service_tier: order.service_tier,
        source: 'ai_agent_auto'
      })
    } catch {}

    return {
      success: true,
      order_id: Number(orderId),
      action: 'auto_traced',
      confidence: autoTraceResult.confidence,
      processing_ms: Date.now() - startTime,
      details: `Auto-traced and report generated. Confidence: ${autoTraceResult.confidence}/100`
    }

  } catch (err: any) {
    console.error(`[AI Agent] Fatal error processing order ${orderId}: ${err.message}`)
    await logAgentAction(env.DB, orderId, 'fatal_error', err.message).catch(() => {})
    return {
      success: false, order_id: Number(orderId), action: 'failed',
      processing_ms: Date.now() - startTime, error: err.message
    }
  }
}


// ============================================================
// AUTO-TRACE: Core satellite → geometry → measurements pipeline
// Extracted from the /auto-trace endpoint for reuse by the agent
// ============================================================
interface AutoTraceResult {
  success: boolean
  confidence?: number
  trace?: any
  measurements?: any
  error?: string
}

async function runAutoTrace(
  lat: number, lng: number, address: string, env: Bindings
): Promise<AutoTraceResult> {
  const solarApiKey = env.GOOGLE_SOLAR_API_KEY
  const mapsApiKey = (env as any).GOOGLE_MAPS_API_KEY || solarApiKey
  const anthropicKey = env.ANTHROPIC_API_KEY

  if (!mapsApiKey) {
    return { success: false, error: 'Missing GOOGLE_MAPS_API_KEY' }
  }
  if (!anthropicKey) {
    return { success: false, error: 'Missing ANTHROPIC_API_KEY secret — set it via wrangler secret put ANTHROPIC_API_KEY' }
  }

  const zoom = 20
  const imgW = 640
  const imgH = 640

  // Step 1: Fetch satellite image as base64
  const satelliteUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${imgW}x${imgH}&scale=2&maptype=satellite&key=${mapsApiKey}`

  let imageBase64: string
  try {
    const imgResp = await fetch(satelliteUrl)
    if (!imgResp.ok) throw new Error(`Satellite image fetch failed: HTTP ${imgResp.status}`)
    const buffer = await imgResp.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    imageBase64 = btoa(binary)
  } catch (err: any) {
    return { success: false, error: `Could not fetch satellite image: ${err.message}` }
  }

  // Step 2: Ask Claude claude-sonnet-4-6 to segment the roof
  const client = new Anthropic({ apiKey: anthropicKey })

  const systemPrompt = `You are an expert roofing measurement AI. Analyze overhead satellite imagery and extract precise roof geometry as JSON.

RULES:
- roof_outline: polygon tracing the OUTER PERIMETER of the entire roof at the eave line. Must have at least 4 points.
- segments: each distinct roof plane (facet). Simple gable = 2. Hip = 4. Complex = 8+.
- edges: all structural lines (ridges, hips, valleys, eaves, rakes).
- image_quality_score: 0-100. How clearly is the roof visible? Penalize for trees, shadows, low resolution.
- All coordinates in PIXEL SPACE (0,0 = top-left, ${imgW}x${imgH} image).
- Return ONLY valid JSON matching the schema. No markdown, no explanation.`

  const userPrompt = `Segment this satellite roof image. Image is ${imgW}x${imgH} pixels at zoom ${zoom}.
Address: ${address}
Coordinates: ${lat}, ${lng}

Return JSON with this exact structure:
{
  "segments": [{ "segment_id": 1, "type": "main_facet", "polygon_pixels": [{"x":0,"y":0}], "estimated_pitch_deg": 18, "estimated_azimuth_deg": 180, "confidence": 85 }],
  "roof_outline": [{"x":100,"y":80}, {"x":540,"y":80}, {"x":540,"y":560}, {"x":100,"y":560}],
  "edges": [{ "type": "ridge", "start": {"x":320,"y":100}, "end": {"x":320,"y":540}, "length_pixels": 440 }],
  "obstructions": [],
  "overall_complexity": "simple",
  "estimated_stories": 1,
  "image_quality_score": 75
}`

  let claudeResult: any
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 },
          },
          { type: 'text', text: systemPrompt + '\n\n' + userPrompt },
        ],
      }],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text : ''
    if (!text) throw new Error('Claude returned empty response')

    // Strip markdown code fences if present
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
    claudeResult = JSON.parse(jsonText)
  } catch (err: any) {
    return { success: false, error: `Claude vision failed: ${err.message}` }
  }

  if (!claudeResult || !claudeResult.segments || claudeResult.segments.length === 0) {
    return { success: false, error: 'Claude could not detect a roof in the satellite image' }
  }

  const qualityScore = claudeResult.image_quality_score || 0
  if (qualityScore < 40) {
    return { success: false, confidence: qualityScore, error: `Image quality too low: ${qualityScore}/100` }
  }

  // Step 3: Convert Claude output → TracePayload (reuses existing pixel→GPS converter)
  const tracePayload = geminiOutlineToTracePayload(
    claudeResult, lat, lng, zoom, imgW, imgH,
    { property_address: address }
  )

  if (tracePayload.eaves_outline.length < 3) {
    return { success: false, confidence: qualityScore, error: 'Insufficient perimeter points from Gemini' }
  }

  // Step 4: Resolve pitch (Solar API → Gemini → fallback 4:12)
  let finalPitchRise = 4.0
  try {
    const resolved = await resolvePitch({
      centroidLat: lat, centroidLng: lng,
      solarApiKey, mapsApiKey,
      houseSqftHint: 1500,
      userDefaultRise: tracePayload.default_pitch ?? 4.0,
      logTag: 'ai-agent-auto-trace',
    })
    finalPitchRise = resolved.pitch_rise
  } catch (pitchErr: any) {
    console.warn(`[AI Agent] Pitch resolution failed, using fallback 4:12: ${pitchErr.message}`)
  }
  tracePayload.default_pitch = finalPitchRise

  // Step 5: Run measurement engine
  let engineResult: TraceReport
  try {
    const engine = new RoofMeasurementEngine(tracePayload)
    engineResult = engine.run()
  } catch (engineErr: any) {
    return { success: false, confidence: qualityScore, error: `Measurement engine failed: ${engineErr.message}` }
  }

  // Step 6: Build trace JSON (same format as /auto-trace endpoint)
  const traceJson = {
    eaves: tracePayload.eaves_outline.map(p => ({ lat: p.lat, lng: p.lng })),
    ridges: (tracePayload.ridges || []).map(r => r.pts.map(p => ({ lat: p.lat, lng: p.lng }))),
    hips: (tracePayload.hips || []).map(h => h.pts.map(p => ({ lat: p.lat, lng: p.lng }))),
    valleys: (tracePayload.valleys || []).map(v => v.pts.map(p => ({ lat: p.lat, lng: p.lng }))),
    traced_at: new Date().toISOString(),
    auto_generated: true,
    auto_trace_source: 'ai_agent',
    gemini_confidence: qualityScore,
  }

  const km = engineResult.key_measurements
  const lm = engineResult.linear_measurements
  const mat = engineResult.materials_estimate

  const measurements = {
    footprint_sqft: Math.round(km.total_projected_footprint_ft2),
    true_area_sqft: Math.round(km.total_roof_area_sloped_ft2),
    total_squares: km.total_squares_net,
    gross_squares: km.total_squares_gross_w_waste,
    dominant_pitch: km.dominant_pitch_label,
    dominant_pitch_deg: Math.round(km.dominant_pitch_angle_deg * 10) / 10,
    num_faces: engineResult.face_details.length,
    eave_ft: Math.round(lm.eaves_total_ft),
    ridge_ft: Math.round(lm.ridges_total_ft),
    hip_ft: Math.round(lm.hips_total_ft),
    valley_ft: Math.round(lm.valleys_total_ft),
    rake_ft: Math.round(lm.rakes_total_ft),
    bundles: mat.shingles_bundles,
    waste_factor_pct: km.waste_factor_pct,
  }

  return {
    success: true,
    confidence: qualityScore,
    trace: traceJson,
    measurements,
  }
}


// ============================================================
// QUEUE PROCESSOR: Scan for pending orders and auto-process them
// Called by CRON trigger or manually via admin endpoint
// ============================================================
export async function processOrderQueue(env: Bindings): Promise<{
  processed: AgentJobResult[]
  stats: AgentQueueStats
}> {
  const results: AgentJobResult[] = []

  // Find orders that need auto-processing:
  // 1. needs_admin_trace = 1 (user clicked "Order Now" without tracing)
  // 2. Has lat/lng coordinates
  // 3. Status is 'processing' or 'paid'
  // 4. Not already attempted by the agent recently (check agent_jobs)
  const pendingOrders = await env.DB.prepare(`
    SELECT o.id, o.order_number, o.property_address, o.latitude, o.longitude,
           o.status, o.needs_admin_trace, o.created_at
    FROM orders o
    LEFT JOIN agent_jobs aj ON aj.order_id = o.id AND aj.action = 'auto_traced' AND aj.success = 1
    WHERE o.needs_admin_trace = 1
      AND o.latitude IS NOT NULL
      AND o.longitude IS NOT NULL
      AND o.status IN ('processing', 'paid')
      AND aj.id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM agent_jobs aj2
        WHERE aj2.order_id = o.id
        AND aj2.created_at > datetime('now', '-1 hour')
        AND aj2.attempts >= ?
      )
    ORDER BY o.created_at ASC
    LIMIT 5
  `).bind(MAX_AUTO_ATTEMPTS).all<any>()

  if (!pendingOrders.results || pendingOrders.results.length === 0) {
    const stats = await getQueueStats(env.DB)
    return { processed: [], stats }
  }

  // Read the Monitor-adjustable confidence threshold once for this batch
  const confidenceThreshold = await getConfidenceThreshold(env.DB)

  // Process each order (sequentially to stay within CPU budget)
  for (const order of pendingOrders.results) {
    try {
      const result = await autoProcessOrder(order.id, env, confidenceThreshold)
      results.push(result)

      // Log the job result
      await env.DB.prepare(`
        INSERT INTO agent_jobs (order_id, action, success, confidence, processing_ms, error, details, agent_version)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        order.id,
        result.action,
        result.success ? 1 : 0,
        result.confidence || null,
        result.processing_ms,
        result.error || null,
        result.details || null,
        AGENT_VERSION
      ).run()

    } catch (err: any) {
      console.error(`[AI Agent] Queue processing error for order ${order.id}: ${err.message}`)
      results.push({
        success: false,
        order_id: order.id,
        action: 'failed',
        processing_ms: 0,
        error: err.message
      })
    }
  }

  const stats = await getQueueStats(env.DB)
  return { processed: results, stats }
}


// ============================================================
// RETRY: Re-attempt failed orders with fresh Gemini call
// ============================================================
export async function retryFailedOrders(env: Bindings): Promise<AgentJobResult[]> {
  const results: AgentJobResult[] = []

  // Find orders that failed auto-trace but haven't exceeded max attempts
  const failedOrders = await env.DB.prepare(`
    SELECT DISTINCT o.id, o.order_number, o.property_address,
           COUNT(aj.id) as attempt_count
    FROM orders o
    INNER JOIN agent_jobs aj ON aj.order_id = o.id
    WHERE o.needs_admin_trace = 1
      AND o.status IN ('processing', 'paid', 'failed')
      AND aj.success = 0
      AND aj.action IN ('flagged_for_review', 'failed')
    GROUP BY o.id
    HAVING attempt_count < ?
    ORDER BY o.created_at ASC
    LIMIT 3
  `).bind(MAX_AUTO_ATTEMPTS).all<any>()

  for (const order of failedOrders.results || []) {
    const result = await autoProcessOrder(order.id, env)
    results.push(result)

    await env.DB.prepare(`
      INSERT INTO agent_jobs (order_id, action, success, confidence, processing_ms, error, details, agent_version, attempts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      order.id, result.action, result.success ? 1 : 0,
      result.confidence || null, result.processing_ms,
      result.error || null, result.details || null,
      AGENT_VERSION, (order.attempt_count || 0) + 1
    ).run()
  }

  return results
}


// ============================================================
// STATS: Get current queue health metrics
// ============================================================
export async function getQueueStats(db: D1Database): Promise<AgentQueueStats> {
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

  const [pending, processing, traced, flagged, failed, avgConf] = await Promise.all([
    db.prepare("SELECT COUNT(*) as c FROM orders WHERE needs_admin_trace = 1 AND status IN ('processing', 'paid')").first<any>(),
    db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'processing'").first<any>(),
    db.prepare(`SELECT COUNT(*) as c FROM agent_jobs WHERE action = 'auto_traced' AND success = 1 AND created_at >= ?`).bind(today).first<any>(),
    db.prepare(`SELECT COUNT(*) as c FROM agent_jobs WHERE action = 'flagged_for_review' AND created_at >= ?`).bind(today).first<any>(),
    db.prepare(`SELECT COUNT(*) as c FROM agent_jobs WHERE action = 'failed' AND created_at >= ?`).bind(today).first<any>(),
    db.prepare(`SELECT AVG(confidence) as avg FROM agent_jobs WHERE confidence IS NOT NULL AND created_at >= ?`).bind(today).first<any>(),
  ])

  return {
    pending_orders: pending?.c || 0,
    processing_orders: processing?.c || 0,
    auto_traced_today: traced?.c || 0,
    flagged_today: flagged?.c || 0,
    failed_today: failed?.c || 0,
    avg_confidence: Math.round(avgConf?.avg || 0),
  }
}


// ============================================================
// HELPERS
// ============================================================

async function logAgentAction(db: D1Database, orderId: number | string, action: string, details: string) {
  try {
    await db.prepare(
      "INSERT INTO user_activity_log (company_id, action, details) VALUES (1, ?, ?)"
    ).bind(`ai_agent_${action}`, `Order #${orderId}: ${details}`).run()
  } catch (e: any) {
    console.warn(`[AI Agent] Failed to log action: ${e.message}`)
  }
}

async function notifyReportReady(env: Bindings, order: any, orderId: number) {
  const recipientEmail = order.requester_email || order.homeowner_email
  if (!recipientEmail) return

  // Use the public share-token URL so the email link opens without a logged-in
  // session. The /api/reports/<id>/html path is IDOR-gated and 401s in Gmail.
  const shareToken = await getOrCreateShareToken(env, orderId)
  const reportUrl = shareToken
    ? `https://www.roofmanager.ca/report/share/${shareToken}`
    : `https://www.roofmanager.ca/api/reports/${orderId}/html`
  const subject = `Your Roof Report is Ready — ${order.property_address}`
  // Track this send so it shows up in super-admin Journey > Email Tracking
  // alongside the human-triggered notifyTraceCompletedToCustomer path.
  const trackingToken = await logEmailSend(env as any, {
    customerId: order.customer_id ?? null,
    recipient: recipientEmail,
    kind: 'report_ready_aiagent',
    subject,
  })
  const pixel = buildTrackingPixel(trackingToken)
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #1e3a5f; color: white; padding: 20px; text-align: center;">
        <h1 style="margin: 0; font-size: 24px;">Roof Manager</h1>
      </div>
      <div style="padding: 30px; background: #f8f9fa;">
        <h2>Your Roof Measurement Report is Ready!</h2>
        <p>Hi ${order.requester_name || order.homeowner_name},</p>
        <p>Great news — your roof measurement report for <strong>${order.property_address}</strong> is ready.</p>
        <p style="text-align: center; margin: 30px 0;">
          <a href="${reportUrl}" style="background: #0ea5e9; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold;">
            View Your Report
          </a>
        </p>
        <p style="color: #666; font-size: 14px;">
          Order: ${order.order_number}<br>
          Property: ${order.property_address}
        </p>
      </div>
      <div style="padding: 15px; text-align: center; color: #999; font-size: 12px;">
        © ${new Date().getFullYear()} Roof Manager — AI-Powered Roofing Measurement
      </div>
      ${pixel}
    </div>
  `
  const trackedHtml = wrapEmailLinks(html, trackingToken)

  // Try Resend first, fall back to Gmail
  const resendKey = (env as any).RESEND_API_KEY
  try {
    if (resendKey) {
      await sendViaResend(resendKey, recipientEmail, subject, trackedHtml)
    } else {
      // loadGmailCreds reads client_id/secret from env and refresh_token from
      // D1 settings — the canonical split used everywhere else. Pure-env read
      // would silently fail when refresh token lives only in D1.
      const creds = await loadGmailCreds(env)
      if (creds.clientId && creds.clientSecret && creds.refreshToken) {
        await sendGmailOAuth2(creds.clientId, creds.clientSecret, creds.refreshToken, recipientEmail, subject, trackedHtml)
      } else {
        await markEmailFailed(env as any, trackingToken, 'no email provider configured')
      }
    }
  } catch (e: any) {
    await markEmailFailed(env as any, trackingToken, String(e?.message || e))
    throw e
  }
}

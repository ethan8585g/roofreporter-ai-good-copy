// ============================================================
// Roof Manager — Reports Routes (Thin Controller Layer)
// ~400 lines — all logic delegated to services/repositories.
// ============================================================

import { Hono } from 'hono'
import type { Bindings, RoofReport } from '../types'
import { computeMaterialEstimate, degreesToCardinal } from '../utils/geo-math'
import { validateAdminSession } from '../routes/auth'
import { getCustomerSessionToken } from '../lib/session-tokens'
import { resolveTeamOwner } from './team'
import { createAutoInvoiceForOrder } from '../services/auto-invoice'
import { trackReportView } from '../services/report-view-tracker'
import { logEmailSend, markEmailFailed, buildTrackingPixel, wrapEmailLinks } from '../services/email-tracking'

// Services
import { analyzeRoofGeometry } from '../services/gemini'
import { visionScan, computeHeatScore, filterFindings } from '../services/vision-analyzer'
import type { VisionFindings } from '../types'
import {
  callGoogleSolarAPI, generateMockRoofReport, generateGPTRoofEstimate,
  generateEnhancedImagery, generateEdgesFromSegments, computeEdgeSummary,
  fetchSolarPitchAndImagery, fetchBuildingInsightsRaw, type SolarPitchAndImagery
} from '../services/solar-api'
import { buildSolarGeometry, solarGeometryToTracePayload, getZoomForFootprint } from '../services/solar-geometry'
import { buildDataLayersReport, generateSegmentsFromDLAnalysis, generateSegmentsFromAIGeometry } from '../services/report-engine'
import { executeRoofOrder, fetchSolarImageryOnly, type DataLayersAnalysis } from '../services/solar-datalayers'
import { generateProfessionalReportHTML, generateSimpleTwoPageReport } from '../templates/report-html'
import { generateSolarProposalHTML } from '../templates/solar-proposal'
import { generateTraceBasedDiagramSVG } from '../templates/svg-diagrams'
import { generateCustomerReportHTML } from '../templates/customer-report-html'
import { RoofMeasurementEngine, traceUiToEnginePayload, calculateRoofSpecs, type TraceReport } from '../services/roof-measurement-engine'
import { ROOF_PITCH_MULTIPLIERS, HIP_VALLEY_MULTIPLIERS } from '../services/pitch'
import { validateTraceUi, resolveEaves, allEavePoints } from '../utils/trace-validation'
import { enhanceTraceWithAI } from '../services/trace-enhancer'
import { resolvePitch } from '../services/pitch-resolver'
import { generatePanelLayout } from '../services/solar-panel-layout'
import { estimateMaterials, generateAccuLynxCSV, generateXactimateXML, type DetailedMaterialBOM } from '../services/material-estimation-engine'
import { enhanceReportViaGemini } from '../services/gemini-enhance'
import { enrichReportWithFlashing } from '../services/flashing-enrichment'
import { enrichReportWithGutters } from '../services/gutter-enrichment'
import { segmentWithGemini, geminiOutlineToTracePayload } from '../services/sam3-segmentation'
import { generateReportImagery, buildAIImageryHTML } from '../services/ai-image-generation'
import { buildEmailWrapper, buildReportLinkEmail, sendGmailEmail, sendViaResend, sendGmailOAuth2, loadGmailCreds, getOrCreateShareToken } from '../services/email'
import { signPdfUrl } from '../services/pdf-signing'
import { debitCredit, refundCredit } from '../services/api-billing'
import { deliverWebhook, buildWebhookPayload } from '../services/api-webhook'

// Cloud Run Custom AI (Colab-trained model)
import {
  buildCloudRunConfig, checkCloudRunHealth, analyzeViaCloudRun, batchAnalyzeViaCloudRun,
  convertToVisionFindings, convertToAIGeometry, mergeVisionFindings,
  type CloudRunAIConfig, type CloudRunHealthResponse
} from '../services/cloud-run-ai'

// Repository
import * as repo from '../repositories/reports'
import * as insRepo from '../repositories/insurance'
import { renderInsuranceAppendix, renderStatusBadge } from '../templates/insurance-sections'

// GA4 Server-Side Event Tracking
import { trackReportGenerated, trackReportEnhanced, trackEmailSent } from '../services/ga4-events'

// Report Semantic Search
import { embedAndStoreReport, generateQueryEmbedding, searchReports, buildReportSearchText } from '../services/report-search'

// Validation
import { parseBody, ValidationError, toggleSegmentsBody, visionFilterQuery, datalayersAnalyzeBody, emailBody } from '../utils/validation'

/**
 * Compute a sensible center lat/lng for the static-map satellite tile from
 * the user-traced eaves polygon(s). Returns the bbox-center across every
 * traced eave point so the entire roof is in frame even when the geocoded
 * address pin lands off-roof (corner lots, deep setbacks, multi-structure).
 * Returns null if no usable trace exists — caller falls back to address.
 */
function computeTracedImageryCenter(traceData: any): { lat: number; lng: number } | null {
  if (!traceData) return null
  const points: { lat: number; lng: number }[] = []
  const collect = (arr: any) => {
    if (!Array.isArray(arr)) return
    for (const p of arr) {
      if (p && typeof p.lat === 'number' && typeof p.lng === 'number') points.push(p)
    }
  }
  if (Array.isArray(traceData.eaves_sections)) {
    for (const sec of traceData.eaves_sections) collect(sec)
  }
  collect(traceData.eaves)
  collect(traceData.eaves_outline)
  if (points.length < 3) return null
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat
    if (p.lat > maxLat) maxLat = p.lat
    if (p.lng < minLng) minLng = p.lng
    if (p.lng > maxLng) maxLng = p.lng
  }
  return { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 }
}

/** Mean of classifier_confidence across edges; null when no classifier data is present. */
function avgEdgeConfidence(edges: any[] | undefined): number | null {
  if (!Array.isArray(edges) || edges.length === 0) return null
  const vals = edges
    .map((e: any) => Number(e?.classifier_confidence))
    .filter(v => Number.isFinite(v))
  if (vals.length === 0) return null
  return vals.reduce((s, v) => s + v, 0) / vals.length
}

export const reportsRoutes = new Hono<{ Bindings: Bindings }>()

// ── GLOBAL ERROR HANDLER ──
reportsRoutes.onError((err, c) => {
  if (err instanceof ValidationError) return c.json({ error: err.message }, 400)
  console.error(`[Reports] Unhandled error: ${err.message}`)
  return c.json({ error: 'Internal server error', details: err.message }, 500)
})

// ── AUTH MIDDLEWARE ──
async function validateAdminOrCustomer(c: any) {
  const db: D1Database = c.env.DB
  const authHeader = c.req.header('Authorization')
  const cookieHeader = c.req.header('Cookie')
  const admin = await validateAdminSession(db, authHeader, cookieHeader)
  if (admin) return { ...admin, role: 'admin' }
  const token = getCustomerSessionToken(c)
  if (!token) return null
  const session = await db.prepare(`
    SELECT cs.customer_id, c.email, c.name FROM customer_sessions cs
    JOIN customers c ON c.id = cs.customer_id
    WHERE cs.session_token = ? AND cs.expires_at > datetime('now')
  `).bind(token).first<any>()
  if (!session) return null
  // Resolve team membership — team members access owner's reports
  const teamInfo = await resolveTeamOwner(db, session.customer_id)
  return { id: teamInfo.ownerId, email: session.email, name: session.name, role: 'customer', isTeamMember: teamInfo.isTeamMember, realCustomerId: session.customer_id }
}

// Genuine webhooks + pure-compute endpoints that don't expose stored report data
// stay public. Everything that returns a saved report (html/pdf/proposal/exports)
// REQUIRES auth + ownership check — closes the IDOR where any anonymous request
// to /api/reports/<numeric-id>/{html,pdf,...} previously returned full report data.
const PUBLIC_WEBHOOK_SUFFIXES = ['/webhook-update', '/webhooks/resend']
const PUBLIC_COMPUTE_SUFFIXES = ['/calculate-from-trace', '/pitch-multipliers', '/calculate-roof-specs']
const OWNERSHIP_GATED_SUFFIXES = ['/html', '/simple', '/proposal', '/pdf', '/customer-html', '/customer-pdf', '/export.json', '/export.csv', '/solar-panel-layout', '/bom', '/bom.csv', '/bom.xml', '/enhancement-status']

reportsRoutes.use('/*', async (c, next) => {
  const path = c.req.path
  if (PUBLIC_WEBHOOK_SUFFIXES.some(s => path.endsWith(s))) return next()
  if (PUBLIC_COMPUTE_SUFFIXES.some(s => path.endsWith(s))) return next()

  const user = await validateAdminOrCustomer(c)
  if (!user) return c.json({ error: 'Authentication required' }, 401)
  c.set('user' as any, user)

  // For report-viewer endpoints, verify ownership before letting the handler
  // run. Admins bypass; customers must own the order. Path shape is
  // /api/reports/:id/<suffix> — extract :id from the path.
  if (user.role !== 'admin' && OWNERSHIP_GATED_SUFFIXES.some(s => path.endsWith(s))) {
    const m = path.match(/\/reports\/(\d+)\//)
    if (m) {
      const reportId = Number(m[1])
      if (Number.isFinite(reportId)) {
        const owner = await c.env.DB.prepare(
          `SELECT o.customer_id FROM reports r JOIN orders o ON o.id = r.order_id WHERE r.id = ?`
        ).bind(reportId).first<{ customer_id: number }>()
        if (!owner) return c.json({ error: 'Report not found' }, 404)
        if (owner.customer_id !== (user as any).id) {
          return c.json({ error: 'Forbidden' }, 403)
        }
      }
    }
  }

  return next()
})

// ── HELPER: regenerate HTML from stored JSON ──
function tryRegenHtml(jsonStr: string): string | null {
  try {
    const d = JSON.parse(jsonStr)
    if (d?.property?.address && Array.isArray(d.segments) && d.segments.length > 0) {
      return generateProfessionalReportHTML(d as RoofReport)
    }
  } catch {}
  return null
}

// Marker we embed in cached HTML to know it was rendered by the current
// template version. Has to match the marker in report-html.ts. When the
// stored HTML's marker doesn't match, we re-render and overwrite the cache.
const CACHED_HTML_TEMPLATE_MARKER = 'v6.1-multistructure-fix-2026-05-12'

function isCachedHtmlFresh(stored: string | null): boolean {
  if (!stored) return false
  // Cached HTML must not be the broken fallback page and must carry the
  // current template version marker (emitted by generateProfessionalReportHTML).
  if (stored.includes('HTML rendering failed')) return false
  if (!stored.includes(CACHED_HTML_TEMPLATE_MARKER)) return false
  // Sanity-check it's an actual report and not some empty stub.
  if (stored.length < 5000) return false
  return true
}

function resolveHtml(stored: string | null, raw: string | null): string | null {
  // Prefer fresh cached HTML — multi-structure renders are CPU-heavy and
  // Cloudflare Workers' per-request budget can silently push them into the
  // catch-fallback. Caching the first successful render and serving that
  // sidesteps the CPU pressure on every subsequent view.
  if (isCachedHtmlFresh(stored)) return stored
  if (raw) {
    const h = tryRegenHtml(raw)
    if (h) return h
  }
  if (stored) {
    const h = tryRegenHtml(stored)
    if (h) return h
    if (stored.trimStart().startsWith('<!DOCTYPE') || stored.trimStart().startsWith('<html')) return stored
    return stored
  }
  return null
}

// ============================================================
// GET /list — List all reports (for invoice/proposal attachment picker)
// ============================================================
reportsRoutes.get('/list', async (c) => {
  try {
    const reports = await c.env.DB.prepare(`
      SELECT r.id, r.order_id, r.status, r.roof_area_sqft, r.roof_pitch_ratio,
             r.total_material_cost_cad, r.gross_squares, r.created_at, r.updated_at,
             o.property_address, o.homeowner_name, o.order_number
      FROM reports r
      JOIN orders o ON o.id = r.order_id
      WHERE r.status IN ('completed', 'enhancing')
      ORDER BY r.created_at DESC
      LIMIT 100
    `).all()
    return c.json({ reports: reports.results })
  } catch (err: any) {
    return c.json({ reports: [], error: err.message })
  }
})

// ============================================================
// GET /pitch-multipliers — PUBLIC reference table
// Returns the industry-standard pitch multiplier lookup table
// used by the measurement engine (1/12 through 24/12).
// ============================================================
reportsRoutes.get('/pitch-multipliers', async (c) => {
  const table = Object.entries(ROOF_PITCH_MULTIPLIERS).map(([rise, multiplier]) => ({
    pitch_rise: Number(rise),
    pitch_label: `${rise}:12`,
    pitch_angle_deg: Math.round(Math.atan(Number(rise) / 12) * 180 / Math.PI * 100) / 100,
    area_multiplier: multiplier,
    hip_valley_multiplier: HIP_VALLEY_MULTIPLIERS[Number(rise)] ?? null,
  }))
  return c.json({
    success: true,
    engine_version: 'RoofMeasurementEngine v5.0',
    source: 'Industry-standard Pythagorean: √(rise² + 12²) / 12',
    reference: 'GAF / CertainTeed / IKO / EagleView standards',
    coverage: '0/12 through 24/12 (residential + commercial)',
    table,
  })
})

// ============================================================
// POST /calculate-roof-specs — PUBLIC quick calculator
// Takes flat dimensions + pitch, returns true sloped area.
// ============================================================
reportsRoutes.post('/calculate-roof-specs', async (c) => {
  try {
    const body = await c.req.json()
    const flatLength = Number(body.flat_length_ft || body.length || 0)
    const flatWidth = Number(body.flat_width_ft || body.width || 0)
    const pitchRise = Number(body.pitch_rise || body.pitch || 5)

    if (flatLength <= 0 || flatWidth <= 0) {
      return c.json({ success: false, error: 'flat_length_ft and flat_width_ft must be > 0' }, 400)
    }
    if (pitchRise < 0 || pitchRise > 30) {
      return c.json({ success: false, error: 'pitch_rise must be 0-30' }, 400)
    }

    const specs = calculateRoofSpecs(flatLength, flatWidth, pitchRise)
    return c.json({
      success: true,
      engine_version: 'RoofMeasurementEngine v5.0',
      input: { flat_length_ft: flatLength, flat_width_ft: flatWidth, pitch_rise: pitchRise },
      results: specs,
    })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500)
  }
})

// ============================================================
// GET /:orderId — Report data
// ============================================================
reportsRoutes.get('/:orderId', async (c) => {
  const report = await repo.getReportWithOrder(c.env.DB, c.req.param('orderId'))
  if (!report) return c.json({ error: 'Report not found' }, 404)
  return c.json({ report })
})

// ============================================================
// GET /:orderId/segments — Segment toggle UI
// ============================================================
reportsRoutes.get('/:orderId/segments', async (c) => {
  const row = await repo.getReportRawData(c.env.DB, c.req.param('orderId'))
  if (!row?.api_response_raw) return c.json({ error: 'Report not found' }, 404)
  const data: RoofReport = JSON.parse(row.api_response_raw)
  const excludedSet = new Set(data.excluded_segments || [])
  const segments = data.segments.map((seg, i) => ({
    index: i, ...seg, excluded: excludedSet.has(i)
  }))
  return c.json({
    order_id: parseInt(c.req.param('orderId')),
    total_segments: segments.length,
    excluded_count: excludedSet.size,
    active_count: segments.length - excludedSet.size,
    property_overlap_flag: data.property_overlap_flag || false,
    segments,
    active_totals: {
      footprint_sqft: data.total_footprint_sqft,
      true_area_sqft: data.total_true_area_sqft,
      gross_squares: data.materials?.gross_squares || 0,
      pitch_degrees: data.roof_pitch_degrees
    }
  })
})

// ============================================================
// GET /:orderId/html — Rendered report HTML (no auth for iframes)
// ============================================================
reportsRoutes.get('/:orderId/html', async (c) => {
  const orderId = c.req.param('orderId')
  const row = await repo.getReportHtml(c.env.DB, orderId)
  if (!row) return c.json({ error: 'Report not found' }, 404)
  // Admin-review gate: a report mid-review must NOT be reachable via the
  // public iframe URL. The super-admin preview UI hits the auth-gated
  // /api/admin/superadmin/orders/:id/preview-html instead. Returning 404
  // (not 403) so a customer guessing the URL gets the same response shape
  // as a never-rendered report.
  if (row.admin_review_status === 'awaiting_review') {
    return c.json({ error: 'Report not found' }, 404)
  }
  trackReportView(c, { orderId, viewType: 'portal' })
  const cacheWasFresh = isCachedHtmlFresh(row.professional_report_html)
  const html = resolveHtml(row.professional_report_html, row.api_response_raw)
  // Write-through cache: when we had to regenerate (cache was missing or
  // stale), persist the fresh render so subsequent views serve from D1
  // instead of re-running the heavy multi-structure pipeline. Fire-and-
  // forget; never blocks the response.
  if (!cacheWasFresh && html && html.includes('RENDER-PATH:') && html.length > 5000) {
    const persistPromise = c.env.DB
      .prepare('UPDATE reports SET professional_report_html = ? WHERE order_id = ?')
      .bind(html, orderId).run()
      .catch((e: any) => console.warn(`[html-cache] persist failed for ${orderId}:`, e?.message || e))
    if ((c as any).executionCtx?.waitUntil) {
      ;(c as any).executionCtx.waitUntil(persistPromise)
    }
  }
  if (!html) {
    const fallback = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Report Regeneration Required &mdash; Roof Manager</title><style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#f8fafc;color:#1e293b;margin:0;padding:48px 24px;display:flex;justify-content:center}.box{max-width:560px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:32px;box-shadow:0 1px 3px rgba(0,0,0,0.05)}h1{margin:0 0 12px;font-size:20px;color:#0f172a}p{line-height:1.55;color:#475569}.code{font-family:SF Mono,Menlo,monospace;font-size:13px;background:#f1f5f9;padding:2px 8px;border-radius:4px;color:#334155}.btn{display:inline-block;margin-top:16px;padding:10px 18px;background:#0f766e;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px}.btn:hover{background:#115e59}.muted{font-size:12px;color:#64748b;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:16px}</style></head><body><div class="box"><h1>Report regeneration required</h1><p>Order <span class="code">#${orderId}</span> finished without measurement data. This usually means the AI pipeline timed out or the satellite imagery returned an empty footprint. Your order is preserved &mdash; nothing was lost.</p><p>Re-run the generator from your dashboard, or contact support and we will regenerate it for you.</p><a class="btn" href="/customer/dashboard">Open dashboard</a> <a class="btn" style="background:#475569" href="mailto:support@roofmanager.ca?subject=Regenerate%20order%20${orderId}">Email support</a><div class="muted">Order ${orderId} &middot; Roof Manager &middot; roofmanager.ca</div></div></body></html>`
    return c.html(fallback, 404)
  }

  // Phase 2: append insurance-grade sections when populated. No-op for legacy reports.
  let augmented = html
  try {
    const idRow = await repo.getReportExistence(c.env.DB, orderId)
    if (idRow?.id) {
      const ext = await insRepo.getAllInsuranceExtensions(c.env.DB, idRow.id)
      const appendix = renderInsuranceAppendix(ext)
      const badge = renderStatusBadge(ext.claim)
      if (appendix) {
        // Append before </body>; fall back to suffix if no </body>.
        if (augmented.includes('</body>')) {
          augmented = augmented.replace('</body>', `${appendix}</body>`)
        } else {
          augmented = augmented + appendix
        }
      }
      if (badge) {
        // Inject badge near the top of <body>.
        augmented = augmented.replace('<body', '<body data-ins="1"').replace(/<body[^>]*>/, m => `${m}${badge}`)
      }
    }
  } catch (e) {
    // Never fail the report render because of insurance extensions.
    console.warn(`[insurance-ext] order ${orderId}: ${(e as any)?.message || e}`)
  }

  // Pro-tier: inject the "I measured this differently" widget. Appears as a
  // floating button bottom-right of the rendered report; opens a slide-over
  // modal that POSTs to /api/reports/:orderId/feedback.
  const proWidget = `<script>window.__ROOF_REPORT_ORDER_ID__=${JSON.stringify(orderId)};</script><script src="/static/measure.js" defer></script>`

  // Decide whether the cover already has a 3D oblique image — if not, we
  // inject a hidden auto-capture iframe so the FIRST view of any report
  // upgrades the cover with zero user action. One-shot per order.
  let hasOblique3d = false
  let oblique3dUrl = ''
  let oblique3dApproved = false
  let hasAerialViews = false
  let aerialViewsList: Array<{ heading: number; label: string; data_url: string }> = []
  let aerialViewsApproved = false
  try {
    const parsed = row.api_response_raw ? JSON.parse(row.api_response_raw) : null
    hasOblique3d = !!(parsed?.imagery?.oblique_3d_url)
    if (hasOblique3d) oblique3dUrl = parsed.imagery.oblique_3d_url
    oblique3dApproved = parsed?.imagery?.oblique_3d_approved === true
    hasAerialViews = Array.isArray(parsed?.imagery?.aerial_views) && parsed.imagery.aerial_views.length >= 4
    if (hasAerialViews) aerialViewsList = parsed.imagery.aerial_views
    aerialViewsApproved = parsed?.imagery?.aerial_views_approved === true
  } catch {}

  // Admin-only: aerial-views preview + approval pill. Shows 4 captured
  // thumbnails (NE/NW/SW/SE) and a "Show in customer report" toggle.
  // Customers never see this UI.
  const viewerUser = (c as any).get('user')
  const isAdminViewer = viewerUser?.role === 'admin'

  const autoCaptureBlock = hasOblique3d ? '' : `
<style>
  .rm-3d-autocap{position:fixed;bottom:90px;right:24px;z-index:99996;background:rgba(0,0,0,0.85);color:#fff;padding:10px 16px;border-radius:10px;font:600 12px -apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,0.3);display:flex;align-items:center;gap:8px;border:1px solid rgba(0,255,136,0.25)}
  .rm-3d-autocap .spin{display:inline-block;width:12px;height:12px;border:2px solid rgba(0,255,136,0.3);border-top-color:#00FF88;border-radius:50%;animation:rm3dspin 1s linear infinite}
  @keyframes rm3dspin{to{transform:rotate(360deg)}}
</style>
<div class="rm-3d-autocap" id="rm3dAutoCap"><span class="spin"></span><span>Generating 3D cover…</span></div>
<iframe id="rm3dAutoFrame" src="/3d-verify?autocapture=1&orderId=${encodeURIComponent(orderId)}" style="position:fixed;width:1280px;height:800px;left:-9999px;top:-9999px;border:0;pointer-events:none" referrerpolicy="strict-origin-when-cross-origin"></iframe>
<script>
  (function(){
    var banner = document.getElementById('rm3dAutoCap');
    var frame = document.getElementById('rm3dAutoFrame');
    var settled = false;
    function done(ok){
      if (settled) return; settled = true;
      try { frame.remove(); } catch(_){}
      if (ok && banner) {
        banner.innerHTML = '<span style="color:#00FF88">✓</span> 3D cover ready — refresh to view';
        setTimeout(function(){ try{location.reload();}catch(_){} }, 1200);
      } else if (banner) {
        banner.style.display = 'none';
      }
    }
    window.addEventListener('message', function(e){
      var d = e && e.data;
      if (d && d.type === 'rm-3d-cover-done' && d.orderId === ${JSON.stringify(orderId)}) done(!!d.ok);
    });
    // Safety timeout
    setTimeout(function(){ done(false); }, 35000);
  })();
</script>`

  // Aerials backstop — when the report has no 4-corner aerial views yet
  // (older orders, or capture failed on trace-save), inject a second hidden
  // iframe that runs the corners autocapture. Independent of the cover
  // block above so we can re-fill aerials even when the cover is fine.
  const aerialsCaptureBlock = hasAerialViews ? '' : `
<iframe id="rmAerialsAutoFrame" src="/3d-verify?autocapture=corners&orderId=${encodeURIComponent(orderId)}" style="position:fixed;width:1280px;height:800px;left:-9999px;top:-9999px;border:0;pointer-events:none" referrerpolicy="strict-origin-when-cross-origin"></iframe>
<script>
  (function(){
    var frame = document.getElementById('rmAerialsAutoFrame');
    var settled = false;
    function done(ok){
      if (settled) return; settled = true;
      try { frame.remove(); } catch(_){}
      if (ok) { setTimeout(function(){ try{location.reload();}catch(_){} }, 1500); }
    }
    window.addEventListener('message', function(e){
      var d = e && e.data;
      if (d && d.type === 'rm-3d-aerials-done' && d.orderId === ${JSON.stringify(orderId)}) done(!!d.ok);
    });
    setTimeout(function(){ done(false); }, 90000);
  })();
</script>`

  // 3D Cover capture widget — opens /3d-verify in a fullscreen modal iframe
  // with the orderId param so the page shows the "Save as Cover" button.
  // Captures a Photorealistic 3D Tiles oblique view and writes it to
  // imagery.oblique_3d_url on the report; the cover template renders it on
  // the next view. Bottom-right, sits to the LEFT of the feedback FAB.
  const cover3dWidget = `
<style>
  .rm-3d-fab{position:fixed;bottom:24px;right:240px;z-index:99997;background:#0A0A0A;color:#00FF88;border:1px solid #00FF88;border-radius:999px;padding:12px 18px;font:700 13px -apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(0,255,136,0.25);display:inline-flex;align-items:center;gap:8px;transition:transform .12s ease}
  .rm-3d-fab:hover{transform:translateY(-2px);background:#111}
  @media (max-width: 720px){.rm-3d-fab{right:24px;bottom:88px}}
  .rm-3d-overlay{position:fixed;inset:0;z-index:99998;background:rgba(0,0,0,0.88);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;padding:24px}
  .rm-3d-overlay.open{display:flex}
  .rm-3d-shell{position:relative;width:100%;height:100%;max-width:1400px;max-height:900px;background:#000;border-radius:14px;overflow:hidden;border:1px solid rgba(0,255,136,0.25);box-shadow:0 24px 60px rgba(0,0,0,0.6)}
  .rm-3d-shell iframe{width:100%;height:100%;border:0;background:#000}
  .rm-3d-close{position:absolute;top:10px;right:10px;width:36px;height:36px;border-radius:999px;border:1px solid rgba(255,255,255,0.2);background:rgba(0,0,0,0.7);color:#fff;font:700 16px sans-serif;cursor:pointer;z-index:5}
</style>
<button type="button" class="rm-3d-fab" id="rm3dFab" aria-label="Open 3D cover capture">🛰 Update 3D Cover</button>
<div class="rm-3d-overlay" id="rm3dOverlay" role="dialog" aria-modal="true">
  <div class="rm-3d-shell">
    <button type="button" class="rm-3d-close" id="rm3dClose" aria-label="Close 3D viewer">&times;</button>
    <iframe id="rm3dFrame" allow="fullscreen" referrerpolicy="strict-origin-when-cross-origin"></iframe>
  </div>
</div>
<script>
  (function(){
    var orderId = ${JSON.stringify(orderId)};
    var fab = document.getElementById('rm3dFab');
    var overlay = document.getElementById('rm3dOverlay');
    var frame = document.getElementById('rm3dFrame');
    var close = document.getElementById('rm3dClose');
    function logClick(){
      try {
        var url = '/api/reports/' + encodeURIComponent(orderId) + '/3d-tool-click';
        if (navigator.sendBeacon) {
          navigator.sendBeacon(url, new Blob([], { type: 'application/json' }));
        } else {
          fetch(url, { method: 'POST', keepalive: true, credentials: 'same-origin' });
        }
      } catch (e) { /* tracking must never break the click */ }
    }
    function open(){ logClick(); frame.src = '/3d-verify?orderId=' + encodeURIComponent(orderId); overlay.classList.add('open'); document.body.style.overflow='hidden'; }
    function dismiss(){ overlay.classList.remove('open'); frame.src = 'about:blank'; document.body.style.overflow=''; }
    fab.addEventListener('click', open);
    close.addEventListener('click', dismiss);
    overlay.addEventListener('click', function(e){ if (e.target === overlay) dismiss(); });
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && overlay.classList.contains('open')) dismiss(); });
  })();
</script>`

  // Admin-only preview/approval pill for the 4-corner aerial views.
  // Renders nothing for customers, nothing when no captures exist yet.
  const aerialAdminWidget = (isAdminViewer && hasAerialViews) ? (() => {
    const labelMap: Record<string, string> = { NE: 'Northeast', NW: 'Northwest', SW: 'Southwest', SE: 'Southeast' }
    const order = ['NE', 'NW', 'SW', 'SE']
    const tilesInOrder = order
      .map(lbl => aerialViewsList.find(v => String(v.label).toUpperCase() === lbl))
      .filter(Boolean) as typeof aerialViewsList
    const thumbsHtml = tilesInOrder.map(t => `
      <figure style="margin:0;display:flex;flex-direction:column;gap:4px">
        <div style="position:relative;border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,0.15);background:#000;aspect-ratio:4/3">
          <img src="${t.data_url}" alt="${labelMap[String(t.label).toUpperCase()] || t.label} aerial preview" style="width:100%;height:100%;object-fit:cover;display:block">
          <span style="position:absolute;top:4px;left:4px;background:rgba(0,0,0,0.7);color:#fff;font:700 9px -apple-system,Segoe UI,sans-serif;padding:2px 6px;border-radius:3px;letter-spacing:0.4px">${labelMap[String(t.label).toUpperCase()] || t.label}</span>
        </div>
      </figure>`).join('')
    const stateLabel = aerialViewsApproved ? 'Visible in customer report' : 'Hidden from customer report'
    const stateDotColor = aerialViewsApproved ? '#00FF88' : '#F59E0B'
    return `
<style>
  .rm-aerial-fab{position:fixed;bottom:24px;right:470px;z-index:99997;background:#0A0A0A;color:#FFD600;border:1px solid #FFD600;border-radius:999px;padding:12px 18px;font:700 13px -apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(255,214,0,0.25);display:inline-flex;align-items:center;gap:8px;transition:transform .12s ease}
  .rm-aerial-fab:hover{transform:translateY(-2px);background:#111}
  .rm-aerial-fab .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:${stateDotColor};box-shadow:0 0 8px ${stateDotColor}}
  @media (max-width: 1100px){.rm-aerial-fab{right:24px;bottom:152px}}
  .rm-aerial-panel{position:fixed;right:24px;bottom:80px;width:520px;max-width:calc(100vw - 48px);max-height:78vh;overflow:auto;z-index:99998;background:#0A0A0A;color:#fff;border:1px solid rgba(255,214,0,0.35);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.6);padding:18px;display:none;font:13px -apple-system,Segoe UI,Inter,sans-serif}
  .rm-aerial-panel.open{display:block}
  .rm-aerial-panel h3{margin:0 0 6px;font:800 15px -apple-system,Segoe UI,sans-serif;color:#FFD600;letter-spacing:0.2px}
  .rm-aerial-panel .sub{font-size:11.5px;color:#9CA3AF;margin-bottom:14px;line-height:1.4}
  .rm-aerial-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px}
  .rm-aerial-state{display:flex;align-items:center;gap:8px;font-size:12px;color:#E5E7EB;margin-bottom:10px}
  .rm-aerial-toggle{display:flex;align-items:center;gap:10px;background:#111;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:12px 14px;cursor:pointer;user-select:none}
  .rm-aerial-toggle:hover{background:#161616}
  .rm-aerial-toggle input{margin:0;width:18px;height:18px;accent-color:#00FF88;cursor:pointer}
  .rm-aerial-toggle .label{font-weight:700;font-size:13px}
  .rm-aerial-toggle .hint{font-size:11px;color:#9CA3AF;margin-top:2px}
  .rm-aerial-panel .close{position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:999px;border:1px solid rgba(255,255,255,0.18);background:transparent;color:#fff;font:700 14px sans-serif;cursor:pointer}
  .rm-aerial-panel .saving{display:none;color:#FFD600;font-size:11px;margin-left:8px}
  .rm-aerial-panel.saving .saving{display:inline}
</style>
<button type="button" class="rm-aerial-fab" id="rmAerialFab" aria-label="Aerial views admin preview">🛰 Aerial Views <span class="dot" aria-hidden="true"></span></button>
<div class="rm-aerial-panel" id="rmAerialPanel" role="dialog" aria-modal="false" aria-labelledby="rmAerialTitle">
  <button type="button" class="close" id="rmAerialClose" aria-label="Close aerial preview">&times;</button>
  <h3 id="rmAerialTitle">Aerial Views — Admin Preview</h3>
  <div class="sub">Four corner captures from Google Photorealistic 3D Tiles. Some areas return broken mesh geometry — verify each tile looks like a real roof before showing in the customer report.</div>
  <div class="rm-aerial-grid">${thumbsHtml}</div>
  <div class="rm-aerial-state"><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${stateDotColor}"></span><span id="rmAerialStateLabel">${stateLabel}</span><span class="saving">saving…</span></div>
  <label class="rm-aerial-toggle">
    <input type="checkbox" id="rmAerialApprove" ${aerialViewsApproved ? 'checked' : ''}>
    <span>
      <div class="label">Show in customer report</div>
      <div class="hint">Toggling reloads the report. Captures stay saved either way.</div>
    </span>
  </label>
</div>
<script>
  (function(){
    var orderId = ${JSON.stringify(orderId)};
    var fab = document.getElementById('rmAerialFab');
    var panel = document.getElementById('rmAerialPanel');
    var close = document.getElementById('rmAerialClose');
    var approve = document.getElementById('rmAerialApprove');
    var stateLabel = document.getElementById('rmAerialStateLabel');
    function openPanel(){ panel.classList.add('open'); }
    function closePanel(){ panel.classList.remove('open'); }
    fab.addEventListener('click', function(){
      if (panel.classList.contains('open')) closePanel(); else openPanel();
    });
    close.addEventListener('click', closePanel);
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closePanel(); });
    approve.addEventListener('change', function(){
      if (panel.classList.contains('saving')) return;
      panel.classList.add('saving');
      var approved = !!approve.checked;
      stateLabel.textContent = approved ? 'Saving — will show in customer report…' : 'Saving — will hide from customer report…';
      fetch('/api/reports/' + encodeURIComponent(orderId) + '/3d-aerials/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ approved: approved })
      }).then(function(r){ return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(function(){ setTimeout(function(){ try { location.reload(); } catch(_){} }, 350); })
        .catch(function(err){
          panel.classList.remove('saving');
          approve.checked = !approved;
          stateLabel.textContent = 'Save failed — ' + (err && err.message ? err.message : 'try again');
        });
    });
  })();
</script>`
  })() : ''

  // Admin-only preview/approval pill for the page-1 3D cover image.
  // Renders nothing for customers, nothing when no 3D capture exists yet.
  // Same approval pattern as aerialAdminWidget — capture stays saved
  // either way, only the toggle decides whether customers see it.
  const coverAdminWidget = (isAdminViewer && hasOblique3d) ? (() => {
    const stateLabel = oblique3dApproved ? 'Visible on customer report' : 'Hidden from customer report'
    const stateDotColor = oblique3dApproved ? '#00FF88' : '#F59E0B'
    return `
<style>
  .rm-cover-fab{position:fixed;bottom:24px;right:700px;z-index:99997;background:#0A0A0A;color:#7DD3FC;border:1px solid #7DD3FC;border-radius:999px;padding:12px 18px;font:700 13px -apple-system,BlinkMacSystemFont,Segoe UI,Inter,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(125,211,252,0.25);display:inline-flex;align-items:center;gap:8px;transition:transform .12s ease}
  .rm-cover-fab:hover{transform:translateY(-2px);background:#111}
  .rm-cover-fab .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:${stateDotColor};box-shadow:0 0 8px ${stateDotColor}}
  @media (max-width: 1400px){.rm-cover-fab{right:24px;bottom:216px}}
  .rm-cover-panel{position:fixed;right:24px;bottom:80px;width:480px;max-width:calc(100vw - 48px);max-height:78vh;overflow:auto;z-index:99998;background:#0A0A0A;color:#fff;border:1px solid rgba(125,211,252,0.35);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,0.6);padding:18px;display:none;font:13px -apple-system,Segoe UI,Inter,sans-serif}
  .rm-cover-panel.open{display:block}
  .rm-cover-panel h3{margin:0 0 6px;font:800 15px -apple-system,Segoe UI,sans-serif;color:#7DD3FC;letter-spacing:0.2px}
  .rm-cover-panel .sub{font-size:11.5px;color:#9CA3AF;margin-bottom:14px;line-height:1.4}
  .rm-cover-preview{position:relative;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,0.15);background:#000;margin-bottom:14px}
  .rm-cover-preview img{display:block;width:100%;height:auto;max-height:280px;object-fit:contain;background:#000}
  .rm-cover-state{display:flex;align-items:center;gap:8px;font-size:12px;color:#E5E7EB;margin-bottom:10px}
  .rm-cover-toggle{display:flex;align-items:center;gap:10px;background:#111;border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:12px 14px;cursor:pointer;user-select:none}
  .rm-cover-toggle:hover{background:#161616}
  .rm-cover-toggle input{margin:0;width:18px;height:18px;accent-color:#00FF88;cursor:pointer}
  .rm-cover-toggle .label{font-weight:700;font-size:13px}
  .rm-cover-toggle .hint{font-size:11px;color:#9CA3AF;margin-top:2px}
  .rm-cover-panel .close{position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:999px;border:1px solid rgba(255,255,255,0.18);background:transparent;color:#fff;font:700 14px sans-serif;cursor:pointer}
  .rm-cover-panel .saving{display:none;color:#7DD3FC;font-size:11px;margin-left:8px}
  .rm-cover-panel.saving .saving{display:inline}
</style>
<button type="button" class="rm-cover-fab" id="rmCoverFab" aria-label="3D cover approval">🖼 3D Cover <span class="dot" aria-hidden="true"></span></button>
<div class="rm-cover-panel" id="rmCoverPanel" role="dialog" aria-modal="false" aria-labelledby="rmCoverTitle">
  <button type="button" class="close" id="rmCoverClose" aria-label="Close cover preview">&times;</button>
  <h3 id="rmCoverTitle">3D Cover — Admin Preview</h3>
  <div class="sub">Photorealistic 3D Tiles capture used as the page-1 cover image. Some areas return broken mesh blobs — verify this looks like a real roof before showing it to the customer. Until approved, the report uses the clean nadir Google satellite.</div>
  <div class="rm-cover-preview"><img src="${oblique3dUrl}" alt="3D cover preview"></div>
  <div class="rm-cover-state"><span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${stateDotColor}"></span><span id="rmCoverStateLabel">${stateLabel}</span><span class="saving">saving…</span></div>
  <label class="rm-cover-toggle">
    <input type="checkbox" id="rmCoverApprove" ${oblique3dApproved ? 'checked' : ''}>
    <span>
      <div class="label">Use as customer cover image</div>
      <div class="hint">Toggling reloads the report. Capture stays saved either way.</div>
    </span>
  </label>
</div>
<script>
  (function(){
    var orderId = ${JSON.stringify(orderId)};
    var fab = document.getElementById('rmCoverFab');
    var panel = document.getElementById('rmCoverPanel');
    var close = document.getElementById('rmCoverClose');
    var approve = document.getElementById('rmCoverApprove');
    var stateLabel = document.getElementById('rmCoverStateLabel');
    function openPanel(){ panel.classList.add('open'); }
    function closePanel(){ panel.classList.remove('open'); }
    fab.addEventListener('click', function(){
      if (panel.classList.contains('open')) closePanel(); else openPanel();
    });
    close.addEventListener('click', closePanel);
    document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closePanel(); });
    approve.addEventListener('change', function(){
      if (panel.classList.contains('saving')) return;
      panel.classList.add('saving');
      var approved = !!approve.checked;
      stateLabel.textContent = approved ? 'Saving — will show on customer report…' : 'Saving — will hide from customer report…';
      fetch('/api/reports/' + encodeURIComponent(orderId) + '/3d-cover/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ approved: approved })
      }).then(function(r){ return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(function(){ setTimeout(function(){ try { location.reload(); } catch(_){} }, 350); })
        .catch(function(err){
          panel.classList.remove('saving');
          approve.checked = !approved;
          stateLabel.textContent = 'Save failed — ' + (err && err.message ? err.message : 'try again');
        });
    });
  })();
</script>`
  })() : ''

  const tail = `${autoCaptureBlock}${aerialsCaptureBlock}${cover3dWidget}${aerialAdminWidget}${coverAdminWidget}${proWidget}`
  if (augmented.includes('</body>')) {
    augmented = augmented.replace('</body>', `${tail}</body>`)
  } else {
    augmented = augmented + tail
  }
  return c.html(augmented)
})

// ============================================================
// GET /:orderId/customer-html — Customer-facing copy (no measurements)
// Aerial + 3D + 2D diagrams only. Built alongside the regular report.
// Open to any viewer with the link, mirrors /html semantics.
// ============================================================
reportsRoutes.get('/:orderId/customer-html', async (c) => {
  const orderId = c.req.param('orderId')
  const row = await repo.getCustomerReportHtml(c.env.DB, orderId)
  if (!row || !row.customer_report_html) {
    // Hard-restrict the reflected id to digits so we never echo attacker-
    // supplied HTML back into the page (the route handler upstream will
    // accept any string for :orderId).
    const safeId = String(orderId).replace(/[^0-9]/g, '').slice(0, 12) || '—'
    const fallback = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Customer Report Not Available</title><style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#f8fafc;color:#1e293b;margin:0;padding:48px 24px;display:flex;justify-content:center}.box{max-width:560px;background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:32px}h1{margin:0 0 12px;font-size:20px;color:#0f172a}p{line-height:1.55;color:#475569}</style></head><body><div class="box"><h1>Customer report not available</h1><p>The customer-facing copy for order #${safeId} has not been generated yet. It is created automatically when a new report is produced.</p></div></body></html>`
    return c.html(fallback, 404)
  }
  trackReportView(c, { orderId, viewType: 'portal' })
  return c.html(row.customer_report_html)
})

// ============================================================
// GET /:orderId/customer-pdf — Print-ready customer copy
// ============================================================
reportsRoutes.get('/:orderId/customer-pdf', async (c) => {
  const orderId = c.req.param('orderId')
  const row = await repo.getCustomerReportHtml(c.env.DB, orderId)
  if (!row || !row.customer_report_html) return c.json({ error: 'Customer report not found' }, 404)
  trackReportView(c, { orderId, viewType: 'pdf' })
  const html = row.customer_report_html
  const safe = String(orderId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)
  const pdfHtml = `${html}<script>
(function(){
  var sp = new URLSearchParams(location.search);
  if (sp.get('print') === '1') { setTimeout(function(){ window.print(); }, 500); return; }
  if (sp.get('save') === '1') {
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
    s.onload = function(){
      var overlay = document.createElement('div');
      overlay.id = 'rmPdfOverlay';
      overlay.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,0.92);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:18px;font-weight:600;z-index:2147483647;text-align:center;padding:24px;gap:16px';
      overlay.innerHTML = '<div>Generating PDF…</div><div style="font-size:13px;font-weight:400;opacity:0.75;max-width:420px">If your browser asks permission to download, click <b>Allow</b>. This tab will stay open.</div>';
      document.body.appendChild(overlay);
      function showResult(htmlStr){ overlay.style.display='flex'; overlay.innerHTML = htmlStr; var btn = document.getElementById('rmCloseBtn'); if (btn) btn.onclick = function(){ try { window.close(); } catch(e){} }; }
      setTimeout(function(){
        var source = document.body;
        overlay.style.display = 'none';
        document.querySelectorAll('svg').forEach(function(s){
          var r = s.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) {
            s.setAttribute('width',  Math.round(r.width));
            s.setAttribute('height', Math.round(r.height));
          }
        });
        window.html2pdf().set({
          margin:[10,10,10,10],
          filename:'Roof_Report_Customer_${safe}.pdf',
          image:{type:'jpeg',quality:0.95},
          html2canvas:{scale:2,useCORS:true,allowTaint:true,letterRendering:true,backgroundColor:'#ffffff',scrollX:0,scrollY:0,windowWidth:document.documentElement.scrollWidth,windowHeight:document.documentElement.scrollHeight},
          jsPDF:{unit:'mm',format:'a4',orientation:'portrait',compress:true},
          pagebreak:{mode:['css','legacy'],before:'.page+.page',avoid:['svg','img','.frame']}
        }).from(source).save().then(function(){
          showResult('<div style="font-size:22px">✓ PDF saved</div><div style="font-size:14px;font-weight:400;opacity:0.8;max-width:420px">Check your Downloads folder. You can close this tab.</div><button id="rmCloseBtn" style="margin-top:8px;padding:10px 20px;background:#10b981;color:#fff;border:0;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px">Close tab</button>');
        })['catch'](function(err){
          showResult('<div style="color:#fca5a5">PDF generation failed</div><div style="font-size:13px;font-weight:400;opacity:0.8">' + (err && err.message ? err.message : 'unknown error') + '</div>');
        });
      }, 1500);
    };
    document.head.appendChild(s);
  }
})();
</script>`
  return new Response(pdfHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `inline; filename="Roof_Report_Customer_${safe}.pdf"` } })
})

// ============================================================
// ============================================================
// GET /:orderId/proposal — Branded solar proposal (HTML, print-friendly)
// Open to any viewer with the link (matches /html semantics).
// Pulls customer branding + active variants from solar_panel_layout.
// ============================================================
reportsRoutes.get('/:orderId/proposal', async (c) => {
  const orderId = c.req.param('orderId')
  // Load order + report + customer branding in a single query.
  const row = await c.env.DB.prepare(`
    SELECT o.id, o.property_address, o.property_city, o.property_province, o.property_postal_code,
           o.homeowner_name, o.requester_name, o.requester_company, o.latitude, o.longitude,
           r.solar_panel_layout, r.satellite_image_url,
           c.brand_business_name, c.brand_logo_url, c.brand_primary_color, c.brand_secondary_color,
           c.brand_tagline, c.brand_phone, c.brand_email, c.brand_website, c.brand_license_number
    FROM orders o
    LEFT JOIN reports r ON r.order_id = o.id
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ?
  `).bind(orderId).first<any>()

  if (!row) return c.json({ error: 'Order not found' }, 404)
  if (!row.solar_panel_layout) {
    return c.html(`<html><body style="font-family:sans-serif;padding:40px"><h1>Proposal not ready</h1><p>No solar design has been saved for this report yet. <a href="/customer/solar-design?report_id=${orderId}">Open designer</a>.</p></body></html>`, 200)
  }
  trackReportView(c, { orderId, viewType: 'portal' })

  let layout: any
  try { layout = JSON.parse(row.solar_panel_layout) } catch { return c.json({ error: 'Corrupt layout data' }, 500) }

  const html = generateSolarProposalHTML({
    brand: {
      business_name: row.brand_business_name,
      logo_url: row.brand_logo_url,
      primary_color: row.brand_primary_color,
      secondary_color: row.brand_secondary_color,
      tagline: row.brand_tagline,
      phone: row.brand_phone,
      email: row.brand_email,
      website: row.brand_website,
      license_number: row.brand_license_number,
    },
    order: row,
    layout,
    satelliteUrl: row.satellite_image_url,
  })
  return c.html(html)
})

// ============================================================
// GET /:orderId/simple — Simple Two-Page Measurement Report (no auth for sharing/iframes)
// Returns the clean 2-page report: Page 1 Roof Diagram + Tables, Page 2 Summary + Satellite
// ============================================================
reportsRoutes.get('/:orderId/simple', async (c) => {
  const orderId = c.req.param('orderId')
  const row = await repo.getReportRawData(c.env.DB, orderId)
  if (!row) return c.json({ error: 'Report not found' }, 404)
  trackReportView(c, { orderId, viewType: 'portal' })
  try {
    const data = typeof row.api_response_raw === 'string' ? JSON.parse(row.api_response_raw) : row.api_response_raw
    if (!data || !data.segments) return c.json({ error: 'Report data incomplete — generate a full report first' }, 404)
    const html = generateSimpleTwoPageReport(data)
    return c.html(html)
  } catch (e: any) {
    return c.json({ error: 'Failed to render simple report: ' + (e.message || 'unknown error') }, 500)
  }
})

// ============================================================
// GET /:orderId/export.json — full measurement report JSON
// GET /:orderId/export.csv  — flat CSV for estimator import
// ============================================================
reportsRoutes.get('/:orderId/export.json', async (c) => {
  const orderId = c.req.param('orderId')
  const row = await repo.getReportRawData(c.env.DB, orderId)
  if (!row || !row.api_response_raw) return c.json({ error: 'Report not found' }, 404)
  let data: any
  try {
    data = typeof row.api_response_raw === 'string' ? JSON.parse(row.api_response_raw) : row.api_response_raw
  } catch (e: any) {
    const snippet = typeof row.api_response_raw === 'string' ? row.api_response_raw.slice(0, 200) : ''
    console.error(`[report-export] Corrupt JSON for order ${orderId}: ${e.message}. First 200 chars: ${snippet}`)
    return c.json({ error: 'Report data corrupt', details: e.message }, 500)
  }
  const body = JSON.stringify(data.trace_measurement || data, null, 2)
  return new Response(body, {
    headers: {
      'content-type': 'application/json',
      'content-disposition': `attachment; filename="roof-report-${orderId}.json"`,
    },
  })
})

reportsRoutes.get('/:orderId/export.csv', async (c) => {
  const orderId = c.req.param('orderId')
  const row = await repo.getReportRawData(c.env.DB, orderId)
  if (!row || !row.api_response_raw) return c.json({ error: 'Report not found' }, 404)
  let data: any
  try {
    data = typeof row.api_response_raw === 'string' ? JSON.parse(row.api_response_raw) : row.api_response_raw
  } catch (e: any) {
    const snippet = typeof row.api_response_raw === 'string' ? row.api_response_raw.slice(0, 200) : ''
    console.error(`[report-export] Corrupt JSON for order ${orderId}: ${e.message}. First 200 chars: ${snippet}`)
    return c.json({ error: 'Report data corrupt', details: e.message }, 500)
  }
  const tm = data.trace_measurement
  if (!tm) return c.json({ error: 'No measurement data on this report' }, 404)

  const esc = (v: any) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const rows: string[] = []
  rows.push('section,type,label,length_ft,area_ft2,pitch,notes')
  const km = tm.key_measurements || {}
  const lm = tm.linear_measurements || {}
  rows.push(['summary', 'footprint', 'Projected footprint', '', km.total_projected_footprint_ft2 ?? '', km.dominant_pitch_label ?? '', ''].map(esc).join(','))
  rows.push(['summary', 'sloped_area', 'True sloped area', '', km.total_roof_area_sloped_ft2 ?? '', km.dominant_pitch_label ?? '', ''].map(esc).join(','))
  rows.push(['summary', 'gross_squares', 'Gross squares (w/waste)', '', km.total_squares_gross_w_waste ?? '', '', `${km.waste_factor_pct ?? ''}% waste`].map(esc).join(','))

  rows.push(['linear', 'eaves', 'Total eaves', lm.eaves_total_ft ?? '', '', '', ''].map(esc).join(','))
  rows.push(['linear', 'ridges', 'Total ridges', lm.ridges_total_ft ?? '', '', '', ''].map(esc).join(','))
  rows.push(['linear', 'hips', 'Total hips', lm.hips_total_ft ?? '', '', '', ''].map(esc).join(','))
  rows.push(['linear', 'valleys', 'Total valleys', lm.valleys_total_ft ?? '', '', '', ''].map(esc).join(','))
  rows.push(['linear', 'rakes', 'Total rakes', lm.rakes_total_ft ?? '', '', '', ''].map(esc).join(','))

  for (const f of tm.face_details || []) {
    rows.push(['face', 'face', f.label || f.face_id || '', '', f.sloped_area_ft2 ?? '', `${f.pitch ?? ''}:12`, ''].map(esc).join(','))
  }
  for (const e of tm.eave_edge_breakdown || []) {
    rows.push(['edge', 'eave', `Edge #${e.edge_num}`, e.length_ft ?? e.length_2d_ft ?? '', '', '', `bearing ${e.bearing_deg ?? ''}°`].map(esc).join(','))
  }
  for (const o of tm.obstruction_details || []) {
    rows.push(['obstruction', o.type || 'other', o.label || '', '', o.sloped_area_ft2 ?? '', '', 'deducted'].map(esc).join(','))
  }
  const mat = tm.materials_estimate || {}
  const matLines: [string, string, any, any][] = [
    ['shingles_squares_net', 'Shingles (net squares)', '', mat.shingles_squares_net],
    ['shingles_squares_gross', 'Shingles (gross squares w/waste)', '', mat.shingles_squares_gross],
    ['shingles_bundles', 'Shingle bundles', '', mat.shingles_bundles],
    ['underlayment_rolls', 'Underlayment rolls', '', mat.underlayment_rolls],
    ['ice_water_shield_sqft', 'Ice & water shield (sqft)', '', mat.ice_water_shield_sqft],
    ['ridge_cap_lf', 'Ridge cap (lf)', mat.ridge_cap_lf, ''],
    ['starter_strip_lf', 'Starter strip (lf)', mat.starter_strip_lf, ''],
    ['drip_edge_total_lf', 'Drip edge (lf)', mat.drip_edge_total_lf, ''],
    ['valley_flashing_lf', 'Valley flashing (lf)', mat.valley_flashing_lf, ''],
    ['roofing_nails_lbs', 'Roofing nails (lbs)', '', mat.roofing_nails_lbs],
  ]
  for (const [k, label, lf, qty] of matLines) {
    rows.push(['material', k, label, lf, qty, '', ''].map(esc).join(','))
  }
  const le = km.labor_estimate
  if (le) rows.push(['labor', 'crew_hours', `Labor (crew of ${le.crew_size})`, '', le.total_crew_hours, '', `${le.est_days_min}-${le.est_days_max} days`].map(esc).join(','))
  const cc = tm.cross_check
  if (cc) rows.push(['cross_check', cc.source, 'External cross-check', '', cc.external_footprint_ft2, '', `engine ${cc.engine_footprint_ft2} sqft, ${cc.variance_pct}% variance (${cc.verdict})`].map(esc).join(','))

  return new Response(rows.join('\n') + '\n', {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="roof-report-${orderId}.csv"`,
    },
  })
})

// ============================================================
// POST /:orderId/generate — Report pipeline
// Generates base report as 'completed', then tries inline enhancement.
// Report is ALWAYS immediately available — enhancement is a bonus.
// ============================================================
reportsRoutes.post('/:orderId/generate', async (c) => {
  const orderId = c.req.param('orderId')

  // Generate base report (WELD + PAINT + POLISH — NO heavy AI)
  // This saves report as 'completed' immediately
  const result = await generateReportForOrder(orderId, c.env, (c as any).executionCtx)
  if (!result.success) {
    const status = result.error === 'Order not found' ? 404
      : result.error === 'Already in progress' ? 409
      : 500
    return c.json({ error: result.error, hint: result.error?.includes('timed out') ? 'Click Retry to re-generate' : undefined }, status)
  }

  // Enhancement and AI Imagery are NOT run inline anymore.
  // They caused Cloudflare Workers to timeout (>30s).
  // The dashboard polls /enhancement-status and the client
  // can trigger /enhance or /ai-imagery in separate requests.

  // ── API Order: finalize job, sign PDF URL, fire webhook ─────────────────
  finalizeApiJobIfNeeded(orderId, c.env).catch(err =>
    console.error('[API-finalize] Error finalizing API job for order', orderId, err)
  )

  return c.json({
    success: true,
    message: 'Report generated',
    orderId,
    status: 'completed',
    provider: result.provider,
    version: result.version,
    report: result.report,
    enhancement_available: result.hasEnhanceKey,
  })
})

// ============================================================
// POST /:orderId/3d-tool-click — Log a click on the "Update 3D Cover"
// FAB on the report page. Fire-and-forget from the client via
// navigator.sendBeacon. Uses the shared trackReportView helper, which
// downgrades admin self-clicks to view_type='admin' (so they're
// excluded from the headline 3D-tool count in super-admin reports).
// ============================================================
reportsRoutes.post('/:orderId/3d-tool-click', async (c) => {
  const orderId = c.req.param('orderId')
  const orderIdNum = Number(orderId)
  if (!Number.isFinite(orderIdNum) || orderIdNum <= 0) {
    return c.json({ error: 'Invalid order id' }, 400)
  }
  trackReportView(c, { orderId: orderIdNum, viewType: '3d_tool' })
  return c.json({ ok: true })
})

// ============================================================
// POST /:orderId/3d-cover — Save a Photorealistic 3D Tiles capture
// as the report's cover/overhead image. Captured by the /3d-verify
// page (Cesium) and POSTed back here as a JPEG data URL. We mutate
// reports.api_response_raw → imagery.oblique_3d_url so the cover
// template prefers it on next render.
// ============================================================
reportsRoutes.post('/:orderId/3d-cover', async (c) => {
  const orderId = c.req.param('orderId')
  const user = (c as any).get('user')
  if (!user) return c.json({ error: 'Authentication required' }, 401)

  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const dataUrl: string = (body?.image_data_url || '').toString()
  if (!dataUrl.startsWith('data:image/')) return c.json({ error: 'image_data_url must be a data:image/* URL' }, 400)
  // Cap at ~3MB after base64 decoding (≈4MB encoded). Reject obvious abuse.
  if (dataUrl.length > 4_400_000) return c.json({ error: 'Image too large (max ~3MB)' }, 413)

  // Ownership check for non-admins
  if (user.role !== 'admin') {
    const own = await c.env.DB.prepare('SELECT customer_id FROM orders WHERE id = ?').bind(orderId).first<{ customer_id: number | null }>()
    if (!own) return c.json({ error: 'Order not found' }, 404)
    if (own.customer_id && own.customer_id !== user.id) return c.json({ error: 'Forbidden' }, 403)
  }

  const row = await c.env.DB.prepare('SELECT api_response_raw FROM reports WHERE order_id = ?')
    .bind(orderId).first<{ api_response_raw: string | null }>()
  if (!row) return c.json({ error: 'Report not found' }, 404)

  let parsed: any = {}
  try { parsed = row.api_response_raw ? JSON.parse(row.api_response_raw) : {} } catch { parsed = {} }
  parsed.imagery = parsed.imagery || {}
  parsed.imagery.oblique_3d_url = dataUrl
  parsed.imagery.oblique_3d_captured_at = new Date().toISOString()

  await c.env.DB.prepare('UPDATE reports SET api_response_raw = ? WHERE order_id = ?')
    .bind(JSON.stringify(parsed), orderId).run()

  return c.json({ success: true, captured_at: parsed.imagery.oblique_3d_captured_at })
})

// ============================================================
// POST /:orderId/3d-cover/approve — Admin-only toggle that decides
// whether the captured Photorealistic 3D oblique image is used as the
// page-1 cover. Mirrors /3d-aerials/approve: capture is always stored,
// but the customer-facing report keeps the clean nadir satellite until
// an admin eyeballs the 3D capture and approves it. Google's 3D Tiles
// return broken-mesh blobs in some areas — this gate keeps those off
// the customer report.
// Body: { approved: boolean }. Writes imagery.oblique_3d_approved.
// ============================================================
reportsRoutes.post('/:orderId/3d-cover/approve', async (c) => {
  const orderId = c.req.param('orderId')
  const user = (c as any).get('user')
  if (!user || user.role !== 'admin') return c.json({ error: 'Admin only' }, 403)

  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const approved = body?.approved === true

  const row = await c.env.DB.prepare('SELECT api_response_raw FROM reports WHERE order_id = ?')
    .bind(orderId).first<{ api_response_raw: string | null }>()
  if (!row) return c.json({ error: 'Report not found' }, 404)

  let parsed: any = {}
  try { parsed = row.api_response_raw ? JSON.parse(row.api_response_raw) : {} } catch { parsed = {} }
  parsed.imagery = parsed.imagery || {}
  parsed.imagery.oblique_3d_approved = approved
  parsed.imagery.oblique_3d_approved_at = new Date().toISOString()
  parsed.imagery.oblique_3d_approved_by = user.id || user.email || 'admin'

  await c.env.DB.prepare('UPDATE reports SET api_response_raw = ? WHERE order_id = ?')
    .bind(JSON.stringify(parsed), orderId).run()

  return c.json({ success: true, approved })
})

// ============================================================
// POST /:orderId/3d-aerials — Save 4 corner aerial captures
// (NE/SE/SW/NW oblique birds-eye) from /3d-verify autocapture=corners.
// Stored as api_response_raw.imagery.aerial_views = [{heading,label,
// data_url,captured_at}]; the report template renders a 2×2 grid.
// ============================================================
reportsRoutes.post('/:orderId/3d-aerials', async (c) => {
  const orderId = c.req.param('orderId')
  const user = (c as any).get('user')
  if (!user) return c.json({ error: 'Authentication required' }, 401)

  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const images = Array.isArray(body?.images) ? body.images : null
  if (!images || images.length < 1 || images.length > 4) {
    return c.json({ error: 'images must be an array of 1-4 captures' }, 400)
  }

  const validLabels = new Set(['NE', 'SE', 'SW', 'NW'])
  const cleaned: Array<{ heading: number; label: string; data_url: string; captured_at: string }> = []
  const capturedAt = new Date().toISOString()
  for (const img of images) {
    const headingNum = Number(img?.heading)
    const label = String(img?.label || '').toUpperCase()
    const dataUrl = String(img?.data_url || '')
    if (!Number.isFinite(headingNum)) return c.json({ error: 'Each image needs numeric heading' }, 400)
    if (!validLabels.has(label)) return c.json({ error: 'label must be NE/SE/SW/NW' }, 400)
    if (!dataUrl.startsWith('data:image/')) return c.json({ error: 'data_url must be a data:image/* URL' }, 400)
    // Cap each at ~3MB after base64 decoding (≈4MB encoded). 4×4MB = 16MB max.
    if (dataUrl.length > 4_400_000) return c.json({ error: 'Image too large (max ~3MB each)' }, 413)
    cleaned.push({ heading: headingNum, label, data_url: dataUrl, captured_at: capturedAt })
  }

  // Ownership check for non-admins
  if (user.role !== 'admin') {
    const own = await c.env.DB.prepare('SELECT customer_id FROM orders WHERE id = ?').bind(orderId).first<{ customer_id: number | null }>()
    if (!own) return c.json({ error: 'Order not found' }, 404)
    if (own.customer_id && own.customer_id !== user.id) return c.json({ error: 'Forbidden' }, 403)
  }

  const row = await c.env.DB.prepare('SELECT api_response_raw FROM reports WHERE order_id = ?')
    .bind(orderId).first<{ api_response_raw: string | null }>()
  if (!row) return c.json({ error: 'Report not found' }, 404)

  let parsed: any = {}
  try { parsed = row.api_response_raw ? JSON.parse(row.api_response_raw) : {} } catch { parsed = {} }
  parsed.imagery = parsed.imagery || {}
  parsed.imagery.aerial_views = cleaned
  parsed.imagery.aerial_views_captured_at = capturedAt

  await c.env.DB.prepare('UPDATE reports SET api_response_raw = ? WHERE order_id = ?')
    .bind(JSON.stringify(parsed), orderId).run()

  return c.json({ success: true, count: cleaned.length, captured_at: capturedAt })
})

// ============================================================
// POST /:orderId/3d-aerials/approve — Admin-only toggle that decides
// whether the 4-corner Aerial Views page is included in the customer
// report. Captures still get stored on the report regardless; this flag
// gates rendering so we never ship broken Photorealistic 3D Tile meshes
// to a customer without an admin eyeballing them first.
// Body: { approved: boolean }. Writes imagery.aerial_views_approved.
// ============================================================
reportsRoutes.post('/:orderId/3d-aerials/approve', async (c) => {
  const orderId = c.req.param('orderId')
  const user = (c as any).get('user')
  if (!user || user.role !== 'admin') return c.json({ error: 'Admin only' }, 403)

  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'Invalid JSON' }, 400) }
  const approved = body?.approved === true

  const row = await c.env.DB.prepare('SELECT api_response_raw FROM reports WHERE order_id = ?')
    .bind(orderId).first<{ api_response_raw: string | null }>()
  if (!row) return c.json({ error: 'Report not found' }, 404)

  let parsed: any = {}
  try { parsed = row.api_response_raw ? JSON.parse(row.api_response_raw) : {} } catch { parsed = {} }
  parsed.imagery = parsed.imagery || {}
  parsed.imagery.aerial_views_approved = approved
  parsed.imagery.aerial_views_approved_at = new Date().toISOString()
  parsed.imagery.aerial_views_approved_by = user.id || user.email || 'admin'

  await c.env.DB.prepare('UPDATE reports SET api_response_raw = ? WHERE order_id = ?')
    .bind(JSON.stringify(parsed), orderId).run()

  return c.json({ success: true, approved })
})

// ============================================================
// POST /:orderId/retry — Reset and re-generate
// ============================================================
reportsRoutes.post('/:orderId/retry', async (c) => {
  const orderId = c.req.param('orderId')
  const report = await repo.getReportStatus(c.env.DB, orderId)
  if (!report) return c.json({ error: 'No report record found' }, 404)
  await repo.resetReportForRetry(c.env.DB, orderId)

  // Generate base report only — no enhancement or AI imagery inline
  const result = await generateReportForOrder(orderId, c.env, (c as any).executionCtx).catch(e => {
    console.error(`[Retry] ${orderId}:`, e.message)
    return { success: false, error: e.message } as any
  })

  return c.json({
    success: result?.success || false,
    message: result?.success ? 'Retry completed' : (result?.error || 'Retry failed'),
    previousStatus: report.status,
    status: result?.success ? 'completed' : 'failed',
    version: result?.version,
    enhancement_available: result?.hasEnhanceKey,
  })
})

// ============================================================
// POST /:orderId/toggle-segments — Exclude/include segments
// ============================================================
reportsRoutes.post('/:orderId/toggle-segments', async (c) => {
  const orderId = c.req.param('orderId')
  const body = parseBody(toggleSegmentsBody, await c.req.json())
  const row = await repo.getReportRawData(c.env.DB, orderId)
  if (!row?.api_response_raw) return c.json({ error: 'Report not found' }, 404)
  const data: RoofReport = JSON.parse(row.api_response_raw)
  const maxIdx = data.segments.length - 1
  data.excluded_segments = body.excluded_segments.filter(i => i >= 0 && i <= maxIdx)
  const active = data.segments.filter((_, i) => !data.excluded_segments!.includes(i))
  const totalFp = active.reduce((s, seg) => s + seg.footprint_area_sqft, 0)
  const totalTrue = active.reduce((s, seg) => s + seg.true_area_sqft, 0)
  data.total_footprint_sqft = totalFp
  data.total_true_area_sqft = totalTrue
  data.edges = generateEdgesFromSegments(active, totalFp)
  data.edge_summary = computeEdgeSummary(data.edges)
  data.materials = computeMaterialEstimate(totalTrue, data.edges, active)
  const html = generateProfessionalReportHTML(data)
  await repo.updateReportHtml(c.env.DB, orderId, html, JSON.stringify(data))
  return c.json({ success: true, excluded: data.excluded_segments, active_count: active.length })
})

// ============================================================
// POST /:orderId/vision-inspect — Trigger vision scan
// ============================================================
reportsRoutes.post('/:orderId/vision-inspect', async (c) => {
  const orderId = c.req.param('orderId')
  const report = await repo.getReportForVision(c.env.DB, orderId)
  if (!report) return c.json({ error: 'Report not found' }, 404)
  let imgUrl = report.satellite_image_url as string | null
  if (!imgUrl && report.api_response_raw) {
    try { const d = JSON.parse(report.api_response_raw); imgUrl = d.imagery?.satellite_overhead_url || d.imagery?.satellite_url } catch {}
  }
  if (!imgUrl) return c.json({ error: 'No satellite image available' }, 400)
  if (!c.env.GCP_SERVICE_ACCOUNT_KEY && !c.env.GOOGLE_VERTEX_API_KEY) return c.json({ error: 'No GCP credentials' }, 400)
  const vf = await visionScan(imgUrl, {
    apiKey: c.env.GOOGLE_VERTEX_API_KEY, project: c.env.GOOGLE_CLOUD_PROJECT,
    location: c.env.GOOGLE_CLOUD_LOCATION || 'us-central1', serviceAccountKey: c.env.GCP_SERVICE_ACCOUNT_KEY
  }, { model: 'gemini-2.0-flash', timeoutMs: 45000, sourceType: 'satellite_overhead' })
  await repo.updateVisionFindings(c.env.DB, orderId, JSON.stringify(vf))
  return c.json({ success: true, ...vf })
})

// ============================================================
// GET /:orderId/vision — Retrieve vision findings
// ============================================================
reportsRoutes.get('/:orderId/vision', async (c) => {
  const row = await repo.getVisionFindings(c.env.DB, c.req.param('orderId'))
  if (!row?.vision_findings_json) return c.json({ error: 'No vision inspection run yet' }, 404)
  const vf: VisionFindings = JSON.parse(row.vision_findings_json)
  const q = parseBody(visionFilterQuery, c.req.query())
  const filtered = filterFindings(vf.findings, { minConfidence: q.min_confidence, category: q.category as any, severity: q.severity as any })
  return c.json({ ...vf, findings: filtered, finding_count: filtered.length })
})

// ============================================================
// POST /:orderId/enhance-async — Dashboard-triggered enhancement
// Called by the customer dashboard AFTER base report is completed.
// Runs enhancement in its own HTTP request (own 30s budget).
// ============================================================
reportsRoutes.post('/:orderId/enhance-async', async (c) => {
  const orderId = c.req.param('orderId')
  const report = await repo.getReportRawData(c.env.DB, orderId)
  if (!report?.api_response_raw) return c.json({ error: 'Report not found' }, 404)

  const status = await repo.getReportStatus(c.env.DB, orderId)
  if (status?.status !== 'completed') {
    return c.json({ error: 'Report not yet completed', current_status: status?.status }, 400)
  }

  // Check if already enhanced
  const enhStatus = await repo.getEnhancementStatus(c.env.DB, orderId)
  if ((enhStatus as any)?.enhancement_status === 'completed') {
    return c.json({ success: true, already_enhanced: true, message: 'Report already enhanced' })
  }

  if (!c.env.GEMINI_ENHANCE_API_KEY) {
    return c.json({ success: false, error: 'Enhancement not available (no API key)' }, 400)
  }

  try {
    const reportData = JSON.parse(report.api_response_raw) as RoofReport
    const enhVer = await enhanceReportInline(orderId, reportData, c.env)

    // Auto-email enhanced report if customer has auto_email enabled
    if (enhVer) {
      try {
        const custRow = await c.env.DB.prepare(
          'SELECT c.auto_email_reports, c.email FROM customers c JOIN orders o ON o.customer_id=c.id WHERE o.id=?'
        ).bind(orderId).first<any>()
        if (custRow?.auto_email_reports === 1 && custRow?.email) {
          const enhReport = await repo.getReportHtml(c.env.DB, orderId)
          if (enhReport?.professional_report_html) {
            const order = await repo.getOrderById(c.env.DB, orderId)
            const shareToken = await getOrCreateShareToken(c.env, orderId)
            const baseEmailHtml = buildReportLinkEmail(new URL(c.req.url).origin, orderId, order?.property_address || '', `RM-${orderId}`, custRow.email, true, shareToken)
            const reportSubject = `Roof Report - ${order?.property_address || 'Property'}`
            // Tracking: customerId from the order. Self-trace copy to sales@
            // skipped — that's internal, not customer engagement.
            const custIdRow = await c.env.DB.prepare('SELECT customer_id FROM orders WHERE id=?').bind(orderId).first<any>()
            const trackingToken = await logEmailSend(c.env as any, { customerId: custIdRow?.customer_id ?? null, recipient: custRow.email, kind: 'report_delivery', subject: reportSubject })
            const pixel = buildTrackingPixel(trackingToken)
            const withPixel = baseEmailHtml.includes('</body>') ? baseEmailHtml.replace('</body>', `${pixel}</body>`) : baseEmailHtml + pixel
            const emailHtml = wrapEmailLinks(withPixel, trackingToken)
            const rt = (c.env as any).GMAIL_REFRESH_TOKEN, ci = (c.env as any).GMAIL_CLIENT_ID, cs = (c.env as any).GMAIL_CLIENT_SECRET
            if (rt && ci && cs) {
              try {
                await sendGmailOAuth2(ci, cs, rt, custRow.email, reportSubject, emailHtml, c.env.GMAIL_SENDER_EMAIL)
                console.log(`[AutoEmail] Enhanced report ${orderId} auto-sent to ${custRow.email}`)
              } catch (sendErr: any) {
                await markEmailFailed(c.env as any, trackingToken, String(sendErr?.message || sendErr))
                throw sendErr
              }
              try {
                await sendGmailOAuth2(ci, cs, rt, 'sales@roofmanager.ca', `[Self-Trace Copy] Roof Report - ${order?.property_address || 'Property'} (sent to ${custRow.email})`, baseEmailHtml, c.env.GMAIL_SENDER_EMAIL)
              } catch (salesErr: any) { console.warn(`[SalesCopy] Failed for order ${orderId}: ${salesErr.message}`) }
            } else {
              await markEmailFailed(c.env as any, trackingToken, 'gmail oauth creds missing')
            }
          }
        }
      } catch (emailErr: any) {
        console.warn(`[EnhanceAsync] Auto-email failed for order ${orderId}: ${emailErr.message}`)
      }
    }

    return c.json({
      success: true,
      enhanced: !!enhVer,
      version: enhVer || null,
      message: enhVer ? `Enhanced to v${enhVer}` : 'Enhancement skipped (Gemini returned null)',
    })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500)
  }
})

// ============================================================
// POST /:orderId/generate-imagery — Dashboard-triggered AI imagery
// Called AFTER base report is completed.
// Runs in its own HTTP request (own 30s timeout budget).
// ============================================================
reportsRoutes.post('/:orderId/generate-imagery', async (c) => {
  const orderId = c.req.param('orderId')
  const report = await repo.getReportRawData(c.env.DB, orderId)
  if (!report?.api_response_raw) return c.json({ error: 'Report not found' }, 404)

  const status = await repo.getReportStatus(c.env.DB, orderId)
  if (status?.status !== 'completed') {
    return c.json({ error: 'Report not yet completed', current_status: status?.status }, 400)
  }

  // Check if already generated
  const imgStatus = await repo.getAIImageryStatus(c.env.DB, orderId)
  if (imgStatus?.ai_imagery_status === 'completed') {
    return c.json({ success: true, already_generated: true, message: 'AI imagery already generated' })
  }

  try {
    const reportData = JSON.parse(report.api_response_raw) as RoofReport
    const success = await generateAIImageryForReport(orderId, reportData, c.env)
    return c.json({
      success,
      message: success ? 'AI imagery generated' : 'AI imagery skipped (no images generated)',
    })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500)
  }
})

// ============================================================
// POST /:orderId/enhance — Gemini Pro geometry upgrade
// ============================================================
reportsRoutes.post('/:orderId/enhance', async (c) => {
  const orderId = c.req.param('orderId')
  const report = await repo.getReportForEnhance(c.env.DB, orderId)
  if (!report) return c.json({ error: 'Report not found' }, 404)
  const order = await repo.getOrderById(c.env.DB, orderId)
  if (!order) return c.json({ error: 'Order not found' }, 404)

  let reportData: any = null
  try { reportData = report.api_response_raw ? JSON.parse(report.api_response_raw) : null } catch {}
  let imgUrl = reportData?.imagery?.satellite_overhead_url || reportData?.imagery?.satellite_url
  if (!imgUrl && order.latitude && order.longitude && c.env.GOOGLE_MAPS_API_KEY) {
    imgUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${order.latitude},${order.longitude}&zoom=20&size=640x640&scale=2&maptype=satellite&key=${c.env.GOOGLE_MAPS_API_KEY}`
  }
  if (!imgUrl) return c.json({ error: 'No satellite image' }, 400)
  if (!c.env.GOOGLE_VERTEX_API_KEY && !c.env.GCP_SERVICE_ACCOUNT_KEY) return c.json({ error: 'No Gemini credentials' }, 400)

  await repo.updateAiStatus(c.env.DB, orderId, 'processing')
  const geminiEnv = { apiKey: c.env.GOOGLE_VERTEX_API_KEY, project: c.env.GOOGLE_CLOUD_PROJECT, location: c.env.GOOGLE_CLOUD_LOCATION || 'us-central1', serviceAccountKey: c.env.GCP_SERVICE_ACCOUNT_KEY }
  const aiGeometry = await analyzeRoofGeometry(imgUrl, geminiEnv, { maxRetries: 2, timeoutMs: 180000, acceptScore: 15, model: 'gemini-2.5-pro' })
  if (!aiGeometry?.facets?.length) {
    await c.env.DB.prepare(`UPDATE reports SET ai_status='failed', ai_error='No facets', ai_analyzed_at=datetime('now'), updated_at=datetime('now') WHERE order_id=?`).bind(orderId).run()
    return c.json({ success: false, error: 'No usable geometry detected' }, 400)
  }

  // Re-generate segments/edges/materials from AI geometry
  const fp = report.roof_footprint_sqft || reportData?.total_footprint_sqft || 1500
  const pitch = report.roof_pitch_degrees || reportData?.roof_pitch_degrees || 20
  const aiSegments = generateSegmentsFromAIGeometry(aiGeometry, fp, pitch)
  if (reportData) {
    reportData.ai_geometry = aiGeometry
    if (aiSegments.length >= 2) {
      reportData.segments = aiSegments
      reportData.edges = generateEdgesFromSegments(aiSegments, fp)
      reportData.edge_summary = computeEdgeSummary(reportData.edges)
      reportData.materials = computeMaterialEstimate(reportData.total_true_area_sqft || fp * 1.1, reportData.edges, aiSegments)
    }
  }
  const html = reportData ? generateProfessionalReportHTML(reportData) : null
  const pairs: [string, any][] = [['ai_measurement_json = ?', JSON.stringify(aiGeometry)], ['api_response_raw = ?', JSON.stringify(reportData)]]
  if (aiSegments.length >= 2) { pairs.push(['roof_segments = ?', JSON.stringify(aiSegments)], ['edge_measurements = ?', JSON.stringify(reportData?.edges)]) }
  if (reportData?.edge_summary) { const es = reportData.edge_summary; pairs.push(['total_ridge_ft=?', es.total_ridge_ft], ['total_hip_ft=?', es.total_hip_ft], ['total_valley_ft=?', es.total_valley_ft], ['total_eave_ft=?', es.total_eave_ft], ['total_rake_ft=?', es.total_rake_ft]) }
  if (reportData?.materials) { const m = reportData.materials; pairs.push(['material_estimate=?', JSON.stringify(m)], ['gross_squares=?', m.gross_squares], ['bundle_count=?', m.bundle_count], ['total_material_cost_cad=?', m.total_material_cost_cad], ['complexity_class=?', m.complexity_class]) }
  if (html) pairs.push(['professional_report_html=?', html])
  const fields = pairs.map(p => p[0]); fields.push("ai_status='completed'", "ai_analyzed_at=datetime('now')", "updated_at=datetime('now')")
  await c.env.DB.prepare(`UPDATE reports SET ${fields.join(', ')} WHERE order_id=?`).bind(...pairs.map(p => p[1]), orderId).run()
  return c.json({ success: true, facets: aiGeometry.facets.length, lines: aiGeometry.lines.length })
})

// ============================================================
// POST /:orderId/trace-insights — Compile traced coordinates for
// Solar API roofSegmentStats-focused analysis
// ============================================================
reportsRoutes.post('/:orderId/trace-insights', async (c) => {
  const orderId = c.req.param('orderId')
  const order = await repo.getOrderById(c.env.DB, orderId)
  if (!order) return c.json({ error: 'Order not found' }, 404)

  if (!order.roof_trace_json) {
    return c.json({ error: 'No roof trace data found for this order. User must trace the roof outline first.' }, 400)
  }

  const trace = typeof order.roof_trace_json === 'string' ? JSON.parse(order.roof_trace_json) : order.roof_trace_json

  // Resolve eaves sections via shared helper (handles single/multi/legacy shapes)
  const resolved = resolveEaves(trace)
  const rawEaves = resolved.sections

  if (resolved.kind === 'none') {
    return c.json({ error: 'Invalid trace data — eaves polygon requires at least 3 points' }, 400)
  }

  const M_PER_DEG_LAT = 111320

  // Compute area + perimeter for each section, sum areas
  const computeSection = (pts: { lat: number; lng: number }[]) => {
    const cLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length
    const cLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length
    const M_PER_DEG_LNG = 111320 * Math.cos(cLat * Math.PI / 180)
    const proj = pts.map(p => ({ x: (p.lng - cLng) * M_PER_DEG_LNG, y: (p.lat - cLat) * M_PER_DEG_LAT }))
    let area = 0, perim = 0
    const n = proj.length
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      area += proj[i].x * proj[j].y - proj[j].x * proj[i].y
      const dx = proj[j].x - proj[i].x, dy = proj[j].y - proj[i].y
      perim += Math.sqrt(dx * dx + dy * dy)
    }
    return { areaM2: Math.abs(area) / 2, perimeterM: perim, center: { lat: cLat, lng: cLng } }
  }

  // Primary section (largest) for perimeter/center; all sections contribute area
  const sections = rawEaves.map(computeSection)
  const primarySec = sections.reduce((best, s) => s.areaM2 > best.areaM2 ? s : best, sections[0])
  const totalAreaM2 = sections.reduce((s, sec) => s + sec.areaM2, 0)
  const areaM2 = totalAreaM2
  const areaSqft = Math.round(totalAreaM2 * 10.7639)
  const perimeterM = primarySec.perimeterM
  const perimeterFt = Math.round(perimeterM * 3.28084)
  const n = rawEaves[0].length
  const eavePoints = rawEaves[0]

  // Count ridge/hip/valley lines and compute their total lengths
  const computeLineLength = (line: { lat: number; lng: number }[]) => {
    if (line.length < 2) return 0
    let len = 0
    for (let i = 0; i < line.length - 1; i++) {
      const dx = (line[i + 1].lng - line[i].lng) * M_PER_DEG_LNG
      const dy = (line[i + 1].lat - line[i].lat) * M_PER_DEG_LAT
      len += Math.sqrt(dx * dx + dy * dy)
    }
    return len
  }

  const ridgeLengthFt = Math.round((trace.ridges || []).reduce((s: number, l: any) => s + computeLineLength(l), 0) * 3.28084)
  const hipLengthFt = Math.round((trace.hips || []).reduce((s: number, l: any) => s + computeLineLength(l), 0) * 3.28084)
  const valleyLengthFt = Math.round((trace.valleys || []).reduce((s: number, l: any) => s + computeLineLength(l), 0) * 3.28084)

  // Build structured roof insights from traced geometry
  const insights = {
    order_id: orderId,
    source: 'user_traced',
    traced_at: trace.traced_at,
    eaves_polygon: {
      vertices: eavePoints.length,
      section_count: rawEaves.length,
      area_m2: Math.round(areaM2 * 100) / 100,
      area_sqft: areaSqft,
      perimeter_m: Math.round(perimeterM * 100) / 100,
      perimeter_ft: perimeterFt,
      center: primarySec.center
    },
    edge_summary: {
      ridge_count: (trace.ridges || []).length,
      ridge_total_ft: ridgeLengthFt,
      hip_count: (trace.hips || []).length,
      hip_total_ft: hipLengthFt,
      valley_count: (trace.valleys || []).length,
      valley_total_ft: valleyLengthFt,
      eave_total_ft: perimeterFt,
      total_linear_ft: ridgeLengthFt + hipLengthFt + valleyLengthFt + perimeterFt
    },
    // Estimate segment count from traced geometry
    estimated_segment_count: Math.max(2, (trace.ridges?.length || 0) * 2 + (trace.hips?.length || 0)),
    // This data is designed to enhance or override Google Solar API buildingInsights
    solar_api_override: {
      use_traced_footprint: true,
      footprint_area_sqft: areaSqft,
      footprint_area_m2: Math.round(areaM2 * 100) / 100,
      coordinates: { lat: order.latitude, lng: order.longitude }
    }
  }

  return c.json({ success: true, insights })
})

// ============================================================
// POST /:orderId/trace-remeasure — Re-measure roof using ONLY
// user-traced coordinates. Never trust Solar API blindly.
//
// Runs the RoofMeasurementEngine on the trace data, cross-checks
// against Solar API numbers, regenerates the SVG diagram from
// the actual eaves polygon, and updates the report.
// ============================================================
reportsRoutes.post('/:orderId/trace-remeasure', async (c) => {
  const orderId = c.req.param('orderId')
  const order = await repo.getOrderById(c.env.DB, orderId)
  if (!order) return c.json({ error: 'Order not found' }, 404)

  if (!order.roof_trace_json) {
    return c.json({ error: 'No roof trace data. User must trace the roof outline first.' }, 400)
  }

  const trace = typeof order.roof_trace_json === 'string' ? JSON.parse(order.roof_trace_json) : order.roof_trace_json

  const hasEaves = (trace.eaves_sections && trace.eaves_sections.length > 0 && trace.eaves_sections[0].length >= 3)
    || (Array.isArray(trace.eaves) && trace.eaves.length >= 3)
  if (!hasEaves) {
    return c.json({ error: 'Need at least 3 eave points. Trace every corner of the house.' }, 400)
  }

  // Get existing report for cross-check data
  const existingReport = await repo.getReportRawData(c.env.DB, orderId)
  let reportData: RoofReport | null = null
  if (existingReport?.api_response_raw) {
    try {
      reportData = typeof existingReport.api_response_raw === 'string'
        ? JSON.parse(existingReport.api_response_raw)
        : existingReport.api_response_raw
    } catch (e) { /* ignore */ }
  }

  // Build Solar API cross-check payload from existing report
  const solarApiData: any = {}
  if (reportData) {
    solarApiData.footprint_sqft = reportData.total_footprint_sqft || 0
    solarApiData.true_area_sqft = reportData.total_true_area_sqft || 0
    solarApiData.pitch_degrees = reportData.roof_pitch_degrees || 0
    if (reportData.edge_summary) {
      solarApiData.edge_summary = {
        total_ridge_ft: reportData.edge_summary.total_ridge_ft || 0,
        total_hip_ft: reportData.edge_summary.total_hip_ft || 0,
        total_valley_ft: reportData.edge_summary.total_valley_ft || 0,
        total_eave_ft: reportData.edge_summary.total_eave_ft || 0,
        total_rake_ft: reportData.edge_summary.total_rake_ft || 0,
      }
    }
  }

  // Determine default pitch from existing report or DSM data
  const defaultPitchDeg = reportData?.roof_pitch_degrees || 20
  const defaultPitchRise = Math.round(12 * Math.tan(defaultPitchDeg * Math.PI / 180) * 10) / 10

  // Convert trace UI format to engine payload and run measurement
  const enginePayload = traceUiToEnginePayload(
    trace,
    {
      property_address: order.property_address || '',
      homeowner_name: order.homeowner_name || '',
      order_number: order.order_number || '',
      latitude: order.latitude,
      longitude: order.longitude,
      price_per_bundle: order.price_per_bundle,
    },
    defaultPitchRise
  )

  const engine = new RoofMeasurementEngine(enginePayload)
  const traceReport = engine.run()

  console.log(`[TraceRemeasure] Order ${orderId}: Engine completed — ` +
    `footprint=${traceReport.key_measurements.total_projected_footprint_ft2}sqft, ` +
    `sloped=${traceReport.key_measurements.total_roof_area_sloped_ft2}sqft, ` +
    `eave_pts=${traceReport.key_measurements.num_eave_points}, ` +
    `pitch=${traceReport.key_measurements.dominant_pitch_label}`)

  // Cross-check against Solar API data
  const crossChecks: any[] = []
  if (solarApiData.footprint_sqft) {
    const diff = Math.abs(traceReport.key_measurements.total_projected_footprint_ft2 - solarApiData.footprint_sqft) / solarApiData.footprint_sqft * 100
    crossChecks.push({
      parameter: 'footprint_sqft',
      engine: traceReport.key_measurements.total_projected_footprint_ft2,
      solar_api: solarApiData.footprint_sqft,
      difference_pct: Math.round(diff * 10) / 10,
      verdict: diff <= 5 ? 'MATCH' : diff <= 15 ? 'MINOR_DIFF' : diff <= 30 ? 'SIGNIFICANT_DIFF' : 'CRITICAL'
    })
  }

  // Generate trace-based SVG diagram
  const traceSVG = generateTraceBasedDiagramSVG(
    trace,
    {
      total_ridge_ft: traceReport.linear_measurements.ridges_total_ft,
      total_hip_ft: traceReport.linear_measurements.hips_total_ft,
      total_valley_ft: traceReport.linear_measurements.valleys_total_ft,
      total_eave_ft: traceReport.linear_measurements.eaves_total_ft,
      total_rake_ft: traceReport.linear_measurements.rakes_total_ft,
      total_step_flashing_ft:     traceReport.linear_measurements.step_flashing_total_ft || 0,
      total_headwall_flashing_ft: traceReport.linear_measurements.headwall_flashing_total_ft || 0,
      chimney_flashing_count:     traceReport.linear_measurements.chimney_flashing_count || 0,
      pipe_boot_count:            traceReport.linear_measurements.pipe_boot_count || 0,
    },
    traceReport.key_measurements.total_projected_footprint_ft2,
    traceReport.key_measurements.dominant_pitch_angle_deg,
    traceReport.key_measurements.dominant_pitch_label,
    traceReport.key_measurements.total_squares_gross_w_waste,
    traceReport.key_measurements.total_roof_area_sloped_ft2
  )

  // If we have a report, update it with trace-based measurements
  if (reportData) {
    // Inject trace measurements into report
    reportData.roof_trace = trace
    ;(reportData as any).trace_measurement = traceReport
    ;(reportData as any).trace_diagram_svg = traceSVG

    // Add cross-check notes to quality
    reportData.quality = reportData.quality || { notes: [] }
    reportData.quality.notes = reportData.quality.notes || []
    reportData.quality.notes.push(
      `Trace-based remeasurement: ${traceReport.key_measurements.num_eave_points} eave points, ${traceReport.key_measurements.num_ridges} ridges, ${traceReport.key_measurements.num_valleys} valleys.`,
      `Engine footprint: ${traceReport.key_measurements.total_projected_footprint_ft2} sqft (vs Solar API ${solarApiData.footprint_sqft || 'N/A'} sqft).`,
      `Engine sloped area: ${traceReport.key_measurements.total_roof_area_sloped_ft2} sqft (vs Solar API ${solarApiData.true_area_sqft || 'N/A'} sqft).`
    )

    // Regenerate HTML with the trace diagram injected
    const html = generateProfessionalReportHTML(reportData)

    // Save updated report
    await c.env.DB.prepare(`UPDATE reports SET 
      api_response_raw = ?,
      professional_report_html = ?,
      roof_area_sqft = ?,
      roof_footprint_sqft = ?,
      total_ridge_ft = ?,
      total_hip_ft = ?,
      total_valley_ft = ?,
      total_eave_ft = ?,
      total_rake_ft = ?,
      updated_at = datetime('now')
      WHERE order_id = ?`
    ).bind(
      JSON.stringify(reportData),
      html,
      traceReport.key_measurements.total_projected_footprint_ft2,
      traceReport.key_measurements.total_projected_footprint_ft2,
      traceReport.linear_measurements.ridges_total_ft,
      traceReport.linear_measurements.hips_total_ft,
      traceReport.linear_measurements.valleys_total_ft,
      traceReport.linear_measurements.eaves_total_ft,
      traceReport.linear_measurements.rakes_total_ft,
      orderId
    ).run()

    console.log(`[TraceRemeasure] Order ${orderId}: Report updated with trace measurements and new SVG diagram`)
  }

  return c.json({
    success: true,
    trace_report: traceReport,
    cross_checks: crossChecks,
    trace_svg_generated: true,
    advisory_notes: traceReport.advisory_notes,
    summary: {
      eave_points: traceReport.key_measurements.num_eave_points,
      footprint_sqft: traceReport.key_measurements.total_projected_footprint_ft2,
      sloped_area_sqft: traceReport.key_measurements.total_roof_area_sloped_ft2,
      net_squares: traceReport.key_measurements.total_squares_net,
      gross_squares: traceReport.key_measurements.total_squares_gross_w_waste,
      dominant_pitch: traceReport.key_measurements.dominant_pitch_label,
      eaves_ft: traceReport.linear_measurements.eaves_total_ft,
      ridges_ft: traceReport.linear_measurements.ridges_total_ft,
      valleys_ft: traceReport.linear_measurements.valleys_total_ft,
      solar_api_footprint: solarApiData.footprint_sqft || null,
      solar_api_area: solarApiData.true_area_sqft || null,
    }
  })
})
// ============================================================
// ============================================================
// POST /calculate-from-trace — PUBLIC pre-order measurement engine
// Runs BEFORE the user submits their order. No auth required.
// Takes raw trace coordinates and returns full measurements.
// This blocks report submission until the engine completes.
// ============================================================
reportsRoutes.post('/calculate-from-trace', async (c) => {
  const startTime = Date.now()
  try {
    const body = await c.req.json()
    const { trace, address, default_pitch, house_sqft, shingle_type: reqShingleType } = body

    // Load material preferences for BOM generation. Prefer the calling
    // contractor's own settings (resolved through the team owner) and only
    // fall back to the platform-wide master row when no per-contractor row
    // is set. This is what makes each contractor's report use their own
    // prices/waste/tax instead of a single shared default.
    let calcMatPrefs: any = {}
    try {
      const mpRow = await c.env.DB.prepare('SELECT material_preferences FROM master_companies WHERE id = 1').first<any>()
      if (mpRow?.material_preferences) calcMatPrefs = JSON.parse(mpRow.material_preferences)
    } catch {}
    try {
      const callerToken = getCustomerSessionToken(c)
      if (callerToken) {
        const sess = await c.env.DB.prepare(
          "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
        ).bind(callerToken).first<any>()
        if (sess?.customer_id) {
          const { ownerId } = await resolveTeamOwner(c.env.DB, sess.customer_id)
          const custRow = await c.env.DB.prepare('SELECT material_preferences FROM customer_material_preferences WHERE customer_id = ?').bind(ownerId).first<any>()
          if (custRow?.material_preferences) {
            try { calcMatPrefs = { ...calcMatPrefs, ...JSON.parse(custRow.material_preferences) } } catch {}
          }
        }
      }
    } catch {}

    // Shared validator: structure, coords, self-intersection, degenerate polygons
    const validation = validateTraceUi(trace)
    if (!validation.valid) {
      return c.json({
        error: 'Trace validation failed',
        validation_errors: validation.errors,
        validation_warnings: validation.warnings,
      }, 400)
    }

    // Auto-clean the trace before measurement: deterministic geometry rules
    // (collinear merge, tiny-edge drop, right-angle snap, ridge endpoint snap)
    // plus optional Claude review for high-confidence corrections the rules
    // can't see. The original trace is NOT mutated server-side; the enhanced
    // copy flows through to the engine.
    const enhancement = await enhanceTraceWithAI(trace, c.env, { aiEnabled: true })
    const enhancedTrace = enhancement.trace

    // Resolve pitch via centralized helper (Solar API → user default → engine default)
    const centroidPts = allEavePoints(enhancedTrace)
    const centroidLat = centroidPts.length > 0
      ? centroidPts.reduce((s, p) => s + p.lat, 0) / centroidPts.length : NaN
    const centroidLng = centroidPts.length > 0
      ? centroidPts.reduce((s, p) => s + p.lng, 0) / centroidPts.length : NaN

    const resolved = await resolvePitch({
      centroidLat, centroidLng,
      solarApiKey: c.env.GOOGLE_SOLAR_API_KEY || c.env.GOOGLE_MAPS_API_KEY,
      mapsApiKey:  c.env.GOOGLE_MAPS_API_KEY,
      houseSqftHint: house_sqft || 1500,
      userDefaultRise: default_pitch,
      logTag: 'CalculateFromTrace',
    })
    const pitchRise        = resolved.pitch_rise
    const pitchSource      = resolved.pitch_source === 'solar_api' ? 'solar_api'
                             : resolved.pitch_source === 'user_default' ? 'default' : 'default'
    const pitchConfidence  = resolved.pitch_confidence
    const solarPitchRise   = resolved.solar_pitch_rise
    const solarPitchDeg    = resolved.solar_pitch_deg
    const solarFootprintFt2 = resolved.solar_footprint_ft2

    // Convert trace UI format to engine payload (uses ENHANCED trace)
    const enginePayload = traceUiToEnginePayload(
      enhancedTrace,
      {
        property_address: address || 'Pre-Order Measurement',
        homeowner_name: '',
        order_number: 'PRE-ORDER',
      },
      pitchRise,
      solarFootprintFt2 > 0 ? { source: 'google_solar', footprint_ft2: solarFootprintFt2 } : undefined
    )

    // Run the measurement engine
    const engine = new RoofMeasurementEngine(enginePayload)
    const report = engine.run()

    const elapsed = Date.now() - startTime
    console.log(`[CalculateFromTrace] Pre-order measurement completed in ${elapsed}ms — ` +
      `footprint=${report.key_measurements.total_projected_footprint_ft2}sqft, ` +
      `sloped=${report.key_measurements.total_roof_area_sloped_ft2}sqft, ` +
      `eave_pts=${report.key_measurements.num_eave_points}, ` +
      `ridges=${report.key_measurements.num_ridges} (${report.key_measurements.ridges_total_ft}ft), ` +
      `hips=${report.key_measurements.num_hips} (${report.key_measurements.hips_total_ft}ft), ` +
      `valleys=${report.key_measurements.num_valleys} (${report.key_measurements.valleys_total_ft}ft), ` +
      `pitch=${report.key_measurements.dominant_pitch_label}, ` +
      `pitch_source=${pitchSource}`)

    // Return structured response for the order form UI
    // Pitch audit — surfaced from the centralized resolver
    const pitchAudit = resolved.audit

    // Enhanced Solar cross-check: compare traced footprint against BOTH the
    // user-declared house_sqft and Google Solar's roof-footprint estimate.
    const enhancedSolarCheck = (() => {
      if (solarFootprintFt2 <= 0) return null
      const traced = report.key_measurements.total_projected_footprint_ft2
      const diff = Math.abs(traced - solarFootprintFt2)
      const pct = solarFootprintFt2 > 0 ? (diff / solarFootprintFt2) * 100 : 0
      const verdict = pct <= 8 ? 'aligned' : pct <= 20 ? 'minor_variance' : 'significant_variance'
      return {
        solar_footprint_ft2: Math.round(solarFootprintFt2),
        traced_footprint_ft2: Math.round(traced),
        variance_pct: Math.round(pct * 10) / 10,
        verdict,
        msg: verdict === 'aligned'
          ? `Traced footprint matches Google Solar's estimate within ${pct.toFixed(1)}%.`
          : verdict === 'minor_variance'
            ? `Traced footprint differs from Google Solar's estimate by ${pct.toFixed(1)}% — reasonable.`
            : `Traced footprint differs from Google Solar's estimate by ${pct.toFixed(1)}%. Double-check the trace.`,
      }
    })()

    return c.json({
      success: true,
      pitch_source: pitchSource,
      pitch_confidence: pitchConfidence,
      pitch_audit: pitchAudit,
      pitch_solar_deg: solarPitchDeg,
      solar_imagery_quality:     resolved.solar_imagery_quality,
      solar_imagery_reliability: resolved.solar_imagery_reliability,
      solar_imagery_warning:     resolved.solar_imagery_warning,
      solar_cross_check: enhancedSolarCheck,
      needs_review: report.needs_review === true,
      review_flag: report.review_flag || null,
      calculation_ms: elapsed,
      engine_version: report.report_meta.engine_version,
      validation_warnings: validation.warnings,
      trace_enhancements: {
        changes: enhancement.changes,
        warnings: enhancement.warnings,
        ai_used: enhancement.ai_used,
        ai_suggestions_applied: enhancement.ai_suggestions_applied,
        ai_suggestions_skipped: enhancement.ai_suggestions_skipped,
      },

      // Key numbers for the order form display
      measurements: {
        projected_footprint_sqft: report.key_measurements.total_projected_footprint_ft2,
        true_area_sqft: report.key_measurements.total_roof_area_sloped_ft2,
        net_squares: report.key_measurements.total_squares_net,
        gross_squares: report.key_measurements.total_squares_gross_w_waste,
        waste_pct: report.key_measurements.waste_factor_pct,
        dominant_pitch: report.key_measurements.dominant_pitch_label,
        dominant_pitch_deg: report.key_measurements.dominant_pitch_angle_deg,
        num_faces: report.key_measurements.num_roof_faces,
        num_eave_points: report.key_measurements.num_eave_points,
        num_ridges: report.key_measurements.num_ridges,
        num_hips: report.key_measurements.num_hips,
        num_valleys: report.key_measurements.num_valleys,
      },

      // Linear edge measurements
      edges: {
        eaves_ft: report.linear_measurements.eaves_total_ft,
        ridges_ft: report.linear_measurements.ridges_total_ft,
        hips_ft: report.linear_measurements.hips_total_ft,
        valleys_ft: report.linear_measurements.valleys_total_ft,
        rakes_ft: report.linear_measurements.rakes_total_ft,
        perimeter_ft: report.linear_measurements.perimeter_eave_rake_ft,
        total_linear_ft: report.linear_measurements.eaves_total_ft + report.linear_measurements.ridges_total_ft + report.linear_measurements.hips_total_ft + report.linear_measurements.valleys_total_ft + report.linear_measurements.rakes_total_ft,
      },

      // Material estimates (engine summary — totals only)
      materials: report.materials_estimate,

      // Full itemized Bill of Materials (line items + costs)
      material_bom: (() => {
        try {
          return estimateMaterials({
            address: address || '',
            net_area_sqft:    report.key_measurements.total_roof_area_sloped_ft2,
            waste_factor_pct: calcMatPrefs.waste_factor_pct || report.key_measurements.waste_factor_pct,
            total_eave_lf:    report.linear_measurements.eaves_total_ft,
            total_ridge_lf:   report.linear_measurements.ridges_total_ft,
            total_hip_lf:     report.linear_measurements.hips_total_ft,
            total_valley_lf:  report.linear_measurements.valleys_total_ft,
            total_rake_lf:    report.linear_measurements.rakes_total_ft,
            pitch_rise:       pitchRise,
            complexity:       'medium',
            shingle_type:     reqShingleType || calcMatPrefs.shingle_type || 'architectural',
            tax_rate:         calcMatPrefs.tax_rate,
            include_ventilation: calcMatPrefs.include_ventilation,
            include_pipe_boots:  calcMatPrefs.include_pipe_boots,
          })
        } catch (e: any) {
          console.warn(`[CalculateFromTrace] BOM generation failed: ${e.message}`)
          return null
        }
      })(),

      // Eave edge breakdown (individual edge lengths)
      // Include length_ft alias for backward compat with frontend
      eave_edges: report.eave_edge_breakdown.map(e => ({
        ...e,
        length_ft: e.length_2d_ft,  // backward compat alias
      })),

      // Face details (area per roof face)
      face_details: report.face_details,

      // Advisory notes
      advisory_notes: report.advisory_notes,

      // Cross-validation against known house size
      cross_validation: (() => {
        if (!house_sqft || house_sqft <= 0) return null
        const footprint = report.key_measurements.total_projected_footprint_ft2
        const expectedMin = house_sqft * 1.05
        const expectedMax = house_sqft * 1.25
        const ratio = footprint / house_sqft
        if (footprint < expectedMin) {
          return { status: 'small', ratio: Math.round(ratio * 100) / 100, house_sqft, footprint: Math.round(footprint), msg: `Traced footprint (${Math.round(footprint)} sq ft) is smaller than expected for a ${house_sqft} sq ft house. Expected ~${Math.round(expectedMin)}-${Math.round(expectedMax)} sq ft with eave overhangs.` }
        }
        if (footprint > expectedMax) {
          return { status: 'large', ratio: Math.round(ratio * 100) / 100, house_sqft, footprint: Math.round(footprint), msg: `Traced footprint (${Math.round(footprint)} sq ft) is larger than expected for a ${house_sqft} sq ft house. Expected ~${Math.round(expectedMin)}-${Math.round(expectedMax)} sq ft. Check trace accuracy.` }
        }
        return { status: 'ok', ratio: Math.round(ratio * 100) / 100, house_sqft, footprint: Math.round(footprint), msg: `Traced footprint (${Math.round(footprint)} sq ft) matches expected range for a ${house_sqft} sq ft house.` }
      })(),

      // Full engine report (for storage in order)
      full_report: report,
    })
  } catch (err: any) {
    console.error(`[CalculateFromTrace] Error:`, err.message)
    return c.json({ error: 'Measurement calculation failed', details: err.message }, 500)
  }
})

// ============================================================
// POST /solar-panel-layout — Algorithmic panel placement.
//
// Produces panel lat/lng positions the solar-proposal template can
// render directly. Works in THREE input modes (most specific wins):
//   1) `segments: [{index, pitch_deg, azimuth_deg, polygon|bbox}]`
//   2) `lat`, `lng` → fetch Google Solar segments (roofSegmentStats)
//   3) Both — caller can augment Solar segments with custom faces
//
// Unlike Google's pre-placed `solarPanels[]` (which is available only
// when Solar has a building model AND ignores user-placed obstructions),
// this endpoint respects caller-supplied obstructions and setback rules.
// ============================================================
reportsRoutes.post('/solar-panel-layout', async (c) => {
  const startTime = Date.now()
  try {
    const body = await c.req.json()
    const {
      segments: providedSegments,
      obstructions = [],
      lat, lng,
      house_sqft,
      options = {},
    } = body || {}

    let segmentsIn: any[] = Array.isArray(providedSegments) ? providedSegments : []
    let solarYearlyKwh: number | null = null
    let solarPanelCount: number | null = null
    let panelWatts: number | undefined
    let panelHeightM: number | undefined
    let panelWidthM: number | undefined

    // If no segments provided, pull them from Solar API.
    if (segmentsIn.length === 0 && isFinite(lat) && isFinite(lng)) {
      const solarKey = c.env.GOOGLE_SOLAR_API_KEY || c.env.GOOGLE_MAPS_API_KEY
      const mapsKey  = c.env.GOOGLE_MAPS_API_KEY
      if (!solarKey) {
        return c.json({ error: 'GOOGLE_SOLAR_API_KEY not configured' }, 500)
      }
      const raw = await fetchBuildingInsightsRaw(lat, lng, solarKey)
      const sp: any = raw?.solarPotential
      if (!sp || !Array.isArray(sp.roofSegmentStats)) {
        return c.json({ error: 'Google Solar has no building model for this location.' }, 422)
      }
      panelWatts    = sp.panelCapacityWatts
      panelHeightM  = sp.panelHeightMeters
      panelWidthM   = sp.panelWidthMeters
      const bestConfig = Array.isArray(sp.solarPanelConfigs) && sp.solarPanelConfigs.length > 0
        ? sp.solarPanelConfigs[sp.solarPanelConfigs.length - 1] : null
      solarPanelCount = bestConfig?.panelsCount || sp.maxArrayPanelsCount || null
      solarYearlyKwh  = bestConfig?.yearlyEnergyDcKwh || null
      segmentsIn = sp.roofSegmentStats.map((s: any, i: number) => ({
        index: i,
        pitch_deg: s.pitchDegrees || 0,
        azimuth_deg: s.azimuthDegrees || 0,
        bbox: s.boundingBox ? {
          sw: { lat: s.boundingBox.sw?.latitude, lng: s.boundingBox.sw?.longitude },
          ne: { lat: s.boundingBox.ne?.latitude, lng: s.boundingBox.ne?.longitude },
        } : undefined,
      })).filter((s: any) => s.bbox)
    }

    if (segmentsIn.length === 0) {
      return c.json({ error: 'No roof segments to place panels on. Provide `segments` or `lat`+`lng`.' }, 400)
    }

    // Reference per-panel kWh when Google provides it
    const referencePanelKwh = solarYearlyKwh && solarPanelCount && solarPanelCount > 0
      ? solarYearlyKwh / solarPanelCount
      : 0

    const layout = generatePanelLayout(
      segmentsIn,
      obstructions,
      {
        ...options,
        panel_height_m:      options.panel_height_m      ?? panelHeightM,
        panel_width_m:       options.panel_width_m       ?? panelWidthM,
        panel_watts:         options.panel_watts         ?? panelWatts,
        reference_panel_kwh: options.reference_panel_kwh ?? referencePanelKwh,
        site_latitude:       options.site_latitude       ?? lat ?? 45,
      }
    )

    const elapsed = Date.now() - startTime
    console.log(`[SolarPanelLayout] placed=${layout.panel_count} segments=${segmentsIn.length} kWh=${layout.yearly_energy_kwh} in ${elapsed}ms`)

    return c.json({
      success: true,
      calculation_ms: elapsed,
      layout,
      solar_reference: {
        google_panel_count: solarPanelCount,
        google_yearly_kwh: solarYearlyKwh ? Math.round(solarYearlyKwh) : null,
        panel_watts: panelWatts ?? layout.panel_capacity_watts,
      },
      image_center: isFinite(lat) && isFinite(lng) ? { lat, lng } : null,
    })
  } catch (err: any) {
    console.error(`[SolarPanelLayout] Error: ${err.message}`)
    return c.json({ error: 'Panel layout failed', details: err.message }, 500)
  }
})

// ============================================================
// GET /api/reports/:id/bom[.csv|.xml] — Detailed Bill of Materials
//
// Reads the stored trace measurement (or falls back to the report's
// materials summary) and produces an itemized BOM suitable for
// insurance estimating and contractor pricing. Supports JSON,
// AccuLynx CSV, and Xactimate XML output formats.
// ============================================================
async function buildBomForOrder(env: any, orderId: number): Promise<DetailedMaterialBOM | null> {
  const order: any = await env.DB.prepare(
    'SELECT id, property_address, trace_measurement_json FROM orders WHERE id = ?'
  ).bind(orderId).first()
  if (!order) return null
  if (!order.trace_measurement_json) return null
  let tm: any
  try {
    tm = typeof order.trace_measurement_json === 'string'
      ? JSON.parse(order.trace_measurement_json)
      : order.trace_measurement_json
  } catch {
    return null
  }
  // Load company material preferences
  let bomMatPrefs: any = {}
  try {
    const mpRow = await env.DB.prepare('SELECT material_preferences FROM master_companies WHERE id = 1').first<any>()
    if (mpRow?.material_preferences) bomMatPrefs = JSON.parse(mpRow.material_preferences)
  } catch {}
  const km = tm.key_measurements || {}
  const lm = tm.linear_measurements || {}
  if (!km.total_roof_area_sloped_ft2) return null
  return estimateMaterials({
    address:          order.property_address || '',
    net_area_sqft:    km.total_roof_area_sloped_ft2,
    waste_factor_pct: bomMatPrefs.waste_factor_pct ?? km.waste_factor_pct ?? 15,
    total_eave_lf:    lm.eaves_total_ft || 0,
    total_ridge_lf:   lm.ridges_total_ft || 0,
    total_hip_lf:     lm.hips_total_ft || 0,
    total_valley_lf:  lm.valleys_total_ft || 0,
    total_rake_lf:    lm.rakes_total_ft || 0,
    pitch_rise:       Math.round((km.dominant_pitch_rise ?? 5) * 10) / 10 || 5,
    complexity:       'medium',
    shingle_type:     bomMatPrefs.shingle_type || 'architectural',
    tax_rate:         bomMatPrefs.tax_rate,
    include_ventilation: bomMatPrefs.include_ventilation,
    include_pipe_boots:  bomMatPrefs.include_pipe_boots,
  })
}

reportsRoutes.get('/:id/bom', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid order ID' }, 400)
  const bom = await buildBomForOrder(c.env, id)
  if (!bom) return c.json({ error: 'No trace measurements available for this order.' }, 404)
  return c.json({ success: true, bom })
})

reportsRoutes.get('/:id/bom.csv', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) return c.text('Invalid order ID', 400)
  const bom = await buildBomForOrder(c.env, id)
  if (!bom) return c.text('No trace measurements available for this order.', 404)
  return new Response(generateAccuLynxCSV(bom), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="bom-order-${id}.csv"`,
    },
  })
})

reportsRoutes.get('/:id/bom.xml', async (c) => {
  const id = parseInt(c.req.param('id'))
  if (isNaN(id)) return c.text('Invalid order ID', 400)
  const bom = await buildBomForOrder(c.env, id)
  if (!bom) return c.text('No trace measurements available for this order.', 404)
  return new Response(generateXactimateXML(bom), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="bom-order-${id}.xml"`,
    },
  })
})

// ============================================================
// POST /auto-trace — AI-powered automatic roof trace generation
// Fetches satellite image → Gemini segmentation → GPS conversion →
// measurement engine. Returns measurements + trace JSON for map display.
// ============================================================
reportsRoutes.post('/auto-trace', async (c) => {
  const startTime = Date.now()
  try {
    const body = await c.req.json()
    const { lat, lng, address, house_sqft } = body

    if (!lat || !lng || isNaN(lat) || isNaN(lng)) {
      return c.json({ error: 'lat and lng are required' }, 400)
    }

    const solarApiKey = c.env.GOOGLE_SOLAR_API_KEY
    const mapsApiKey  = (c.env as any).GOOGLE_MAPS_API_KEY || solarApiKey
    const geminiKey   = (c.env as any).GEMINI_API_KEY || (c.env as any).GEMINI_ENHANCE_API_KEY

    if (!mapsApiKey) {
      return c.json({ error: 'GOOGLE_MAPS_API_KEY not configured' }, 500)
    }
    if (!geminiKey) {
      return c.json({ error: 'GEMINI_API_KEY not configured' }, 500)
    }

    const zoom = 20
    const imgW = 640
    const imgH = 640

    // Step 1: Fetch satellite image URL
    const satelliteUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${imgW}x${imgH}&scale=2&maptype=satellite&key=${mapsApiKey}`

    // Step 2: Run Gemini segmentation
    const geminiResult = await segmentWithGemini(
      { GEMINI_API_KEY: geminiKey } as any,
      satelliteUrl,
      imgW,
      imgH
    )

    if (!geminiResult || geminiResult.segments.length === 0) {
      return c.json({
        error: 'Gemini could not detect a roof in the satellite image. Please trace manually.',
        auto_trace_source: 'none',
        success: false,
      }, 422)
    }

    // Confidence threshold
    if (geminiResult.image_quality_score < 40) {
      return c.json({
        error: `Satellite image quality too low (${geminiResult.image_quality_score}/100) for auto-detection. Please trace manually.`,
        image_quality_score: geminiResult.image_quality_score,
        auto_trace_source: 'gemini_low_quality',
        success: false,
      }, 422)
    }

    // Step 3: Convert Gemini output → TracePayload
    const tracePayload = geminiOutlineToTracePayload(
      geminiResult,
      lat, lng, zoom, imgW, imgH,
      { property_address: address }
    )

    if (tracePayload.eaves_outline.length < 3) {
      return c.json({
        error: 'Could not build a valid roof outline from the satellite image. Please trace manually.',
        auto_trace_source: 'gemini_insufficient',
        success: false,
      }, 422)
    }

    // Step 4: Resolve final pitch via centralized helper (Solar > Gemini > fallback)
    const resolved = await resolvePitch({
      centroidLat: lat, centroidLng: lng,
      solarApiKey, mapsApiKey,
      houseSqftHint: house_sqft || 1500,
      userDefaultRise: tracePayload.default_pitch ?? 4.0,
      logTag: 'auto-trace',
    })
    const finalPitchRise = resolved.pitch_rise
    tracePayload.default_pitch = finalPitchRise

    // Step 5: Run measurement engine
    const engine = new RoofMeasurementEngine(tracePayload)
    const result = engine.run()

    // Step 6: Build trace JSON for frontend map display
    const traceJson = {
      eaves: tracePayload.eaves_outline.map(p => ({ lat: p.lat, lng: p.lng })),
      ridges: (tracePayload.ridges || []).map(r => r.pts.map(p => ({ lat: p.lat, lng: p.lng }))),
      hips:   (tracePayload.hips || []).map(h => h.pts.map(p => ({ lat: p.lat, lng: p.lng }))),
      valleys: (tracePayload.valleys || []).map(v => v.pts.map(p => ({ lat: p.lat, lng: p.lng }))),
      traced_at: new Date().toISOString(),
      auto_generated: true,
      auto_trace_source: 'gemini',
      gemini_confidence: geminiResult.image_quality_score || 0,
    }

    const km = result.key_measurements
    const lm = result.linear_measurements
    const mat = result.materials_estimate

    // Flag low-confidence auto-traces so the UI can prompt the user to
    // switch to manual mode instead of silently accepting a rough outline.
    const qualityScore = geminiResult.image_quality_score || 0
    const lowConfidence = qualityScore < 60
    const qualityWarning = lowConfidence
      ? `Auto-detection confidence is ${qualityScore}/100 — below the 60 threshold for a reliable trace. Recommended: switch to manual tracing and refine the outline.`
      : null

    return c.json({
      success: true,
      auto_trace_source: 'gemini',
      gemini_confidence: qualityScore,
      gemini_low_confidence: lowConfidence,
      quality_warning: qualityWarning,
      pitch_rise: finalPitchRise,
      pitch_label: km.dominant_pitch_label,
      trace: traceJson,
      measurements: {
        footprint_sqft: Math.round(km.total_projected_footprint_ft2),
        true_area_sqft: Math.round(km.total_roof_area_sloped_ft2),
        total_squares: km.total_squares_net,
        gross_squares: km.total_squares_gross_w_waste,
        dominant_pitch: km.dominant_pitch_label,
        dominant_pitch_deg: Math.round(km.dominant_pitch_angle_deg * 10) / 10,
        num_faces: result.face_details.length,
        num_ridges: km.num_ridges,
        num_hips: km.num_hips,
        num_valleys: km.num_valleys,
        eave_ft: Math.round(lm.eaves_total_ft),
        ridge_ft: Math.round(lm.ridges_total_ft),
        hip_ft: Math.round(lm.hips_total_ft),
        valley_ft: Math.round(lm.valleys_total_ft),
        rake_ft: Math.round(lm.rakes_total_ft),
        perimeter_ft: Math.round(lm.perimeter_eave_rake_ft),
        bundles: mat.shingles_bundles,
        underlayment_rolls: mat.underlayment_rolls,
        waste_factor_pct: km.waste_factor_pct,
      },
      processing_ms: Date.now() - startTime,
    })

  } catch (err: any) {
    console.error(`[auto-trace] Error: ${err.message}`)
    return c.json({ error: err.message, success: false }, 500)
  }
})

// ============================================================
// POST /search — Semantic search across all roof reports
// Uses Gemini text-embedding-004 for query embedding + cosine similarity
// ============================================================
reportsRoutes.post('/search', async (c) => {
  const apiKey = c.env.GEMINI_ENHANCE_API_KEY || c.env.GOOGLE_VERTEX_API_KEY
  if (!apiKey) return c.json({ error: 'No Gemini API key configured for embeddings' }, 500)

  const { query, limit, min_score } = await c.req.json()
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return c.json({ error: 'Search query is required (min 2 characters)' }, 400)
  }

  const startTime = Date.now()

  try {
    // Generate query embedding
    const queryEmbedding = await generateQueryEmbedding(query.trim(), apiKey)
    if (!queryEmbedding.length) {
      return c.json({ error: 'Failed to generate query embedding' }, 500)
    }

    // Search against stored report embeddings
    const results = await searchReports(
      c.env.DB,
      queryEmbedding,
      limit || 10,
      min_score || 0.3
    )

    const elapsed = Date.now() - startTime
    console.log(`[Search] "${query.trim()}" → ${results.length} results in ${elapsed}ms`)

    return c.json({
      success: true,
      query: query.trim(),
      results,
      total_results: results.length,
      search_ms: elapsed,
    })
  } catch (err: any) {
    console.error(`[Search] Error:`, err.message)
    return c.json({ error: 'Search failed', details: err.message }, 500)
  }
})

// ============================================================
// POST /embed-all — Batch-embed all existing reports (admin tool)
// Run once to backfill embeddings for all completed reports
// ============================================================
reportsRoutes.post('/embed-all', async (c) => {
  const user = c.get('user' as any) as any
  if (user?.role !== 'admin') return c.json({ error: 'Admin only' }, 403)

  const apiKey = c.env.GEMINI_ENHANCE_API_KEY || c.env.GOOGLE_VERTEX_API_KEY
  if (!apiKey) return c.json({ error: 'No Gemini API key configured for embeddings' }, 500)

  // Get all completed reports that don't have embeddings yet
  const reports = await c.env.DB.prepare(`
    SELECT r.order_id, r.api_response_raw, o.service_tier, o.order_number
    FROM reports r
    JOIN orders o ON o.id = r.order_id
    WHERE r.status IN ('completed', 'enhanced')
      AND r.api_response_raw IS NOT NULL
      AND r.order_id NOT IN (SELECT order_id FROM report_embeddings)
    ORDER BY r.order_id DESC
    LIMIT 50
  `).all()

  if (!reports.results?.length) {
    return c.json({ success: true, message: 'No reports to embed', embedded: 0 })
  }

  let embedded = 0
  let errors = 0
  const details: any[] = []

  for (const row of reports.results as any[]) {
    try {
      const reportData = JSON.parse(row.api_response_raw)
      const result = await embedAndStoreReport(
        c.env.DB, row.order_id, reportData, apiKey,
        { service_tier: row.service_tier, order_number: row.order_number }
      )
      if (result.success) {
        embedded++
        details.push({ order_id: row.order_id, status: 'ok' })
      } else {
        errors++
        details.push({ order_id: row.order_id, status: 'error', error: result.error })
      }
      // Rate limit: Gemini free tier is 1500 RPM, but be conservative
      if (embedded % 5 === 0) await new Promise(r => setTimeout(r, 200))
    } catch (e: any) {
      errors++
      details.push({ order_id: row.order_id, status: 'error', error: e.message })
    }
  }

  console.log(`[EmbedAll] Embedded ${embedded}/${reports.results.length} reports (${errors} errors)`)

  return c.json({
    success: true,
    total_found: reports.results.length,
    embedded,
    errors,
    details,
  })
})

// ============================================================
// GET /search-stats — Embedding index stats
// ============================================================
reportsRoutes.get('/search-stats', async (c) => {
  const stats = await c.env.DB.prepare(`
    SELECT
      COUNT(*) as total_embedded,
      MIN(created_at) as oldest_embedding,
      MAX(updated_at) as newest_embedding
    FROM report_embeddings
  `).first<any>()

  const totalReports = await c.env.DB.prepare(`
    SELECT COUNT(*) as total FROM reports WHERE status IN ('completed', 'enhanced')
  `).first<any>()

  return c.json({
    total_embedded: stats?.total_embedded || 0,
    total_completed_reports: totalReports?.total || 0,
    coverage_pct: totalReports?.total > 0 ? Math.round((stats?.total_embedded || 0) / totalReports.total * 100) : 0,
    oldest_embedding: stats?.oldest_embedding,
    newest_embedding: stats?.newest_embedding,
  })
})

reportsRoutes.post('/:orderId/generate-enhanced', async (c) => {
  const orderId = c.req.param('orderId')
  const pipelineStart = Date.now()
  const { email_report, to_email } = await c.req.json().catch(() => ({} as any))
  const order = await repo.getOrderById(c.env.DB, orderId)
  if (!order) return c.json({ error: 'Order not found' }, 404)
  const solarApiKey = c.env.GOOGLE_SOLAR_API_KEY
  const mapsApiKey = c.env.GOOGLE_MAPS_API_KEY || solarApiKey
  if (!solarApiKey) return c.json({ error: 'GOOGLE_SOLAR_API_KEY required' }, 400)

  // ── PREFERRED: If order has trace data, use generateReportForOrder instead ──
  // This uses trace coordinates for ALL geometry (not Solar API footprint)
  if (order.roof_trace_json) {
    console.log(`[GenerateEnhanced] Order ${orderId}: Has trace data — delegating to generateReportForOrder (trace-first)`)
    const traceResult = await generateReportForOrder(orderId, c.env, (c as any).executionCtx)
    if (traceResult.success) {
      return c.json({ success: true, report_version: traceResult.version || '5.0', report: traceResult.report, provider: 'trace_engine' })
    }
    console.warn(`[GenerateEnhanced] Order ${orderId}: Trace-first path failed: ${traceResult.error} — falling back to Solar`)
  }

  // ── FALLBACK: Legacy Solar-based report (only for orders without trace data) ──
  const address = [order.property_address, order.property_city, order.property_province, order.property_postal_code].filter(Boolean).join(', ')
  let dlAnalysis: DataLayersAnalysis
  try {
    dlAnalysis = await executeRoofOrder(address, solarApiKey, mapsApiKey, { radiusMeters: 50, lat: order.latitude || undefined, lng: order.longitude || undefined })
  } catch (e: any) {
    await repo.logApiRequest(c.env.DB, orderId, 'solar_datalayers', 'dataLayers:get', 500, 0, e.message.substring(0, 500))
    return c.json({ success: false, fallback: true, error: e.message }, 400)
  }

  if (!order.latitude && dlAnalysis.latitude) {
    await c.env.DB.prepare('UPDATE orders SET latitude=?, longitude=?, updated_at=datetime(\'now\') WHERE id=?').bind(dlAnalysis.latitude, dlAnalysis.longitude, orderId).run()
  }

  const segments = generateSegmentsFromDLAnalysis(dlAnalysis)
  const edges = generateEdgesFromSegments(segments, dlAnalysis.area.flatAreaSqft)
  const edgeSummary = computeEdgeSummary(edges)
  const materials = computeMaterialEstimate(dlAnalysis.area.trueAreaSqft, edges, segments)
  const reportData = buildDataLayersReport(orderId, order, dlAnalysis, segments, edges, edgeSummary, materials, mapsApiKey)

  // ── DUAL-PATH AI: Cloud Run Custom Model + Gemini Fallback ──
  const enhanceImg = reportData.imagery?.satellite_overhead_url || reportData.imagery?.satellite_url
  let crEnhanceVision: VisionFindings | null = null

  // PATH 1: Cloud Run custom model (your Colab-trained weights)
  const crCfg = buildCloudRunConfig(c.env)
  if (crCfg && enhanceImg) {
    try {
      const crRes = await analyzeViaCloudRun(crCfg, {
        image_urls: [enhanceImg], analysis_type: 'full',
        coordinates: dlAnalysis.latitude ? { lat: dlAnalysis.latitude, lng: dlAnalysis.longitude } : undefined,
        address: address,
        known_footprint_sqft: dlAnalysis.area.flatAreaSqft,
        known_pitch_deg: dlAnalysis.area.avgPitchDeg,
        image_meta: { source: 'google_maps_satellite', zoom_level: 20, resolution_px: 640 }
      })
      if (crRes?.success) {
        const crGeo = convertToAIGeometry(crRes)
        if (crGeo?.facets?.length) {
          reportData.ai_geometry = crGeo
          const aiSeg = generateSegmentsFromAIGeometry(crGeo, reportData.total_footprint_sqft, reportData.roof_pitch_degrees)
          if (aiSeg.length >= 2) { reportData.segments = aiSeg; reportData.edges = generateEdgesFromSegments(aiSeg, reportData.total_footprint_sqft); reportData.edge_summary = computeEdgeSummary(reportData.edges); reportData.materials = computeMaterialEstimate(reportData.total_true_area_sqft, reportData.edges, aiSeg) }
        }
        crEnhanceVision = convertToVisionFindings(crRes)
      }
    } catch (e: any) { console.warn(`[Enhanced] Cloud Run AI failed:`, e.message) }
  }

  // PATH 2: Gemini fallback — geometry (only if Cloud Run didn't provide)
  if (!reportData.ai_geometry) {
    const remaining = 28_000 - (Date.now() - pipelineStart)
    if (remaining >= 15_000 && enhanceImg && (c.env.GCP_SERVICE_ACCOUNT_KEY || c.env.GOOGLE_VERTEX_API_KEY)) {
      try {
        const geo = await analyzeRoofGeometry(enhanceImg, { apiKey: c.env.GOOGLE_VERTEX_API_KEY, project: c.env.GOOGLE_CLOUD_PROJECT, location: c.env.GOOGLE_CLOUD_LOCATION || 'us-central1', serviceAccountKey: c.env.GCP_SERVICE_ACCOUNT_KEY }, { maxRetries: 1, timeoutMs: Math.min(Math.floor(remaining * 0.85), 180000), acceptScore: 15, model: 'gemini-2.5-pro' })
        if (geo?.facets?.length) {
          reportData.ai_geometry = geo
          const aiSeg = generateSegmentsFromAIGeometry(geo, reportData.total_footprint_sqft, reportData.roof_pitch_degrees)
          if (aiSeg.length >= 2) { reportData.segments = aiSeg; reportData.edges = generateEdgesFromSegments(aiSeg, reportData.total_footprint_sqft); reportData.edge_summary = computeEdgeSummary(reportData.edges); reportData.materials = computeMaterialEstimate(reportData.total_true_area_sqft, reportData.edges, aiSeg) }
        }
      } catch (e: any) { console.warn(`[Enhanced] Gemini geometry failed:`, e.message) }
    }
  }

  // PATH 2: Gemini fallback — vision scan
  let geminiEnhVision: VisionFindings | null = null
  const visionRemaining = 28_000 - (Date.now() - pipelineStart)
  if (visionRemaining >= 10_000 && enhanceImg && (c.env.GCP_SERVICE_ACCOUNT_KEY || c.env.GOOGLE_VERTEX_API_KEY)) {
    try {
      geminiEnhVision = await visionScan(enhanceImg, { apiKey: c.env.GOOGLE_VERTEX_API_KEY, project: c.env.GOOGLE_CLOUD_PROJECT, location: c.env.GOOGLE_CLOUD_LOCATION || 'us-central1', serviceAccountKey: c.env.GCP_SERVICE_ACCOUNT_KEY }, { model: 'gemini-2.0-flash', timeoutMs: Math.min(Math.floor(visionRemaining * 0.8), 25000), sourceType: 'satellite_overhead' })
    } catch (e: any) { console.warn(`[Enhanced] Gemini vision failed:`, e.message) }
  }

  // MERGE: Combine Cloud Run + Gemini vision for best coverage
  const mergedEnhVision = mergeVisionFindings(crEnhanceVision, geminiEnhVision)
  if (mergedEnhVision) reportData.vision_findings = mergedEnhVision

  // ── METAL FLASHING — derive chimney/pipe counts from vision findings
  //   and append BOM lines at this contractor's prices. Helper skips
  //   the visionScan call when findings already exist (just-set above).
  try {
    await enrichReportWithFlashing(reportData as any, c.env.DB, {
      imageUrl: enhanceImg,
      customerId: order?.customer_id ?? null,
      vertexApiKey: c.env.GOOGLE_VERTEX_API_KEY,
      gcpProject: c.env.GOOGLE_CLOUD_PROJECT,
      gcpLocation: c.env.GOOGLE_CLOUD_LOCATION,
      serviceAccountKey: c.env.GCP_SERVICE_ACCOUNT_KEY,
      visionTimeoutMs: 12000,
    })
  } catch (flashErr: any) {
    console.warn(`[GenerateEnhanced] Order ${orderId}: flashing enrichment skipped: ${flashErr?.message}`)
  }

  try {
    await enrichReportWithGutters(reportData as any, c.env.DB, {
      customerId: order?.customer_id ?? null,
    })
  } catch (gutterErr: any) {
    console.warn(`[GenerateEnhanced] Order ${orderId}: gutter enrichment skipped: ${gutterErr?.message}`)
  }

  // ── PHASE 1 COMPLETE: Save base report first, then attempt enhancement inline ──
  const baseHtml = generateProfessionalReportHTML(reportData)
  const baseVer = '3.0'
  
  // Track report generation event in GA4 (non-blocking)
  trackReportGenerated(c.env, orderId, {
    provider: reportData.metadata?.provider || 'google_solar',
    accuracy: reportData.metadata?.accuracy_benchmark || 'unknown',
    has_vision: !!reportData.vision_findings,
    roof_area: reportData.roof_area_sqft || 0,
    roof_pitch: reportData.roof_pitch_degrees || 0
  }).catch((e) => console.warn("[silent-catch]", (e && e.message) || e))

  // Always save base report as 'completed' first — customer can see it immediately
  await repo.saveCompletedReport(c.env.DB, orderId, reportData, baseHtml, baseVer)
  await repo.markOrderStatus(c.env.DB, orderId, 'completed')
  await repo.logApiRequest(c.env.DB, orderId, 'solar_datalayers', 'dataLayers:get + GeoTIFF', 200, dlAnalysis.durationMs)

  // Auto-invoice: idempotent — creates a draft proposal if this roofer has
  // automation enabled and the order captured a homeowner email.
  ;(c as any).executionCtx?.waitUntil?.(
    createAutoInvoiceForOrder(c.env, Number(orderId)).catch((e) => console.warn('[auto-invoice] hook error:', e?.message))
  )

  // Auto-email: check if customer has auto_email_reports enabled
  let autoEmailEnabled = false
  let autoEmailRecipient = ''
  let contractorEmail = ''
  try {
    const custRow = await c.env.DB.prepare(
      'SELECT c.auto_email_reports, c.email FROM customers c JOIN orders o ON o.customer_id=c.id WHERE o.id=?'
    ).bind(orderId).first<any>()
    if (custRow?.email) contractorEmail = custRow.email
    if (custRow?.auto_email_reports === 1 && custRow?.email) {
      autoEmailEnabled = true
      autoEmailRecipient = custRow.email
    }
  } catch {}

  // Enhancement: attempt inline with tight timeout — if it fails, base report stands
  if (c.env.GEMINI_ENHANCE_API_KEY) {
    try {
      await repo.markEnhancementSent(c.env.DB, orderId)
      const satUrl = reportData.imagery?.satellite_overhead_url || reportData.imagery?.satellite_url || null
      console.log(`[Enhanced-Inline] Order ${orderId}: Attempting Gemini enhancement...`)
      
      const enhanced = await enhanceReportViaGemini(reportData, c.env.GEMINI_ENHANCE_API_KEY, satUrl, {
        timeoutMs: 25000,
        focus: 'roofSegmentStats'
      })

      if (enhanced) {
        const enhHtml = generateProfessionalReportHTML(enhanced)
        const enhVer = enhanced.report_version || '3.1'
        await repo.saveEnhancedReport(c.env.DB, orderId, enhHtml, JSON.stringify(enhanced), enhVer, 0)
        // Stays-completed re-write after enhancement — report already fired the
        // auto-invoice hook at base completion above. Do NOT re-fire here.
        await c.env.DB.prepare(`UPDATE reports SET status = 'completed', updated_at = datetime('now') WHERE order_id = ?`).bind(orderId).run()
        console.log(`[Enhanced-Inline] Order ${orderId}: ✅ Polished (v${enhVer})`)
        trackReportEnhanced(c.env, String(orderId), { version: enhVer, enhanced: true }).catch((e) => console.warn("[silent-catch]", (e && e.message) || e))

        // Send email with polished report — try customer Gmail first, then platform
        if (email_report || autoEmailEnabled || order.send_report_to_email) {
          const recipient = to_email || order.send_report_to_email || (autoEmailEnabled ? autoEmailRecipient : '') || order.homeowner_email || order.requester_email
          if (recipient) {
            try {
              const shareToken = await getOrCreateShareToken(c.env, orderId)
              const baseEmailHtml = buildReportLinkEmail(new URL(c.req.url).origin, orderId, order.property_address, `RM-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(orderId).padStart(4,'0')}`, recipient, true, shareToken)
              const reportSubject = `Roof Report - ${order.property_address}`
              // Tracking BEFORE send — same pixel + click rewrite regardless of
              // which Gmail transport we land on. customerId from the order.
              const trackingToken = await logEmailSend(c.env as any, { customerId: order.customer_id ?? null, recipient, kind: 'report_delivery', subject: reportSubject })
              const pixel = buildTrackingPixel(trackingToken)
              const withPixel = baseEmailHtml.includes('</body>') ? baseEmailHtml.replace('</body>', `${pixel}</body>`) : baseEmailHtml + pixel
              const emailHtml = wrapEmailLinks(withPixel, trackingToken)
              const ci = (c.env as any).GMAIL_CLIENT_ID
              let cs = (c.env as any).GMAIL_CLIENT_SECRET
              if (!cs) try { cs = (await repo.getSettingValue(c.env.DB, 'gmail_client_secret')) || '' } catch {}
              let sent = false

              // Try customer's connected Gmail first
              if (!sent && ci && cs) {
                try {
                  const custGmail = await c.env.DB.prepare(
                    'SELECT gmail_refresh_token, gmail_connected_email FROM customers c JOIN orders o ON o.customer_id=c.id WHERE o.id=?'
                  ).bind(orderId).first<any>()
                  if (custGmail?.gmail_refresh_token) {
                    await sendGmailOAuth2(ci, cs, custGmail.gmail_refresh_token, recipient, reportSubject, emailHtml, custGmail.gmail_connected_email)
                    sent = true
                    console.log(`[AutoEmail] Report ${orderId} sent via customer Gmail: ${custGmail.gmail_connected_email}`)
                    try {
                      const platRt = (c.env as any).GMAIL_REFRESH_TOKEN || await repo.getSettingValue(c.env.DB, 'gmail_refresh_token')
                      if (platRt) await sendGmailOAuth2(ci, cs, platRt, 'sales@roofmanager.ca', `[Self-Trace Copy] Roof Report - ${order.property_address} (sent to ${recipient})`, baseEmailHtml, c.env.GMAIL_SENDER_EMAIL)
                    } catch (salesErr: any) { console.warn(`[SalesCopy] Failed for order ${orderId}: ${salesErr.message}`) }
                  }
                } catch (custErr: any) {
                  console.warn(`[AutoEmail] Customer Gmail failed: ${custErr.message}`)
                }
              }

              // Fallback to platform Gmail
              if (!sent) {
                const rt = (c.env as any).GMAIL_REFRESH_TOKEN || await repo.getSettingValue(c.env.DB, 'gmail_refresh_token')
                if (rt && ci && cs) {
                  await sendGmailOAuth2(ci, cs, rt, recipient, reportSubject, emailHtml, c.env.GMAIL_SENDER_EMAIL)
                  sent = true
                  try {
                    await sendGmailOAuth2(ci, cs, rt, 'sales@roofmanager.ca', `[Self-Trace Copy] Roof Report - ${order.property_address} (sent to ${recipient})`, baseEmailHtml, c.env.GMAIL_SENDER_EMAIL)
                  } catch (salesErr: any) { console.warn(`[SalesCopy] Failed for order ${orderId}: ${salesErr.message}`) }
                }
              }

              if (!sent) await markEmailFailed(c.env as any, trackingToken, 'no gmail transport succeeded')
              if (sent && autoEmailEnabled) console.log(`[AutoEmail] Enhanced report ${orderId} auto-sent to ${recipient}`)
            } catch {}
          }
        }

        return c.json({ success: true, message: 'Report generated and polished', status: 'completed', version: enhVer, report: enhanced })
      } else {
        console.warn(`[Enhanced-Inline] Order ${orderId}: Enhancement returned null — base report delivered`)
        await repo.markEnhancementFailed(c.env.DB, orderId, 'Gemini returned null')
      }
    } catch (enhErr: any) {
      console.warn(`[Enhanced-Inline] Order ${orderId}: Enhancement failed — base report stands: ${enhErr.message}`)
      await repo.markEnhancementFailed(c.env.DB, orderId, enhErr.message).catch((e) => console.warn("[silent-catch]", (e && e.message) || e))
    }
  }

  // Send email with base report (no enhancement or enhancement failed)
  // Uses loadGmailCreds() so missing GMAIL_REFRESH_TOKEN env var falls back to
  // the gmail_refresh_token row in D1 settings (per memory: prod stores refresh
  // token in D1, env may be partial). Without this, customers with auto-email
  // enabled silently never received their report.
  if (email_report || autoEmailEnabled || order.send_report_to_email) {
    const recipient = to_email || order.send_report_to_email || (autoEmailEnabled ? autoEmailRecipient : '') || order.homeowner_email || order.requester_email
    if (recipient) {
      try {
        const shareToken = await getOrCreateShareToken(c.env, orderId)
        const emailHtml = buildReportLinkEmail(new URL(c.req.url).origin, orderId, order.property_address, `RM-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(orderId).padStart(4,'0')}`, recipient, true, shareToken)
        const creds = await loadGmailCreds(c.env as any)
        if (creds.refreshToken && creds.clientId && creds.clientSecret) {
          await sendGmailOAuth2(creds.clientId, creds.clientSecret, creds.refreshToken, recipient, `Roof Report - ${order.property_address}`, emailHtml, creds.senderEmail || (c.env as any).GMAIL_SENDER_EMAIL)
          try {
            await sendGmailOAuth2(creds.clientId, creds.clientSecret, creds.refreshToken, 'sales@roofmanager.ca', `[Self-Trace Copy] Roof Report - ${order.property_address} (sent to ${recipient})`, emailHtml, creds.senderEmail || (c.env as any).GMAIL_SENDER_EMAIL)
          } catch (salesErr: any) { console.warn(`[SalesCopy] Failed for order ${orderId}: ${salesErr.message}`) }
        } else {
          console.warn(`[AutoEmail] Order ${orderId}: Gmail creds incomplete — recipient=${recipient}, sources=${JSON.stringify(creds.source)}`)
        }
        if (autoEmailEnabled) console.log(`[AutoEmail] Report ${orderId} auto-sent to ${recipient}`)
      } catch (emailErr: any) { console.warn(`[AutoEmail] Order ${orderId} send error: ${emailErr?.message || emailErr}`) }
    }
  }

  // Send "report ready" notification to contractor if full auto-email didn't already fire
  if (!autoEmailEnabled && !email_report && contractorEmail) {
    const baseUrl = new URL(c.req.url).origin
    const viewUrl = `${baseUrl}/api/reports/${orderId}/html`
    const matCalcUrl = `${baseUrl}/customer/material-calculator?order_id=${orderId}`
    const addr = order.property_address || 'your property'
    const notifHtml = `<!DOCTYPE html><html><body style="font-family:Inter,system-ui,sans-serif;background:#f8fafc;margin:0;padding:32px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
  <div style="background:linear-gradient(135deg,#0369a1,#0ea5e9);padding:32px;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">&#x2705; Roof Report Ready</h1>
    <p style="color:#bae6fd;margin:8px 0 0;font-size:14px">${addr}</p>
  </div>
  <div style="padding:32px">
    <p style="color:#374151;font-size:15px;margin:0 0 20px">Your roof measurement report for <strong>${addr}</strong> has been generated and is ready to view.</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${viewUrl}" style="display:inline-block;background:#0369a1;color:#fff;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none">View Report</a>
    </div>
    <p style="color:#6b7280;font-size:13px;text-align:center"><a href="${matCalcUrl}" style="color:#0369a1">Open Material Calculator</a> to build your BOM from this report.</p>
  </div>
  <div style="background:#f8fafc;padding:16px;text-align:center;border-top:1px solid #e5e7eb">
    <p style="color:#9ca3af;font-size:12px;margin:0">Powered by <a href="https://roofmanager.ca" style="color:#0369a1">Roof Manager</a></p>
  </div>
</div></body></html>`
    try {
      const ci = (c.env as any).GMAIL_CLIENT_ID
      const cs = (c.env as any).GMAIL_CLIENT_SECRET
      const rt = (c.env as any).GMAIL_REFRESH_TOKEN
      if (ci && cs && rt) await sendGmailOAuth2(ci, cs, rt, contractorEmail, `\u2705 Roof Report Ready \u2014 ${addr}`, notifHtml, c.env.GMAIL_SENDER_EMAIL)
    } catch (e: any) { console.warn('[NotifEmail] Failed:', e.message) }
  }

  return c.json({ success: true, message: `Report generated (v${baseVer})`, status: 'completed', report: reportData })
})

// ============================================================
// GET /:orderId/pdf — Print-ready HTML wrapper
// ============================================================
reportsRoutes.get('/:orderId/pdf', async (c) => {
  const orderId = c.req.param('orderId')
  const report = await repo.getReportForPdf(c.env.DB, orderId)
  if (!report) return c.json({ error: 'Report not found' }, 404)
  const html = resolveHtml(report.professional_report_html, report.api_response_raw)
  if (!html) return c.json({ error: 'Report HTML not available' }, 404)
  trackReportView(c, { orderId, viewType: 'pdf' })
  const addr = [report.property_address, report.property_city, report.property_province].filter(Boolean).join(', ')
  const safe = addr.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '_').substring(0, 50)
  const saveMode = c.req.query('save') === '1'

  // Save mode: inject html2pdf bootstrap directly into the report's own
  // <body> (before </body>) so we render the report's native 8.5x11 .page
  // layout straight to letter-format PDF — no double-wrapping.
  if (saveMode) {
    const saveScript = `<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
<script>
(function(){
  function start(){
    if (!window.html2pdf) { setTimeout(start, 100); return; }
    var overlay = document.createElement('div');
    overlay.id = 'rmPdfOverlay';
    overlay.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,0.92);color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:18px;font-weight:600;z-index:2147483647;text-align:center;padding:24px;gap:16px';
    overlay.innerHTML = '<div>Generating PDF…</div><div style="font-size:13px;font-weight:400;opacity:0.75;max-width:420px">If your browser asks permission to download, click <b>Allow</b>. This tab will stay open.</div>';
    document.body.appendChild(overlay);
    function showResult(htmlStr){ overlay.style.display='flex'; overlay.innerHTML = htmlStr; var btn = document.getElementById('rmCloseBtn'); if (btn) btn.onclick = function(){ try { window.close(); } catch(e){} }; }
    setTimeout(function(){
      overlay.style.display = 'none';
      // Stamp explicit width/height on every inline SVG so html2canvas can
      // rasterize it (viewBox alone resolves to 0x0 in some Chromium builds).
      document.querySelectorAll('svg').forEach(function(sv){
        var r = sv.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          sv.setAttribute('width',  Math.round(r.width));
          sv.setAttribute('height', Math.round(r.height));
        }
      });
      // Hide any floating widgets injected onto the report (3D-cover FAB,
      // measure feedback, etc.) so they don't bleed into the PDF.
      ['#rm3dFab','#rm3dOverlay','#rm3dAutoCap','#rm3dAutoFrame','.rm-feedback-fab','#rmPdfOverlay'].forEach(function(sel){
        document.querySelectorAll(sel).forEach(function(el){ el.style.display='none'; });
      });
      var source = document.body;
      window.html2pdf().set({
        margin:0,
        filename:'Roof_Report_${safe}.pdf',
        image:{type:'jpeg',quality:0.95},
        html2canvas:{scale:2,useCORS:true,allowTaint:true,letterRendering:true,backgroundColor:'#ffffff',scrollX:0,scrollY:0,windowWidth:document.documentElement.scrollWidth,windowHeight:document.documentElement.scrollHeight},
        jsPDF:{unit:'in',format:'letter',orientation:'portrait',compress:true},
        pagebreak:{mode:['css','legacy'],before:'.page',avoid:['svg','img','table']}
      }).from(source).save().then(function(){
        showResult('<div style="font-size:22px">✓ PDF saved</div><div style="font-size:14px;font-weight:400;opacity:0.8;max-width:420px">Check your Downloads folder. You can close this tab.</div><button id="rmCloseBtn" style="margin-top:8px;padding:10px 20px;background:#10b981;color:#fff;border:0;border-radius:8px;font-weight:600;cursor:pointer;font-size:14px">Close tab</button>');
      })['catch'](function(err){
        showResult('<div style="color:#fca5a5">PDF generation failed</div><div style="font-size:13px;font-weight:400;opacity:0.8">' + (err && err.message ? err.message : 'unknown error') + '</div>');
      });
    }, 1500);
  }
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
})();
</script>`
    const injected = html.includes('</body>')
      ? html.replace('</body>', `${saveScript}</body>`)
      : html + saveScript
    return new Response(injected, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `inline; filename="Roof_Report_${safe}.pdf"` } })
  }

  const pdfHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Roof_Report_${safe}.pdf</title>
<style>@media print{body{margin:0;padding:0}.page{page-break-after:always}.page:last-child{page-break-after:auto}.print-controls{display:none!important}}
.print-controls{position:fixed;top:0;left:0;right:0;z-index:9999;background:#1E3A5F;color:#fff;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;font-family:Inter,system-ui,sans-serif}
.print-controls button{background:#00E5FF;color:#0B1E2F;border:none;padding:8px 24px;border-radius:6px;font-weight:700;cursor:pointer}body{padding-top:50px}@media print{body{padding-top:0}}</style></head>
<body><div class="print-controls"><span>Roof Manager | ${addr}</span><button onclick="window.print()">Download PDF</button></div>
${html}<script>if(new URLSearchParams(location.search).get('print')==='1')setTimeout(()=>window.print(),500)</script></body></html>`
  return new Response(pdfHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `inline; filename="Roof_Report_${safe}.pdf"` } })
})

// ============================================================
// POST /datalayers/analyze — Quick standalone analysis
// ============================================================
reportsRoutes.post('/datalayers/analyze', async (c) => {
  const body = parseBody(datalayersAnalyzeBody, await c.req.json())
  const key = c.env.GOOGLE_SOLAR_API_KEY
  if (!key) return c.json({ error: 'GOOGLE_SOLAR_API_KEY not configured' }, 400)
  const result = await executeRoofOrder(body.address || `${body.lat},${body.lng}`, key, c.env.GOOGLE_MAPS_API_KEY || key, { lat: body.lat, lng: body.lng, radiusMeters: 50 })
  return c.json({ success: true, analysis: result, summary: { flat_area_sqft: result.area.flatAreaSqft, true_area_sqft: result.area.trueAreaSqft, avg_pitch_deg: result.area.avgPitchDeg, imagery_quality: result.imageryQuality } })
})

// ============================================================
// POST /:orderId/cloud-ai-analyze — On-demand Cloud Run AI analysis
// ============================================================
reportsRoutes.post('/:orderId/cloud-ai-analyze', async (c) => {
  const orderId = c.req.param('orderId')
  const crConfig = buildCloudRunConfig(c.env)
  if (!crConfig) return c.json({ error: 'CLOUD_RUN_AI_URL not configured', hint: 'Set CLOUD_RUN_AI_URL env var to your Cloud Run service URL' }, 400)

  const report = await repo.getReportForVision(c.env.DB, orderId)
  if (!report) return c.json({ error: 'Report not found' }, 404)
  const order = await repo.getOrderById(c.env.DB, orderId)

  let imgUrl = report.satellite_image_url as string | null
  if (!imgUrl && report.api_response_raw) {
    try { const d = JSON.parse(report.api_response_raw); imgUrl = d.imagery?.satellite_overhead_url || d.imagery?.satellite_url } catch {}
  }
  if (!imgUrl) return c.json({ error: 'No satellite image available' }, 400)

  // Collect all available images for batch analysis
  const imageUrls = [imgUrl]
  if (report.api_response_raw) {
    try {
      const d = JSON.parse(report.api_response_raw)
      if (d.imagery?.satellite_close_url) imageUrls.push(d.imagery.satellite_close_url)
      if (d.imagery?.context_url) imageUrls.push(d.imagery.context_url)
    } catch {}
  }

  const crResult = await analyzeViaCloudRun(crConfig, {
    image_urls: imageUrls,
    analysis_type: 'full',
    coordinates: order?.latitude && order?.longitude ? { lat: order.latitude, lng: order.longitude } : undefined,
    address: order?.property_address || undefined,
    image_meta: { source: 'google_maps_satellite', zoom_level: 20, resolution_px: 640 }
  })

  if (!crResult) return c.json({ error: 'Cloud Run AI unavailable — service may not be deployed yet', cloud_run_url: crConfig.baseUrl, hint: 'Deploy your Colab model to Cloud Run, then retry' }, 503)
  if (!crResult.success) return c.json({ error: crResult.error || 'Analysis failed', model: crResult.model_version }, 400)

  // Convert and store results
  const visionFindings = convertToVisionFindings(crResult)
  const geometry = convertToAIGeometry(crResult)

  if (visionFindings) {
    await repo.updateVisionFindings(c.env.DB, orderId, JSON.stringify(visionFindings))
  }
  if (geometry) {
    await c.env.DB.prepare(`UPDATE reports SET ai_measurement_json=?, ai_status='completed', ai_analyzed_at=datetime('now'), updated_at=datetime('now') WHERE order_id=?`)
      .bind(JSON.stringify(geometry), orderId).run()
  }

  await repo.logApiRequest(c.env.DB, orderId, 'cloud_run_ai', crConfig.baseUrl, 200, crResult.inference_time_ms)

  return c.json({
    success: true,
    source: 'cloud_run_custom_ai',
    model: crResult.model_version,
    inference_ms: crResult.inference_time_ms,
    vision: visionFindings ? { finding_count: visionFindings.finding_count, heat_score: visionFindings.heat_score, condition: visionFindings.overall_condition } : null,
    geometry: geometry ? { facets: geometry.facets.length, lines: geometry.lines.length, quality: geometry.overall_quality_score } : null,
    images_analyzed: imageUrls.length
  })
})

// ============================================================
// GET /cloud-ai/health — Cloud Run AI service health check
// ============================================================
reportsRoutes.get('/cloud-ai/health', async (c) => {
  const crConfig = buildCloudRunConfig(c.env)
  if (!crConfig) return c.json({ status: 'not_configured', cloud_run_url: null, message: 'Set CLOUD_RUN_AI_URL environment variable' })

  const health = await checkCloudRunHealth(crConfig)
  return c.json({
    status: health ? 'connected' : 'unavailable',
    cloud_run_url: crConfig.baseUrl,
    deployed: !!health,
    health: health || null,
    message: health
      ? `Cloud Run AI online — model ${health.model_version} (${health.model_type}), GPU: ${health.gpu_available}`
      : 'Cloud Run service is reachable but custom AI model not yet deployed. Deploy your Colab model to activate.',
    fallback: 'Gemini API (active — will handle all requests until Cloud Run is ready)'
  })
})

// ============================================================
// POST /:orderId/email — Send report via email
// Priority: 1) Customer's connected Gmail  2) Platform Gmail OAuth2  3) Resend API
// ============================================================
reportsRoutes.post('/:orderId/email', async (c) => {
  const orderId = c.req.param('orderId')
  const body = parseBody(emailBody, await c.req.json().catch(() => ({})))
  const order = await repo.getOrderWithReport(c.env.DB, orderId)
  if (!order) return c.json({ error: 'Order not found' }, 404)
  const recipient = body?.to_email || order.homeowner_email || order.requester_email
  if (!recipient) return c.json({ error: 'No recipient email' }, 400)
  const reportHtml = resolveHtml(order.professional_report_html, order.api_response_raw)
  if (!reportHtml) return c.json({ error: 'Report not yet generated' }, 400)

  // Pull customer copy if it exists so it ships in the same email.
  let customerHtml: string | null = null
  try {
    const cr = await repo.getCustomerReportHtml(c.env.DB, orderId)
    customerHtml = cr?.customer_report_html || null
  } catch (e: any) {
    console.warn(`[Email] Order ${orderId}: customer copy lookup failed (non-fatal): ${e?.message}`)
  }

  const reportNum = `RM-${orderId}`
  const subject = body?.subject_override || `Roof Measurement Report - ${order.property_address} [${reportNum}]`
  const shareToken = await getOrCreateShareToken(c.env, orderId)
  const emailHtml = buildReportLinkEmail(new URL(c.req.url).origin, orderId, order.property_address || 'Property', reportNum, recipient, !!customerHtml, shareToken)

  // Create a pending delivery row up front so every send attempt is auditable,
  // even if the request crashes or times out between here and the provider call.
  let deliveryId: number | null = null
  try {
    const ins = await c.env.DB.prepare(
      `INSERT INTO email_deliveries (order_id, recipient, subject, status, attempts, last_attempt_at)
       VALUES (?, ?, ?, 'pending', 0, datetime('now'))`
    ).bind(orderId, recipient, subject).run()
    deliveryId = Number(ins.meta.last_row_id) || null
  } catch (e: any) {
    console.warn(`[Email] Failed to create delivery row for order ${orderId}: ${e.message}`)
  }

  let method = 'none'
  let senderEmail = ''
  let providerMessageId = ''
  const errors: string[] = []

  // Priority 1: customer's own connected Gmail
  try {
    const custGmail = await c.env.DB.prepare(
      `SELECT c.gmail_refresh_token, c.gmail_connected_email, c.brand_business_name, c.name
       FROM customers c JOIN orders o ON o.customer_id = c.id WHERE o.id = ?`
    ).bind(orderId).first<any>()

    if (custGmail?.gmail_refresh_token && custGmail?.gmail_connected_email) {
      const ci = (c.env as any).GMAIL_CLIENT_ID
      const cs = (c.env as any).GMAIL_CLIENT_SECRET || await repo.getSettingValue(c.env.DB, 'gmail_client_secret')
      if (ci && cs) {
        const res = await sendGmailOAuth2(ci, cs, custGmail.gmail_refresh_token, recipient, subject, emailHtml, custGmail.gmail_connected_email)
        method = 'customer_gmail'
        senderEmail = custGmail.gmail_connected_email
        providerMessageId = res.id
      }
    }
  } catch (e: any) {
    errors.push(`customer_gmail: ${e.message}`)
    console.warn(`[Email] Customer Gmail failed for order ${orderId}: ${e.message}`)
  }

  // Priority 2: platform Gmail OAuth2
  if (method === 'none') {
    try {
      const rt = (c.env as any).GMAIL_REFRESH_TOKEN || await repo.getSettingValue(c.env.DB, 'gmail_refresh_token')
      const ci = (c.env as any).GMAIL_CLIENT_ID
      const cs = (c.env as any).GMAIL_CLIENT_SECRET || await repo.getSettingValue(c.env.DB, 'gmail_client_secret')
      const sender = body?.from_email || c.env.GMAIL_SENDER_EMAIL || null
      if (rt && ci && cs) {
        const res = await sendGmailOAuth2(ci, cs, rt, recipient, subject, emailHtml, sender)
        method = 'gmail_oauth2'
        senderEmail = sender || 'platform'
        providerMessageId = res.id
      }
    } catch (e: any) {
      errors.push(`gmail_oauth2: ${e.message}`)
      console.warn(`[Email] Platform Gmail failed for order ${orderId}: ${e.message}`)
    }
  }

  // Priority 3: Resend (final fallback — carries webhook-based delivery tracking)
  if (method === 'none') {
    try {
      const resendKey = (c.env as any).RESEND_API_KEY
      const sender = body?.from_email || c.env.GMAIL_SENDER_EMAIL || null
      if (resendKey) {
        const res = await sendViaResend(resendKey, recipient, subject, emailHtml, sender)
        method = 'resend'
        senderEmail = sender || 'resend'
        providerMessageId = res.id
      }
    } catch (e: any) {
      errors.push(`resend: ${e.message}`)
      console.warn(`[Email] Resend failed for order ${orderId}: ${e.message}`)
    }
  }

  // All providers failed — mark delivery row and tell the caller.
  if (method === 'none') {
    if (deliveryId) {
      await c.env.DB.prepare(
        `UPDATE email_deliveries SET status = 'failed', method = 'none', error_message = ?, attempts = attempts + 1, last_attempt_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
      ).bind(errors.join(' | ') || 'No email provider configured', deliveryId).run().catch(() => {})
    }
    return c.json({
      error: errors.length
        ? 'All email providers failed. Admin should check Gmail OAuth and Resend API key.'
        : 'No email provider configured. Connect your Gmail at Dashboard → Settings, or ask admin to configure email.',
      details: errors,
      fallback_url: `/api/reports/${orderId}/html`,
      delivery_id: deliveryId,
    }, 502)
  }

  // Success — mark as sent. Resend webhook will later advance to delivered/bounced/complained.
  if (deliveryId) {
    await c.env.DB.prepare(
      `UPDATE email_deliveries SET status = 'sent', method = ?, sender_email = ?, provider_message_id = ?, attempts = attempts + 1, last_attempt_at = datetime('now'), updated_at = datetime('now'), error_message = ? WHERE id = ?`
    ).bind(method, senderEmail, providerMessageId || null, errors.length ? errors.join(' | ') : null, deliveryId).run().catch(() => {})
  }

  await repo.logApiRequest(c.env.DB, orderId, 'email_sent', method, 200, 0, JSON.stringify({ to: recipient, from: senderEmail, method, delivery_id: deliveryId }))
  trackEmailSent(c.env as any, 'report_email', recipient, { order_id: orderId, method }).catch((e) => console.warn("[silent-catch]", (e && e.message) || e))

  // BCC-style copy to sales@roofmanager.ca for every self-trace report email
  try {
    const ci = (c.env as any).GMAIL_CLIENT_ID
    const cs = (c.env as any).GMAIL_CLIENT_SECRET || await repo.getSettingValue(c.env.DB, 'gmail_client_secret')
    const rt = (c.env as any).GMAIL_REFRESH_TOKEN || await repo.getSettingValue(c.env.DB, 'gmail_refresh_token')
    if (ci && cs && rt) {
      await sendGmailOAuth2(ci, cs, rt, 'sales@roofmanager.ca', `[Self-Trace Copy] ${subject} (sent to ${recipient})`, emailHtml, c.env.GMAIL_SENDER_EMAIL)
    }
  } catch (salesErr: any) {
    console.warn(`[SalesCopy] Failed for order ${orderId}: ${salesErr.message}`)
  }

  return c.json({ success: true, to: recipient, method, from: senderEmail, delivery_id: deliveryId, provider_message_id: providerMessageId || null })
})

// ============================================================
// POST /webhooks/resend — Delivery status callbacks from Resend
// Events: email.sent, email.delivered, email.bounced, email.complained, email.opened, email.clicked
// Docs: https://resend.com/docs/dashboard/webhooks/introduction
// ============================================================
reportsRoutes.post('/webhooks/resend', async (c) => {
  const raw = await c.req.text()
  const provided = c.req.header('x-roofmanager-webhook-secret') || c.req.header('x-webhook-secret') || ''
  const expected = (c.env as any).RESEND_WEBHOOK_SECRET || ''
  if (expected && provided !== expected) return c.json({ error: 'Invalid signature' }, 401)

  let payload: any
  try { payload = JSON.parse(raw) } catch { return c.json({ error: 'Invalid JSON' }, 400) }

  const eventType: string = payload?.type || payload?.event || ''
  const data = payload?.data || payload || {}
  const providerMessageId: string = data?.email_id || data?.id || ''
  const recipient: string = Array.isArray(data?.to) ? data.to[0] : (data?.to || '')

  await c.env.DB.prepare(
    `INSERT INTO resend_webhook_events (event_type, provider_message_id, recipient, payload) VALUES (?, ?, ?, ?)`
  ).bind(eventType, providerMessageId, recipient, raw).run().catch(() => {})

  // Map event → status. "sent" is the initial provider ack; we already set it.
  let newStatus: string | null = null
  if (eventType === 'email.delivered') newStatus = 'delivered'
  else if (eventType === 'email.bounced') newStatus = 'bounced'
  else if (eventType === 'email.complained') newStatus = 'complained'
  else if (eventType === 'email.opened') newStatus = 'opened'

  if (newStatus && providerMessageId) {
    const errMsg = newStatus === 'bounced' ? (data?.bounce?.message || data?.reason || 'bounced') : null
    await c.env.DB.prepare(
      `UPDATE email_deliveries SET status = ?, error_message = COALESCE(?, error_message), updated_at = datetime('now')
       WHERE provider_message_id = ? AND status NOT IN ('bounced','complained')`
    ).bind(newStatus, errMsg, providerMessageId).run().catch(() => {})
  }

  return c.json({ ok: true })
})

// ============================================================
// POST /:orderId/share — Generate a public shareable link for a report
// ============================================================
reportsRoutes.post('/:orderId/share', async (c) => {
  const user = c.get('user' as any) as any
  const orderId = c.req.param('orderId')
  const body = await c.req.json().catch(() => ({} as any))

  // Admins can share any report; customers are scoped to their own orders.
  const baseSql = `
    SELECT r.id, r.share_token, r.status, o.property_address, c.name as contractor_name, c.email as contractor_email
    FROM reports r JOIN orders o ON o.id = r.order_id
    JOIN customers c ON c.id = o.customer_id
    WHERE r.order_id = ?`
  const report = user.role === 'admin'
    ? await c.env.DB.prepare(baseSql).bind(orderId).first<any>()
    : await c.env.DB.prepare(baseSql + ' AND o.customer_id = ?').bind(orderId, user.id).first<any>()

  if (!report) return c.json({ error: 'Report not found' }, 404)
  if (report.status !== 'completed' && report.status !== 'enhanced') {
    return c.json({ error: 'Report is not yet ready to share' }, 400)
  }

  // Generate share token if not exists
  let shareToken = report.share_token
  if (!shareToken) {
    shareToken = crypto.randomUUID().replace(/-/g, '').substring(0, 20)
    await c.env.DB.prepare(
      "UPDATE reports SET share_token = ?, share_sent_at = datetime('now'), updated_at = datetime('now') WHERE order_id = ?"
    ).bind(shareToken, orderId).run()
  }

  const baseUrl = new URL(c.req.url).origin
  const shareUrl = `${baseUrl}/report/share/${shareToken}`

  // Optionally send email to homeowner. Try Gmail OAuth2 first, then
  // fall back to Resend. Surface the real outcome to the caller so the UI
  // can stop falsely claiming success when nothing was sent.
  let emailSent = false
  let emailError: string | null = null
  let emailVia: 'gmail' | 'resend' | null = null

  // Reject malformed email addresses outright — body.email is user-supplied
  // and was previously passed straight to the SMTP layer.
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
  if (body.email && !EMAIL_RE.test(String(body.email).trim())) {
    return c.json({ error: 'Invalid email address' }, 400)
  }

  if (body.email) {
    const address = report.property_address || 'your property'
    const contractor = report.contractor_name || 'Your roofing contractor'
    const subject = `Your Roof Report is Ready — ${address}`
    const notifHtml = `<!DOCTYPE html><html><body style="font-family:Inter,system-ui,sans-serif;background:#f8fafc;margin:0;padding:32px">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
  <div style="background:linear-gradient(135deg,#0369a1,#0ea5e9);padding:32px;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">Roof Measurement Report</h1>
    <p style="color:#bae6fd;margin:8px 0 0;font-size:14px">${address}</p>
  </div>
  <div style="padding:32px">
    <p style="color:#374151;font-size:15px;margin:0 0 20px">${contractor} has shared your roof measurement report with you.</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${shareUrl}" style="display:inline-block;background:#0369a1;color:#fff;font-weight:700;font-size:15px;padding:14px 32px;border-radius:12px;text-decoration:none">View My Roof Report</a>
    </div>
    <p style="color:#6b7280;font-size:13px;margin:0">This link is shareable — bookmark it to view your report anytime.</p>
  </div>
  <div style="background:#f8fafc;padding:16px;text-align:center;border-top:1px solid #e5e7eb">
    <p style="color:#9ca3af;font-size:12px;margin:0">Powered by <a href="https://roofmanager.ca" style="color:#0369a1">Roof Manager</a></p>
  </div>
</div></body></html>`

    const env: any = c.env
    // Share-report emails ALWAYS go from sales@roofmanager.ca, regardless of
    // which user/account triggered the share. Use platform Gmail OAuth2 creds
    // — fall back to D1 `settings` rows when env vars are missing (same
    // pattern as report-completion email and email-outreach paths).
    const SENDER = 'sales@roofmanager.ca'
    let ci = env.GMAIL_CLIENT_ID || ''
    let cs = env.GMAIL_CLIENT_SECRET || ''
    let rt = env.GMAIL_REFRESH_TOKEN || ''
    if (!ci) try { ci = (await repo.getSettingValue(c.env.DB, 'gmail_client_id')) || '' } catch {}
    if (!cs) try { cs = (await repo.getSettingValue(c.env.DB, 'gmail_client_secret')) || '' } catch {}
    if (!rt) try { rt = (await repo.getSettingValue(c.env.DB, 'gmail_refresh_token')) || '' } catch {}
    const resendKey = env.RESEND_API_KEY

    if (ci && cs && rt) {
      try {
        await sendGmailOAuth2(ci, cs, rt, body.email, subject, notifHtml, SENDER)
        emailSent = true
        emailVia = 'gmail'
      } catch (e: any) {
        emailError = `gmail: ${e?.message || 'send failed'}`
        console.warn('[Share] Gmail send failed:', e?.message)
      }
    }

    if (!emailSent && resendKey) {
      try {
        await sendViaResend(resendKey, body.email, subject, notifHtml, SENDER)
        emailSent = true
        emailVia = 'resend'
        emailError = null
      } catch (e: any) {
        emailError = (emailError ? emailError + '; ' : '') + `resend: ${e?.message || 'send failed'}`
        console.warn('[Share] Resend send failed:', e?.message)
      }
    }

    if (!emailSent && !emailError) {
      emailError = 'no_email_provider_configured'
    }
  }

  return c.json({
    success: true,
    share_url: shareUrl,
    share_token: shareToken,
    email_requested: !!body.email,
    email_sent: emailSent,
    email_via: emailVia,
    email_error: emailError,
  })
})

// ============================================================
// POST /:orderId/webhook-update — Receive enhanced report from Cloud Run
// ============================================================
// This endpoint is called by your Google AI Studio Cloud Run app
// after it finishes enhancing the report. Auth via REPORT_WEBHOOK_SECRET.
reportsRoutes.post('/:orderId/webhook-update', async (c) => {
  const orderId = c.req.param('orderId')
  
  // Validate webhook secret
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.replace('Bearer ', '')
  const webhookSecret = c.env.REPORT_WEBHOOK_SECRET
  if (!webhookSecret || !token || token !== webhookSecret) {
    console.warn(`[Webhook] Order ${orderId}: Invalid or missing webhook token`)
    return c.json({ error: 'Unauthorized — invalid webhook token' }, 401)
  }

  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400)

  console.log(`[Webhook] Order ${orderId}: Received enhanced report callback`)
  console.log(`[Webhook] Order ${orderId}: Keys: ${Object.keys(body).join(', ')}`)

  // The Cloud Run engine sends back the enhanced report data
  const {
    enhanced_html,
    enhanced_report_data,       // Full RoofReport JSON (enhanced)
    enhancement_version = '1.0',
    processing_time_ms = 0,
    status = 'success',
    error_message
  } = body

  if (status === 'failed' || status === 'error') {
    console.error(`[Webhook] Order ${orderId}: Enhancement FAILED: ${error_message}`)
    await repo.markEnhancementFailed(c.env.DB, orderId, error_message || 'Unknown error from Cloud Run')
    // Route to super-admin trace queue so user can decide (manually re-trace,
    // re-run base generation, or accept the unenhanced report).
    try {
      await repo.flagForReview(c.env.DB, orderId, 'enhancement_failed', { error: (error_message || 'Unknown error from Cloud Run').toString().substring(0, 500) })
    } catch {}
    return c.json({ success: false, message: 'Enhancement failure recorded', orderId })
  }

  // We need at least the enhanced report data JSON
  if (!enhanced_report_data && !enhanced_html) {
    return c.json({ error: 'Missing enhanced_report_data or enhanced_html' }, 400)
  }

  let finalHtml = enhanced_html || ''
  let finalRawJson = ''

  if (enhanced_report_data) {
    // If full report data is provided, re-generate HTML from it
    // This ensures our template is always used
    try {
      const reportData = typeof enhanced_report_data === 'string'
        ? JSON.parse(enhanced_report_data)
        : enhanced_report_data
      finalRawJson = JSON.stringify(reportData)
      // Re-generate HTML using our template for consistency
      try {
        finalHtml = generateProfessionalReportHTML(reportData)
        console.log(`[Webhook] Order ${orderId}: Re-generated HTML from enhanced data (${finalHtml.length} chars)`)
      } catch (htmlErr: any) {
        // If HTML generation fails, use the provided HTML if available
        console.warn(`[Webhook] Order ${orderId}: HTML re-gen failed, using provided HTML: ${htmlErr.message}`)
        if (!finalHtml) {
          finalHtml = `<html><body><h1>Enhanced Report</h1><p>HTML rendering failed</p></body></html>`
        }
      }
    } catch (parseErr: any) {
      console.error(`[Webhook] Order ${orderId}: Failed to parse enhanced_report_data: ${parseErr.message}`)
      return c.json({ error: 'Invalid enhanced_report_data JSON' }, 400)
    }
  }

  // Save the enhanced report — this overwrites the primary report HTML
  await repo.saveEnhancedReport(
    c.env.DB, orderId,
    finalHtml, finalRawJson,
    enhancement_version, processing_time_ms
  )

  // Log the enhancement
  await repo.logApiRequest(c.env.DB, orderId, 'webhook_enhancement',
    'cloud_run_callback', 200, processing_time_ms,
    JSON.stringify({ version: enhancement_version, html_length: finalHtml.length })
  )

  console.log(`[Webhook] Order ${orderId}: ✅ Enhanced report saved (v${enhancement_version}, ${processing_time_ms}ms, ${finalHtml.length} chars)`)

  return c.json({
    success: true,
    orderId,
    enhancement_version,
    html_length: finalHtml.length,
    message: 'Enhanced report saved and deployed to customer dashboard'
  })
})

// ============================================================
// GET /:orderId/enhancement-status — Check enhancement progress
// ============================================================
reportsRoutes.get('/:orderId/enhancement-status', async (c) => {
  const orderId = c.req.param('orderId')
  
  // Validate webhook secret for external polling (Cloud Run can check status)
  const authHeader = c.req.header('Authorization')
  const token = authHeader?.replace('Bearer ', '')
  const webhookSecret = c.env.REPORT_WEBHOOK_SECRET
  // Allow both webhook token and normal admin/customer auth
  const user = await validateAdminOrCustomer(c)
  if (!user && (!webhookSecret || !token || token !== webhookSecret)) {
    return c.json({ error: 'Authentication required' }, 401)
  }

  const status = await repo.getEnhancementStatus(c.env.DB, orderId)
  if (!status) return c.json({ error: 'Report not found' }, 404)

  // Also fetch the report status to tell frontend if report is ready
  const reportStatus = await repo.getReportStatus(c.env.DB, orderId)
  const isReady = reportStatus?.status === 'completed'
  const isEnhancing = reportStatus?.status === 'enhancing' || (status as any).enhancement_status === 'sent' || (status as any).enhancement_status === 'pending'

  return c.json({
    success: true,
    orderId,
    ...status,
    report_status: reportStatus?.status || 'unknown',
    is_ready: isReady,
    is_enhancing: isEnhancing,
    message: isReady
      ? 'Report is ready — polished and complete'
      : isEnhancing
        ? 'Report is being polished by AI — please wait...'
        : `Report status: ${reportStatus?.status || 'unknown'}`
  })
})

// ============================================================
// GET /:orderId/ai-imagery-status — Check AI imagery generation status
// ============================================================
reportsRoutes.get('/:orderId/ai-imagery-status', async (c) => {
  const orderId = c.req.param('orderId')
  const user = await validateAdminOrCustomer(c)
  if (!user) return c.json({ error: 'Authentication required' }, 401)

  const imageryStatus = await repo.getAIImageryStatus(c.env.DB, orderId)
  if (!imageryStatus) return c.json({ error: 'Report not found' }, 404)

  const imageCount = imageryStatus.ai_generated_imagery_json
    ? (JSON.parse(imageryStatus.ai_generated_imagery_json)?.images?.length || 0)
    : 0

  return c.json({
    success: true,
    orderId,
    ai_imagery_status: imageryStatus.ai_imagery_status || 'not_started',
    ai_imagery_error: imageryStatus.ai_imagery_error,
    image_count: imageCount,
    is_generating: imageryStatus.ai_imagery_status === 'generating',
    is_complete: imageryStatus.ai_imagery_status === 'completed'
  })
})

// ============================================================
// POST /:orderId/feedback — "I measured this differently" capture
// ============================================================
// Pro-tier field-survey feedback. Auto-flags discrepancies > 20%
// for admin review (visible from the platform-admin dashboard).
// Accepts both customer and admin sessions.
// ============================================================
reportsRoutes.post('/:orderId/feedback', async (c) => {
  const orderId = c.req.param('orderId')
  const user = await validateAdminOrCustomer(c)
  if (!user) return c.json({ error: 'Authentication required' }, 401)

  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: 'invalid json' }, 400) }

  const reportId = await repo.getReportIdByOrder(c.env.DB, orderId)
  if (!reportId) return c.json({ error: 'Report not found' }, 404)

  // Compute discrepancy from the saved measurement payload, when the user
  // provided a measured area in their survey.
  const surveyArea = Number(body?.survey_data?.measured_area_ft2)
  let discrepancyPct: number | null = null
  if (Number.isFinite(surveyArea) && surveyArea > 0) {
    const prior = await repo.getPriorReportSnapshot(c.env.DB, orderId)
    const reportArea = Number(prior?.data?.total_true_area_sqft || prior?.data?.total_footprint_sqft || 0)
    if (reportArea > 0) {
      discrepancyPct = Math.round(Math.abs(surveyArea - reportArea) / reportArea * 1000) / 10
    }
  }

  const allowedTypes = ['measured_differently', 'edge_wrong', 'pitch_wrong', 'other'] as const
  const type = (allowedTypes as readonly string[]).includes(body?.type) ? body.type : 'measured_differently'

  const result = await repo.insertReportFeedback(c.env.DB, {
    report_id: reportId,
    user_id: (user as any).id ?? null,
    type,
    description: typeof body?.description === 'string' ? String(body.description).slice(0, 2000) : null,
    survey_data: body?.survey_data ?? null,
    discrepancy_pct: discrepancyPct,
  })

  return c.json({
    success: true,
    feedback_id: result.id,
    discrepancy_pct: discrepancyPct,
    needs_admin_review: result.needs_admin_review,
  })
})

// ============================================================
// POST /recovery/stuck — Auto-recover reports stuck in 'enhancing' or 'generating'
// Admin endpoint that finds and fixes reports stuck > 90s
// ============================================================
reportsRoutes.post('/recovery/stuck', async (c) => {
  // Find reports stuck in 'enhancing' for > 90s or 'generating' for > 120s
  const stuckEnhancing = await c.env.DB.prepare(`
    SELECT r.order_id, r.status, r.generation_started_at, r.enhancement_sent_at
    FROM reports r
    WHERE (r.status = 'enhancing' AND r.updated_at < datetime('now', '-90 seconds'))
       OR (r.status = 'generating' AND r.updated_at < datetime('now', '-120 seconds'))
  `).all()

  const recovered: number[] = []
  for (const row of (stuckEnhancing.results || []) as any[]) {
    try {
      await c.env.DB.prepare(`
        UPDATE reports SET status = 'completed',
          enhancement_status = CASE WHEN status = 'enhancing' THEN 'enhancement_failed' ELSE enhancement_status END,
          enhancement_error = CASE WHEN status = 'enhancing' THEN 'Auto-recovered: stuck report' ELSE enhancement_error END,
          updated_at = datetime('now')
        WHERE order_id = ?
      `).bind(row.order_id).run()
      await repo.markOrderStatus(c.env.DB, row.order_id, 'completed')
      recovered.push(row.order_id as number)
      console.log(`[Recovery] Auto-recovered stuck report: order ${row.order_id} (was ${row.status})`)
      // Intentionally NOT firing the auto-invoice hook here. Recovery is an
      // admin cleanup for orders stuck in generating/enhancing — the homeowner
      // auto-proposal should only fire when the user actually places an order
      // and its trace-driven generation completes, not retroactively on cleanup.
    } catch (e: any) {
      console.error(`[Recovery] Failed to recover order ${row.order_id}:`, e.message)
    }
  }

  return c.json({
    success: true,
    scanned: (stuckEnhancing.results || []).length,
    recovered: recovered.length,
    recovered_orders: recovered,
    message: recovered.length > 0 ? `Recovered ${recovered.length} stuck report(s)` : 'No stuck reports found'
  })
})

// ============================================================
// INLINE ENHANCEMENT: Gemini polish with strict timeout
// Report is ALREADY saved as 'completed' before this runs.
// On success: overwrites with polished version (stays 'completed').
// On failure: base report stands — customer never sees 'enhancing'.
// Returns the enhanced version string on success, null on failure.
// ============================================================
export async function enhanceReportInline(
  orderId: number | string,
  reportData: RoofReport,
  env: Bindings
): Promise<string | null> {
  const enhanceKey = env.GEMINI_ENHANCE_API_KEY
  if (!enhanceKey) return null

  try {
    await repo.markEnhancementSent(env.DB, orderId)
    const satUrl = reportData.imagery?.satellite_overhead_url || reportData.imagery?.satellite_url || null
    console.log(`[Enhance-Inline] Order ${orderId}: 🚀 Starting Gemini enhancement...`)

    const enhanced = await enhanceReportViaGemini(reportData, enhanceKey, satUrl, {
      timeoutMs: 20000,  // 20s strict timeout — report already delivered
      focus: 'roofSegmentStats'
    })

    if (enhanced) {
      const html = generateProfessionalReportHTML(enhanced)
      const version = enhanced.report_version || '3.1'
      await repo.saveEnhancedReport(env.DB, orderId, html, JSON.stringify(enhanced), version, 0)
      // Report is already 'completed' — stays-completed re-write; auto-invoice
      // hook already fired at base completion. Do NOT re-fire here.
      await env.DB.prepare(`UPDATE reports SET status = 'completed', updated_at = datetime('now') WHERE order_id = ?`).bind(orderId).run()
      console.log(`[Enhance-Inline] Order ${orderId}: ✅ Polished (v${version}, ${html.length} chars)`)
      trackReportEnhanced(env, String(orderId), { version, enhanced: true }).catch((e) => console.warn("[silent-catch]", (e && e.message) || e))
      return version
    } else {
      console.warn(`[Enhance-Inline] Order ${orderId}: Gemini returned null — base report stands`)
      await repo.markEnhancementFailed(env.DB, orderId, 'Gemini returned null')
      return null
    }
  } catch (err: any) {
    console.warn(`[Enhance-Inline] Order ${orderId}: Failed — base report stands: ${err.message}`)
    await repo.markEnhancementFailed(env.DB, orderId, err.message).catch((e) => console.warn("[silent-catch]", (e && e.message) || e))
    return null
  }
}

// Legacy alias for backward compatibility
export const enhanceReportInBackground = enhanceReportInline

// ============================================================
// PHASE 3: Generate AI imagery for the "perfect" report
// Runs AFTER enhancement as a bonus background step.
// Uses Gemini image generation to create professional visuals.
// The report is already 'completed' — this just adds imagery.
// ============================================================
export async function generateAIImageryForReport(
  orderId: number | string,
  reportData: RoofReport,
  env: Bindings
): Promise<boolean> {
  // Use the Gemini enhance key for image generation too
  const apiKey = env.GEMINI_ENHANCE_API_KEY
  if (!apiKey) {
    console.log(`[AIImagery] Order ${orderId}: No API key — skipping imagery generation`)
    return false
  }

  try {
    await repo.markAIImageryGenerating(env.DB, orderId)
    console.log(`[AIImagery] Order ${orderId}: 🎨 Starting AI imagery generation...`)

    const imagery = await generateReportImagery(reportData, apiKey, {
      maxImages: 4,
      timeoutPerImage: 25000,
      includeSatellite: true
    })

    if (imagery && imagery.images.length > 0) {
      // Inject AI imagery into report data
      reportData.ai_generated_imagery = imagery

      // Build the AI imagery HTML section
      const imageryHtml = buildAIImageryHTML(imagery)

      // Get current report HTML and append the AI imagery page
      const currentReport = await repo.getReportHtml(env.DB, orderId)
      let currentHtml = currentReport?.professional_report_html || ''

      if (currentHtml && imageryHtml) {
        // Insert AI imagery page before the closing </body></html>
        const insertPoint = currentHtml.lastIndexOf('</body>')
        if (insertPoint > 0) {
          currentHtml = currentHtml.slice(0, insertPoint) + imageryHtml + currentHtml.slice(insertPoint)
        } else {
          currentHtml += imageryHtml
        }
      }

      // Save imagery JSON and updated HTML
      await repo.saveAIImagery(env.DB, orderId, JSON.stringify(imagery), currentHtml)
      console.log(`[AIImagery] Order ${orderId}: ✅ ${imagery.images.length} images generated in ${imagery.generation_time_ms}ms`)
      return true
    } else {
      console.warn(`[AIImagery] Order ${orderId}: No images generated — all attempts failed`)
      await repo.markAIImageryFailed(env.DB, orderId, 'No images generated')
      return false
    }
  } catch (err: any) {
    console.error(`[AIImagery] Order ${orderId}: Failed — ${err.message}`)
    await repo.markAIImageryFailed(env.DB, orderId, err.message).catch((e) => console.warn("[silent-catch]", (e && e.message) || e))
    return false
  }
}


// ============================================================
// REPORT GENERATION ENGINE v5.0
//
// ARCHITECTURE:
//   PRIMARY: User-traced coordinates → RoofMeasurementEngine
//            (ALL geometry, area, edges, perimeter, materials)
//   SECONDARY: Google Solar API → pitch + satellite imagery ONLY
//   BONUS: AI analysis (Cloud Run / Gemini) for visual inspection
//
// Google Solar buildingInsights is NEVER used for area, footprint,
// segments, or edge calculations. Only pitch (slope) and imagery.
// ============================================================
export async function generateReportForOrder(
  orderId: number | string, env: Bindings, ctx?: ExecutionContext,
  opts?: { skipCustomerDelivery?: boolean }
): Promise<{ success: boolean; report?: RoofReport; error?: string; version?: string; provider?: string; hasEnhanceKey?: boolean }> {
  // ── GLOBAL 25-SECOND TIMEOUT ──
  // Cloudflare Workers have a 30s CPU budget. We cap at 25s to ensure
  // we always have time to mark the report as failed/completed and
  // return a JSON response (never leave the order stuck as 'generating').
  const GENERATION_TIMEOUT_MS = 25_000
  const generationStart = Date.now()

  const timeoutPromise = new Promise<{ success: false; error: string }>((resolve) => {
    setTimeout(() => resolve({ success: false, error: `Report generation timed out after ${GENERATION_TIMEOUT_MS / 1000}s. This order will be retried automatically.` }), GENERATION_TIMEOUT_MS)
  })

  const generationPromise = _generateReportForOrderInner(orderId, env, generationStart, ctx, opts)

  const result = await Promise.race([generationPromise, timeoutPromise])

  // If we timed out, route to super-admin trace queue instead of marking
  // the customer's order as 'failed'. Customer never sees a rejection —
  // user (super-admin) decides whether to manually trace, retry, or refund.
  if (!result.success && result.error?.includes('timed out')) {
    try {
      await repo.flagForReview(env.DB, orderId, 'gen_timeout', {
        error: result.error,
        elapsed_ms: Date.now() - generationStart,
        timeout_ms: GENERATION_TIMEOUT_MS,
      })
      console.warn(`[Generate] Order ${orderId}: TIMED OUT after ${Date.now() - generationStart}ms — queued for super-admin trace review`)
    } catch {}
  }

  return result
}

// ============================================================
// finalizeReportDelivery — customer-visible side effects.
//
// Extracted from _generateReportForOrderInner so the admin-review flow
// (POST /superadmin/orders/:id/generate-draft → admin reviews →
// /approve-and-deliver) can run the same delivery sequence on demand
// instead of triggering it the moment HTML renders.
//
// Fires:
//   1. orders.status='completed' + orders.delivered_at = now (the customer-
//      visibility gate — both this AND admin_review_status='approved' are
//      required before the customer dashboard surfaces the report)
//   2. dispatchReportToExternalCRMs (AccuLynx / JobNimbus / webhook)
//   3. Auto-email the report link to send_report_to_email →
//      requester_email → homeowner_email (Gmail OAuth2 → Resend fallback)
//   4. createAutoInvoiceForOrder (idempotent)
//
// All fire-and-forget hooks use ctx.waitUntil so Cloudflare doesn't kill
// the worker before they complete. The function itself awaits only the
// markOrderStatus DB write.
//
// `extras` supplies pre-fetched context to avoid re-querying when called
// inline from the engine; both callers (_generateReportForOrderInner and
// approve-and-deliver) pass it.
// ============================================================
export async function finalizeReportDelivery(
  orderId: number | string,
  env: Bindings,
  ctx?: ExecutionContext,
  extras?: { order?: any; customerHtmlExists?: boolean }
): Promise<void> {
  // Lazy-load the order if the caller didn't pass one (e.g. approve-and-
  // deliver hits this fresh).
  let order = extras?.order
  if (!order) {
    try { order = await repo.getOrderById(env.DB, orderId) } catch {}
  }
  if (!order) {
    console.warn(`[finalizeReportDelivery] Order ${orderId} not found — aborting delivery hooks`)
    return
  }

  // Stamp orders.delivered_at + flip status='completed'. Customer
  // dashboard queries gate on this column being non-null.
  await repo.markOrderStatus(env.DB, orderId, 'completed')

  // Push to any external CRM connections the customer has configured
  // (AccuLynx, JobNimbus, custom webhook, etc.). Fire-and-forget via
  // waitUntil — failures land in customer_api_deliveries and never
  // affect the report flow.
  if (order.customer_id) {
    const { dispatchReportToExternalCRMs } = await import('../services/external-crm-dispatch')
    const crmP = dispatchReportToExternalCRMs(env, orderId, order.customer_id, ctx)
      .catch(e => console.warn(`[CRM-Dispatch] Order ${orderId} hook error:`, e?.message))
    if (ctx?.waitUntil) ctx.waitUntil(crmP)
  }

  // Auto-send report to the order's email. Falls back through
  // send_report_to_email → requester_email → homeowner_email so every
  // completed report ships automatically. Fire-and-forget via waitUntil.
  const autoRecipient = (
    order.send_report_to_email
    || order.requester_email
    || order.homeowner_email
    || ''
  ).toString().trim()
  if (autoRecipient) {
    const customerHtmlExists = !!extras?.customerHtmlExists
    const autoSendP = (async () => {
      try {
        const recipient = autoRecipient
        const reportNum = `RM-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(orderId).padStart(4,'0')}`
        const shareToken = await getOrCreateShareToken(env, orderId)
        const emailHtml = buildReportLinkEmail('https://www.roofmanager.ca', orderId, order.property_address || 'Property', reportNum, recipient, customerHtmlExists, shareToken)
        const ci = (env as any).GMAIL_CLIENT_ID
        let cs = (env as any).GMAIL_CLIENT_SECRET
        let rt = (env as any).GMAIL_REFRESH_TOKEN
        if (!cs) { try { cs = (await repo.getSettingValue(env.DB, 'gmail_client_secret')) || '' } catch {} }
        if (!rt) { try { rt = (await repo.getSettingValue(env.DB, 'gmail_refresh_token')) || '' } catch {} }
        if (ci && cs && rt) {
          await sendGmailOAuth2(ci, cs, rt, recipient, `Roof Report - ${order.property_address || 'Property'}`, emailHtml, (env as any).GMAIL_SENDER_EMAIL)
          console.log(`[AutoSendEmail] Order ${orderId}: report auto-sent to ${recipient}`)
        } else if ((env as any).RESEND_API_KEY) {
          await sendViaResend((env as any).RESEND_API_KEY, recipient, `Roof Report - ${order.property_address || 'Property'}`, emailHtml, (env as any).GMAIL_SENDER_EMAIL || null)
          console.log(`[AutoSendEmail] Order ${orderId}: report auto-sent via Resend to ${recipient}`)
        } else {
          console.warn(`[AutoSendEmail] Order ${orderId}: no email provider configured — auto-send skipped`)
        }
      } catch (e: any) {
        console.warn(`[AutoSendEmail] Order ${orderId}: send failed — ${e?.message || e}`)
      }
    })()
    if (ctx?.waitUntil) ctx.waitUntil(autoSendP)
  }

  // Auto-invoice hook — fire-and-forget, idempotent.
  {
    const autoInvP = createAutoInvoiceForOrder(env, Number(orderId))
      .catch((e) => console.warn('[auto-invoice] hook error:', e?.message))
    if (ctx?.waitUntil) ctx.waitUntil(autoInvP)
  }
}

async function _generateReportForOrderInner(
  orderId: number | string, env: Bindings, startTime: number, ctx?: ExecutionContext,
  opts?: { skipCustomerDelivery?: boolean }
): Promise<{ success: boolean; report?: RoofReport; error?: string; version?: string; provider?: string; hasEnhanceKey?: boolean }> {
  try {
    const order = await repo.getOrderById(env.DB, orderId)
    if (!order) return { success: false, error: 'Order not found' }
    const existing = await repo.getReportStatus(env.DB, orderId)
    const attemptNum = (existing?.generation_attempts || 0) + 1
    if (existing?.status === 'generating') {
      const staleMs = existing.generation_started_at ? Date.now() - new Date(existing.generation_started_at + 'Z').getTime() : Infinity
      if (staleMs > 120_000) {
        await repo.flagForReview(env.DB, orderId, 'gen_stuck', { stale_ms: staleMs, msg: `Timed out (${Math.round(staleMs/1000)}s)` })
      } else if (staleMs < Infinity) return { success: false, error: 'Already in progress' }
      else {
        await repo.flagForReview(env.DB, orderId, 'gen_stuck_no_start', { msg: 'Stuck (no start time)' })
      }
    }
    if (existing?.status === 'enhancing') {
      const staleMs = existing.generation_started_at ? Date.now() - new Date(existing.generation_started_at + 'Z').getTime() : Infinity
      if (staleMs > 90_000) {
        console.warn(`[Generate] Order ${orderId}: Auto-recovering stuck 'enhancing' report (${Math.round(staleMs/1000)}s old)`)
        // Pre-generation recovery: if the report was previously stuck in
        // 'enhancing', base completion already fired the auto-invoice hook.
        // The current run continues on to a fresh generate → saveCompletedReport
        // which will re-run the hook (idempotent). No extra hook needed here.
        await env.DB.prepare(`UPDATE reports SET status = 'completed', enhancement_status = 'enhancement_failed', enhancement_error = 'Auto-recovered: stuck >90s', updated_at = datetime('now') WHERE order_id = ?`).bind(orderId).run()
        await repo.markOrderStatus(env.DB, orderId, 'completed')
      }
    }
    // Allow retry even if max attempts exceeded — reset counter if status was 'failed'.
    // On the 4th+ attempt of a non-failed run, route to super-admin trace queue
    // instead of returning a hard rejection. Customer keeps seeing 'in progress'.
    if (attemptNum > 3 && existing?.status !== 'failed') {
      try {
        await repo.flagForReview(env.DB, orderId, 'max_attempts', { attempt_num: attemptNum })
      } catch {}
      return { success: false, error: 'Max attempts exceeded — queued for review' }
    }
    const safeAttempt = attemptNum > 3 ? 1 : attemptNum
    await repo.upsertGeneratingState(env.DB, orderId, safeAttempt, !!existing)
    await repo.markOrderStatus(env.DB, orderId, 'processing')

    const startTime = Date.now()
    const solarApiKey = env.GOOGLE_SOLAR_API_KEY
    const mapsApiKey = env.GOOGLE_MAPS_API_KEY || solarApiKey

    // Load company material preferences for BOM generation
    let matPrefs: any = {}
    try {
      const mpRow = await env.DB.prepare('SELECT material_preferences FROM master_companies WHERE id = 1').first<any>()
      if (mpRow?.material_preferences) matPrefs = JSON.parse(mpRow.material_preferences)
    } catch {}

    // ═══════════════════════════════════════════════════════════
    // STEP 1: PARSE TRACE DATA (required for measurements)
    // The user MUST have traced eaves/ridges/hips/valleys on the
    // map during ordering. This is the SOLE source of geometry.
    // ═══════════════════════════════════════════════════════════
    let traceData: any = null
    let traceResult: TraceReport | null = null

    if (order.roof_trace_json) {
      try {
        traceData = typeof order.roof_trace_json === 'string' ? JSON.parse(order.roof_trace_json) : order.roof_trace_json
      } catch (e: any) {
        console.warn(`[Generate] Order ${orderId}: Failed to parse roof_trace_json: ${e.message}`)
      }
    }

    // Check for pre-calculated trace measurement from the order form
    if ((order as any).trace_measurement_json) {
      try {
        traceResult = typeof (order as any).trace_measurement_json === 'string'
          ? JSON.parse((order as any).trace_measurement_json)
          : (order as any).trace_measurement_json
        console.log(`[Generate] Order ${orderId}: Using PRE-CALCULATED trace measurement — ` +
          `footprint=${traceResult?.key_measurements?.total_projected_footprint_ft2}sqft, ` +
          `sloped=${traceResult?.key_measurements?.total_roof_area_sloped_ft2}sqft`)
      } catch (e: any) {
        console.warn(`[Generate] Order ${orderId}: Failed to parse pre-calculated measurement: ${e.message}`)
        traceResult = null
      }
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 2: FETCH SOLAR PITCH + IMAGERY (lightweight call)
    // Only extracts weighted pitch and satellite image URLs.
    // NO area, NO footprint, NO segments from Solar API.
    // ═══════════════════════════════════════════════════════════
    let solarPitch: SolarPitchAndImagery | null = null
    let solarPitchDeg = 20 // sensible default if Solar unavailable
    let solarPitchRise = 4.4 // ~20°
    let extraImagery: Awaited<ReturnType<typeof fetchSolarImageryOnly>> | null = null

    if (solarApiKey && order.latitude && order.longitude) {
      try {
        const footprintHint = traceResult?.key_measurements?.total_projected_footprint_ft2 || 1500
        // Multi-structure reports zoom out one notch so both buildings fit clearly in frame.
        const structureCount = Array.isArray(traceData?.eaves_sections)
          ? traceData.eaves_sections.filter((s: any) => Array.isArray(s) && s.length >= 3).length
          : 0
        const imageryZoomOffset = structureCount >= 2 ? -1 : 0
        // Re-center the static map on the polygon's bbox-center so the house
        // can't be cropped out when the geocoded address pin lands off-roof.
        const imageryCenter = computeTracedImageryCenter(traceData)
        // Fetch pitch + the two extra report images (flux heatmap, mask overlay) in parallel.
        // Imagery failure is non-fatal and falls back to the single-image layout.
        const [pitchRes, imgRes] = await Promise.all([
          fetchSolarPitchAndImagery(order.latitude, order.longitude, solarApiKey, mapsApiKey || solarApiKey, footprintHint, imageryZoomOffset, imageryCenter || undefined),
          fetchSolarImageryOnly(order.latitude, order.longitude, solarApiKey).catch(() => null),
        ])
        solarPitch = pitchRes
        extraImagery = imgRes
        solarPitchDeg = solarPitch.pitch_degrees
        solarPitchRise = Math.round(12 * Math.tan(solarPitchDeg * Math.PI / 180) * 10) / 10
        await repo.logApiRequest(env.DB, orderId, 'google_solar_api', 'buildingInsights:findClosest (pitch+imagery only)', 200, solarPitch.api_duration_ms)
        console.log(`[Generate] Order ${orderId}: Solar pitch=${solarPitchDeg}° (${solarPitchRise}:12), quality=${solarPitch.imagery_quality}, ${solarPitch.api_duration_ms}ms` +
          (extraImagery ? ` · extra-imagery flux=${!!extraImagery.flux_data_url} mask=${!!extraImagery.mask_overlay_data_url} in ${extraImagery.duration_ms}ms` : ''))
      } catch (e: any) {
        console.warn(`[Generate] Order ${orderId}: Solar API failed (non-critical, using default pitch): ${e.message}`)
        await repo.logApiRequest(env.DB, orderId, 'google_solar_api', 'buildingInsights:findClosest (pitch+imagery only)', 500, Date.now() - startTime, e.message.substring(0, 500))
      }
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 3: RUN TRACE MEASUREMENT ENGINE
    // If we have trace data but no pre-calculated result,
    // run the engine now using Solar pitch as default_pitch.
    // This is the SOLE source of all measurements.
    // ═══════════════════════════════════════════════════════════
    if (!traceResult && traceData && traceData.eaves && traceData.eaves.length >= 3) {
      try {
        const solarFootprint = solarPitch?.roof_footprint_ft2 || 0
        const enginePayload = traceUiToEnginePayload(
          traceData,
          {
            property_address: order.property_address,
            homeowner_name: order.homeowner_name,
            order_number: order.order_number,
          },
          solarPitchRise,
          solarFootprint > 0 ? { source: 'google_solar', footprint_ft2: solarFootprint } : undefined
        )
        const engine = new RoofMeasurementEngine(enginePayload)
        traceResult = engine.run()
        console.log(`[Generate] Order ${orderId}: Trace engine computed — ` +
          `footprint=${traceResult.key_measurements.total_projected_footprint_ft2}sqft, ` +
          `sloped=${traceResult.key_measurements.total_roof_area_sloped_ft2}sqft, ` +
          `eave_pts=${traceResult.key_measurements.num_eave_points}, ` +
          `pitch=${traceResult.key_measurements.dominant_pitch_label}`)
      } catch (tmErr: any) {
        console.error(`[Generate] Order ${orderId}: Trace measurement engine FAILED: ${tmErr.message}`)
      }
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 4: BUILD REPORT DATA
    // PRIMARY: trace measurements for ALL geometry
    // SECONDARY: Solar for imagery + pitch
    // FALLBACK: if no trace, generate legacy Solar-based report
    // ═══════════════════════════════════════════════════════════
    let reportData: RoofReport

    if (traceResult) {
      // ─── PREFERRED PATH: Trace-Engine Report ───
      const km = traceResult.key_measurements
      const lm = traceResult.linear_measurements
      const mat = traceResult.materials_estimate

      // Build segments from trace face details (or single whole-roof)
      const segments: any[] = traceResult.face_details.length > 0
        ? traceResult.face_details.map((face, i) => ({
            name: face.face_id || `Face ${i + 1}`,
            footprint_area_sqft: Math.round(face.projected_area_ft2),
            true_area_sqft: Math.round(face.sloped_area_ft2),
            true_area_sqm: Math.round(face.sloped_area_ft2 * 0.0929 * 10) / 10,
            pitch_degrees: Math.round(face.pitch_angle_deg * 10) / 10,
            pitch_ratio: face.pitch_label,
            azimuth_degrees: face.azimuth_deg != null ? Math.round(face.azimuth_deg * 10) / 10 : 0,
            azimuth_direction: face.azimuth_deg != null ? degreesToCardinal(face.azimuth_deg) : '',
          }))
        : [{
            name: 'Total Roof (Traced)',
            footprint_area_sqft: Math.round(km.total_projected_footprint_ft2),
            true_area_sqft: Math.round(km.total_roof_area_sloped_ft2),
            true_area_sqm: Math.round(km.total_roof_area_sloped_ft2 * 0.0929 * 10) / 10,
            pitch_degrees: Math.round(km.dominant_pitch_angle_deg * 10) / 10,
            pitch_ratio: km.dominant_pitch_label,
            azimuth_degrees: 0,
            azimuth_direction: '',
          }]

      // Build edges from trace line details
      const traceEdges: any[] = []
      for (const edge of traceResult.eave_edge_breakdown) {
        traceEdges.push({
          edge_type: 'eave', label: `Eave ${edge.edge_num}`,
          plan_length_ft: Math.round(edge.length_2d_ft),
          true_length_ft: Math.round(edge.length_2d_ft), pitch_factor: 1.0,
        })
      }
      for (const seg of traceResult.ridge_details) {
        traceEdges.push({
          edge_type: 'ridge', label: seg.id,
          plan_length_ft: Math.round(seg.horiz_length_ft),
          true_length_ft: Math.round(seg.sloped_length_ft), pitch_factor: seg.slope_factor,
        })
      }
      for (const seg of traceResult.hip_details) {
        traceEdges.push({
          edge_type: 'hip', label: seg.id,
          plan_length_ft: Math.round(seg.horiz_length_ft),
          true_length_ft: Math.round(seg.sloped_length_ft), pitch_factor: seg.slope_factor,
        })
      }
      for (const seg of traceResult.valley_details) {
        traceEdges.push({
          edge_type: 'valley', label: seg.id,
          plan_length_ft: Math.round(seg.horiz_length_ft),
          true_length_ft: Math.round(seg.sloped_length_ft), pitch_factor: seg.slope_factor,
        })
      }
      for (const seg of traceResult.rake_details) {
        traceEdges.push({
          edge_type: 'rake', label: seg.id,
          plan_length_ft: Math.round(seg.horiz_length_ft),
          true_length_ft: Math.round(seg.sloped_length_ft), pitch_factor: seg.slope_factor,
        })
      }

      const traceEdgeSummary = {
        total_ridge_ft: Math.round(lm.ridges_total_ft),
        total_hip_ft: Math.round(lm.hips_total_ft),
        total_valley_ft: Math.round(lm.valleys_total_ft),
        total_eave_ft: Math.round(lm.eaves_total_ft),
        total_rake_ft: Math.round(lm.rakes_total_ft),
        total_perimeter_ft: Math.round(lm.perimeter_eave_rake_ft),
        total_flashing_ft: Math.round((lm.step_flashing_total_ft || 0) + (lm.headwall_flashing_total_ft || 0)),
        total_step_flashing_ft:     Math.round(lm.step_flashing_total_ft || 0),
        total_headwall_flashing_ft: Math.round(lm.headwall_flashing_total_ft || 0),
        // Legacy alias — older templates read `total_wall_flashing_ft` for headwall.
        total_wall_flashing_ft:     Math.round(lm.headwall_flashing_total_ft || 0),
        chimney_flashing_count:     lm.chimney_flashing_count || 0,
        pipe_boot_count:            lm.pipe_boot_count || 0,
      }

      const traceMaterials = {
        total_squares: km.total_squares_net,
        gross_squares: km.total_squares_gross_w_waste,
        waste_factor: km.waste_factor_pct / 100,
        bundles_3tab: mat.shingles_bundles,
        bundle_count: mat.shingles_bundles,       // Alias: saveCompletedReport expects bundle_count
        underlayment_rolls: mat.underlayment_rolls,
        ice_water_shield_lf: Math.round(mat.ice_water_shield_sqft / 3),
        ridge_cap_lf: Math.round(mat.ridge_cap_lf),
        drip_edge_lf: Math.round(mat.drip_edge_total_lf),
        starter_strip_lf: Math.round(mat.starter_strip_lf),
        valley_flashing_lf: Math.round(mat.valley_flashing_lf),
        step_flashing_lf:     Math.round(mat.step_flashing_lf || 0),
        headwall_flashing_lf: Math.round(mat.headwall_flashing_lf || 0),
        chimney_flashing_count: mat.chimney_flashing_count || 0,
        pipe_boot_count:        mat.pipe_boot_count || 0,
        nails_lbs: mat.roofing_nails_lbs,
        caulk_tubes: mat.caulk_tubes,
        total_material_cost_cad: 0,               // Not computed in trace engine — placeholder
        complexity_class: km.num_hips > 2 || km.num_valleys > 1 ? 'complex' : (km.num_hips > 0 ? 'moderate' : 'simple'),
      }

      // Imagery: prefer Solar API, fallback to basic Maps Static.
      // Multi-structure reports zoom out one notch so both buildings fit clearly in frame.
      const traceStructureCount = Array.isArray(traceData?.eaves_sections)
        ? traceData.eaves_sections.filter((s: any) => Array.isArray(s) && s.length >= 3).length
        : 0
      const imageryZoomOffsetFallback = traceStructureCount >= 2 ? -1 : 0
      const imageryCenterFallback = computeTracedImageryCenter(traceData)
      const imagery = {
        ...(solarPitch
          ? { ...solarPitch.imagery, dsm_url: null, mask_url: null }
          : {
              ...generateEnhancedImagery(
                order.latitude || 0, order.longitude || 0,
                mapsApiKey || '', km.total_projected_footprint_ft2, imageryZoomOffsetFallback,
                imageryCenterFallback || undefined
              ),
              dsm_url: null, mask_url: null,
            }),
        flux_data_url: extraImagery?.flux_data_url || null,
        mask_overlay_data_url: extraImagery?.mask_overlay_data_url || null,
      }

      reportData = {
        order_id: typeof orderId === 'string' ? parseInt(orderId) : orderId as number,
        generated_at: new Date().toISOString(),
        report_version: '5.0',
        property: {
          address: order.property_address,
          city: order.property_city, province: order.property_province,
          postal_code: order.property_postal_code,
          homeowner_name: order.homeowner_name,
          requester_name: order.requester_name,
          requester_company: order.requester_company,
          latitude: order.latitude, longitude: order.longitude,
        },
        total_footprint_sqft: Math.round(km.total_projected_footprint_ft2),
        total_footprint_sqm: Math.round(km.total_projected_footprint_ft2 * 0.0929),
        total_true_area_sqft: Math.round(km.total_roof_area_sloped_ft2),
        total_true_area_sqm: Math.round(km.total_roof_area_sloped_ft2 * 0.0929 * 10) / 10,
        area_multiplier: km.total_projected_footprint_ft2 > 0
          ? Math.round(km.total_roof_area_sloped_ft2 / km.total_projected_footprint_ft2 * 1000) / 1000 : 1,
        roof_pitch_degrees: Math.round(km.dominant_pitch_angle_deg * 10) / 10,
        roof_pitch_ratio: km.dominant_pitch_label,
        roof_azimuth_degrees: 0,
        segments,
        edges: traceEdges,
        edge_summary: traceEdgeSummary,
        materials: traceMaterials,
        max_sunshine_hours: 0, num_panels_possible: 0, yearly_energy_kwh: 0,
        imagery: imagery as any,
        roof_trace: traceData,
        excluded_segments: [],
        quality: {
          imagery_quality: (solarPitch?.imagery_quality || 'N/A') as any,
          imagery_date: solarPitch?.imagery_date,
          field_verification_recommended: false,
          confidence_score: 95,
          notes: [
            `Measurement source: User-traced coordinate geometry (RoofMeasurementEngine v4.0).`,
            `${km.num_eave_points} eave points, ${km.num_ridges} ridges, ${km.num_hips} hips, ${km.num_valleys} valleys traced.`,
            `Footprint: ${km.total_projected_footprint_ft2} sqft (Shoelace formula on WGS84→Cartesian projection).`,
            `Sloped area: ${km.total_roof_area_sloped_ft2} sqft (pitch-corrected: ${km.dominant_pitch_label}).`,
            solarPitch ? `Solar API pitch: ${solarPitchDeg}° (${solarPitch.pitch_ratio}), imagery quality: ${solarPitch.imagery_quality}.` : 'Solar API: unavailable — using trace-derived pitch.',
            ...(traceResult.advisory_notes || []),
          ]
        },
        metadata: {
          provider: 'trace_engine_v4',
          api_duration_ms: Date.now() - startTime,
          coordinates: { lat: order.latitude, lng: order.longitude },
          solar_api_imagery_date: solarPitch?.imagery_date,
          building_insights_quality: solarPitch?.imagery_quality,
          accuracy_benchmark: 'GPS coordinate trace + Shoelace area + common-run hip/valley correction',
          cost_per_query: solarPitch ? '$0.075 CAD (Solar API for pitch+imagery only)' : '$0.00 (trace-only)',
        },
      } as RoofReport

      // Enrich trace materials with line_items + waste_table for Material Calculator
      reportData.materials = computeMaterialEstimate(
        reportData.total_true_area_sqft,
        reportData.edges,
        reportData.segments,
        matPrefs.shingle_type || 'architectural'
      )

      // Store trace measurement for reference
      ;(reportData as any).trace_measurement = traceResult

      // Generate trace-based SVG diagram
      try {
        const traceSVG = generateTraceBasedDiagramSVG(
          traceData,
          {
            total_ridge_ft: lm.ridges_total_ft,
            total_hip_ft: lm.hips_total_ft,
            total_valley_ft: lm.valleys_total_ft,
            total_eave_ft: lm.eaves_total_ft,
            total_rake_ft: lm.rakes_total_ft,
          },
          km.total_projected_footprint_ft2,
          km.dominant_pitch_angle_deg,
          km.dominant_pitch_label,
          km.total_squares_gross_w_waste,
          km.total_roof_area_sloped_ft2
        )
        ;(reportData as any).trace_diagram_svg = traceSVG
        // Stash the raw trace input so the customer-report template can
        // re-render the 2D diagram with hideMeasurements:true.
        ;(reportData as any).customer_trace_input = traceData
      } catch (svgErr: any) {
        console.warn(`[Generate] Order ${orderId}: Trace SVG generation failed: ${svgErr.message}`)
      }

      console.log(`[Generate] Order ${orderId}: ✅ TRACE-ENGINE report built — ` +
        `footprint=${km.total_projected_footprint_ft2}sqft, sloped=${km.total_roof_area_sloped_ft2}sqft, ` +
        `pitch=${km.dominant_pitch_label}, squares=${km.total_squares_gross_w_waste}, ` +
        `eave=${lm.eaves_total_ft}ft, ridge=${lm.ridges_total_ft}ft, hip=${lm.hips_total_ft}ft`)

    } else {
      // ─── FALLBACK PATH: No trace data ───
      console.warn(`[Generate] Order ${orderId}: ⚠️ NO TRACE DATA — attempting Solar Geometry auto-eaves`)

      // ── ATTEMPT 1: Solar Geometry auto-eaves → engine (Phase 1 auto-trace) ──
      let autoTraceSucceeded = false
      if (solarApiKey && order.latitude && order.longitude) {
        try {
          const rawSolar = await fetchBuildingInsightsRaw(order.latitude, order.longitude, solarApiKey)
          if (rawSolar) {
            const solarGeo = buildSolarGeometry(rawSolar)
            if (solarGeo) {
              const autoPayload = solarGeometryToTracePayload(rawSolar, solarGeo, {
                property_address: order.property_address,
                homeowner_name:   order.homeowner_name,
                order_number:     order.order_number,
              })
              if (autoPayload && autoPayload.eaves_outline.length >= 3) {
                const engine = new RoofMeasurementEngine(autoPayload)
                traceResult = engine.run()
                autoTraceSucceeded = true
                console.log(`[Generate] Order ${orderId}: ✅ Auto-eaves — ${autoPayload.eaves_outline.length} perimeter pts, pitch ${autoPayload.default_pitch}/12`)
              }
            }
          }
        } catch (e: any) {
          console.warn(`[Generate] Order ${orderId}: Auto-eaves failed: ${e.message}`)
        }
      }

      if (autoTraceSucceeded && traceResult) {
        // ── Auto-trace succeeded: build report from engine results (same as trace path) ──
        const km  = traceResult.key_measurements
        const lm  = traceResult.linear_measurements
        const mat = traceResult.materials_estimate

        const totalSlopedFt2 = km.total_roof_area_sloped_ft2
        const segments = traceResult.face_details.length > 0
          ? traceResult.face_details.map((face, i) => ({
              name: face.face_id || `Face ${i + 1}`,
              footprint_area_sqft: Math.round(face.projected_area_ft2),
              true_area_sqft:      Math.round(face.sloped_area_ft2),
              pitch_degrees:       face.pitch_angle_deg,
              pitch_ratio:         face.pitch_label,
              azimuth_degrees:     face.azimuth_deg != null ? Math.round(face.azimuth_deg * 10) / 10 : 0,
              azimuth_direction:   face.azimuth_deg != null ? degreesToCardinal(face.azimuth_deg) : '',
              area_meters2:        Math.round(face.sloped_area_ft2 / 10.7639 * 10) / 10,
            }))
          : [{
              name:                'Main Roof',
              footprint_area_sqft: Math.round(km.total_projected_footprint_ft2),
              true_area_sqft:      Math.round(totalSlopedFt2),
              pitch_degrees:       km.dominant_pitch_angle_deg,
              pitch_ratio:         km.dominant_pitch_label,
              azimuth_degrees:     0,
              azimuth_direction:   '',
              area_meters2:        Math.round(totalSlopedFt2 / 10.7639 * 10) / 10,
            }]

        const autoEdges = generateEdgesFromSegments(segments, Math.round(km.total_projected_footprint_ft2))
        const autoEdgeSummary = computeEdgeSummary(autoEdges)
        const autoMaterials = computeMaterialEstimate(Math.round(totalSlopedFt2), autoEdges, segments)

        reportData = {
          property: {
            address: order.property_address || '',
            city: order.property_city || '', province: order.property_province || '',
            postal_code: order.property_postal_code || '',
            homeowner_name: order.homeowner_name || '', homeowner_email: order.homeowner_email || '',
            latitude: order.latitude || 0, longitude: order.longitude || 0,
          },
          total_footprint_sqft:  Math.round(km.total_projected_footprint_ft2),
          total_true_area_sqft:  Math.round(totalSlopedFt2),
          total_squares:         km.total_squares_gross_w_waste,
          waste_factor_pct:      Math.round((km.waste_factor - 1) * 100),
          roof_pitch_degrees:    km.dominant_pitch_angle_deg,
          roof_pitch_ratio:      km.dominant_pitch_label,
          segments,
          edges: autoEdges,
          edge_summary: autoEdgeSummary,
          materials: autoMaterials,
          satellite_image_url: solarPitch?.satellite_image_url || '',
          map_image_url:       solarPitch?.satellite_image_url || '',
          metadata: {
            generated_at:   new Date().toISOString(),
            api_duration_ms: Date.now() - startTime,
            provider:       'solar_geometry_auto_trace',
            engine_version: 'trace_engine_v4+auto_eaves_v1',
            order_id:       String(orderId),
          },
          quality: {
            confidence_score: 82,
            notes: ['⚠️ Measurements auto-generated from satellite data — no roof trace drawn. Accuracy ~80%. For maximum accuracy, submit a traced order.'],
            data_sources: ['google_solar_api', 'trace_engine_v4'],
          },
        } as RoofReport

      } else {
        // ── ATTEMPT 2: Legacy Solar API full report (unchanged fallback) ──
        if (solarApiKey && order.latitude && order.longitude) {
          try {
            reportData = await callGoogleSolarAPI(order.latitude, order.longitude, solarApiKey, typeof orderId === 'string' ? parseInt(orderId) : orderId as number, order, mapsApiKey)
            reportData.metadata.api_duration_ms = Date.now() - startTime
            console.log(`[Generate] Order ${orderId}: Legacy Solar API report — ${reportData.total_footprint_sqft} sqft, pitch ${reportData.roof_pitch_degrees}°`)
          } catch (e: any) {
            const is404 = e.message.includes('404') || e.message.includes('NOT_FOUND')
            let gptEst = null
            if (is404 && order.latitude && order.longitude) gptEst = await generateGPTRoofEstimate(order.property_address || '', order.latitude, order.longitude, env)
            reportData = generateMockRoofReport(order, mapsApiKey, gptEst)
            reportData.metadata.provider = is404 ? (gptEst ? 'gpt-vision-estimate' : 'estimated (no coverage)') : 'estimated (error)'
          }
        } else {
          reportData = generateMockRoofReport(order, mapsApiKey)
        }

        reportData.quality.notes = reportData.quality.notes || []
        reportData.quality.notes.unshift('⚠️ NO ROOF TRACE DATA — measurements are Solar API estimates only. For accurate measurements, re-order with roof outline tracing.')
        reportData.quality.confidence_score = Math.min(reportData.quality.confidence_score, 75)
      }
    }

    // ── AI ANALYSIS REMOVED FROM BASE REPORT ──
    // Cloud Run, Gemini geometry, and Gemini vision scans have been
    // removed from the base report pipeline to stay within Cloudflare
    // Workers' 30-second waitUntil() budget. They are triggered
    // separately by the dashboard via /enhance and /vision-inspect
    // endpoints, each in their own HTTP request/timeout window.
    // The base report relies on trace measurements + Solar pitch only,
    // which is already accurate and fast (~5-10s total).

    // ── CUSTOMER PRICING ──
    if (order.price_per_bundle && order.price_per_bundle > 0) {
      const trueArea = reportData.total_true_area_sqft || 0
      const wasteMultiplier = 1.20  // +5% safety margin per Reuse Canada standard
      const grossSquares = Math.ceil((trueArea * wasteMultiplier) / 100 * 10) / 10
      reportData.customer_price_per_bundle = parseFloat(order.price_per_bundle)
      reportData.customer_gross_squares = grossSquares
      reportData.customer_total_cost_estimate = Math.round(grossSquares * parseFloat(order.price_per_bundle) * 100) / 100
      console.log(`[Generate] Order ${orderId}: Customer pricing — $${order.price_per_bundle}/sq × ${grossSquares} squares = $${reportData.customer_total_cost_estimate} CAD`)
    }

    // ── PRO-TIER: confidence breakdown, version diff ──
    try {
      const { computeConfidenceBreakdown, diffMeasurements } = await import('../services/report-pro')

      ;(reportData as any).confidence_breakdown = computeConfidenceBreakdown({
        imagery_quality: reportData.quality?.imagery_quality,
        pitch_confidence: (reportData as any).pitch_confidence,
        pitch_source: (reportData as any).pitch_source,
        area_variance_pct: (reportData as any).review_flag?.delta_pct,
        edge_classifier_ran: !!((reportData as any).edge_classifier_ran || (reportData.edges || []).some((e: any) => typeof e.classifier_confidence === 'number')),
        avg_edge_classifier_confidence: avgEdgeConfidence(reportData.edges),
        low_confidence_edge_count: (reportData.edges || []).filter((e: any) => typeof e.classifier_confidence === 'number' && e.classifier_confidence < 70).length,
      })

      // Snapshot prior + compute diff before persisting the new payload.
      const prior = await repo.getPriorReportSnapshot(env.DB, orderId)
      let diffSummary: any = null
      if (prior) {
        diffSummary = diffMeasurements(prior.data, reportData as any, prior.version_num)
        ;(reportData as any).diff_summary = diffSummary
        const newVersion = await repo.snapshotPriorReportVersion(env.DB, orderId, diffSummary)
        ;(reportData as any).current_version_num = newVersion
      } else {
        ;(reportData as any).current_version_num = 1
      }

    } catch (proErr: any) {
      console.warn(`[Generate] Order ${orderId}: pro-tier metadata pipeline error (non-fatal):`, proErr?.message)
    }

    // ── METAL FLASHING — runs vision (if not already done) and appends
    //   chimney/pipe-boot BOM lines at this contractor's prices. Never
    //   blocks: vision failures degrade silently to zero counts.
    try {
      const flashingImg =
        (reportData as any)?.imagery?.satellite_overhead_url ||
        (reportData as any)?.imagery?.satellite_url ||
        (order?.latitude && order?.longitude && env.GOOGLE_MAPS_API_KEY
          ? `https://maps.googleapis.com/maps/api/staticmap?center=${order.latitude},${order.longitude}&zoom=20&size=640x640&scale=2&maptype=satellite&key=${env.GOOGLE_MAPS_API_KEY}`
          : null)
      await enrichReportWithFlashing(reportData as any, env.DB, {
        imageUrl: flashingImg,
        customerId: order?.customer_id ?? null,
        vertexApiKey: env.GOOGLE_VERTEX_API_KEY,
        gcpProject: env.GOOGLE_CLOUD_PROJECT,
        gcpLocation: env.GOOGLE_CLOUD_LOCATION,
        serviceAccountKey: env.GCP_SERVICE_ACCOUNT_KEY,
        visionTimeoutMs: 12000,
      })
    } catch (flashErr: any) {
      console.warn(`[Generate] Order ${orderId}: flashing enrichment skipped: ${flashErr?.message}`)
    }

    // ── GUTTERS — derive gutter LF + downspouts from eaves and append a
    //   priced BOM line. Sync, no vision needed; never blocks the report.
    try {
      await enrichReportWithGutters(reportData as any, env.DB, {
        customerId: order?.customer_id ?? null,
      })
    } catch (gutterErr: any) {
      console.warn(`[Generate] Order ${orderId}: gutter enrichment skipped: ${gutterErr?.message}`)
    }

    console.log(`[Generate] Order ${orderId}: generating HTML report...`)
    let html: string
    const finalReportData = reportData

    try {
      html = generateProfessionalReportHTML(finalReportData)
      console.log(`[Generate] Order ${orderId}: HTML generated (${html.length} chars)`)
    } catch (htmlErr: any) {
      console.error(`[Generate] Order ${orderId}: HTML generation FAILED:`, htmlErr.message)
      html = `<html><body><h1>Report Generated</h1><p>HTML rendering failed: ${htmlErr.message}</p><pre>${JSON.stringify(finalReportData.property, null, 2)}</pre></body></html>`
    }

    const baseVersion = '5.0'
    const hasEnhanceKey = !!env.GEMINI_ENHANCE_API_KEY

    await repo.saveCompletedReport(env.DB, orderId, finalReportData, html, baseVersion)
    // markOrderStatus stamps orders.delivered_at and is a customer-visible
    // signal — defer it to finalizeReportDelivery so the admin-review flow
    // can render HTML without flipping the order to delivered.
    if (!opts?.skipCustomerDelivery) {
      await repo.markOrderStatus(env.DB, orderId, 'completed')
    }
    console.log(`[Generate] Order ${orderId}: ✅ Report saved as COMPLETED (v${baseVersion}, provider=${finalReportData.metadata?.provider || 'unknown'})`)

    // Inline error scan — sanity-checks the just-generated report against the
    // same gates the SVG renderer uses and flags duplicates / broken diagrams
    // into the Super Admin Loop Tracker. Fire-and-forget; never blocks delivery.
    // Runs in draft mode too — admin benefits from the diagnostics.
    {
      const { scanReportInline } = await import('../services/loop-scanner')
      const inlineP = scanReportInline(env, orderId)
        .catch(e => console.warn(`[Generate] Order ${orderId}: inline scan error: ${e?.message || e}`))
      if (ctx?.waitUntil) ctx.waitUntil(inlineP)
    }

    // ── CUSTOMER REPORT (no measurements) ──
    // A second artifact built from the same data: aerial + 2D diagram, no
    // numbers anywhere. Stored on reports.customer_report_html so the
    // homeowner can see what was measured without being able to hand the
    // measurements themselves to a competing roofer. Failures here are
    // non-fatal — the regular report has already been saved. Safe in draft
    // mode: the customer can't reach the row until admin_review_status flips
    // to 'approved' (gated in customer-auth queries).
    let customerHtml: string | null = null
    try {
      customerHtml = generateCustomerReportHTML(finalReportData)
      await repo.saveCustomerReportHtml(env.DB, orderId, customerHtml)
      console.log(`[Generate] Order ${orderId}: customer report saved (${customerHtml.length} chars)`)
    } catch (custErr: any) {
      console.warn(`[Generate] Order ${orderId}: customer report generation failed: ${custErr?.message}`)
      customerHtml = null
    }

    // Customer-facing side effects (CRM dispatch, auto-email, auto-invoice).
    // These fire only on the immediate-delivery path. The admin-review path
    // skips them and lets POST /superadmin/orders/:id/approve-and-deliver
    // call finalizeReportDelivery() once the operator clicks "Submit to
    // Customer".
    if (!opts?.skipCustomerDelivery) {
      await finalizeReportDelivery(orderId, env, ctx, { order, customerHtmlExists: !!customerHtml })
    }

    // ── AUTO-EMBED for semantic search (non-blocking) ──
    const embedKey = env.GEMINI_ENHANCE_API_KEY || env.GOOGLE_VERTEX_API_KEY
    if (embedKey) {
      embedAndStoreReport(env.DB, typeof orderId === 'string' ? parseInt(orderId) : orderId as number, finalReportData, embedKey, order)
        .then(r => { if (r.success) console.log(`[Generate] Order ${orderId}: ✅ Embedded for search`) })
        .catch(e => console.warn(`[Generate] Order ${orderId}: ⚠️ Search embedding failed (non-critical): ${e.message}`))
    }

    return {
      success: true,
      report: finalReportData,
      version: baseVersion,
      provider: finalReportData.metadata?.provider || 'unknown',
      hasEnhanceKey
    }
  } catch (err: any) {
    // Never reject the customer — route the failure to super-admin trace queue.
    try { await repo.flagForReview(env.DB, orderId, 'gen_exception', { error: err.message?.substring(0, 500) }) } catch {}
    return { success: false, error: err.message }
  }
}


// ============================================================
// API Order Finalization Hook
// Called after report generation succeeds for API-sourced orders.
// Flips api_jobs status to 'ready', signs PDF URL, fires webhook.
// ============================================================
async function finalizeApiJobIfNeeded(orderId: number | string, env: Bindings): Promise<void> {
  // Look up the order to check if it came from the API
  const order = await env.DB.prepare(
    'SELECT source, api_job_id FROM orders WHERE id = ?'
  ).bind(orderId).first<{ source: string; api_job_id: string | null }>()

  if (!order || order.source !== 'api' || !order.api_job_id) return

  const jobId = order.api_job_id

  // Fetch the job + account for webhook delivery
  const job = await env.DB.prepare(`
    SELECT j.*, a.webhook_url, a.webhook_secret
    FROM api_jobs j
    JOIN api_accounts a ON a.id = j.account_id
    WHERE j.id = ?
  `).bind(jobId).first<any>()

  if (!job) {
    console.warn(`[API-finalize] api_job ${jobId} not found`)
    return
  }

  if (job.status !== 'queued' && job.status !== 'tracing' && job.status !== 'generating') {
    // Already finalized (retry scenario)
    return
  }

  // Sign a fresh PDF URL
  const baseUrl = 'https://www.roofmanager.ca'
  const { url: pdfUrl, expiresAt } = await signPdfUrl(baseUrl, env.JWT_SECRET, jobId)

  const now = Math.floor(Date.now() / 1000)

  // Update job to ready
  await env.DB.prepare(`
    UPDATE api_jobs
    SET status = 'ready', pdf_signed_url = ?, pdf_expires_at = ?, finalized_at = ?
    WHERE id = ?
  `).bind(pdfUrl, expiresAt, now, jobId).run()

  // Record the debit (hold already decremented balance)
  await debitCredit(env.DB, job.account_id, jobId)

  // Fire webhook if registered
  if (job.webhook_url && job.webhook_secret) {
    const updatedJob = { ...job, status: 'ready', pdf_signed_url: pdfUrl, pdf_expires_at: expiresAt }
    const payload = buildWebhookPayload(updatedJob)
    deliverWebhook(env.DB, jobId, job.webhook_url, job.webhook_secret, payload, 0)
      .catch(err => console.error('[API-finalize] Webhook delivery error:', err))
  }

  console.log(`[API-finalize] Job ${jobId} finalized for order ${orderId} — PDF signed, webhook queued`)
}

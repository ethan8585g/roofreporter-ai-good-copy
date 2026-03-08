// ============================================================
// RoofReporterAI — Cloud Run Custom AI Integration
// ============================================================
// Connects to YOUR custom-trained AI model hosted on Google Cloud Run
// (collab-581996238660.europe-west1.run.app) for enhanced roof analysis.
//
// This module provides a DUAL-PATH architecture:
//   PRIMARY:  Cloud Run custom model (your Colab-trained weights)
//   FALLBACK: Gemini API (existing infrastructure)
//
// The Cloud Run service is expected to expose these endpoints:
//   POST /api/analyze          — Full roof analysis (vision + geometry)
//   POST /api/vision-inspect   — Vision-only inspection (vulnerabilities/obstructions)
//   POST /api/geometry         — Geometry-only analysis (facets/lines/measurements)
//   POST /api/batch-analyze    — Multi-image batch analysis
//   GET  /api/health           — Health check + model info
//   GET  /api/model-info       — Model version, training date, capabilities
//
// When Cloud Run code is not yet deployed, all calls gracefully
// fall back to existing Gemini-based analysis with zero disruption.
// ============================================================

import type {
  VisionFindings,
  VisionFinding,
  HeatScore,
  VisionSeverity,
  VisionCategory,
  AIMeasurementAnalysis,
  AIRoofFacet,
  AIRoofLine,
  MeasurementPoint
} from '../types'
import { computeHeatScore } from './vision-analyzer'

// ============================================================
// CONFIGURATION
// ============================================================

const DEFAULT_CLOUD_RUN_URL = 'https://collab-581996238660.europe-west1.run.app'
const CLOUD_RUN_TIMEOUT_MS = 90_000  // Cloud Run can handle longer inference
const CLOUD_RUN_HEALTH_TIMEOUT_MS = 5_000

export interface CloudRunAIConfig {
  /** Cloud Run service base URL */
  baseUrl: string
  /** Optional auth token for Cloud Run IAM */
  authToken?: string
  /** Request timeout in ms (default 90s — Cloud Run supports GPU inference) */
  timeoutMs?: number
  /** GCP Service Account key for generating ID tokens */
  serviceAccountKey?: string
}

// ============================================================
// TYPES — Cloud Run API Contract
// ============================================================
// These types define what YOUR Cloud Run model should return.
// When you deploy from Colab, implement endpoints matching these.
// ============================================================

/** Request payload sent TO Cloud Run */
export interface CloudRunAnalyzeRequest {
  /** Satellite/aerial image URL(s) */
  image_urls: string[]
  /** Analysis type requested */
  analysis_type: 'full' | 'vision_only' | 'geometry_only'
  /** Property coordinates for geo-context */
  coordinates?: { lat: number; lng: number }
  /** Property address for context */
  address?: string
  /** Known roof area (helps calibrate geometry) */
  known_footprint_sqft?: number
  /** Known average pitch */
  known_pitch_deg?: number
  /** Image metadata */
  image_meta?: {
    source: 'google_maps_satellite' | 'rgb_geotiff' | 'street_view' | 'drone'
    zoom_level?: number
    resolution_px?: number
  }
}

/** Response FROM Cloud Run — Full analysis */
export interface CloudRunAnalyzeResponse {
  success: boolean
  model_version: string
  inference_time_ms: number

  /** Vision findings (vulnerabilities, obstructions, etc.) */
  vision?: {
    findings: CloudRunVisionFinding[]
    overall_condition: string
    summary: string
    confidence_calibrated: boolean
  }

  /** Geometry analysis (facets, lines, measurements) */
  geometry?: {
    facets: CloudRunFacet[]
    lines: CloudRunLine[]
    obstructions?: CloudRunObstruction[]
    overall_quality_score: number
    pixel_scale?: { meters_per_pixel: number; sqft_per_pixel: number }
  }

  /** Error info if analysis failed */
  error?: string
  error_code?: string
}

interface CloudRunVisionFinding {
  category: string
  type: string
  label: string
  description: string
  severity: string
  confidence: number
  bounding_box?: number[]
  impact?: string
  recommendation?: string
}

interface CloudRunFacet {
  id: string
  points: { x: number; y: number }[]
  pitch_deg?: number
  pitch_ratio?: string  // e.g. "6/12"
  azimuth_deg?: number
  area_sqft?: number
}

interface CloudRunLine {
  type: string  // RIDGE, HIP, VALLEY, EAVE, RAKE
  start: { x: number; y: number }
  end: { x: number; y: number }
  length_ft?: number
}

interface CloudRunObstruction {
  type: string
  label: string
  position: { x: number; y: number }
  bounding_box?: number[]
}

/** Cloud Run health check response */
export interface CloudRunHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy'
  model_version: string
  model_type: string
  gpu_available: boolean
  last_inference_ms?: number
  uptime_seconds: number
  capabilities: string[]
  training_date?: string
  training_dataset_size?: number
}

// ============================================================
// CLOUD RUN AI CLIENT
// ============================================================

/**
 * Check if the Cloud Run AI service is available and deployed.
 * Returns health info or null if not reachable.
 */
export async function checkCloudRunHealth(
  config: CloudRunAIConfig
): Promise<CloudRunHealthResponse | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CLOUD_RUN_HEALTH_TIMEOUT_MS)

    const headers: Record<string, string> = {
      'Accept': 'application/json'
    }
    if (config.authToken) {
      headers['Authorization'] = `Bearer ${config.authToken}`
    }

    const resp = await fetch(`${config.baseUrl}/api/health`, {
      method: 'GET',
      headers,
      signal: controller.signal
    })
    clearTimeout(timer)

    if (!resp.ok) {
      // Check if it's the placeholder page (HTML instead of JSON)
      const ct = resp.headers.get('content-type') || ''
      if (ct.includes('text/html')) {
        console.log('[CloudRunAI] Service returns HTML placeholder — code not yet deployed')
        return null
      }
      return null
    }

    const ct = resp.headers.get('content-type') || ''
    if (ct.includes('text/html')) {
      // Placeholder page — service exists but no code deployed
      console.log('[CloudRunAI] Service returns HTML — Cloud Run placeholder detected')
      return null
    }

    return await resp.json() as CloudRunHealthResponse
  } catch (e: any) {
    if (e.name === 'AbortError') {
      console.log('[CloudRunAI] Health check timed out')
    } else {
      console.log(`[CloudRunAI] Health check failed: ${e.message}`)
    }
    return null
  }
}

/**
 * Run full roof analysis via Cloud Run custom AI model.
 * Returns null if Cloud Run is unavailable (caller should fall back to Gemini).
 */
export async function analyzeViaCloudRun(
  config: CloudRunAIConfig,
  request: CloudRunAnalyzeRequest
): Promise<CloudRunAnalyzeResponse | null> {
  const timeoutMs = config.timeoutMs || CLOUD_RUN_TIMEOUT_MS
  const startMs = Date.now()

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Request-Source': 'roofreporterai-cloudflare'
    }
    if (config.authToken) {
      headers['Authorization'] = `Bearer ${config.authToken}`
    }

    const endpoint = request.analysis_type === 'vision_only'
      ? '/api/vision-inspect'
      : request.analysis_type === 'geometry_only'
        ? '/api/geometry'
        : '/api/analyze'

    console.log(`[CloudRunAI] Calling ${endpoint} with ${request.image_urls.length} image(s), timeout ${timeoutMs}ms`)

    const resp = await fetch(`${config.baseUrl}${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: controller.signal
    })
    clearTimeout(timer)

    // Detect placeholder page
    const ct = resp.headers.get('content-type') || ''
    if (ct.includes('text/html')) {
      console.log('[CloudRunAI] Got HTML response — service not deployed yet, skipping')
      return null
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => 'Unknown error')
      console.warn(`[CloudRunAI] Error ${resp.status}: ${errText.substring(0, 300)}`)
      return null
    }

    const result = await resp.json() as CloudRunAnalyzeResponse
    result.inference_time_ms = result.inference_time_ms || (Date.now() - startMs)

    console.log(`[CloudRunAI] ✅ Analysis complete in ${Date.now() - startMs}ms — model: ${result.model_version}, vision: ${result.vision?.findings?.length || 0} findings, geometry: ${result.geometry?.facets?.length || 0} facets`)

    return result
  } catch (e: any) {
    if (e.name === 'AbortError') {
      console.warn(`[CloudRunAI] Request timed out after ${timeoutMs}ms`)
    } else {
      console.warn(`[CloudRunAI] Request failed: ${e.message}`)
    }
    return null
  }
}

/**
 * Run batch multi-image analysis.
 * Sends satellite, aerial, and street view images in one request
 * for comprehensive analysis.
 */
export async function batchAnalyzeViaCloudRun(
  config: CloudRunAIConfig,
  imageUrls: string[],
  metadata: {
    coordinates?: { lat: number; lng: number }
    address?: string
    footprint_sqft?: number
    pitch_deg?: number
  }
): Promise<CloudRunAnalyzeResponse | null> {
  return analyzeViaCloudRun(config, {
    image_urls: imageUrls,
    analysis_type: 'full',
    coordinates: metadata.coordinates,
    address: metadata.address,
    known_footprint_sqft: metadata.footprint_sqft,
    known_pitch_deg: metadata.pitch_deg,
    image_meta: {
      source: 'google_maps_satellite',
      zoom_level: 20,
      resolution_px: 640
    }
  })
}

// ============================================================
// RESPONSE CONVERTERS
// ============================================================
// Convert Cloud Run responses to existing RoofReporterAI types
// so the rest of the system works unchanged.
// ============================================================

/**
 * Convert Cloud Run vision response → VisionFindings (our internal type).
 */
export function convertToVisionFindings(
  cloudRunResponse: CloudRunAnalyzeResponse,
  sourceType: string = 'satellite_overhead'
): VisionFindings | null {
  if (!cloudRunResponse.vision?.findings?.length) return null

  const findings: VisionFinding[] = cloudRunResponse.vision.findings
    .filter(f => f.confidence >= 50)
    .map((f, i) => ({
      id: `VF-CR-${String(i + 1).padStart(3, '0')}`,
      category: validateCategory(f.category),
      type: String(f.type || 'unknown'),
      label: String(f.label || f.type || 'Unknown'),
      description: String(f.description || ''),
      severity: validateSeverity(f.severity),
      confidence: Math.max(0, Math.min(100, Math.round(Number(f.confidence) || 50))),
      bounding_box: Array.isArray(f.bounding_box) && f.bounding_box.length === 4
        ? f.bounding_box.map(v => Math.max(0, Math.min(640, Math.round(v))))
        : undefined,
      impact: String(f.impact || 'No specific impact noted'),
      recommendation: String(f.recommendation || 'Monitor during field inspection')
    }))

  const heatScore = computeHeatScore(findings)

  return {
    inspected_at: new Date().toISOString(),
    model: `cloud-run-custom/${cloudRunResponse.model_version || 'unknown'}`,
    finding_count: findings.length,
    findings,
    heat_score: heatScore,
    overall_condition: validateCondition(cloudRunResponse.vision.overall_condition) || deriveCondition(heatScore.total),
    summary: String(cloudRunResponse.vision.summary || `${findings.length} findings via custom AI model`).substring(0, 200),
    duration_ms: cloudRunResponse.inference_time_ms,
    source_image: sourceType
  }
}

/**
 * Convert Cloud Run geometry response → AIMeasurementAnalysis (our internal type).
 */
export function convertToAIGeometry(
  cloudRunResponse: CloudRunAnalyzeResponse
): AIMeasurementAnalysis | null {
  if (!cloudRunResponse.geometry?.facets?.length) return null

  const facets: AIRoofFacet[] = cloudRunResponse.geometry.facets.map(f => ({
    id: f.id,
    points: f.points.map(p => ({ x: p.x, y: p.y } as MeasurementPoint)),
    pitch: f.pitch_ratio || `${f.pitch_deg || 25} deg`,
    azimuth: `${f.azimuth_deg || 180} deg`
  }))

  const lines: AIRoofLine[] = cloudRunResponse.geometry.lines.map(l => ({
    type: validateLineType(l.type),
    start: { x: l.start.x, y: l.start.y } as MeasurementPoint,
    end: { x: l.end.x, y: l.end.y } as MeasurementPoint
  }))

  const obstructions = (cloudRunResponse.geometry.obstructions || []).map(o => ({
    type: o.type,
    label: o.label,
    position: { x: o.position.x, y: o.position.y } as MeasurementPoint,
    bounding_box: o.bounding_box
  }))

  return {
    facets,
    lines,
    obstructions,
    overall_quality_score: cloudRunResponse.geometry.overall_quality_score || 70,
    pixel_scale: cloudRunResponse.geometry.pixel_scale
  } as AIMeasurementAnalysis
}

/**
 * Merge Cloud Run findings with Gemini findings for maximum coverage.
 * Cloud Run findings take priority when overlapping (higher confidence from custom model).
 */
export function mergeVisionFindings(
  cloudRunFindings: VisionFindings | null,
  geminiFindings: VisionFindings | null
): VisionFindings | null {
  if (!cloudRunFindings && !geminiFindings) return null
  if (!cloudRunFindings) return geminiFindings
  if (!geminiFindings) return cloudRunFindings

  // Cloud Run findings take priority — add Gemini findings that don't overlap
  const merged = [...cloudRunFindings.findings]
  const crTypes = new Set(merged.map(f => f.type))

  for (const gf of geminiFindings.findings) {
    // Only add Gemini finding if Cloud Run didn't detect same type in same area
    if (!crTypes.has(gf.type)) {
      merged.push({ ...gf, id: gf.id.replace('VF-', 'VF-GM-') })
    } else {
      // Same type exists — only add if bounding boxes don't overlap
      const overlaps = merged.some(
        cf => cf.type === gf.type &&
        cf.bounding_box && gf.bounding_box &&
        boxOverlap(cf.bounding_box, gf.bounding_box) > 0.3
      )
      if (!overlaps) {
        merged.push({ ...gf, id: gf.id.replace('VF-', 'VF-GM-') })
      }
    }
  }

  const heatScore = computeHeatScore(merged)

  return {
    inspected_at: new Date().toISOString(),
    model: `merged/${cloudRunFindings.model}+${geminiFindings.model}`,
    finding_count: merged.length,
    findings: merged,
    heat_score: heatScore,
    overall_condition: deriveCondition(heatScore.total),
    summary: `${merged.length} findings (${cloudRunFindings.findings.length} custom AI + ${merged.length - cloudRunFindings.findings.length} Gemini) — Heat ${heatScore.total}/100`,
    duration_ms: (cloudRunFindings.duration_ms || 0) + (geminiFindings.duration_ms || 0),
    source_image: cloudRunFindings.source_image || geminiFindings.source_image
  }
}

// ============================================================
// CONVENIENCE: Build config from Cloudflare env bindings
// ============================================================

export function buildCloudRunConfig(env: any): CloudRunAIConfig | null {
  const baseUrl = env.CLOUD_RUN_AI_URL || DEFAULT_CLOUD_RUN_URL
  if (!baseUrl) return null

  return {
    baseUrl,
    authToken: env.CLOUD_RUN_AI_TOKEN || undefined,
    serviceAccountKey: env.GCP_SERVICE_ACCOUNT_KEY || undefined,
    timeoutMs: env.CLOUD_RUN_TIMEOUT_MS ? parseInt(env.CLOUD_RUN_TIMEOUT_MS) : CLOUD_RUN_TIMEOUT_MS
  }
}

// ============================================================
// HELPERS
// ============================================================

function boxOverlap(a: number[], b: number[]): number {
  const overlapX = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
  const overlapY = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  const overlapArea = overlapX * overlapY
  const areaA = (a[2] - a[0]) * (a[3] - a[1])
  const areaB = (b[2] - b[0]) * (b[3] - b[1])
  const unionArea = areaA + areaB - overlapArea
  return unionArea > 0 ? overlapArea / unionArea : 0
}

function validateSeverity(s: any): VisionSeverity {
  if (['low', 'moderate', 'high', 'critical'].includes(s)) return s
  return 'moderate'
}

function validateCategory(c: any): VisionCategory {
  if (['vulnerability', 'obstruction', 'condition', 'environmental'].includes(c)) return c
  return 'condition'
}

function validateCondition(c: any): VisionFindings['overall_condition'] | null {
  if (['excellent', 'good', 'fair', 'poor', 'critical'].includes(c)) return c
  return null
}

function deriveCondition(score: number): VisionFindings['overall_condition'] {
  if (score >= 75) return 'critical'
  if (score >= 55) return 'poor'
  if (score >= 35) return 'fair'
  if (score >= 15) return 'good'
  return 'excellent'
}

function validateLineType(t: string): AIRoofLine['type'] {
  const valid: AIRoofLine['type'][] = ['RIDGE', 'HIP', 'VALLEY', 'EAVE', 'RAKE']
  const upper = (t || '').toUpperCase() as AIRoofLine['type']
  return valid.includes(upper) ? upper : 'EAVE'
}

// ============================================================
// RoofReporterAI — Google Aerial View API Integration
// ============================================================
// Provides 3D photorealistic drone-style flyover videos for
// property reports. Uses Google's Aerial View API to look up
// existing videos or request new renders.
//
// IMPORTANT: Aerial View API currently supports US addresses only.
// For Canadian addresses, the service gracefully returns null
// and the report falls back to satellite imagery.
//
// API Reference: https://developers.google.com/maps/documentation/aerial-view
//
// Endpoints:
//   - lookupVideoMetadata: Check if video exists (FREE — no billing)
//   - lookupVideo:         Get video URIs (billed per call)
//   - renderVideo:         Request new video generation (billed)
//
// Video IDs can be cached/stored (exempt from Maps TOS caching rules).
// Video URIs are SHORT-LIVED — must re-fetch each time you display.
// ============================================================

const AERIAL_VIEW_BASE = 'https://aerialview.googleapis.com/v1/videos'

// ============================================================
// TYPE DEFINITIONS
// ============================================================

export interface AerialVideoMetadata {
  videoId: string
  captureDate?: { year: number; month: number; day: number }
  duration?: string
  state: 'ACTIVE' | 'PROCESSING'
}

export interface AerialVideoUris {
  IMAGE?: { landscapeUri: string; portraitUri: string }
  MP4_HIGH?: { landscapeUri: string; portraitUri: string }
  MP4_MEDIUM?: { landscapeUri: string; portraitUri: string }
  MP4_LOW?: { landscapeUri: string; portraitUri: string }
  HLS?: { landscapeUri: string; portraitUri: string }
  DASH?: { landscapeUri: string; portraitUri: string }
}

export interface AerialVideoResult {
  state: 'ACTIVE' | 'PROCESSING' | 'NOT_FOUND' | 'NO_3D_IMAGERY' | 'ERROR'
  videoId?: string
  uris?: AerialVideoUris
  metadata?: AerialVideoMetadata
  captureDate?: string  // formatted YYYY-MM-DD
  duration?: string     // e.g. "40s"
  thumbnailUrl?: string // landscape IMAGE URI for preview
  videoUrl?: string     // landscape MP4_MEDIUM URI for embed
  error?: string
}

// ============================================================
// lookupVideoMetadata — Check if aerial video exists (FREE)
// ============================================================
// Use this first to avoid unnecessary billing on lookupVideo.
// Returns videoId + state without generating video URIs.
// ============================================================
export async function lookupVideoMetadata(
  address: string,
  apiKey: string,
  options?: { videoId?: string; timeoutMs?: number }
): Promise<AerialVideoResult> {
  const timeout = options?.timeoutMs || 8000
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const params = new URLSearchParams({ key: apiKey })
    if (options?.videoId) {
      params.set('videoId', options.videoId)
    } else {
      params.set('address', address)
    }

    const url = `${AERIAL_VIEW_BASE}:lookupVideoMetadata?${params.toString()}`
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (response.status === 404) {
      const errBody = await response.json().catch(() => ({})) as any
      const message = errBody?.error?.message || ''
      if (message.includes('No 3d imagery') || message.includes('No 3D imagery')) {
        return { state: 'NO_3D_IMAGERY', error: 'No 3D imagery available for this address' }
      }
      return { state: 'NOT_FOUND', error: 'Video not found — can request rendering' }
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      return { state: 'ERROR', error: `Aerial View API ${response.status}: ${errText.substring(0, 200)}` }
    }

    const data = await response.json() as AerialVideoMetadata
    const captureDate = data.captureDate
      ? `${data.captureDate.year}-${String(data.captureDate.month).padStart(2, '0')}-${String(data.captureDate.day).padStart(2, '0')}`
      : undefined

    return {
      state: data.state,
      videoId: data.videoId,
      metadata: data,
      captureDate,
      duration: data.duration,
    }
  } catch (e: any) {
    clearTimeout(timeoutId)
    if (e.name === 'AbortError') {
      return { state: 'ERROR', error: `Aerial View API timed out after ${timeout}ms` }
    }
    return { state: 'ERROR', error: e.message }
  }
}

// ============================================================
// lookupVideo — Get video URIs for an existing video (BILLED)
// ============================================================
// Returns short-lived URIs for video playback. Must re-fetch
// each time you display the video (URIs expire quickly).
// Includes MP4, HLS, DASH formats + thumbnail IMAGE.
// ============================================================
export async function lookupVideo(
  address: string,
  apiKey: string,
  options?: { videoId?: string; timeoutMs?: number }
): Promise<AerialVideoResult> {
  const timeout = options?.timeoutMs || 10000
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const params = new URLSearchParams({ key: apiKey })
    if (options?.videoId) {
      params.set('videoId', options.videoId)
    } else {
      params.set('address', address)
    }

    const url = `${AERIAL_VIEW_BASE}:lookupVideo?${params.toString()}`
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timeoutId)

    if (response.status === 404) {
      const errBody = await response.json().catch(() => ({})) as any
      const message = errBody?.error?.message || ''
      if (message.includes('No 3d imagery') || message.includes('No 3D imagery')) {
        return { state: 'NO_3D_IMAGERY', error: 'No 3D imagery available' }
      }
      return { state: 'NOT_FOUND', error: 'Video not found' }
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      return { state: 'ERROR', error: `Aerial View API ${response.status}: ${errText.substring(0, 200)}` }
    }

    const data = await response.json() as any

    if (data.state === 'PROCESSING') {
      return {
        state: 'PROCESSING',
        videoId: data.metadata?.videoId,
        metadata: data.metadata,
      }
    }

    const uris = data.uris as AerialVideoUris
    const meta = data.metadata as AerialVideoMetadata
    const captureDate = meta?.captureDate
      ? `${meta.captureDate.year}-${String(meta.captureDate.month).padStart(2, '0')}-${String(meta.captureDate.day).padStart(2, '0')}`
      : undefined

    return {
      state: 'ACTIVE',
      videoId: meta?.videoId,
      uris,
      metadata: meta,
      captureDate,
      duration: meta?.duration,
      thumbnailUrl: uris?.IMAGE?.landscapeUri || undefined,
      videoUrl: uris?.MP4_MEDIUM?.landscapeUri || uris?.MP4_HIGH?.landscapeUri || uris?.MP4_LOW?.landscapeUri || undefined,
    }
  } catch (e: any) {
    clearTimeout(timeoutId)
    if (e.name === 'AbortError') {
      return { state: 'ERROR', error: `Aerial View API timed out after ${timeout}ms` }
    }
    return { state: 'ERROR', error: e.message }
  }
}

// ============================================================
// renderVideo — Request new video generation (BILLED)
// ============================================================
// If lookupVideo returns 404, call this to request rendering.
// Rendering takes 1–3 hours. Returns a videoId to poll later.
// ============================================================
export async function renderVideo(
  address: string,
  apiKey: string,
  options?: { timeoutMs?: number }
): Promise<AerialVideoResult> {
  const timeout = options?.timeoutMs || 10000
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const url = `${AERIAL_VIEW_BASE}:renderVideo?key=${apiKey}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    if (response.status === 400) {
      const errBody = await response.json().catch(() => ({})) as any
      return { state: 'ERROR', error: errBody?.error?.message || 'Address not supported' }
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      return { state: 'ERROR', error: `renderVideo ${response.status}: ${errText.substring(0, 200)}` }
    }

    const data = await response.json() as any

    if (data.state === 'ACTIVE') {
      // Video already existed — return the videoId
      return {
        state: 'ACTIVE',
        videoId: data.metadata?.videoId,
        metadata: data.metadata,
      }
    }

    return {
      state: 'PROCESSING',
      videoId: data.metadata?.videoId,
      metadata: data.metadata,
    }
  } catch (e: any) {
    clearTimeout(timeoutId)
    if (e.name === 'AbortError') {
      return { state: 'ERROR', error: `renderVideo timed out after ${timeout}ms` }
    }
    return { state: 'ERROR', error: e.message }
  }
}

// ============================================================
// fetchAerialViewForReport — Combined workflow for reports
// ============================================================
// 1. Check metadata (free) → if ACTIVE, fetch full video URIs
// 2. If NOT_FOUND → optionally request render
// 3. Returns null-safe result for embedding in reports
//
// This is the main entry point used by the report pipeline.
// ============================================================
export async function fetchAerialViewForReport(
  address: string,
  apiKey: string,
  options?: {
    requestRenderIfMissing?: boolean  // default: true
    timeoutMs?: number                // per-call timeout
  }
): Promise<AerialVideoResult> {
  const requestRender = options?.requestRenderIfMissing !== false
  const callTimeout = options?.timeoutMs || 6000

  console.log(`[AerialView] Looking up video for: ${address}`)

  // Step 1: Check metadata (free call)
  const metadata = await lookupVideoMetadata(address, apiKey, { timeoutMs: callTimeout })

  if (metadata.state === 'ACTIVE' && metadata.videoId) {
    // Video exists — fetch full URIs
    console.log(`[AerialView] Video found (${metadata.videoId}), fetching URIs...`)
    const video = await lookupVideo(address, apiKey, { videoId: metadata.videoId, timeoutMs: callTimeout })
    if (video.state === 'ACTIVE') {
      console.log(`[AerialView] ✓ Video ready: ${video.duration}, captured ${video.captureDate}`)
      return video
    }
    // Fallback: return metadata even if URI fetch failed
    return { ...metadata, error: video.error }
  }

  if (metadata.state === 'PROCESSING') {
    console.log(`[AerialView] Video is rendering (${metadata.videoId}) — will be available later`)
    return metadata
  }

  if (metadata.state === 'NO_3D_IMAGERY') {
    console.log(`[AerialView] No 3D imagery available for this location`)
    return metadata
  }

  if (metadata.state === 'NOT_FOUND' && requestRender) {
    // Step 2: Request render
    console.log(`[AerialView] No video found — requesting render...`)
    const render = await renderVideo(address, apiKey, { timeoutMs: callTimeout })
    if (render.videoId) {
      console.log(`[AerialView] Render requested — videoId: ${render.videoId} (ETA: 1-3 hours)`)
    } else {
      console.log(`[AerialView] Render request failed: ${render.error}`)
    }
    return render
  }

  // NOT_FOUND without render, or ERROR
  console.log(`[AerialView] ${metadata.state}: ${metadata.error}`)
  return metadata
}

// ============================================================
// isUSAddress — Quick heuristic to avoid API calls for CA addresses
// ============================================================
// Aerial View only supports US addresses. This avoids wasting
// API calls (and billing) on Canadian properties.
// ============================================================
export function isLikelyUSAddress(address: string): boolean {
  const upper = address.toUpperCase()

  // Canadian province codes / country indicators
  const canadianPatterns = [
    /\b(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)\s+[A-Z]\d[A-Z]\s*\d[A-Z]\d/,  // Province + postal code
    /\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/,  // Canadian postal code pattern (A1A 1A1)
    /\bCANADA\b/,
    /\bALBERTA\b/,
    /\bONTARIO\b/,
    /\bBRITISH COLUMBIA\b/,
    /\bQUEBEC\b/,
    /\bMANITOBA\b/,
    /\bSASKATCHEWAN\b/,
    /\bNOVA SCOTIA\b/,
    /\bNEW BRUNSWICK\b/,
    /\bPRINCE EDWARD ISLAND\b/,
    /\bNEWFOUNDLAND\b/,
  ]

  for (const pat of canadianPatterns) {
    if (pat.test(upper)) return false
  }

  // US state abbreviations or ZIP code
  const usPatterns = [
    /\b\d{5}(-\d{4})?\b/,  // US ZIP code
    /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\s+\d{5}/,
    /\bUNITED STATES\b/,
    /\bUSA\b/,
  ]

  for (const pat of usPatterns) {
    if (pat.test(upper)) return true
  }

  // Default: try anyway (could be a US address without clear indicators)
  // Return true to allow the API to determine eligibility
  return true
}

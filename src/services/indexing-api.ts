// Google Indexing API client.
//
// Fire-and-forget ping to tell Google a URL was published or updated.
// Cuts blog-post indexing latency from days to (typically) under an hour.
//
// Requirements:
//   - Service account JSON stored in env.INDEXING_SA_JSON (preferred) or
//     env.GCP_SERVICE_ACCOUNT_JSON as fallback.
//   - The service account must be added as an **owner** in Google Search
//     Console for https://www.roofmanager.ca/ — the Indexing API otherwise
//     returns 403 "Permission denied".
//   - If either condition is unmet, this function silently no-ops so blog
//     publishing is never blocked by an indexing-ping failure.

import { createJWT, exchangeJWTForToken } from './gcp-auth'

const INDEXING_ENDPOINT = 'https://indexing.googleapis.com/v3/urlNotifications:publish'
const INDEXING_SCOPE = 'https://www.googleapis.com/auth/indexing'

export type IndexingType = 'URL_UPDATED' | 'URL_DELETED'

export interface IndexingPingResult {
  ok: boolean
  status?: number
  url: string
  type: IndexingType
  error?: string
  skipped?: boolean
}

/** Ping the Google Indexing API for a single URL. Never throws. */
export async function pingGoogleIndexing(
  env: { INDEXING_SA_JSON?: string; GCP_SERVICE_ACCOUNT_JSON?: string; GCP_SERVICE_ACCOUNT_KEY?: string },
  url: string,
  type: IndexingType = 'URL_UPDATED',
): Promise<IndexingPingResult> {
  // Accept all three historical env-var names for the service account JSON.
  // The canonical Pages secret name in this project is GCP_SERVICE_ACCOUNT_KEY.
  const saJson = env.INDEXING_SA_JSON || env.GCP_SERVICE_ACCOUNT_JSON || env.GCP_SERVICE_ACCOUNT_KEY
  if (!saJson) {
    return { ok: false, url, type, skipped: true, error: 'no service account configured' }
  }
  try {
    const sa = JSON.parse(saJson)
    if (sa.type !== 'service_account') {
      return { ok: false, url, type, error: `expected service_account, got ${sa.type}` }
    }
    const jwt = await createJWT(sa, [INDEXING_SCOPE])
    const token = await exchangeJWTForToken(jwt)
    const res = await fetch(INDEXING_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, type }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, url, type, status: res.status, error: body.slice(0, 400) }
    }
    return { ok: true, url, type, status: res.status }
  } catch (e: any) {
    return { ok: false, url, type, error: (e && e.message) || String(e) }
  }
}

/**
 * Ping multiple URLs in a single batch. Shares one access token across the
 * whole list (JWT + token exchange happen once) so Cloudflare Workers'
 * 50-subrequest limit doesn't bite on ping-all operations with 100+ posts.
 * Never throws — per-URL failures come back as an entry with ok=false.
 */
export async function pingGoogleIndexingBatch(
  env: { INDEXING_SA_JSON?: string; GCP_SERVICE_ACCOUNT_JSON?: string; GCP_SERVICE_ACCOUNT_KEY?: string },
  urls: string[],
  type: IndexingType = 'URL_UPDATED',
): Promise<IndexingPingResult[]> {
  const saJson = env.INDEXING_SA_JSON || env.GCP_SERVICE_ACCOUNT_JSON || env.GCP_SERVICE_ACCOUNT_KEY
  if (!saJson) {
    return urls.map(url => ({ ok: false, url, type, skipped: true, error: 'no service account configured' }))
  }
  let accessToken: string
  try {
    const sa = JSON.parse(saJson)
    if (sa.type !== 'service_account') {
      return urls.map(url => ({ ok: false, url, type, error: `expected service_account, got ${sa.type}` }))
    }
    const jwt = await createJWT(sa, [INDEXING_SCOPE])
    const tokenResp = await exchangeJWTForToken(jwt)
    accessToken = tokenResp.access_token
  } catch (e: any) {
    return urls.map(url => ({ ok: false, url, type, error: (e && e.message) || String(e) }))
  }
  // Google Indexing API accepts one URL per call. Send in parallel but
  // reuse the same access token — 1 ping per URL instead of 3.
  return Promise.all(urls.map(async (url): Promise<IndexingPingResult> => {
    try {
      const res = await fetch(INDEXING_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, type }),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        return { ok: false, url, type, status: res.status, error: body.slice(0, 400) }
      }
      return { ok: true, url, type, status: res.status }
    } catch (e: any) {
      return { ok: false, url, type, error: (e && e.message) || String(e) }
    }
  }))
}

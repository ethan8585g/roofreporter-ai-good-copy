// IndexNow client — zero-auth URL notification protocol supported by Bing,
// Yandex, Seznam, Naver, and several other non-Google engines. Complements
// the Google Indexing API (see ./indexing-api.ts).
//
// Spec: https://www.indexnow.org/documentation
//
// Auth model: a single stable key is exposed at /<INDEXNOW_KEY>.txt. Any
// POST to the IndexNow endpoint listing that key + a host value confirms
// ownership. No service account, no OAuth.
//
// The key is hard-coded below (stable across deploys). Rotating it is safe
// — just update INDEXNOW_KEY and redeploy; the key-file route picks up the
// new value automatically.

export const INDEXNOW_KEY = '4ad521923d2b955b7b1015f434ef0f62262af72e9af4cf3857f9803ecef9714e'
export const INDEXNOW_HOST = 'www.roofmanager.ca'

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'

export interface IndexNowResult {
  ok: boolean
  status: number
  count: number
  error?: string
}

/**
 * Submit up to 10,000 URLs to IndexNow in a single request.
 * Always returns a result; never throws.
 */
export async function pingIndexNow(urls: string[]): Promise<IndexNowResult> {
  if (!urls || urls.length === 0) {
    return { ok: false, status: 0, count: 0, error: 'no urls provided' }
  }
  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: INDEXNOW_HOST,
        key: INDEXNOW_KEY,
        keyLocation: `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`,
        urlList: urls,
      }),
    })
    // IndexNow returns 200 OK, 202 Accepted on success. 400/403/422/429 on
    // various errors. We capture status; the body is only populated on errors.
    if (res.status === 200 || res.status === 202) {
      return { ok: true, status: res.status, count: urls.length }
    }
    const body = await res.text().catch(() => '')
    return { ok: false, status: res.status, count: urls.length, error: body.slice(0, 400) }
  } catch (e: any) {
    return { ok: false, status: 0, count: urls.length, error: (e && e.message) || String(e) }
  }
}

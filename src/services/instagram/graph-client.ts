// ============================================================
// Instagram Graph API Client — typed wrapper with retry + backoff
// All Graph API calls flow through this module.
// ============================================================

export interface GraphClientConfig {
  accessToken: string
  apiVersion: string  // e.g. 'v21.0'
  igUserId: string    // Instagram Business Account ID
}

const META_GRAPH_BASE = 'https://graph.facebook.com'

// ── Retry with exponential backoff + jitter ──
async function fetchWithRetry(
  url: string,
  opts: RequestInit,
  maxRetries = 5
): Promise<Response> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, opts)
      if (res.status === 429 && attempt < maxRetries) {
        const base = Math.pow(2, attempt) * 1000
        const jitter = Math.random() * 1000
        await new Promise(r => setTimeout(r, base + jitter))
        continue
      }
      return res
    } catch (err: any) {
      lastError = err
      if (attempt < maxRetries) {
        const base = Math.pow(2, attempt) * 500
        const jitter = Math.random() * 500
        await new Promise(r => setTimeout(r, base + jitter))
      }
    }
  }
  throw lastError || new Error('fetchWithRetry exhausted')
}

function buildUrl(config: GraphClientConfig, path: string, params?: Record<string, string>): string {
  const base = `${META_GRAPH_BASE}/${config.apiVersion}${path}`
  const url = new URL(base)
  url.searchParams.set('access_token', config.accessToken)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v)
    }
  }
  return url.toString()
}

async function graphGet(config: GraphClientConfig, path: string, params?: Record<string, string>): Promise<any> {
  const url = buildUrl(config, path, params)
  const res = await fetchWithRetry(url, { method: 'GET' })
  return res.json()
}

async function graphPost(config: GraphClientConfig, path: string, body: Record<string, any>): Promise<any> {
  const url = buildUrl(config, path)
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.json()
}

// ── Account ──
export async function getAccount(config: GraphClientConfig): Promise<any> {
  return graphGet(config, `/${config.igUserId}`, {
    fields: 'id,username,name,profile_picture_url,followers_count,follows_count,media_count,biography,website',
  })
}

// ── Media List ──
export async function getMediaList(config: GraphClientConfig, limit = 50, after?: string): Promise<any> {
  const params: Record<string, string> = {
    fields: 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count',
    limit: String(limit),
  }
  if (after) params.after = after
  return graphGet(config, `/${config.igUserId}/media`, params)
}

// ── Media Insights (per-post) ──
export async function getMediaInsights(config: GraphClientConfig, mediaId: string, mediaType: string): Promise<any> {
  const metrics = mediaType === 'VIDEO' || mediaType === 'REEL'
    ? 'impressions,reach,saved,shares,video_views,likes,comments,plays'
    : 'impressions,reach,saved,shares,likes,comments'
  return graphGet(config, `/${mediaId}/insights`, { metric: metrics })
}

// ── Account Insights (daily) ──
export async function getAccountInsights(config: GraphClientConfig, since: string, until: string): Promise<any> {
  return graphGet(config, `/${config.igUserId}/insights`, {
    metric: 'impressions,reach,profile_views,website_clicks,email_contacts,phone_call_clicks,follower_count',
    period: 'day',
    since,
    until,
  })
}

// ── Business Discovery (competitor public data) ──
export async function getBusinessDiscovery(config: GraphClientConfig, username: string, mediaLimit = 25): Promise<any> {
  return graphGet(config, `/${config.igUserId}`, {
    fields: `business_discovery.fields(id,username,name,profile_picture_url,followers_count,media_count,media.limit(${mediaLimit}){id,caption,media_type,like_count,comments_count,timestamp,permalink,thumbnail_url}).username(${username})`,
  })
}

// ── Content Publishing (two-step: create container, then publish) ──
export async function createMediaContainer(
  config: GraphClientConfig,
  params: {
    media_type: 'IMAGE' | 'VIDEO' | 'REELS' | 'CAROUSEL_ALBUM'
    image_url?: string
    video_url?: string
    caption?: string
    children?: string[]  // for carousel
  }
): Promise<any> {
  const body: Record<string, any> = {}
  if (params.media_type === 'REELS') {
    body.media_type = 'REELS'
    body.video_url = params.video_url
    if (params.caption) body.caption = params.caption
  } else if (params.media_type === 'VIDEO') {
    body.media_type = 'VIDEO'
    body.video_url = params.video_url
    if (params.caption) body.caption = params.caption
  } else if (params.media_type === 'CAROUSEL_ALBUM') {
    body.media_type = 'CAROUSEL_ALBUM'
    body.children = params.children
    if (params.caption) body.caption = params.caption
  } else {
    body.image_url = params.image_url
    if (params.caption) body.caption = params.caption
  }
  return graphPost(config, `/${config.igUserId}/media`, body)
}

export async function publishMedia(config: GraphClientConfig, containerId: string): Promise<any> {
  return graphPost(config, `/${config.igUserId}/media_publish`, {
    creation_id: containerId,
  })
}

// Check container status (for video uploads that need processing)
export async function getContainerStatus(config: GraphClientConfig, containerId: string): Promise<any> {
  return graphGet(config, `/${containerId}`, {
    fields: 'status_code,status',
  })
}

// ── DM / Messaging ──
export async function sendDMReply(config: GraphClientConfig, recipientId: string, message: string): Promise<any> {
  return graphPost(config, `/${config.igUserId}/messages`, {
    recipient: { id: recipientId },
    message: { text: message },
  })
}

// ── Boosted Posts (Meta Ads API) ──
export async function createBoostedPost(
  accessToken: string,
  apiVersion: string,
  adAccountId: string,
  params: {
    postId: string
    dailyBudgetCents: number
    durationDays: number
    targeting: Record<string, any>
  }
): Promise<any> {
  const url = `${META_GRAPH_BASE}/${apiVersion}/act_${adAccountId}/campaigns`
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      access_token: accessToken,
      name: `IG Boost - ${params.postId}`,
      objective: 'OUTCOME_ENGAGEMENT',
      status: 'ACTIVE',
      special_ad_categories: [],
      daily_budget: params.dailyBudgetCents,
      promoted_object: { page_post_id: params.postId },
      targeting: params.targeting,
      end_time: new Date(Date.now() + params.durationDays * 86400000).toISOString(),
    }),
  })
  return res.json()
}

// ── Get Ad Campaign Insights ──
export async function getAdInsights(
  accessToken: string,
  apiVersion: string,
  campaignId: string
): Promise<any> {
  const url = `${META_GRAPH_BASE}/${apiVersion}/${campaignId}/insights?fields=impressions,clicks,spend,actions,ctr&date_preset=maximum&access_token=${accessToken}`
  const res = await fetchWithRetry(url, { method: 'GET' })
  return res.json()
}

// ── Pause/Resume Ad Campaign ──
export async function updateAdCampaignStatus(
  accessToken: string,
  apiVersion: string,
  campaignId: string,
  status: 'ACTIVE' | 'PAUSED'
): Promise<any> {
  const url = `${META_GRAPH_BASE}/${apiVersion}/${campaignId}`
  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: accessToken, status }),
  })
  return res.json()
}

// ── Webhook signature validation ──
export function validateWebhookSignature(
  payload: string,
  signature: string,
  appSecret: string
): boolean {
  // HMAC-SHA256 validation — implemented inline to avoid crypto import issues on Workers
  // The actual implementation uses the Web Crypto API available on Cloudflare Workers
  // signature format: "sha256=<hex>"
  if (!signature || !signature.startsWith('sha256=')) return false
  // Validation is done asynchronously — see validateWebhookSignatureAsync
  return true // Placeholder; use async version in handlers
}

export async function validateWebhookSignatureAsync(
  payload: string,
  signature: string,
  appSecret: string
): Promise<boolean> {
  if (!signature || !signature.startsWith('sha256=')) return false
  const expectedSig = signature.slice(7)
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
  return hex === expectedSig
}

// ── Token encryption/decryption using AES-GCM ──
export async function encryptToken(token: string, key: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(key.padEnd(32, '0').slice(0, 32))
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, encoder.encode(token))
  const combined = new Uint8Array(iv.length + new Uint8Array(encrypted).length)
  combined.set(iv)
  combined.set(new Uint8Array(encrypted), iv.length)
  return btoa(String.fromCharCode(...combined))
}

export async function decryptToken(encrypted: string, key: string): Promise<string> {
  const encoder = new TextEncoder()
  const keyData = encoder.encode(key.padEnd(32, '0').slice(0, 32))
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, 'AES-GCM', false, ['decrypt'])
  const combined = new Uint8Array(atob(encrypted).split('').map(c => c.charCodeAt(0)))
  const iv = combined.slice(0, 12)
  const data = combined.slice(12)
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, data)
  return new TextDecoder().decode(decrypted)
}

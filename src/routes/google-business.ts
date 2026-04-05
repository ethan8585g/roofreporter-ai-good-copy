// ============================================================
// Roof Manager — Google Business Profile Integration
// Customer-facing — connect GBP, sync reviews, create posts
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { resolveTeamOwner } from './team'

export const googleBusinessRoutes = new Hono<{ Bindings: Bindings }>()

const GBP_API_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1'
const GBP_ACCOUNTS_API = 'https://mybusinessaccountmanagement.googleapis.com/v1'

// ── AUTH HELPER — same pattern as website-builder.ts ──
async function getOwnerId(c: any): Promise<number | null> {
  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  const session = await c.env.DB.prepare(
    "SELECT customer_id FROM customer_sessions WHERE session_token = ? AND expires_at > datetime('now')"
  ).bind(token).first<any>()
  if (!session) return null
  const { ownerId } = await resolveTeamOwner(c.env.DB, session.customer_id)
  return ownerId
}

// ── Helper: refresh Google OAuth access token ──
async function refreshAccessToken(c: any, refreshToken: string): Promise<string | null> {
  const clientId = (c.env as any).GMAIL_CLIENT_ID
  let clientSecret = (c.env as any).GMAIL_CLIENT_SECRET || ''
  if (!clientSecret) {
    try {
      const csRow = await c.env.DB.prepare(
        "SELECT setting_value FROM settings WHERE setting_key = 'gmail_client_secret' AND master_company_id = 1"
      ).first<any>()
      if (csRow?.setting_value) clientSecret = csRow.setting_value
    } catch {}
  }
  if (!clientId || !clientSecret) return null

  try {
    const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret
      }).toString()
    })
    const tokenData: any = await tokenResp.json()
    return tokenData.access_token || null
  } catch {
    return null
  }
}

// ── Helper: call GBP API ──
async function gbpRequest(accessToken: string, method: string, url: string, body?: any): Promise<any> {
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

// ============================================================
// GET /status — Check if GBP is connected
// ============================================================
googleBusinessRoutes.get('/status', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)

  const customer = await c.env.DB.prepare(
    'SELECT gbp_refresh_token, gbp_account_id, gbp_location_id, gbp_business_name, gbp_connected_at FROM customers WHERE id = ?'
  ).bind(ownerId).first<any>()

  return c.json({
    connected: !!customer?.gbp_refresh_token,
    account_id: customer?.gbp_account_id || null,
    location_id: customer?.gbp_location_id || null,
    business_name: customer?.gbp_business_name || null,
    connected_at: customer?.gbp_connected_at || null
  })
})

// ============================================================
// GET /connect — Start OAuth flow for GBP
// ============================================================
googleBusinessRoutes.get('/connect', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)

  const clientId = (c.env as any).GMAIL_CLIENT_ID
  if (!clientId) {
    return c.json({ error: 'Google OAuth is not configured. Contact support.' }, 400)
  }

  const url = new URL(c.req.url)
  const redirectUri = `${url.protocol}//${url.host}/api/google-business/callback`

  const state = `${ownerId}:${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`

  try {
    await c.env.DB.prepare(
      "INSERT OR REPLACE INTO settings (master_company_id, setting_key, setting_value) VALUES (?, ?, ?)"
    ).bind(ownerId, 'gbp_oauth_state', state).run()
  } catch {}

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/business.manage')
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')
  authUrl.searchParams.set('state', state)

  return c.json({ auth_url: authUrl.toString() })
})

// ============================================================
// GET /callback — OAuth callback
// ============================================================
googleBusinessRoutes.get('/callback', async (c) => {
  const code = c.req.query('code')
  const error = c.req.query('error')
  const state = c.req.query('state') || ''

  if (error || !code) {
    return c.html(`<!DOCTYPE html><html><head><title>Google Business Profile</title><script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center"><div class="bg-white rounded-2xl shadow-xl p-8 max-w-md text-center">
<div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-times text-red-500 text-2xl"></i></div>
<h2 class="text-xl font-bold text-gray-800 mb-2">Connection Failed</h2>
<p class="text-gray-600 mb-4">${error || 'No authorization code received'}</p>
<button onclick="window.close()" class="bg-sky-600 text-white px-6 py-2 rounded-lg font-semibold">Close Window</button>
</div></body></html>`)
  }

  const customerId = parseInt(state.split(':')[0])
  if (!customerId) {
    return c.html(`<!DOCTYPE html><html><head><title>Google Business Profile</title></head><body><p>Invalid state. Please try again.</p></body></html>`)
  }

  const clientId = (c.env as any).GMAIL_CLIENT_ID
  let clientSecret = (c.env as any).GMAIL_CLIENT_SECRET || ''
  if (!clientSecret) {
    try {
      const csRow = await c.env.DB.prepare(
        "SELECT setting_value FROM settings WHERE setting_key = 'gmail_client_secret' AND master_company_id = 1"
      ).first<any>()
      if (csRow?.setting_value) clientSecret = csRow.setting_value
    } catch {}
  }

  const url = new URL(c.req.url)
  const redirectUri = `${url.protocol}//${url.host}/api/google-business/callback`

  if (!clientId || !clientSecret) {
    return c.html(`<!DOCTYPE html><html><head><title>Google Business Profile</title><script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center"><div class="bg-white rounded-2xl shadow-xl p-8 max-w-md text-center">
<div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-exclamation-triangle text-red-500 text-2xl"></i></div>
<h2 class="text-xl font-bold text-gray-800 mb-2">Configuration Error</h2>
<p class="text-gray-600 mb-4">Google OAuth credentials are not configured. Ask your admin to set up GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.</p>
<button onclick="window.close()" class="bg-sky-600 text-white px-6 py-2 rounded-lg font-semibold">Close</button>
</div></body></html>`)
  }

  // Exchange code for tokens
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri
    }).toString()
  })

  const tokenData: any = await tokenResp.json()
  if (!tokenResp.ok || !tokenData.refresh_token) {
    return c.html(`<!DOCTYPE html><html><head><title>Google Business Profile</title><script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center"><div class="bg-white rounded-2xl shadow-xl p-8 max-w-md text-center">
<div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-exclamation-triangle text-red-500 text-2xl"></i></div>
<h2 class="text-xl font-bold text-gray-800 mb-2">Token Exchange Failed</h2>
<p class="text-gray-600 mb-4">${tokenData.error_description || 'Could not obtain refresh token'}</p>
<button onclick="window.close()" class="bg-sky-600 text-white px-6 py-2 rounded-lg font-semibold">Close</button>
</div></body></html>`)
  }

  // Try to get business account and location info
  let accountId = ''
  let locationId = ''
  let businessName = ''
  try {
    const accountsResp = await gbpRequest(tokenData.access_token, 'GET', `${GBP_ACCOUNTS_API}/accounts`)
    const accounts = accountsResp.accounts || []
    if (accounts.length > 0) {
      accountId = accounts[0].name || '' // format: accounts/123456
      // Try to get first location
      const locResp = await gbpRequest(tokenData.access_token, 'GET', `${GBP_API_BASE}/${accountId}/locations`)
      const locations = locResp.locations || []
      if (locations.length > 0) {
        locationId = locations[0].name || ''
        businessName = locations[0].title || locations[0].storefrontAddress?.locality || ''
      }
    }
  } catch {}

  // Store tokens on the customer record
  await c.env.DB.prepare(`
    UPDATE customers SET gbp_refresh_token = ?, gbp_account_id = ?, gbp_location_id = ?, gbp_business_name = ?, gbp_connected_at = datetime('now') WHERE id = ?
  `).bind(tokenData.refresh_token, accountId, locationId, businessName, customerId).run()

  return c.html(`<!DOCTYPE html>
<html><head><title>Google Business Profile Connected</title>
<script src="https://cdn.tailwindcss.com"></script>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center">
<div class="bg-white rounded-2xl shadow-xl p-8 max-w-md text-center">
  <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
    <i class="fas fa-check text-green-600 text-2xl"></i>
  </div>
  <h2 class="text-xl font-bold text-gray-800 mb-2">Business Profile Connected!</h2>
  ${businessName ? `<p class="text-sky-600 font-semibold mb-4">${businessName}</p>` : '<p class="text-gray-500 mb-4">Account linked successfully.</p>'}
  <p class="text-sm text-gray-500 mb-6">You can now manage reviews and posts. This window will close automatically.</p>
  <button onclick="window.close()" class="bg-sky-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-sky-700">Close Window</button>
</div>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'gbp_connected', business_name: '${businessName}' }, '*');
    setTimeout(function() { window.close(); }, 3000);
  } else {
    setTimeout(function() { window.location.href = '/customer/google-business?connected=true'; }, 2000);
  }
</script>
</body></html>`)
})

// ============================================================
// POST /disconnect — Clear tokens
// ============================================================
googleBusinessRoutes.post('/disconnect', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)

  await c.env.DB.prepare(
    "UPDATE customers SET gbp_refresh_token = NULL, gbp_account_id = NULL, gbp_location_id = NULL, gbp_business_name = NULL, gbp_connected_at = NULL WHERE id = ?"
  ).bind(ownerId).run()

  return c.json({ success: true })
})

// ============================================================
// GET /reviews — List cached reviews
// ============================================================
googleBusinessRoutes.get('/reviews', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM gbp_reviews WHERE customer_id = ? ORDER BY review_date DESC'
    ).bind(ownerId).all()

    return c.json({ reviews: results || [] })
  } catch {
    return c.json({ reviews: [] })
  }
})

// ============================================================
// POST /reviews/:id/reply — Reply to a review
// ============================================================
googleBusinessRoutes.post('/reviews/:id/reply', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)

  const reviewId = c.req.param('id')
  const { reply } = await c.req.json()
  if (!reply) return c.json({ error: 'Reply text is required' }, 400)

  // Store locally
  await c.env.DB.prepare(
    "UPDATE gbp_reviews SET reply_text = ?, reply_date = datetime('now') WHERE id = ? AND customer_id = ?"
  ).bind(reply, reviewId, ownerId).run()

  // Attempt to post reply via GBP API
  const customer = await c.env.DB.prepare(
    'SELECT gbp_refresh_token, gbp_location_id FROM customers WHERE id = ?'
  ).bind(ownerId).first<any>()

  if (customer?.gbp_refresh_token && customer?.gbp_location_id) {
    try {
      const accessToken = await refreshAccessToken(c, customer.gbp_refresh_token)
      if (accessToken) {
        // Get the review's GBP resource name
        const review = await c.env.DB.prepare(
          'SELECT gbp_review_id FROM gbp_reviews WHERE id = ? AND customer_id = ?'
        ).bind(reviewId, ownerId).first<any>()

        if (review?.gbp_review_id) {
          await gbpRequest(
            accessToken,
            'PUT',
            `https://mybusiness.googleapis.com/v4/${review.gbp_review_id}/reply`,
            { comment: reply }
          )
        }
      }
    } catch {}
  }

  return c.json({ success: true })
})

// ============================================================
// POST /posts — Create a GBP post
// ============================================================
googleBusinessRoutes.post('/posts', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)

  const { content, call_to_action_type, call_to_action_url } = await c.req.json()
  if (!content) return c.json({ error: 'Post content is required' }, 400)

  // Ensure table exists
  try {
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS gbp_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        gbp_post_id TEXT,
        content TEXT NOT NULL,
        call_to_action_type TEXT,
        call_to_action_url TEXT,
        status TEXT DEFAULT 'DRAFT',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `).run()
  } catch {}

  // Store locally
  const result = await c.env.DB.prepare(
    "INSERT INTO gbp_posts (customer_id, content, call_to_action_type, call_to_action_url, status) VALUES (?, ?, ?, ?, 'PUBLISHED')"
  ).bind(ownerId, content, call_to_action_type || null, call_to_action_url || null).run()

  // Attempt to post via GBP API
  const customer = await c.env.DB.prepare(
    'SELECT gbp_refresh_token, gbp_location_id FROM customers WHERE id = ?'
  ).bind(ownerId).first<any>()

  let gbpPostId = null
  if (customer?.gbp_refresh_token && customer?.gbp_location_id) {
    try {
      const accessToken = await refreshAccessToken(c, customer.gbp_refresh_token)
      if (accessToken) {
        const postBody: any = {
          languageCode: 'en',
          summary: content,
          topicType: 'STANDARD',
        }
        if (call_to_action_type && call_to_action_url) {
          postBody.callToAction = {
            actionType: call_to_action_type,
            url: call_to_action_url
          }
        }

        const postResp = await gbpRequest(
          accessToken,
          'POST',
          `https://mybusiness.googleapis.com/v4/${customer.gbp_location_id}/localPosts`,
          postBody
        )
        gbpPostId = postResp.name || null

        if (gbpPostId && result.meta?.last_row_id) {
          await c.env.DB.prepare(
            'UPDATE gbp_posts SET gbp_post_id = ? WHERE id = ?'
          ).bind(gbpPostId, result.meta.last_row_id).run()
        }
      }
    } catch {}
  }

  return c.json({ success: true, post_id: result.meta?.last_row_id || null, gbp_post_id: gbpPostId })
})

// ============================================================
// GET /posts — List cached posts
// ============================================================
googleBusinessRoutes.get('/posts', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM gbp_posts WHERE customer_id = ? ORDER BY created_at DESC'
    ).bind(ownerId).all()

    return c.json({ posts: results || [] })
  } catch {
    return c.json({ posts: [] })
  }
})

// ============================================================
// POST /sync — Sync reviews from GBP API
// ============================================================
googleBusinessRoutes.post('/sync', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)

  const customer = await c.env.DB.prepare(
    'SELECT gbp_refresh_token, gbp_account_id, gbp_location_id FROM customers WHERE id = ?'
  ).bind(ownerId).first<any>()

  if (!customer?.gbp_refresh_token) {
    return c.json({ error: 'Google Business Profile not connected. Please connect your account first.' }, 400)
  }

  if (!customer.gbp_location_id) {
    return c.json({ message: 'No business location found. Your account is connected but no locations were detected.', synced: 0 })
  }

  const accessToken = await refreshAccessToken(c, customer.gbp_refresh_token)
  if (!accessToken) {
    return c.json({ error: 'Failed to refresh access token. Please reconnect your account.' }, 400)
  }

  try {
    // Ensure table exists
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS gbp_reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        gbp_review_id TEXT,
        reviewer_name TEXT,
        star_rating INTEGER DEFAULT 0,
        comment TEXT,
        review_date TEXT,
        reply_text TEXT,
        reply_date TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(customer_id, gbp_review_id)
      )
    `).run()

    // Fetch reviews
    const reviewsData = await gbpRequest(
      accessToken,
      'GET',
      `https://mybusiness.googleapis.com/v4/${customer.gbp_location_id}/reviews`
    )

    let synced = 0
    const reviews = reviewsData.reviews || []
    for (const review of reviews) {
      const starMap: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 }
      const stars = starMap[review.starRating] || 0

      await c.env.DB.prepare(`
        INSERT OR REPLACE INTO gbp_reviews
          (customer_id, gbp_review_id, reviewer_name, star_rating, comment, review_date, reply_text, reply_date, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(
        ownerId,
        review.name || '',
        review.reviewer?.displayName || 'Anonymous',
        stars,
        review.comment || '',
        review.createTime || '',
        review.reviewReply?.comment || null,
        review.reviewReply?.updateTime || null
      ).run()
      synced++
    }

    // Also update business info (rating, review count)
    try {
      const locData = await gbpRequest(
        accessToken,
        'GET',
        `${GBP_API_BASE}/${customer.gbp_location_id}?readMask=title,storefrontAddress`
      )
      if (locData.title) {
        await c.env.DB.prepare(
          "UPDATE customers SET gbp_business_name = ? WHERE id = ?"
        ).bind(locData.title, ownerId).run()
      }
    } catch {}

    return c.json({ synced, message: `Synced ${synced} review(s) from Google Business Profile.` })
  } catch (e: any) {
    return c.json({ error: 'Failed to sync reviews: ' + (e.message || 'Unknown error') }, 500)
  }
})

// ============================================================
// GET /insights — Return cached business insights
// ============================================================
googleBusinessRoutes.get('/insights', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)

  const customer = await c.env.DB.prepare(
    'SELECT gbp_business_name, gbp_location_id FROM customers WHERE id = ?'
  ).bind(ownerId).first<any>()

  // Get review stats
  let totalReviews = 0
  let avgRating = 0
  try {
    const stats = await c.env.DB.prepare(
      'SELECT COUNT(*) as total, AVG(star_rating) as avg_rating FROM gbp_reviews WHERE customer_id = ? AND star_rating > 0'
    ).bind(ownerId).first<any>()
    totalReviews = stats?.total || 0
    avgRating = stats?.avg_rating ? Math.round(stats.avg_rating * 10) / 10 : 0
  } catch {}

  // Get post count
  let totalPosts = 0
  try {
    const postStats = await c.env.DB.prepare(
      'SELECT COUNT(*) as total FROM gbp_posts WHERE customer_id = ?'
    ).bind(ownerId).first<any>()
    totalPosts = postStats?.total || 0
  } catch {}

  return c.json({
    business_name: customer?.gbp_business_name || null,
    location_id: customer?.gbp_location_id || null,
    total_reviews: totalReviews,
    average_rating: avgRating,
    total_posts: totalPosts
  })
})

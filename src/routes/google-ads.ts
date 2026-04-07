// ============================================================
// Roof Manager — Google Ads Integration
// Customer-facing — connect Google Ads account, sync campaigns
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { resolveTeamOwner } from './team'

export const googleAdsRoutes = new Hono<{ Bindings: Bindings }>()

const GOOGLE_ADS_API_BASE = 'https://googleads.googleapis.com/v17'

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

// ── Helper: call Google Ads API ──
async function googleAdsRequest(accessToken: string, developerToken: string, customerId: string, method: string, path: string, body?: any): Promise<any> {
  const url = `${GOOGLE_ADS_API_BASE}/customers/${customerId}${path}`
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'developer-token': developerToken,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

// ============================================================
// GET /status — Check if Google Ads is connected
// ============================================================
googleAdsRoutes.get('/status', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)

  const customer = await c.env.DB.prepare(
    'SELECT google_ads_refresh_token, google_ads_customer_id, google_ads_connected_at FROM customers WHERE id = ?'
  ).bind(ownerId).first<any>()

  return c.json({
    connected: !!customer?.google_ads_refresh_token,
    customer_id: customer?.google_ads_customer_id || null,
    connected_at: customer?.google_ads_connected_at || null
  })
})

// ============================================================
// GET /connect — Start OAuth flow for Google Ads
// ============================================================
googleAdsRoutes.get('/connect', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)

  const clientId = (c.env as any).GMAIL_CLIENT_ID
  if (!clientId) {
    return c.json({ error: 'Google OAuth is not configured. Contact support.' }, 400)
  }

  const url = new URL(c.req.url)
  const redirectUri = `${url.protocol}//${url.host}/api/google-ads/callback`

  const state = `${ownerId}:${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`

  // Store state for validation
  try {
    await c.env.DB.prepare(
      "INSERT OR REPLACE INTO settings (master_company_id, setting_key, setting_value) VALUES (?, ?, ?)"
    ).bind(ownerId, 'google_ads_oauth_state', state).run()
  } catch {}

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/adwords')
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')
  authUrl.searchParams.set('state', state)

  return c.json({ auth_url: authUrl.toString() })
})

// ============================================================
// GET /callback — OAuth callback
// ============================================================
googleAdsRoutes.get('/callback', async (c) => {
  const code = c.req.query('code')
  const error = c.req.query('error')
  const state = c.req.query('state') || ''

  if (error || !code) {
    return c.html(`<!DOCTYPE html><html><head><title>Google Ads Connection</title><link rel="stylesheet" href="/static/tailwind.css"></head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center"><div class="bg-white rounded-2xl shadow-xl p-8 max-w-md text-center">
<div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-times text-red-500 text-2xl"></i></div>
<h2 class="text-xl font-bold text-gray-800 mb-2">Connection Failed</h2>
<p class="text-gray-600 mb-4">${error || 'No authorization code received'}</p>
<button onclick="window.close()" class="bg-sky-600 text-white px-6 py-2 rounded-lg font-semibold">Close Window</button>
</div></body></html>`)
  }

  const customerId = parseInt(state.split(':')[0])
  if (!customerId) {
    return c.html(`<!DOCTYPE html><html><head><title>Google Ads Connection</title></head><body><p>Invalid state. Please try again.</p></body></html>`)
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
  const redirectUri = `${url.protocol}//${url.host}/api/google-ads/callback`

  if (!clientId || !clientSecret) {
    return c.html(`<!DOCTYPE html><html><head><title>Google Ads Connection</title><link rel="stylesheet" href="/static/tailwind.css"></head>
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
    return c.html(`<!DOCTYPE html><html><head><title>Google Ads Connection</title><link rel="stylesheet" href="/static/tailwind.css"></head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center"><div class="bg-white rounded-2xl shadow-xl p-8 max-w-md text-center">
<div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-exclamation-triangle text-red-500 text-2xl"></i></div>
<h2 class="text-xl font-bold text-gray-800 mb-2">Token Exchange Failed</h2>
<p class="text-gray-600 mb-4">${tokenData.error_description || 'Could not obtain refresh token'}</p>
<button onclick="window.close()" class="bg-sky-600 text-white px-6 py-2 rounded-lg font-semibold">Close</button>
</div></body></html>`)
  }

  // Try to get the Google Ads customer ID via the accessible customers endpoint
  let adsCustomerId = ''
  try {
    const listResp = await fetch(`${GOOGLE_ADS_API_BASE}/customers:listAccessibleCustomers`, {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'developer-token': (c.env as any).GOOGLE_ADS_DEVELOPER_TOKEN || '',
      }
    })
    const listData: any = await listResp.json()
    if (listData.resourceNames?.length > 0) {
      // Extract first customer ID (format: customers/1234567890)
      adsCustomerId = listData.resourceNames[0].replace('customers/', '')
    }
  } catch {}

  // Store tokens on the customer record
  await c.env.DB.prepare(`
    UPDATE customers SET google_ads_refresh_token = ?, google_ads_customer_id = ?, google_ads_connected_at = datetime('now') WHERE id = ?
  `).bind(tokenData.refresh_token, adsCustomerId, customerId).run()

  return c.html(`<!DOCTYPE html>
<html><head><title>Google Ads Connected</title>
<link rel="stylesheet" href="/static/tailwind.css">
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center">
<div class="bg-white rounded-2xl shadow-xl p-8 max-w-md text-center">
  <div class="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
    <i class="fas fa-check text-green-600 text-2xl"></i>
  </div>
  <h2 class="text-xl font-bold text-gray-800 mb-2">Google Ads Connected!</h2>
  <p class="text-gray-600 mb-1">Successfully connected your Google Ads account.</p>
  ${adsCustomerId ? `<p class="text-sky-600 font-semibold mb-4">Customer ID: ${adsCustomerId}</p>` : '<p class="text-gray-500 mb-4">Account linked successfully.</p>'}
  <p class="text-sm text-gray-500 mb-6">You can now view and manage your campaigns. This window will close automatically.</p>
  <button onclick="window.close()" class="bg-sky-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-sky-700">Close Window</button>
</div>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'google_ads_connected', customer_id: '${adsCustomerId}' }, '*');
    setTimeout(function() { window.close(); }, 3000);
  } else {
    setTimeout(function() { window.location.href = '/customer/google-ads?connected=true'; }, 2000);
  }
</script>
</body></html>`)
})

// ============================================================
// POST /disconnect — Clear tokens
// ============================================================
googleAdsRoutes.post('/disconnect', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)

  await c.env.DB.prepare(
    "UPDATE customers SET google_ads_refresh_token = NULL, google_ads_customer_id = NULL, google_ads_connected_at = NULL WHERE id = ?"
  ).bind(ownerId).run()

  return c.json({ success: true })
})

// ============================================================
// GET /campaigns — List cached campaigns
// ============================================================
googleAdsRoutes.get('/campaigns', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM google_ads_campaigns WHERE customer_id = ? ORDER BY updated_at DESC'
    ).bind(ownerId).all()

    return c.json({ campaigns: results || [] })
  } catch {
    // Table may not exist yet
    return c.json({ campaigns: [] })
  }
})

// ============================================================
// POST /sync — Sync campaigns from Google Ads API
// ============================================================
googleAdsRoutes.post('/sync', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)

  const customer = await c.env.DB.prepare(
    'SELECT google_ads_refresh_token, google_ads_customer_id FROM customers WHERE id = ?'
  ).bind(ownerId).first<any>()

  if (!customer?.google_ads_refresh_token) {
    return c.json({ error: 'Google Ads not connected. Please connect your account first.' }, 400)
  }

  const developerToken = (c.env as any).GOOGLE_ADS_DEVELOPER_TOKEN || ''
  if (!developerToken) {
    return c.json({
      message: 'Google Ads API developer token is not configured yet. Your account is connected and campaigns will sync once the developer token is set up. Contact support if you need assistance.',
      synced: 0
    })
  }

  const accessToken = await refreshAccessToken(c, customer.google_ads_refresh_token)
  if (!accessToken) {
    return c.json({ error: 'Failed to refresh access token. Please reconnect your Google Ads account.' }, 400)
  }

  try {
    // Use Google Ads Query Language to fetch campaigns
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign_budget.amount_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.conversions,
        metrics.cost_micros,
        metrics.ctr
      FROM campaign
      WHERE campaign.status != 'REMOVED'
      ORDER BY campaign.name
    `

    const data = await googleAdsRequest(
      accessToken,
      developerToken,
      customer.google_ads_customer_id,
      'POST',
      '/googleAds:searchStream',
      { query }
    )

    // Ensure table exists
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS google_ads_campaigns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        campaign_id TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT DEFAULT 'ENABLED',
        channel_type TEXT,
        budget_micros INTEGER DEFAULT 0,
        impressions INTEGER DEFAULT 0,
        clicks INTEGER DEFAULT 0,
        conversions REAL DEFAULT 0,
        cost_micros INTEGER DEFAULT 0,
        ctr REAL DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(customer_id, campaign_id)
      )
    `).run()

    let synced = 0
    const rows = data?.[0]?.results || data?.results || []
    for (const row of rows) {
      const camp = row.campaign || {}
      const metrics = row.metrics || {}
      const budget = row.campaignBudget || {}

      await c.env.DB.prepare(`
        INSERT OR REPLACE INTO google_ads_campaigns
          (customer_id, campaign_id, name, status, channel_type, budget_micros, impressions, clicks, conversions, cost_micros, ctr, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(
        ownerId,
        String(camp.id || ''),
        camp.name || 'Unnamed Campaign',
        camp.status || 'UNKNOWN',
        camp.advertisingChannelType || '',
        budget.amountMicros || 0,
        metrics.impressions || 0,
        metrics.clicks || 0,
        metrics.conversions || 0,
        metrics.costMicros || 0,
        metrics.ctr || 0
      ).run()
      synced++
    }

    return c.json({ synced, message: `Synced ${synced} campaign(s) from Google Ads.` })
  } catch (e: any) {
    return c.json({ error: 'Failed to sync campaigns: ' + (e.message || 'Unknown error') }, 500)
  }
})

// ============================================================
// POST /campaigns/:id/pause — Pause a campaign
// ============================================================
googleAdsRoutes.post('/campaigns/:id/pause', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)

  const campaignId = c.req.param('id')

  // Update local DB
  await c.env.DB.prepare(
    "UPDATE google_ads_campaigns SET status = 'PAUSED', updated_at = datetime('now') WHERE customer_id = ? AND campaign_id = ?"
  ).bind(ownerId, campaignId).run()

  // Attempt to update via Google Ads API
  const customer = await c.env.DB.prepare(
    'SELECT google_ads_refresh_token, google_ads_customer_id FROM customers WHERE id = ?'
  ).bind(ownerId).first<any>()

  const developerToken = (c.env as any).GOOGLE_ADS_DEVELOPER_TOKEN || ''
  if (customer?.google_ads_refresh_token && developerToken) {
    try {
      const accessToken = await refreshAccessToken(c, customer.google_ads_refresh_token)
      if (accessToken) {
        await googleAdsRequest(
          accessToken,
          developerToken,
          customer.google_ads_customer_id,
          'POST',
          '/campaigns:mutate',
          {
            operations: [{
              update: {
                resourceName: `customers/${customer.google_ads_customer_id}/campaigns/${campaignId}`,
                status: 'PAUSED'
              },
              updateMask: 'status'
            }]
          }
        )
      }
    } catch {}
  }

  return c.json({ success: true, status: 'PAUSED' })
})

// ============================================================
// POST /campaigns/:id/enable — Enable a campaign
// ============================================================
googleAdsRoutes.post('/campaigns/:id/enable', async (c) => {
  const ownerId = await getOwnerId(c)
  if (!ownerId) return c.json({ error: 'Unauthorized' }, 401)

  const campaignId = c.req.param('id')

  // Update local DB
  await c.env.DB.prepare(
    "UPDATE google_ads_campaigns SET status = 'ENABLED', updated_at = datetime('now') WHERE customer_id = ? AND campaign_id = ?"
  ).bind(ownerId, campaignId).run()

  // Attempt to update via Google Ads API
  const customer = await c.env.DB.prepare(
    'SELECT google_ads_refresh_token, google_ads_customer_id FROM customers WHERE id = ?'
  ).bind(ownerId).first<any>()

  const developerToken = (c.env as any).GOOGLE_ADS_DEVELOPER_TOKEN || ''
  if (customer?.google_ads_refresh_token && developerToken) {
    try {
      const accessToken = await refreshAccessToken(c, customer.google_ads_refresh_token)
      if (accessToken) {
        await googleAdsRequest(
          accessToken,
          developerToken,
          customer.google_ads_customer_id,
          'POST',
          '/campaigns:mutate',
          {
            operations: [{
              update: {
                resourceName: `customers/${customer.google_ads_customer_id}/campaigns/${campaignId}`,
                status: 'ENABLED'
              },
              updateMask: 'status'
            }]
          }
        )
      }
    } catch {}
  }

  return c.json({ success: true, status: 'ENABLED' })
})

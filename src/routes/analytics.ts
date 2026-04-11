// ============================================================
// Site Analytics — Track every click, pageview, session
// Server-side: lightweight beacon endpoint + admin query APIs
// + Google Analytics 4 Data API + Measurement Protocol
// ============================================================

import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
  GCP_SERVICE_ACCOUNT_KEY: string
  GA4_MEASUREMENT_ID: string
  GA4_API_SECRET: string
  GA4_PROPERTY_ID: string
  [key: string]: any
}

export const analyticsRoutes = new Hono<{ Bindings: Bindings }>()

// ============================================================
// PUBLIC: Beacon endpoint — receives tracking events from client JS
// Ultra-lightweight: no auth required, returns 204 No Content
// ============================================================
analyticsRoutes.post('/track', async (c) => {
  try {
    const body = await c.req.json()
    const events = Array.isArray(body) ? body : [body]
    
    // Extract Cloudflare geo data from the request
    // cf object is primary source; CF-IPCountry / CF-IPCity headers are fallbacks
    const cf = (c.req.raw as any).cf || {}
    const country = cf.country || c.req.header('CF-IPCountry') || c.req.header('X-Country-Code') || null
    const city    = cf.city    || c.req.header('CF-IPCity')    || null
    const region  = cf.region  || c.req.header('CF-IPRegion')  || null
    const timezone = cf.timezone || null
    const asn     = cf.asn ? String(cf.asn) : null
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown'
    const ua = c.req.header('User-Agent') || ''
    
    // Filter bots server-side
    if (/bot|crawl|spider|slurp|mediapartners|lighthouse|pagespeed|GTmetrix|headlesschrome|phantomjs|selenium/i.test(ua)) {
      return c.body(null, 204)
    }

    // Parse browser/OS from UA
    const { browser, browserVersion, os, deviceType } = parseUserAgent(ua)

    const stmt = c.env.DB.prepare(`
      INSERT INTO site_analytics (
        event_type, session_id, visitor_id, user_id,
        page_url, page_title, referrer,
        click_element, click_text, click_x, click_y,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content,
        ip_address, country, city, region, timezone, asn,
        user_agent, browser, browser_version, os, device_type,
        screen_width, screen_height, language,
        scroll_depth, time_on_page
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const batch = events.slice(0, 20).map(e => stmt.bind(
      e.event_type || 'pageview',
      e.session_id || null,
      e.visitor_id || null,
      e.user_id || null,
      e.page_url || '/',
      e.page_title || null,
      e.referrer || null,
      e.click_element || null,
      e.click_text ? String(e.click_text).substring(0, 200) : null,
      e.click_x || null,
      e.click_y || null,
      e.utm_source || null,
      e.utm_medium || null,
      e.utm_campaign || null,
      e.utm_term || null,
      e.utm_content || null,
      ip,
      country,
      city,
      region,
      timezone,
      asn,
      ua.substring(0, 500),
      browser,
      browserVersion,
      os,
      deviceType,
      e.screen_width || null,
      e.screen_height || null,
      e.language || null,
      e.scroll_depth || null,
      e.time_on_page || null
    ))

    await c.env.DB.batch(batch)
    return c.body(null, 204)
  } catch (err: any) {
    console.error('[Analytics] Track error:', err.message)
    return c.body(null, 204)  // Always return 204 — never break the client
  }
})

// ============================================================
// ADMIN: Dashboard overview — KPIs and recent activity
// ============================================================
analyticsRoutes.get('/dashboard', async (c) => {
  const db = c.env.DB
  const period = c.req.query('period') || '7d'

  const daysBack = period === '30d' ? 30 : period === '90d' ? 90 : period === '24h' ? 1 : 7
  const since = new Date(Date.now() - daysBack * 86400000).toISOString()
  // Prior period window — same length, immediately before current period
  const prevSince = new Date(Date.now() - daysBack * 2 * 86400000).toISOString()

  const [
    overview, prevOverview,
    topPages,
    topCountries, topReferrers,
    recentVisitors, hourlyTraffic, deviceBreakdown,
    utmSources, utmMediums, utmCampaigns,
    signupsInPeriod
  ] = await Promise.all([
    // KPI overview — current period (exclude admin/internal pages)
    db.prepare(`
      SELECT
        COUNT(*) as total_events,
        COUNT(CASE WHEN event_type = 'pageview' THEN 1 END) as pageviews,
        COUNT(CASE WHEN event_type = 'click' THEN 1 END) as clicks,
        COUNT(DISTINCT visitor_id) as unique_visitors,
        COUNT(DISTINCT session_id) as sessions,
        COUNT(DISTINCT ip_address) as unique_ips,
        ROUND(AVG(CASE WHEN time_on_page > 0 THEN time_on_page END), 1) as avg_time_on_page,
        ROUND(AVG(CASE WHEN scroll_depth > 0 THEN scroll_depth END), 1) as avg_scroll_depth
      FROM site_analytics
      WHERE created_at >= ?
        AND page_url NOT LIKE '/super-admin%'
        AND page_url NOT LIKE '/admin%'
        AND page_url NOT LIKE '/login%'
        AND page_url NOT LIKE '/api/%'
    `).bind(since).first(),

    // KPI overview — prior period (for trend comparison)
    db.prepare(`
      SELECT
        COUNT(CASE WHEN event_type = 'pageview' THEN 1 END) as pageviews,
        COUNT(CASE WHEN event_type = 'click' THEN 1 END) as clicks,
        COUNT(DISTINCT visitor_id) as unique_visitors,
        COUNT(DISTINCT session_id) as sessions,
        ROUND(AVG(CASE WHEN time_on_page > 0 THEN time_on_page END), 1) as avg_time_on_page
      FROM site_analytics
      WHERE created_at >= ? AND created_at < ?
        AND page_url NOT LIKE '/super-admin%'
        AND page_url NOT LIKE '/admin%'
        AND page_url NOT LIKE '/login%'
        AND page_url NOT LIKE '/api/%'
    `).bind(prevSince, since).first(),

    // Top pages with bounce rate
    // bounce_rate = % of sessions that only visited this one page
    db.prepare(`
      SELECT
        p.page_url,
        p.views,
        p.unique_visitors,
        p.avg_time,
        ROUND(
          100.0 * SUM(CASE WHEN sess.page_count = 1 THEN 1 ELSE 0 END) / COUNT(*),
          0
        ) as bounce_rate
      FROM (
        SELECT page_url,
               COUNT(*) as views,
               COUNT(DISTINCT visitor_id) as unique_visitors,
               ROUND(AVG(CASE WHEN time_on_page > 0 THEN time_on_page END), 1) as avg_time,
               session_id
        FROM site_analytics
        WHERE event_type = 'pageview' AND created_at >= ?
          AND page_url NOT LIKE '/super-admin%'
          AND page_url NOT LIKE '/admin%'
          AND page_url NOT LIKE '/login%'
          AND page_url NOT LIKE '/api/%'
        GROUP BY page_url, session_id
      ) p
      JOIN (
        SELECT session_id, COUNT(DISTINCT page_url) as page_count
        FROM site_analytics
        WHERE event_type = 'pageview' AND created_at >= ?
          AND page_url NOT LIKE '/super-admin%'
          AND page_url NOT LIKE '/admin%'
          AND page_url NOT LIKE '/login%'
          AND page_url NOT LIKE '/api/%'
        GROUP BY session_id
      ) sess ON sess.session_id = p.session_id
      GROUP BY p.page_url
      ORDER BY views DESC LIMIT 20
    `).bind(since, since).all(),

    // Top countries — pageviews only, exclude admin pages
    db.prepare(`
      SELECT country,
             COUNT(*) as hits,
             COUNT(DISTINCT visitor_id) as visitors,
             COUNT(DISTINCT session_id) as sessions
      FROM site_analytics
      WHERE country IS NOT NULL AND event_type = 'pageview' AND created_at >= ?
        AND page_url NOT LIKE '/super-admin%'
        AND page_url NOT LIKE '/admin%'
        AND page_url NOT LIKE '/login%'
        AND page_url NOT LIKE '/api/%'
      GROUP BY country ORDER BY visitors DESC LIMIT 15
    `).bind(since).all(),

    // Top referrers
    db.prepare(`
      SELECT referrer, COUNT(*) as hits, COUNT(DISTINCT visitor_id) as visitors
      FROM site_analytics
      WHERE referrer IS NOT NULL AND referrer != '' AND event_type = 'pageview' AND created_at >= ?
        AND page_url NOT LIKE '/super-admin%'
        AND page_url NOT LIKE '/admin%'
        AND page_url NOT LIKE '/login%'
        AND page_url NOT LIKE '/api/%'
      GROUP BY referrer ORDER BY hits DESC LIMIT 15
    `).bind(since).all(),

    // Recent individual visitors (last 50 events)
    db.prepare(`
      SELECT id, event_type, session_id, visitor_id, user_id,
             page_url, page_title, referrer,
             click_element, click_text,
             utm_source, utm_campaign,
             ip_address, country, city, region,
             browser, os, device_type,
             screen_width, screen_height, language,
             scroll_depth, time_on_page,
             created_at
      FROM site_analytics
      ORDER BY created_at DESC LIMIT 50
    `).all(),

    // Hourly traffic (last 48 hours)
    db.prepare(`
      SELECT strftime('%Y-%m-%d %H:00', created_at) as hour,
             COUNT(*) as events,
             COUNT(CASE WHEN event_type = 'pageview' THEN 1 END) as pageviews,
             COUNT(DISTINCT visitor_id) as visitors
      FROM site_analytics
      WHERE created_at >= datetime('now', '-48 hours')
        AND page_url NOT LIKE '/super-admin%'
        AND page_url NOT LIKE '/admin%'
        AND page_url NOT LIKE '/login%'
        AND page_url NOT LIKE '/api/%'
      GROUP BY hour ORDER BY hour
    `).all(),

    // Device breakdown
    db.prepare(`
      SELECT device_type, COUNT(*) as count, COUNT(DISTINCT visitor_id) as visitors
      FROM site_analytics
      WHERE device_type IS NOT NULL AND created_at >= ?
        AND page_url NOT LIKE '/super-admin%'
        AND page_url NOT LIKE '/admin%'
        AND page_url NOT LIKE '/login%'
        AND page_url NOT LIKE '/api/%'
      GROUP BY device_type ORDER BY count DESC
    `).bind(since).all(),

    // UTM Sources
    db.prepare(`
      SELECT utm_source as value, COUNT(*) as hits, COUNT(DISTINCT visitor_id) as visitors
      FROM site_analytics
      WHERE utm_source IS NOT NULL AND utm_source != '' AND created_at >= ?
      GROUP BY utm_source ORDER BY hits DESC LIMIT 10
    `).bind(since).all(),

    // UTM Mediums
    db.prepare(`
      SELECT utm_medium as value, COUNT(*) as hits, COUNT(DISTINCT visitor_id) as visitors
      FROM site_analytics
      WHERE utm_medium IS NOT NULL AND utm_medium != '' AND created_at >= ?
      GROUP BY utm_medium ORDER BY hits DESC LIMIT 10
    `).bind(since).all(),

    // UTM Campaigns
    db.prepare(`
      SELECT utm_campaign as value, COUNT(*) as hits, COUNT(DISTINCT visitor_id) as visitors
      FROM site_analytics
      WHERE utm_campaign IS NOT NULL AND utm_campaign != '' AND created_at >= ?
      GROUP BY utm_campaign ORDER BY hits DESC LIMIT 10
    `).bind(since).all(),

    // New signups in current period (for conversion rate)
    db.prepare(`
      SELECT COUNT(*) as count FROM customers WHERE created_at >= ?
    `).bind(since).first()
  ])

  return c.json({
    period,
    overview,
    prev_overview: prevOverview,
    signups_in_period: (signupsInPeriod as any)?.count ?? 0,
    top_pages: topPages.results,
    top_countries: topCountries.results,
    top_referrers: topReferrers.results,
    recent_visitors: recentVisitors.results,
    hourly_traffic: hourlyTraffic.results,
    device_breakdown: deviceBreakdown.results,
    utm_sources: utmSources.results,
    utm_mediums: utmMediums.results,
    utm_campaigns: utmCampaigns.results
  })
})

// ============================================================
// ADMIN: Live feed — real-time event stream
// ============================================================
analyticsRoutes.get('/live', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500)
  const result = await c.env.DB.prepare(`
    SELECT id, event_type, session_id, visitor_id, user_id,
           page_url, page_title, referrer,
           click_element, click_text,
           utm_source, utm_campaign,
           ip_address, country, city, region, timezone,
           browser, os, device_type,
           screen_width, screen_height, language,
           scroll_depth, time_on_page,
           created_at
    FROM site_analytics
    ORDER BY created_at DESC LIMIT ?
  `).bind(limit).all()

  return c.json({ events: result.results })
})

// ============================================================
// ADMIN: Visitor detail — everything we know about a visitor_id
// ============================================================
analyticsRoutes.get('/visitor/:visitorId', async (c) => {
  const vid = c.req.param('visitorId')
  const [events, summary] = await Promise.all([
    c.env.DB.prepare(`
      SELECT * FROM site_analytics WHERE visitor_id = ? ORDER BY created_at DESC LIMIT 200
    `).bind(vid).all(),
    c.env.DB.prepare(`
      SELECT 
        COUNT(*) as total_events,
        COUNT(DISTINCT session_id) as sessions,
        COUNT(CASE WHEN event_type = 'pageview' THEN 1 END) as pageviews,
        COUNT(CASE WHEN event_type = 'click' THEN 1 END) as clicks,
        MIN(created_at) as first_seen,
        MAX(created_at) as last_seen,
        ip_address, country, city, browser, os, device_type
      FROM site_analytics WHERE visitor_id = ?
    `).bind(vid).first()
  ])
  return c.json({ visitor_id: vid, summary, events: events.results })
})

// ============================================================
// ADMIN: Click heatmap data for a specific page
// ============================================================
analyticsRoutes.get('/clicks', async (c) => {
  const page = c.req.query('page') || '/'
  const result = await c.env.DB.prepare(`
    SELECT click_x, click_y, click_element, click_text, COUNT(*) as count
    FROM site_analytics
    WHERE event_type = 'click' AND page_url = ? AND click_x IS NOT NULL
    GROUP BY click_x, click_y, click_element
    ORDER BY count DESC LIMIT 500
  `).bind(page).all()
  return c.json({ page, clicks: result.results })
})

// ============================================================
// UA Parser — Lightweight browser/OS/device detection
// ============================================================
function parseUserAgent(ua: string): { browser: string; browserVersion: string; os: string; deviceType: string } {
  let browser = 'Unknown', browserVersion = '', os = 'Unknown', deviceType = 'desktop'

  // Browser detection
  if (ua.includes('Edg/')) { browser = 'Edge'; browserVersion = ua.match(/Edg\/([\d.]+)/)?.[1] || '' }
  else if (ua.includes('OPR/') || ua.includes('Opera')) { browser = 'Opera'; browserVersion = ua.match(/OPR\/([\d.]+)/)?.[1] || '' }
  else if (ua.includes('Chrome/') && !ua.includes('Edg/')) { browser = 'Chrome'; browserVersion = ua.match(/Chrome\/([\d.]+)/)?.[1] || '' }
  else if (ua.includes('Firefox/')) { browser = 'Firefox'; browserVersion = ua.match(/Firefox\/([\d.]+)/)?.[1] || '' }
  else if (ua.includes('Safari/') && !ua.includes('Chrome')) { browser = 'Safari'; browserVersion = ua.match(/Version\/([\d.]+)/)?.[1] || '' }
  else if (ua.includes('MSIE') || ua.includes('Trident/')) { browser = 'IE'; browserVersion = ua.match(/(?:MSIE |rv:)([\d.]+)/)?.[1] || '' }

  // OS detection
  if (ua.includes('Windows NT')) { os = 'Windows' }
  else if (ua.includes('Mac OS X') || ua.includes('Macintosh')) { os = 'macOS' }
  else if (ua.includes('iPhone') || ua.includes('iPad')) { os = 'iOS' }
  else if (ua.includes('Android')) { os = 'Android' }
  else if (ua.includes('Linux')) { os = 'Linux' }
  else if (ua.includes('CrOS')) { os = 'ChromeOS' }

  // Device type
  if (ua.includes('Mobile') || ua.includes('iPhone') || ua.includes('Android') && !ua.includes('Tablet')) { deviceType = 'mobile' }
  else if (ua.includes('iPad') || ua.includes('Tablet')) { deviceType = 'tablet' }
  // Bot detection
  else if (ua.includes('bot') || ua.includes('crawl') || ua.includes('spider') || ua.includes('Googlebot')) { deviceType = 'bot' }

  return { browser, browserVersion, os, deviceType }
}

// ============================================================
// GOOGLE ANALYTICS 4 — Data API Integration
// Queries GA4 property for report data via Google Analytics Data API v1beta
// Uses GCP Service Account for authentication (same SA as Solar API)
// ============================================================

/** Generate OAuth2 access token from service account JSON key */
async function getAccessTokenFromSA(saKeyJson: string): Promise<string | null> {
  try {
    const saKey = JSON.parse(saKeyJson)
    const now = Math.floor(Date.now() / 1000)
    const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const claim = btoa(JSON.stringify({
      iss: saKey.client_email,
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600
    }))
    
    // Import private key for signing
    const pemContents = saKey.private_key
      .replace(/-----BEGIN PRIVATE KEY-----/, '')
      .replace(/-----END PRIVATE KEY-----/, '')
      .replace(/\n/g, '')
    const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0))
    
    const key = await crypto.subtle.importKey(
      'pkcs8', binaryDer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
    )
    
    const signatureInput = new TextEncoder().encode(`${header}.${claim}`)
    const signatureBuffer = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, signatureInput)
    const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    
    const jwt = `${header}.${claim}.${signature}`
    
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    })
    
    if (!tokenRes.ok) return null
    const tokenData: any = await tokenRes.json()
    return tokenData.access_token || null
  } catch (e: any) {
    console.error('[GA4] SA token error:', e.message)
    return null
  }
}

// ============================================================
// GET /ga4/report — Query GA4 Data API for report data
// Returns pageviews, users, sessions, events, conversions
// ============================================================
analyticsRoutes.get('/ga4/report', async (c) => {
  const propertyId = c.env.GA4_PROPERTY_ID
  const saKey = c.env.GCP_SERVICE_ACCOUNT_KEY
  if (!propertyId) return c.json({ error: 'GA4_PROPERTY_ID not configured', hint: 'Set GA4_PROPERTY_ID env var (e.g. "properties/123456789")' }, 400)
  if (!saKey) return c.json({ error: 'GCP_SERVICE_ACCOUNT_KEY required for GA4 Data API' }, 400)

  const accessToken = await getAccessTokenFromSA(saKey)
  if (!accessToken) return c.json({ error: 'Failed to get access token from service account' }, 500)

  const period = c.req.query('period') || '7d'
  const daysBack = period === '30d' ? 30 : period === '90d' ? 90 : period === '24h' ? 1 : period === '365d' ? 365 : 7
  const startDate = `${daysBack}daysAgo`

  // Clean property ID — accept "properties/123" or just "123"
  const propId = propertyId.startsWith('properties/') ? propertyId : `properties/${propertyId}`

  try {
    const reportRes = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propId}:runReport`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate: 'today' }],
        dimensions: [
          { name: 'date' },
          { name: 'pagePath' }
        ],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'totalUsers' },
          { name: 'sessions' },
          { name: 'averageSessionDuration' },
          { name: 'bounceRate' },
          { name: 'engagedSessions' }
        ],
        orderBys: [{ dimension: { dimensionName: 'date' }, desc: true }],
        limit: 500
      })
    })

    if (!reportRes.ok) {
      const errText = await reportRes.text()
      console.error(`[GA4] Report API error ${reportRes.status}: ${errText.substring(0, 500)}`)
      return c.json({ error: `GA4 API error: ${reportRes.status}`, details: errText.substring(0, 300) }, reportRes.status as any)
    }

    const reportData: any = await reportRes.json()

    // Also run a summary report (no page dimension)
    const summaryRes = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propId}:runReport`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate: 'today' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'totalUsers' },
          { name: 'newUsers' },
          { name: 'sessions' },
          { name: 'averageSessionDuration' },
          { name: 'bounceRate' },
          { name: 'engagedSessions' },
          { name: 'eventCount' },
          { name: 'conversions' }
        ]
      })
    })

    let summary: any = null
    if (summaryRes.ok) summary = await summaryRes.json()

    // Top pages report
    const topPagesRes = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propId}:runReport`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate: 'today' }],
        dimensions: [{ name: 'pagePath' }],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'totalUsers' },
          { name: 'averageSessionDuration' },
          { name: 'bounceRate' }
        ],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 30
      })
    })

    let topPages: any = null
    if (topPagesRes.ok) topPages = await topPagesRes.json()

    // Traffic sources
    const sourcesRes = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propId}:runReport`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate: 'today' }],
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'conversions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 20
      })
    })

    let sources: any = null
    if (sourcesRes.ok) sources = await sourcesRes.json()

    // Country breakdown
    const geoRes = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propId}:runReport`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate: 'today' }],
        dimensions: [{ name: 'country' }, { name: 'city' }],
        metrics: [{ name: 'totalUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }],
        limit: 30
      })
    })

    let geo: any = null
    if (geoRes.ok) geo = await geoRes.json()

    // Device category
    const devicesRes = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propId}:runReport`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate: 'today' }],
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'totalUsers' }, { name: 'sessions' }, { name: 'screenPageViews' }],
        orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }]
      })
    })

    let deviceData: any = null
    if (devicesRes.ok) deviceData = await devicesRes.json()

    // User acquisition (source/medium)
    const acquisitionRes = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propId}:runReport`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [{ startDate, endDate: 'today' }],
        dimensions: [{ name: 'sessionSource' }, { name: 'sessionMedium' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagedSessions' }, { name: 'conversions' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 25
      })
    })

    let acquisition: any = null
    if (acquisitionRes.ok) acquisition = await acquisitionRes.json()

    return c.json({
      success: true,
      period,
      property_id: propId,
      summary: formatGA4Response(summary),
      top_pages: formatGA4Response(topPages),
      traffic_sources: formatGA4Response(sources),
      geography: formatGA4Response(geo),
      devices: formatGA4Response(deviceData),
      acquisition: formatGA4Response(acquisition),
      daily_breakdown: formatGA4Response(reportData)
    })

  } catch (e: any) {
    console.error('[GA4] Report error:', e.message)
    return c.json({ error: e.message }, 500)
  }
})

// ============================================================
// GET /ga4/realtime — Query GA4 Realtime API
// Returns users active right now, top pages, traffic sources
// ============================================================
analyticsRoutes.get('/ga4/realtime', async (c) => {
  const propertyId = c.env.GA4_PROPERTY_ID
  const saKey = c.env.GCP_SERVICE_ACCOUNT_KEY
  if (!propertyId || !saKey) return c.json({ error: 'GA4_PROPERTY_ID and GCP_SERVICE_ACCOUNT_KEY required' }, 400)

  const accessToken = await getAccessTokenFromSA(saKey)
  if (!accessToken) return c.json({ error: 'Failed to get access token' }, 500)

  const propId = propertyId.startsWith('properties/') ? propertyId : `properties/${propertyId}`

  try {
    // Active users right now
    const realtimeRes = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propId}:runRealtimeReport`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dimensions: [{ name: 'unifiedScreenName' }],
        metrics: [{ name: 'activeUsers' }],
        limit: 20
      })
    })

    if (!realtimeRes.ok) {
      const errText = await realtimeRes.text()
      return c.json({ error: `GA4 Realtime API error: ${realtimeRes.status}`, details: errText.substring(0, 300) }, realtimeRes.status as any)
    }

    const realtimeData: any = await realtimeRes.json()

    // Realtime by country
    const geoRealtimeRes = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propId}:runRealtimeReport`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dimensions: [{ name: 'country' }],
        metrics: [{ name: 'activeUsers' }],
        limit: 15
      })
    })

    let geoRealtime: any = null
    if (geoRealtimeRes.ok) geoRealtime = await geoRealtimeRes.json()

    // Realtime by source
    const sourceRealtimeRes = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propId}:runRealtimeReport`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'activeUsers' }],
        limit: 10
      })
    })

    let sourceRealtime: any = null
    if (sourceRealtimeRes.ok) sourceRealtime = await sourceRealtimeRes.json()

    // Realtime by device
    const deviceRealtimeRes = await fetch(`https://analyticsdata.googleapis.com/v1beta/${propId}:runRealtimeReport`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'activeUsers' }]
      })
    })

    let deviceRealtime: any = null
    if (deviceRealtimeRes.ok) deviceRealtime = await deviceRealtimeRes.json()

    return c.json({
      success: true,
      pages: formatGA4Response(realtimeData),
      geography: formatGA4Response(geoRealtime),
      sources: formatGA4Response(sourceRealtime),
      devices: formatGA4Response(deviceRealtime)
    })

  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ============================================================
// POST /ga4/event — Send server-side events via Measurement Protocol
// Track backend events: report_generated, payment_completed, email_sent
// ============================================================
analyticsRoutes.post('/ga4/event', async (c) => {
  const measurementId = c.env.GA4_MEASUREMENT_ID
  const apiSecret = c.env.GA4_API_SECRET
  if (!measurementId || !apiSecret) return c.json({ error: 'GA4_MEASUREMENT_ID and GA4_API_SECRET required' }, 400)

  const body = await c.req.json()
  const { client_id, user_id, events } = body

  if (!client_id || !events || !Array.isArray(events)) {
    return c.json({ error: 'client_id and events[] required' }, 400)
  }

  try {
    const mpRes = await fetch(
      `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`,
      {
        method: 'POST',
        body: JSON.stringify({
          client_id,
          user_id: user_id || undefined,
          events: events.slice(0, 25)  // GA4 allows max 25 events per request
        })
      }
    )

    // Measurement Protocol returns 204 on success
    return c.json({ success: mpRes.status === 204 || mpRes.status === 200, status: mpRes.status })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ============================================================
// GET /ga4/status — Check GA4 configuration status
// ============================================================
analyticsRoutes.get('/ga4/status', async (c) => {
  return c.json({
    ga4_measurement_id: c.env.GA4_MEASUREMENT_ID || null,
    ga4_api_secret: !!c.env.GA4_API_SECRET,
    ga4_property_id: c.env.GA4_PROPERTY_ID || null,
    gcp_service_account: !!c.env.GCP_SERVICE_ACCOUNT_KEY,
    frontend_tracking: !!c.env.GA4_MEASUREMENT_ID,
    server_side_events: !!(c.env.GA4_MEASUREMENT_ID && c.env.GA4_API_SECRET),
    data_api: !!(c.env.GA4_PROPERTY_ID && c.env.GCP_SERVICE_ACCOUNT_KEY),
    realtime_api: !!(c.env.GA4_PROPERTY_ID && c.env.GCP_SERVICE_ACCOUNT_KEY)
  })
})

// ============================================================
// HELPER: Format GA4 API response into clean arrays
// ============================================================
function formatGA4Response(data: any): { headers: string[]; rows: any[][]; totals: any } | null {
  if (!data || !data.rows) return null

  const dimensionHeaders = (data.dimensionHeaders || []).map((h: any) => h.name)
  const metricHeaders = (data.metricHeaders || []).map((h: any) => h.name)
  const headers = [...dimensionHeaders, ...metricHeaders]

  const rows = (data.rows || []).map((row: any) => {
    const dims = (row.dimensionValues || []).map((v: any) => v.value)
    const metrics = (row.metricValues || []).map((v: any) => {
      const n = parseFloat(v.value)
      return isNaN(n) ? v.value : n
    })
    return [...dims, ...metrics]
  })

  // Extract totals from first row of totals array
  let totals: any = null
  if (data.totals && data.totals.length > 0) {
    totals = {}
    const totalRow = data.totals[0]
    ;(totalRow.metricValues || []).forEach((v: any, i: number) => {
      const n = parseFloat(v.value)
      totals[metricHeaders[i]] = isNaN(n) ? v.value : n
    })
  }

  return { headers, rows, totals }
}

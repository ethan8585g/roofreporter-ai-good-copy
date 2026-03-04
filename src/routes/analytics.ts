// ============================================================
// Site Analytics — Track every click, pageview, session
// Server-side: lightweight beacon endpoint + admin query APIs
// ============================================================

import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
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
    const cf = (c.req.raw as any).cf || {}
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown'
    const ua = c.req.header('User-Agent') || ''
    
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
      cf.country || null,
      cf.city || null,
      cf.region || null,
      cf.timezone || null,
      cf.asn ? String(cf.asn) : null,
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

  const [overview, topPages, topCountries, topReferrers, recentVisitors, hourlyTraffic, deviceBreakdown] = await Promise.all([
    // KPI overview
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
      FROM site_analytics WHERE created_at >= ?
    `).bind(since).first(),

    // Top pages by pageviews
    db.prepare(`
      SELECT page_url, 
             COUNT(*) as views, 
             COUNT(DISTINCT visitor_id) as unique_visitors,
             ROUND(AVG(CASE WHEN time_on_page > 0 THEN time_on_page END), 1) as avg_time
      FROM site_analytics 
      WHERE event_type = 'pageview' AND created_at >= ?
      GROUP BY page_url ORDER BY views DESC LIMIT 20
    `).bind(since).all(),

    // Top countries
    db.prepare(`
      SELECT country, COUNT(*) as hits, COUNT(DISTINCT visitor_id) as visitors
      FROM site_analytics 
      WHERE country IS NOT NULL AND created_at >= ?
      GROUP BY country ORDER BY hits DESC LIMIT 15
    `).bind(since).all(),

    // Top referrers
    db.prepare(`
      SELECT referrer, COUNT(*) as hits, COUNT(DISTINCT visitor_id) as visitors
      FROM site_analytics 
      WHERE referrer IS NOT NULL AND referrer != '' AND event_type = 'pageview' AND created_at >= ?
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
      GROUP BY hour ORDER BY hour
    `).all(),

    // Device breakdown
    db.prepare(`
      SELECT device_type, COUNT(*) as count, COUNT(DISTINCT visitor_id) as visitors
      FROM site_analytics
      WHERE device_type IS NOT NULL AND created_at >= ?
      GROUP BY device_type ORDER BY count DESC
    `).bind(since).all()
  ])

  return c.json({
    period,
    overview,
    top_pages: topPages.results,
    top_countries: topCountries.results,
    top_referrers: topReferrers.results,
    recent_visitors: recentVisitors.results,
    hourly_traffic: hourlyTraffic.results,
    device_breakdown: deviceBreakdown.results
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

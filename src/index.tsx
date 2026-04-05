import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { getAccessToken, getProjectId, getServiceAccountEmail } from './services/gcp-auth'
import { trackProposalViewed } from './services/ga4-events'
import { ordersRoutes } from './routes/orders'
import { companiesRoutes } from './routes/companies'
import { settingsRoutes } from './routes/settings'
import { reportsRoutes } from './routes/reports'
import { adminRoutes } from './routes/admin'
import { aiAnalysisRoutes } from './routes/ai-analysis'
import { authRoutes } from './routes/auth'
import { customerAuthRoutes } from './routes/customer-auth'
import { invoiceRoutes } from './routes/invoices'
import { squareRoutes } from './routes/square'
import { crmRoutes } from './routes/crm'
import { propertyImageryRoutes } from './routes/property-imagery'
import { blogRoutes } from './routes/blog'
import { d2dRoutes } from './routes/d2d'
import { secretaryRoutes } from './routes/secretary'
import { roverRoutes } from './routes/rover'
import { emailOutreachRoutes } from './routes/email-outreach'
import { analyticsRoutes } from './routes/analytics'
import { virtualTryonRoutes } from './routes/virtual-tryon'
import { teamRoutes } from './routes/team'
import { agentsRoutes } from './routes/agents'
import { workersAiRoutes } from './routes/workers-ai'
import { reportImagesRoutes } from './routes/report-images'
import { callCenterRoutes } from './routes/call-center'
import { metaConnectRoutes } from './routes/meta-connect'
import { heygenRoutes } from './routes/heygen'
import { geminiRoutes } from './routes/gemini'
import { calendarRoutes } from './routes/calendar'
import { websiteBuilderRoutes } from './routes/website-builder'
import type { Bindings } from './types'

const app = new Hono<{ Bindings: Bindings }>()

// CORS for API routes
app.use('/api/*', cors({
  origin: ['https://www.roofmanager.ca', 'https://roofmanager.ca', 'http://localhost:3000', 'http://0.0.0.0:3000'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 3600,
}))

// Analytics tracker injection middleware — auto-injects tracker.js + GA4 gtag.js into HTML pages
// Skips API routes, static files, and the tracker itself
// Enhanced for maximum tracking accuracy: consent mode, enhanced measurement, cross-domain, user ID linking
app.use('*', async (c, next) => {
  await next()
  
  // Only inject into HTML responses for non-API, non-static paths
  const contentType = c.res.headers.get('content-type') || ''
  if (!contentType.includes('text/html')) return
  
  const url = new URL(c.req.url)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/static/')) return
  
  try {
    const body = await c.res.text()
    if (body.includes('</body>') && !body.includes('tracker.js')) {
      // Build GA4 gtag.js snippet if measurement ID is configured
      const ga4Id = (c.env as any).GA4_MEASUREMENT_ID || ''
      const ga4Script = ga4Id ? `
<!-- Google Analytics 4 — Enhanced Configuration for Maximum Accuracy -->
<script>
// Consent Mode v2 — default grants (no cookie banner needed for analytics-only in Canada)
window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}
gtag('consent','default',{
  'analytics_storage':'granted',
  'ad_storage':'denied',
  'ad_user_data':'denied',
  'ad_personalization':'denied',
  'functionality_storage':'granted',
  'security_storage':'granted'
});
</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=${ga4Id}"></script>
<script>
gtag('js',new Date());
gtag('config','${ga4Id}',{
  // Page view & session settings
  send_page_view: true,
  cookie_flags: 'SameSite=None;Secure',
  cookie_domain: 'auto',
  cookie_expires: 63072000, // 2 years
  
  // Enhanced measurement — GA4 auto-tracks these when enabled:
  // scrolls, outbound clicks, site search, video engagement, file downloads
  // We enable all for maximum data capture
  
  // Session settings for accuracy
  session_timeout: 1800, // 30 minutes (default)
  
  // Page metadata for better reports
  page_title: document.title,
  page_location: window.location.href,
  page_referrer: document.referrer,
  
  // Content grouping
  content_group: (function(){
    var p = location.pathname;
    if (p === '/') return 'Landing';
    if (p.startsWith('/customer/dashboard')) return 'Dashboard';
    if (p.startsWith('/customer/login')) return 'Auth';
    if (p.startsWith('/customer/order')) return 'Order';
    if (p.startsWith('/customer/')) return 'CRM';
    if (p.startsWith('/blog')) return 'Blog';
    if (p.startsWith('/pricing')) return 'Pricing';
    if (p.startsWith('/lander')) return 'Lander';
    if (p.startsWith('/proposal/')) return 'Proposal';
    if (p.startsWith('/admin') || p.startsWith('/super-admin')) return 'Admin';
    if (p.startsWith('/login')) return 'Admin Auth';
    return 'Other';
  })(),
  
  // Custom dimensions
  custom_map: {
    'dimension1': 'user_type',
    'dimension2': 'content_group'
  }
});

// Link GA4 client_id to our internal visitor for cross-referencing
gtag('get','${ga4Id}','client_id',function(cid){
  if(cid) {
    window.__ga4ClientId = cid;
    sessionStorage.setItem('_rc_ga4_cid', cid);
  }
});

// Set user ID if logged in (links client-side & server-side events)
(function(){
  try {
    var c = localStorage.getItem('rc_customer');
    if (c) {
      var u = JSON.parse(c);
      if (u && u.id) {
        gtag('set', 'user_id', String(u.id));
        gtag('set', 'user_properties', {
          user_type: 'customer',
          account_tier: u.tier || 'free'
        });
      }
    }
    var a = localStorage.getItem('rc_user');
    if (a) {
      var au = JSON.parse(a);
      if (au && au.id) {
        gtag('set', 'user_id', 'admin_' + au.id);
        gtag('set', 'user_properties', { user_type: 'admin' });
      }
    }
  } catch(e) {}
})();
</script>` : ''
      
      const injected = body.replace('</body>', `${ga4Script}\n<script src="/static/tracker.js" defer></script>\n</body>`)
      c.res = new Response(injected, {
        status: c.res.status,
        headers: c.res.headers
      })
    }
  } catch(e) {
    // If body read fails, pass through original response
  }
})

// Mount API routes
app.route('/api/orders', ordersRoutes)
app.route('/api/companies', companiesRoutes)
app.route('/api/settings', settingsRoutes)
app.route('/api/reports', reportsRoutes)
app.route('/api/admin', adminRoutes)
app.route('/api/ai', aiAnalysisRoutes)
app.route('/api/auth', authRoutes)
app.route('/api/customer', customerAuthRoutes)
app.route('/api/invoices', invoiceRoutes)
app.route('/api/square', squareRoutes)
app.route('/api/crm', crmRoutes)
app.route('/api/property-imagery', propertyImageryRoutes)
app.route('/api/blog', blogRoutes)
app.route('/api/d2d', d2dRoutes)
app.route('/api/secretary', secretaryRoutes)
app.route('/api/rover', roverRoutes)
app.route('/api/email-outreach', emailOutreachRoutes)
app.route('/api/analytics', analyticsRoutes)
app.route('/api/virtual-tryon', virtualTryonRoutes)
app.route('/api/team', teamRoutes)
app.route('/api/agents', agentsRoutes)
app.route('/api/workers-ai', workersAiRoutes)
app.route('/api/report-images', reportImagesRoutes)
app.route('/api/call-center', callCenterRoutes)
app.route('/api/meta', metaConnectRoutes)
app.route('/api/heygen', heygenRoutes)
app.route('/api/gemini', geminiRoutes)
app.route('/api/calendar', calendarRoutes)
app.route('/api/website-builder', websiteBuilderRoutes)

// Health check
app.get('/api/health', (c) => {
  // Report which env vars are configured (true/false only — never expose values)
  return c.json({
    status: 'ok',
    service: 'Roof Manager - Business Management CRM',
    timestamp: new Date().toISOString(),
    env_configured: {
      GOOGLE_SOLAR_API_KEY: !!c.env.GOOGLE_SOLAR_API_KEY,
      GOOGLE_MAPS_API_KEY: !!c.env.GOOGLE_MAPS_API_KEY,
      GOOGLE_VERTEX_API_KEY: !!c.env.GOOGLE_VERTEX_API_KEY,
      GOOGLE_CLOUD_PROJECT: !!c.env.GOOGLE_CLOUD_PROJECT,
      GOOGLE_CLOUD_LOCATION: !!c.env.GOOGLE_CLOUD_LOCATION,
      GOOGLE_CLOUD_ACCESS_TOKEN: !!c.env.GOOGLE_CLOUD_ACCESS_TOKEN,
      GCP_SERVICE_ACCOUNT_KEY: !!c.env.GCP_SERVICE_ACCOUNT_KEY,
      SQUARE_ACCESS_TOKEN: !!c.env.SQUARE_ACCESS_TOKEN,
      SQUARE_APPLICATION_ID: !!c.env.SQUARE_APPLICATION_ID,
      SQUARE_LOCATION_ID: !!c.env.SQUARE_LOCATION_ID,
      GMAIL_SENDER_EMAIL: c.env.GMAIL_SENDER_EMAIL || '(not set)',
      GMAIL_CLIENT_ID: !!(c.env as any).GMAIL_CLIENT_ID,
      GMAIL_CLIENT_SECRET: !!(c.env as any).GMAIL_CLIENT_SECRET,
      GMAIL_REFRESH_TOKEN: !!(c.env as any).GMAIL_REFRESH_TOKEN,
      RESEND_API_KEY: !!(c.env as any).RESEND_API_KEY,
      SQUARE_WEBHOOK_SIGNATURE_KEY: !!(c.env as any).SQUARE_WEBHOOK_SIGNATURE_KEY,
      LIVEKIT_API_KEY: !!(c.env as any).LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET: !!(c.env as any).LIVEKIT_API_SECRET,
      LIVEKIT_URL: !!(c.env as any).LIVEKIT_URL,
      LIVEKIT_SIP_URI: !!(c.env as any).LIVEKIT_SIP_URI,
      TWILIO_ACCOUNT_SID: !!(c.env as any).TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: !!(c.env as any).TWILIO_AUTH_TOKEN,
      OPENAI_API_KEY: !!(c.env as any).OPENAI_API_KEY,
      OPENAI_BASE_URL: !!(c.env as any).OPENAI_BASE_URL,
      CLOUD_RUN_AI_URL: (c.env as any).CLOUD_RUN_AI_URL || 'https://collab-581996238660.europe-west1.run.app',
      CLOUD_RUN_AI_TOKEN: !!(c.env as any).CLOUD_RUN_AI_TOKEN,
      REPORT_WEBHOOK_SECRET: !!(c.env as any).REPORT_WEBHOOK_SECRET,
      AI_STUDIO_ENHANCE_URL: (c.env as any).AI_STUDIO_ENHANCE_URL || false,
      GEMINI_ENHANCE_API_KEY: !!(c.env as any).GEMINI_ENHANCE_API_KEY,
      GA4_MEASUREMENT_ID: (c.env as any).GA4_MEASUREMENT_ID || false,
      GA4_API_SECRET: !!(c.env as any).GA4_API_SECRET,
      GA4_PROPERTY_ID: (c.env as any).GA4_PROPERTY_ID || false,
      DB: !!c.env.DB,
      AI: !!(c.env as any).AI
    },
    workers_ai: {
      available: !!(c.env as any).AI,
      endpoints: ['/api/workers-ai/classify-roof', '/api/workers-ai/analyze-image', '/api/workers-ai/verify-measurements', '/api/workers-ai/enhance-report-text', '/api/workers-ai/assess-condition']
    },
    analytics: {
      ga4_client_tracking: !!(c.env as any).GA4_MEASUREMENT_ID,
      ga4_server_events: !!((c.env as any).GA4_MEASUREMENT_ID && (c.env as any).GA4_API_SECRET),
      ga4_data_api: !!((c.env as any).GA4_PROPERTY_ID && c.env.GCP_SERVICE_ACCOUNT_KEY),
      ga4_realtime: !!((c.env as any).GA4_PROPERTY_ID && c.env.GCP_SERVICE_ACCOUNT_KEY),
      internal_d1_tracking: !!c.env.DB,
      tracker_js: true,
      tracked_events: ['pageview', 'click', 'scroll_milestone', 'engagement_milestone', 'form_start', 'form_submit', 'page_exit', 'web_vitals', 'cta_click', 'outbound_click', 'js_error'],
      server_events: ['sign_up', 'login', 'purchase', 'report_generated', 'report_enhanced', 'email_sent', 'generate_lead', 'proposal_viewed', 'proposal_response', 'workers_ai_inference', 'api_call', 'gmail_connected']
    },
    vertex_ai: {
      mode: c.env.GCP_SERVICE_ACCOUNT_KEY ? 'service_account_auto' :
            c.env.GOOGLE_CLOUD_ACCESS_TOKEN ? 'vertex_ai_platform' :
            (c.env.GOOGLE_VERTEX_API_KEY ? 'gemini_rest_api' : 'not_configured'),
      project: c.env.GOOGLE_CLOUD_PROJECT || getProjectId(c.env.GCP_SERVICE_ACCOUNT_KEY || '') || null,
      location: c.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
      service_account: getServiceAccountEmail(c.env.GCP_SERVICE_ACCOUNT_KEY || '') || null
    }
  })
})

// Diagnostic: Test Google Solar API connectivity
app.get('/api/health/solar', async (c) => {
  try {
    const solarKey = c.env.GOOGLE_SOLAR_API_KEY
    const mapsKey = c.env.GOOGLE_MAPS_API_KEY
    const results: any = {
      timestamp: new Date().toISOString(),
      keys_configured: {
        solar_api_key: !!solarKey,
        solar_key_prefix: solarKey ? solarKey.substring(0, 8) + '...' : null,
        maps_api_key: !!mapsKey,
        maps_key_prefix: mapsKey ? mapsKey.substring(0, 8) + '...' : null
      },
      tests: {}
    }

    // Test 1: Solar buildingInsights API (Calgary downtown)
    if (solarKey) {
      try {
        const biUrl = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=51.0447&location.longitude=-114.0719&requiredQuality=HIGH&key=${solarKey}`
        const biResp = await fetch(biUrl)
        if (biResp.ok) {
          const biData: any = await biResp.json()
          results.tests.building_insights = {
            status: 'ok',
            http_status: biResp.status,
            roof_area_m2: biData.solarPotential?.wholeRoofStats?.areaMeters2 || 0,
            segments: biData.solarPotential?.roofSegmentStats?.length || 0,
            imagery_quality: biData.imageryQuality || 'unknown'
          }
        } else {
          const errText = await biResp.text()
          results.tests.building_insights = {
            status: 'error',
            http_status: biResp.status,
            error: errText.substring(0, 500),
            fix: biResp.status === 403
              ? 'API key may have IP/referrer restrictions. Cloudflare Workers have no static IP — remove all restrictions from the key in Google Cloud Console.'
              : biResp.status === 400
              ? 'Bad request — check if Solar API is enabled in Google Cloud Console.'
              : 'Check API key and billing in Google Cloud Console.'
          }
        }
      } catch (e: any) {
        results.tests.building_insights = { status: 'network_error', error: e.message }
      }

      // Test 2: Solar DataLayers API
      try {
        const dlUrl = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=51.0447&location.longitude=-114.0719&radiusMeters=50&view=FULL_LAYERS&requiredQuality=HIGH&pixelSizeMeters=0.5&key=${solarKey}`
        const dlResp = await fetch(dlUrl)
        if (dlResp.ok) {
          const dlData: any = await dlResp.json()
          results.tests.data_layers = {
            status: 'ok',
            http_status: dlResp.status,
            has_dsm: !!dlData.dsmUrl,
            has_mask: !!dlData.maskUrl,
            has_rgb: !!dlData.rgbUrl,
            imagery_quality: dlData.imageryQuality || 'unknown'
          }
        } else {
          const errText = await dlResp.text()
          results.tests.data_layers = { status: 'error', http_status: dlResp.status, error: errText.substring(0, 500) }
        }
      } catch (e: any) {
        results.tests.data_layers = { status: 'network_error', error: e.message }
      }
    } else {
      results.tests.building_insights = { status: 'skipped', reason: 'GOOGLE_SOLAR_API_KEY not configured' }
      results.tests.data_layers = { status: 'skipped', reason: 'GOOGLE_SOLAR_API_KEY not configured' }
    }

    // Test 3: Maps Geocoding API
    if (mapsKey || solarKey) {
      try {
        const geoKey = mapsKey || solarKey
        const geoResp = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=Calgary+AB+Canada&key=${geoKey}`)
        const geoData: any = await geoResp.json()
        results.tests.geocoding = {
          status: geoData.status === 'OK' ? 'ok' : 'error',
          api_status: geoData.status,
          error_message: geoData.error_message || null
        }
      } catch (e: any) {
        results.tests.geocoding = { status: 'network_error', error: e.message }
      }
    }

    const allOk = Object.values(results.tests).every((t: any) => t.status === 'ok')
    results.overall = allOk ? 'all_apis_working' : 'some_issues_detected'

    return c.json(results)
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Diagnostic: Test Gemini API connectivity (service account → access token → API key)
app.get('/api/health/gemini', async (c) => {
  try {
    let authHeader = ''
    let authMode = ''
    let url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent'

    // Priority 1: Service Account Key (auto-generates access token)
    if (c.env.GCP_SERVICE_ACCOUNT_KEY) {
      const token = await getAccessToken(c.env.GCP_SERVICE_ACCOUNT_KEY)
      authHeader = `Bearer ${token}`
      authMode = 'service_account_auto'
    }
    // Priority 2: Static access token
    else if (c.env.GOOGLE_CLOUD_ACCESS_TOKEN) {
      authHeader = `Bearer ${c.env.GOOGLE_CLOUD_ACCESS_TOKEN}`
      authMode = 'access_token'
    }
    // Priority 3: API key
    else if (c.env.GOOGLE_VERTEX_API_KEY) {
      authMode = 'api_key'
      url += `?key=${c.env.GOOGLE_VERTEX_API_KEY}`
    }
    else {
      return c.json({ status: 'error', message: 'No Gemini credentials configured', fix: 'Set GCP_SERVICE_ACCOUNT_KEY, GOOGLE_CLOUD_ACCESS_TOKEN, or GOOGLE_VERTEX_API_KEY' }, 400)
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (authHeader) headers['Authorization'] = authHeader

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Respond with exactly: OK' }] }] })
    })

    if (response.ok) {
      const data: any = await response.json()
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
      return c.json({
        status: 'ok',
        model: 'gemini-2.0-flash',
        auth_mode: authMode,
        response: text.trim(),
        project: getProjectId(c.env.GCP_SERVICE_ACCOUNT_KEY || '') || c.env.GOOGLE_CLOUD_PROJECT || null,
        service_account: getServiceAccountEmail(c.env.GCP_SERVICE_ACCOUNT_KEY || '') || null
      })
    }

    const errData: any = await response.json().catch(() => ({}))
    const errMsg = errData?.error?.message || `HTTP ${response.status}`
    return c.json({ status: 'error', auth_mode: authMode, http_status: response.status, message: errMsg }, response.status as any)

  } catch (err: any) {
    return c.json({ status: 'error', message: err.message, fix: 'Network or auth error' }, 500)
  }
})

// ============================================================
// SERVER-SIDE CONFIG ENDPOINT
// Returns ONLY publishable/safe values to the frontend.
// Secret keys (Google Solar, Square Access Token) stay server-side.
// ============================================================
app.get('/api/config/client', (c) => {
  // Only expose keys that are designed to be public (publishable keys)
  // Google Maps JS API key is loaded via script tag — that's how Google designed it
  // Square Application ID is safe for frontend use (like Stripe publishable key)
  return c.json({
    google_maps_key: c.env.GOOGLE_MAPS_API_KEY || '',
    square_application_id: c.env.SQUARE_APPLICATION_ID || '',
    square_location_id: c.env.SQUARE_LOCATION_ID || '',
    // Feature flags based on which keys are configured
    features: {
      google_maps: !!c.env.GOOGLE_MAPS_API_KEY,
      google_solar: !!c.env.GOOGLE_SOLAR_API_KEY,
      square_payments: !!c.env.SQUARE_ACCESS_TOKEN && !!c.env.SQUARE_APPLICATION_ID,
      self_service_orders: !!c.env.SQUARE_ACCESS_TOKEN
    }
  })
})

// ============================================================
// PAGES - Full HTML served from Hono (server-side rendering)
// Google Maps API key is injected server-side into the script tag.
// Secret keys (Solar API, Square Access Token) are NEVER in HTML.
// ============================================================

// Landing / Marketing page
app.get('/', (c) => {
  return c.html(getLandingPageHTML())
})

// /order redirect — users may type /order directly
app.get('/order', (c) => c.redirect('/customer/order'))

// Order Form page (new route)
app.get('/order/new', (c) => {
  const mapsKey = c.env.GOOGLE_MAPS_API_KEY || ''
  return c.html(getMainPageHTML(mapsKey))
})

// Super Admin Dashboard (post-login landing)
app.get('/super-admin', (c) => {
  return c.html(getSuperAdminDashboardHTML())
})

// Admin Dashboard (legacy + operational)
app.get('/admin', (c) => {
  return c.html(getAdminPageHTML())
})

// Order Confirmation Page
app.get('/order/:id', (c) => {
  return c.html(getOrderConfirmationHTML())
})

// Settings Page (API Keys)
app.get('/settings', (c) => {
  return c.html(getSettingsPageHTML())
})

// Login/Register Page (Admin)
app.get('/login', (c) => {
  return c.html(getLoginPageHTML())
})

// Admin Password Reset Page (linked from reset email)
app.get('/reset-password', (c) => {
  return c.html(getAdminResetPasswordHTML())
})

// Customer Login/Register Page (email/password)
app.get('/customer/login', (c) => {
  return c.html(getCustomerLoginHTML())
})

// Customer Password Reset Page (linked from reset email)
app.get('/customer/reset-password', (c) => {
  return c.html(getCustomerResetPasswordHTML())
})

// Customer Dashboard
app.get('/customer/dashboard', (c) => {
  return c.html(getCustomerDashboardHTML(c.env.ADSENSE_PUBLISHER_ID || ''))
})

// Customer Invoice View
app.get('/customer/invoice/:id', (c) => {
  return c.html(getCustomerInvoiceHTML())
})

// Google Search Console verification
app.get('/google46a10be18f6bfc61.html', (c) => {
  return c.text('google-site-verification: google46a10be18f6bfc61.html')
})

// SEO: sitemap.xml
app.get('/sitemap.xml', async (c) => {
  const base = 'https://www.roofmanager.ca'
  const staticPages = [
    { loc: '/', priority: '1.0', changefreq: 'weekly' },
    { loc: '/pricing', priority: '0.9', changefreq: 'monthly' },
    { loc: '/blog', priority: '0.8', changefreq: 'weekly' },
    { loc: '/lander', priority: '0.7', changefreq: 'monthly' },
    { loc: '/privacy', priority: '0.3', changefreq: 'yearly' },
    { loc: '/terms', priority: '0.3', changefreq: 'yearly' },
  ]
  // City geo pages
  for (const slug of Object.keys(seoCities)) {
    staticPages.push({ loc: `/roof-measurement/${slug}`, priority: '0.7', changefreq: 'monthly' })
  }
  let urls = staticPages.map(p => `<url><loc>${base}${p.loc}</loc><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`).join('\n')
  try {
    const posts = await c.env.DB.prepare("SELECT slug, updated_at FROM blog_posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 100").all()
    for (const p of (posts.results || []) as any[]) {
      urls += `\n<url><loc>${base}/blog/${p.slug}</loc><changefreq>monthly</changefreq><priority>0.6</priority>${p.updated_at ? `<lastmod>${p.updated_at.substring(0, 10)}</lastmod>` : ''}</url>`
    }
  } catch {}
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`
  return c.text(xml, 200, { 'Content-Type': 'application/xml' })
})

// SEO: robots.txt
app.get('/robots.txt', (c) => {
  return c.text(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /customer/\nDisallow: /admin/\nDisallow: /superadmin/\nSitemap: https://www.roofmanager.ca/sitemap.xml`)
})

// Pricing Page (public)
app.get('/pricing', (c) => {
  return c.html(getPricingPageHTML())
})

// Legal Pages (required for Google OAuth verification)
app.get('/privacy', (c) => {
  return c.html(getPrivacyPageHTML())
})
app.get('/terms', (c) => {
  return c.html(getTermsPageHTML())
})

// Programmatic city/geo SEO landing pages
const seoCities: Record<string, { name: string; province: string; lat: string; lng: string }> = {
  'calgary': { name: 'Calgary', province: 'Alberta', lat: '51.0447', lng: '-114.0719' },
  'edmonton': { name: 'Edmonton', province: 'Alberta', lat: '53.5461', lng: '-113.4937' },
  'vancouver': { name: 'Vancouver', province: 'British Columbia', lat: '49.2827', lng: '-123.1207' },
  'toronto': { name: 'Toronto', province: 'Ontario', lat: '43.6532', lng: '-79.3832' },
  'ottawa': { name: 'Ottawa', province: 'Ontario', lat: '45.4215', lng: '-75.6972' },
  'winnipeg': { name: 'Winnipeg', province: 'Manitoba', lat: '49.8951', lng: '-97.1384' },
  'saskatoon': { name: 'Saskatoon', province: 'Saskatchewan', lat: '52.1332', lng: '-106.6700' },
  'regina': { name: 'Regina', province: 'Saskatchewan', lat: '50.4452', lng: '-104.6189' },
  'red-deer': { name: 'Red Deer', province: 'Alberta', lat: '52.2681', lng: '-113.8112' },
  'lethbridge': { name: 'Lethbridge', province: 'Alberta', lat: '49.6942', lng: '-112.8328' },
  'kelowna': { name: 'Kelowna', province: 'British Columbia', lat: '49.8880', lng: '-119.4960' },
  'sherwood-park': { name: 'Sherwood Park', province: 'Alberta', lat: '53.5412', lng: '-113.3180' },
  'st-albert': { name: 'St. Albert', province: 'Alberta', lat: '53.6301', lng: '-113.6258' },
  'medicine-hat': { name: 'Medicine Hat', province: 'Alberta', lat: '50.0405', lng: '-110.6764' },
  'grande-prairie': { name: 'Grande Prairie', province: 'Alberta', lat: '55.1707', lng: '-118.7946' },
}
app.get('/roof-measurement/:city', (c) => {
  const citySlug = c.req.param('city').toLowerCase()
  const city = seoCities[citySlug]
  if (!city) return c.redirect('/')
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Roof Measurement Reports in ${city.name}, ${city.province} | Roof Manager</title>
  <meta name="description" content="Get accurate AI-powered roof measurement reports in ${city.name}, ${city.province}. Satellite imagery analysis with area, pitch, edges, and material estimates in under 60 seconds. 3 free reports.">
  <link rel="canonical" href="https://www.roofmanager.ca/roof-measurement/${citySlug}">
  <meta property="og:title" content="Roof Measurement Reports in ${city.name} | Roof Manager">
  <meta property="og:description" content="AI-powered satellite roof measurements for ${city.name} roofing contractors. Full CRM, proposals, invoicing included.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://www.roofmanager.ca/roof-measurement/${citySlug}">
  <meta property="og:image" content="https://roofmanager.ca/static/logo.png">
  <meta property="og:site_name" content="Roof Manager">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="Roof Measurements in ${city.name} — Roof Manager">
  <meta name="twitter:image" content="https://roofmanager.ca/static/logo.png">
  <meta name="geo.region" content="CA">
  <meta name="geo.placename" content="${city.name}, ${city.province}, Canada">
  <meta name="geo.position" content="${city.lat};${city.lng}">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": "Roof Manager — ${city.name}",
    "description": "AI-powered roof measurement reports and CRM for roofing companies in ${city.name}, ${city.province}.",
    "url": "https://www.roofmanager.ca/roof-measurement/${citySlug}",
    "image": "https://roofmanager.ca/static/logo.png",
    "address": {"@type": "PostalAddress", "addressLocality": "${city.name}", "addressRegion": "${city.province}", "addressCountry": "CA"},
    "geo": {"@type": "GeoCoordinates", "latitude": "${city.lat}", "longitude": "${city.lng}"},
    "areaServed": {"@type": "City", "name": "${city.name}"},
    "priceRange": "$5-$500 USD"
  }
  </script>
</head>
<body class="bg-gray-50 min-h-screen">
  <nav class="bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
      <a href="/" class="flex items-center gap-3"><img src="/static/logo.png" alt="Roof Manager" class="w-9 h-9 rounded-lg object-cover"><span class="text-white font-bold text-lg">Roof Manager</span></a>
      <div class="flex items-center gap-4">
        <a href="/pricing" class="text-blue-200 hover:text-white text-sm">Pricing</a>
        <a href="/customer/login" class="bg-white text-blue-700 font-semibold py-2 px-5 rounded-lg text-sm hover:bg-blue-50">Get Started Free</a>
      </div>
    </div>
  </nav>

  <section class="bg-gradient-to-br from-slate-900 via-blue-900 to-sky-800 text-white py-20">
    <div class="max-w-5xl mx-auto px-4 text-center">
      <span class="inline-block px-4 py-1.5 bg-sky-500/20 border border-sky-400/30 rounded-full text-sm text-sky-300 mb-6"><i class="fas fa-map-marker-alt mr-2"></i>${city.name}, ${city.province}</span>
      <h1 class="text-4xl md:text-5xl font-black mb-6 leading-tight">Roof Measurement Reports<br>in <span class="text-sky-400">${city.name}</span></h1>
      <p class="text-lg text-blue-200 max-w-2xl mx-auto mb-8">Get accurate satellite-powered roof measurements for any property in ${city.name}. Area, pitch, edges, material estimates — all in under 60 seconds.</p>
      <div class="flex flex-col sm:flex-row gap-4 justify-center">
        <a href="/customer/login" class="px-8 py-3.5 bg-sky-500 hover:bg-sky-400 text-white font-bold rounded-xl text-lg shadow-xl">Get 3 Free Reports <i class="fas fa-arrow-right ml-2"></i></a>
        <a href="/pricing" class="px-8 py-3.5 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl text-lg border border-white/20">View Pricing</a>
      </div>
      <p class="text-sm text-blue-300 mt-4">No credit card required. Instant setup.</p>
    </div>
  </section>

  <section class="py-16 bg-white">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-gray-900 text-center mb-10">What ${city.name} Roofers Get With Every Report</h2>
      <div class="grid md:grid-cols-3 gap-8">
        <div class="text-center"><div class="w-14 h-14 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-4"><i class="fas fa-ruler-combined text-blue-600 text-xl"></i></div><h3 class="font-bold text-gray-800 mb-2">Precise Measurements</h3><p class="text-sm text-gray-500">Total roof area (footprint + sloped), pitch analysis, and area multiplier from satellite imagery.</p></div>
        <div class="text-center"><div class="w-14 h-14 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-4"><i class="fas fa-draw-polygon text-blue-600 text-xl"></i></div><h3 class="font-bold text-gray-800 mb-2">Edge Breakdowns</h3><p class="text-sm text-gray-500">Ridge, hip, valley, eave, and rake lengths — everything you need for accurate material takeoff.</p></div>
        <div class="text-center"><div class="w-14 h-14 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-4"><i class="fas fa-boxes text-blue-600 text-xl"></i></div><h3 class="font-bold text-gray-800 mb-2">Material Calculator</h3><p class="text-sm text-gray-500">Shingles, underlayment, ice shield, ridge cap, drip edge — full BOM with waste factor and pricing.</p></div>
      </div>
    </div>
  </section>

  <section class="py-16 bg-gray-50">
    <div class="max-w-5xl mx-auto px-4">
      <h2 class="text-2xl font-black text-gray-900 text-center mb-10">Full CRM for ${city.name} Roofing Companies</h2>
      <div class="grid md:grid-cols-2 gap-6">
        <div class="bg-white rounded-xl p-6 border"><h3 class="font-bold text-gray-800 mb-2"><i class="fas fa-users text-blue-600 mr-2"></i>Customer Management</h3><p class="text-sm text-gray-500">Track all your ${city.name} customers, properties, and communication history in one place.</p></div>
        <div class="bg-white rounded-xl p-6 border"><h3 class="font-bold text-gray-800 mb-2"><i class="fas fa-file-signature text-blue-600 mr-2"></i>Proposals & Invoicing</h3><p class="text-sm text-gray-500">Create professional proposals with material details, send invoices, and collect payments online.</p></div>
        <div class="bg-white rounded-xl p-6 border"><h3 class="font-bold text-gray-800 mb-2"><i class="fas fa-calendar text-blue-600 mr-2"></i>Job Scheduling</h3><p class="text-sm text-gray-500">Calendar-based job management with Google Calendar sync, checklists, and crew tracking.</p></div>
        <div class="bg-white rounded-xl p-6 border"><h3 class="font-bold text-gray-800 mb-2"><i class="fas fa-headset text-blue-600 mr-2"></i>AI Phone Secretary</h3><p class="text-sm text-gray-500">Never miss a call. AI answers your business phone, takes messages, and books appointments 24/7.</p></div>
      </div>
    </div>
  </section>

  <section class="py-16 bg-gradient-to-r from-blue-600 to-sky-500 text-white text-center">
    <div class="max-w-3xl mx-auto px-4">
      <h2 class="text-3xl font-black mb-4">Ready to Grow Your ${city.name} Roofing Business?</h2>
      <p class="text-lg text-blue-100 mb-8">Join roofing contractors across ${city.province} who use Roof Manager to measure faster, quote smarter, and win more jobs.</p>
      <a href="/customer/login" class="inline-block px-10 py-4 bg-white text-blue-700 font-black rounded-xl text-lg shadow-xl hover:bg-blue-50">Start Free — 3 Reports on Us <i class="fas fa-arrow-right ml-2"></i></a>
    </div>
  </section>

  <footer class="bg-slate-900 text-gray-400 py-8 text-center text-sm">
    <p>&copy; ${new Date().getFullYear()} Roof Manager. Serving roofing contractors in ${city.name}, ${city.province} and across Canada.</p>
    <div class="mt-2"><a href="/privacy" class="hover:text-white">Privacy</a> · <a href="/terms" class="hover:text-white">Terms</a> · <a href="/blog" class="hover:text-white">Blog</a> · <a href="/pricing" class="hover:text-white">Pricing</a></div>
  </footer>
</body>
</html>`)
})

// Material Calculator — BOM tool from completed report data
app.get('/customer/material-calculator', (c) => {
  return c.html(getMaterialCalculatorPageHTML())
})

// Blog Pages (public — SEO lead funnels)
app.get('/blog', (c) => {
  return c.html(getBlogListingHTML())
})
app.get('/blog/:slug', async (c) => {
  const slug = c.req.param('slug')
  let post: any = null
  try {
    post = await c.env.DB.prepare("SELECT title, excerpt, meta_title, meta_description, cover_image_url, author_name, published_at, updated_at FROM blog_posts WHERE slug = ? AND status = 'published'").bind(slug).first()
  } catch {}
  return c.html(getBlogPostHTML(post, slug))
})

// Landing Funnel — Social media & blog traffic funnels here
app.get('/lander', (c) => {
  return c.html(getLanderFunnelHTML())
})

// Customer Order & Pay page
app.get('/customer/order', (c) => {
  const mapsKey = c.env.GOOGLE_MAPS_API_KEY || ''
  return c.html(getCustomerOrderPageHTML(mapsKey))
})

// Property Imagery — Dev account only
app.get('/customer/property-imagery', (c) => {
  const mapsKey = c.env.GOOGLE_MAPS_API_KEY || ''
  return c.html(getPropertyImageryPageHTML(mapsKey))
})

// Customer CRM sub-pages
app.get('/customer/reports', (c) => c.html(getCrmSubPageHTML('reports', 'Roof Report History', 'fa-file-alt')))
app.get('/customer/customers', (c) => c.html(getCrmSubPageHTML('customers', 'My Customers', 'fa-users')))
app.get('/customer/invoices', (c) => c.html(getCrmSubPageHTML('invoices', 'Invoices', 'fa-file-invoice-dollar')))
app.get('/customer/proposals', (c) => c.html(getCrmSubPageHTML('proposals', 'Proposals & Estimates', 'fa-file-signature')))
app.get('/customer/jobs', (c) => c.html(getCrmSubPageHTML('jobs', 'Job Management', 'fa-hard-hat')))
app.get('/customer/pipeline', (c) => c.html(getCrmSubPageHTML('pipeline', 'Sales Pipeline', 'fa-funnel-dollar')))
app.get('/customer/email-outreach', (c) => c.html(getCrmSubPageHTML('email-outreach', 'Email Outreach', 'fa-envelope-open-text')))
app.get('/customer/catalog', (c) => c.html(getCrmSubPageHTML('catalog', 'Material Catalog', 'fa-box-open')))
app.get('/customer/referrals', (c) => c.html(getCrmSubPageHTML('referrals', 'Referral Program', 'fa-gift')))
app.get('/customer/crew', (c) => c.html(getCrmSubPageHTML('crew', 'Crew Manager', 'fa-hard-hat')))
app.get('/customer/website-builder', (c) => c.html(getWebsiteBuilderPageHTML()))

// Company Type Selection — shown once post-login if company_type is null
app.get('/customer/select-type', (c) => c.html(getSelectTypePageHTML()))

// Solar Panel Design Tool — canvas-based panel placement on satellite image
app.get('/customer/solar-design', (c) => c.html(getSolarDesignPageHTML()))

// Customer Profile / Account Settings
app.get('/customer/profile', (c) => c.html(getCustomerProfilePageHTML()))

// Virtual Try-On — AI Roof Visualization
app.get('/customer/virtual-tryon', (c) => c.html(getVirtualTryOnPageHTML()))

// 3D Roof Visualizer — Interactive color swapping tool accessible from report history
app.get('/visualizer/:orderId', async (c) => {
  const orderId = c.req.param('orderId')
  const mapsKey = c.env.GOOGLE_MAPS_API_KEY || ''

  let address = 'Property'
  let reportJson: any = null
  try {
    const order = await c.env.DB.prepare(
      'SELECT property_address, latitude, longitude FROM orders WHERE id = ?'
    ).bind(orderId).first<any>()
    if (order) {
      address = order.property_address || address
      // Inject coordinates so the 3D visualizer's 2D Street View mode works
      if (!reportJson) reportJson = {}
      if (order.latitude) reportJson.latitude = order.latitude
      if (order.longitude) reportJson.longitude = order.longitude
    }

    const report = await c.env.DB.prepare(
      "SELECT report_json FROM reports WHERE order_id = ? AND status IN ('completed','enhancing') LIMIT 1"
    ).bind(orderId).first<any>()
    if (report?.report_json) {
      const parsed = typeof report.report_json === 'string' ? JSON.parse(report.report_json) : report.report_json
      // Merge coordinates into the report data so visualizer JS can access them
      reportJson = { ...parsed, latitude: reportJson?.latitude, longitude: reportJson?.longitude, google_maps_key: mapsKey }
    } else if (reportJson) {
      reportJson.google_maps_key = mapsKey
    }
  } catch (e) { /* graceful */ }

  return c.html(getVisualizerPageHTML(address, reportJson, mapsKey))
})

// Customer Proposal Builder (full-featured)
app.get('/customer/proposal-builder', (c) => {
  const mapsKey = c.env.GOOGLE_MAPS_API_KEY || ''
  return c.html(getProposalBuilderPageHTML(mapsKey))
})

// Customer Invoice Manager
app.get('/customer/invoice-manager', (c) => {
  return c.html(getInvoiceManagerPageHTML())
})

// Team Management — Add/manage sales team members ($50/user/month)
app.get('/customer/team', (c) => c.html(getTeamManagementPageHTML()))

// Join Team — Accept invitation (public landing with auth redirect)
app.get('/customer/join-team', (c) => c.html(getJoinTeamPageHTML()))

// Public report share page — allows homeowners to view a contractor-shared report
app.get('/report/share/:token', async (c) => {
  try {
    const token = c.req.param('token')
    const row = await c.env.DB.prepare(`
      SELECT r.professional_report_html, r.api_response_raw, r.share_view_count,
             o.property_address, o.property_city, o.property_province
      FROM reports r JOIN orders o ON o.id = r.order_id
      WHERE r.share_token = ?
    `).bind(token).first<any>()

    if (!row) {
      return c.html(`<!DOCTYPE html><html><head><title>Report Not Found</title><script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center">
<div class="text-center max-w-md mx-auto px-4">
  <div class="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
    <i class="fas fa-file-times text-red-500 text-2xl"></i>
  </div>
  <h1 class="text-2xl font-bold text-gray-800 mb-2">Report Not Found</h1>
  <p class="text-gray-500">This report link is invalid or has expired.</p>
</div>
<link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
</body></html>`, 404)
    }

    // Increment view count (non-blocking)
    c.env.DB.prepare("UPDATE reports SET share_view_count = COALESCE(share_view_count, 0) + 1 WHERE share_token = ?").bind(token).run().catch(() => {})

    const addr = [row.property_address, row.property_city, row.property_province].filter(Boolean).join(', ')

    // Resolve report HTML (use stored HTML only — avoids bundling template at edge)
    const h = row.professional_report_html || ''
    const reportHtml = (h.trimStart().startsWith('<!DOCTYPE') || h.trimStart().startsWith('<html')) ? h : ''

    if (!reportHtml) {
      return c.html(`<!DOCTYPE html><html><head><title>Report Unavailable</title><script src="https://cdn.tailwindcss.com"></script></head>
<body class="bg-gray-50 min-h-screen flex items-center justify-center">
<div class="text-center"><h1 class="text-xl font-bold text-gray-700 mb-2">Report Not Available</h1><p class="text-gray-500">This report has not been generated yet.</p></div>
</body></html>`, 404)
    }

    // Inject OG meta tags for social sharing
    const ogTags = `<meta property="og:title" content="Roof Measurement Report — ${addr || 'Professional Analysis'}">
<meta property="og:description" content="Professional satellite roof measurement report with area, pitch, edges, and material estimate. Powered by Roof Manager.">
<meta property="og:type" content="article">
<meta property="og:url" content="https://www.roofmanager.ca/report/share/${token}">
<meta property="og:site_name" content="Roof Manager">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="Roof Report — ${addr || 'Professional Analysis'}">`
    const htmlWithOg = reportHtml.replace(/<head[^>]*>/i, `$&\n${ogTags}`)

    // Wrap with a public header bar
    const wrappedHtml = htmlWithOg.replace(
      /<body[^>]*>/i,
      `$&<div style="position:fixed;top:0;left:0;right:0;z-index:9999;background:#0f172a;color:#fff;padding:10px 20px;display:flex;align-items:center;justify-between;font-family:Inter,system-ui,sans-serif;font-size:13px">
  <div style="display:flex;align-items:center;gap:10px"><span style="font-weight:700;color:#38bdf8">Roof Manager</span><span style="color:#94a3b8">|</span><span style="color:#cbd5e1">${addr || 'Roof Report'}</span></div>
  <div style="display:flex;gap:8px"><button onclick="window.print()" style="background:#1e40af;color:#fff;border:none;padding:6px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600">Print / Save PDF</button><a href="https://roofmanager.ca" target="_blank" style="background:#065f46;color:#fff;padding:6px 14px;border-radius:8px;text-decoration:none;font-size:12px;font-weight:600">Get Your Own Report</a></div>
</div><div style="height:48px"></div>`
    )

    return c.html(wrappedHtml)
  } catch (err: any) {
    console.error('[ShareReport]', err.message)
    return c.html(`<!DOCTYPE html><html><body><p>Error loading report.</p></body></html>`, 500)
  }
})

// Public proposal view page — tracks views when customer opens shared link
app.get('/proposal/view/:token', async (c) => {
  try {
    const token = c.req.param('token')
    const proposal = await c.env.DB.prepare(`
      SELECT cp.*, cc.name as customer_name, cc.email as customer_email, cc.phone as customer_phone,
             cc.address as customer_address, cc.city as customer_city, cc.province as customer_province, cc.postal_code as customer_postal
      FROM crm_proposals cp
      LEFT JOIN crm_customers cc ON cc.id = cp.crm_customer_id
      WHERE cp.share_token = ?
    `).bind(token).first<any>()

    if (!proposal) {
      // Fallback 1: check crm_invoices table
      const crmInvoice = await c.env.DB.prepare(`
        SELECT ci.*, ci.total as total_amount, ci.subtotal, ci.tax_rate, ci.tax_amount,
               cc.name as customer_name, cc.email as customer_email, cc.phone as customer_phone,
               cc.address as customer_address, cc.city as customer_city, cc.province as customer_province, cc.postal_code as customer_postal
        FROM crm_invoices ci LEFT JOIN crm_customers cc ON cc.id = ci.crm_customer_id
        WHERE ci.share_token = ?
      `).bind(token).first<any>()
      if (crmInvoice) {
        // Treat CRM invoice like a proposal for rendering
        crmInvoice.proposal_number = crmInvoice.invoice_number
        crmInvoice.title = crmInvoice.title || ('Invoice ' + crmInvoice.invoice_number)
        crmInvoice.total_amount = crmInvoice.total || crmInvoice.total_amount
        // Re-assign to proposal so the rest of the handler renders it
        const items = await c.env.DB.prepare('SELECT * FROM crm_invoice_items WHERE invoice_id = ? ORDER BY sort_order').bind(crmInvoice.id).all()
        // Use the CRM proposal rendering path by assigning back
        Object.assign(crmInvoice, { _is_crm_invoice: true })
        // Fall through to invoice rendering below with invProposal
      }

      // Fallback 2: check invoices table (proposal builder creates proposals there)
      const invProposal = crmInvoice || await c.env.DB.prepare(`
        SELECT i.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone,
               c.company_name, c.address as customer_address, c.city as customer_city,
               c.province as customer_province, c.postal_code as customer_postal
        FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.share_token = ?
      `).bind(token).first<any>()

      if (invProposal) {
        // Update view tracking
        await c.env.DB.prepare(`UPDATE invoices SET viewed_count = COALESCE(viewed_count, 0) + 1, viewed_at = datetime('now'), status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END, updated_at = datetime('now') WHERE id = ?`).bind(invProposal.id).run()
        
        const items = await c.env.DB.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order').bind(invProposal.id).all()
        const lineItems = items.results || []
        const docType = invProposal.document_type || 'invoice'
        const docLabel = docType.charAt(0).toUpperCase() + docType.slice(1)
        
        let itemsHtml = ''
        if (lineItems.length > 0) {
          itemsHtml = '<table class="w-full text-sm"><thead><tr class="border-b-2 border-gray-200"><th class="text-left py-3 px-2 font-semibold text-gray-600">Description</th><th class="text-center py-3 px-2 font-semibold text-gray-600">Qty</th><th class="text-center py-3 px-2 font-semibold text-gray-600">Unit</th><th class="text-right py-3 px-2 font-semibold text-gray-600">Price</th><th class="text-right py-3 px-2 font-semibold text-gray-600">Amount</th></tr></thead><tbody>'
          for (const it of lineItems as any[]) {
            itemsHtml += `<tr class="border-b border-gray-100"><td class="py-3 px-2">${it.description}</td><td class="py-3 px-2 text-center">${it.quantity}</td><td class="py-3 px-2 text-center">${it.unit || 'each'}</td><td class="py-3 px-2 text-right">$${Number(it.unit_price).toFixed(2)}</td><td class="py-3 px-2 text-right font-medium">$${Number(it.amount).toFixed(2)}</td></tr>`
          }
          itemsHtml += '</tbody></table>'
        }

        // Get attached report link
        let reportLink = ''
        if (invProposal.attached_report_id) {
          reportLink = `<a href="/api/reports/${invProposal.attached_report_id}/html" target="_blank" class="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-100"><i class="fas fa-file-alt"></i>View Roof Report</a>`
        }

        return c.html(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${docLabel} ${invProposal.invoice_number} — Roof Manager</title><meta property="og:title" content="${docLabel} ${invProposal.invoice_number} — $${Number(invProposal.total_amount || 0).toFixed(2)}"><meta property="og:description" content="Professional roofing ${docLabel.toLowerCase()} for ${invProposal.customer_name || 'valued customer'}. ${invProposal.property_address ? 'Property: ' + invProposal.property_address : ''}"><meta property="og:type" content="article"><meta property="og:site_name" content="Roof Manager"><meta name="twitter:card" content="summary"><script src="https://cdn.tailwindcss.com"></script><link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet"></head>
<body class="bg-gray-100 min-h-screen py-8 px-4">
<div class="max-w-3xl mx-auto">
  <div class="bg-white rounded-2xl shadow-xl overflow-hidden print:shadow-none">
    <div class="bg-gradient-to-r from-sky-500 to-blue-600 text-white p-8">
      <div class="flex justify-between items-start">
        <div><div class="flex items-center gap-3 mb-3"><div class="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center"><i class="fas fa-home text-white text-lg"></i></div><div><h1 class="text-xl font-bold">Roof Manager</h1><p class="text-blue-200 text-xs">Professional Roof Measurement Reports</p></div></div><p class="text-blue-200 text-sm">Alberta, Canada</p></div>
        <div class="text-right"><p class="text-2xl font-bold">${docLabel}</p><p class="text-blue-200 text-sm">${invProposal.invoice_number}</p><p class="text-blue-200 text-xs mt-1">${invProposal.issue_date ? new Date(invProposal.issue_date).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }) : ''}</p></div>
      </div>
    </div>
    <div class="p-8">
      <div class="grid grid-cols-2 gap-6 mb-8">
        <div><h3 class="text-xs font-bold text-gray-400 uppercase mb-2">Bill To</h3><p class="font-semibold text-gray-800">${invProposal.customer_name || ''}</p><p class="text-sm text-gray-500">${invProposal.company_name || ''}</p><p class="text-sm text-gray-500">${invProposal.customer_email || ''}</p></div>
        <div class="text-right"><h3 class="text-xs font-bold text-gray-400 uppercase mb-2">${docLabel} Details</h3><p class="text-sm text-gray-600"><strong>Status:</strong> <span class="px-2 py-0.5 rounded-full text-xs font-bold ${invProposal.status === 'paid' ? 'bg-green-100 text-green-700' : invProposal.status === 'sent' || invProposal.status === 'viewed' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}">${(invProposal.status || 'draft').toUpperCase()}</span></p>${invProposal.due_date ? `<p class="text-sm text-gray-600 mt-1"><strong>Due:</strong> ${new Date(invProposal.due_date).toLocaleDateString('en-CA')}</p>` : ''}${invProposal.valid_until ? `<p class="text-sm text-gray-600 mt-1"><strong>Valid Until:</strong> ${invProposal.valid_until}</p>` : ''}</div>
      </div>
      ${invProposal.scope_of_work ? `<div class="mb-8 bg-gray-50 rounded-xl p-6"><h3 class="text-sm font-bold text-gray-700 mb-2"><i class="fas fa-clipboard-list mr-1 text-blue-500"></i>Scope of Work</h3><div class="text-sm text-gray-600 whitespace-pre-wrap">${invProposal.scope_of_work}</div></div>` : ''}
      ${reportLink ? `<div class="mb-6">${reportLink}</div>` : ''}
      <div class="mb-8">${itemsHtml}</div>
      <div class="flex justify-end"><div class="w-72 space-y-2">
        <div class="flex justify-between text-sm"><span class="text-gray-500">Subtotal</span><span class="font-medium">$${Number(invProposal.subtotal).toFixed(2)} CAD</span></div>
        ${invProposal.discount_amount > 0 ? `<div class="flex justify-between text-sm"><span class="text-gray-500">Discount</span><span class="text-green-600">-$${Number(invProposal.discount_amount).toFixed(2)}</span></div>` : ''}
        <div class="flex justify-between text-sm"><span class="text-gray-500">Tax (${invProposal.tax_rate || 5}%)</span><span>$${Number(invProposal.tax_amount).toFixed(2)}</span></div>
        <div class="flex justify-between text-lg font-bold border-t-2 border-gray-200 pt-2 mt-2"><span>Total</span><span class="text-blue-600">$${Number(invProposal.total).toFixed(2)} CAD</span></div>
      </div></div>
      ${invProposal.square_payment_link_url ? `<div class="mt-6 text-center"><a href="${invProposal.square_payment_link_url}" target="_blank" rel="noopener" class="inline-flex items-center gap-2 px-8 py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl text-lg shadow-lg transition-all hover:scale-105"><i class="fas fa-credit-card"></i>Pay Now</a><p class="text-xs text-gray-400 mt-2">Secure online payment powered by Square</p></div>` : ''}
      ${invProposal.warranty_terms ? `<div class="mt-8 bg-amber-50 rounded-xl p-6 border border-amber-100"><h3 class="text-sm font-bold text-amber-800 mb-2"><i class="fas fa-shield-alt mr-1"></i>Warranty</h3><p class="text-sm text-amber-700 whitespace-pre-wrap">${invProposal.warranty_terms}</p></div>` : ''}
      ${invProposal.terms ? `<div class="mt-4 bg-gray-50 rounded-xl p-6"><h3 class="text-sm font-bold text-gray-700 mb-2"><i class="fas fa-file-contract mr-1"></i>Terms & Conditions</h3><p class="text-sm text-gray-600 whitespace-pre-wrap">${invProposal.terms}</p></div>` : ''}
      ${invProposal.payment_terms_text ? `<div class="mt-4 bg-green-50 rounded-xl p-6 border border-green-100"><h3 class="text-sm font-bold text-green-800 mb-2"><i class="fas fa-credit-card mr-1"></i>Payment Terms</h3><p class="text-sm text-green-700 whitespace-pre-wrap">${invProposal.payment_terms_text}</p></div>` : ''}
    </div>
    <div class="bg-gray-50 px-8 py-4 text-center text-xs text-gray-400 border-t">Powered by <a href="https://roofmanager.ca" class="text-blue-500 hover:underline">Roof Manager</a> — Canada's AI Roof Measurement Platform</div>
  </div>
  <div class="text-center mt-4 print:hidden"><button onclick="window.print()" class="px-6 py-2.5 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm"><i class="fas fa-print mr-1"></i>Print / Save PDF</button></div>
</div>
<script>if(new URLSearchParams(location.search).get('print')==='1')setTimeout(function(){window.print()},600)</script>
</body></html>`)
      }

      return c.html(`<!DOCTYPE html><html><head><title>Proposal Not Found</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-gray-50 min-h-screen flex items-center justify-center"><div class="text-center"><div class="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><svg class="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg></div><h1 class="text-2xl font-bold text-gray-800 mb-2">Proposal Not Found</h1><p class="text-gray-500">This proposal link is invalid or has expired.</p></div></body></html>`)
    }

    // Increment view count & log the view
    await c.env.DB.prepare(`
      UPDATE crm_proposals SET view_count = COALESCE(view_count, 0) + 1, last_viewed_at = datetime('now'), status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END WHERE id = ?
    `).bind(proposal.id).run()

    // Track proposal view in GA4
    trackProposalViewed(c.env as any, String(proposal.id), {
      proposal_number: proposal.proposal_number || '',
      owner_id: String(proposal.owner_id || ''),
      total_amount: parseFloat(proposal.total_amount) || 0
    }).catch(() => {})

    // Log view details
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown'
    const ua = c.req.header('user-agent') || ''
    const ref = c.req.header('referer') || ''
    await c.env.DB.prepare(
      'INSERT INTO proposal_view_log (proposal_id, ip_address, user_agent, referrer) VALUES (?, ?, ?, ?)'
    ).bind(proposal.id, ip, ua.substring(0, 500), ref.substring(0, 500)).run()

    // Get owner (business) info for branding
    const owner = await c.env.DB.prepare(
      'SELECT name, email, phone, brand_business_name, brand_logo_url, brand_primary_color, brand_secondary_color, brand_tagline, brand_phone, brand_email, brand_website, brand_address, brand_license_number, brand_insurance_info FROM customers WHERE id = ?'
    ).bind(proposal.owner_id).first<any>()

    // Get line items
    const itemsResult = await c.env.DB.prepare('SELECT * FROM crm_proposal_items WHERE proposal_id = ? ORDER BY sort_order').bind(proposal.id).all()
    const lineItems = itemsResult.results || []

    const businessName = owner?.brand_business_name || owner?.name || 'Roof Manager'
    const primaryColor = owner?.brand_primary_color || '#0369a1'
    const secondaryColor = owner?.brand_secondary_color || '#0ea5e9'
    const brandPhone = owner?.brand_phone || owner?.phone || ''
    const brandEmail = owner?.brand_email || owner?.email || ''
    const brandWebsite = owner?.brand_website || ''
    const brandAddress = owner?.brand_address || ''
    const brandLicense = owner?.brand_license_number || ''
    const brandInsurance = owner?.brand_insurance_info || ''
    const brandTagline = owner?.brand_tagline || ''
    const logoUrl = owner?.brand_logo_url || ''
    const fullAddress = [proposal.property_address, proposal.customer_city, proposal.customer_province, proposal.customer_postal].filter(Boolean).join(', ')

    const isAccepted = proposal.status === 'accepted'
    const isDeclined = proposal.status === 'declined'
    const isResponded = isAccepted || isDeclined
    const proposalDate = proposal.created_at ? new Date(proposal.created_at).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }) : ''
    const validUntil = proposal.valid_until ? new Date(proposal.valid_until).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }) : ''

    // Build line items HTML
    let itemsHtml = ''
    if (lineItems.length > 0) {
      itemsHtml = `<div class="overflow-x-auto"><table class="w-full text-sm">
        <thead><tr class="border-b-2 border-gray-200">
          <th class="text-left py-3 px-2 font-semibold text-gray-600">Description</th>
          <th class="text-center py-3 px-2 font-semibold text-gray-600">Qty</th>
          <th class="text-center py-3 px-2 font-semibold text-gray-600">Unit</th>
          <th class="text-right py-3 px-2 font-semibold text-gray-600">Unit Price</th>
          <th class="text-right py-3 px-2 font-semibold text-gray-600">Amount</th>
        </tr></thead><tbody>`
      for (const item of lineItems) {
        const it = item as any
        itemsHtml += `<tr class="border-b border-gray-100">
          <td class="py-3 px-2 text-gray-800">${it.description}</td>
          <td class="py-3 px-2 text-center text-gray-600">${it.quantity}</td>
          <td class="py-3 px-2 text-center text-gray-500">${it.unit || 'ea'}</td>
          <td class="py-3 px-2 text-right text-gray-700">$${parseFloat(it.unit_price).toFixed(2)}</td>
          <td class="py-3 px-2 text-right font-medium text-gray-800">$${parseFloat(it.amount).toFixed(2)}</td>
        </tr>`
      }
      itemsHtml += '</tbody></table></div>'
    } else {
      // Legacy: show labor/material/other
      itemsHtml = '<div class="space-y-2">'
      if (proposal.labor_cost > 0) itemsHtml += `<div class="flex justify-between text-sm"><span class="text-gray-600">Labor</span><span class="font-semibold text-gray-800">$${parseFloat(proposal.labor_cost).toFixed(2)}</span></div>`
      if (proposal.material_cost > 0) itemsHtml += `<div class="flex justify-between text-sm"><span class="text-gray-600">Materials</span><span class="font-semibold text-gray-800">$${parseFloat(proposal.material_cost).toFixed(2)}</span></div>`
      if (proposal.other_cost > 0) itemsHtml += `<div class="flex justify-between text-sm"><span class="text-gray-600">Other</span><span class="font-semibold text-gray-800">$${parseFloat(proposal.other_cost).toFixed(2)}</span></div>`
      itemsHtml += '</div>'
    }

    return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${proposal.title} — ${businessName}</title>
  <meta property="og:title" content="${proposal.title} — $${Number(proposal.total_amount || 0).toFixed(2)}">
  <meta property="og:description" content="Professional roofing proposal from ${businessName}. ${fullAddress ? 'Property: ' + fullAddress : ''}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${businessName}">
  <meta name="twitter:card" content="summary">
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <style>
    @media print { .no-print { display: none !important; } body { background: white; } }
    .brand-gradient { background: linear-gradient(135deg, ${primaryColor}, ${secondaryColor}); }
    .brand-text { color: ${primaryColor}; }
    .brand-bg { background-color: ${primaryColor}; }
    .brand-bg-hover:hover { background-color: ${secondaryColor}; }
    .signature-pad { border: 2px dashed #d1d5db; border-radius: 12px; height: 100px; cursor: crosshair; touch-action: none; }
    .signature-pad.active { border-color: ${primaryColor}; }
  </style>
</head>
<body class="bg-gray-100 min-h-screen">
  <!-- Print / Download bar -->
  <div class="no-print fixed top-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-sm border-b border-gray-200">
    <div class="max-w-4xl mx-auto px-4 py-2 flex items-center justify-between">
      <span class="text-sm text-gray-500"><i class="fas fa-file-signature mr-1"></i>${proposal.proposal_number}</span>
      <div class="flex gap-2">
        <button onclick="window.print()" class="px-3 py-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700"><i class="fas fa-print mr-1"></i>Print</button>
      </div>
    </div>
  </div>

  <div class="max-w-4xl mx-auto px-4 pt-16 pb-12">
    <!-- Company Header -->
    <div class="brand-gradient rounded-t-2xl px-8 py-8 text-white relative overflow-hidden">
      <div class="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-32 translate-x-32"></div>
      <div class="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-24 -translate-x-24"></div>
      <div class="relative z-10 flex items-start justify-between">
        <div>
          ${logoUrl ? `<img src="${logoUrl}" alt="${businessName}" class="h-14 mb-3 rounded-lg bg-white/20 p-1">` : ''}
          <h1 class="text-2xl md:text-3xl font-bold tracking-tight">${businessName}</h1>
          ${brandTagline ? `<p class="text-white/70 text-sm mt-1">${brandTagline}</p>` : ''}
        </div>
        <div class="text-right text-sm space-y-0.5 text-white/80">
          ${brandPhone ? `<p><i class="fas fa-phone mr-1.5"></i>${brandPhone}</p>` : ''}
          ${brandEmail ? `<p><i class="fas fa-envelope mr-1.5"></i>${brandEmail}</p>` : ''}
          ${brandWebsite ? `<p><i class="fas fa-globe mr-1.5"></i>${brandWebsite}</p>` : ''}
          ${brandAddress ? `<p class="mt-2 text-white/60"><i class="fas fa-map-marker-alt mr-1.5"></i>${brandAddress}</p>` : ''}
        </div>
      </div>
    </div>

    <!-- Main Body -->
    <div class="bg-white shadow-2xl rounded-b-2xl">
      <!-- Proposal Meta -->
      <div class="px-8 py-6 border-b border-gray-100 bg-gray-50/50">
        <div class="flex flex-col md:flex-row justify-between gap-4">
          <div>
            <p class="text-xs uppercase tracking-widest text-gray-400 font-semibold mb-1">Proposal For</p>
            <p class="text-xl font-bold text-gray-800">${proposal.customer_name || 'Customer'}</p>
            ${fullAddress ? `<p class="text-sm text-gray-500 mt-1"><i class="fas fa-map-marker-alt mr-1 text-red-400"></i>${fullAddress}</p>` : ''}
            ${proposal.customer_phone ? `<p class="text-sm text-gray-500"><i class="fas fa-phone mr-1 text-gray-400"></i>${proposal.customer_phone}</p>` : ''}
            ${proposal.customer_email ? `<p class="text-sm text-gray-500"><i class="fas fa-envelope mr-1 text-gray-400"></i>${proposal.customer_email}</p>` : ''}
          </div>
          <div class="text-right space-y-1">
            <div class="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${isAccepted ? 'bg-green-100 text-green-700' : isDeclined ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}">${isAccepted ? 'Accepted' : isDeclined ? 'Declined' : proposal.status === 'viewed' ? 'Under Review' : 'Proposal'}</div>
            <p class="text-sm text-gray-500"><span class="font-semibold text-gray-700">${proposal.proposal_number}</span></p>
            ${proposalDate ? `<p class="text-xs text-gray-400">Issued: ${proposalDate}</p>` : ''}
            ${validUntil ? `<p class="text-xs text-gray-400">Valid Until: ${validUntil}</p>` : ''}
          </div>
        </div>
      </div>

      <!-- Project Title -->
      <div class="px-8 py-5 border-b border-gray-100">
        <h2 class="text-xl font-bold text-gray-800"><i class="fas fa-hard-hat mr-2 brand-text"></i>${proposal.title}</h2>
      </div>

      <!-- Scope of Work -->
      ${proposal.scope_of_work ? `
      <div class="px-8 py-5 border-b border-gray-100">
        <h3 class="text-sm font-bold uppercase tracking-widest text-gray-400 mb-3"><i class="fas fa-clipboard-list mr-1.5"></i>Scope of Work</h3>
        <p class="text-gray-700 leading-relaxed whitespace-pre-line">${proposal.scope_of_work}</p>
      </div>` : ''}

      <!-- Materials Detail -->
      ${proposal.materials_detail ? `
      <div class="px-8 py-5 border-b border-gray-100">
        <h3 class="text-sm font-bold uppercase tracking-widest text-gray-400 mb-3"><i class="fas fa-boxes-stacked mr-1.5"></i>Materials</h3>
        <p class="text-gray-700 leading-relaxed whitespace-pre-line">${proposal.materials_detail}</p>
      </div>` : ''}

      <!-- Pricing / Line Items -->
      <div class="px-8 py-6 border-b border-gray-100">
        <h3 class="text-sm font-bold uppercase tracking-widest text-gray-400 mb-4"><i class="fas fa-dollar-sign mr-1.5"></i>Pricing</h3>
        ${itemsHtml}
        
        <!-- Totals -->
        <div class="mt-4 pt-4 border-t border-gray-200 flex justify-end">
          <div class="w-full max-w-xs space-y-1.5">
            ${proposal.subtotal ? `<div class="flex justify-between text-sm"><span class="text-gray-500">Subtotal</span><span class="text-gray-700 font-medium">$${parseFloat(proposal.subtotal).toFixed(2)}</span></div>` : ''}
            ${proposal.tax_amount && proposal.tax_amount > 0 ? `<div class="flex justify-between text-sm"><span class="text-gray-500">Tax (${proposal.tax_rate || 5}% GST)</span><span class="text-gray-700 font-medium">$${parseFloat(proposal.tax_amount).toFixed(2)}</span></div>` : ''}
            <div class="flex justify-between text-lg pt-2 border-t-2 border-gray-300">
              <span class="font-bold brand-text">Total</span>
              <span class="font-black brand-text">$${parseFloat(proposal.total_amount).toFixed(2)} CAD</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Warranty Terms -->
      ${proposal.warranty_terms ? `
      <div class="px-8 py-5 border-b border-gray-100">
        <h3 class="text-sm font-bold uppercase tracking-widest text-gray-400 mb-3"><i class="fas fa-shield-halved mr-1.5"></i>Warranty</h3>
        <p class="text-gray-700 leading-relaxed whitespace-pre-line">${proposal.warranty_terms}</p>
      </div>` : ''}

      <!-- Payment Terms -->
      ${proposal.payment_terms ? `
      <div class="px-8 py-5 border-b border-gray-100">
        <h3 class="text-sm font-bold uppercase tracking-widest text-gray-400 mb-3"><i class="fas fa-credit-card mr-1.5"></i>Payment Terms</h3>
        <p class="text-gray-700 leading-relaxed whitespace-pre-line">${proposal.payment_terms}</p>
      </div>` : ''}

      <!-- Notes -->
      ${proposal.notes ? `
      <div class="px-8 py-5 border-b border-gray-100">
        <h3 class="text-sm font-bold uppercase tracking-widest text-gray-400 mb-3"><i class="fas fa-sticky-note mr-1.5"></i>Additional Notes</h3>
        <p class="text-gray-600 text-sm leading-relaxed whitespace-pre-line">${proposal.notes}</p>
      </div>` : ''}

      <!-- Pay Now -->
      ${proposal.payment_link ? `
      <div class="px-8 py-6 border-b border-gray-100 text-center no-print">
        <a href="${proposal.payment_link}" target="_blank" rel="noopener" class="inline-flex items-center gap-2 px-8 py-4 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl text-lg shadow-lg transition-all hover:scale-105">
          <i class="fas fa-credit-card"></i>Pay Now
        </a>
        <p class="text-xs text-gray-400 mt-2">Secure online payment powered by Square</p>
      </div>` : ''}

      <!-- Valid Until Banner -->
      ${validUntil && !isResponded ? `
      <div class="mx-8 my-5 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 text-sm text-amber-700 flex items-center">
        <i class="fas fa-clock mr-2 text-amber-500"></i>
        This proposal is valid until <strong class="ml-1">${validUntil}</strong>
      </div>` : ''}

      <!-- Accept / Decline Actions -->
      ${!isResponded ? `
      <div class="px-8 py-8 no-print" id="actionSection">
        <div class="bg-gray-50 rounded-2xl p-6 border border-gray-200">
          <h3 class="text-center text-lg font-bold text-gray-800 mb-2">Ready to proceed?</h3>
          <p class="text-center text-sm text-gray-500 mb-6">Accept this proposal to get your roofing project started</p>
          
          <!-- Signature Pad -->
          <div class="mb-4">
            <label class="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Your Signature <span class="text-red-400">*</span></label>
            <canvas id="signaturePad" class="signature-pad w-full bg-white" width="600" height="100"></canvas>
            <div class="flex justify-between mt-1">
              <span id="sigError" class="text-xs text-red-500 hidden">Please sign above before accepting</span>
              <button onclick="clearSignature()" class="text-xs text-gray-400 hover:text-gray-600 ml-auto"><i class="fas fa-eraser mr-1"></i>Clear</button>
            </div>
          </div>

          <!-- Printed Name + Date -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
            <div>
              <label class="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Print Your Full Name <span class="text-red-400">*</span></label>
              <input type="text" id="sigPrintedName" placeholder="e.g. John Smith" class="w-full px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-400 focus:border-blue-400">
            </div>
            <div>
              <label class="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Date</label>
              <input type="text" id="sigDate" value="${new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}" readonly class="w-full px-3 py-2.5 bg-gray-100 border border-gray-200 rounded-xl text-sm text-gray-600">
            </div>
          </div>

          <div class="flex gap-3">
            <button onclick="respondProposal('accept')" class="flex-1 brand-bg brand-bg-hover text-white py-3.5 rounded-xl font-bold text-sm transition-all hover:shadow-lg">
              <i class="fas fa-check-circle mr-2"></i>Accept &amp; Sign Proposal
            </button>
            <button onclick="respondProposal('decline')" class="px-6 py-3.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-xl font-semibold text-sm transition-all">
              Decline
            </button>
          </div>
        </div>
      </div>` : `
      <div class="px-8 py-8">
        <div class="rounded-2xl p-6 text-center ${isAccepted ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}">
          <div class="w-16 h-16 mx-auto mb-3 rounded-full flex items-center justify-center ${isAccepted ? 'bg-green-100' : 'bg-red-100'}">
            <i class="fas ${isAccepted ? 'fa-check-circle text-green-600' : 'fa-times-circle text-red-600'} text-2xl"></i>
          </div>
          <h3 class="text-lg font-bold ${isAccepted ? 'text-green-800' : 'text-red-800'}">Proposal ${isAccepted ? 'Accepted' : 'Declined'}</h3>
          <p class="text-sm ${isAccepted ? 'text-green-600' : 'text-red-600'} mt-1">${isAccepted ? (proposal.accepted_at ? 'on ' + new Date(proposal.accepted_at).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }) : '') : (proposal.declined_at ? 'on ' + new Date(proposal.declined_at).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }) : '')}</p>
          ${proposal.customer_signature ? `<div class="mt-4"><p class="text-xs text-gray-400 mb-1">Signature</p><img src="${proposal.customer_signature}" alt="Signature" class="max-h-16 mx-auto"></div>` : ''}
        </div>
      </div>`}

      <!-- License & Insurance -->
      ${brandLicense || brandInsurance ? `
      <div class="px-8 py-4 bg-gray-50/50 text-xs text-gray-400 space-y-0.5">
        ${brandLicense ? `<p><i class="fas fa-id-card mr-1"></i>License: ${brandLicense}</p>` : ''}
        ${brandInsurance ? `<p><i class="fas fa-shield-alt mr-1"></i>${brandInsurance}</p>` : ''}
      </div>` : ''}
    </div>

    <!-- Footer -->
    <div class="text-center mt-6 text-xs text-gray-400 space-y-1">
      <p>Powered by <span class="font-semibold">Roof Manager</span></p>
    </div>
  </div>

  <script>
    // Signature pad
    var canvas = document.getElementById('signaturePad');
    var ctx = canvas ? canvas.getContext('2d') : null;
    var drawing = false;
    var hasSignature = false;

    if (canvas && ctx) {
      canvas.width = canvas.offsetWidth * 2;
      canvas.height = 200;
      ctx.scale(2, 2);
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      function getPos(e) {
        var rect = canvas.getBoundingClientRect();
        var x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
        var y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
        return { x: x, y: y };
      }

      canvas.addEventListener('mousedown', function(e) { drawing = true; ctx.beginPath(); var p = getPos(e); ctx.moveTo(p.x, p.y); canvas.classList.add('active'); });
      canvas.addEventListener('mousemove', function(e) { if (!drawing) return; var p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); hasSignature = true; });
      canvas.addEventListener('mouseup', function() { drawing = false; canvas.classList.remove('active'); });
      canvas.addEventListener('mouseleave', function() { drawing = false; canvas.classList.remove('active'); });
      canvas.addEventListener('touchstart', function(e) { e.preventDefault(); drawing = true; ctx.beginPath(); var p = getPos(e); ctx.moveTo(p.x, p.y); canvas.classList.add('active'); });
      canvas.addEventListener('touchmove', function(e) { e.preventDefault(); if (!drawing) return; var p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); hasSignature = true; });
      canvas.addEventListener('touchend', function() { drawing = false; canvas.classList.remove('active'); });
    }

    function clearSignature() {
      if (ctx && canvas) { ctx.clearRect(0, 0, canvas.width, canvas.height); hasSignature = false; }
    }

    function respondProposal(action) {
      // Validate signature + name for acceptance
      if (action === 'accept') {
        if (!hasSignature) {
          var sigErr = document.getElementById('sigError');
          if (sigErr) sigErr.classList.remove('hidden');
          alert('Please sign above before accepting the proposal.');
          return;
        }
        var printedName = document.getElementById('sigPrintedName');
        if (!printedName || !printedName.value.trim()) {
          alert('Please print your full name before accepting.');
          if (printedName) printedName.focus();
          return;
        }
      }

      var confirmMsg = action === 'accept'
        ? 'Are you sure you want to accept and sign this proposal?'
        : 'Are you sure you want to decline this proposal?';
      if (!confirm(confirmMsg)) return;

      var signature = null;
      if (hasSignature && canvas) {
        try { signature = canvas.toDataURL('image/png'); } catch(e) {}
      }
      var sigName = document.getElementById('sigPrintedName')?.value?.trim() || '';
      var sigDate = document.getElementById('sigDate')?.value || '';

      var btn = event.target;
      btn.disabled = true;
      btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Processing...';

      fetch('/api/crm/proposals/respond/${token}', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: action, signature: signature, printed_name: sigName, signed_date: sigDate })
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) {
          location.reload();
        } else {
          alert(data.error || 'Something went wrong. Please try again.');
          btn.disabled = false;
          btn.innerHTML = action === 'accept'
            ? '<i class="fas fa-check-circle mr-2"></i>Accept Proposal'
            : 'Decline';
        }
      })
      .catch(function() {
        alert('Network error. Please check your connection and try again.');
        btn.disabled = false;
        btn.innerHTML = action === 'accept'
          ? '<i class="fas fa-check-circle mr-2"></i>Accept Proposal'
          : 'Decline';
      });
    }
  </script>
</body>
</html>`)
  } catch (err: any) {
    console.error('[Proposal View] Error:', err.message)
    return c.html(`<!DOCTYPE html><html><head><title>Error</title><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-gray-50 min-h-screen flex items-center justify-center"><div class="text-center"><h1 class="text-xl font-bold text-red-600">Error Loading Proposal</h1><p class="text-gray-500 mt-2">Please try refreshing the page.</p></div></body></html>`, 500)
  }
})
app.get('/customer/d2d', (c) => {
  const mapsKey = c.env.GOOGLE_MAPS_API_KEY || ''
  return c.html(getD2DPageHTML(mapsKey))
})

// Roofer Secretary — AI Phone Answering Service
app.get('/customer/secretary', (c) => {
  const stripeKey = '' // No longer needed — Square uses server-side only
  return c.html(getSecretaryPageHTML())
})

// Model Cards — Public reference pages for AI models
app.get('/model-card/gemma-3', (c) => {
  return c.html(getGemma3ModelCardHTML())
})

// ============================================================
// PUBLIC WEBSITE BUILDER SITES — Serve published contractor sites
// ============================================================
// Custom domain support — serve builder sites on contractor's own domain
app.use('*', async (c, next) => {
  const host = (c.req.header('host') || '').replace(/:\d+$/, '')
  if (!host || host.includes('roofmanager.ca') || host.includes('localhost') || host.includes('0.0.0.0') || host.includes('pages.dev') || host.includes('workers.dev')) {
    return next()
  }
  const site = await c.env.DB.prepare(
    "SELECT id, subdomain FROM wb_sites WHERE custom_domain = ? AND status = 'published'"
  ).bind(host).first<any>()
  if (!site) return next()

  const url = new URL(c.req.url)
  const slug = url.pathname === '/' ? '/' : url.pathname
  const page = await c.env.DB.prepare(
    'SELECT html_snapshot FROM wb_pages WHERE site_id = ? AND slug = ? AND is_published = 1'
  ).bind(site.id, slug).first<any>()
  if (!page?.html_snapshot) return c.notFound()

  // Rewrite basePath links for custom domain (root-relative instead of /sites/subdomain)
  const escapedSubdomain = site.subdomain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const html = page.html_snapshot.replace(new RegExp(`/sites/${escapedSubdomain}`, 'g'), '')
  return c.html(html)
})

app.get('/sites/:subdomain', async (c) => {
  const subdomain = c.req.param('subdomain')
  const site = await c.env.DB.prepare(
    "SELECT id FROM wb_sites WHERE subdomain = ? AND status = 'published'"
  ).bind(subdomain).first<any>()
  if (!site) return c.notFound()

  const page = await c.env.DB.prepare(
    "SELECT html_snapshot FROM wb_pages WHERE site_id = ? AND slug = '/' AND is_published = 1"
  ).bind(site.id).first<any>()
  if (!page?.html_snapshot) return c.notFound()

  return c.html(page.html_snapshot)
})

app.get('/sites/:subdomain/:slug', async (c) => {
  const subdomain = c.req.param('subdomain')
  const slug = '/' + c.req.param('slug')
  const site = await c.env.DB.prepare(
    "SELECT id FROM wb_sites WHERE subdomain = ? AND status = 'published'"
  ).bind(subdomain).first<any>()
  if (!site) return c.notFound()

  const page = await c.env.DB.prepare(
    'SELECT html_snapshot FROM wb_pages WHERE site_id = ? AND slug = ? AND is_published = 1'
  ).bind(site.id, slug).first<any>()
  if (!page?.html_snapshot) return c.notFound()

  return c.html(page.html_snapshot)
})

export default app

// ============================================================
// HTML Templates
// ============================================================

function getTailwindConfig() {
  return `<script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            brand: { 50:'#f0f9ff',100:'#e0f2fe',200:'#bae6fd',300:'#7dd3fc',400:'#38bdf8',500:'#0ea5e9',600:'#0284c7',700:'#0369a1',800:'#075985',900:'#0c4a6e' },
            accent: { 50:'#eff6ff',100:'#dbeafe',200:'#bfdbfe',300:'#93c5fd',400:'#60a5fa',500:'#3b82f6',600:'#2563eb',700:'#1d4ed8',800:'#1e40af',900:'#1e3a8a' }
          },
          animation: {
            'fade-in-up': 'fadeInUp 0.6s ease-out forwards',
            'fade-in': 'fadeIn 0.5s ease-out forwards',
          },
          keyframes: {
            fadeInUp: {
              '0%': { opacity: 0, transform: 'translateY(20px)' },
              '100%': { opacity: 1, transform: 'translateY(0)' }
            },
            fadeIn: {
              '0%': { opacity: 0 },
              '100%': { opacity: 1 }
            }
          }
        }
      }
    }
  </script>`
}

function getHeadTags() {
  return `<meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="google-site-verification" content="CvzH14V1vTrop4cCx2z90ZUFnt4GJJNr1KkgiywoO2g" />
  <meta name="theme-color" content="#0369a1">
  <meta name="geo.region" content="CA-AB">
  <meta name="geo.placename" content="Alberta, Canada">
  <link rel="preconnect" href="https://cdn.tailwindcss.com" crossorigin>
  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
  <link rel="apple-touch-icon" href="/static/logo.png">
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  ${getTailwindConfig()}
  <link rel="icon" type="image/svg+xml" href="/static/favicon.svg">
  <link rel="stylesheet" href="/static/style.css">
  <style>#google_translate_element{position:fixed;bottom:20px;left:20px;z-index:9998;background:white;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,0.15);padding:8px 12px;border:1px solid #e2e8f0;font-size:13px}.goog-te-gadget{font-family:inherit!important}.goog-te-gadget-simple{background:transparent!important;border:none!important;padding:0!important;font-size:13px!important}.goog-te-menu-value span{color:#374151!important}.goog-te-banner-frame{display:none!important}body{top:0!important}@media(max-width:480px){#google_translate_element{bottom:70px;left:10px;transform:scale(0.85);transform-origin:bottom left}}</style>
  <div id="google_translate_element"></div>
  <script>function googleTranslateElementInit(){new google.translate.TranslateElement({pageLanguage:'en',includedLanguages:'en,fr,es,de,pt,it,zh-CN,zh-TW,ja,ko,ar,hi,bn,ur,tr,vi,th,id,pl,uk,ru,nl,sv,da,no,fi,el,he,ro,cs,hu,ms,tl',layout:google.translate.TranslateElement.InlineLayout.SIMPLE,autoDisplay:false},'google_translate_element')}</script>
  <script src="//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit" defer></script>`
}

// Rover chatbot widget script tag — inject on public pages only
function getRoverWidget() {
  return `<script src="/static/rover-widget.js" defer></script>`
}

// Rover AI Assistant — inject on authenticated customer pages
function getRoverAssistant() {
  return `<script src="/static/rover-assistant.js?v=${Date.now()}" defer></script>`
}

// ============================================================
// CONTACT US LEAD CAPTURE — Reusable form for all public pages
// ============================================================
function getContactFormHTML(sourcePage: string = 'unknown') {
  return `
  <section id="contact-section" class="py-16 bg-gradient-to-br from-slate-900 via-cyan-900 to-slate-900">
    <div class="max-w-3xl mx-auto px-4">
      <div class="text-center mb-10">
        <span class="inline-block bg-cyan-500/20 text-cyan-300 text-xs font-bold px-3 py-1 rounded-full mb-4">GET IN TOUCH</span>
        <h2 class="text-3xl md:text-4xl font-bold text-white mb-3">Ready to Transform Your Roofing Business?</h2>
        <p class="text-gray-300 max-w-xl mx-auto">Fill out the form below and our team will reach out within 24 hours to get you set up with AI-powered roof measurement reports.</p>
      </div>
      <form id="lead-capture-form" onsubmit="return submitLeadForm(event, '${sourcePage}')" class="bg-white/10 backdrop-blur-lg border border-white/20 rounded-2xl p-8 space-y-5">
        <div class="grid md:grid-cols-2 gap-5">
          <div>
            <label class="block text-sm font-medium text-gray-200 mb-1.5">Full Name <span class="text-red-400">*</span></label>
            <input type="text" id="lead-name" required placeholder="John Smith" class="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-cyan-400 focus:border-transparent outline-none">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-200 mb-1.5">Company Name</label>
            <input type="text" id="lead-company" placeholder="ABC Roofing Ltd." class="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-cyan-400 focus:border-transparent outline-none">
          </div>
        </div>
        <div class="grid md:grid-cols-2 gap-5">
          <div>
            <label class="block text-sm font-medium text-gray-200 mb-1.5">Phone Number</label>
            <input type="tel" id="lead-phone" placeholder="(780) 555-1234" class="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-cyan-400 focus:border-transparent outline-none">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-200 mb-1.5">Email Address <span class="text-red-400">*</span></label>
            <input type="email" id="lead-email" required placeholder="john@abcroofing.com" class="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-cyan-400 focus:border-transparent outline-none">
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-200 mb-1.5">How can we help?</label>
          <textarea id="lead-message" rows="3" placeholder="Tell us about your roofing business and what you're looking for..." class="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-white placeholder-gray-400 focus:ring-2 focus:ring-cyan-400 focus:border-transparent outline-none resize-none"></textarea>
        </div>
        <div id="lead-form-msg" class="hidden text-sm font-medium px-4 py-3 rounded-lg"></div>
        <button type="submit" id="lead-submit-btn" class="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white font-bold py-4 px-8 rounded-xl shadow-lg transition-all hover:scale-[1.01] text-lg">
          <i class="fas fa-paper-plane mr-2"></i>Get Started — It's Free
        </button>
        <div class="text-center my-3"><span class="text-gray-500 text-xs">— or —</span></div>
        <a href="https://calendar.app.google/CE5iBMV1Fu4K2ve38" target="_blank" class="block w-full bg-white/10 hover:bg-white/20 text-white font-bold py-4 px-8 rounded-xl text-center text-lg transition-all border border-white/20">
          <i class="fas fa-calendar-check mr-2"></i>Book a 30-Min Demo Meeting
        </a>
        <p class="text-center text-gray-400 text-xs mt-3">No credit card required. 3 free reports included.</p>
      </form>
    </div>
  </section>
  <script>
  async function submitLeadForm(e, source) {
    e.preventDefault();
    var btn = document.getElementById('lead-submit-btn');
    var msg = document.getElementById('lead-form-msg');
    btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Submitting...';
    msg.className = 'hidden';
    try {
      var res = await fetch('/api/agents/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: document.getElementById('lead-name').value.trim(),
          company_name: document.getElementById('lead-company').value.trim(),
          phone: document.getElementById('lead-phone').value.trim(),
          email: document.getElementById('lead-email').value.trim(),
          source_page: source,
          message: document.getElementById('lead-message').value.trim()
        })
      });
      var data = await res.json();
      if (data.success) {
        msg.className = 'text-sm font-medium px-4 py-3 rounded-lg bg-green-500/20 text-green-300 border border-green-500/30';
        msg.innerHTML = '<i class="fas fa-check-circle mr-2"></i>Thank you! We\\'ll be in touch within 24 hours.';
        document.getElementById('lead-capture-form').reset();
      } else {
        msg.className = 'text-sm font-medium px-4 py-3 rounded-lg bg-red-500/20 text-red-300 border border-red-500/30';
        msg.innerHTML = '<i class="fas fa-exclamation-circle mr-2"></i>' + (data.error || 'Something went wrong');
      }
    } catch(err) {
      msg.className = 'text-sm font-medium px-4 py-3 rounded-lg bg-red-500/20 text-red-300 border border-red-500/30';
      msg.innerHTML = '<i class="fas fa-exclamation-circle mr-2"></i>Network error. Please try again.';
    }
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>Get Started — It\\'s Free';
  }
  </script>`
}

function getMainPageHTML(mapsApiKey: string) {
  const mapsScript = mapsApiKey
    ? `<script>
      var googleMapsReady = false;
      function onGoogleMapsReady() {
        googleMapsReady = true;
        console.log('[Maps] Google Maps API loaded successfully');
        if (typeof initMap === 'function' && document.getElementById('map')) {
          initMap();
        }
      }
    </script>
    <script src="https://maps.googleapis.com/maps/api/js?key=${mapsApiKey}&libraries=places&callback=onGoogleMapsReady" async defer></script>`
    : '<!-- Google Maps: No API key configured. -->'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Order a Roof Report - Roof Manager</title>
  ${mapsScript}
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <a href="/" class="flex items-center space-x-3 hover:opacity-90 transition-opacity">
          <img src="/static/logo.png" alt="Roof Manager" class="w-10 h-10 rounded-lg object-cover">
          <div>
            <h1 class="text-xl font-bold">Order a Report</h1>
            <p class="text-brand-200 text-xs">Roof Manager</p>
          </div>
        </a>
      </div>
      <nav class="flex items-center space-x-4">
        <a href="/" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-arrow-left mr-1"></i>Home</a>
        <a href="/admin" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-tachometer-alt mr-1"></i>Admin</a>
      </nav>
    </div>
  </header>
  <main class="max-w-6xl mx-auto px-4 py-8">
    <div id="app-root"></div>
  </main>
  <footer class="bg-gray-800 text-gray-400 text-center py-6 mt-12">
    <p class="text-sm">&copy; 2026 Roof Manager. All rights reserved.</p>
    <p class="text-xs mt-1">Professional Roof Measurement Reports & Business Management CRM</p>
    <div class="flex items-center justify-center gap-4 mt-2 text-xs">
      <a href="/privacy" class="hover:text-gray-200 transition-colors">Privacy Policy</a>
      <a href="/terms" class="hover:text-gray-200 transition-colors">Terms of Service</a>
    </div>
  </footer>
  <script src="/static/app.js?v=${Date.now()}"></script>
</body>
</html>`
}

function getSuperAdminDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Super Admin Dashboard - Roof Manager</title>
  <style>
    .sa-sidebar { transition: width 0.3s ease; }
    .sa-sidebar .label { transition: opacity 0.2s ease; }
    .sa-nav-item { transition: all 0.2s ease; cursor: pointer; }
    .sa-nav-item:hover { background: rgba(255,255,255,0.08); }
    .sa-nav-item.active { background: linear-gradient(135deg, #dc2626, #ef4444); color: white; box-shadow: 0 4px 12px rgba(220,38,38,0.3); }
    .metric-card { transition: all 0.3s ease; }
    .metric-card:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0,0,0,0.1); }
    @keyframes slideIn { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
    .slide-in { animation: slideIn 0.4s ease-out; }
    .sa-kpi { background: linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02)); border: 1px solid rgba(255,255,255,0.1); }
  </style>
</head>
<body class="bg-gray-100 min-h-screen">
  <!-- Super Admin Top Bar -->
  <header class="bg-slate-700 text-white shadow-xl sticky top-0 z-50">
    <div class="max-w-full mx-auto px-6 h-14 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center">
          <i class="fas fa-crown text-white text-sm"></i>
        </div>
        <div class="leading-tight">
          <span class="text-white font-bold text-sm">ROOFREPORTERAI</span>
          <span class="text-gray-400 text-[10px] block -mt-0.5">Super Admin Command Center</span>
        </div>
      </div>
      <div class="flex items-center gap-4">
        <span id="saUserGreeting" class="text-gray-300 text-xs hidden">
          <i class="fas fa-crown mr-1 text-yellow-400"></i><span id="saUserName"></span>
          <span class="ml-1 px-1.5 py-0.5 bg-red-600/30 text-red-300 rounded text-[10px] font-bold">SUPER ADMIN</span>
        </span>
        <a href="/admin" class="text-gray-400 hover:text-white text-xs transition-colors"><i class="fas fa-tachometer-alt mr-1"></i>Ops Panel</a>
        <a href="/" target="_blank" class="text-gray-400 hover:text-white text-xs transition-colors"><i class="fas fa-external-link-alt mr-1"></i>View Site</a>
        <a href="/settings" class="text-gray-400 hover:text-white text-xs transition-colors"><i class="fas fa-cog mr-1"></i>Settings</a>
        <button onclick="saLogout()" class="text-gray-400 hover:text-red-400 text-xs transition-colors"><i class="fas fa-sign-out-alt mr-1"></i>Logout</button>
      </div>
    </div>
  </header>

  <div class="flex min-h-[calc(100vh-56px)]">
    <!-- Sidebar Navigation -->
    <aside class="sa-sidebar w-64 bg-slate-800 border-r border-slate-700 flex-shrink-0">
      <div class="p-4 space-y-1" id="sa-nav">
        <div class="sa-nav-item active rounded-xl px-4 py-3 flex items-center gap-3" onclick="saSetView('users', this)">
          <i class="fas fa-users w-5 text-center"></i>
          <span class="label text-sm font-medium">All Active Users</span>
        </div>
        <div class="sa-nav-item rounded-xl px-4 py-3 flex items-center gap-3 text-gray-400" onclick="saSetView('sales', this)">
          <i class="fas fa-credit-card w-5 text-center"></i>
          <span class="label text-sm font-medium">Credit Pack Sales</span>
        </div>
        <div class="sa-nav-item rounded-xl px-4 py-3 flex items-center gap-3 text-gray-400" onclick="saSetView('orders', this)">
          <i class="fas fa-clipboard-list w-5 text-center"></i>
          <span class="label text-sm font-medium">Order History</span>
        </div>
        <div class="sa-nav-item rounded-xl px-4 py-3 flex items-center gap-3 text-gray-400" onclick="saSetView('signups', this)">
          <i class="fas fa-user-plus w-5 text-center"></i>
          <span class="label text-sm font-medium">New Sign-ups</span>
        </div>
        <div class="sa-nav-item rounded-xl px-4 py-3 flex items-center gap-3 text-gray-400" onclick="saSetView('marketing', this)">
          <i class="fas fa-bullhorn w-5 text-center"></i>
          <span class="label text-sm font-medium">Sales & Marketing</span>
        </div>
        <div class="sa-nav-item rounded-xl px-4 py-3 flex items-center gap-3 text-gray-400" onclick="saSetView('email-outreach', this)">
          <i class="fas fa-envelope-open-text w-5 text-center"></i>
          <span class="label text-sm font-medium">Email Outreach</span>
        </div>
        <div class="sa-nav-item rounded-xl px-4 py-3 flex items-center gap-3 text-gray-400" onclick="saSetView('email-setup', this)">
          <i class="fas fa-cog w-5 text-center"></i>
          <span class="label text-sm font-medium">Email Setup</span>
        </div>
        <div class="sa-nav-item rounded-xl px-4 py-3 flex items-center gap-3 text-gray-400" onclick="saSetView('analytics', this)">
          <i class="fas fa-chart-line w-5 text-center"></i>
          <span class="label text-sm font-medium">Site Analytics</span>
        </div>
        <div class="sa-nav-item rounded-xl px-4 py-3 flex items-center gap-3 text-gray-400" onclick="saSetView('ga4', this)">
          <i class="fab fa-google w-5 text-center"></i>
          <span class="label text-sm font-medium">Google Analytics</span>
        </div>
        <div class="border-t border-gray-800 my-3"></div>
        <div class="sa-nav-item rounded-xl px-4 py-3 flex items-center gap-3 text-gray-400" onclick="saSetView('call-center', this)">
          <i class="fas fa-headset w-5 text-center"></i>
          <span class="label text-sm font-medium">AI Call Center</span>
        </div>
        <div class="sa-nav-item rounded-xl px-4 py-3 flex items-center gap-3 text-gray-400" onclick="saSetView('meta-connect', this)">
          <i class="fab fa-meta w-5 text-center"></i>
          <span class="label text-sm font-medium">Meta Connect</span>
        </div>
        <div class="sa-nav-item rounded-xl px-4 py-3 flex items-center gap-3 text-gray-400" onclick="saSetView('customer-onboarding', this)">
          <i class="fas fa-user-cog w-5 text-center"></i>
          <span class="label text-sm font-medium">Customer Onboarding</span>
        </div>
        <div class="sa-nav-item rounded-xl px-4 py-3 flex items-center gap-3 text-gray-400" onclick="saSetView('secretary-admin', this)">
          <i class="fas fa-phone-volume w-5 text-center"></i>
          <span class="label text-sm font-medium">Roofer Secretary AI</span>
        </div>
        <div class="sa-nav-item rounded-xl px-4 py-3 flex items-center gap-3 text-gray-400" onclick="saSetView('heygen', this)">
          <i class="fas fa-video w-5 text-center"></i>
          <span class="label text-sm font-medium">HeyGen Videos</span>
        </div>
        <div class="sa-nav-item rounded-xl px-4 py-3 flex items-center gap-3 text-gray-400" onclick="saSetView('gemini-command', this)">
          <i class="fas fa-robot w-5 text-center"></i>
          <span class="label text-sm font-medium">Gemini AI Command</span>
        </div>
        <div class="sa-nav-item rounded-xl px-4 py-3 flex items-center gap-3 text-gray-400" onclick="saSetView('pricing', this)">
          <i class="fas fa-dollar-sign w-5 text-center"></i>
          <span class="label text-sm font-medium">Pricing & Billing</span>
        </div>
        <div class="border-t border-gray-800 my-3"></div>
        <a href="/admin" class="sa-nav-item rounded-xl px-4 py-3 flex items-center gap-3 text-gray-400 no-underline">
          <i class="fas fa-tachometer-alt w-5 text-center"></i>
          <span class="label text-sm font-medium">Operations Panel</span>
        </a>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 p-6 overflow-y-auto">
      <div id="sa-root"></div>
    </main>
  </div>

  <script>
    // Auth guard — ONLY superadmin allowed
    (function() {
      const user = localStorage.getItem('rc_user');
      if (!user) { window.location.href = '/login'; return; }
      try {
        const u = JSON.parse(user);
        if (u.role !== 'superadmin') {
          localStorage.removeItem('rc_user');
          localStorage.removeItem('rc_token');
          window.location.href = '/login';
          return;
        }
        const greeting = document.getElementById('saUserGreeting');
        const nameEl = document.getElementById('saUserName');
        if (greeting && nameEl) {
          nameEl.textContent = u.name || u.email;
          greeting.classList.remove('hidden');
        }
      } catch(e) { window.location.href = '/login'; }
    })();
    function saLogout() {
      localStorage.removeItem('rc_user');
      localStorage.removeItem('rc_token');
      window.location.href = '/login';
    }
    function saSetView(v, el) {
      // Update sidebar active state
      document.querySelectorAll('.sa-nav-item').forEach(function(n) {
        n.classList.remove('active');
        n.classList.add('text-gray-400');
      });
      if (el) {
        el.classList.add('active');
        el.classList.remove('text-gray-400');
      }
      // Delegate to JS module
      if (typeof window.saDashboardSetView === 'function') window.saDashboardSetView(v);
    }
  </script>
  <script src="/static/super-admin-dashboard.js?v=${Date.now()}"></script>
  <script src="/static/call-center.js"></script>
  <script src="/static/meta-connect.js"></script>
  <script src="/static/heygen.js"></script>
  <script src="/static/email-outreach.js"></script>
</body>
</html>`
}

function getAdminPageHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Admin Control Panel - Roof Manager</title>
  <style>
    .admin-sidebar { transition: width 0.3s ease; }
    .admin-sidebar .label { transition: opacity 0.2s ease; }
    .tab-active { background: linear-gradient(135deg, #1e40af, #3b82f6); color: white; box-shadow: 0 4px 12px rgba(59,130,246,0.3); }
    .metric-card { transition: all 0.3s ease; }
    .metric-card:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0,0,0,0.1); }
    @keyframes slideIn { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:translateY(0) } }
    .slide-in { animation: slideIn 0.4s ease-out; }
  </style>
</head>
<body class="bg-gray-100 min-h-screen">
  <!-- Admin Top Bar -->
  <header class="bg-slate-700 text-white shadow-xl sticky top-0 z-50">
    <div class="max-w-full mx-auto px-6 h-14 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center">
          <i class="fas fa-shield-alt text-white text-sm"></i>
        </div>
        <div class="leading-tight">
          <span class="text-white font-bold text-sm">ROOFREPORTERAI</span>
          <span class="text-gray-400 text-[10px] block -mt-0.5">Admin Control Panel</span>
        </div>
      </div>
      <div class="flex items-center gap-4">
        <span id="userGreeting" class="text-gray-300 text-xs hidden">
          <i class="fas fa-user-shield mr-1 text-red-400"></i><span id="userName"></span>
          <span class="ml-1 px-1.5 py-0.5 bg-red-600/20 text-red-300 rounded text-[10px] font-bold">ADMIN</span>
        </span>
        <a href="/super-admin" class="text-yellow-400 hover:text-yellow-300 text-xs transition-colors font-semibold"><i class="fas fa-crown mr-1"></i>Super Admin</a>
        <a href="/" class="text-gray-400 hover:text-white text-xs transition-colors"><i class="fas fa-external-link-alt mr-1"></i>View Site</a>
        <a href="/settings" class="text-gray-400 hover:text-white text-xs transition-colors"><i class="fas fa-cog mr-1"></i>Settings</a>
        <button onclick="doLogout()" class="text-gray-400 hover:text-red-400 text-xs transition-colors"><i class="fas fa-sign-out-alt mr-1"></i>Logout</button>
      </div>
    </div>
  </header>

  <div class="max-w-[1600px] mx-auto px-6 py-6">
    <div id="admin-root"></div>
  </div>

  <script>
    // Auth guard — ONLY superadmin allowed
    (function() {
      const user = localStorage.getItem('rc_user');
      if (!user) { window.location.href = '/login'; return; }
      try {
        const u = JSON.parse(user);
        if (u.role !== 'superadmin') {
          localStorage.removeItem('rc_user');
          localStorage.removeItem('rc_token');
          window.location.href = '/login';
          return;
        }
        const greeting = document.getElementById('userGreeting');
        const nameEl = document.getElementById('userName');
        if (greeting && nameEl) {
          nameEl.textContent = u.name || u.email;
          greeting.classList.remove('hidden');
        }
      } catch(e) { window.location.href = '/login'; }
    })();
    function doLogout() {
      localStorage.removeItem('rc_user');
      localStorage.removeItem('rc_token');
      window.location.href = '/login';
    }
  </script>
  <script src="/static/admin.js"></script>
</body>
</html>`
}

function getOrderConfirmationHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Order Confirmation - Roof Measurement Tool</title>
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <img src="/static/logo.png" alt="Roof Manager" class="w-10 h-10 rounded-lg object-cover">
        <div>
          <h1 class="text-xl font-bold">Order Confirmation</h1>
          <p class="text-brand-200 text-xs">Powered by Roof Manager</p>
        </div>
      </div>
      <a href="/" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-arrow-left mr-1"></i>Home</a>
      <a href="/order/new" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-plus mr-1"></i>New Order</a>
    </div>
  </header>
  <main class="max-w-5xl mx-auto px-4 py-8">
    <div id="confirmation-root"></div>
  </main>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js"></script>
  <script src="/static/confirmation.js"></script>
</body>
</html>`
}

function getLoginPageHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Admin Login - Roof Manager</title>
</head>
<body class="bg-gradient-to-br from-sky-100 via-blue-50 to-white min-h-screen flex items-center justify-center">
  <div class="w-full max-w-md mx-auto px-4">
    <!-- Logo -->
    <div class="text-center mb-8">
      <a href="/" class="inline-flex items-center gap-3">
        <img src="/static/logo.png" alt="Roof Manager" class="w-12 h-12 rounded-xl object-cover shadow-lg">
        <div class="text-left">
          <span class="text-gray-800 font-bold text-2xl block">Roof Manager</span>
          <span class="text-gray-500 text-xs">Admin Access - Authorized Personnel Only</span>
        </div>
      </a>
    </div>

    <!-- Admin Login Card -->
    <div class="bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-200">
      <div class="bg-gradient-to-r from-sky-600 to-blue-700 px-8 py-4">
        <div class="flex items-center gap-2">
          <i class="fas fa-lock text-red-400"></i>
          <span class="text-white font-semibold text-sm">Admin Control Panel</span>
        </div>
      </div>

      <div class="p-8">
        <h2 class="text-xl font-bold text-gray-800 mb-1">Administrator Sign In</h2>
        <p class="text-sm text-gray-500 mb-6">This area is restricted to authorized administrators only.</p>

        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Admin Email</label>
            <input type="email" id="loginEmail" placeholder="admin@reusecanada.ca" class="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-colors text-sm">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input type="password" id="loginPassword" placeholder="Enter admin password" class="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-colors text-sm" onkeyup="if(event.key==='Enter')doLogin()">
          </div>
        </div>

        <div id="loginError" class="hidden mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm"></div>

        <button onclick="doLogin()" class="w-full mt-6 py-3 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-xl transition-all hover:scale-[1.02] shadow-lg">
          <i class="fas fa-sign-in-alt mr-2"></i>Access Admin Panel
        </button>
        <div class="text-center mt-3">
          <button onclick="showAdminForgot()" class="text-sm text-sky-600 hover:text-sky-800 hover:underline transition-colors">
            <i class="fas fa-key mr-1"></i>Forgot password?
          </button>
        </div>
      </div>

      <!-- Admin Forgot Password Panel -->
      <div id="adminForgotPanel" class="hidden p-8 pt-0">
        <div class="mb-4 p-3 bg-sky-50 border border-sky-200 rounded-xl">
          <p class="text-sm text-sky-800"><i class="fas fa-info-circle mr-1"></i>Enter your admin email and we'll send a reset link.</p>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Admin Email</label>
          <input type="email" id="adminForgotEmail" placeholder="admin@reusecanada.ca" class="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-sky-500 text-sm" onkeyup="if(event.key==='Enter')doAdminForgot()">
        </div>
        <div id="adminForgotError" class="hidden mt-3 p-3 bg-red-50 text-red-700 rounded-lg text-sm"></div>
        <div id="adminForgotSuccess" class="hidden mt-3 p-3 bg-green-50 text-green-700 rounded-lg text-sm"></div>
        <button onclick="doAdminForgot()" id="adminForgotBtn" class="w-full mt-4 py-3 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-xl transition-all hover:scale-[1.02] shadow-lg">
          <i class="fas fa-paper-plane mr-2"></i>Send Reset Link
        </button>
        <div class="text-center mt-3">
          <button onclick="showAdminForgot(false)" class="text-sm text-gray-400 hover:text-gray-600 transition-colors">
            <i class="fas fa-arrow-left mr-1"></i>Back to Sign In
          </button>
        </div>
      </div>

      <div class="px-8 pb-8 pt-0 border-t border-gray-100">
        <div class="mt-4 text-center">
          <p class="text-xs text-gray-400 mb-2">Not an administrator?</p>
          <a href="/customer/login" class="text-brand-600 font-semibold text-sm hover:underline"><i class="fas fa-user mr-1"></i>Go to Customer Portal</a>
        </div>
      </div>
    </div>

    <!-- Back link -->
    <div class="text-center mt-6">
      <a href="/" class="text-gray-400 hover:text-white text-sm transition-colors"><i class="fas fa-arrow-left mr-1"></i>Back to homepage</a>
    </div>
  </div>

  <script>
    (function() {
      const user = localStorage.getItem('rc_user');
      if (user) {
        try {
          const u = JSON.parse(user);
          if (u.role === 'superadmin') { window.location.href = '/super-admin'; return; }
        } catch(e) {}
      }
    })();

    function showAdminForgot(show = true) {
      document.getElementById('adminForgotPanel').classList.toggle('hidden', !show);
      const loginFields = document.querySelector('.space-y-4');
      if (loginFields) loginFields.classList.toggle('hidden', show);
      document.getElementById('loginError').classList.add('hidden');
      document.querySelector('button[onclick="doLogin()"]').classList.toggle('hidden', show);
      const forgotLink = document.querySelector('button[onclick="showAdminForgot()"]');
      if (forgotLink) forgotLink.classList.toggle('hidden', show);
      if (show) document.getElementById('adminForgotEmail').focus();
    }

    async function doAdminForgot() {
      const email = document.getElementById('adminForgotEmail').value.trim();
      const err = document.getElementById('adminForgotError');
      const suc = document.getElementById('adminForgotSuccess');
      const btn = document.getElementById('adminForgotBtn');
      err.classList.add('hidden'); suc.classList.add('hidden');
      if (!email) { err.textContent = 'Please enter your email address.'; err.classList.remove('hidden'); return; }
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Sending...';
      try {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        suc.textContent = data.message || 'If an admin account exists, a reset link has been sent. Check your inbox.';
        suc.classList.remove('hidden');
        btn.innerHTML = '<i class="fas fa-check mr-2"></i>Email Sent';
      } catch(e) {
        err.textContent = 'Network error. Please try again.';
        err.classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>Send Reset Link';
      }
    }

    async function doLogin() {
      const email = document.getElementById('loginEmail').value.trim();
      const password = document.getElementById('loginPassword').value;
      const errDiv = document.getElementById('loginError');
      errDiv.classList.add('hidden');

      if (!email || !password) {
        errDiv.textContent = 'Please enter your email and password.';
        errDiv.classList.remove('hidden');
        return;
      }

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          localStorage.setItem('rc_user', JSON.stringify(data.user));
          localStorage.setItem('rc_token', data.token);
          window.location.href = '/super-admin';
        } else {
          errDiv.textContent = data.error || 'Login failed.';
          if (data.redirect) {
            errDiv.innerHTML += ' <a href="' + data.redirect + '" class="underline font-bold">Go to Customer Portal</a>';
          }
          errDiv.classList.remove('hidden');
        }
      } catch (e) {
        errDiv.textContent = 'Network error. Please try again.';
        errDiv.classList.remove('hidden');
      }
    }
  </script>
</body>
</html>`
}

function getAdminResetPasswordHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Reset Admin Password - Roof Manager</title>
</head>
<body class="bg-gradient-to-br from-sky-100 via-blue-50 to-white min-h-screen flex items-center justify-center">
  <div class="w-full max-w-md mx-auto px-4">
    <div class="text-center mb-8">
      <a href="/" class="inline-flex items-center gap-3">
        <img src="/static/logo.png" alt="Roof Manager" class="w-12 h-12 rounded-xl object-cover shadow-lg">
        <div class="text-left">
          <span class="text-gray-800 font-bold text-2xl block">Roof Manager</span>
          <span class="text-gray-500 text-xs">Admin Access</span>
        </div>
      </a>
    </div>

    <div class="bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-200">
      <div class="bg-gradient-to-r from-sky-600 to-blue-700 px-8 py-4">
        <div class="flex items-center gap-2">
          <i class="fas fa-key text-yellow-300"></i>
          <span class="text-white font-semibold text-sm">Admin Password Reset</span>
        </div>
      </div>
      <div class="p-8">
        <h2 class="text-xl font-bold text-gray-800 mb-1">Set New Admin Password</h2>
        <p class="text-sm text-gray-500 mb-6">Choose a strong password for your admin account.</p>

        <div id="resetInvalid" class="hidden p-4 bg-red-50 border border-red-200 rounded-xl mb-4">
          <p class="text-sm text-red-800 font-semibold"><i class="fas fa-exclamation-circle mr-1"></i>This reset link is invalid or has expired.</p>
          <p class="text-sm text-red-600 mt-1">Please <a href="/login" class="underline font-medium">return to admin login</a> and request a new one.</p>
        </div>

        <div id="resetForm">
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">New Password</label>
              <input type="password" id="newPassword" placeholder="At least 8 characters" class="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-sky-500 text-sm">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
              <input type="password" id="confirmPassword" placeholder="Repeat your new password" class="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-sky-500 text-sm" onkeyup="if(event.key==='Enter')doReset()">
            </div>
          </div>
          <div id="resetError" class="hidden mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm"></div>
          <button onclick="doReset()" id="resetBtn" class="w-full mt-5 py-3 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-xl transition-all hover:scale-[1.02] shadow-lg">
            <i class="fas fa-lock mr-2"></i>Set New Password
          </button>
        </div>

        <div id="resetSuccess" class="hidden p-4 bg-green-50 border border-green-200 rounded-xl">
          <p class="text-sm text-green-800 font-semibold"><i class="fas fa-check-circle mr-1"></i>Admin password updated successfully!</p>
          <a href="/login" class="mt-4 block text-center py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-xl text-sm transition-all">
            <i class="fas fa-sign-in-alt mr-1"></i>Go to Admin Login
          </a>
        </div>
      </div>
    </div>
  </div>

  <script>
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      document.getElementById('resetForm').classList.add('hidden');
      document.getElementById('resetInvalid').classList.remove('hidden');
    }

    async function doReset() {
      const newPw = document.getElementById('newPassword').value;
      const confPw = document.getElementById('confirmPassword').value;
      const err = document.getElementById('resetError');
      const btn = document.getElementById('resetBtn');
      err.classList.add('hidden');
      if (!newPw) { err.textContent = 'Please enter a new password.'; err.classList.remove('hidden'); return; }
      if (newPw.length < 8) { err.textContent = 'Admin password must be at least 8 characters.'; err.classList.remove('hidden'); return; }
      if (newPw !== confPw) { err.textContent = 'Passwords do not match.'; err.classList.remove('hidden'); return; }
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Updating...';
      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, new_password: newPw })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          document.getElementById('resetForm').classList.add('hidden');
          document.getElementById('resetSuccess').classList.remove('hidden');
        } else {
          err.textContent = data.error || 'Failed to reset password.';
          err.classList.remove('hidden');
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-lock mr-2"></i>Set New Password';
          if (data.error && data.error.includes('expired')) {
            document.getElementById('resetForm').classList.add('hidden');
            document.getElementById('resetInvalid').classList.remove('hidden');
          }
        }
      } catch(e) {
        err.textContent = 'Network error. Please try again.';
        err.classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-lock mr-2"></i>Set New Password';
      }
    }
  </script>
</body>
</html>`
}

function getCustomerResetPasswordHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Reset Password - Roof Manager</title>
</head>
<body class="bg-gradient-to-br from-sky-100 via-blue-50 to-white min-h-screen flex items-center justify-center">
  <div class="w-full max-w-md mx-auto px-4">
    <div class="text-center mb-8">
      <a href="/" class="inline-flex items-center gap-3">
        <img src="/static/logo.png" alt="Roof Manager" class="w-12 h-12 rounded-xl object-cover shadow-lg">
        <div class="text-left">
          <span class="text-gray-800 font-bold text-2xl block">Roof Manager</span>
          <span class="text-sky-600 text-xs">Customer Portal</span>
        </div>
      </a>
    </div>

    <div class="bg-white rounded-2xl shadow-2xl overflow-hidden">
      <div class="p-8">
        <h2 class="text-xl font-bold text-gray-800 mb-1">Set New Password</h2>
        <p class="text-sm text-gray-500 mb-6">Choose a new password for your account.</p>

        <div id="resetInvalid" class="hidden p-4 bg-red-50 border border-red-200 rounded-xl mb-4">
          <p class="text-sm text-red-800 font-semibold"><i class="fas fa-exclamation-circle mr-1"></i>This reset link is invalid or has expired.</p>
          <p class="text-sm text-red-600 mt-1">Please <a href="/customer/login" class="underline font-medium">request a new one</a>.</p>
        </div>

        <div id="resetForm">
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">New Password</label>
              <input type="password" id="newPassword" placeholder="At least 6 characters" class="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 text-sm">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
              <input type="password" id="confirmPassword" placeholder="Repeat your new password" class="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 text-sm" onkeyup="if(event.key==='Enter')doReset()">
            </div>
          </div>
          <div id="resetError" class="hidden mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm"></div>
          <button onclick="doReset()" id="resetBtn" class="w-full mt-5 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl transition-all hover:scale-[1.02] shadow-lg shadow-brand-500/25">
            <i class="fas fa-lock mr-2"></i>Set New Password
          </button>
        </div>

        <div id="resetSuccess" class="hidden p-4 bg-green-50 border border-green-200 rounded-xl">
          <p class="text-sm text-green-800 font-semibold"><i class="fas fa-check-circle mr-1"></i>Password updated successfully!</p>
          <p class="text-sm text-green-600 mt-1">You can now sign in with your new password.</p>
          <a href="/customer/login" class="mt-4 block text-center py-2.5 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-xl text-sm transition-all">
            <i class="fas fa-sign-in-alt mr-1"></i>Go to Sign In
          </a>
        </div>
      </div>
    </div>
  </div>

  <script>
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      document.getElementById('resetForm').classList.add('hidden');
      document.getElementById('resetInvalid').classList.remove('hidden');
    }

    async function doReset() {
      const newPw = document.getElementById('newPassword').value;
      const confPw = document.getElementById('confirmPassword').value;
      const err = document.getElementById('resetError');
      const btn = document.getElementById('resetBtn');
      err.classList.add('hidden');
      if (!newPw) { err.textContent = 'Please enter a new password.'; err.classList.remove('hidden'); return; }
      if (newPw.length < 6) { err.textContent = 'Password must be at least 6 characters.'; err.classList.remove('hidden'); return; }
      if (newPw !== confPw) { err.textContent = 'Passwords do not match.'; err.classList.remove('hidden'); return; }
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Updating...';
      try {
        const res = await fetch('/api/customer/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, new_password: newPw })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          document.getElementById('resetForm').classList.add('hidden');
          document.getElementById('resetSuccess').classList.remove('hidden');
        } else {
          err.textContent = data.error || 'Failed to reset password.';
          err.classList.remove('hidden');
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-lock mr-2"></i>Set New Password';
          if (data.error && data.error.includes('expired')) {
            document.getElementById('resetForm').classList.add('hidden');
            document.getElementById('resetInvalid').classList.remove('hidden');
          }
        }
      } catch(e) {
        err.textContent = 'Network error. Please try again.';
        err.classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-lock mr-2"></i>Set New Password';
      }
    }
  </script>
</body>
</html>`
}

function getLandingPageHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Roof Manager — Professional Roof Measurement Reports & CRM for Roofing Companies</title>
  <meta name="description" content="Get accurate roof area, pitch analysis, edge breakdowns, material estimates, and solar potential from satellite imagery in under 60 seconds. Full CRM, AI Secretary, team management. Start with 3 free reports.">
  <meta property="og:title" content="Roof Manager — Precision Roof Measurement Reports">
  <meta property="og:description" content="Professional satellite-powered roof measurement reports in under 60 seconds. Full CRM, AI phone secretary, and team management for roofing businesses.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://roofmanager.ca">
  <meta property="og:image" content="https://roofmanager.ca/static/logo.png">
  <meta property="og:image:width" content="512">
  <meta property="og:image:height" content="512">
  <meta property="og:site_name" content="Roof Manager">
  <meta property="og:locale" content="en_CA">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="Roof Manager — Satellite Roof Measurements in 60 Seconds">
  <meta name="twitter:description" content="AI-powered roof measurement reports, full CRM & team management for roofing companies. 3 free reports.">
  <meta name="twitter:image" content="https://roofmanager.ca/static/logo.png">
  <meta name="keywords" content="roof measurement software, roofing CRM, satellite roof reports, roof area calculator, roofing estimate tool, roof pitch analysis, material takeoff, roofing contractor software, AI roof measurement, Canadian roofing software">
  <link rel="canonical" href="https://roofmanager.ca/">
  <!-- JSON-LD Structured Data for SEO -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "Roof Manager",
    "url": "https://roofmanager.ca",
    "image": "https://roofmanager.ca/static/logo.png",
    "applicationCategory": "BusinessApplication",
    "operatingSystem": "Web",
    "description": "AI-powered roof measurement reports from satellite imagery. Full CRM, invoicing, proposals, and team management for roofing companies.",
    "offers": {
      "@type": "Offer",
      "price": "7.00",
      "priceCurrency": "USD",
      "description": "Per report after 3 free reports"
    },
    "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": "4.8",
      "ratingCount": "127"
    },
    "provider": {
      "@type": "Organization",
      "name": "Roof Manager",
      "url": "https://roofmanager.ca",
      "address": {
        "@type": "PostalAddress",
        "addressRegion": "Alberta",
        "addressCountry": "CA"
      }
    }
  }
  </script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {"@type": "Question", "name": "How accurate are Roof Manager measurements?", "acceptedAnswer": {"@type": "Answer", "text": "Our measurements use satellite imagery combined with GPS coordinate tracing and Google Solar API data. Accuracy is typically within 2-5% of manual measurements, verified against pitch-corrected sloped area calculations."}},
      {"@type": "Question", "name": "How much does a roof measurement report cost?", "acceptedAnswer": {"@type": "Answer", "text": "Reports are $7 USD each. New users get 3 free reports to try the platform. Credit packs offer volume discounts — 25 reports for $150 ($6/each) or 100 reports for $500 ($5/each)."}},
      {"@type": "Question", "name": "What is included in a roof report?", "acceptedAnswer": {"@type": "Answer", "text": "Each report includes total roof area (footprint and sloped), pitch analysis, edge breakdowns (ridge, hip, valley, eave, rake), material estimates with waste calculations, satellite imagery, and a professional PDF."}},
      {"@type": "Question", "name": "Does Roof Manager work in Canada and the US?", "acceptedAnswer": {"@type": "Answer", "text": "Yes. Roof Manager works across Canada and the United States wherever Google satellite imagery is available. Coverage is best in urban and suburban areas."}},
      {"@type": "Question", "name": "Can I use Roof Manager for my roofing company?", "acceptedAnswer": {"@type": "Answer", "text": "Absolutely. Roof Manager includes a full CRM with customer management, invoicing, proposals, job scheduling with Google Calendar sync, material calculator, and an AI phone secretary for your business."}},
      {"@type": "Question", "name": "How fast are reports generated?", "acceptedAnswer": {"@type": "Answer", "text": "Reports are generated in under 60 seconds. Simply enter a property address, trace the roof edges on the satellite image, and the system calculates everything automatically."}}
    ]
  }
  </script>
  <style>
    /* Landing page scroll animations */
    .scroll-animate {
      opacity: 0;
      transform: translateY(20px);
      transition: all 0.7s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .scroll-animate.animate-in {
      opacity: 1 !important;
      transform: translateY(0) !important;
    }
    html { scroll-behavior: smooth; }
    /* Navbar: starts transparent, turns dark on scroll */
    .landing-nav {
      transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      background: transparent;
    }
    .landing-nav.scrolled {
      background: rgba(15, 23, 42, 0.97);
      backdrop-filter: blur(16px);
      box-shadow: 0 4px 30px rgba(0,0,0,0.3);
    }
  </style>
</head>
<body class="bg-white min-h-screen">
  <!-- Sticky Navigation — Starts fully transparent over hero image -->
  <nav id="landing-nav" class="landing-nav fixed top-0 left-0 right-0 z-50">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
      <a href="/" class="flex items-center gap-3">
        <img src="/static/logo.png" alt="Roof Manager" class="w-9 h-9 rounded-lg object-cover shadow-lg">
        <div class="leading-tight">
          <span class="text-white font-bold text-lg tracking-tight">Roof Manager</span>
          <span class="hidden sm:block text-gray-400 text-[10px] -mt-0.5">Measurement Reports & Business CRM</span>
        </div>
      </a>

      <!-- Desktop nav -->
      <div class="hidden md:flex items-center gap-6">
        <a href="#how-it-works" class="text-gray-300 hover:text-white text-sm font-medium transition-colors">How It Works</a>
        <a href="#features" class="text-gray-300 hover:text-white text-sm font-medium transition-colors">Platform</a>
        <a href="#pricing" class="text-gray-300 hover:text-white text-sm font-medium transition-colors">Pricing</a>
        <a href="/blog" class="text-gray-300 hover:text-white text-sm font-medium transition-colors">Blog</a>
        <a href="/lander" class="text-gray-300 hover:text-white text-sm font-medium transition-colors">Get Started</a>
        <a href="#faq" class="text-gray-300 hover:text-white text-sm font-medium transition-colors">FAQ</a>
        <a href="/customer/login" class="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white font-semibold py-2 px-5 rounded-lg text-sm transition-all hover:scale-105 shadow-lg shadow-cyan-500/25">
          <i class="fas fa-sign-in-alt mr-1"></i>Login
        </a>
      </div>

      <!-- Mobile menu button -->
      <button id="mobile-menu-btn" class="md:hidden text-white text-xl p-2" onclick="document.getElementById('mobile-menu').classList.toggle('hidden')">
        <i class="fas fa-bars"></i>
      </button>
    </div>

    <!-- Mobile menu -->
    <div id="mobile-menu" class="hidden md:hidden bg-slate-900/98 backdrop-blur-xl border-t border-white/10">
      <div class="max-w-7xl mx-auto px-4 py-4 flex flex-col gap-1">
        <a href="#how-it-works" class="text-gray-300 hover:text-white text-sm py-2.5 px-3 rounded-lg hover:bg-white/5 transition-all" onclick="document.getElementById('mobile-menu').classList.add('hidden')">How It Works</a>
        <a href="#features" class="text-gray-300 hover:text-white text-sm py-2.5 px-3 rounded-lg hover:bg-white/5 transition-all" onclick="document.getElementById('mobile-menu').classList.add('hidden')">Platform</a>
        <a href="#pricing" class="text-gray-300 hover:text-white text-sm py-2.5 px-3 rounded-lg hover:bg-white/5 transition-all" onclick="document.getElementById('mobile-menu').classList.add('hidden')">Pricing</a>
        <a href="/blog" class="text-gray-300 hover:text-white text-sm py-2.5 px-3 rounded-lg hover:bg-white/5 transition-all" onclick="document.getElementById('mobile-menu').classList.add('hidden')">Blog</a>
        <a href="/lander" class="text-gray-300 hover:text-white text-sm py-2.5 px-3 rounded-lg hover:bg-white/5 transition-all" onclick="document.getElementById('mobile-menu').classList.add('hidden')">Get Started</a>
        <a href="#faq" class="text-gray-300 hover:text-white text-sm py-2.5 px-3 rounded-lg hover:bg-white/5 transition-all" onclick="document.getElementById('mobile-menu').classList.add('hidden')">FAQ</a>
        <a href="/customer/login" class="bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold py-2.5 px-5 rounded-lg text-sm text-center mt-2"><i class="fas fa-sign-in-alt mr-1"></i>Login / Sign Up</a>
      </div>
    </div>
  </nav>

  <!-- Landing page content -->
  <div id="landing-root"></div>

  <!-- Contact Us Lead Capture -->
  ${getContactFormHTML('homepage')}

  <!-- Footer — Dark premium style -->
  <footer class="bg-slate-900 text-gray-400">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 py-16">
      <div class="grid md:grid-cols-4 gap-8">
        <div>
          <div class="flex items-center gap-3 mb-4">
            <img src="/static/logo.png" alt="Roof Manager" class="w-9 h-9 rounded-lg object-cover">
            <span class="text-white font-bold text-lg tracking-tight">Roof Manager</span>
          </div>
          <p class="text-sm leading-relaxed text-gray-500">Professional AI-powered roof measurement reports, CRM, and business management for roofing companies across Canada.</p>
          <div class="flex items-center gap-4 mt-6">
            <a href="#" class="text-gray-500 hover:text-cyan-400 transition-colors"><i class="fab fa-facebook text-lg"></i></a>
            <a href="#" class="text-gray-500 hover:text-cyan-400 transition-colors"><i class="fab fa-instagram text-lg"></i></a>
            <a href="#" class="text-gray-500 hover:text-cyan-400 transition-colors"><i class="fab fa-linkedin text-lg"></i></a>
          </div>
        </div>
        <div>
          <h4 class="text-white font-semibold mb-4 text-sm uppercase tracking-wider">Product</h4>
          <ul class="space-y-2.5 text-sm">
            <li><a href="#features" class="hover:text-cyan-400 transition-colors">Measurement Reports</a></li>
            <li><a href="#features" class="hover:text-cyan-400 transition-colors">AI Roofer Secretary</a></li>
            <li><a href="#features" class="hover:text-cyan-400 transition-colors">CRM & Invoicing</a></li>
            <li><a href="#features" class="hover:text-cyan-400 transition-colors">Virtual Roof Try-On</a></li>
            <li><a href="#pricing" class="hover:text-cyan-400 transition-colors">Pricing</a></li>
          </ul>
        </div>
        <div>
          <h4 class="text-white font-semibold mb-4 text-sm uppercase tracking-wider">Resources</h4>
          <ul class="space-y-2.5 text-sm">
            <li><a href="/blog" class="hover:text-cyan-400 transition-colors">Blog</a></li>
            <li><a href="#how-it-works" class="hover:text-cyan-400 transition-colors">How It Works</a></li>
            <li><a href="#faq" class="hover:text-cyan-400 transition-colors">FAQ</a></li>
            <li><a href="/lander" class="hover:text-cyan-400 transition-colors">Get Started Guide</a></li>
            <li><a href="mailto:sales@roofmanager.ca" class="hover:text-cyan-400 transition-colors">Contact</a></li>
            <li><a href="/privacy" class="hover:text-cyan-400 transition-colors">Privacy Policy</a></li>
            <li><a href="/terms" class="hover:text-cyan-400 transition-colors">Terms of Service</a></li>
          </ul>
        </div>
        <div>
          <h4 class="text-white font-semibold mb-4 text-sm uppercase tracking-wider">Get Started</h4>
          <p class="text-sm text-gray-500 mb-4">Start with 3 free reports. No credit card required.</p>
          <a href="/customer/login" class="inline-block bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white font-semibold py-2.5 px-6 rounded-lg text-sm transition-all shadow-lg">
            Sign Up Free
          </a>
        </div>
      </div>
      <div class="border-t border-gray-800 mt-12 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <p class="text-sm text-gray-500">&copy; 2026 Roof Manager. All rights reserved.</p>
        <div class="flex flex-wrap items-center gap-3 sm:gap-6 text-sm text-gray-500">
          <a href="/privacy" class="hover:text-cyan-400 transition-colors">Privacy Policy</a>
          <a href="/terms" class="hover:text-cyan-400 transition-colors">Terms of Service</a>
          <span class="flex items-center gap-1.5"><i class="fas fa-map-marker-alt text-cyan-500"></i> Alberta, Canada</span>
          <a href="mailto:sales@roofmanager.ca" class="flex items-center gap-1.5 hover:text-cyan-400 transition-colors"><i class="fas fa-envelope text-cyan-500"></i> sales@roofmanager.ca</a>
        </div>
      </div>
    </div>
  </footer>

  <!-- Navbar scroll effect -->
  <script>
    window.addEventListener('scroll', () => {
      const nav = document.getElementById('landing-nav');
      if (window.scrollY > 50) {
        nav.classList.add('scrolled');
      } else {
        nav.classList.remove('scrolled');
      }
    });
  </script>
  <script src="/static/landing.js"></script>
  ${getRoverWidget()}
</body>
</html>`
}

function getSettingsPageHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Settings - Roof Manager</title>
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <img src="/static/logo.png" alt="Roof Manager" class="w-10 h-10 rounded-lg object-cover">
        <div>
          <h1 class="text-xl font-bold">Settings</h1>
          <p class="text-brand-200 text-xs">Company Profile, API Keys & Pricing</p>
        </div>
      </div>
      <nav class="flex items-center space-x-4">
        <a href="/" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-home mr-1"></i>Home</a>
        <a href="/order/new" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-plus mr-1"></i>New Order</a>
        <a href="/admin" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-tachometer-alt mr-1"></i>Admin</a>
        <a href="/super-admin" class="text-yellow-300 hover:text-white text-sm font-semibold"><i class="fas fa-crown mr-1"></i>Super Admin</a>
      </nav>
    </div>
  </header>
  <main class="max-w-4xl mx-auto px-4 py-8">
    <div id="settings-root"></div>
  </main>
  <script src="/static/settings.js"></script>
</body>
</html>`
}

// ============================================================
// CUSTOMER PAGES
// ============================================================

function getCustomerLoginHTML() {

  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Customer Login - Roof Manager</title>
</head>
<body class="bg-gradient-to-br from-sky-100 via-blue-50 to-white min-h-screen flex items-center justify-center">
  <script>var _rp=new URLSearchParams(location.search).get('ref');if(_rp)localStorage.setItem('_ref_code',_rp);</script>
  <div class="w-full max-w-md mx-auto px-4">
    <!-- Logo -->
    <div class="text-center mb-8">
      <a href="/" class="inline-flex items-center gap-3">
        <img src="/static/logo.png" alt="Roof Manager" class="w-12 h-12 rounded-xl object-cover shadow-lg">
        <div class="text-left">
          <span class="text-gray-800 font-bold text-2xl block">Roof Manager</span>
          <span class="text-sky-600 text-xs">Customer Portal - Roof Reports & CRM</span>
        </div>
      </a>
    </div>

    <!-- Auth Card -->
    <div class="bg-white rounded-2xl shadow-2xl overflow-hidden">
      <div class="p-8">
        <h2 class="text-xl font-bold text-gray-800 mb-1">Welcome</h2>
        <p class="text-sm text-gray-500 mb-6">Sign in to view your roof reports, invoices, and order history</p>

        <!-- Tabs -->
        <div class="flex border border-gray-200 rounded-lg overflow-hidden mb-5">
          <button id="custLoginTab" onclick="showCustTab('login')" class="flex-1 py-2.5 text-center text-sm font-medium bg-brand-50 text-brand-700 border-b-2 border-brand-500">Sign In</button>
          <button id="custRegTab" onclick="showCustTab('register')" class="flex-1 py-2.5 text-center text-sm font-medium text-gray-500 hover:text-gray-700">Register</button>
        </div>

        <!-- Login Form -->
        <div id="custLoginForm">
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Email or Username</label>
              <input type="text" id="custLoginEmail" placeholder="you@company.com" class="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input type="password" id="custLoginPassword" placeholder="Enter your password" class="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm" onkeyup="if(event.key==='Enter')doCustLogin()">
            </div>
          </div>
          <div id="custLoginError" class="hidden mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm"></div>
          <button onclick="doCustLogin()" class="w-full mt-5 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl transition-all hover:scale-[1.02] shadow-lg shadow-brand-500/25">
            <i class="fas fa-sign-in-alt mr-2"></i>Sign In
          </button>
          <div class="text-center mt-3">
            <button onclick="showForgot()" class="text-sm text-sky-600 hover:text-sky-800 hover:underline transition-colors">
              <i class="fas fa-key mr-1"></i>Forgot your password?
            </button>
          </div>
        </div>

        <!-- Forgot Password Panel -->
        <div id="custForgotForm" class="hidden">
          <div class="mb-4 p-3 bg-sky-50 border border-sky-200 rounded-xl">
            <p class="text-sm text-sky-800"><i class="fas fa-info-circle mr-1"></i>Enter your email and we'll send you a link to reset your password.</p>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
            <input type="email" id="forgotEmail" placeholder="you@company.com" class="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm" onkeyup="if(event.key==='Enter')doForgot()">
          </div>
          <div id="forgotError" class="hidden mt-3 p-3 bg-red-50 text-red-700 rounded-lg text-sm"></div>
          <div id="forgotSuccess" class="hidden mt-3 p-3 bg-green-50 text-green-700 rounded-lg text-sm"></div>
          <button onclick="doForgot()" id="forgotBtn" class="w-full mt-4 py-3 bg-sky-600 hover:bg-sky-700 text-white font-bold rounded-xl transition-all hover:scale-[1.02] shadow-lg">
            <i class="fas fa-paper-plane mr-2"></i>Send Reset Link
          </button>
          <div class="text-center mt-3">
            <button onclick="showForgot(false)" class="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              <i class="fas fa-arrow-left mr-1"></i>Back to Sign In
            </button>
          </div>
        </div>

        <!-- Register Form - Step 1: Email Verification -->
        <div id="custRegForm" class="hidden">
          <!-- Step 1: Verify Email -->
          <div id="regStep1">
            <div class="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-xl">
              <p class="text-sm text-blue-800"><i class="fas fa-shield-alt mr-1"></i> <strong>Email verification required.</strong> We'll send a 6-digit code to confirm your email.</p>
            </div>
            <div class="space-y-3">
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                  <input type="text" id="custRegName" placeholder="John Smith" class="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-brand-500">
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Company</label>
                  <input type="text" id="custRegCompany" placeholder="Smith Roofing" class="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-brand-500">
                </div>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                <div class="flex gap-2">
                  <input type="email" id="custRegEmail" placeholder="you@company.com" class="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-brand-500">
                  <button onclick="sendVerifyCode()" id="sendCodeBtn" class="px-4 py-2.5 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-xl text-sm whitespace-nowrap transition-all">
                    <i class="fas fa-paper-plane mr-1"></i>Send Code
                  </button>
                </div>
              </div>
            </div>
            <div id="regStep1Error" class="hidden mt-3 p-3 bg-red-50 text-red-700 rounded-lg text-sm"></div>
            <div id="regStep1Success" class="hidden mt-3 p-3 bg-green-50 text-green-700 rounded-lg text-sm"></div>
          </div>

          <!-- Step 2: Enter Code + Complete Registration (shown after code sent) -->
          <div id="regStep2" class="hidden">
            <div class="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl">
              <p class="text-sm text-green-800"><i class="fas fa-envelope-open-text mr-1"></i> Code sent to <strong id="regSentEmail"></strong>. Enter it below.</p>
            </div>
            <div class="space-y-3">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Verification Code *</label>
                <div class="flex gap-2 items-center">
                  <input type="text" id="custRegCode" placeholder="123456" maxlength="6" class="w-full sm:w-40 px-4 py-2.5 border border-gray-300 rounded-xl text-sm text-center font-mono text-lg tracking-widest focus:ring-2 focus:ring-brand-500" oninput="this.value=this.value.replace(/[^0-9]/g,'')">
                  <button onclick="verifyCodeStep()" id="verifyCodeBtn" class="px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-xl text-sm transition-all">
                    <i class="fas fa-check mr-1"></i>Verify
                  </button>
                  <button onclick="sendVerifyCode()" class="px-3 py-2.5 text-sky-600 hover:text-sky-800 text-sm font-medium">Resend</button>
                </div>
              </div>
              <div id="regCodeVerified" class="hidden p-3 bg-green-100 border border-green-300 rounded-xl">
                <p class="text-sm text-green-800 font-semibold"><i class="fas fa-check-circle mr-1"></i> Email verified! Complete your details below.</p>
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input type="tel" id="custRegPhone" placeholder="(780) 555-1234" class="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-brand-500">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Password *</label>
              <input type="password" id="custRegPassword" placeholder="Min 6 characters" class="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-brand-500">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Confirm Password *</label>
              <input type="password" id="custRegConfirm" placeholder="Confirm password" class="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-brand-500" onkeyup="if(event.key==='Enter')doCustRegister()">
            </div>
          </div>
          <div id="custRegError" class="hidden mt-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm"></div>
          <div id="regStep2Fields" class="hidden">
          <button onclick="doCustRegister()" id="regSubmitBtn" class="w-full mt-5 py-3 bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl transition-all hover:scale-[1.02] shadow-lg shadow-brand-500/25 disabled:opacity-50 disabled:cursor-not-allowed" disabled>
            <i class="fas fa-user-plus mr-2"></i>Create Account
          </button>
          </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Links -->
    <div class="text-center mt-6 space-y-2">
      <a href="/login" class="text-brand-300 hover:text-white text-sm transition-colors"><i class="fas fa-shield-alt mr-1"></i>Admin Login</a>
      <span class="text-brand-700 mx-2">|</span>
      <a href="/" class="text-brand-300 hover:text-white text-sm transition-colors"><i class="fas fa-arrow-left mr-1"></i>Back to homepage</a>
    </div>
  </div>

  <script>
    // Check if already logged in
    (function() {
      const c = localStorage.getItem('rc_customer');
      if (c) window.location.href = '/customer/dashboard';
    })();

    function showCustTab(tab) {
      document.getElementById('custLoginForm').classList.toggle('hidden', tab !== 'login');
      document.getElementById('custRegForm').classList.toggle('hidden', tab !== 'register');
      const lt = document.getElementById('custLoginTab');
      const rt = document.getElementById('custRegTab');
      if (tab === 'login') {
        lt.classList.add('bg-brand-50','text-brand-700','border-b-2','border-brand-500');
        lt.classList.remove('text-gray-500');
        rt.classList.remove('bg-brand-50','text-brand-700','border-b-2','border-brand-500');
        rt.classList.add('text-gray-500');
      } else {
        rt.classList.add('bg-brand-50','text-brand-700','border-b-2','border-brand-500');
        rt.classList.remove('text-gray-500');
        lt.classList.remove('bg-brand-50','text-brand-700','border-b-2','border-brand-500');
        lt.classList.add('text-gray-500');
      }
    }

    function showForgot(show = true) {
      document.getElementById('custLoginForm').classList.toggle('hidden', show);
      document.getElementById('custForgotForm').classList.toggle('hidden', !show);
      document.getElementById('custRegForm').classList.add('hidden');
      if (show) document.getElementById('forgotEmail').focus();
    }

    async function doForgot() {
      const email = document.getElementById('forgotEmail').value.trim();
      const err = document.getElementById('forgotError');
      const suc = document.getElementById('forgotSuccess');
      const btn = document.getElementById('forgotBtn');
      err.classList.add('hidden'); suc.classList.add('hidden');
      if (!email) { err.textContent = 'Please enter your email address.'; err.classList.remove('hidden'); return; }
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Sending...';
      try {
        const res = await fetch('/api/customer/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        suc.textContent = data.message || 'If an account exists, a reset link has been sent. Check your inbox (and spam folder).';
        suc.classList.remove('hidden');
        btn.innerHTML = '<i class="fas fa-check mr-2"></i>Email Sent';
      } catch(e) {
        err.textContent = 'Network error. Please try again.';
        err.classList.remove('hidden');
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>Send Reset Link';
      }
    }

    async function doCustLogin() {
      const email = document.getElementById('custLoginEmail').value.trim();
      const password = document.getElementById('custLoginPassword').value;
      const err = document.getElementById('custLoginError');
      err.classList.add('hidden');
      if (!email || !password) { err.textContent = 'Email and password required.'; err.classList.remove('hidden'); return; }
      try {
        const res = await fetch('/api/customer/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          localStorage.setItem('rc_customer', JSON.stringify(data.customer));
          localStorage.setItem('rc_customer_token', data.token);
          window.location.href = '/customer/dashboard';
        } else {
          err.textContent = data.error || 'Login failed.';
          err.classList.remove('hidden');
        }
      } catch(e) { err.textContent = 'Network error.'; err.classList.remove('hidden'); }
    }

    var _regVerificationToken = null;

    async function sendVerifyCode() {
      const email = document.getElementById('custRegEmail').value.trim();
      const name = document.getElementById('custRegName').value.trim();
      const err = document.getElementById('regStep1Error');
      const suc = document.getElementById('regStep1Success');
      const btn = document.getElementById('sendCodeBtn');
      err.classList.add('hidden'); suc.classList.add('hidden');

      if (!name) { err.textContent = 'Please enter your name first.'; err.classList.remove('hidden'); return; }
      if (!email) { err.textContent = 'Please enter your email address.'; err.classList.remove('hidden'); return; }
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) { err.textContent = 'Please enter a valid email address.'; err.classList.remove('hidden'); return; }

      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Sending...';
      try {
        const res = await fetch('/api/customer/send-verification', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          // Show the verification code step
          document.getElementById('regStep2').classList.remove('hidden');
          document.getElementById('regSentEmail').textContent = email;
          document.getElementById('custRegCode').focus();
          // Disable email field after sending
          document.getElementById('custRegEmail').readOnly = true;
          document.getElementById('custRegEmail').classList.add('bg-gray-100');

          // Check if email was actually sent or if we got a fallback code
          if (data.email_sent === false && data.fallback_code) {
            // Email delivery unavailable — show the code directly
            suc.innerHTML = '<i class="fas fa-exclamation-triangle text-amber-600 mr-1"></i> Email delivery is temporarily unavailable.<br>'
              + '<span class="font-mono text-2xl font-bold tracking-widest text-blue-700 block my-2">' + data.fallback_code + '</span>'
              + '<span class="text-xs text-gray-500">Enter this code below to verify your email and continue registration.</span>';
            suc.classList.remove('hidden', 'bg-green-50', 'text-green-800', 'border-green-200');
            suc.classList.add('bg-amber-50', 'text-amber-900', 'border', 'border-amber-200');
          } else {
            suc.textContent = data.message || 'Code sent! Check your inbox.';
            suc.classList.remove('hidden');
          }

          // Start 60s cooldown
          var cd = 60;
          btn.disabled = true;
          var iv = setInterval(function() { cd--; btn.innerHTML = '<i class="fas fa-clock mr-1"></i>' + cd + 's'; if (cd <= 0) { clearInterval(iv); btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane mr-1"></i>Resend'; } }, 1000);
        } else {
          err.textContent = data.error || 'Failed to send code.';
          err.classList.remove('hidden');
          btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane mr-1"></i>Send Code';
        }
      } catch(e) { err.textContent = 'Network error. Please try again.'; err.classList.remove('hidden'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane mr-1"></i>Send Code'; }
    }

    async function verifyCodeStep() {
      const email = document.getElementById('custRegEmail').value.trim();
      const code = document.getElementById('custRegCode').value.trim();
      const err = document.getElementById('custRegError');
      const btn = document.getElementById('verifyCodeBtn');
      err.classList.add('hidden');

      if (!code || code.length !== 6) { err.textContent = 'Please enter the 6-digit code.'; err.classList.remove('hidden'); return; }

      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Verifying...';
      try {
        const res = await fetch('/api/customer/verify-code', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, code })
        });
        const data = await res.json();
        if (res.ok && data.verified) {
          _regVerificationToken = data.verification_token;
          document.getElementById('regCodeVerified').classList.remove('hidden');
          document.getElementById('regStep2Fields').classList.remove('hidden');
          document.getElementById('regSubmitBtn').disabled = false;
          document.getElementById('custRegCode').readOnly = true;
          document.getElementById('custRegCode').classList.add('bg-green-50', 'border-green-400');
          btn.innerHTML = '<i class="fas fa-check mr-1"></i>Verified'; btn.disabled = true;
          btn.classList.remove('bg-green-600', 'hover:bg-green-700');
          btn.classList.add('bg-green-400', 'cursor-default');
        } else {
          err.textContent = data.error || 'Invalid code. Please try again.';
          err.classList.remove('hidden');
          btn.disabled = false; btn.innerHTML = '<i class="fas fa-check mr-1"></i>Verify';
        }
      } catch(e) { err.textContent = 'Network error.'; err.classList.remove('hidden'); btn.disabled = false; btn.innerHTML = '<i class="fas fa-check mr-1"></i>Verify'; }
    }

    async function doCustRegister() {
      const name = document.getElementById('custRegName').value.trim();
      const company = document.getElementById('custRegCompany').value.trim();
      const email = document.getElementById('custRegEmail').value.trim();
      const phone = document.getElementById('custRegPhone').value.trim();
      const password = document.getElementById('custRegPassword').value;
      const confirm = document.getElementById('custRegConfirm').value;
      const err = document.getElementById('custRegError');
      err.classList.add('hidden');
      if (!name || !email || !password) { err.textContent = 'Name, email, and password required.'; err.classList.remove('hidden'); return; }
      if (password.length < 6) { err.textContent = 'Password must be at least 6 characters.'; err.classList.remove('hidden'); return; }
      if (password !== confirm) { err.textContent = 'Passwords do not match.'; err.classList.remove('hidden'); return; }
      if (!_regVerificationToken) { err.textContent = 'Please verify your email first.'; err.classList.remove('hidden'); return; }
      try {
        const res = await fetch('/api/customer/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name, phone, company_name: company, verification_token: _regVerificationToken, referred_by_code: new URLSearchParams(window.location.search).get('ref') || localStorage.getItem('_ref_code') || '' })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          localStorage.setItem('rc_customer', JSON.stringify(data.customer));
          localStorage.setItem('rc_customer_token', data.token);
          window.location.href = '/customer/dashboard';
        } else {
          err.textContent = data.error || 'Registration failed.';
          err.classList.remove('hidden');
        }
      } catch(e) { err.textContent = 'Network error.'; err.classList.remove('hidden'); }
    }
  </script>
  ${getRoverWidget()}
</body>
</html>`
}

function getCustomerDashboardHTML(adsensePublisherId: string = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>My Dashboard - Roof Manager</title>
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <a href="/" class="flex items-center space-x-3 hover:opacity-90 transition-opacity">
          <img src="/static/logo.png" alt="Roof Manager" class="w-10 h-10 rounded-lg object-cover">
          <div>
            <h1 class="text-xl font-bold">My Dashboard</h1>
            <p class="text-brand-200 text-xs">Roof Manager - Roof Reports & CRM</p>
          </div>
        </a>
      </div>
      <nav class="flex items-center space-x-4">
        <span id="custGreeting" class="text-brand-200 text-sm hidden"><i class="fas fa-user-circle mr-1"></i><span id="custName"></span></span>
        <a href="/" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-home mr-1"></i>Home</a>
        <button onclick="custLogout()" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-sign-out-alt mr-1"></i>Logout</button>
      </nav>
    </div>
  </header>
  <main class="max-w-7xl mx-auto px-4 py-8">
    <div id="customer-root"></div>
  </main>
  <script>
    // Auth guard
    (function() {
      var c = localStorage.getItem('rc_customer');
      if (!c) { window.location.href = '/customer/login'; return; }
      try {
        var u = JSON.parse(c);
        var g = document.getElementById('custGreeting');
        var n = document.getElementById('custName');
        if (g && n) { n.textContent = u.name || u.email; g.classList.remove('hidden'); }
      } catch(e) {}
    })();
    function custLogout() {
      var token = localStorage.getItem('rc_customer_token');
      if (token) fetch('/api/customer/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } })['catch'](function(){});
      localStorage.removeItem('rc_customer');
      localStorage.removeItem('rc_customer_token');
      window.location.href = '/customer/login';
    }
  </script>
  <script>
    // Ad config — publisher ID injected server-side, consumed by ads.js
    window.__rraPublisherId = '${adsensePublisherId}';
  </script>
  <script src="/static/js/ads.js?v=${Date.now()}"></script>
  <script src="/static/customer-dashboard.js?v=${Date.now()}"></script>
  ${getRoverAssistant()}
</body>
</html>`
}

function getCustomerInvoiceHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Invoice - Roof Manager</title>
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <a href="/customer/dashboard" class="flex items-center space-x-3 hover:opacity-90">
          <img src="/static/logo.png" alt="Roof Manager" class="w-10 h-10 rounded-lg object-cover">
          <div>
            <h1 class="text-xl font-bold">Invoice</h1>
            <p class="text-brand-200 text-xs">Roof Manager</p>
          </div>
        </a>
      </div>
      <nav class="flex items-center space-x-4">
        <a href="/customer/dashboard" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-arrow-left mr-1"></i>Back to Dashboard</a>
      </nav>
    </div>
  </header>
  <main class="max-w-4xl mx-auto px-4 py-8">
    <div id="invoice-root"></div>
  </main>
  <script>
    (function() {
      var c = localStorage.getItem('rc_customer');
      if (!c) { window.location.href = '/customer/login'; return; }
    })();
  </script>
  <script src="/static/customer-invoice.js"></script>
  ${getRoverAssistant()}
</body>
</html>`
}

// ============================================================
// PRICING PAGE — Public, shows credit packs & per-report pricing
// ============================================================
function getPricingPageHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Roof Report Pricing — AI Measurements from $5/Report | Roof Manager</title>
  <meta name="description" content="Compare Roof Manager pricing plans. Pay per report from $7 USD or save with credit packs (25 for $150, 100 for $500). Includes CRM, proposals, invoicing, and AI secretary. 3 free reports to start.">
  <link rel="canonical" href="https://roofmanager.ca/pricing">
  <meta property="og:title" content="Roof Report Pricing — From $5/Report (100-Pack)">
  <meta property="og:description" content="AI-powered roof measurement reports with full CRM. 3 free reports, then pay per report or buy credit packs.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://roofmanager.ca/pricing">
  <meta property="og:image" content="https://roofmanager.ca/static/logo.png">
  <meta property="og:site_name" content="Roof Manager">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="Roof Manager Pricing — From $5/Report">
  <meta name="twitter:description" content="AI roof measurements with full CRM. 3 free reports included.">
  <meta name="twitter:image" content="https://roofmanager.ca/static/logo.png">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Roof Manager Roof Measurement Reports",
    "description": "AI-powered satellite roof measurement reports with CRM, invoicing, proposals, and team management.",
    "image": "https://roofmanager.ca/static/logo.png",
    "brand": {"@type": "Brand", "name": "Roof Manager"},
    "offers": [
      {"@type": "Offer", "name": "Individual Report", "price": "7.00", "priceCurrency": "USD", "description": "Single roof measurement report"},
      {"@type": "Offer", "name": "25-Pack", "price": "150.00", "priceCurrency": "USD", "description": "25 roof measurement reports — $6/each (save 14%)"},
      {"@type": "Offer", "name": "100-Pack", "price": "500.00", "priceCurrency": "USD", "description": "100 roof measurement reports — $5/each (save 29%)"}
    ]
  }
  </script>
</head>
<body class="bg-gray-50 min-h-screen">
  <nav class="bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
      <a href="/" class="flex items-center gap-3">
        <img src="/static/logo.png" alt="Roof Manager" class="w-9 h-9 rounded-lg object-cover">
        <span class="text-white font-bold text-lg">Roof Manager</span>
      </a>
      <div class="flex items-center gap-4">
        <a href="/" class="text-brand-200 hover:text-white text-sm">Home</a>
        <a href="/customer/login" class="bg-accent-500 hover:bg-accent-600 text-white font-semibold py-2 px-5 rounded-lg text-sm"><i class="fas fa-sign-in-alt mr-1"></i>Get Started</a>
      </div>
    </div>
  </nav>
  <main class="max-w-6xl mx-auto px-4 py-16">
    <div id="pricing-root">
      <div class="text-center mb-12">
        <h1 class="text-2xl sm:text-4xl font-bold text-gray-900 mb-4">Simple, Transparent Pricing</h1>
        <p class="text-lg text-gray-600 max-w-2xl mx-auto">Professional AI-powered roof measurement reports. Pay per report or save with credit packs.</p>
      </div>
      <div class="text-center animate-pulse text-gray-400 py-8">Loading pricing...</div>
    </div>
  </main>
  ${getContactFormHTML('pricing')}
  <script src="/static/pricing.js"></script>
  ${getRoverWidget()}
</body>
</html>`
}

// ============================================================
// BLOG LISTING PAGE — Public SEO lead funnel
// ============================================================
function getBlogListingHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Blog - Roof Manager | Roofing Industry Insights & Tips</title>
  <meta name="description" content="Expert roofing industry insights, measurement technology tips, contractor business guides, and more from Roof Manager.">
  <meta property="og:title" content="Roof Manager Blog - Roofing Industry Insights">
  <meta property="og:description" content="Expert roofing industry insights, measurement technology tips, contractor business guides, and more.">
  <meta property="og:type" content="website">
  <meta property="og:image" content="https://roofmanager.ca/static/logo.png">
  <meta property="og:site_name" content="Roof Manager">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="Roof Manager Blog — Roofing Industry Insights">
  <meta name="twitter:description" content="Expert roofing industry insights, measurement tips, and contractor business guides.">
  <meta name="twitter:image" content="https://roofmanager.ca/static/logo.png">
  <link rel="canonical" href="https://www.roofmanager.ca/blog">
</head>
<body class="bg-gray-50 min-h-screen">
  <!-- Navigation — Matches new homepage style -->
  <nav class="bg-slate-900 text-white sticky top-0 z-50">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
      <a href="/" class="flex items-center gap-3">
        <img src="/static/logo.png" alt="Roof Manager" class="w-9 h-9 rounded-lg object-cover">
        <span class="text-white font-bold text-lg tracking-tight">Roof Manager</span>
      </a>
      <div class="hidden md:flex items-center gap-5">
        <a href="/" class="text-gray-400 hover:text-white text-sm font-medium">Home</a>
        <a href="/#pricing" class="text-gray-400 hover:text-white text-sm font-medium">Pricing</a>
        <a href="/blog" class="text-white font-semibold text-sm border-b-2 border-cyan-400 pb-0.5">Blog</a>
        <a href="/lander" class="text-gray-400 hover:text-white text-sm font-medium">Get Started</a>
        <a href="/customer/login" class="bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white font-semibold py-2 px-5 rounded-lg text-sm"><i class="fas fa-sign-in-alt mr-1"></i>Login</a>
      </div>
      <button class="md:hidden text-white text-xl" onclick="document.getElementById('blog-mobile-menu').classList.toggle('hidden')"><i class="fas fa-bars"></i></button>
    </div>
    <div id="blog-mobile-menu" class="hidden md:hidden bg-slate-800/98 backdrop-blur-xl border-t border-white/10">
      <div class="max-w-7xl mx-auto px-4 py-4 flex flex-col gap-1">
        <a href="/" class="text-gray-300 hover:text-white text-sm py-2.5 px-3 rounded-lg hover:bg-white/5">Home</a>
        <a href="/#pricing" class="text-gray-300 hover:text-white text-sm py-2.5 px-3 rounded-lg hover:bg-white/5">Pricing</a>
        <a href="/blog" class="text-white font-semibold text-sm py-2.5 px-3 rounded-lg bg-white/5">Blog</a>
        <a href="/lander" class="text-gray-300 hover:text-white text-sm py-2.5 px-3 rounded-lg hover:bg-white/5">Get Started</a>
        <a href="/customer/login" class="bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-semibold py-2.5 px-5 rounded-lg text-sm text-center mt-2"><i class="fas fa-sign-in-alt mr-1"></i>Login</a>
      </div>
    </div>
  </nav>

  <!-- Hero Section — Dark theme matching new brand -->
  <div class="bg-gradient-to-br from-slate-900 via-cyan-900 to-slate-900 text-white py-16 md:py-20">
    <div class="max-w-4xl mx-auto px-4 text-center">
      <div class="inline-flex items-center gap-2 bg-cyan-500/10 border border-cyan-400/30 rounded-full px-4 py-1.5 mb-6">
        <i class="fas fa-newspaper text-cyan-400 text-sm"></i>
        <span class="text-sm font-medium text-cyan-200">Industry Insights</span>
      </div>
      <h1 class="text-4xl md:text-5xl font-black mb-4 tracking-tight">The Roof Manager Blog</h1>
      <p class="text-lg md:text-xl text-gray-300 max-w-2xl mx-auto leading-relaxed">Roofing industry insights, AI measurement technology, contractor business tips, and everything you need to grow your roofing business.</p>
      <div class="mt-8 flex flex-wrap justify-center gap-3" id="blog-categories-hero"></div>
    </div>
  </div>

  <!-- Search + Filter Bar -->
  <div class="max-w-6xl mx-auto px-4 -mt-6 relative z-10 mb-8">
    <div class="bg-white rounded-xl shadow-lg p-4 flex flex-col md:flex-row items-center gap-4">
      <div class="flex-1 relative w-full">
        <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"></i>
        <input type="text" id="blog-search" placeholder="Search articles..." class="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 outline-none">
      </div>
      <div class="flex items-center gap-2 flex-wrap" id="blog-category-filters"></div>
    </div>
  </div>

  <!-- Blog Grid -->
  <main class="max-w-6xl mx-auto px-4 pb-20">
    <!-- Featured Post -->
    <div id="blog-featured" class="mb-12"></div>
    
    <!-- All Posts Grid -->
    <div id="blog-grid" class="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
      <div class="col-span-full text-center py-16">
        <div class="animate-pulse text-gray-400"><i class="fas fa-spinner fa-spin text-3xl mb-4"></i><p class="text-sm">Loading articles...</p></div>
      </div>
    </div>
    
    <!-- Load More -->
    <div id="blog-load-more" class="text-center mt-12 hidden">
      <button onclick="loadMorePosts()" class="bg-white border-2 border-cyan-500 text-cyan-600 hover:bg-cyan-50 font-semibold py-3 px-8 rounded-lg text-sm transition-all">
        Load More Articles
      </button>
    </div>
    
    <!-- Empty State -->
    <div id="blog-empty" class="hidden text-center py-20">
      <i class="fas fa-newspaper text-6xl text-gray-200 mb-6"></i>
      <h3 class="text-xl font-bold text-gray-600 mb-2">No articles yet</h3>
      <p class="text-gray-400 text-sm">Check back soon — we're writing great content for roofing professionals!</p>
    </div>

    <!-- Funnel CTA — Every blog reader gets pushed to lander -->
    <div class="mt-16 bg-gradient-to-r from-slate-900 via-cyan-900 to-slate-900 rounded-2xl p-8 md:p-12 text-center text-white">
      <h3 class="text-2xl md:text-3xl font-black mb-3 tracking-tight">Ready to Try It Yourself?</h3>
      <p class="text-gray-300 mb-6 max-w-xl mx-auto">Get 3 free professional roof measurement reports. No credit card required. Full CRM included.</p>
      <a href="/lander" class="inline-flex items-center gap-2 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400 text-white font-bold py-3 px-8 rounded-xl shadow-lg transition-all hover:scale-[1.02]">
        <i class="fas fa-gift"></i>
        Claim Your 3 Free Reports
        <i class="fas fa-arrow-right text-sm ml-1"></i>
      </a>
    </div>
  </main>

  <!-- Contact Us Lead Capture -->
  ${getContactFormHTML('blog')}

  <!-- Footer — Dark style matching new brand -->
  <footer class="bg-slate-900 text-gray-500 border-t border-gray-800">
    <div class="max-w-7xl mx-auto px-4 py-12">
      <div class="flex flex-col md:flex-row items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <img src="/static/logo.png" alt="Roof Manager" class="w-8 h-8 rounded-lg object-cover">
          <span class="text-gray-300 font-bold">Roof Manager</span>
        </div>
        <div class="flex flex-wrap items-center gap-3 sm:gap-6 text-sm">
          <a href="/" class="hover:text-cyan-400 transition-colors">Home</a>
          <a href="/#pricing" class="hover:text-cyan-400 transition-colors">Pricing</a>
          <a href="/blog" class="text-cyan-400 font-semibold">Blog</a>
          <a href="/lander" class="hover:text-cyan-400 transition-colors">Get Started</a>
          <a href="/customer/login" class="hover:text-cyan-400 transition-colors">Login</a>
          <a href="/privacy" class="hover:text-cyan-400 transition-colors">Privacy</a>
          <a href="/terms" class="hover:text-cyan-400 transition-colors">Terms</a>
        </div>
        <p class="text-xs text-gray-600">&copy; 2026 Roof Manager. All rights reserved.</p>
      </div>
    </div>
  </footer>

  <script src="/static/blog.js"></script>
  ${getRoverWidget()}
</body>
</html>`
}

// ============================================================
// BLOG POST PAGE — Individual article view with SEO
// ============================================================
function getBlogPostHTML(post?: any, slug?: string) {
  const title = post ? (post.meta_title || post.title) + ' — Roof Manager Blog' : 'Blog Post - Roof Manager'
  const desc = post ? (post.meta_description || post.excerpt || '') : ''
  const image = post?.cover_image_url || 'https://roofmanager.ca/static/logo.png'
  const canonical = slug ? `https://www.roofmanager.ca/blog/${slug}` : ''
  const published = post?.published_at || ''
  const updated = post?.updated_at || ''
  const author = post?.author_name || 'Roof Manager Team'
  const blogSchema = post ? `<script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BlogPosting","headline":"${(post.title || '').replace(/"/g, '\\"')}","description":"${(desc).replace(/"/g, '\\"')}","image":"${image}","datePublished":"${published}","dateModified":"${updated || published}","author":{"@type":"Organization","name":"${author}"},"publisher":{"@type":"Organization","name":"Roof Manager","logo":{"@type":"ImageObject","url":"https://roofmanager.ca/static/logo.png"}}}
  </script>` : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title id="page-title">${title}</title>
  <meta name="description" id="meta-desc" content="${desc.replace(/"/g, '&quot;')}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${title.replace(/"/g, '&quot;')}">
  <meta property="og:description" content="${desc.replace(/"/g, '&quot;')}">
  <meta property="og:image" content="${image}">
  <meta property="og:site_name" content="Roof Manager">
  ${canonical ? `<link rel="canonical" href="${canonical}">` : ''}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title.replace(/"/g, '&quot;')}">
  <meta name="twitter:description" content="${desc.replace(/"/g, '&quot;')}">
  <meta name="twitter:image" content="${image}">
  ${blogSchema}
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tailwindcss/typography@0.5.0/dist/typography.min.css">
</head>
<body class="bg-gray-50 min-h-screen">
  <!-- Navigation -->
  <nav class="bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg sticky top-0 z-50">
    <div class="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
      <a href="/" class="flex items-center gap-3">
        <img src="/static/logo.png" alt="Roof Manager" class="w-9 h-9 rounded-lg object-cover">
        <span class="text-white font-bold text-lg">Roof Manager</span>
      </a>
      <div class="hidden md:flex items-center gap-5">
        <a href="/" class="text-brand-200 hover:text-white text-sm">Home</a>
        <a href="/pricing" class="text-brand-200 hover:text-white text-sm">Pricing</a>
        <a href="/blog" class="text-white font-semibold text-sm">Blog</a>
        <a href="/customer/login" class="bg-accent-500 hover:bg-accent-600 text-white font-semibold py-2 px-5 rounded-lg text-sm"><i class="fas fa-sign-in-alt mr-1"></i>Get Started</a>
      </div>
      <button class="md:hidden text-white text-xl" onclick="document.getElementById('bp-mobile').classList.toggle('hidden')"><i class="fas fa-bars"></i></button>
    </div>
    <div id="bp-mobile" class="hidden md:hidden bg-sky-600/95 backdrop-blur-md border-t border-sky-400">
      <div class="max-w-7xl mx-auto px-4 py-4 flex flex-col gap-3">
        <a href="/" class="text-brand-200 hover:text-white text-sm py-2">Home</a>
        <a href="/blog" class="text-white font-semibold text-sm py-2">Blog</a>
        <a href="/customer/login" class="bg-accent-500 text-white font-semibold py-2.5 px-5 rounded-lg text-sm text-center mt-2"><i class="fas fa-sign-in-alt mr-1"></i>Get Started</a>
      </div>
    </div>
  </nav>

  <!-- Breadcrumb -->
  <div class="max-w-4xl mx-auto px-4 py-4">
    <nav class="text-sm text-gray-500">
      <a href="/" class="hover:text-sky-600">Home</a>
      <span class="mx-2">/</span>
      <a href="/blog" class="hover:text-sky-600">Blog</a>
      <span class="mx-2">/</span>
      <span id="breadcrumb-title" class="text-gray-700 font-medium">Loading...</span>
    </nav>
  </div>

  <!-- Article Content -->
  <main class="max-w-4xl mx-auto px-4 pb-20">
    <article id="blog-post-content">
      <div class="text-center py-16 animate-pulse text-gray-400"><i class="fas fa-spinner fa-spin text-3xl mb-4"></i><p>Loading article...</p></div>
    </article>

    <!-- Author / CTA Box -->
    <div id="blog-cta" class="hidden mt-12 bg-gradient-to-br from-sky-50 to-blue-50 border border-sky-200 rounded-2xl p-8 text-center">
      <h3 class="text-xl font-bold text-gray-900 mb-2">Ready to streamline your roof measurements?</h3>
      <p class="text-gray-600 mb-6 max-w-lg mx-auto">Join hundreds of roofing professionals who save hours on every estimate with AI-powered measurement reports.</p>
      <div class="flex flex-col sm:flex-row items-center justify-center gap-4">
        <a href="/customer/login" class="bg-accent-500 hover:bg-accent-600 text-white font-semibold py-3 px-8 rounded-lg transition-all hover:scale-105 shadow-lg shadow-accent-500/25"><i class="fas fa-rocket mr-2"></i>Start Free Trial</a>
        <a href="/pricing" class="text-sky-600 hover:text-sky-700 font-semibold text-sm"><i class="fas fa-tag mr-1"></i>View Pricing</a>
      </div>
    </div>

    <!-- Related Posts -->
    <div id="blog-related" class="mt-16 hidden">
      <h3 class="text-xl font-bold text-gray-900 mb-6">Related Articles</h3>
      <div id="blog-related-grid" class="grid md:grid-cols-3 gap-6"></div>
    </div>
  </main>

  <!-- Contact Us Lead Capture -->
  ${getContactFormHTML('blog-post')}

  <!-- Footer -->
  <footer class="bg-slate-100 text-gray-600 border-t border-slate-200">
    <div class="max-w-7xl mx-auto px-4 py-12">
      <div class="flex flex-col md:flex-row items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <img src="/static/logo.png" alt="Roof Manager" class="w-8 h-8 rounded-lg object-cover">
          <span class="text-gray-800 font-bold">Roof Manager</span>
        </div>
        <div class="flex flex-wrap items-center gap-3 sm:gap-6 text-sm">
          <a href="/" class="hover:text-sky-600">Home</a>
          <a href="/blog" class="hover:text-sky-600 font-semibold text-sky-600">Blog</a>
          <a href="/customer/login" class="hover:text-sky-600">Login</a>
          <a href="/privacy" class="hover:text-sky-600">Privacy</a>
          <a href="/terms" class="hover:text-sky-600">Terms</a>
        </div>
        <p class="text-xs text-gray-400">&copy; 2026 Roof Manager. All rights reserved.</p>
      </div>
    </div>
  </footer>

  <script src="/static/blog.js"></script>
  ${getRoverWidget()}
</body>
</html>`
}

// ============================================================
// LANDING FUNNEL — Social media, blog, FB/IG traffic
// All social posts and blog links redirect here
// ============================================================
function getLanderFunnelHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Get Your Free Roof Measurement Report - Roof Manager</title>
  <meta name="description" content="Professional satellite-powered roof measurement reports in under 60 seconds. Start with 3 FREE reports. No credit card required. Used by roofing contractors across Canada.">
  <meta property="og:title" content="Free Roof Measurement Reports - Roof Manager">
  <meta property="og:description" content="Get accurate roof area, pitch, material BOM, and more in 60 seconds. 3 free reports. No credit card.">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://roofmanager.ca/lander">
  <meta property="og:image" content="https://roofmanager.ca/static/logo.png">
  <meta property="og:site_name" content="Roof Manager">
  <link rel="canonical" href="https://www.roofmanager.ca/lander">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="Free Roof Measurement Reports — Roof Manager">
  <meta name="twitter:description" content="Get accurate roof area, pitch, material BOM in 60 seconds. 3 free reports, no credit card.">
  <meta name="twitter:image" content="https://roofmanager.ca/static/logo.png">
  <style>
    html { scroll-behavior: smooth; }
    .scroll-animate { opacity: 0; transform: translateY(20px); transition: all 0.7s cubic-bezier(0.4, 0, 0.2, 1); }
    .scroll-animate.animate-in { opacity: 1 !important; transform: translateY(0) !important; }
    @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-10px); } }
    .float-anim { animation: float 3s ease-in-out infinite; }
  </style>
</head>
<body class="bg-white min-h-screen">
  <!-- Minimal top bar -->
  <nav class="bg-slate-900 text-white">
    <div class="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
      <a href="/" class="flex items-center gap-2">
        <img src="/static/logo.png" alt="Roof Manager" class="w-7 h-7 rounded-md object-cover">
        <span class="text-white font-bold text-sm">Roof Manager</span>
      </a>
      <a href="/customer/login" class="bg-gradient-to-r from-cyan-500 to-blue-500 text-white text-sm font-semibold py-1.5 px-4 rounded-lg hover:opacity-90 transition-opacity">Sign Up Free</a>
    </div>
  </nav>

  <!-- HERO — High-impact conversion section -->
  <section class="relative overflow-hidden bg-gradient-to-br from-slate-900 via-cyan-900 to-slate-900 text-white py-20 lg:py-28">
    <div class="absolute inset-0 opacity-10">
      <div class="absolute inset-0" style="background-image: radial-gradient(circle, rgba(34,211,238,0.3) 1px, transparent 1px); background-size: 30px 30px;"></div>
    </div>

    <div class="relative max-w-6xl mx-auto px-4">
      <div class="grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <div class="inline-flex items-center gap-2 bg-green-500/10 border border-green-400/30 rounded-full px-4 py-1.5 mb-6">
            <i class="fas fa-gift text-green-400 text-sm"></i>
            <span class="text-sm font-medium text-green-300">3 FREE Reports on Signup — No Credit Card</span>
          </div>

          <h1 class="text-4xl lg:text-6xl font-black leading-tight mb-6 tracking-tight">
            Stop Climbing Roofs.<br/>
            <span class="bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 to-blue-300">Start Measuring Smarter.</span>
          </h1>

          <p class="text-lg text-gray-300 mb-8 leading-relaxed max-w-xl">
            Get a <strong class="text-white">professional roof measurement report</strong> from satellite imagery in under 60 seconds. Accurate area, pitch, edge breakdowns, and a full material BOM — everything you need to quote a job.
          </p>

          <div class="flex flex-col sm:flex-row gap-4 mb-6">
            <a href="/customer/login" class="group inline-flex items-center gap-3 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400 text-white font-bold py-4 px-10 rounded-xl text-lg shadow-2xl shadow-green-500/25 transition-all hover:scale-[1.02]">
              <i class="fas fa-rocket"></i>
              Claim Your 3 Free Reports
              <i class="fas fa-arrow-right text-sm group-hover:translate-x-1 transition-transform"></i>
            </a>
            <a href="https://calendar.app.google/CE5iBMV1Fu4K2ve38" target="_blank" class="group inline-flex items-center gap-3 bg-white/10 hover:bg-white/20 text-white font-bold py-4 px-10 rounded-xl text-lg border border-white/20 hover:border-white/30 transition-all">
              <i class="fas fa-calendar-check"></i>
              Book a Demo
            </a>
          </div>

          <div class="flex flex-wrap items-center gap-3 sm:gap-6 text-sm text-gray-400">
            <span class="flex items-center gap-1.5"><i class="fas fa-check text-green-400"></i> No credit card</span>
            <span class="flex items-center gap-1.5"><i class="fas fa-check text-green-400"></i> 60-second delivery</span>
            <span class="flex items-center gap-1.5"><i class="fas fa-check text-green-400"></i> Full CRM free</span>
          </div>
        </div>

        <!-- Floating report preview -->
        <div class="hidden lg:block">
          <div class="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-6 float-anim">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-10 h-10 bg-cyan-500/20 rounded-lg flex items-center justify-center">
                <i class="fas fa-file-alt text-cyan-400"></i>
              </div>
              <div>
                <p class="font-bold text-white text-sm">Roof Measurement Report</p>
                <p class="text-xs text-gray-400">Generated in 42 seconds</p>
              </div>
              <span class="ml-auto bg-green-500/20 text-green-300 text-xs px-2.5 py-1 rounded-full font-medium">HIGH Quality</span>
            </div>
            <div class="grid grid-cols-3 gap-3 mb-4">
              <div class="bg-white/5 rounded-lg p-3 text-center">
                <p class="text-xl font-bold text-cyan-300">3,826</p>
                <p class="text-[10px] text-gray-500 uppercase">Area (ft²)</p>
              </div>
              <div class="bg-white/5 rounded-lg p-3 text-center">
                <p class="text-xl font-bold text-blue-300">12</p>
                <p class="text-[10px] text-gray-500 uppercase">Segments</p>
              </div>
              <div class="bg-white/5 rounded-lg p-3 text-center">
                <p class="text-xl font-bold text-amber-300">21.6°</p>
                <p class="text-[10px] text-gray-500 uppercase">Avg Pitch</p>
              </div>
            </div>
            <div class="bg-white/5 rounded-lg p-3">
              <div class="flex justify-between text-sm">
                <span class="text-gray-400">Material Estimate</span>
                <span class="font-bold text-white">$8,427 CAD</span>
              </div>
              <div class="flex justify-between text-xs text-gray-500 mt-1">
                <span>132 bundles | 44 squares | 15% waste</span>
                <span class="text-amber-400">Very Complex</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- WHAT YOU GET — Quick feature list -->
  <section class="py-16 bg-gray-50">
    <div class="max-w-6xl mx-auto px-4">
      <div class="text-center mb-12 scroll-animate">
        <h2 class="text-3xl font-black text-gray-900 mb-3 tracking-tight">What's in Every $8 Report</h2>
        <p class="text-gray-500">Your first 3 are FREE. Full professional report, no restrictions.</p>
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        ${[
          { icon: 'fas fa-ruler-combined', title: 'True 3D Area', desc: 'Pitch-adjusted surface area, not footprint' },
          { icon: 'fas fa-draw-polygon', title: 'Edge Breakdown', desc: 'Ridge, hip, valley, eave — plan & 3D' },
          { icon: 'fas fa-boxes-stacked', title: 'Full Material BOM', desc: 'Shingles, underlayment, flashing, nails' },
          { icon: 'fas fa-layer-group', title: 'Segment Analysis', desc: 'Pitch, azimuth, direction per plane' },
          { icon: 'fas fa-solar-panel', title: 'Solar Potential', desc: 'Panel count & yearly energy — free' },
          { icon: 'fas fa-chart-pie', title: 'Complexity Rating', desc: 'Waste factor & difficulty score' },
        ].map(f => '<div class="scroll-animate bg-white rounded-xl p-5 border border-gray-200 hover:border-cyan-200 hover:shadow-lg transition-all"><div class="flex items-start gap-4"><div class="w-10 h-10 bg-cyan-50 rounded-lg flex items-center justify-center flex-shrink-0"><i class="' + f.icon + ' text-cyan-600"></i></div><div><h3 class="font-bold text-gray-900 text-sm mb-1">' + f.title + '</h3><p class="text-xs text-gray-500">' + f.desc + '</p></div></div></div>').join('')}
      </div>
    </div>
  </section>

  <!-- SOCIAL PROOF — Quick testimonials -->
  <section class="py-16 bg-white">
    <div class="max-w-4xl mx-auto px-4">
      <div class="text-center mb-10 scroll-animate">
        <h2 class="text-2xl font-black text-gray-900 tracking-tight">Trusted by Roofers Across Canada</h2>
      </div>
      <div class="grid md:grid-cols-3 gap-6">
        ${[
          { quote: 'Saves me 2 hours per estimate. I quote jobs from my truck now.', name: 'Mike D.', title: 'Calgary', avatar: 'MD' },
          { quote: 'The BOM alone is worth $8. Supplier orders are dead accurate.', name: 'Sarah K.', title: 'Edmonton', avatar: 'SK' },
          { quote: '15-20 estimates a week at $8 each. Way cheaper than drones.', name: 'James R.', title: 'Prairie Roofing', avatar: 'JR' }
        ].map(t => '<div class="scroll-animate bg-gray-50 rounded-xl p-5 border border-gray-100"><div class="flex gap-1 mb-3">' + [1,2,3,4,5].map(() => '<i class="fas fa-star text-amber-400 text-xs"></i>').join('') + '</div><p class="text-sm text-gray-600 mb-4">"' + t.quote + '"</p><div class="flex items-center gap-2"><div class="w-8 h-8 bg-cyan-500 rounded-full flex items-center justify-center text-white text-xs font-bold">' + t.avatar + '</div><div><p class="text-sm font-semibold text-gray-800">' + t.name + '</p><p class="text-xs text-gray-400">' + t.title + '</p></div></div></div>').join('')}
      </div>
    </div>
  </section>

  <!-- PLATFORM PREVIEW — More than reports -->
  <section class="py-16 bg-gradient-to-b from-gray-50 to-white">
    <div class="max-w-6xl mx-auto px-4">
      <div class="text-center mb-12 scroll-animate">
        <h2 class="text-3xl font-black text-gray-900 mb-3 tracking-tight">More Than Just Reports</h2>
        <p class="text-gray-500">A full business management platform for roofing companies.</p>
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
        ${[
          { icon: 'fas fa-phone-alt', title: 'AI Phone Secretary', desc: '24/7 AI answers calls, books leads. $149/mo.', color: 'from-indigo-500 to-purple-500' },
          { icon: 'fas fa-th-large', title: 'Full CRM', desc: 'Customers, invoices, proposals, jobs. FREE.', color: 'from-cyan-500 to-blue-500' },
          { icon: 'fas fa-palette', title: 'Virtual Try-On', desc: 'AI roof visualization for homeowners.', color: 'from-pink-500 to-rose-500' },
          { icon: 'fas fa-door-open', title: 'D2D Manager', desc: 'Door-to-door sales tracking & maps.', color: 'from-emerald-500 to-teal-500' },
        ].map(f => '<div class="scroll-animate bg-white rounded-xl p-6 border border-gray-200 hover:shadow-xl transition-all text-center"><div class="w-12 h-12 mx-auto mb-3 rounded-xl bg-gradient-to-br ' + f.color + ' flex items-center justify-center"><i class="' + f.icon + ' text-white"></i></div><h3 class="font-bold text-gray-900 text-sm mb-1">' + f.title + '</h3><p class="text-xs text-gray-500">' + f.desc + '</p></div>').join('')}
      </div>
    </div>
  </section>

  <!-- FINAL CTA — Strong conversion -->
  <section class="py-20 bg-gradient-to-br from-slate-900 via-cyan-900 to-slate-900 text-white relative overflow-hidden">
    <div class="absolute inset-0 opacity-5">
      <div class="absolute inset-0" style="background-image: radial-gradient(circle, white 1px, transparent 1px); background-size: 24px 24px;"></div>
    </div>
    <div class="relative max-w-3xl mx-auto px-4 text-center scroll-animate">
      <h2 class="text-3xl lg:text-5xl font-black mb-6 tracking-tight leading-tight">
        Your Next 3 Reports<br/>Are On Us
      </h2>
      <p class="text-lg text-gray-300 mb-10 max-w-xl mx-auto">
        Sign up in 30 seconds, get 3 free professional roof measurement reports, and access the full CRM — no credit card required.
      </p>
      <div class="flex flex-col sm:flex-row gap-4 justify-center">
        <a href="/customer/login" class="group inline-flex items-center gap-3 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400 text-white font-bold py-4 px-12 rounded-xl text-lg shadow-2xl shadow-green-500/25 transition-all hover:scale-[1.02]">
          <i class="fas fa-rocket"></i>
          Start Free Now
          <i class="fas fa-arrow-right text-sm group-hover:translate-x-1 transition-transform"></i>
        </a>
        <a href="https://calendar.app.google/CE5iBMV1Fu4K2ve38" target="_blank" class="group inline-flex items-center gap-3 bg-white/10 hover:bg-white/20 text-white font-bold py-4 px-10 rounded-xl text-lg border border-white/20 hover:border-white/30 transition-all">
          <i class="fas fa-calendar-check"></i>
          Book a Demo
        </a>
      </div>
      <p class="text-sm text-gray-400 mt-6">Then $7 USD per report. No subscriptions. Cancel anytime. <a href="/privacy" class="underline hover:text-gray-200">Privacy Policy</a> · <a href="/terms" class="underline hover:text-gray-200">Terms</a></p>
    </div>
  </section>

  <!-- Contact Us Lead Capture -->
  ${getContactFormHTML('lander')}

  <!-- Mini footer -->
  <footer class="bg-slate-900 text-gray-500 py-8 border-t border-gray-800">
    <div class="max-w-4xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
      <div class="flex items-center gap-2">
        <img src="/static/logo.png" alt="Roof Manager" class="w-6 h-6 rounded object-cover">
        <span class="text-sm font-semibold text-gray-400">Roof Manager</span>
      </div>
      <div class="flex flex-wrap items-center gap-3 sm:gap-6 text-sm">
        <a href="/" class="hover:text-cyan-400 transition-colors">Home</a>
        <a href="/blog" class="hover:text-cyan-400 transition-colors">Blog</a>
        <a href="/customer/login" class="hover:text-cyan-400 transition-colors">Login</a>
        <a href="mailto:sales@roofmanager.ca" class="hover:text-cyan-400 transition-colors">Contact</a>
        <a href="/privacy" class="hover:text-cyan-400 transition-colors">Privacy</a>
        <a href="/terms" class="hover:text-cyan-400 transition-colors">Terms</a>
      </div>
      <p class="text-xs">&copy; 2026 Roof Manager</p>
    </div>
  </footer>

  <script>
    // Scroll animation
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add('animate-in'); obs.unobserve(entry.target); }
      });
    }, { threshold: 0.1 });
    document.querySelectorAll('.scroll-animate').forEach(el => obs.observe(el));
  </script>
  ${getRoverWidget()}
</body>
</html>`
}

// ============================================================
// CUSTOMER ORDER PAGE — Address entry + pay or use credit
// ============================================================
function getCustomerOrderPageHTML(mapsApiKey: string) {
  const mapsScript = mapsApiKey
    ? `<script>
      var googleMapsReady = false;
      function onCustomerMapsReady() {
        googleMapsReady = true;
        console.log('[Maps] Google Maps API loaded with Places library');
        if (typeof initMap === 'function') initMap();
      }
    </script>
    <script src="https://maps.googleapis.com/maps/api/js?key=${mapsApiKey}&libraries=places&callback=onCustomerMapsReady" async defer></script>`
    : '<!-- Google Maps: No API key configured -->'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Order a Report - Roof Manager</title>
  ${mapsScript}
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
      <a href="/customer/dashboard" class="flex items-center space-x-3 hover:opacity-90">
        <img src="/static/logo.png" alt="Roof Manager" class="w-10 h-10 rounded-lg object-cover">
        <div>
          <h1 class="text-xl font-bold">Order a Report</h1>
          <p class="text-brand-200 text-xs">Roof Manager</p>
        </div>
      </a>
      <nav class="flex items-center space-x-4">
        <span id="creditsBadge" class="hidden bg-green-500/20 text-green-300 px-3 py-1.5 rounded-full text-sm font-medium"><i class="fas fa-coins mr-1"></i><span id="creditsCount">0</span> credits</span>
        <a href="/customer/dashboard" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-arrow-left mr-1"></i>Dashboard</a>
      </nav>
    </div>
  </header>
  <main class="max-w-4xl mx-auto px-4 py-8">
    <div id="order-root"></div>
  </main>
  <script>
    (function() {
      var c = localStorage.getItem('rc_customer');
      if (!c) { window.location.href = '/customer/login'; return; }
    })();
  </script>
  <script src="/static/customer-order.js?v=${Date.now()}"></script>
  ${getRoverAssistant()}
</body>
</html>`
}

// ============================================================
// CUSTOMER PROFILE / ACCOUNT SETTINGS PAGE
// ============================================================
function getCustomerProfilePageHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Account Settings - Roof Manager</title>
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <a href="/customer/dashboard" class="flex items-center space-x-3 hover:opacity-90">
          <img src="/static/logo.png" alt="Roof Manager" class="w-10 h-10 rounded-lg object-cover">
          <div>
            <h1 class="text-xl font-bold">Account Settings</h1>
            <p class="text-blue-200 text-xs">Manage your profile, branding &amp; preferences</p>
          </div>
        </a>
      </div>
      <nav class="flex items-center space-x-4">
        <a href="/customer/dashboard" class="text-blue-200 hover:text-white text-sm"><i class="fas fa-arrow-left mr-1"></i>Dashboard</a>
        <button onclick="custLogout()" class="text-blue-200 hover:text-white text-sm"><i class="fas fa-sign-out-alt mr-1"></i>Logout</button>
      </nav>
    </div>
  </header>
  <main class="max-w-4xl mx-auto px-4 py-8">
    <div id="profile-root"></div>
  </main>
  <script>
    (function() {
      var c = localStorage.getItem('rc_customer');
      if (!c) { window.location.href = '/customer/login'; return; }
    })();
    function custLogout() {
      var token = localStorage.getItem('rc_customer_token');
      if (token) fetch('/api/customer/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } })['catch'](function(){});
      localStorage.removeItem('rc_customer');
      localStorage.removeItem('rc_customer_token');
      window.location.href = '/customer/login';
    }
  </script>
  <script src="/static/customer-profile.js?v=${Date.now()}"></script>
  ${getRoverAssistant()}
</body>
</html>`
}

// ============================================================
// VIRTUAL TRY-ON PAGE — AI Roof Visualization
// ============================================================
function getVirtualTryOnPageHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Roof Visualizer - Roof Manager</title>
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <a href="/customer/dashboard" class="flex items-center space-x-3 hover:opacity-90">
          <img src="/static/logo.png" alt="Roof Manager" class="w-10 h-10 rounded-lg object-cover">
          <div>
            <h1 class="text-lg font-bold">Roof Visualizer</h1>
            <p class="text-brand-200 text-xs">AI-Powered Material &amp; Color Preview</p>
          </div>
        </a>
      </div>
      <nav class="flex items-center space-x-3">
        <span id="custGreeting" class="text-brand-200 text-sm hidden"><i class="fas fa-user-circle mr-1"></i><span id="custName"></span></span>
        <a href="/customer/dashboard" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-th-large mr-1"></i>Dashboard</a>
        <button onclick="custLogout()" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-sign-out-alt mr-1"></i>Logout</button>
      </nav>
    </div>
  </header>
  <main class="max-w-6xl mx-auto px-4 py-6">
    <div id="tryon-root"></div>
  </main>
  <script>
    (function() {
      var c = localStorage.getItem('rc_customer');
      if (!c) { window.location.href = '/customer/login'; return; }
      try {
        var u = JSON.parse(c);
        var g = document.getElementById('custGreeting');
        var n = document.getElementById('custName');
        if (g && n) { n.textContent = u.name || u.email; g.classList.remove('hidden'); }
      } catch(e) {}
    })();
    function custLogout() {
      var token = localStorage.getItem('rc_customer_token');
      if (token) fetch('/api/customer/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } })['catch'](function(){});
      localStorage.removeItem('rc_customer');
      localStorage.removeItem('rc_customer_token');
      window.location.href = '/customer/login';
    }
  </script>
  <script src="/static/virtual-tryon.js?v=${Date.now()}"></script>
  ${getRoverAssistant()}
</body>
</html>`
}

// ============================================================
// TEAM MANAGEMENT PAGE — Add/manage sales team members
// ============================================================
function getTeamManagementPageHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Team Management - Roof Manager</title>
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <a href="/customer/dashboard" class="flex items-center space-x-3 hover:opacity-90">
          <img src="/static/logo.png" alt="Roof Manager" class="w-10 h-10 rounded-lg object-cover">
          <div>
            <h1 class="text-lg font-bold">Team Management</h1>
            <p class="text-brand-200 text-xs">Add sales team members - $50/user/month</p>
          </div>
        </a>
      </div>
      <nav class="flex items-center space-x-3">
        <span id="custGreeting" class="text-brand-200 text-sm hidden"><i class="fas fa-user-circle mr-1"></i><span id="custName"></span></span>
        <a href="/customer/dashboard" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-th-large mr-1"></i>Dashboard</a>
        <button onclick="custLogout()" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-sign-out-alt mr-1"></i>Logout</button>
      </nav>
    </div>
  </header>
  <main class="max-w-5xl mx-auto px-4 py-6">
    <div id="team-root"></div>
  </main>
  <script>
    (function() {
      var c = localStorage.getItem('rc_customer');
      if (!c) { window.location.href = '/customer/login'; return; }
      try {
        var u = JSON.parse(c);
        var g = document.getElementById('custGreeting');
        var n = document.getElementById('custName');
        if (g && n) { n.textContent = u.name || u.email; g.classList.remove('hidden'); }
      } catch(e) {}
    })();
    function custLogout() {
      var token = localStorage.getItem('rc_customer_token');
      if (token) fetch('/api/customer/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } })['catch'](function(){});
      localStorage.removeItem('rc_customer');
      localStorage.removeItem('rc_customer_token');
      window.location.href = '/customer/login';
    }
  </script>
  <script src="/static/team-management.js"></script>
  ${getRoverAssistant()}
</body>
</html>`
}

// ============================================================
// JOIN TEAM PAGE — Accept invitation landing page
// ============================================================
function getJoinTeamPageHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Join Team - Roof Manager</title>
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
      <a href="/" class="flex items-center space-x-3">
        <img src="/static/logo.png" alt="Roof Manager" class="w-10 h-10 rounded-lg object-cover">
        <div>
          <h1 class="text-xl font-bold">Team Invitation</h1>
          <p class="text-brand-200 text-xs">Roof Manager</p>
        </div>
      </a>
    </div>
  </header>
  <main class="max-w-lg mx-auto px-4 py-12">
    <div id="join-root">
      <div class="flex items-center justify-center py-20">
        <div class="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-brand-500"></div>
        <span class="ml-3 text-gray-500">Validating invitation...</span>
      </div>
    </div>
  </main>
  <script>
    function getToken() { return localStorage.getItem('rc_customer_token') || ''; }
    (async function() {
      var root = document.getElementById('join-root');
      var params = new URLSearchParams(window.location.search);
      var inviteToken = params.get('token');
      if (!inviteToken) { root.innerHTML = '<div class="bg-red-50 border border-red-200 rounded-xl p-8 text-center"><i class="fas fa-exclamation-circle text-red-500 text-4xl mb-3"></i><p class="text-red-700 font-semibold text-lg">No invitation token provided</p><a href="/" class="mt-4 inline-block text-blue-600 hover:underline">Go to homepage</a></div>'; return; }

      // Validate the invite
      try {
        var res = await fetch('/api/team/invite/' + inviteToken);
        var data = await res.json();
        if (!res.ok || !data.valid) {
          root.innerHTML = '<div class="bg-red-50 border border-red-200 rounded-xl p-8 text-center"><i class="fas fa-times-circle text-red-500 text-4xl mb-3"></i><p class="text-red-700 font-semibold text-lg">' + (data.error || 'Invalid invitation') + '</p><a href="/" class="mt-4 inline-block text-blue-600 hover:underline">Go to homepage</a></div>';
          return;
        }

        var inv = data.invite;
        var isLoggedIn = !!getToken();

        root.innerHTML = '<div class="bg-white rounded-2xl shadow-xl border overflow-hidden">' +
          '<div class="bg-gradient-to-r from-teal-500 to-emerald-600 px-8 py-6 text-center text-white">' +
            '<i class="fas fa-user-plus text-4xl mb-2"></i>' +
            '<h2 class="text-2xl font-bold">You\\\'re Invited!</h2>' +
            '<p class="text-teal-100 mt-1">' + (inv.owner_name || '') + ' from <strong>' + (inv.owner_company || 'a roofing team') + '</strong></p>' +
          '</div>' +
          '<div class="px-8 py-6">' +
            '<div class="bg-gray-50 rounded-lg p-4 mb-4">' +
              '<p class="text-gray-700"><strong>Name:</strong> ' + inv.name + '</p>' +
              '<p class="text-gray-700"><strong>Role:</strong> ' + (inv.role === 'admin' ? 'Team Admin' : 'Team Member') + '</p>' +
              '<p class="text-gray-700"><strong>Email:</strong> ' + inv.email + '</p>' +
            '</div>' +
            '<div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">' +
              '<p class="text-blue-800 font-semibold text-sm mb-2"><i class="fas fa-check-circle mr-1"></i> Full access included:</p>' +
              '<ul class="text-blue-700 text-sm space-y-1 ml-5 list-disc">' +
                '<li>Order roof measurement reports</li>' +
                '<li>Full CRM (customers, invoices, proposals, jobs)</li>' +
                '<li>AI Roofer Secretary</li>' +
                '<li>Virtual Roof Try-On</li>' +
              '</ul>' +
            '</div>' +
            (isLoggedIn ?
              '<button id="btnAccept" onclick="acceptInvite(\\'' + inviteToken + '\\')" class="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-3 px-6 rounded-lg text-lg transition-all"><i class="fas fa-check mr-2"></i>Accept & Join Team</button>' :
              '<p class="text-gray-600 text-center mb-3">Please log in or create an account first:</p>' +
              '<a href="/customer/login?redirect=' + encodeURIComponent('/customer/join-team?token=' + inviteToken) + '" class="block w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg text-lg text-center transition-all"><i class="fas fa-sign-in-alt mr-2"></i>Log In to Accept</a>'
            ) +
            '<div id="acceptMsg" class="mt-3 text-center"></div>' +
          '</div>' +
        '</div>';
      } catch(err) {
        root.innerHTML = '<div class="bg-red-50 border border-red-200 rounded-xl p-8 text-center"><p class="text-red-700">Failed to load invitation</p></div>';
      }
    })();

    async function acceptInvite(token) {
      var btn = document.getElementById('btnAccept');
      var msg = document.getElementById('acceptMsg');
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Joining...';
      try {
        var res = await fetch('/api/team/accept', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ invite_token: token })
        });
        var data = await res.json();
        if (res.ok && data.success) {
          msg.innerHTML = '<div class="bg-green-50 border border-green-200 rounded-lg p-4 text-green-700"><i class="fas fa-check-circle mr-1"></i> ' + data.message + '</div>';
          btn.innerHTML = '<i class="fas fa-check mr-2"></i>Joined!';
          setTimeout(function() { window.location.href = '/customer/dashboard'; }, 1500);
        } else {
          msg.innerHTML = '<div class="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">' + (data.error || 'Failed to accept') + '</div>';
          btn.disabled = false; btn.innerHTML = '<i class="fas fa-check mr-2"></i>Accept & Join Team';
        }
      } catch(err) {
        msg.innerHTML = '<div class="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">Network error</div>';
        btn.disabled = false; btn.innerHTML = '<i class="fas fa-check mr-2"></i>Accept & Join Team';
      }
    }
  </script>
</body>
</html>`
}

// ============================================================
// COMPANY TYPE SELECTION PAGE — Shown once after login if company_type is null
// ============================================================
function getSelectTypePageHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Select Company Type - Roof Manager</title>
</head>
<body class="bg-gray-50 min-h-screen flex flex-col">
  <header class="bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-4 py-4 flex items-center">
      <img src="/static/logo.png" alt="Roof Manager" class="w-10 h-10 rounded-lg object-cover mr-3">
      <div>
        <h1 class="text-xl font-bold">Roof Manager</h1>
        <p class="text-brand-200 text-xs">Measurement &amp; Proposal Platform</p>
      </div>
    </div>
  </header>
  <main class="flex-1 flex items-center justify-center px-4 py-12">
    <div class="max-w-2xl w-full">
      <div class="text-center mb-10">
        <h2 class="text-3xl font-bold text-gray-800 mb-3">What type of company are you?</h2>
        <p class="text-gray-500 text-lg">This helps us tailor your dashboard and tools.</p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Roofing Company Card -->
        <button onclick="selectType('roofing')" class="group bg-white rounded-2xl border-2 border-gray-200 hover:border-sky-500 p-8 text-left shadow-sm hover:shadow-lg transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-sky-200">
          <div class="w-16 h-16 bg-sky-100 group-hover:bg-sky-500 rounded-2xl flex items-center justify-center mb-5 transition-colors duration-200">
            <i class="fas fa-home text-3xl text-sky-500 group-hover:text-white transition-colors duration-200"></i>
          </div>
          <h3 class="text-xl font-bold text-gray-800 mb-2">Roofing Company</h3>
          <p class="text-gray-500 text-sm leading-relaxed">Order detailed roof measurement reports, track jobs and customers, and generate roofing proposals.</p>
          <div class="mt-5 flex items-center text-sky-600 font-semibold text-sm group-hover:text-sky-700">
            Select Roofing <i class="fas fa-arrow-right ml-2 group-hover:translate-x-1 transition-transform duration-200"></i>
          </div>
        </button>
        <!-- Solar Sales Company Card -->
        <button onclick="selectType('solar')" class="group bg-white rounded-2xl border-2 border-gray-200 hover:border-amber-500 p-8 text-left shadow-sm hover:shadow-lg transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-amber-200">
          <div class="w-16 h-16 bg-amber-100 group-hover:bg-amber-500 rounded-2xl flex items-center justify-center mb-5 transition-colors duration-200">
            <i class="fas fa-solar-panel text-3xl text-amber-500 group-hover:text-white transition-colors duration-200"></i>
          </div>
          <h3 class="text-xl font-bold text-gray-800 mb-2">Solar Sales Company</h3>
          <p class="text-gray-500 text-sm leading-relaxed">Size solar systems, design panel layouts, and generate solar proposals using satellite roof data.</p>
          <div class="mt-5 flex items-center text-amber-600 font-semibold text-sm group-hover:text-amber-700">
            Select Solar <i class="fas fa-arrow-right ml-2 group-hover:translate-x-1 transition-transform duration-200"></i>
          </div>
        </button>
      </div>
      <div id="selectMsg" class="mt-6 text-center"></div>
    </div>
  </main>
  <script>
    (function() {
      var c = localStorage.getItem('rc_customer');
      if (!c) { window.location.href = '/customer/login'; return; }
    })();
    async function selectType(type) {
      var msg = document.getElementById('selectMsg');
      msg.innerHTML = '<div class="text-gray-500 text-sm"><i class="fas fa-spinner fa-spin mr-2"></i>Saving...</div>';
      try {
        var token = localStorage.getItem('rc_customer_token') || '';
        var res = await fetch('/api/customer/solar-settings', {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ company_type: type })
        });
        var data = await res.json();
        if (res.ok && data.success) {
          var cust = JSON.parse(localStorage.getItem('rc_customer') || '{}');
          cust.company_type = type;
          localStorage.setItem('rc_customer', JSON.stringify(cust));
          window.location.href = '/customer/dashboard';
        } else {
          msg.innerHTML = '<div class="text-red-600 text-sm">' + (data.error || 'Failed to save. Please try again.') + '</div>';
        }
      } catch(err) {
        msg.innerHTML = '<div class="text-red-600 text-sm">Network error. Please try again.</div>';
      }
    }
  </script>
</body>
</html>`
}

// ============================================================
// SOLAR DESIGN PAGE — Canvas-based panel placement on satellite image
// ============================================================
function getSolarDesignPageHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Solar Panel Design - Roof Manager</title>
</head>
<body class="bg-gray-900 min-h-screen">
  <header class="bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <a href="/customer/dashboard" class="flex items-center space-x-3 hover:opacity-90">
          <img src="/static/logo.png" alt="Roof Manager" class="w-10 h-10 rounded-lg object-cover">
          <div>
            <h1 class="text-lg font-bold">Solar Panel Design</h1>
            <p class="text-amber-100 text-xs">Click to place panels on the roof</p>
          </div>
        </a>
      </div>
      <nav class="flex items-center space-x-3">
        <span id="custGreeting" class="text-amber-100 text-sm hidden"><i class="fas fa-user-circle mr-1"></i><span id="custName"></span></span>
        <a href="/customer/dashboard" class="text-amber-100 hover:text-white text-sm"><i class="fas fa-th-large mr-1"></i>Dashboard</a>
        <button onclick="custLogout()" class="text-amber-100 hover:text-white text-sm"><i class="fas fa-sign-out-alt mr-1"></i>Logout</button>
      </nav>
    </div>
  </header>
  <main class="max-w-7xl mx-auto px-4 py-6">
    <div id="solar-design-root"></div>
  </main>
  <script>
    (function() {
      var c = localStorage.getItem('rc_customer');
      if (!c) { window.location.href = '/customer/login'; return; }
      try {
        var u = JSON.parse(c);
        var g = document.getElementById('custGreeting');
        var n = document.getElementById('custName');
        if (g && n) { n.textContent = u.name || u.email; g.classList.remove('hidden'); }
      } catch(e) {}
    })();
    function custLogout() {
      var token = localStorage.getItem('rc_customer_token');
      if (token) fetch('/api/customer/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } })['catch'](function(){});
      localStorage.removeItem('rc_customer');
      localStorage.removeItem('rc_customer_token');
      window.location.href = '/customer/login';
    }
  </script>
  <script src="/static/solar-design.js"></script>
  ${getRoverAssistant()}
</body>
</html>`
}

// ============================================================
// D2D MANAGER PAGE — Dedicated page with Google Maps
// ============================================================
function getD2DPageHTML(mapsApiKey: string) {
  const mapsScript = mapsApiKey
    ? `<script>
      var googleMapsReady = false;
      function onD2DMapsReady() {
        googleMapsReady = true;
        console.log('[Maps] D2D Maps loaded');
        if (typeof initD2DMap === 'function') initD2DMap();
      }
    </script>
    <script src="https://maps.googleapis.com/maps/api/js?key=${mapsApiKey}&libraries=places,drawing,geometry&callback=onD2DMapsReady" async defer></script>`
    : '<!-- Google Maps: No API key configured. -->'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>D2D Manager - Roof Manager</title>
  ${mapsScript}
  <link rel="stylesheet" href="/static/d2d-module.css?v=${Date.now()}">
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg">
    <div class="max-w-full mx-auto px-4 py-3 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <a href="/customer/dashboard" class="flex items-center space-x-3 hover:opacity-90">
          <img src="/static/logo.png" alt="Roof Manager" class="w-10 h-10 rounded-lg object-cover">
          <div>
            <h1 class="text-lg font-bold">D2D Manager</h1>
            <p class="text-brand-200 text-xs">Roof Manager</p>
          </div>
        </a>
      </div>
      <nav class="flex items-center space-x-3">
        <span id="custGreeting" class="text-brand-200 text-sm hidden"><i class="fas fa-user-circle mr-1"></i><span id="custName"></span></span>
        <a href="/customer/dashboard" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-th-large mr-1"></i>Dashboard</a>
        <button onclick="custLogout()" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-sign-out-alt mr-1"></i>Logout</button>
      </nav>
    </div>
  </header>
  <div id="d2d-app"></div>
  <script>
    (function() {
      var c = localStorage.getItem('rc_customer');
      if (!c) { window.location.href = '/customer/login'; return; }
      try {
        var u = JSON.parse(c);
        var g = document.getElementById('custGreeting');
        var n = document.getElementById('custName');
        if (g && n) { n.textContent = u.name || u.email; g.classList.remove('hidden'); }
      } catch(e) {}
    })();
    function custLogout() {
      var token = localStorage.getItem('rc_customer_token');
      if (token) fetch('/api/customer/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } })['catch'](function(){});
      localStorage.removeItem('rc_customer');
      localStorage.removeItem('rc_customer_token');
      window.location.href = '/customer/login';
    }
  </script>
  <script src="/static/d2d-module.js?v=${Date.now()}"></script>
  ${getRoverAssistant()}
</body>
</html>`
}

// ============================================================
// CRM SUB-PAGES — Customers, Invoices, Proposals, Jobs, Pipeline
// ============================================================
// ============================================================
// PROPERTY IMAGERY PAGE — Dev-only satellite imagery PDF tool
// ============================================================
function getPropertyImageryPageHTML(mapsApiKey: string) {
  const mapsScript = mapsApiKey
    ? `<script>
      var googleMapsReady = false;
      function onImageryMapsReady() {
        googleMapsReady = true;
        console.log('[Maps] Property Imagery Maps loaded');
        if (typeof initImageryMap === 'function') initImageryMap();
      }
    </script>
    <script src="https://maps.googleapis.com/maps/api/js?key=${mapsApiKey}&libraries=places&callback=onImageryMapsReady" async defer></script>`
    : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Property Imagery - Roof Manager (Dev Tool)</title>
  ${mapsScript}
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-gradient-to-r from-emerald-700 to-teal-800 text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <a href="/customer/dashboard" class="flex items-center space-x-3 hover:opacity-90 transition-opacity">
          <img src="/static/logo.png" alt="Roof Manager" class="w-10 h-10 rounded-lg object-cover shadow-lg">
          <div>
            <h1 class="text-xl font-bold">Property Imagery</h1>
            <p class="text-emerald-200 text-xs">Dev Tool — Roof Manager</p>
          </div>
        </a>
      </div>
      <nav class="flex items-center space-x-4">
        <span class="px-2 py-1 bg-amber-500/20 text-amber-200 rounded text-xs font-bold"><i class="fas fa-flask mr-1"></i>DEV ONLY</span>
        <a href="/customer/dashboard" class="text-emerald-200 hover:text-white text-sm"><i class="fas fa-th-large mr-1"></i>Dashboard</a>
        <button onclick="custLogout()" class="text-emerald-200 hover:text-white text-sm"><i class="fas fa-sign-out-alt mr-1"></i>Logout</button>
      </nav>
    </div>
  </header>
  <main class="max-w-5xl mx-auto px-4 py-8">
    <div id="pi-root"></div>
  </main>
  <script>
    (function() {
      var c = localStorage.getItem('rc_customer');
      if (!c) { window.location.href = '/customer/login'; return; }
      try {
        var u = JSON.parse(c);
        if (!u.is_dev) { window.location.href = '/customer/dashboard'; return; }
      } catch(e) { window.location.href = '/customer/login'; }
    })();
    function custLogout() {
      var token = localStorage.getItem('rc_customer_token');
      if (token) fetch('/api/customer/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } })['catch'](function(){});
      localStorage.removeItem('rc_customer');
      localStorage.removeItem('rc_customer_token');
      window.location.href = '/customer/login';
    }
  </script>
  <script src="/static/property-imagery.js"></script>
  ${getRoverAssistant()}
</body>
</html>`
}

function getCrmSubPageHTML(module: string, title: string, icon: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>${title} - Roof Manager</title>
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <a href="/customer/dashboard" class="flex items-center space-x-3 hover:opacity-90">
          <img src="/static/logo.png" alt="Roof Manager" class="w-10 h-10 rounded-lg object-cover">
          <div>
            <h1 class="text-lg font-bold">${title}</h1>
            <p class="text-brand-200 text-xs">Roof Manager</p>
          </div>
        </a>
      </div>
      <nav class="flex items-center space-x-3">
        <span id="custGreeting" class="text-brand-200 text-sm hidden"><i class="fas fa-user-circle mr-1"></i><span id="custName"></span></span>
        <a href="/customer/dashboard" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-th-large mr-1"></i>Dashboard</a>
        <button onclick="custLogout()" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-sign-out-alt mr-1"></i>Logout</button>
      </nav>
    </div>
  </header>
  <main class="max-w-7xl mx-auto px-4 py-6">
    <div id="crm-root" data-module="${module}"></div>
  </main>
  <script>
    (function() {
      var c = localStorage.getItem('rc_customer');
      if (!c) { window.location.href = '/customer/login'; return; }
      try {
        var u = JSON.parse(c);
        var g = document.getElementById('custGreeting');
        var n = document.getElementById('custName');
        if (g && n) { n.textContent = u.name || u.email; g.classList.remove('hidden'); }
      } catch(e) {}
    })();
    function custLogout() {
      var token = localStorage.getItem('rc_customer_token');
      if (token) fetch('/api/customer/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } })['catch'](function(){});
      localStorage.removeItem('rc_customer');
      localStorage.removeItem('rc_customer_token');
      window.location.href = '/customer/login';
    }
  </script>
  <script src="/static/crm-module.js?v=${Date.now()}"></script>
  <script src="/static/solar-calculator.js?v=${Date.now()}"></script>
  ${getRoverAssistant()}
</body>
</html>`
}

// ============================================================
// ROOFER SECRETARY PAGE — AI Phone Answering Service
// ============================================================
function getSecretaryPageHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Roofer Secretary - Roof Manager</title>
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <a href="/customer/dashboard" class="flex items-center space-x-3 hover:opacity-90">
          <img src="/static/logo.png" alt="Roof Manager" class="w-10 h-10 rounded-lg object-cover">
          <div>
            <h1 class="text-lg font-bold">Roofer Secretary</h1>
            <p class="text-brand-200 text-xs">AI Phone Answering Service</p>
          </div>
        </a>
      </div>
      <nav class="flex items-center space-x-3">
        <span id="custGreeting" class="text-brand-200 text-sm hidden"><i class="fas fa-user-circle mr-1"></i><span id="custName"></span></span>
        <a href="/customer/dashboard" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-th-large mr-1"></i>Dashboard</a>
        <button onclick="custLogout()" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-sign-out-alt mr-1"></i>Logout</button>
      </nav>
    </div>
  </header>
  <main class="max-w-4xl mx-auto px-4 py-6">
    <div id="secretary-root"></div>
  </main>
  <script>
    (function() {
      var c = localStorage.getItem('rc_customer');
      if (!c) { window.location.href = '/customer/login'; return; }
      try {
        var u = JSON.parse(c);
        var g = document.getElementById('custGreeting');
        var n = document.getElementById('custName');
        if (g && n) { n.textContent = u.name || u.email; g.classList.remove('hidden'); }
      } catch(e) {}
    })();
    function custLogout() {
      var token = localStorage.getItem('rc_customer_token');
      if (token) fetch('/api/customer/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } })['catch'](function(){});
      localStorage.removeItem('rc_customer');
      localStorage.removeItem('rc_customer_token');
      window.location.href = '/customer/login';
    }
  </script>
  <script src="/static/secretary.js"></script>
  ${getRoverAssistant()}
</body>
</html>`
}

// ============================================================
// GEMMA 3 MODEL CARD — Public reference page
// ============================================================
function getGemma3ModelCardHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gemma 3 Model Card - Google DeepMind</title>
  <meta name="description" content="Gemma 3 — lightweight, open, multimodal models by Google DeepMind. Text + image understanding, 128K context, 140+ languages.">
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/python.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/bash.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/bibtex.min.js"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            'gemma': { 50:'#eff6ff', 100:'#dbeafe', 200:'#bfdbfe', 300:'#93c5fd', 400:'#60a5fa', 500:'#4285F4', 600:'#2563eb', 700:'#1d4ed8', 800:'#1e40af', 900:'#1e3a8a' },
            'google-blue':'#4285F4', 'google-red':'#EA4335', 'google-yellow':'#FBBC05', 'google-green':'#34A853'
          }
        }
      }
    }
  </script>
  <style>
    .code-block { position: relative; }
    .code-block .copy-btn { position: absolute; top: 8px; right: 8px; opacity: 0; transition: opacity 0.2s; }
    .code-block:hover .copy-btn { opacity: 1; }
    .toc-link { transition: all 0.2s; border-left: 3px solid transparent; }
    .toc-link:hover, .toc-link.active { border-left-color: #4285F4; background: #eff6ff; color: #1d4ed8; }
    .size-badge { transition: all 0.3s; cursor: pointer; }
    .size-badge:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(66,133,244,0.3); }
    .size-badge.selected { ring: 2px; ring-color: #4285F4; background: #eff6ff; }
    .section-card { transition: all 0.2s; }
    .section-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.08); }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    .animate-section { animation: fadeIn 0.5s ease-out; }
    pre code { font-size: 0.85rem !important; line-height: 1.5 !important; }
    .hljs { border-radius: 0.5rem; padding: 1.25rem !important; }
  </style>
</head>
<body class="bg-gray-50 min-h-screen">

  <!-- Header -->
  <header class="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
    <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
      <div class="flex items-center space-x-4">
        <div class="flex items-center space-x-2">
          <div class="w-10 h-10 bg-gradient-to-br from-google-blue to-blue-600 rounded-xl flex items-center justify-center shadow-md">
            <svg viewBox="0 0 24 24" class="w-6 h-6 text-white" fill="currentColor">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <div>
            <h1 class="text-xl font-bold text-gray-900">Gemma 3</h1>
            <p class="text-xs text-gray-500">Model Card &middot; Google DeepMind</p>
          </div>
        </div>
      </div>
      <div class="flex items-center space-x-3">
        <a href="https://ai.google.dev/gemma" target="_blank" class="px-4 py-2 bg-google-blue text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition shadow-sm">
          <i class="fas fa-external-link-alt mr-1"></i> Model Page
        </a>
        <a href="/" class="text-gray-500 hover:text-gray-700 text-sm">
          <i class="fas fa-home mr-1"></i> Home
        </a>
      </div>
    </div>
  </header>

  <div class="max-w-7xl mx-auto px-4 py-8 flex gap-8">

    <!-- Sidebar TOC -->
    <aside class="hidden lg:block w-56 flex-shrink-0">
      <nav class="sticky top-20 space-y-1 text-sm" id="toc-nav">
        <a href="#overview" class="toc-link block px-3 py-2 rounded-r text-gray-600">Overview</a>
        <a href="#description" class="toc-link block px-3 py-2 rounded-r text-gray-600">Description</a>
        <a href="#model-sizes" class="toc-link block px-3 py-2 rounded-r text-gray-600">Model Sizes</a>
        <a href="#inputs-outputs" class="toc-link block px-3 py-2 rounded-r text-gray-600">Inputs & Outputs</a>
        <a href="#usage" class="toc-link block px-3 py-2 rounded-r text-gray-600">Usage</a>
        <a href="#multi-gpu" class="toc-link block px-3 py-2 rounded-r text-gray-600">Multi-GPU Example</a>
        <a href="#resources" class="toc-link block px-3 py-2 rounded-r text-gray-600">Resources</a>
        <a href="#citation" class="toc-link block px-3 py-2 rounded-r text-gray-600">Citation</a>
      </nav>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 min-w-0 space-y-8">

      <!-- Overview Hero -->
      <section id="overview" class="section-card bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden animate-section">
        <div class="bg-gradient-to-r from-google-blue via-blue-500 to-indigo-600 px-8 py-10 text-white">
          <div class="flex items-start justify-between flex-wrap gap-4">
            <div>
              <div class="flex items-center space-x-3 mb-3">
                <span class="px-3 py-1 bg-white/20 rounded-full text-sm font-medium backdrop-blur-sm">Open Model</span>
                <span class="px-3 py-1 bg-white/20 rounded-full text-sm font-medium backdrop-blur-sm">Multimodal</span>
                <span class="px-3 py-1 bg-white/20 rounded-full text-sm font-medium backdrop-blur-sm">128K Context</span>
              </div>
              <h2 class="text-4xl font-extrabold mb-2">Gemma 3</h2>
              <p class="text-blue-100 text-lg max-w-2xl">Lightweight, state-of-the-art open models built from the same research and technology used to create the Gemini models.</p>
            </div>
            <div class="text-right space-y-1">
              <div class="text-blue-100 text-sm">Authors</div>
              <div class="font-bold text-lg">Google DeepMind</div>
              <div class="text-blue-200 text-sm">Model Page: <a href="https://ai.google.dev/gemma" class="underline hover:text-white">Gemma</a></div>
            </div>
          </div>
        </div>
        <div class="px-8 py-5 bg-blue-50/50 border-t border-blue-100 grid grid-cols-2 md:grid-cols-4 gap-4 text-center text-sm">
          <div><div class="font-bold text-2xl text-google-blue">4</div><div class="text-gray-500">Model Sizes</div></div>
          <div><div class="font-bold text-2xl text-google-blue">140+</div><div class="text-gray-500">Languages</div></div>
          <div><div class="font-bold text-2xl text-google-blue">128K</div><div class="text-gray-500">Context Window</div></div>
          <div><div class="font-bold text-2xl text-google-blue">8,192</div><div class="text-gray-500">Output Tokens</div></div>
        </div>
      </section>

      <!-- Description -->
      <section id="description" class="section-card bg-white rounded-2xl shadow-sm border border-gray-100 p-8 animate-section">
        <h3 class="text-2xl font-bold text-gray-900 mb-4 flex items-center">
          <i class="fas fa-info-circle text-google-blue mr-3"></i> Description
        </h3>
        <p class="text-gray-700 leading-relaxed mb-4">
          Gemma is a family of lightweight, state-of-the-art open models from Google, built from the same research and technology used to create the Gemini models.
          Gemma 3 models are <strong>multimodal</strong> &mdash; they take both <strong>text</strong> and <strong>images</strong> as input and generate <strong>text</strong> output, with
          a <strong>128K token context window</strong>, <strong>multilingual support in over 140 languages</strong>, and available in multiple sizes.
        </p>
        <div class="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-5 border border-blue-100">
          <h4 class="font-semibold text-gray-800 mb-3"><i class="fas fa-tasks text-google-blue mr-2"></i>Well-suited for:</h4>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div class="flex items-center space-x-2 text-sm text-gray-700"><i class="fas fa-check-circle text-google-green"></i><span>Text generation</span></div>
            <div class="flex items-center space-x-2 text-sm text-gray-700"><i class="fas fa-check-circle text-google-green"></i><span>Image understanding</span></div>
            <div class="flex items-center space-x-2 text-sm text-gray-700"><i class="fas fa-check-circle text-google-green"></i><span>Question answering</span></div>
            <div class="flex items-center space-x-2 text-sm text-gray-700"><i class="fas fa-check-circle text-google-green"></i><span>Summarization</span></div>
            <div class="flex items-center space-x-2 text-sm text-gray-700"><i class="fas fa-check-circle text-google-green"></i><span>Reasoning</span></div>
            <div class="flex items-center space-x-2 text-sm text-gray-700"><i class="fas fa-check-circle text-google-green"></i><span>Multilingual tasks</span></div>
          </div>
        </div>
      </section>

      <!-- Model Sizes -->
      <section id="model-sizes" class="section-card bg-white rounded-2xl shadow-sm border border-gray-100 p-8 animate-section">
        <h3 class="text-2xl font-bold text-gray-900 mb-6 flex items-center">
          <i class="fas fa-cubes text-google-blue mr-3"></i> Model Sizes
        </h3>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="size-badge bg-white border-2 border-gray-200 rounded-xl p-5 text-center hover:border-google-blue" onclick="selectSize(this, '1B')">
            <div class="text-3xl font-extrabold text-google-blue mb-1">1B</div>
            <div class="text-gray-500 text-sm font-medium">Parameters</div>
            <div class="mt-3 text-xs text-gray-400">32K context</div>
            <div class="text-xs text-gray-400">Text only</div>
          </div>
          <div class="size-badge bg-white border-2 border-gray-200 rounded-xl p-5 text-center hover:border-google-blue selected border-google-blue bg-blue-50/50" onclick="selectSize(this, '4B')">
            <div class="text-3xl font-extrabold text-google-blue mb-1">4B</div>
            <div class="text-gray-500 text-sm font-medium">Parameters</div>
            <div class="mt-3 text-xs text-gray-400">128K context</div>
            <div class="text-xs text-google-green font-medium">Text + Image</div>
          </div>
          <div class="size-badge bg-white border-2 border-gray-200 rounded-xl p-5 text-center hover:border-google-blue" onclick="selectSize(this, '12B')">
            <div class="text-3xl font-extrabold text-google-blue mb-1">12B</div>
            <div class="text-gray-500 text-sm font-medium">Parameters</div>
            <div class="mt-3 text-xs text-gray-400">128K context</div>
            <div class="text-xs text-google-green font-medium">Text + Image</div>
          </div>
          <div class="size-badge bg-white border-2 border-gray-200 rounded-xl p-5 text-center hover:border-google-blue" onclick="selectSize(this, '27B')">
            <div class="text-3xl font-extrabold text-google-blue mb-1">27B</div>
            <div class="text-gray-500 text-sm font-medium">Parameters</div>
            <div class="mt-3 text-xs text-gray-400">128K context</div>
            <div class="text-xs text-google-green font-medium">Text + Image</div>
          </div>
        </div>
        <p class="text-xs text-gray-400 mt-4 text-center">Click a model size to highlight &mdash; the 1B variant uses a 32K context window; all others support 128K tokens.</p>
      </section>

      <!-- Inputs & Outputs -->
      <section id="inputs-outputs" class="section-card bg-white rounded-2xl shadow-sm border border-gray-100 p-8 animate-section">
        <h3 class="text-2xl font-bold text-gray-900 mb-6 flex items-center">
          <i class="fas fa-exchange-alt text-google-blue mr-3"></i> Inputs & Outputs
        </h3>
        <div class="grid md:grid-cols-2 gap-6">
          <div class="bg-green-50 rounded-xl p-6 border border-green-200">
            <h4 class="font-bold text-green-800 mb-3 flex items-center"><i class="fas fa-sign-in-alt mr-2"></i>Inputs</h4>
            <ul class="space-y-2 text-sm text-gray-700">
              <li class="flex items-start space-x-2"><i class="fas fa-font text-green-600 mt-1"></i><span><strong>Text:</strong> String data (prompts, questions, instructions)</span></li>
              <li class="flex items-start space-x-2"><i class="fas fa-image text-green-600 mt-1"></i><span><strong>Images:</strong> Normalized to <code class="bg-green-100 px-1 rounded">896 &times; 896</code> pixels (256 tokens each)</span></li>
              <li class="flex items-start space-x-2"><i class="fas fa-ruler-horizontal text-green-600 mt-1"></i><span><strong>Total context:</strong> <code class="bg-green-100 px-1 rounded">128K</code> tokens (32K for 1B)</span></li>
            </ul>
          </div>
          <div class="bg-amber-50 rounded-xl p-6 border border-amber-200">
            <h4 class="font-bold text-amber-800 mb-3 flex items-center"><i class="fas fa-sign-out-alt mr-2"></i>Outputs</h4>
            <ul class="space-y-2 text-sm text-gray-700">
              <li class="flex items-start space-x-2"><i class="fas fa-font text-amber-600 mt-1"></i><span><strong>Text:</strong> Generated text (responses, answers, summaries)</span></li>
              <li class="flex items-start space-x-2"><i class="fas fa-ruler-horizontal text-amber-600 mt-1"></i><span><strong>Max output:</strong> <code class="bg-amber-100 px-1 rounded">8,192</code> tokens</span></li>
            </ul>
          </div>
        </div>
      </section>

      <!-- Usage — Pipeline API -->
      <section id="usage" class="section-card bg-white rounded-2xl shadow-sm border border-gray-100 p-8 animate-section">
        <h3 class="text-2xl font-bold text-gray-900 mb-6 flex items-center">
          <i class="fas fa-code text-google-blue mr-3"></i> Usage
        </h3>

        <!-- Install -->
        <h4 class="font-semibold text-gray-800 mb-3">1. Install Transformers &ge; 4.50.0</h4>
        <div class="code-block mb-6">
          <button class="copy-btn px-3 py-1 bg-gray-700 text-gray-200 text-xs rounded hover:bg-gray-600 transition" onclick="copyCode(this)">
            <i class="fas fa-copy mr-1"></i>Copy
          </button>
          <pre><code class="language-bash">pip install -U transformers</code></pre>
        </div>

        <!-- Pipeline Example -->
        <h4 class="font-semibold text-gray-800 mb-3">2. Pipeline API Example</h4>
        <p class="text-sm text-gray-600 mb-3">Using <code class="bg-gray-100 px-1 rounded">google/gemma-3-4b-it</code> with system/user messages and an image URL:</p>
        <div class="code-block mb-6">
          <button class="copy-btn px-3 py-1 bg-gray-700 text-gray-200 text-xs rounded hover:bg-gray-600 transition" onclick="copyCode(this)">
            <i class="fas fa-copy mr-1"></i>Copy
          </button>
          <pre><code class="language-python">from transformers import pipeline
import torch

pipe = pipeline(
    "image-text-to-text",
    model="google/gemma-3-4b-it",
    device="cuda",
    torch_dtype=torch.bfloat16,
)

messages = [
    {
        "role": "system",
        "content": [{"type": "text", "text": "You are a helpful assistant."}],
    },
    {
        "role": "user",
        "content": [
            {"type": "image", "url": "https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/p-blog/candy.JPG"},
            {"type": "text", "text": "What animal is in the image?"},
        ],
    },
]

output = pipe(text=messages, max_new_tokens=200)
print(output[0]["generated_text"][-1]["content"])</code></pre>
        </div>
      </section>

      <!-- Multi-GPU Example -->
      <section id="multi-gpu" class="section-card bg-white rounded-2xl shadow-sm border border-gray-100 p-8 animate-section">
        <h3 class="text-2xl font-bold text-gray-900 mb-6 flex items-center">
          <i class="fas fa-server text-google-blue mr-3"></i> Multi-GPU Example
        </h3>
        <p class="text-sm text-gray-600 mb-4">Using <code class="bg-gray-100 px-1 rounded">accelerate</code>, <code class="bg-gray-100 px-1 rounded">AutoProcessor</code>, and <code class="bg-gray-100 px-1 rounded">Gemma3ForConditionalGeneration</code> for larger models across multiple GPUs:</p>
        <div class="code-block mb-4">
          <button class="copy-btn px-3 py-1 bg-gray-700 text-gray-200 text-xs rounded hover:bg-gray-600 transition" onclick="copyCode(this)">
            <i class="fas fa-copy mr-1"></i>Copy
          </button>
          <pre><code class="language-python">from transformers import AutoProcessor, Gemma3ForConditionalGeneration
from PIL import Image
import requests
import torch

model_id = "google/gemma-3-27b-it"
model = Gemma3ForConditionalGeneration.from_pretrained(
    model_id, device_map="auto", torch_dtype=torch.bfloat16
)
processor = AutoProcessor.from_pretrained(model_id)

# Load an image
url = "https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/p-blog/candy.JPG"
image = Image.open(requests.get(url, stream=True).raw)

messages = [
    {
        "role": "system",
        "content": [{"type": "text", "text": "You are a helpful assistant."}],
    },
    {
        "role": "user",
        "content": [
            {"type": "image"},
            {"type": "text", "text": "What do you see in this image? Describe in detail."},
        ],
    },
]

inputs = processor.apply_chat_template(
    messages,
    tokenize=True,
    add_generation_prompt=True,
    return_dict=True,
    return_tensors="pt",
    images=[image],
).to(model.device)

input_len = inputs["input_ids"].shape[-1]

with torch.inference_mode():
    generation = model.generate(**inputs, max_new_tokens=500, do_sample=False)
    generation = generation[0][input_len:]

decoded = processor.decode(generation, skip_special_tokens=True)
print(decoded)
# Sample output:
# "The image shows a selection of colorful lollipops
#  arranged in neat rows. The swirled patterns feature
#  shades of pink, purple, yellow, blue, and green,
#  creating a vibrant, candy-shop display."</code></pre>
        </div>
      </section>

      <!-- Resources -->
      <section id="resources" class="section-card bg-white rounded-2xl shadow-sm border border-gray-100 p-8 animate-section">
        <h3 class="text-2xl font-bold text-gray-900 mb-6 flex items-center">
          <i class="fas fa-book text-google-blue mr-3"></i> Resources
        </h3>
        <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <a href="https://goo.gle/Gemma3Report" target="_blank" class="flex items-center space-x-3 p-4 bg-blue-50 rounded-xl border border-blue-100 hover:border-google-blue hover:shadow-md transition group">
            <div class="w-10 h-10 bg-google-blue/10 rounded-lg flex items-center justify-center group-hover:bg-google-blue/20 transition">
              <i class="fas fa-file-alt text-google-blue"></i>
            </div>
            <div>
              <div class="font-medium text-gray-800 text-sm">Technical Report</div>
              <div class="text-xs text-gray-500">Gemma 3 Technical Report</div>
            </div>
          </a>
          <a href="https://ai.google.dev/responsible" target="_blank" class="flex items-center space-x-3 p-4 bg-green-50 rounded-xl border border-green-100 hover:border-google-green hover:shadow-md transition group">
            <div class="w-10 h-10 bg-google-green/10 rounded-lg flex items-center justify-center group-hover:bg-google-green/20 transition">
              <i class="fas fa-shield-alt text-google-green"></i>
            </div>
            <div>
              <div class="font-medium text-gray-800 text-sm">Responsible AI Toolkit</div>
              <div class="text-xs text-gray-500">Safety & responsible use</div>
            </div>
          </a>
          <a href="https://www.kaggle.com/models/google/gemma-3" target="_blank" class="flex items-center space-x-3 p-4 bg-purple-50 rounded-xl border border-purple-100 hover:border-purple-500 hover:shadow-md transition group">
            <div class="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center group-hover:bg-purple-500/20 transition">
              <i class="fas fa-database text-purple-500"></i>
            </div>
            <div>
              <div class="font-medium text-gray-800 text-sm">Gemma on Kaggle</div>
              <div class="text-xs text-gray-500">Models, notebooks & datasets</div>
            </div>
          </a>
          <a href="https://console.cloud.google.com/vertex-ai/publishers/google/model-garden/gemma3" target="_blank" class="flex items-center space-x-3 p-4 bg-amber-50 rounded-xl border border-amber-100 hover:border-google-yellow hover:shadow-md transition group">
            <div class="w-10 h-10 bg-google-yellow/10 rounded-lg flex items-center justify-center group-hover:bg-google-yellow/20 transition">
              <i class="fas fa-cloud text-google-yellow"></i>
            </div>
            <div>
              <div class="font-medium text-gray-800 text-sm">Vertex Model Garden</div>
              <div class="text-xs text-gray-500">Deploy on Google Cloud</div>
            </div>
          </a>
          <a href="https://ai.google.dev/gemma/terms" target="_blank" class="flex items-center space-x-3 p-4 bg-red-50 rounded-xl border border-red-100 hover:border-google-red hover:shadow-md transition group">
            <div class="w-10 h-10 bg-google-red/10 rounded-lg flex items-center justify-center group-hover:bg-google-red/20 transition">
              <i class="fas fa-gavel text-google-red"></i>
            </div>
            <div>
              <div class="font-medium text-gray-800 text-sm">Terms of Use</div>
              <div class="text-xs text-gray-500">License & usage terms</div>
            </div>
          </a>
          <a href="https://ai.google.dev/gemma" target="_blank" class="flex items-center space-x-3 p-4 bg-gray-50 rounded-xl border border-gray-200 hover:border-google-blue hover:shadow-md transition group">
            <div class="w-10 h-10 bg-gray-200 rounded-lg flex items-center justify-center group-hover:bg-gray-300 transition">
              <i class="fas fa-home text-gray-600"></i>
            </div>
            <div>
              <div class="font-medium text-gray-800 text-sm">Gemma Model Page</div>
              <div class="text-xs text-gray-500">Official landing page</div>
            </div>
          </a>
        </div>
      </section>

      <!-- Citation -->
      <section id="citation" class="section-card bg-white rounded-2xl shadow-sm border border-gray-100 p-8 animate-section">
        <h3 class="text-2xl font-bold text-gray-900 mb-4 flex items-center">
          <i class="fas fa-quote-left text-google-blue mr-3"></i> Citation
        </h3>
        <div class="code-block">
          <button class="copy-btn px-3 py-1 bg-gray-700 text-gray-200 text-xs rounded hover:bg-gray-600 transition" onclick="copyCode(this)">
            <i class="fas fa-copy mr-1"></i>Copy
          </button>
          <pre><code class="language-bibtex">@article{gemma_2025,
    title   = {Gemma 3},
    url     = {https://goo.gle/Gemma3Report},
    publisher = {Kaggle},
    author  = {Gemma Team},
    year    = {2025}
}</code></pre>
        </div>
      </section>

      <!-- Footer -->
      <footer class="text-center text-xs text-gray-400 py-8 border-t border-gray-200 mt-8">
        <p>Gemma 3 Model Card &mdash; Data compiled from public Google DeepMind documentation.</p>
        <p class="mt-1">Served by <a href="/" class="text-google-blue hover:underline">Roof Manager</a> on Cloudflare Pages.</p>
      </footer>

    </main>
  </div>

  <script>
    // Highlight.js init
    hljs.highlightAll();

    // Copy button
    function copyCode(btn) {
      var code = btn.parentElement.querySelector('code');
      navigator.clipboard.writeText(code.textContent).then(function() {
        btn.innerHTML = '<i class="fas fa-check mr-1"></i>Copied!';
        setTimeout(function() { btn.innerHTML = '<i class="fas fa-copy mr-1"></i>Copy'; }, 2000);
      });
    }

    // Size badge selection
    function selectSize(el, size) {
      document.querySelectorAll('.size-badge').forEach(function(b) {
        b.classList.remove('selected', 'border-google-blue', 'bg-blue-50/50');
        b.classList.add('border-gray-200');
      });
      el.classList.add('selected', 'border-google-blue', 'bg-blue-50/50');
      el.classList.remove('border-gray-200');
    }

    // TOC active tracking
    var sections = document.querySelectorAll('section[id]');
    var tocLinks = document.querySelectorAll('.toc-link');
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          tocLinks.forEach(function(l) { l.classList.remove('active'); });
          var activeLink = document.querySelector('.toc-link[href="#' + entry.target.id + '"]');
          if (activeLink) activeLink.classList.add('active');
        }
      });
    }, { rootMargin: '-20% 0% -70% 0%' });
    sections.forEach(function(s) { observer.observe(s); });
  </script>

</body>
</html>`
}

// ============================================================
// 3D ROOF VISUALIZER PAGE
// ============================================================
function getVisualizerPageHTML(address: string, reportJson: any, mapsKey: string) {
  const reportDataStr = reportJson ? JSON.stringify(reportJson).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') : 'null'
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>3D Roof Visualizer — ${address}</title>
  <link rel="stylesheet" href="/static/css/visualizer.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.min.js"></script>
  <style>
    body { margin: 0; background: #0f172a; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .vis-header { background: linear-gradient(135deg, #1e293b, #0f172a); border-bottom: 1px solid #334155; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; }
    .vis-main { display: flex; height: calc(100vh - 64px); }
    .vis-canvas-wrap { flex: 1; position: relative; }
    #canvas-3d { width: 100%; height: 100%; }
    .vis-sidebar { width: 320px; background: #1e293b; border-left: 1px solid #334155; overflow-y: auto; padding: 16px; }
    .vis-section { margin-bottom: 20px; }
    .vis-section h3 { font-size: 13px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; }
    .vis-btn { padding: 8px 16px; border-radius: 8px; border: none; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
    .vis-btn-primary { background: #3b82f6; color: white; }
    .vis-btn-primary:hover { background: #2563eb; }
    .vis-loader { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; }
    .vis-spinner { width: 40px; height: 40px; border: 3px solid #334155; border-top-color: #3b82f6; border-radius: 50%; animation: vis-spin 0.8s linear infinite; }
    @keyframes vis-spin { to { transform: rotate(360deg); } }
    .vis-upload-zone { border: 2px dashed #475569; border-radius: 12px; padding: 24px; text-align: center; cursor: pointer; transition: all 0.3s; }
    .vis-upload-zone:hover, .vis-upload-zone.active { border-color: #3b82f6; background: rgba(59,130,246,0.05); }
    .vis-upload-zone img { max-width: 100%; max-height: 200px; border-radius: 8px; margin-top: 8px; }
    .vis-stat { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 10px; margin-bottom: 6px; }
    .vis-stat-label { font-size: 11px; color: #64748b; }
    .vis-stat-value { font-size: 16px; font-weight: 700; color: #e2e8f0; }
    .swatch-btn { display:flex; flex-direction:column; align-items:center; padding:6px; border-radius:8px; border:2px solid transparent; background:#0f172a; cursor:pointer; transition:all 0.2s; }
    .swatch-btn:hover { border-color:#475569; }
    .swatch-btn.active { border-color:#3b82f6; box-shadow:0 0 0 2px rgba(59,130,246,0.3); }
    .swatch-color { width:32px; height:32px; border-radius:6px; margin-bottom:4px; border:1px solid #334155; }
    .swatch-label { font-size:9px; color:#94a3b8; text-align:center; line-height:1.2; }
    .screenshot-flash { position:absolute; inset:0; background:white; opacity:0.8; animation:flash-fade 0.4s ease-out forwards; pointer-events:none; }
    @keyframes flash-fade { to { opacity:0; } }
    @media (max-width: 768px) { .vis-main { flex-direction: column; } .vis-sidebar { width: 100%; height: 300px; } }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="vis-header">
    <div style="display:flex; align-items:center; gap:12px;">
      <a href="/customer/dashboard" style="color:#94a3b8;text-decoration:none;font-size:13px;"><i class="fas fa-arrow-left"></i></a>
      <div>
        <h1 style="font-size:16px; font-weight:700; margin:0;">3D Roof Visualizer</h1>
        <p style="font-size:12px; color:#64748b; margin:0;">${address}</p>
      </div>
    </div>
    <div style="display:flex; gap:8px;">
      <button class="vis-btn" onclick="toggleRotate()" style="background:#334155; color:#e2e8f0;"><i class="fas fa-sync-alt mr-1"></i>Rotate</button>
      <button class="vis-btn" onclick="switchMode()" id="modeBtn" style="background:#334155; color:#e2e8f0;"><i class="fas fa-cube mr-1"></i>2D View</button>
      <button class="vis-btn vis-btn-primary" onclick="captureScreenshot()"><i class="fas fa-camera mr-1"></i>Screenshot</button>
    </div>
  </div>

  <!-- Main -->
  <div class="vis-main">
    <div class="vis-canvas-wrap">
      <div id="canvas-3d"></div>
      <div id="canvas-2d" style="display:none; width:100%; height:100%;"></div>
    </div>
    <div class="vis-sidebar">
      <!-- Upload Image Section -->
      <div class="vis-section">
        <h3><i class="fas fa-image mr-1"></i>Property Photo</h3>
        <div class="vis-upload-zone" id="uploadZone" onclick="document.getElementById('photoUpload').click()">
          <div id="uploadContent">
            <i class="fas fa-cloud-upload-alt" style="font-size:28px; color:#64748b; display:block; margin-bottom:8px;"></i>
            <p style="font-size:13px; color:#94a3b8; margin:0;">Click or drag to upload property photo</p>
            <p style="font-size:11px; color:#475569; margin-top:4px;">JPG, PNG up to 10MB</p>
          </div>
        </div>
        <input type="file" id="photoUpload" accept="image/*" style="display:none" onchange="handlePhotoUpload(event)">
      </div>

      <!-- Color Swatches -->
      <div class="vis-section" id="swatchPanel">
        <h3><i class="fas fa-palette mr-1"></i>Shingle Colors</h3>
        <div id="shingle-swatches" style="display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-bottom:16px;"></div>
        <h3><i class="fas fa-shield-alt mr-1"></i>Metal Roofing</h3>
        <div id="metal-swatches" style="display:grid; grid-template-columns:repeat(3,1fr); gap:6px;"></div>
        <p id="vis-current-color" style="font-size:11px; color:#94a3b8; margin-top:8px; text-align:center;">Onyx Black (shingle)</p>
      </div>

      <!-- Report Stats -->
      <div class="vis-section">
        <h3><i class="fas fa-ruler-combined mr-1"></i>Report Data</h3>
        <div id="reportStats">
          <p style="font-size:12px; color:#64748b;">Loading report data...</p>
        </div>
      </div>
    </div>
  </div>

  <script src="/static/js/3d_visualizer.js?v=${Date.now()}"></script>
  <script>
    var reportData = ${reportDataStr};
    var uploadedImage = null;

    // Initialize
    document.addEventListener('DOMContentLoaded', function() {
      if (reportData) {
        window.initVisualizer(reportData);
        renderReportStats(reportData);
      } else {
        document.getElementById('canvas-3d').innerHTML = '<div class="vis-loader"><i class="fas fa-cube" style="font-size:48px; color:#334155; margin-bottom:16px;"></i><p style="color:#94a3b8; font-size:14px;">No report data available</p><p style="color:#475569; font-size:12px; margin-top:4px;">Order a roof report first to enable 3D visualization</p></div>';
      }
    });

    function handlePhotoUpload(e) {
      var file = e.target.files[0];
      if (!file) return;
      if (file.size > 10 * 1024 * 1024) { alert('File too large. Max 10MB.'); return; }
      var reader = new FileReader();
      reader.onload = function(ev) {
        uploadedImage = ev.target.result;
        var zone = document.getElementById('uploadContent');
        zone.innerHTML = '<img src="' + ev.target.result + '" alt="Property photo" style="max-width:100%; max-height:200px; border-radius:8px; object-fit:cover;">' +
          '<div style="display:flex; gap:6px; margin-top:8px;">' +
          '<button onclick="applyPhotoAsTexture()" style="flex:1; padding:6px 8px; background:#3b82f6; color:white; border:none; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer;"><i class="fas fa-cube mr-1"></i>Apply to 3D Roof</button>' +
          '<button onclick="clearUploadedPhoto()" style="padding:6px 8px; background:#ef4444; color:white; border:none; border-radius:6px; font-size:11px; cursor:pointer;"><i class="fas fa-trash"></i></button>' +
          '</div>';
      };
      reader.readAsDataURL(file);
    }

    function applyPhotoAsTexture() {
      if (!uploadedImage || !window.THREE) {
        alert('Please upload a photo first and ensure 3D mode is active.');
        return;
      }
      var meshes = window.__roofMeshes;
      if (!meshes || meshes.length === 0) {
        alert('3D model not ready yet. Please wait for the scene to load.');
        return;
      }
      var loader = new THREE.TextureLoader();
      loader.load(uploadedImage, function(texture) {
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(2, 2);
        meshes.forEach(function(mesh) {
          if (mesh.material) mesh.material.dispose();
          mesh.material = new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 0.7,
            metalness: 0.05,
          });
        });
        // Show success toast
        showVisToast('Photo applied to 3D roof!');
      }, undefined, function(err) {
        alert('Failed to load image as texture.');
      });
    }

    function showVisToast(msg) {
      var t = document.createElement('div');
      t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#10b981;color:white;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(function(){ t.remove(); }, 2500);
    }

    function clearUploadedPhoto() {
      uploadedImage = null;
      document.getElementById('photoUpload').value = '';
      var zone = document.getElementById('uploadContent');
      zone.innerHTML = '<i class="fas fa-cloud-upload-alt" style="font-size:28px; color:#64748b; display:block; margin-bottom:8px;"></i><p style="font-size:13px; color:#94a3b8; margin:0;">Click or drag to upload property photo</p><p style="font-size:11px; color:#475569; margin-top:4px;">JPG, PNG up to 10MB</p>';
      // Revert roof to current swatch color
      if (window.__changeRoofColor && window.__currentColor) {
        window.__changeRoofColor(window.__currentColor);
      }
      showVisToast('Photo removed');
    }

    // Drag and drop
    var dropZone = document.getElementById('uploadZone');
    dropZone.addEventListener('dragover', function(e) { e.preventDefault(); dropZone.classList.add('active'); });
    dropZone.addEventListener('dragleave', function() { dropZone.classList.remove('active'); });
    dropZone.addEventListener('drop', function(e) {
      e.preventDefault(); dropZone.classList.remove('active');
      if (e.dataTransfer.files[0]) { document.getElementById('photoUpload').files = e.dataTransfer.files; handlePhotoUpload({ target: { files: e.dataTransfer.files } }); }
    });

    function toggleRotate() {
      if (window.toggleAutoRotate) window.toggleAutoRotate();
    }
    function switchMode() {
      if (window.switchVisMode) {
        var btn = document.getElementById('modeBtn');
        if (btn) {
          var is3d = btn.textContent.indexOf('2D') >= 0;
          if (is3d) {
            window.switchVisMode('2d');
            btn.innerHTML = '<i class="fas fa-cube mr-1"></i>3D View';
          } else {
            window.switchVisMode('3d');
            btn.innerHTML = '<i class="fas fa-cube mr-1"></i>2D View';
          }
        }
      }
    }
    function captureScreenshot() {
      if (window.takeScreenshot) window.takeScreenshot();
    }

    function renderReportStats(data) {
      var km = data.key_measurements || data;
      var el = document.getElementById('reportStats');
      if (!km) { el.innerHTML = '<p style="color:#64748b;font-size:12px;">No measurement data</p>'; return; }
      var html = '';
      if (km.total_roof_area_sqft) html += '<div class="vis-stat"><div class="vis-stat-label">Roof Area</div><div class="vis-stat-value">' + Math.round(km.total_roof_area_sqft).toLocaleString() + ' sq ft</div></div>';
      if (km.dominant_pitch_label) html += '<div class="vis-stat"><div class="vis-stat-label">Pitch</div><div class="vis-stat-value">' + km.dominant_pitch_label + '</div></div>';
      if (km.net_squares) html += '<div class="vis-stat"><div class="vis-stat-label">Net Squares</div><div class="vis-stat-value">' + km.net_squares + '</div></div>';
      if (km.roof_style) html += '<div class="vis-stat"><div class="vis-stat-label">Roof Style</div><div class="vis-stat-value" style="text-transform:capitalize;">' + km.roof_style + '</div></div>';
      if (km.total_face_count) html += '<div class="vis-stat"><div class="vis-stat-label">Roof Faces</div><div class="vis-stat-value">' + km.total_face_count + '</div></div>';
      el.innerHTML = html || '<p style="color:#64748b;font-size:12px;">No detailed measurements</p>';
    }
  </script>
</body>
</html>`
}

// ============================================================
// ENHANCED PROPOSAL BUILDER PAGE
// ============================================================
function getProposalBuilderPageHTML(mapsApiKey: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Proposal Builder - Roof Manager</title>
  ${mapsApiKey ? `<script src="https://maps.googleapis.com/maps/api/js?key=${mapsApiKey}&libraries=places"></script>` : ''}
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
      <a href="/customer/dashboard" class="flex items-center space-x-3 hover:opacity-90">
        <img src="/static/logo.png" alt="Roof Manager" class="w-10 h-10 rounded-lg object-cover">
        <div><h1 class="text-xl font-bold">Proposal Builder</h1><p class="text-brand-200 text-xs">Create professional roofing proposals</p></div>
      </a>
      <a href="/customer/proposals" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-arrow-left mr-1"></i>Back to Proposals</a>
    </div>
  </header>
  <main class="max-w-5xl mx-auto px-4 py-8">
    <div id="proposal-root">
      <div class="flex items-center justify-center py-12"><div class="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-brand-500"></div></div>
    </div>
  </main>
  <script src="/static/proposal-builder.js?v=${Date.now()}"></script>
  ${getRoverAssistant()}
</body>
</html>`
}

// ============================================================
// INVOICE MANAGER PAGE
// ============================================================
function getInvoiceManagerPageHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Invoice Manager - Roof Manager</title>
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
      <a href="/customer/dashboard" class="flex items-center space-x-3 hover:opacity-90">
        <img src="/static/logo.png" alt="Roof Manager" class="w-10 h-10 rounded-lg object-cover">
        <div><h1 class="text-xl font-bold">Invoice Manager</h1><p class="text-brand-200 text-xs">Create & manage invoices with Square payment</p></div>
      </a>
      <a href="/customer/invoices" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-arrow-left mr-1"></i>Back to Invoices</a>
    </div>
  </header>
  <main class="max-w-5xl mx-auto px-4 py-8">
    <div id="invoice-root">
      <div class="flex items-center justify-center py-12"><div class="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-brand-500"></div></div>
    </div>
  </main>
  <script src="/static/invoice-manager.js?v=${Date.now()}"></script>
  ${getRoverAssistant()}
</body>
</html>`
}

function getPrivacyPageHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Privacy Policy — Roof Manager</title>
</head>
<body class="bg-gray-50 text-gray-800">
  <header class="bg-white border-b border-gray-200 sticky top-0 z-50">
    <div class="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
      <a href="/" class="flex items-center gap-3">
        <img src="/static/logo.png" alt="Roof Manager" class="w-9 h-9 rounded-lg object-cover">
        <span class="font-bold text-lg text-gray-900">Roof Manager</span>
      </a>
      <a href="/" class="text-sm text-gray-500 hover:text-gray-700"><i class="fas fa-arrow-left mr-1"></i>Back to Home</a>
    </div>
  </header>
  <main class="max-w-4xl mx-auto px-4 py-12">
    <h1 class="text-2xl sm:text-4xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
    <p class="text-gray-500 mb-10">Last updated: March 31, 2026</p>

    <div class="prose prose-gray max-w-none space-y-8">

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">1. Who We Are</h2>
        <p class="text-gray-600 leading-relaxed">Roof Manager ("we", "our", "us") is a roofing measurement and business management platform operated from Alberta, Canada. We provide AI-powered roof measurement reports, CRM tools, invoicing, and a voice AI receptionist service to roofing professionals. Our website is <a href="https://www.roofmanager.ca" class="text-brand-600 hover:underline">https://www.roofmanager.ca</a>. For privacy inquiries, contact us at <a href="mailto:privacy@roofmanager.ca" class="text-brand-600 hover:underline">privacy@roofmanager.ca</a>.</p>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">2. Information We Collect</h2>
        <ul class="list-disc list-inside space-y-2 text-gray-600">
          <li><strong>Account information:</strong> Name, email address, company name, and password (hashed — never stored in plaintext).</li>
          <li><strong>Property addresses:</strong> Street addresses and GPS coordinates you submit to generate roof measurement reports.</li>
          <li><strong>Payment information:</strong> Processed entirely by Square. We do not store full card numbers. We record transaction IDs and amounts for your billing history.</li>
          <li><strong>Usage data:</strong> Pages visited, features used, and report generation history — used to improve the service.</li>
          <li><strong>Google Gmail OAuth token:</strong> When you voluntarily connect your Gmail account (see Section 3), we store your OAuth refresh token. We never collect or store the contents of your emails or inbox.</li>
        </ul>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">3. Google Gmail Integration and the <code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm">gmail.send</code> Permission</h2>
        <p class="text-gray-600 leading-relaxed mb-3">Roof Manager offers an <strong>optional</strong> Gmail integration that allows you to send roof measurement reports, proposals, and invoices from your own Gmail address on your behalf.</p>
        <div class="bg-brand-50 border border-brand-200 rounded-xl p-5 mb-3">
          <p class="text-brand-900 font-medium mb-1">Scope requested: <code class="bg-brand-100 px-1.5 py-0.5 rounded text-sm">gmail.send</code> only</p>
          <p class="text-brand-800 text-sm leading-relaxed">When you connect your Gmail account, Roof Manager requests the <code>gmail.send</code> permission only. This allows us to send roof measurement reports, proposals, and invoices from your Gmail address on your behalf. We store only your Gmail OAuth refresh token, encrypted in our database. We never read, access, index, or store the contents of your emails or inbox.</p>
        </div>
        <ul class="list-disc list-inside space-y-2 text-gray-600 text-sm">
          <li>This integration is entirely optional. The platform works fully without it.</li>
          <li>You may revoke access at any time at <a href="https://myaccount.google.com/permissions" class="text-brand-600 hover:underline" target="_blank" rel="noopener">myaccount.google.com/permissions</a>.</li>
          <li>We do not use your Gmail token for any purpose other than sending emails you explicitly trigger within Roof Manager.</li>
        </ul>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">4. How We Use Your Information</h2>
        <ul class="list-disc list-inside space-y-2 text-gray-600">
          <li>To generate and deliver roof measurement reports.</li>
          <li>To process payments and maintain billing records.</li>
          <li>To send transactional emails (report delivery, invoices, account notifications).</li>
          <li>To improve our AI models and measurement accuracy.</li>
          <li>To respond to support requests.</li>
        </ul>
        <p class="text-gray-600 mt-3">We do not sell your personal information to third parties. We do not use your data for advertising purposes.</p>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">5. How We Store Your Data</h2>
        <p class="text-gray-600 leading-relaxed">Your data is stored in Cloudflare D1 (SQLite at the edge), protected by Cloudflare's infrastructure with encryption at rest and in transit. OAuth tokens are stored encrypted. Passwords are hashed using SHA-256 with a unique salt per user — we cannot recover your password.</p>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">6. Third-Party Services</h2>
        <ul class="list-disc list-inside space-y-2 text-gray-600">
          <li><strong>Square:</strong> Payment processing. Governed by <a href="https://squareup.com/ca/en/legal/general/privacy" class="text-brand-600 hover:underline" target="_blank" rel="noopener">Square's Privacy Policy</a>.</li>
          <li><strong>Google Solar API &amp; Maps:</strong> Property imagery and geospatial data. Governed by <a href="https://policies.google.com/privacy" class="text-brand-600 hover:underline" target="_blank" rel="noopener">Google's Privacy Policy</a>.</li>
          <li><strong>Google Gemini AI:</strong> AI vision analysis for roof condition. Property images may be processed by Google's AI infrastructure.</li>
          <li><strong>Resend:</strong> Transactional email delivery (when Gmail integration is not used).</li>
          <li><strong>LiveKit:</strong> Voice AI receptionist infrastructure.</li>
        </ul>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">7. Your Rights (PIPEDA — Canada)</h2>
        <p class="text-gray-600 leading-relaxed mb-3">Under Canada's Personal Information Protection and Electronic Documents Act (PIPEDA), you have the right to:</p>
        <ul class="list-disc list-inside space-y-2 text-gray-600">
          <li>Access the personal information we hold about you.</li>
          <li>Correct inaccurate information.</li>
          <li>Request deletion of your account and associated data.</li>
          <li>Withdraw consent for data processing (subject to legal and contractual obligations).</li>
        </ul>
        <p class="text-gray-600 mt-3">To exercise any of these rights, email us at <a href="mailto:privacy@roofmanager.ca" class="text-brand-600 hover:underline">privacy@roofmanager.ca</a>. We will respond within 30 days.</p>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">8. Data Retention</h2>
        <p class="text-gray-600 leading-relaxed">We retain your account data for as long as your account is active. If you delete your account, we will delete your personal information within 30 days, except where we are required to retain records for legal or accounting purposes (typically 7 years for financial records under Canadian tax law).</p>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">9. Cookies</h2>
        <p class="text-gray-600 leading-relaxed">We use a single session cookie to keep you logged in. We use Google Analytics (GA4) to understand aggregate traffic patterns. No advertising cookies are used.</p>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">10. Changes to This Policy</h2>
        <p class="text-gray-600 leading-relaxed">We may update this privacy policy from time to time. We will notify registered users by email of material changes. Continued use of the service after changes constitutes acceptance of the revised policy.</p>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">11. Contact</h2>
        <p class="text-gray-600 leading-relaxed">For any privacy-related questions or requests, contact:<br><strong>Roof Manager</strong><br>Alberta, Canada<br><a href="mailto:privacy@roofmanager.ca" class="text-brand-600 hover:underline">privacy@roofmanager.ca</a></p>
      </section>

    </div>
  </main>
  <footer class="bg-slate-900 text-gray-500 py-8 border-t border-gray-800 mt-12">
    <div class="max-w-4xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
      <div class="flex items-center gap-2">
        <img src="/static/logo.png" alt="Roof Manager" class="w-6 h-6 rounded object-cover">
        <span class="text-sm font-semibold text-gray-400">Roof Manager</span>
      </div>
      <div class="flex flex-wrap items-center gap-3 sm:gap-6 text-sm">
        <a href="/" class="hover:text-cyan-400 transition-colors">Home</a>
        <a href="/privacy" class="text-cyan-400 font-semibold">Privacy Policy</a>
        <a href="/terms" class="hover:text-cyan-400 transition-colors">Terms of Service</a>
        <a href="/customer/login" class="hover:text-cyan-400 transition-colors">Login</a>
      </div>
      <p class="text-xs">&copy; 2026 Roof Manager</p>
    </div>
  </footer>
</body>
</html>`
}

function getTermsPageHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Terms of Service — Roof Manager</title>
</head>
<body class="bg-gray-50 text-gray-800">
  <header class="bg-white border-b border-gray-200 sticky top-0 z-50">
    <div class="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
      <a href="/" class="flex items-center gap-3">
        <img src="/static/logo.png" alt="Roof Manager" class="w-9 h-9 rounded-lg object-cover">
        <span class="font-bold text-lg text-gray-900">Roof Manager</span>
      </a>
      <a href="/" class="text-sm text-gray-500 hover:text-gray-700"><i class="fas fa-arrow-left mr-1"></i>Back to Home</a>
    </div>
  </header>
  <main class="max-w-4xl mx-auto px-4 py-12">
    <h1 class="text-2xl sm:text-4xl font-bold text-gray-900 mb-2">Terms of Service</h1>
    <p class="text-gray-500 mb-10">Last updated: March 31, 2026</p>

    <div class="prose prose-gray max-w-none space-y-8">

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">1. Acceptance of Terms</h2>
        <p class="text-gray-600 leading-relaxed">By creating an account or using Roof Manager ("Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service. These terms are governed by the laws of Alberta, Canada.</p>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">2. Description of Service</h2>
        <p class="text-gray-600 leading-relaxed mb-3">Roof Manager provides roofing professionals with:</p>
        <ul class="list-disc list-inside space-y-2 text-gray-600">
          <li>AI-powered roof measurement reports generated from satellite imagery and Google Solar API data.</li>
          <li>A customer relationship management (CRM) system for managing leads, jobs, and customers.</li>
          <li>Invoicing tools with Square payment integration.</li>
          <li>An AI voice receptionist powered by LiveKit.</li>
          <li>Optional Gmail integration for sending reports and invoices from your own email address.</li>
        </ul>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">3. Account Registration</h2>
        <p class="text-gray-600 leading-relaxed">You must provide accurate information when registering. You are responsible for maintaining the confidentiality of your account credentials and for all activity under your account. Notify us immediately at <a href="mailto:support@roofmanager.ca" class="text-brand-600 hover:underline">support@roofmanager.ca</a> if you suspect unauthorized access.</p>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">4. Pricing and Payment</h2>
        <ul class="list-disc list-inside space-y-2 text-gray-600">
          <li><strong>Free reports:</strong> Each new account receives 3 complimentary reports at no charge.</li>
          <li><strong>Individual report:</strong> $5.00 USD per report.</li>
          <li><strong>25-Pack:</strong> $99 USD (25 reports, ~$3.96/report — save 21%).</li>
          <li><strong>100-Pack:</strong> $299 USD (100 reports, ~$2.99/report — save 40%).</li>
          <li><strong>Team Membership:</strong> $49.99 USD/month. Includes up to 5 team member accounts and an ad-free experience. Reports are billed separately via credits.</li>
        </ul>
        <p class="text-gray-600 mt-3">Credits do not expire. All payments are processed by Square. All prices are in USD unless otherwise stated.</p>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">5. Refund Policy</h2>
        <p class="text-gray-600 leading-relaxed">Reports are generated automatically upon submission. Because the service is delivered immediately and consumes third-party API resources, <strong>reports are non-refundable once generated</strong>. If you believe a report contains a technical error, contact us at <a href="mailto:support@roofmanager.ca" class="text-brand-600 hover:underline">support@roofmanager.ca</a> and we will investigate and issue a credit if appropriate. Unused credit packs may be refunded within 14 days of purchase.</p>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">6. Acceptable Use</h2>
        <p class="text-gray-600 leading-relaxed mb-3">You agree not to:</p>
        <ul class="list-disc list-inside space-y-2 text-gray-600">
          <li>Use the Service for any unlawful purpose or in violation of any regulations.</li>
          <li>Attempt to reverse-engineer, scrape, or extract data from the Service in bulk.</li>
          <li>Use the Gmail integration to send spam, phishing messages, or any communication not related to legitimate roofing business activities.</li>
          <li>Share your account credentials with individuals outside your authorized team.</li>
          <li>Misrepresent the accuracy of reports to property owners or insurance companies.</li>
        </ul>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">7. Accuracy of Reports</h2>
        <p class="text-gray-600 leading-relaxed">Roof measurement reports are generated using satellite imagery, AI vision analysis, and geospatial modeling. While we strive for accuracy, reports are <strong>estimates</strong> intended as a professional starting point. Always verify measurements on-site before ordering materials or submitting insurance claims. Roof Manager is not liable for losses resulting from reliance on report estimates without field verification.</p>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">8. Gmail Integration</h2>
        <p class="text-gray-600 leading-relaxed">The optional Gmail integration uses the <code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm">gmail.send</code> scope to send emails on your behalf. By connecting your Gmail account, you authorize Roof Manager to send emails from your address when you explicitly trigger a send action within the platform. You may revoke this authorization at any time via your Google account settings.</p>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">9. Intellectual Property</h2>
        <p class="text-gray-600 leading-relaxed">You retain ownership of the property addresses and business data you input. Roof Manager retains ownership of the platform, AI models, measurement algorithms, and generated report templates. You are granted a non-exclusive, non-transferable license to use the reports for your roofing business activities.</p>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">10. Limitation of Liability</h2>
        <p class="text-gray-600 leading-relaxed">To the maximum extent permitted by applicable law, Roof Manager shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Service, including but not limited to lost profits, data loss, or business interruption. Our total cumulative liability shall not exceed the amount you paid to us in the 30 days preceding the claim.</p>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">11. Termination</h2>
        <p class="text-gray-600 leading-relaxed">You may delete your account at any time. We reserve the right to suspend or terminate accounts that violate these terms. Upon termination, your credits are forfeited and your data will be deleted in accordance with our Privacy Policy.</p>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">12. Changes to Terms</h2>
        <p class="text-gray-600 leading-relaxed">We may update these terms at any time. We will notify users by email of material changes. Continued use of the Service after changes are posted constitutes acceptance.</p>
      </section>

      <section>
        <h2 class="text-xl font-semibold text-gray-900 mb-3">13. Contact</h2>
        <p class="text-gray-600 leading-relaxed"><strong>Roof Manager</strong><br>Alberta, Canada<br><a href="mailto:support@roofmanager.ca" class="text-brand-600 hover:underline">support@roofmanager.ca</a></p>
      </section>

    </div>
  </main>
  <footer class="bg-slate-900 text-gray-500 py-8 border-t border-gray-800 mt-12">
    <div class="max-w-4xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
      <div class="flex items-center gap-2">
        <img src="/static/logo.png" alt="Roof Manager" class="w-6 h-6 rounded object-cover">
        <span class="text-sm font-semibold text-gray-400">Roof Manager</span>
      </div>
      <div class="flex flex-wrap items-center gap-3 sm:gap-6 text-sm">
        <a href="/" class="hover:text-cyan-400 transition-colors">Home</a>
        <a href="/privacy" class="hover:text-cyan-400 transition-colors">Privacy Policy</a>
        <a href="/terms" class="text-cyan-400 font-semibold">Terms of Service</a>
        <a href="/customer/login" class="hover:text-cyan-400 transition-colors">Login</a>
      </div>
      <p class="text-xs">&copy; 2026 Roof Manager</p>
    </div>
  </footer>
</body>
</html>`
}

function getMaterialCalculatorPageHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>Material Calculator - Roof Manager</title>
  <style>
    @media print {
      header, #mc-waste-controls, #mc-action-bar, nav { display: none !important; }
      body { background: white; }
      .shadow-sm, .rounded-2xl { box-shadow: none !important; }
    }
  </style>
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-gradient-to-r from-sky-600 to-blue-700 text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
      <a href="/customer/dashboard" class="flex items-center space-x-3 hover:opacity-90">
        <img src="/static/logo.png" alt="Roof Manager" class="w-10 h-10 rounded-lg object-cover">
        <div>
          <h1 class="text-lg font-bold leading-tight">Material Calculator</h1>
          <p class="text-sky-200 text-xs">Roof Manager</p>
        </div>
      </a>
      <nav class="flex items-center space-x-4">
        <span id="custGreeting" class="text-sky-200 text-sm hidden"><i class="fas fa-user-circle mr-1"></i><span id="custName"></span></span>
        <a href="/customer/dashboard" class="text-sky-200 hover:text-white text-sm"><i class="fas fa-th-large mr-1"></i>Dashboard</a>
        <button onclick="custLogout()" class="text-sky-200 hover:text-white text-sm"><i class="fas fa-sign-out-alt mr-1"></i>Logout</button>
      </nav>
    </div>
  </header>
  <main class="max-w-5xl mx-auto px-4 py-6">
    <div id="mat-calc-root"></div>
  </main>
  <script>
    (function() {
      var c = localStorage.getItem('rc_customer');
      if (!c) { window.location.href = '/customer/login'; return; }
      try {
        var u = JSON.parse(c);
        var g = document.getElementById('custGreeting');
        var n = document.getElementById('custName');
        if (g && n) { n.textContent = u.name || u.email; g.classList.remove('hidden'); }
      } catch(e) {}
    })();
    function custLogout() {
      var token = localStorage.getItem('rc_customer_token');
      if (token) fetch('/api/customer/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } })['catch'](function(){});
      localStorage.removeItem('rc_customer');
      localStorage.removeItem('rc_customer_token');
      window.location.href = '/customer/login';
    }
  </script>
  <script src="/static/material-calculator.js?v=${Date.now()}"></script>
  ${getRoverAssistant()}
</body>
</html>`
}

// ============================================================
// Website Builder Page HTML
// ============================================================
function getWebsiteBuilderPageHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${getHeadTags()}
  <title>AI Website Builder - Roof Manager</title>
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg">
    <div class="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <a href="/customer/dashboard" class="flex items-center space-x-3 hover:opacity-90">
          <img src="/static/logo.png" alt="Roof Manager" class="w-10 h-10 rounded-lg object-cover">
          <div>
            <h1 class="text-lg font-bold">AI Website Builder</h1>
            <p class="text-brand-200 text-xs">Roof Manager</p>
          </div>
        </a>
      </div>
      <nav class="flex items-center space-x-3">
        <span id="custGreeting" class="text-brand-200 text-sm hidden"><i class="fas fa-user-circle mr-1"></i><span id="custName"></span></span>
        <a href="/customer/dashboard" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-th-large mr-1"></i>Dashboard</a>
        <button onclick="custLogout()" class="text-brand-200 hover:text-white text-sm"><i class="fas fa-sign-out-alt mr-1"></i>Logout</button>
      </nav>
    </div>
  </header>
  <main class="py-6">
    <div id="wb-root"></div>
  </main>
  <script>
    (function() {
      var c = localStorage.getItem('rc_customer');
      if (!c) { window.location.href = '/customer/login'; return; }
      try {
        var u = JSON.parse(c);
        var g = document.getElementById('custGreeting');
        var n = document.getElementById('custName');
        if (g && n) { n.textContent = u.name || u.email; g.classList.remove('hidden'); }
      } catch(e) {}
    })();
    function custLogout() {
      var token = localStorage.getItem('rc_customer_token');
      if (token) fetch('/api/customer/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } })['catch'](function(){});
      localStorage.removeItem('rc_customer');
      localStorage.removeItem('rc_customer_token');
      window.location.href = '/customer/login';
    }
  </script>
  <script src="/static/website-builder.js?v=${Date.now()}"></script>
  ${getRoverAssistant()}
</body>
</html>`
}

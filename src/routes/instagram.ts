// ============================================================
// Roof Manager — Instagram Super-Admin Module
// All endpoints under /api/admin/instagram
// Requires validateAdminSession + requireSuperadmin
// ============================================================

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { validateAdminSession, requireSuperadmin } from './auth'
import { pullAccount, pullPostsSince, buildConfig } from '../services/instagram/ig-pull'
import { pullCompetitor, pullAllCompetitors } from '../services/instagram/competitor-pull'
import { runResearchEngine } from '../services/instagram/research-engine'
import { runIdeationEngine } from '../services/instagram/ideation-engine'
import { produceFromIdea } from '../services/instagram/production-engine'
import { publishDueSchedule, publishNow, schedulePost } from '../services/instagram/publishing-engine'
import { createBoost, reallocateBoostBudgets, updateBoostStatus } from '../services/instagram/boost-engine'
import { runLeadAttribution, getLeadSummary, deduplicateLeads } from '../services/instagram/lead-attribution'
import { initializePool } from '../services/instagram/phone-tracking'

export const instagramRoutes = new Hono<{ Bindings: Bindings }>()

// ── Rate limiting state (per-worker, 1 call per 60s for pull endpoints) ──
let lastPullAt = 0

// ── Auth middleware ──
instagramRoutes.use('/*', async (c, next) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ success: false, error: 'Admin authentication required' }, 401)
  if (!requireSuperadmin(admin)) return c.json({ success: false, error: 'Superadmin access required' }, 403)
  c.set('admin' as any, admin)
  return next()
})

// ============================================================
// ACCOUNT & STATUS
// ============================================================

instagramRoutes.get('/status', async (c) => {
  const acct = await c.env.DB.prepare('SELECT * FROM instagram_account LIMIT 1').first<any>()
  const hasToken = !!((c.env as any).INSTAGRAM_PAGE_ACCESS_TOKEN || (c.env as any).GRAPH_API_KEY || (c.env as any).graph_api_key)
  const hasIgId = !!((c.env as any).INSTAGRAM_BUSINESS_ACCOUNT_ID) || !!acct
  const configured = hasToken

  return c.json({
    success: true,
    data: {
      configured,
      has_token: hasToken,
      has_ig_id: hasIgId,
      account: acct || null,
      token_health: hasToken ? 'configured' : 'missing',
      last_synced_at: acct?.last_synced_at || null,
    },
  })
})

// Auto-connect: discover IG Business Account ID from the access token
instagramRoutes.post('/auto-connect', async (c) => {
  const accessToken = (c.env as any).INSTAGRAM_PAGE_ACCESS_TOKEN || (c.env as any).GRAPH_API_KEY || (c.env as any).graph_api_key
  if (!accessToken) return c.json({ success: false, error: 'No access token configured (set GRAPH_API_KEY or INSTAGRAM_PAGE_ACCESS_TOKEN in Cloudflare secrets)' }, 400)

  const apiVersion = (c.env as any).INSTAGRAM_GRAPH_API_VERSION || 'v21.0'

  try {
    // Step 1: Get user's pages
    const pagesRes = await fetch(`https://graph.facebook.com/${apiVersion}/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${accessToken}`)
    const pagesData = await pagesRes.json() as any
    if (pagesData.error) return c.json({ success: false, error: pagesData.error.message }, 400)

    const pages = pagesData.data || []
    if (pages.length === 0) return c.json({ success: false, error: 'No Facebook Pages found. Make sure your token has pages_show_list permission.' }, 400)

    // Find the first page with an Instagram Business Account
    let igUserId = ''
    let igUsername = ''
    let pageId = ''
    let pageName = ''

    for (const page of pages) {
      if (page.instagram_business_account?.id) {
        igUserId = page.instagram_business_account.id
        pageId = page.id
        pageName = page.name

        // Get IG account details
        const igRes = await fetch(`https://graph.facebook.com/${apiVersion}/${igUserId}?fields=id,username,name,profile_picture_url,followers_count,follows_count,media_count&access_token=${accessToken}`)
        const igData = await igRes.json() as any
        if (!igData.error) {
          igUsername = igData.username || ''

          // Upsert instagram_account
          const existing = await c.env.DB.prepare('SELECT id FROM instagram_account WHERE ig_user_id = ?').bind(igUserId).first<any>()
          if (existing) {
            await c.env.DB.prepare(`
              UPDATE instagram_account SET username=?, page_id=?, access_token_encrypted=?, follower_count=?, following_count=?, media_count=?, last_synced_at=datetime('now'), updated_at=datetime('now') WHERE id=?
            `).bind(igUsername, pageId, '(stored in env)', igData.followers_count || 0, igData.follows_count || 0, igData.media_count || 0, existing.id).run()
          } else {
            await c.env.DB.prepare(`
              INSERT INTO instagram_account (ig_user_id, username, page_id, access_token_encrypted, follower_count, following_count, media_count, last_synced_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
            `).bind(igUserId, igUsername, pageId, '(stored in env)', igData.followers_count || 0, igData.follows_count || 0, igData.media_count || 0).run()
          }

          return c.json({
            success: true,
            data: {
              ig_user_id: igUserId,
              username: igUsername,
              page_id: pageId,
              page_name: pageName,
              followers: igData.followers_count || 0,
              media_count: igData.media_count || 0,
              message: `Connected @${igUsername} (${igData.followers_count} followers). The IG Business Account ID is ${igUserId} — you can set INSTAGRAM_BUSINESS_ACCOUNT_ID to this value in Cloudflare secrets, or leave it and the system will auto-detect.`,
            },
          })
        }
      }
    }

    // No IG Business Account found
    return c.json({
      success: false,
      error: `Found ${pages.length} Facebook Page(s) (${pages.map((p: any) => p.name).join(', ')}) but none have an Instagram Business Account linked. Link your IG account to a Facebook Page first.`,
      pages: pages.map((p: any) => ({ id: p.id, name: p.name, has_ig: !!p.instagram_business_account })),
    })
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500)
  }
})

// ============================================================
// PHASE 1: DATA (Skill: IG Pull)
// ============================================================

instagramRoutes.post('/pull/account', async (c) => {
  const now = Date.now()
  if (now - lastPullAt < 60000) {
    return c.json({ success: false, error: 'Rate limited — wait 60s between pulls' }, 429)
  }
  lastPullAt = now

  const result = await pullAccount(c.env)
  return c.json({ success: result.ok, data: result })
})

instagramRoutes.post('/pull/posts', async (c) => {
  const { since } = c.req.query()
  const sinceDate = since || new Date(Date.now() - 90 * 86400000).toISOString()
  const result = await pullPostsSince(c.env, sinceDate)
  return c.json({ success: result.ok, data: result })
})

instagramRoutes.get('/posts', async (c) => {
  const limit = parseInt(c.req.query('limit') || '20')
  const offset = parseInt(c.req.query('offset') || '0')
  const sort = c.req.query('sort') || 'posted_at'
  const validSorts = ['posted_at', 'engagement_rate', 'reach', 'like_count', 'cpl_blended_cents']
  const sortCol = validSorts.includes(sort) ? sort : 'posted_at'

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM instagram_posts ORDER BY ${sortCol} DESC LIMIT ? OFFSET ?`
  ).bind(limit, offset).all<any>()

  const countRow = await c.env.DB.prepare('SELECT COUNT(*) as total FROM instagram_posts').first<any>()
  return c.json({ success: true, data: { posts: results || [], total: countRow?.total || 0 } })
})

instagramRoutes.get('/posts/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const post = await c.env.DB.prepare('SELECT * FROM instagram_posts WHERE id = ?').bind(id).first<any>()
  if (!post) return c.json({ success: false, error: 'Post not found' }, 404)

  // Get leads for this post
  const { results: leads } = await c.env.DB.prepare(
    'SELECT * FROM instagram_leads WHERE post_id = ? ORDER BY created_at DESC'
  ).bind(id).all<any>()

  // Get boosts
  const { results: boosts } = await c.env.DB.prepare(
    'SELECT * FROM instagram_boosts WHERE post_id = ?'
  ).bind(id).all<any>()

  return c.json({ success: true, data: { post, leads: leads || [], boosts: boosts || [] } })
})

instagramRoutes.get('/analytics/daily', async (c) => {
  const from = c.req.query('from') || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const to = c.req.query('to') || new Date().toISOString().slice(0, 10)
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM instagram_analytics_daily WHERE snapshot_date BETWEEN ? AND ? ORDER BY snapshot_date ASC'
  ).bind(from, to).all<any>()
  return c.json({ success: true, data: results || [] })
})

instagramRoutes.get('/analytics/summary', async (c) => {
  const window = c.req.query('window') || '30d'
  const days = window === '7d' ? 7 : window === '90d' ? 90 : 30

  const summary = await c.env.DB.prepare(`
    SELECT
      (SELECT follower_count FROM instagram_account LIMIT 1) as followers,
      (SELECT follower_count FROM instagram_analytics_daily WHERE snapshot_date <= date('now', '-${days} days') ORDER BY snapshot_date DESC LIMIT 1) as followers_prev,
      COALESCE(SUM(impressions), 0) as impressions,
      COALESCE(SUM(reach), 0) as reach,
      COALESCE(SUM(website_clicks), 0) as website_clicks,
      COALESCE(SUM(profile_views), 0) as profile_views
    FROM instagram_analytics_daily
    WHERE snapshot_date > date('now', '-${days} days')
  `).first<any>()

  const engRate = await c.env.DB.prepare(`
    SELECT AVG(engagement_rate) as avg_eng FROM instagram_posts WHERE posted_at > datetime('now', '-${days} days')
  `).first<any>()

  const leads = await c.env.DB.prepare(`
    SELECT COUNT(*) as organic_leads FROM instagram_leads WHERE source_channel != 'phone' AND created_at > datetime('now', '-${days} days')
  `).first<any>()

  const cpl = await c.env.DB.prepare(`
    SELECT
      COALESCE(SUM(b.spent_cents), 0) + COALESCE(SUM(p.production_cost_cents), 0) as total_cost,
      (SELECT COUNT(*) FROM instagram_leads WHERE qualified = 1 AND created_at > datetime('now', '-${days} days')) as qualified_leads
    FROM instagram_posts p
    LEFT JOIN instagram_boosts b ON b.post_id = p.id
    WHERE p.posted_at > datetime('now', '-${days} days')
  `).first<any>()

  const blendedCpl = (cpl?.qualified_leads || 0) > 0 ? Math.round((cpl?.total_cost || 0) / cpl.qualified_leads) : 0

  return c.json({
    success: true,
    data: {
      followers: summary?.followers || 0,
      followers_delta: (summary?.followers || 0) - (summary?.followers_prev || summary?.followers || 0),
      impressions: summary?.impressions || 0,
      reach: summary?.reach || 0,
      engagement_rate: Math.round((engRate?.avg_eng || 0) * 10000) / 100,
      organic_leads: leads?.organic_leads || 0,
      blended_cpl_cents: blendedCpl,
      website_clicks: summary?.website_clicks || 0,
      profile_views: summary?.profile_views || 0,
    },
  })
})

// ============================================================
// PHASE 2: RESEARCH (Skill: Competitor Analysis)
// ============================================================

instagramRoutes.get('/competitors', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM instagram_competitors ORDER BY follower_count DESC').all<any>()
  return c.json({ success: true, data: results || [] })
})

instagramRoutes.post('/competitors', async (c) => {
  const { username, display_name, notes } = await c.req.json()
  if (!username) return c.json({ success: false, error: 'username required' }, 400)
  await c.env.DB.prepare(
    'INSERT INTO instagram_competitors (username, display_name, notes) VALUES (?, ?, ?)'
  ).bind(username.replace('@', ''), display_name || username, notes || '').run()
  return c.json({ success: true })
})

instagramRoutes.delete('/competitors/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM instagram_competitor_posts WHERE competitor_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM instagram_competitors WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

instagramRoutes.post('/competitors/:id/pull', async (c) => {
  const id = parseInt(c.req.param('id'))
  const result = await pullCompetitor(c.env, id)
  return c.json({ success: result.ok, data: result })
})

instagramRoutes.post('/competitors/pull-all', async (c) => {
  const result = await pullAllCompetitors(c.env)
  return c.json({ success: result.ok, data: result })
})

instagramRoutes.get('/research/hashtags', async (c) => {
  const window = parseInt(c.req.query('window') || '30')
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM instagram_research WHERE kind='hashtag' AND window_days <= ? ORDER BY score DESC LIMIT 50"
  ).bind(window).all<any>()
  return c.json({ success: true, data: results || [] })
})

instagramRoutes.get('/research/hooks', async (c) => {
  const window = parseInt(c.req.query('window') || '30')
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM instagram_research WHERE kind='hook' AND window_days <= ? ORDER BY score DESC LIMIT 30"
  ).bind(window).all<any>()
  return c.json({ success: true, data: results || [] })
})

instagramRoutes.get('/research/gaps', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM instagram_research WHERE kind='content_gap' ORDER BY score DESC LIMIT 20"
  ).all<any>()
  return c.json({ success: true, data: results || [] })
})

instagramRoutes.post('/research/run', async (c) => {
  const result = await runResearchEngine(c.env)
  return c.json({ success: result.ok, data: result })
})

// ============================================================
// PHASES 3 & 4: IDEATION + PRODUCTION (Skill: Film Today)
// ============================================================

instagramRoutes.post('/ideas/generate', async (c) => {
  const n = parseInt(c.req.query('n') || '10')
  const result = await runIdeationEngine(c.env, n)
  return c.json({ success: result.ok, data: result })
})

instagramRoutes.get('/ideas', async (c) => {
  const status = c.req.query('status')
  let query = 'SELECT * FROM instagram_content_ideas'
  const binds: any[] = []
  if (status) { query += ' WHERE status = ?'; binds.push(status) }
  query += ' ORDER BY created_at DESC LIMIT 50'

  const { results } = await c.env.DB.prepare(query).bind(...binds).all<any>()
  return c.json({ success: true, data: results || [] })
})

instagramRoutes.post('/ideas/:id/approve', async (c) => {
  const id = parseInt(c.req.param('id'))
  const admin = (c as any).get('admin')
  await c.env.DB.prepare(
    "UPDATE instagram_content_ideas SET status='approved', approved_by=?, approved_at=datetime('now'), updated_at=datetime('now') WHERE id=?"
  ).bind(admin?.id || 0, id).run()
  return c.json({ success: true })
})

instagramRoutes.post('/ideas/:id/reject', async (c) => {
  const id = parseInt(c.req.param('id'))
  await c.env.DB.prepare(
    "UPDATE instagram_content_ideas SET status='archived', updated_at=datetime('now') WHERE id=?"
  ).bind(id).run()
  return c.json({ success: true })
})

instagramRoutes.post('/ideas/:id/produce', async (c) => {
  const id = parseInt(c.req.param('id'))
  const result = await produceFromIdea(c.env, id)
  return c.json({ success: result.ok, data: result })
})

instagramRoutes.get('/drafts/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const draft = await c.env.DB.prepare('SELECT * FROM instagram_drafts WHERE id = ?').bind(id).first<any>()
  if (!draft) return c.json({ success: false, error: 'Draft not found' }, 404)

  // Generate signed URLs for R2 assets if R2 is available
  const r2 = (c.env as any).INSTAGRAM_R2
  let compositeUrl: string | null = null
  let voiceoverUrl: string | null = null

  if (r2 && draft.composite_r2_key) {
    try {
      const obj = await r2.get(draft.composite_r2_key)
      if (obj) {
        const arrayBuf = await obj.arrayBuffer()
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf.slice(0, 1024))))
        compositeUrl = `data:image/jpeg;base64,${base64}` // Thumbnail only
      }
    } catch { /* R2 not available */ }
  }

  return c.json({ success: true, data: { ...draft, composite_url: compositeUrl, voiceover_url: voiceoverUrl } })
})

instagramRoutes.post('/drafts/:id/regenerate', async (c) => {
  const id = parseInt(c.req.param('id'))
  const { part } = c.req.query()
  const draft = await c.env.DB.prepare('SELECT idea_id FROM instagram_drafts WHERE id = ?').bind(id).first<any>()
  if (!draft) return c.json({ success: false, error: 'Draft not found' }, 404)

  // Re-run production for the idea
  await c.env.DB.prepare("UPDATE instagram_content_ideas SET status='approved', updated_at=datetime('now') WHERE id=?").bind(draft.idea_id).run()
  await c.env.DB.prepare('DELETE FROM instagram_drafts WHERE id = ?').bind(id).run()
  const result = await produceFromIdea(c.env, draft.idea_id)
  return c.json({ success: result.ok, data: result })
})

instagramRoutes.put('/drafts/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json()
  const updates: string[] = []
  const values: any[] = []

  if (body.caption_primary !== undefined) { updates.push('caption_primary=?'); values.push(body.caption_primary) }
  if (body.caption_alt_a !== undefined) { updates.push('caption_alt_a=?'); values.push(body.caption_alt_a) }
  if (body.caption_alt_b !== undefined) { updates.push('caption_alt_b=?'); values.push(body.caption_alt_b) }
  if (body.script_json !== undefined) { updates.push('script_json=?'); values.push(JSON.stringify(body.script_json)) }
  if (body.hashtags_json !== undefined) { updates.push('hashtags_json=?'); values.push(JSON.stringify(body.hashtags_json)) }

  if (updates.length === 0) return c.json({ success: false, error: 'No valid fields to update' }, 400)
  updates.push("updated_at=datetime('now')")
  values.push(id)

  await c.env.DB.prepare(`UPDATE instagram_drafts SET ${updates.join(',')} WHERE id=?`).bind(...values).run()
  return c.json({ success: true })
})

// ============================================================
// PHASE 5: PUBLISHING + BOOST
// ============================================================

instagramRoutes.post('/schedule', async (c) => {
  const { draft_id, scheduled_at } = await c.req.json()
  if (!draft_id || !scheduled_at) return c.json({ success: false, error: 'draft_id and scheduled_at required' }, 400)
  const result = await schedulePost(c.env, draft_id, scheduled_at)
  return c.json({ success: result.ok, data: result })
})

instagramRoutes.get('/schedule', async (c) => {
  const status = c.req.query('status')
  let query = 'SELECT s.*, d.media_type, d.caption_primary, d.composite_r2_key FROM instagram_schedule s JOIN instagram_drafts d ON d.id = s.draft_id'
  const binds: any[] = []
  if (status) { query += ' WHERE s.status = ?'; binds.push(status) }
  query += ' ORDER BY s.scheduled_at ASC'

  const { results } = await c.env.DB.prepare(query).bind(...binds).all<any>()
  return c.json({ success: true, data: results || [] })
})

instagramRoutes.post('/schedule/:id/cancel', async (c) => {
  const id = parseInt(c.req.param('id'))
  await c.env.DB.prepare("UPDATE instagram_schedule SET status='canceled' WHERE id=?").bind(id).run()
  return c.json({ success: true })
})

instagramRoutes.post('/schedule/:id/publish-now', async (c) => {
  const id = parseInt(c.req.param('id'))
  const result = await publishNow(c.env, id)
  return c.json({ success: result.ok, error: result.error })
})

instagramRoutes.post('/boosts', async (c) => {
  const { post_id, daily_budget_cents, duration_days } = await c.req.json()
  if (!post_id || !daily_budget_cents) return c.json({ success: false, error: 'post_id and daily_budget_cents required' }, 400)
  const result = await createBoost(c.env, post_id, daily_budget_cents, duration_days || 7)
  return c.json({ success: result.ok, data: result })
})

instagramRoutes.patch('/boosts/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const { status, daily_budget_cents } = await c.req.json()
  if (status) {
    await updateBoostStatus(c.env, id, status)
  }
  if (daily_budget_cents !== undefined) {
    await c.env.DB.prepare('UPDATE instagram_boosts SET daily_budget_cents=? WHERE id=?').bind(daily_budget_cents, id).run()
  }
  return c.json({ success: true })
})

instagramRoutes.post('/boosts/reallocate', async (c) => {
  const result = await reallocateBoostBudgets(c.env)
  return c.json({ success: result.ok, data: result })
})

instagramRoutes.get('/boosts', async (c) => {
  const postId = c.req.query('post_id')
  let query = 'SELECT * FROM instagram_boosts'
  const binds: any[] = []
  if (postId) { query += ' WHERE post_id = ?'; binds.push(parseInt(postId)) }
  query += ' ORDER BY created_at DESC'

  const { results } = await c.env.DB.prepare(query).bind(...binds).all<any>()
  return c.json({ success: true, data: results || [] })
})

// ============================================================
// LEADS & ATTRIBUTION
// ============================================================

instagramRoutes.get('/leads', async (c) => {
  const source = c.req.query('source')
  const postId = c.req.query('post_id')
  const from = c.req.query('from')
  const to = c.req.query('to')

  let query = 'SELECT * FROM instagram_leads WHERE 1=1'
  const binds: any[] = []

  if (source) { query += ' AND source_channel = ?'; binds.push(source) }
  if (postId) { query += ' AND post_id = ?'; binds.push(parseInt(postId)) }
  if (from) { query += ' AND created_at >= ?'; binds.push(from) }
  if (to) { query += ' AND created_at <= ?'; binds.push(to) }

  query += ' ORDER BY created_at DESC LIMIT 100'
  const { results } = await c.env.DB.prepare(query).bind(...binds).all<any>()
  return c.json({ success: true, data: results || [] })
})

instagramRoutes.patch('/leads/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json()
  const updates: string[] = []
  const values: any[] = []

  if (body.qualified !== undefined) { updates.push('qualified=?'); values.push(body.qualified) }
  if (body.converted_to_order_id !== undefined) {
    updates.push('converted_to_order_id=?'); values.push(body.converted_to_order_id)
    updates.push("converted_at=datetime('now')")
  }
  if (body.contact_name !== undefined) { updates.push('contact_name=?'); values.push(body.contact_name) }
  if (body.contact_email !== undefined) { updates.push('contact_email=?'); values.push(body.contact_email) }
  if (body.contact_phone !== undefined) { updates.push('contact_phone=?'); values.push(body.contact_phone) }

  if (updates.length === 0) return c.json({ success: false, error: 'No fields to update' }, 400)
  values.push(id)

  await c.env.DB.prepare(`UPDATE instagram_leads SET ${updates.join(',')} WHERE id=?`).bind(...values).run()
  return c.json({ success: true })
})

instagramRoutes.get('/leads/summary', async (c) => {
  const summary = await getLeadSummary(c.env)
  return c.json({ success: true, data: summary })
})

// ============================================================
// DM KEYWORDS
// ============================================================

instagramRoutes.get('/dm-keywords', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM instagram_dm_keywords ORDER BY hit_count DESC').all<any>()
  return c.json({ success: true, data: results || [] })
})

instagramRoutes.post('/dm-keywords', async (c) => {
  const { keyword, reply_template, landing_url } = await c.req.json()
  if (!keyword || !reply_template || !landing_url) return c.json({ success: false, error: 'keyword, reply_template, landing_url required' }, 400)
  await c.env.DB.prepare(
    'INSERT INTO instagram_dm_keywords (keyword, reply_template, landing_url) VALUES (?, ?, ?)'
  ).bind(keyword.toUpperCase(), reply_template, landing_url).run()
  return c.json({ success: true })
})

instagramRoutes.patch('/dm-keywords/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const body = await c.req.json()
  const updates: string[] = []
  const values: any[] = []

  if (body.keyword !== undefined) { updates.push('keyword=?'); values.push(body.keyword.toUpperCase()) }
  if (body.reply_template !== undefined) { updates.push('reply_template=?'); values.push(body.reply_template) }
  if (body.landing_url !== undefined) { updates.push('landing_url=?'); values.push(body.landing_url) }
  if (body.is_active !== undefined) { updates.push('is_active=?'); values.push(body.is_active ? 1 : 0) }

  if (updates.length === 0) return c.json({ success: false, error: 'No fields' }, 400)
  values.push(id)

  await c.env.DB.prepare(`UPDATE instagram_dm_keywords SET ${updates.join(',')} WHERE id=?`).bind(...values).run()
  return c.json({ success: true })
})

// ============================================================
// TRACKING NUMBERS
// ============================================================

instagramRoutes.get('/tracking-numbers', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM instagram_tracking_numbers ORDER BY assigned_at DESC').all<any>()
  return c.json({ success: true, data: results || [] })
})

instagramRoutes.post('/tracking-numbers/provision', async (c) => {
  const result = await initializePool(c.env)
  return c.json({ success: result.ok, data: result })
})

// ============================================================
// CRON DRY-RUN (manual trigger, superadmin only)
// ============================================================

instagramRoutes.post('/_cron/:job', async (c) => {
  const job = c.req.param('job')

  switch (job) {
    case 'publish': {
      const r = await publishDueSchedule(c.env)
      return c.json({ success: r.ok, data: r })
    }
    case 'insights': {
      const r = await pullAccount(c.env)
      return c.json({ success: r.ok, data: r })
    }
    case 'competitors': {
      const r = await pullAllCompetitors(c.env)
      return c.json({ success: r.ok, data: r })
    }
    case 'research': {
      const r = await runResearchEngine(c.env)
      return c.json({ success: r.ok, data: r })
    }
    case 'ideation': {
      const r = await runIdeationEngine(c.env)
      return c.json({ success: r.ok, data: r })
    }
    case 'reallocate': {
      const r = await reallocateBoostBudgets(c.env)
      return c.json({ success: r.ok, data: r })
    }
    case 'attribution': {
      const r = await runLeadAttribution(c.env)
      return c.json({ success: r.ok, data: r })
    }
    default:
      return c.json({ success: false, error: `Unknown job: ${job}` }, 400)
  }
})

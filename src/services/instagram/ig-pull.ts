// ============================================================
// IG Pull — Skill 1: Sync account, posts, insights, daily snapshot
// Idempotent — safe to run repeatedly.
// ============================================================

import type { Bindings } from '../../types'
import { getAccount, getMediaList, getMediaInsights, getAccountInsights, decryptToken, type GraphClientConfig } from './graph-client'

export async function buildConfig(env: Bindings): Promise<GraphClientConfig> {
  // Check multiple secret names — user may have set token under different key
  const encryptedToken = (env as any).INSTAGRAM_PAGE_ACCESS_TOKEN || (env as any).GRAPH_API_KEY || ''
  const jwtSecret = (env as any).JWT_SECRET || ''
  let accessToken = encryptedToken
  // If the token looks encrypted (base64 with length > 100 and no EAA prefix), decrypt it
  try {
    if (encryptedToken.length > 100 && !encryptedToken.startsWith('EAA') && !encryptedToken.includes('.')) {
      accessToken = await decryptToken(encryptedToken, jwtSecret)
    }
  } catch {
    accessToken = encryptedToken
  }
  // Try to get IG Business Account ID from env, or from DB if already auto-connected
  let igUserId = (env as any).INSTAGRAM_BUSINESS_ACCOUNT_ID || ''
  if (!igUserId && accessToken) {
    try {
      const acctRow = await env.DB.prepare('SELECT ig_user_id FROM instagram_account LIMIT 1').first<any>()
      if (acctRow?.ig_user_id) igUserId = acctRow.ig_user_id
    } catch { /* table may not exist yet */ }
  }

  return {
    accessToken,
    apiVersion: (env as any).INSTAGRAM_GRAPH_API_VERSION || 'v21.0',
    igUserId,
  }
}

export interface PullResult {
  ok: boolean
  account_synced: boolean
  posts_synced: number
  daily_snapshot: boolean
  error?: string
}

export async function pullAccount(env: Bindings): Promise<PullResult> {
  const db = env.DB
  const config = await buildConfig(env)
  if (!config.igUserId || !config.accessToken) {
    return { ok: false, account_synced: false, posts_synced: 0, daily_snapshot: false, error: 'Instagram not configured' }
  }

  let account_synced = false
  let posts_synced = 0
  let daily_snapshot = false

  try {
    // 1. Sync account info
    const acct = await getAccount(config)
    if (acct.error) {
      return { ok: false, account_synced: false, posts_synced: 0, daily_snapshot: false, error: acct.error.message }
    }

    const existing = await db.prepare('SELECT id FROM instagram_account WHERE ig_user_id = ?').bind(config.igUserId).first<any>()
    if (existing) {
      await db.prepare(`
        UPDATE instagram_account SET username=?, follower_count=?, following_count=?, media_count=?, last_synced_at=datetime('now'), updated_at=datetime('now') WHERE id=?
      `).bind(acct.username || '', acct.followers_count || 0, acct.follows_count || 0, acct.media_count || 0, existing.id).run()
    } else {
      const encToken = (env as any).INSTAGRAM_PAGE_ACCESS_TOKEN || ''
      await db.prepare(`
        INSERT INTO instagram_account (ig_user_id, username, page_id, access_token_encrypted, follower_count, following_count, media_count, last_synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(config.igUserId, acct.username || '', '', encToken, acct.followers_count || 0, acct.follows_count || 0, acct.media_count || 0).run()
    }
    account_synced = true

    // 2. Sync recent posts
    const mediaRes = await getMediaList(config, 50)
    const posts = mediaRes.data || []
    for (const post of posts) {
      const existingPost = await db.prepare('SELECT id FROM instagram_posts WHERE ig_media_id = ?').bind(post.id).first<any>()
      if (existingPost) {
        await db.prepare(`
          UPDATE instagram_posts SET like_count=?, comment_count=?, updated_at=datetime('now') WHERE id=?
        `).bind(post.like_count || 0, post.comments_count || 0, existingPost.id).run()
      } else {
        await db.prepare(`
          INSERT INTO instagram_posts (ig_media_id, media_type, caption, permalink, media_url, thumbnail_url, posted_at, like_count, comment_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          post.id, post.media_type || 'IMAGE', post.caption || '', post.permalink || '',
          post.media_url || '', post.thumbnail_url || '', post.timestamp || new Date().toISOString(),
          post.like_count || 0, post.comments_count || 0
        ).run()
      }
      posts_synced++

      // 3. Pull per-post insights (skip if not owner — insights only work for own posts)
      try {
        const insights = await getMediaInsights(config, post.id, post.media_type || 'IMAGE')
        if (insights.data) {
          const metricsMap: Record<string, number> = {}
          for (const m of insights.data) {
            metricsMap[m.name] = m.values?.[0]?.value || 0
          }
          const reach = metricsMap.reach || 0
          const impressions = metricsMap.impressions || 0
          const saves = metricsMap.saved || 0
          const shares = metricsMap.shares || 0
          const videoViews = metricsMap.video_views || metricsMap.plays || 0
          const totalEngagement = (post.like_count || 0) + (post.comments_count || 0) + saves + shares
          const engRate = reach > 0 ? totalEngagement / reach : 0

          await db.prepare(`
            UPDATE instagram_posts SET reach=?, impressions=?, save_count=?, share_count=?, video_views=?, engagement_rate=?, updated_at=datetime('now') WHERE ig_media_id=?
          `).bind(reach, impressions, saves, shares, videoViews, Math.round(engRate * 10000) / 10000, post.id).run()
        }
      } catch {
        // Insights may fail for older posts — skip silently
      }
    }

    // 4. Daily analytics snapshot
    const today = new Date().toISOString().slice(0, 10)
    const existingSnap = await db.prepare('SELECT id FROM instagram_analytics_daily WHERE snapshot_date = ?').bind(today).first<any>()
    if (!existingSnap) {
      await db.prepare(`
        INSERT INTO instagram_analytics_daily (snapshot_date, followers, follows, impressions, reach, profile_views, website_clicks, email_clicks, phone_clicks)
        VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0)
      `).bind(today, acct.followers_count || 0, acct.follows_count || 0).run()
      daily_snapshot = true
    }

    // Try to pull account-level insights for today
    try {
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      const insightsRes = await getAccountInsights(config, yesterday, today)
      if (insightsRes.data) {
        const iMap: Record<string, number> = {}
        for (const m of insightsRes.data) {
          const val = m.values?.[m.values.length - 1]?.value || 0
          iMap[m.name] = typeof val === 'object' ? 0 : val
        }
        await db.prepare(`
          UPDATE instagram_analytics_daily SET impressions=?, reach=?, profile_views=?, website_clicks=?, email_clicks=?, phone_clicks=? WHERE snapshot_date=?
        `).bind(
          iMap.impressions || 0, iMap.reach || 0, iMap.profile_views || 0,
          iMap.website_clicks || 0, iMap.email_contacts || 0, iMap.phone_call_clicks || 0, today
        ).run()
      }
    } catch {
      // Account insights may not be available for all accounts
    }

    return { ok: true, account_synced, posts_synced, daily_snapshot }
  } catch (err: any) {
    return { ok: false, account_synced, posts_synced, daily_snapshot, error: err.message }
  }
}

export async function pullPostsSince(env: Bindings, since: string): Promise<{ ok: boolean; synced: number; error?: string }> {
  const db = env.DB
  const config = await buildConfig(env)
  if (!config.igUserId) return { ok: false, synced: 0, error: 'Not configured' }

  let synced = 0
  let after: string | undefined

  try {
    const sinceDate = new Date(since).getTime()
    let keepGoing = true

    while (keepGoing) {
      const res = await getMediaList(config, 50, after)
      const posts = res.data || []
      if (posts.length === 0) break

      for (const post of posts) {
        const postDate = new Date(post.timestamp).getTime()
        if (postDate < sinceDate) { keepGoing = false; break }

        const existing = await db.prepare('SELECT id FROM instagram_posts WHERE ig_media_id = ?').bind(post.id).first<any>()
        if (!existing) {
          await db.prepare(`
            INSERT INTO instagram_posts (ig_media_id, media_type, caption, permalink, media_url, thumbnail_url, posted_at, like_count, comment_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(post.id, post.media_type || 'IMAGE', post.caption || '', post.permalink || '', post.media_url || '', post.thumbnail_url || '', post.timestamp, post.like_count || 0, post.comments_count || 0).run()
        }
        synced++
      }

      after = res.paging?.cursors?.after
      if (!after) break
    }

    return { ok: true, synced }
  } catch (err: any) {
    return { ok: false, synced, error: err.message }
  }
}

// ============================================================
// DM Automation — Keyword matching + auto-reply via Graph API
// Webhook handler helper for Instagram DM events.
// ============================================================

import type { Bindings } from '../../types'
import { sendDMReply, type GraphClientConfig } from './graph-client'
import { buildConfig } from './ig-pull'

export interface DmHandleResult {
  ok: boolean
  keyword_matched: boolean
  lead_created: boolean
  error?: string
}

export async function handleIncomingDM(
  env: Bindings,
  senderId: string,
  messageText: string,
  threadId: string
): Promise<DmHandleResult> {
  const db = env.DB
  const config = await buildConfig(env)

  if (!messageText || !senderId) {
    return { ok: false, keyword_matched: false, lead_created: false, error: 'Missing sender or message' }
  }

  try {
    // Extract first word as keyword candidate
    const firstWord = messageText.trim().split(/\s+/)[0].toUpperCase()

    // Match against active keywords
    const keyword = await db.prepare(
      "SELECT * FROM instagram_dm_keywords WHERE UPPER(keyword) = ? AND is_active = 1"
    ).bind(firstWord).first<any>()

    if (!keyword) {
      return { ok: true, keyword_matched: false, lead_created: false }
    }

    // Increment hit count
    await db.prepare('UPDATE instagram_dm_keywords SET hit_count = hit_count + 1 WHERE id = ?').bind(keyword.id).run()

    // Send auto-reply
    if (config.accessToken && config.igUserId) {
      const replyText = keyword.reply_template.replace('{link}', keyword.landing_url)
      await sendDMReply(config, senderId, replyText)
    }

    // Find associated post (resolve via landing URL UTM)
    let postId: number | null = null
    try {
      const urlObj = new URL(keyword.landing_url)
      const utmContent = urlObj.searchParams.get('utm_content')
      if (utmContent) {
        const post = await db.prepare('SELECT id FROM instagram_posts WHERE utm_content_slug = ?').bind(utmContent).first<any>()
        if (post) postId = post.id
      }
    } catch { /* not a valid URL or no UTM — ok */ }

    // Create lead
    await db.prepare(`
      INSERT INTO instagram_leads (source_channel, post_id, dm_thread_id, dm_keyword, contact_name, message_or_query)
      VALUES ('dm', ?, ?, ?, ?, ?)
    `).bind(postId, threadId, keyword.keyword, `DM User ${senderId}`, messageText.slice(0, 500)).run()

    return { ok: true, keyword_matched: true, lead_created: true }
  } catch (err: any) {
    return { ok: false, keyword_matched: false, lead_created: false, error: err.message }
  }
}

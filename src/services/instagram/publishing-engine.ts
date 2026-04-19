// ============================================================
// Publishing Engine — Publishes scheduled drafts via IG API
// Assigns UTM slug + tracking phone before publish.
// ============================================================

import type { Bindings } from '../../types'
import { createMediaContainer, publishMedia, getContainerStatus, type GraphClientConfig } from './graph-client'
import { buildConfig } from './ig-pull'
import { assignTrackingNumber } from './phone-tracking'

export interface PublishResult {
  ok: boolean
  published: number
  failed: number
  errors: string[]
}

function generateUtmSlug(ideaId: number): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  return `ig_${date}_${ideaId}`
}

// Get a signed URL for an R2 object (public URL via R2 custom domain or presigned)
async function getR2PublicUrl(env: Bindings, key: string): Promise<string | null> {
  const r2 = (env as any).INSTAGRAM_R2
  if (!r2 || !key) return null

  try {
    const obj = await r2.get(key)
    if (!obj) return null
    // For IG publishing, we need a publicly accessible URL
    // Use the R2 public bucket URL pattern
    return `https://pub-instagram.roofmanager.ca/${key}`
  } catch {
    return null
  }
}

export async function publishDueSchedule(env: Bindings): Promise<PublishResult> {
  const db = env.DB
  const config = await buildConfig(env)
  const errors: string[] = []
  let published = 0
  let failed = 0

  if (!config.igUserId || !config.accessToken) {
    return { ok: false, published: 0, failed: 0, errors: ['Instagram not configured'] }
  }

  try {
    // Find all due scheduled posts
    const { results: dueItems } = await db.prepare(`
      SELECT s.*, d.media_type, d.caption_primary, d.hashtags_json, d.composite_r2_key, d.idea_id, d.visuals_r2_keys_json
      FROM instagram_schedule s
      JOIN instagram_drafts d ON d.id = s.draft_id
      WHERE s.status = 'queued' AND s.scheduled_at <= datetime('now')
      ORDER BY s.scheduled_at ASC
      LIMIT 5
    `).all<any>()

    for (const item of (dueItems || [])) {
      try {
        // Mark as publishing
        await db.prepare("UPDATE instagram_schedule SET status='publishing' WHERE id=?").bind(item.id).run()

        // Get media URL
        const mediaKey = item.composite_r2_key || ''
        const mediaUrl = await getR2PublicUrl(env, mediaKey)
        if (!mediaUrl) {
          await db.prepare("UPDATE instagram_schedule SET status='failed', publish_error='No media URL available' WHERE id=?").bind(item.id).run()
          errors.push(`Schedule ${item.id}: No media URL`)
          failed++
          continue
        }

        // Build caption with hashtags
        let caption = item.caption_primary || ''
        try {
          const hashtags: string[] = JSON.parse(item.hashtags_json || '[]')
          if (hashtags.length > 0) caption += '\n\n' + hashtags.join(' ')
        } catch { /* skip */ }

        // Append UTM tracking link
        const utmSlug = item.utm_content_slug
        caption += `\n\n🔗 Link in bio | roofmanager.ca?utm_source=instagram&utm_medium=organic&utm_content=${utmSlug}`

        // Append tracking phone if assigned
        if (item.tracking_phone_number) {
          caption += `\n📞 ${item.tracking_phone_number}`
        }

        // Create media container
        const isVideo = item.media_type === 'REEL' || item.media_type === 'VIDEO'
        const containerRes = await createMediaContainer(config, {
          media_type: isVideo ? 'REELS' : 'IMAGE',
          video_url: isVideo ? mediaUrl : undefined,
          image_url: isVideo ? undefined : mediaUrl,
          caption,
        })

        if (containerRes.error) {
          await db.prepare("UPDATE instagram_schedule SET status='failed', publish_error=? WHERE id=?")
            .bind(containerRes.error.message || 'Container creation failed', item.id).run()
          errors.push(`Schedule ${item.id}: ${containerRes.error.message}`)
          failed++
          continue
        }

        const containerId = containerRes.id

        // For video, wait for processing
        if (isVideo) {
          let ready = false
          for (let i = 0; i < 30; i++) {
            await new Promise(r => setTimeout(r, 10000)) // 10s poll
            const status = await getContainerStatus(config, containerId)
            if (status.status_code === 'FINISHED') { ready = true; break }
            if (status.status_code === 'ERROR') {
              await db.prepare("UPDATE instagram_schedule SET status='failed', publish_error='Video processing failed' WHERE id=?").bind(item.id).run()
              errors.push(`Schedule ${item.id}: Video processing failed`)
              failed++
              break
            }
          }
          if (!ready) continue
        }

        // Publish
        const publishRes = await publishMedia(config, containerId)
        if (publishRes.id) {
          // Success — create post row + update schedule
          await db.prepare("UPDATE instagram_schedule SET status='published', published_media_id=? WHERE id=?")
            .bind(publishRes.id, item.id).run()

          await db.prepare(`
            INSERT INTO instagram_posts (ig_media_id, media_type, caption, posted_at, content_idea_id, utm_content_slug, tracking_phone_number)
            VALUES (?, ?, ?, datetime('now'), ?, ?, ?)
          `).bind(
            publishRes.id, item.media_type || 'IMAGE', caption,
            item.idea_id, utmSlug, item.tracking_phone_number || null
          ).run()

          // Update idea status
          await db.prepare("UPDATE instagram_content_ideas SET status='published', updated_at=datetime('now') WHERE id=?")
            .bind(item.idea_id).run()

          published++
        } else {
          await db.prepare("UPDATE instagram_schedule SET status='failed', publish_error=? WHERE id=?")
            .bind(publishRes.error?.message || 'Publish failed', item.id).run()
          errors.push(`Schedule ${item.id}: ${publishRes.error?.message || 'Unknown error'}`)
          failed++
        }
      } catch (err: any) {
        await db.prepare("UPDATE instagram_schedule SET status='failed', publish_error=? WHERE id=?")
          .bind(err.message, item.id).run()
        errors.push(`Schedule ${item.id}: ${err.message}`)
        failed++
      }
    }

    return { ok: true, published, failed, errors }
  } catch (err: any) {
    return { ok: false, published, failed, errors: [err.message] }
  }
}

export async function publishNow(env: Bindings, scheduleId: number): Promise<{ ok: boolean; error?: string }> {
  const db = env.DB
  // Force the scheduled_at to now so it gets picked up
  await db.prepare("UPDATE instagram_schedule SET scheduled_at=datetime('now'), status='queued' WHERE id=?").bind(scheduleId).run()
  const result = await publishDueSchedule(env)
  if (result.published > 0) return { ok: true }
  return { ok: false, error: result.errors[0] || 'Failed to publish' }
}

export async function schedulePost(env: Bindings, draftId: number, scheduledAt: string): Promise<{ ok: boolean; schedule_id?: number; error?: string }> {
  const db = env.DB

  const draft = await db.prepare("SELECT id, idea_id FROM instagram_drafts WHERE id = ? AND render_status = 'ready'").bind(draftId).first<any>()
  if (!draft) return { ok: false, error: 'Draft not found or not ready' }

  const utmSlug = generateUtmSlug(draft.idea_id)

  // Assign tracking phone
  let trackingPhone: string | null = null
  try {
    trackingPhone = await assignTrackingNumber(env, 0) // post_id not yet known
  } catch { /* ok if no pool */ }

  const res = await db.prepare(`
    INSERT INTO instagram_schedule (draft_id, scheduled_at, status, utm_content_slug, tracking_phone_number)
    VALUES (?, ?, 'queued', ?, ?)
  `).bind(draftId, scheduledAt, utmSlug, trackingPhone).run()

  // Update idea to scheduled
  await db.prepare("UPDATE instagram_content_ideas SET status='scheduled', updated_at=datetime('now') WHERE id=?").bind(draft.idea_id).run()

  return { ok: true, schedule_id: res.meta.last_row_id as number }
}

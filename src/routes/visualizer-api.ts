import { Hono } from 'hono'
import type { Bindings } from '../types'

export const visualizerApiRoutes = new Hono<{ Bindings: Bindings }>()

visualizerApiRoutes.get('/:orderId/photos', async (c) => {
  const orderId = c.req.param('orderId')
  try {
    const photos = await c.env.DB.prepare(
      'SELECT id, photo_url, angle, created_at FROM visualizer_photos WHERE order_id = ? ORDER BY created_at ASC'
    ).bind(orderId).all()
    return c.json({ success: true, photos: photos.results || [] })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

visualizerApiRoutes.post('/:orderId/photos', async (c) => {
  const orderId = c.req.param('orderId')
  try {
    const body = await c.req.json()
    const { photos } = body
    if (!photos || !Array.isArray(photos) || photos.length === 0) {
      return c.json({ error: 'At least 1 photo required' }, 400)
    }

    const uploaded = []
    for (const photo of photos) {
      const url = photo.data || photo.url
      const angle = photo.angle || 'unknown'
      if (!url) continue

      // For this implementation, we will store the base64 string directly
      // In a real production application with larger files, we should use R2 or S3
      const result = await c.env.DB.prepare(
        'INSERT INTO visualizer_photos (order_id, photo_url, angle) VALUES (?, ?, ?)'
      ).bind(orderId, url, angle).run()

      uploaded.push({ id: result.meta.last_row_id, angle })
    }

    return c.json({ success: true, uploaded })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

visualizerApiRoutes.delete('/:orderId/photos/:photoId', async (c) => {
  const orderId = c.req.param('orderId')
  const photoId = c.req.param('photoId')
  try {
    await c.env.DB.prepare(
      'DELETE FROM visualizer_photos WHERE id = ? AND order_id = ?'
    ).bind(photoId, orderId).run()
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

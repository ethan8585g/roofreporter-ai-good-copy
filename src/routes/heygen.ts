// ============================================================
// HeyGen AI Video Generation — Full Platform Integration
// API proxy routes for HeyGen v2 API
// Mirrors HeyGen platform: Studio, Video Agent, Translate,
// Photo Avatar, Brand Kit, Templates, Assets, Video Management
// ============================================================

import { Hono } from 'hono'
import { validateAdminSession, requireSuperadmin } from './auth'

type Env = {
  Bindings: {
    DB: D1Database
    HEYGEN_API_KEY: string
    ADMIN_BOOTSTRAP_EMAIL?: string
  }
}

const heygen = new Hono<Env>()

const HEYGEN_BASE = 'https://api.heygen.com'

// ── Middleware: require super-admin via admin_sessions ─────────────────────────
heygen.use('/*', async (c, next) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin || !requireSuperadmin(admin)) {
    return c.json({ error: 'Super admin required' }, 403)
  }
  await next()
})

// ── Helper: proxy to HeyGen API ─────────────────────────
async function heygenFetch(env: Env['Bindings'], path: string, options: RequestInit = {}): Promise<Response> {
  const apiKey = env.HEYGEN_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({
      error: 'HEYGEN_API_KEY not configured',
      help: 'Add your HeyGen API key:\n1. For local dev: Add HEYGEN_API_KEY=your_key to .dev.vars\n2. For production: wrangler pages secret put HEYGEN_API_KEY --project-name roofing-measurement-tool'
    }), { status: 503, headers: { 'Content-Type': 'application/json' } })
  }
  const headers: Record<string, string> = {
    'X-Api-Key': apiKey,
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {})
  }
  return fetch(`${HEYGEN_BASE}${path}`, { ...options, headers })
}

// Safe JSON response helper
async function heygenJson(env: Env['Bindings'], path: string, options: RequestInit = {}) {
  const resp = await heygenFetch(env, path, options)
  if (resp.status === 503) {
    return { _error: true, ...(await resp.json() as any) }
  }
  if (!resp.ok) {
    const text = await resp.text()
    try { return { _error: true, status: resp.status, ...(JSON.parse(text)) } }
    catch { return { _error: true, status: resp.status, error: text } }
  }
  return await resp.json() as any
}


// ============================================================
//  DASHBOARD — Stats, account info, API health check
// ============================================================

heygen.get('/dashboard', async (c) => {
  const db = c.env.DB
  const apiKey = c.env.HEYGEN_API_KEY

  // DB stats
  const [total, completed, processing, failed, recent, templates] = await Promise.all([
    db.prepare('SELECT COUNT(*) as cnt FROM heygen_videos').first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) as cnt FROM heygen_videos WHERE status = 'completed'").first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) as cnt FROM heygen_videos WHERE status IN ('pending','processing')").first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) as cnt FROM heygen_videos WHERE status = 'failed'").first<{ cnt: number }>(),
    db.prepare('SELECT id, video_id, title, category, status, avatar_name, duration_seconds, video_url, thumbnail_url, created_at, completed_at FROM heygen_videos ORDER BY created_at DESC LIMIT 10').all(),
    db.prepare('SELECT id, name, category, description, usage_count FROM heygen_templates WHERE is_active = 1 ORDER BY usage_count DESC').all(),
  ])

  // Check HeyGen API connectivity & quota
  let quota: any = null
  let apiStatus = 'disconnected'
  if (apiKey) {
    try {
      const qResp = await heygenJson(c.env, '/v2/user/remaining_quota')
      if (!qResp._error) {
        quota = qResp.data
        apiStatus = 'connected'
      } else {
        apiStatus = 'error'
      }
    } catch { apiStatus = 'error' }
  }

  return c.json({
    stats: {
      total: total?.cnt || 0,
      completed: completed?.cnt || 0,
      processing: processing?.cnt || 0,
      failed: failed?.cnt || 0,
    },
    recent_videos: recent?.results || [],
    templates: templates?.results || [],
    api_configured: !!apiKey,
    api_status: apiStatus,
    quota,
  })
})


// ============================================================
//  ACCOUNT / USER INFO
// ============================================================

heygen.get('/account', async (c) => {
  const quota = await heygenJson(c.env, '/v2/user/remaining_quota')
  if (quota._error) return c.json({ error: quota.error }, 502)
  return c.json({ quota: quota.data })
})

heygen.get('/remaining-quota', async (c) => {
  const data = await heygenJson(c.env, '/v2/user/remaining_quota')
  if (data._error) return c.json({ error: data.error || 'Failed to check quota' }, 502)
  return c.json(data.data || data)
})


// ============================================================
//  AVATARS — List, details, groups
// ============================================================

heygen.get('/avatars', async (c) => {
  const data = await heygenJson(c.env, '/v2/avatars')
  if (data._error) return c.json({ error: 'HeyGen API error', detail: data.error }, 502)
  const avatars = (data.data?.avatars || []).map((a: any) => ({
    avatar_id: a.avatar_id,
    avatar_name: a.avatar_name,
    gender: a.gender,
    preview_image_url: a.preview_image_url,
    preview_video_url: a.preview_video_url,
    avatar_type: a.avatar_type,
  }))
  return c.json({ avatars, count: avatars.length })
})

heygen.get('/avatar-groups', async (c) => {
  const data = await heygenJson(c.env, '/v2/avatar_group.list')
  if (data._error) return c.json({ error: data.error }, 502)
  return c.json(data.data || { avatar_group_list: [] })
})

heygen.get('/avatar/:id', async (c) => {
  const id = c.req.param('id')
  const data = await heygenJson(c.env, `/v2/avatars/${id}`)
  if (data._error) return c.json({ error: data.error }, 502)
  return c.json(data.data || data)
})


// ============================================================
//  VOICES — List, locales, brand glossary
// ============================================================

heygen.get('/voices', async (c) => {
  const data = await heygenJson(c.env, '/v2/voices')
  if (data._error) return c.json({ error: 'HeyGen API error', detail: data.error }, 502)
  const voices = (data.data?.voices || []).map((v: any) => ({
    voice_id: v.voice_id,
    name: v.name || v.display_name,
    language: v.language,
    gender: v.gender,
    preview_audio: v.preview_audio,
    support_pause: v.support_pause,
    is_cloned: v.is_cloned,
    emotion_support: v.emotion_support,
  }))
  return c.json({ voices, count: voices.length })
})

heygen.get('/voice-locales', async (c) => {
  const data = await heygenJson(c.env, '/v2/voices/locales')
  if (data._error) return c.json({ error: data.error }, 502)
  return c.json(data.data || data)
})

heygen.get('/brand-glossary', async (c) => {
  const data = await heygenJson(c.env, '/v2/brand_voice')
  if (data._error) return c.json({ error: data.error }, 502)
  return c.json(data.data || data)
})

heygen.post('/brand-glossary', async (c) => {
  const body = await c.req.json()
  const data = await heygenJson(c.env, '/v2/brand_voice', { method: 'POST', body: JSON.stringify(body) })
  if (data._error) return c.json({ error: data.error }, 502)
  return c.json(data.data || data)
})


// ============================================================
//  STUDIO — Generate Avatar Video (v2)
// ============================================================

heygen.post('/generate', async (c) => {
  const body = await c.req.json<{
    title: string; category?: string
    avatar_id: string; avatar_name?: string; avatar_style?: string
    voice_id: string; voice_name?: string
    script: string; speed?: number
    dimension?: string; aspect_ratio?: string
    background_color?: string; background_image_url?: string
    background_type?: string
    order_id?: number; report_id?: number; template_id?: number
    test_mode?: boolean
  }>()

  if (!body.title || !body.avatar_id || !body.voice_id || !body.script) {
    return c.json({ error: 'title, avatar_id, voice_id, and script are required' }, 400)
  }

  const dimension = body.dimension || '1920x1080'
  const [w, h] = dimension.split('x').map(Number)

  // Build background config
  let background: any = { type: 'color', value: body.background_color || '#ffffff' }
  if (body.background_type === 'image' && body.background_image_url) {
    background = { type: 'image', url: body.background_image_url }
  } else if (body.background_type === 'video' && body.background_image_url) {
    background = { type: 'video', url: body.background_image_url }
  }

  const heygenPayload: any = {
    video_inputs: [{
      character: {
        type: 'avatar',
        avatar_id: body.avatar_id,
        avatar_style: body.avatar_style || 'normal',
      },
      voice: {
        type: 'text',
        input_text: body.script,
        voice_id: body.voice_id,
        speed: body.speed || 1.0,
      },
      background,
    }],
    dimension: { width: w || 1920, height: h || 1080 },
    test: body.test_mode || false,
  }

  const result = await heygenJson(c.env, '/v2/video/generate', {
    method: 'POST',
    body: JSON.stringify(heygenPayload),
  })

  if (result._error || result.error) {
    await c.env.DB.prepare(`INSERT INTO heygen_videos (title, category, status, avatar_id, avatar_name, voice_id, voice_name, script, dimension, aspect_ratio, error_message, order_id, report_id, heygen_response_raw) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(body.title, body.category || 'marketing', 'failed', body.avatar_id, body.avatar_name || '', body.voice_id, body.voice_name || '', body.script, dimension, body.aspect_ratio || '16:9', result.error?.message || JSON.stringify(result), body.order_id || null, body.report_id || null, JSON.stringify(result))
      .run()
    return c.json({ error: 'Video generation failed', detail: result }, 502)
  }

  const videoId = result.data?.video_id
  if (!videoId) return c.json({ error: 'No video_id in response', detail: result }, 502)

  await c.env.DB.prepare(`INSERT INTO heygen_videos (video_id, title, category, status, avatar_id, avatar_name, voice_id, voice_name, script, dimension, aspect_ratio, order_id, report_id, heygen_response_raw) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(videoId, body.title, body.category || 'marketing', 'processing', body.avatar_id, body.avatar_name || '', body.voice_id, body.voice_name || '', body.script, dimension, body.aspect_ratio || '16:9', body.order_id || null, body.report_id || null, JSON.stringify(result))
    .run()

  if (body.template_id) {
    await c.env.DB.prepare('UPDATE heygen_templates SET usage_count = usage_count + 1, updated_at = datetime(\'now\') WHERE id = ?').bind(body.template_id).run()
  }

  return c.json({ success: true, video_id: videoId, status: 'processing', message: 'Video generation started. Poll /status/:video_id for updates.' })
})


// ============================================================
//  VIDEO AGENT — Prompt-to-Video (one-shot)
// ============================================================

heygen.post('/generate-agent', async (c) => {
  const body = await c.req.json<{
    title: string; category?: string
    prompt: string; aspect_ratio?: string
    order_id?: number; report_id?: number
  }>()

  if (!body.title || !body.prompt) return c.json({ error: 'title and prompt are required' }, 400)

  const result = await heygenJson(c.env, '/v1/video_agent/generate', {
    method: 'POST',
    body: JSON.stringify({ prompt: body.prompt, aspect_ratio: body.aspect_ratio || '16:9' }),
  })

  if (result._error || result.error) {
    await c.env.DB.prepare(`INSERT INTO heygen_videos (title, category, status, prompt, aspect_ratio, error_message, order_id, report_id, heygen_response_raw) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(body.title, body.category || 'marketing', 'failed', body.prompt, body.aspect_ratio || '16:9', result.error?.message || JSON.stringify(result), body.order_id || null, body.report_id || null, JSON.stringify(result))
      .run()
    return c.json({ error: 'Video Agent generation failed', detail: result }, 502)
  }

  const videoId = result.data?.video_id
  if (!videoId) return c.json({ error: 'No video_id in response', detail: result }, 502)

  await c.env.DB.prepare(`INSERT INTO heygen_videos (video_id, title, category, status, prompt, aspect_ratio, order_id, report_id, heygen_response_raw) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(videoId, body.title, body.category || 'marketing', 'processing', body.prompt, body.aspect_ratio || '16:9', body.order_id || null, body.report_id || null, JSON.stringify(result))
    .run()

  return c.json({ success: true, video_id: videoId, status: 'processing' })
})


// ============================================================
//  VIDEO TRANSLATE
// ============================================================

heygen.get('/translate/languages', async (c) => {
  const data = await heygenJson(c.env, '/v2/video_translate/target_languages')
  if (data._error) return c.json({ error: data.error }, 502)
  return c.json(data.data || data)
})

heygen.post('/translate', async (c) => {
  const body = await c.req.json<{
    video_url: string
    output_language: string
    title?: string
    translate_audio_only?: boolean
    speaker_num?: number
  }>()

  if (!body.video_url || !body.output_language) {
    return c.json({ error: 'video_url and output_language are required' }, 400)
  }

  const result = await heygenJson(c.env, '/v2/video_translate', {
    method: 'POST',
    body: JSON.stringify({
      video_url: body.video_url,
      output_language: body.output_language,
      translate_audio_only: body.translate_audio_only || false,
      speaker_num: body.speaker_num || 1,
      title: body.title || 'Translated Video',
    }),
  })

  if (result._error) return c.json({ error: result.error }, 502)
  return c.json({ success: true, ...result.data })
})

heygen.get('/translate/status/:id', async (c) => {
  const id = c.req.param('id')
  const data = await heygenJson(c.env, `/v2/video_translate/${id}`)
  if (data._error) return c.json({ error: data.error }, 502)
  return c.json(data.data || data)
})


// ============================================================
//  PHOTO AVATAR
// ============================================================

heygen.post('/photo-avatar', async (c) => {
  const body = await c.req.json<{ image_url: string; name?: string }>()
  if (!body.image_url) return c.json({ error: 'image_url is required' }, 400)
  const result = await heygenJson(c.env, '/v2/photo_avatar', {
    method: 'POST',
    body: JSON.stringify({ image_url: body.image_url, name: body.name || 'Custom Avatar' }),
  })
  if (result._error) return c.json({ error: result.error }, 502)
  return c.json({ success: true, ...result.data })
})

heygen.get('/photo-avatar/status/:id', async (c) => {
  const id = c.req.param('id')
  const data = await heygenJson(c.env, `/v2/photo_avatar/${id}/status`)
  if (data._error) return c.json({ error: data.error }, 502)
  return c.json(data.data || data)
})


// ============================================================
//  ASSETS (Upload images, audio for backgrounds, etc.)
// ============================================================

heygen.get('/assets', async (c) => {
  const data = await heygenJson(c.env, '/v1/asset')
  if (data._error) return c.json({ error: data.error }, 502)
  return c.json(data.data || data)
})


// ============================================================
//  VIDEO STATUS & MANAGEMENT
// ============================================================

heygen.get('/status/:video_id', async (c) => {
  const videoId = c.req.param('video_id')
  const result = await heygenJson(c.env, `/v1/video_status.get?video_id=${videoId}`)

  if (result._error) return c.json({ error: 'Failed to check status', detail: result }, 502)

  const status = result.data?.status
  const videoUrl = result.data?.video_url
  const thumbUrl = result.data?.thumbnail_url
  const captionUrl = result.data?.caption_url
  const duration = result.data?.duration

  // Sync status to DB
  if (status === 'completed' && videoUrl) {
    await c.env.DB.prepare(`UPDATE heygen_videos SET status = 'completed', video_url = ?, thumbnail_url = ?, caption_url = ?, duration_seconds = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE video_id = ?`)
      .bind(videoUrl, thumbUrl || '', captionUrl || '', duration || 0, videoId).run()
  } else if (status === 'failed') {
    await c.env.DB.prepare(`UPDATE heygen_videos SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE video_id = ?`)
      .bind(result.data?.error || 'Unknown error', videoId).run()
  } else if (status === 'processing' || status === 'pending') {
    await c.env.DB.prepare(`UPDATE heygen_videos SET status = ?, updated_at = datetime('now') WHERE video_id = ?`)
      .bind(status, videoId).run()
  }

  return c.json({
    video_id: videoId, status,
    video_url: videoUrl, thumbnail_url: thumbUrl,
    caption_url: captionUrl, duration,
    raw: result.data,
  })
})

// GET /videos — list all videos from DB
heygen.get('/videos', async (c) => {
  const category = c.req.query('category')
  const status = c.req.query('status')
  const limit = parseInt(c.req.query('limit') || '50')
  const offset = parseInt(c.req.query('offset') || '0')

  let sql = 'SELECT * FROM heygen_videos WHERE 1=1'
  const params: any[] = []
  if (category) { sql += ' AND category = ?'; params.push(category) }
  if (status) { sql += ' AND status = ?'; params.push(status) }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)

  const videos = await c.env.DB.prepare(sql).bind(...params).all()
  const total = await c.env.DB.prepare('SELECT COUNT(*) as cnt FROM heygen_videos').first<{ cnt: number }>()
  return c.json({ videos: videos?.results || [], total: total?.cnt || 0 })
})

// GET /videos/heygen — list videos directly from HeyGen account
heygen.get('/videos/heygen', async (c) => {
  const limit = c.req.query('limit') || '20'
  const token = c.req.query('token') || ''
  let url = `/v1/video.list?limit=${limit}`
  if (token) url += `&token=${token}`
  const data = await heygenJson(c.env, url)
  if (data._error) return c.json({ error: data.error }, 502)
  return c.json(data.data || data)
})

// DELETE /videos/:id — delete a video record from DB
heygen.delete('/videos/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM heygen_videos WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// DELETE /videos/heygen/:video_id — delete from HeyGen account
heygen.delete('/videos/heygen/:video_id', async (c) => {
  const videoId = c.req.param('video_id')
  const result = await heygenJson(c.env, `/v1/video.delete`, {
    method: 'DELETE',
    body: JSON.stringify({ video_id: videoId }),
  })
  if (result._error) return c.json({ error: result.error }, 502)
  // Also remove from local DB
  await c.env.DB.prepare('DELETE FROM heygen_videos WHERE video_id = ?').bind(videoId).run()
  return c.json({ success: true })
})


// ============================================================
//  TEMPLATES (local DB + HeyGen templates)
// ============================================================

heygen.get('/templates', async (c) => {
  const templates = await c.env.DB.prepare('SELECT * FROM heygen_templates WHERE is_active = 1 ORDER BY usage_count DESC').all()
  return c.json({ templates: templates?.results || [] })
})

// List HeyGen account templates
heygen.get('/templates/heygen', async (c) => {
  const data = await heygenJson(c.env, '/v2/templates')
  if (data._error) return c.json({ error: data.error }, 502)
  return c.json(data.data || data)
})

heygen.post('/templates', async (c) => {
  const body = await c.req.json<{
    name: string; category: string; description?: string
    avatar_id?: string; voice_id?: string; script_template?: string
    prompt_template?: string; dimension?: string; aspect_ratio?: string
    background_color?: string; background_image_url?: string
  }>()
  if (!body.name) return c.json({ error: 'name is required' }, 400)

  await c.env.DB.prepare(`INSERT INTO heygen_templates (name, category, description, avatar_id, voice_id, script_template, prompt_template, dimension, aspect_ratio, background_color, background_image_url) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(body.name, body.category || 'marketing', body.description || '', body.avatar_id || '', body.voice_id || '', body.script_template || '', body.prompt_template || '', body.dimension || '1920x1080', body.aspect_ratio || '16:9', body.background_color || '', body.background_image_url || '')
    .run()
  return c.json({ success: true })
})

heygen.delete('/templates/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE heygen_templates SET is_active = 0 WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})


// ============================================================
//  REPORT VIDEO — Personalized report walkthrough
// ============================================================

heygen.post('/report-video/:orderId', async (c) => {
  const orderId = parseInt(c.req.param('orderId'))
  const body = await c.req.json<{
    avatar_id: string; avatar_name?: string
    voice_id: string; voice_name?: string
    custom_script?: string
  }>()

  const report = await c.env.DB.prepare(`SELECT r.*, o.address, o.city, o.province, o.postal_code FROM reports r JOIN orders o ON r.order_id = o.id WHERE r.order_id = ?`).bind(orderId).first<any>()
  if (!report) return c.json({ error: 'Report not found' }, 404)

  let reportData: any = {}
  try { reportData = JSON.parse(report.api_response_raw || '{}') } catch {}

  const address = [report.address, report.city, report.province].filter(Boolean).join(', ')
  const totalSquares = (report.roof_area_sqft / 100).toFixed(1)
  const pitch = reportData.roof_pitch_ratio || '5:12'
  const segments = reportData.segments?.length || 4
  const eave = report.total_eave_ft || 0
  const ridge = report.total_ridge_ft || 0

  const script = body.custom_script || `Hi there! I have your Roof Manager measurement report ready for the property at ${address}. Your roof has a total measured area of ${totalSquares} squares with a predominant pitch of ${pitch}. We identified ${segments} roof planes in total. Key edge measurements include ${Math.round(eave)} linear feet of eave and ${Math.round(ridge)} linear feet of ridge. The report includes a full diagram, waste factor analysis, and material estimation. All measurements are generated using our AI-powered satellite imagery analysis engine. If you have any questions about your report, our team is here to help. Thank you for using Roof Manager!`

  const heygenPayload = {
    video_inputs: [{
      character: { type: 'avatar', avatar_id: body.avatar_id, avatar_style: 'normal' },
      voice: { type: 'text', input_text: script, voice_id: body.voice_id, speed: 1.0 },
      background: { type: 'color', value: '#1a2332' },
    }],
    dimension: { width: 1920, height: 1080 },
    test: false,
  }

  const result = await heygenJson(c.env, '/v2/video/generate', {
    method: 'POST',
    body: JSON.stringify(heygenPayload),
  })

  const videoId = result.data?.video_id
  if (!videoId) return c.json({ error: 'Video generation failed', detail: result }, 502)

  await c.env.DB.prepare(`INSERT INTO heygen_videos (video_id, title, category, status, avatar_id, avatar_name, voice_id, voice_name, script, dimension, aspect_ratio, order_id, report_id, heygen_response_raw) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(videoId, `Report Walkthrough — ${address}`, 'report_walkthrough', 'processing', body.avatar_id, body.avatar_name || '', body.voice_id, body.voice_name || '', script, '1920x1080', '16:9', orderId, report.id, JSON.stringify(result))
    .run()

  return c.json({ success: true, video_id: videoId, status: 'processing', script_used: script })
})


// ============================================================
//  TEXT TO SPEECH (preview)
// ============================================================

heygen.post('/tts-preview', async (c) => {
  const body = await c.req.json<{ text: string; voice_id: string; speed?: number }>()
  if (!body.text || !body.voice_id) return c.json({ error: 'text and voice_id are required' }, 400)
  const result = await heygenJson(c.env, '/v1/voice/tts', {
    method: 'POST',
    body: JSON.stringify({ text: body.text, voice_id: body.voice_id, speed: body.speed || 1.0 }),
  })
  if (result._error) return c.json({ error: result.error }, 502)
  return c.json(result.data || result)
})


export { heygen as heygenRoutes }

import { Hono } from 'hono'
import type { Bindings } from '../types'
import { runOnce, seedDefaultKeywords, pickStalePostIds, refreshStalePost, getAgentHealth } from '../services/blog-agent'
import { pingGoogleIndexing, pingGoogleIndexingBatch } from '../services/indexing-api'
import { pingIndexNow } from '../services/indexnow'
import { sanitizeHtml } from '../utils/sanitize-html'

export const blogRoutes = new Hono<{ Bindings: Bindings }>()

// ============================================================
// PUBLIC: Get published blog posts (paginated)
// ============================================================
blogRoutes.get('/posts', async (c) => {
  try {
    const page = parseInt(c.req.query('page') || '1')
    const limit = Math.min(parseInt(c.req.query('limit') || '12'), 50)
    const offset = (page - 1) * limit
    const category = c.req.query('category') || ''
    const search = c.req.query('search') || ''
    const featured = c.req.query('featured') || ''

    let query = `SELECT id, slug, title, excerpt, cover_image_url, category, tags, author_name, author_avatar_url, is_featured, read_time_minutes, view_count, published_at, created_at FROM blog_posts WHERE status = 'published'`
    const params: any[] = []

    if (category) {
      query += ` AND category = ?`
      params.push(category)
    }
    if (search) {
      query += ` AND (title LIKE ? OR excerpt LIKE ? OR tags LIKE ?)`
      const s = `%${search}%`
      params.push(s, s, s)
    }
    if (featured === '1') {
      query += ` AND is_featured = 1`
    }

    // Count total
    const countQuery = query.replace(/SELECT .+ FROM/, 'SELECT COUNT(*) as total FROM')
    const countResult = await c.env.DB.prepare(countQuery).bind(...params).first<{ total: number }>()
    const total = countResult?.total || 0

    query += ` ORDER BY is_featured DESC, published_at DESC LIMIT ? OFFSET ?`
    params.push(limit, offset)

    const posts = await c.env.DB.prepare(query).bind(...params).all()

    return c.json({
      posts: posts.results || [],
      pagination: {
        page, limit, total,
        total_pages: Math.ceil(total / limit),
        has_more: offset + limit < total
      }
    })
  } catch (e: any) {
    // If table doesn't exist yet, return empty
    if (e.message?.includes('no such table')) {
      return c.json({ posts: [], pagination: { page: 1, limit: 12, total: 0, total_pages: 0, has_more: false } })
    }
    return c.json({ error: e.message }, 500)
  }
})

// ============================================================
// PUBLIC: Get all categories with post counts
// ============================================================
blogRoutes.get('/categories', async (c) => {
  try {
    const result = await c.env.DB.prepare(
      `SELECT category, COUNT(*) as count FROM blog_posts WHERE status = 'published' GROUP BY category ORDER BY count DESC`
    ).all()
    return c.json({ categories: result.results || [] })
  } catch (e: any) {
    if (e.message?.includes('no such table')) {
      return c.json({ categories: [] })
    }
    return c.json({ error: e.message }, 500)
  }
})

// ============================================================
// PUBLIC: Get single blog post by slug
// ============================================================
blogRoutes.get('/posts/:slug', async (c) => {
  try {
    const slug = c.req.param('slug')
    const post = await c.env.DB.prepare(
      `SELECT * FROM blog_posts WHERE slug = ? AND status = 'published'`
    ).bind(slug).first()

    if (!post) {
      return c.json({ error: 'Post not found' }, 404)
    }

    // Increment view count (non-blocking)
    c.executionCtx.waitUntil(
      c.env.DB.prepare(`UPDATE blog_posts SET view_count = view_count + 1 WHERE id = ?`).bind(post.id).run()
    )

    // Get related posts (same category, excluding current)
    const related = await c.env.DB.prepare(
      `SELECT id, slug, title, excerpt, cover_image_url, category, read_time_minutes, published_at 
       FROM blog_posts 
       WHERE status = 'published' AND id != ? AND category = ? 
       ORDER BY published_at DESC LIMIT 3`
    ).bind(post.id, post.category).all()

    return c.json({ post, related: related.results || [] })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ============================================================
// ADMIN: Helper to validate admin session
// ============================================================
async function validateAdminSession(db: D1Database, authHeader: string | undefined) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  const token = authHeader.replace('Bearer ', '')
  const session = await db.prepare(
    `SELECT s.*, u.email, u.role FROM admin_sessions s JOIN admin_users u ON s.admin_id = u.id WHERE s.session_token = ? AND s.expires_at > datetime('now')`
  ).bind(token).first()
  return session
}

// ============================================================
// ADMIN: List all blog posts (including drafts)
// ============================================================
blogRoutes.get('/admin/posts', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const posts = await c.env.DB.prepare(
      `SELECT * FROM blog_posts ORDER BY created_at DESC`
    ).all()
    return c.json({ posts: posts.results || [] })
  } catch (e: any) {
    if (e.message?.includes('no such table')) {
      return c.json({ posts: [] })
    }
    return c.json({ error: e.message }, 500)
  }
})

// ============================================================
// ADMIN: Create a new blog post
// ============================================================
blogRoutes.post('/admin/posts', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const body = await c.req.json()
    const { title, slug, excerpt, content, cover_image_url, category, tags, author_name, status, is_featured, meta_title, meta_description, read_time_minutes } = body

    if (!title || !content) {
      return c.json({ error: 'Title and content are required' }, 400)
    }

    // Auto-generate slug if not provided
    const finalSlug = slug || title.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 100)

    // Auto-estimate read time (~200 words per minute)
    const wordCount = (content || '').split(/\s+/).length
    const estimatedReadTime = read_time_minutes || Math.max(1, Math.ceil(wordCount / 200))

    const publishedAt = status === 'published' ? new Date().toISOString() : null

    // P1-32: sanitize admin-authored HTML on write (defense-in-depth against
    // a compromised admin injecting <script> into the public blog).
    const safeContent = sanitizeHtml(String(content || ''))
    const safeExcerpt = sanitizeHtml(String(excerpt || ''))

    const result = await c.env.DB.prepare(
      `INSERT INTO blog_posts (slug, title, excerpt, content, cover_image_url, category, tags, author_name, status, is_featured, meta_title, meta_description, read_time_minutes, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      finalSlug,
      title,
      safeExcerpt,
      safeContent,
      cover_image_url || '',
      category || 'roofing',
      tags || '',
      author_name || 'Roof Manager Team',
      status || 'draft',
      is_featured ? 1 : 0,
      meta_title || title,
      meta_description || excerpt || '',
      estimatedReadTime,
      publishedAt
    ).run()

    return c.json({ success: true, id: result.meta.last_row_id, slug: finalSlug })
  } catch (e: any) {
    if (e.message?.includes('UNIQUE constraint')) {
      return c.json({ error: 'A post with this slug already exists' }, 409)
    }
    return c.json({ error: e.message }, 500)
  }
})

// ============================================================
// ADMIN: Update a blog post
// ============================================================
blogRoutes.put('/admin/posts/:id', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const { title, slug, excerpt, content, cover_image_url, category, tags, author_name, status, is_featured, meta_title, meta_description, read_time_minutes } = body

    // Check if transitioning to published
    const existing = await c.env.DB.prepare(`SELECT status, published_at FROM blog_posts WHERE id = ?`).bind(id).first()
    if (!existing) return c.json({ error: 'Post not found' }, 404)

    const publishedAt = (status === 'published' && existing.status !== 'published')
      ? new Date().toISOString()
      : existing.published_at

    // Auto-estimate read time
    const wordCount = (content || '').split(/\s+/).length
    const estimatedReadTime = read_time_minutes || Math.max(1, Math.ceil(wordCount / 200))

    // P1-32: sanitize admin-authored HTML on write (same guard as create path).
    const safeContent = sanitizeHtml(String(content || ''))
    const safeExcerpt = sanitizeHtml(String(excerpt || ''))

    await c.env.DB.prepare(
      `UPDATE blog_posts SET title=?, slug=?, excerpt=?, content=?, cover_image_url=?, category=?, tags=?, author_name=?, status=?, is_featured=?, meta_title=?, meta_description=?, read_time_minutes=?, published_at=?, updated_at=datetime('now') WHERE id=?`
    ).bind(
      title, slug, safeExcerpt, safeContent, cover_image_url || '',
      category || 'roofing', tags || '', author_name || 'Roof Manager Team',
      status || 'draft', is_featured ? 1 : 0,
      meta_title || title, meta_description || excerpt || '',
      estimatedReadTime, publishedAt, id
    ).run()

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ============================================================
// ADMIN: Delete a blog post
// ============================================================
blogRoutes.delete('/admin/posts/:id', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const id = c.req.param('id')
    await c.env.DB.prepare(`DELETE FROM blog_posts WHERE id = ?`).bind(id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ============================================================
// ADMIN: Init blog table (fallback if migration not run)
// ============================================================
blogRoutes.post('/admin/init', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)

  try {
    await c.env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS blog_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        excerpt TEXT,
        content TEXT NOT NULL,
        cover_image_url TEXT,
        category TEXT DEFAULT 'roofing',
        tags TEXT,
        author_name TEXT DEFAULT 'Roof Manager Team',
        author_avatar_url TEXT,
        status TEXT DEFAULT 'draft',
        is_featured INTEGER DEFAULT 0,
        meta_title TEXT,
        meta_description TEXT,
        read_time_minutes INTEGER DEFAULT 5,
        view_count INTEGER DEFAULT 0,
        published_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `).run()
    return c.json({ success: true, message: 'Blog table created/verified' })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ============================================================
// BLOG AGENT: Autonomous SEO/GEO content generation
// ============================================================

// Admin: seed default keyword queue
blogRoutes.post('/admin/agent/seed', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const inserted = await seedDefaultKeywords(c.env.DB)
    return c.json({ success: true, inserted })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Admin: add custom keyword
blogRoutes.post('/admin/agent/keywords', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const { keyword, geo_modifier, intent, priority, target_category } = await c.req.json()
    if (!keyword) return c.json({ error: 'keyword required' }, 400)
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO blog_keyword_queue (keyword, geo_modifier, intent, priority, target_category) VALUES (?, ?, ?, ?, ?)`
    ).bind(keyword, geo_modifier || null, intent || 'informational', priority || 5, target_category || 'roofing').run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Admin: queue + log status
blogRoutes.get('/admin/agent/status', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const queue = await c.env.DB.prepare(
      `SELECT status, COUNT(*) as n FROM blog_keyword_queue GROUP BY status`
    ).all()
    const recent = await c.env.DB.prepare(
      `SELECT id, keyword, geo_modifier, status, attempts, post_id, last_error, updated_at
       FROM blog_keyword_queue ORDER BY updated_at DESC LIMIT 20`
    ).all()
    const logs = await c.env.DB.prepare(
      `SELECT id, queue_id, post_id, stage, quality_score, passed_gate, duration_ms, error, created_at
       FROM blog_generation_log ORDER BY id DESC LIMIT 20`
    ).all()
    return c.json({ queue: queue.results, recent: recent.results, logs: logs.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Admin: manually trigger one run
blogRoutes.post('/admin/agent/run', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)
  const result = await runOnce(c.env)
  return c.json(result, result.ok ? 200 : 200)
})

// Admin: agent health snapshot — queue stats, recent quality scores,
// publish cadence, stale-post count. Use to eyeball whether the
// autonomous pipeline is healthy.
blogRoutes.get('/admin/agent/health', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)
  try {
    return c.json(await getAgentHealth(c.env.DB))
  } catch (e: any) {
    return c.json({ error: e.message || String(e) }, 500)
  }
})

// Admin: list stale published posts (default >90 days old, max 50).
blogRoutes.get('/admin/agent/stale', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)
  const days = Math.max(1, parseInt(c.req.query('days') || '90'))
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '10')))
  try {
    const rows = await pickStalePostIds(c.env.DB, days, limit)
    return c.json({ days, limit, count: rows.length, posts: rows })
  } catch (e: any) {
    return c.json({ error: e.message || String(e) }, 500)
  }
})

// Admin: refresh one stale post (appends freshness footer + re-pings
// Google/IndexNow). Body: { id: <post_id> }. If omitted, auto-picks the
// single oldest post past the threshold.
blogRoutes.post('/admin/agent/refresh', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const body = await c.req.json().catch(() => ({})) as { id?: number; days?: number }
    let postId = body.id
    if (!postId) {
      const rows = await pickStalePostIds(c.env.DB, body.days || 90, 1)
      if (!rows.length) return c.json({ ok: false, skipped: true, reason: 'no stale posts' })
      postId = rows[0].id
    }
    const result = await refreshStalePost(c.env, postId)
    return c.json(result)
  } catch (e: any) {
    return c.json({ error: e.message || String(e) }, 500)
  }
})

// Admin: bulk refresh — runs `refreshStalePost` across the oldest N stale
// posts. Use sparingly; 10 posts at a time is a reasonable ceiling to
// avoid blowing the Pages subrequest budget.
blogRoutes.post('/admin/agent/refresh-batch', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const body = await c.req.json().catch(() => ({})) as { days?: number; limit?: number }
    const days = body.days || 90
    const limit = Math.min(10, body.limit || 5)
    const stale = await pickStalePostIds(c.env.DB, days, limit)
    const results: Array<{ id: number; slug?: string; ok: boolean; error?: string }> = []
    for (const p of stale) {
      const r = await refreshStalePost(c.env, p.id)
      results.push({ id: p.id, slug: r.slug, ok: r.ok, error: r.error })
    }
    const ok = results.filter(r => r.ok).length
    return c.json({ total: results.length, ok, failed: results.length - ok, results })
  } catch (e: any) {
    return c.json({ error: e.message || String(e) }, 500)
  }
})

// Admin: manually ping Google Indexing API for a single URL or a list of URLs
// POST body: { url: "https://..." } OR { urls: ["https://...", ...] }
// Useful for (1) re-indexing after a mass content edit, (2) testing the
// service-account + Search Console ownership setup.
blogRoutes.post('/admin/indexing/ping', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const body = await c.req.json().catch(() => ({})) as { url?: string; urls?: string[]; type?: 'URL_UPDATED' | 'URL_DELETED' }
    const type = body.type || 'URL_UPDATED'
    if (body.urls && Array.isArray(body.urls)) {
      const results = await pingGoogleIndexingBatch(c.env as any, body.urls, type)
      return c.json({ count: results.length, results })
    }
    if (!body.url) return c.json({ error: 'url or urls required' }, 400)
    const result = await pingGoogleIndexing(c.env as any, body.url, type)
    return c.json(result)
  } catch (e: any) {
    return c.json({ error: e.message || String(e) }, 500)
  }
})

// Admin: ping every published blog post (useful for initial bulk submission)
blogRoutes.post('/admin/indexing/ping-all', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const posts = await c.env.DB.prepare(
      `SELECT slug FROM blog_posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 200`
    ).all()
    const urls = (posts.results || []).map((p: any) => `https://www.roofmanager.ca/blog/${p.slug}`)
    const results = await pingGoogleIndexingBatch(c.env as any, urls, 'URL_UPDATED')
    const ok = results.filter(r => r.ok).length
    const skipped = results.filter(r => r.skipped).length
    return c.json({ total: results.length, ok, skipped, failed: results.length - ok - skipped, results })
  } catch (e: any) {
    return c.json({ error: e.message || String(e) }, 500)
  }
})

// Admin: IndexNow — zero-auth ping to Bing/Yandex/Naver/Seznam.
// POST body: { urls: [...] }. If omitted, submits every published blog post.
blogRoutes.post('/admin/indexnow/ping', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const body = await c.req.json().catch(() => ({})) as { urls?: string[] }
    let urls = body.urls
    if (!urls || !urls.length) {
      const posts = await c.env.DB.prepare(
        `SELECT slug FROM blog_posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 500`
      ).all()
      urls = (posts.results || []).map((p: any) => `https://www.roofmanager.ca/blog/${p.slug}`)
    }
    const result = await pingIndexNow(urls)
    return c.json(result)
  } catch (e: any) {
    return c.json({ error: e.message || String(e) }, 500)
  }
})

// Cron: external scheduler hits this. Protect with BLOG_AGENT_CRON_SECRET.
blogRoutes.post('/cron/run', async (c) => {
  const secret = c.req.header('X-Cron-Secret') || c.req.query('secret')
  const expected = (c.env as any).BLOG_AGENT_CRON_SECRET
  if (!expected || secret !== expected) return c.json({ error: 'Unauthorized' }, 401)
  // Allow ?n=2 to run multiple posts per invocation
  const n = Math.min(parseInt(c.req.query('n') || '1'), 3)
  const results = []
  for (let i = 0; i < n; i++) {
    const r = await runOnce(c.env)
    results.push(r)
    if (r.skipped) break
  }
  return c.json({ results })
})

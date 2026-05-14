import { Hono } from 'hono'
import type { Bindings, AppEnv } from '../types'
import { validateAdminSession } from './auth'

export const backlinksRoutes = new Hono<AppEnv>()

// ============================================================
// ADMIN: List backlinks
// ============================================================
backlinksRoutes.get('/', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const status = c.req.query('status') || ''
    const domain = c.req.query('domain') || ''
    let q = `SELECT * FROM backlinks WHERE 1=1`
    const params: any[] = []
    if (status) { q += ` AND outreach_status = ?`; params.push(status) }
    if (domain) { q += ` AND target_domain LIKE ?`; params.push(`%${domain}%`) }
    q += ` ORDER BY COALESCE(placement_date, created_at) DESC LIMIT 500`
    const result = await c.env.DB.prepare(q).bind(...params).all()
    return c.json({ backlinks: result.results || [] })
  } catch (e: any) {
    if (e.message?.includes('no such table')) return c.json({ backlinks: [] })
    return c.json({ error: e.message }, 500)
  }
})

// ============================================================
// ADMIN: Summary stats — counts by status, do-follow ratio, rot count
// ============================================================
backlinksRoutes.get('/stats', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const byStatus = await c.env.DB.prepare(
      `SELECT outreach_status, COUNT(*) as count FROM backlinks GROUP BY outreach_status`
    ).all()
    const totals = await c.env.DB.prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN dofollow=1 THEN 1 ELSE 0 END) as dofollow_count,
        SUM(CASE WHEN outreach_status='live' OR outreach_status='verified' THEN 1 ELSE 0 END) as live_count,
        SUM(CASE WHEN last_check_status='anchor_missing' OR last_check_status='removed' OR last_check_status='http_error' THEN 1 ELSE 0 END) as rot_count,
        SUM(CASE WHEN removed_at IS NOT NULL THEN 1 ELSE 0 END) as removed_count
       FROM backlinks`
    ).first<any>()
    const byAssetType = await c.env.DB.prepare(
      `SELECT asset_type, COUNT(*) as count FROM backlinks WHERE outreach_status IN ('live','verified') GROUP BY asset_type`
    ).all()
    return c.json({
      by_status: byStatus.results || [],
      totals: totals || {},
      by_asset_type: byAssetType.results || [],
    })
  } catch (e: any) {
    if (e.message?.includes('no such table')) {
      return c.json({ by_status: [], totals: {}, by_asset_type: [] })
    }
    return c.json({ error: e.message }, 500)
  }
})

// ============================================================
// ADMIN: Create backlink
// ============================================================
backlinksRoutes.post('/', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const body = await c.req.json()
    const {
      target_url, anchor_text, destination_url, asset_type, asset_slug,
      dofollow, outreach_status, placement_date, notes, outreach_owner,
    } = body
    if (!target_url) return c.json({ error: 'target_url required' }, 400)
    let target_domain = ''
    try { target_domain = new URL(target_url).hostname.replace(/^www\./, '') } catch {
      return c.json({ error: 'invalid target_url' }, 400)
    }
    const result = await c.env.DB.prepare(
      `INSERT INTO backlinks (target_domain, target_url, anchor_text, destination_url, asset_type, asset_slug, dofollow, outreach_status, placement_date, notes, outreach_owner)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      target_domain,
      target_url,
      anchor_text || null,
      destination_url || 'https://www.roofmanager.ca/',
      asset_type || null,
      asset_slug || null,
      dofollow === 0 || dofollow === '0' ? 0 : 1,
      outreach_status || 'pitched',
      placement_date || null,
      notes || null,
      outreach_owner || (admin as any).email || null,
    ).run()
    return c.json({ success: true, id: result.meta.last_row_id })
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) return c.json({ error: 'A backlink with this target_url already exists' }, 409)
    return c.json({ error: e.message }, 500)
  }
})

// ============================================================
// ADMIN: Update backlink
// ============================================================
backlinksRoutes.put('/:id', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const id = c.req.param('id')
    const body = await c.req.json()
    const fields: string[] = []
    const values: any[] = []
    for (const k of ['target_url','anchor_text','destination_url','asset_type','asset_slug','outreach_status','placement_date','notes','outreach_owner']) {
      if (k in body) { fields.push(`${k}=?`); values.push(body[k]) }
    }
    if ('dofollow' in body) {
      fields.push('dofollow=?')
      values.push(body.dofollow === 0 || body.dofollow === '0' ? 0 : 1)
    }
    if (!fields.length) return c.json({ error: 'no fields to update' }, 400)
    fields.push(`updated_at=datetime('now')`)
    values.push(id)
    await c.env.DB.prepare(`UPDATE backlinks SET ${fields.join(', ')} WHERE id=?`).bind(...values).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ============================================================
// ADMIN: Delete backlink
// ============================================================
backlinksRoutes.delete('/:id', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const id = c.req.param('id')
    await c.env.DB.prepare(`DELETE FROM backlinks WHERE id=?`).bind(id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ============================================================
// HEALTH CHECK: Verify a single backlink is still live and the anchor
// still points to a Roof Manager URL. Used by the weekly cron sweep.
// ============================================================
export async function checkBacklinkHealth(env: Bindings, row: any): Promise<{ status: string; httpCode: number | null }> {
  const targetUrl = row.target_url
  const destPattern = (row.destination_url || 'https://www.roofmanager.ca/').replace(/^https?:\/\//, '').replace(/\/$/, '')
  try {
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RoofManagerLinkChecker/1.0; +https://www.roofmanager.ca)' },
      redirect: 'follow',
    })
    const httpCode = res.status
    if (!res.ok) return { status: 'http_error', httpCode }
    const html = await res.text()
    const lowered = html.toLowerCase()
    // Match either the destination URL or the bare domain — covers anchor
    // changes that still link to roofmanager.ca even if the deep link drifted.
    if (lowered.includes(destPattern.toLowerCase()) || lowered.includes('roofmanager.ca')) {
      return { status: 'ok', httpCode }
    }
    return { status: 'anchor_missing', httpCode }
  } catch (e: any) {
    return { status: 'http_error', httpCode: null }
  }
}

// ============================================================
// CRON / ADMIN: Run health check sweep over all backlinks marked live or
// verified. Mark removed_at on rot. Caps at 100 checks per run to stay within
// Worker subrequest limits.
// ============================================================
backlinksRoutes.post('/health-check/run', async (c) => {
  const admin = await validateAdminSession(c.env.DB, c.req.header('Authorization'), c.req.header('Cookie'))
  if (!admin) return c.json({ error: 'Unauthorized' }, 401)
  const result = await runBacklinkHealthSweep(c.env)
  return c.json(result)
})

export async function runBacklinkHealthSweep(env: Bindings, limit: number = 50) {
  const candidates = await env.DB.prepare(
    `SELECT id, target_url, destination_url FROM backlinks
     WHERE outreach_status IN ('live','verified')
     ORDER BY COALESCE(last_checked_at, '1970-01-01') ASC
     LIMIT ?`
  ).bind(limit).all<any>()
  let okCount = 0, rotCount = 0, errorCount = 0
  const rotted: { id: number; target_url: string; status: string }[] = []
  for (const row of (candidates.results || [])) {
    const { status, httpCode } = await checkBacklinkHealth(env, row)
    const removedClause = (status === 'anchor_missing' || status === 'removed') ? `, removed_at=COALESCE(removed_at, datetime('now'))` : ''
    await env.DB.prepare(
      `UPDATE backlinks SET last_checked_at=datetime('now'), last_check_status=?, last_check_http_code=?${removedClause}, updated_at=datetime('now') WHERE id=?`
    ).bind(status, httpCode, row.id).run()
    if (status === 'ok') okCount++
    else if (status === 'http_error') errorCount++
    else { rotCount++; rotted.push({ id: row.id, target_url: row.target_url, status }) }
  }
  return { checked: candidates.results?.length || 0, ok: okCount, rot: rotCount, errors: errorCount, rotted }
}

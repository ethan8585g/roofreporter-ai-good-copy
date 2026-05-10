// ============================================================
// AI Assistant Tool Definitions + D1 Handlers
//
// Two surfaces:
// 1. D1 tools (this file) — read/write blog_posts and agent_configs
// 2. GitHub tools (./ai-assistant-github.ts) — read/write any file in
//    the repo via the GitHub Contents API. Commits trigger Cloudflare
//    Pages auto-deploy within ~30 seconds.
//
// The assistant has full-repo write access by design (user's call,
// 2026-05-10). Every code commit is logged to assistant_commits for
// audit + one-click revert via the revert_commit tool.
// ============================================================
import type { D1Database } from '@cloudflare/workers-types'
import { GITHUB_TOOLS, runGithubTool } from './ai-assistant-github'

// Anthropic's tool schema shape (avoids importing the SDK type into a service file)
export interface ToolDef {
  name: string
  description: string
  input_schema: { type: 'object'; properties: Record<string, any>; required?: string[] }
}

export const ASSISTANT_TOOLS: ToolDef[] = [
  // ─── Blog ────────────────────────────────────────────────
  {
    name: 'list_blog_posts',
    description: 'List blog posts with id, slug, title, status, category, published_at. Use this to find a post before reading or editing it.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['draft', 'published', 'archived', 'all'], description: 'Filter by status. Default: all.' },
        limit: { type: 'integer', description: 'Max rows to return. Default 50, max 200.' },
        search: { type: 'string', description: 'Optional case-insensitive substring match on title or slug.' },
      },
    },
  },
  {
    name: 'read_blog_post',
    description: 'Read a single blog post in full (all fields including content body).',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'integer', description: 'Blog post id.' } },
      required: ['id'],
    },
  },
  {
    name: 'create_blog_post',
    description: 'Create a new blog post. Slug must be unique. Status defaults to draft. Set status=published to publish immediately.',
    input_schema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'URL slug, lowercase, hyphenated. Must be unique.' },
        title: { type: 'string' },
        content: { type: 'string', description: 'HTML or markdown body.' },
        excerpt: { type: 'string' },
        category: { type: 'string', description: 'e.g. roofing, solar, business. Default: roofing.' },
        tags: { type: 'string', description: 'Comma-separated.' },
        cover_image_url: { type: 'string' },
        meta_title: { type: 'string' },
        meta_description: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'published'], description: 'Default: draft.' },
        is_featured: { type: 'boolean' },
      },
      required: ['slug', 'title', 'content'],
    },
  },
  {
    name: 'update_blog_post',
    description: 'Update fields on an existing blog post. Only the fields you pass are updated; others are left alone.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer' },
        slug: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        excerpt: { type: 'string' },
        category: { type: 'string' },
        tags: { type: 'string' },
        cover_image_url: { type: 'string' },
        meta_title: { type: 'string' },
        meta_description: { type: 'string' },
        status: { type: 'string', enum: ['draft', 'published', 'archived'] },
        is_featured: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'archive_blog_post',
    description: 'Soft-delete a blog post by setting status=archived. Preferred over a hard delete.',
    input_schema: {
      type: 'object',
      properties: { id: { type: 'integer' } },
      required: ['id'],
    },
  },

  // ─── Loop Tracker ────────────────────────────────────────
  {
    name: 'list_loop_definitions',
    description: 'List all registered loops (cron scans, claude /loop commands, cloud routines) with last_run_at, last_status, consecutive_failures. Useful for "what loops are configured?" and "what is currently failing?".',
    input_schema: {
      type: 'object',
      properties: {
        only_failing: { type: 'boolean', description: 'If true, only return loops with consecutive_failures > 0 or last_status != "pass".' },
      },
    },
  },
  {
    name: 'list_recent_loop_runs',
    description: 'List the most recent runs across loops, newest first. Filter by loop_id to narrow to one specific loop.',
    input_schema: {
      type: 'object',
      properties: {
        loop_id: { type: 'string', description: 'Optional. e.g. scan_public, funnel_monitor, ads_health.' },
        limit: { type: 'integer', description: 'Max rows. Default 25, max 200.' },
      },
    },
  },
  {
    name: 'list_loop_findings',
    description: 'List recent findings from loop scans (errors + warnings detected by the monitoring loops). Filter by severity and/or category. Defaults to unresolved-only.',
    input_schema: {
      type: 'object',
      properties: {
        severity: { type: 'string', enum: ['error', 'warn', 'all'], description: 'Default: all.' },
        category: { type: 'string', description: 'e.g. broken_link, form_smoke, console_error, api_health, health_check.' },
        include_resolved: { type: 'boolean', description: 'Default false — only unresolved.' },
        hours: { type: 'integer', description: 'Look back this many hours. Default 24, max 720 (30 days).' },
        limit: { type: 'integer', description: 'Max rows. Default 50, max 500.' },
      },
    },
  },
  {
    name: 'get_loop_health_summary',
    description: 'Quick read of overall loop health: counts of pass/fail loops, top failing loops, unresolved-findings totals by severity. Use this for "is everything healthy?" questions.',
    input_schema: { type: 'object', properties: {} },
  },

  // ─── Agent Configs ──────────────────────────────────────
  {
    name: 'list_agent_configs',
    description: 'List all agent configurations: agent_type, enabled flag, config_json, last_run_at, last_run_status.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'read_agent_config',
    description: 'Read a single agent configuration by agent_type.',
    input_schema: {
      type: 'object',
      properties: { agent_type: { type: 'string', description: 'e.g. tracing, content, email, lead, scan_admin, drips.' } },
      required: ['agent_type'],
    },
  },
  {
    name: 'update_agent_config',
    description: 'Toggle an agent on/off and/or update its config_json. Pass enabled to flip it. Pass config_json (parsed object, not string) to replace the JSON config wholesale.',
    input_schema: {
      type: 'object',
      properties: {
        agent_type: { type: 'string' },
        enabled: { type: 'boolean' },
        config_json: { type: 'object', description: 'Replacement JSON config. Parsed object — the handler stringifies.' },
      },
      required: ['agent_type'],
    },
  },
]

// ─── Combined tool list (D1 + GitHub) ─────────────────────
export const ALL_TOOLS: ToolDef[] = [...ASSISTANT_TOOLS, ...GITHUB_TOOLS]

// ─── Handlers ──────────────────────────────────────────────

export async function runTool(
  db: D1Database,
  context: {
    githubToken: string
    userPrompt: string
    model: string
    cloudflareApiToken?: string
    cloudflareAccountId?: string
    waitUntil?: (p: Promise<any>) => void
  },
  name: string,
  input: any,
): Promise<any> {
  // GitHub tools dispatch through their own runner (needs the token + audit context)
  if (GITHUB_TOOLS.some(t => t.name === name)) {
    return runGithubTool(context.githubToken, db, {
      userPrompt: context.userPrompt,
      model: context.model,
      cloudflareApiToken: context.cloudflareApiToken,
      cloudflareAccountId: context.cloudflareAccountId,
      waitUntil: context.waitUntil,
    }, name, input)
  }
  switch (name) {
    case 'list_blog_posts':
      return listBlogPosts(db, input)
    case 'read_blog_post':
      return readBlogPost(db, input)
    case 'create_blog_post':
      return createBlogPost(db, input)
    case 'update_blog_post':
      return updateBlogPost(db, input)
    case 'archive_blog_post':
      return archiveBlogPost(db, input)
    case 'list_agent_configs':
      return listAgentConfigs(db)
    case 'read_agent_config':
      return readAgentConfig(db, input)
    case 'update_agent_config':
      return updateAgentConfig(db, input)
    case 'list_loop_definitions':
      return listLoopDefinitions(db, input)
    case 'list_recent_loop_runs':
      return listRecentLoopRuns(db, input)
    case 'list_loop_findings':
      return listLoopFindings(db, input)
    case 'get_loop_health_summary':
      return getLoopHealthSummary(db)
    default:
      return { error: `Unknown tool: ${name}` }
  }
}

async function listBlogPosts(db: D1Database, input: any) {
  const status = input?.status && input.status !== 'all' ? input.status : null
  const limit = Math.min(Math.max(1, Number(input?.limit) || 50), 200)
  const search = input?.search ? `%${String(input.search).toLowerCase()}%` : null

  let sql = `SELECT id, slug, title, status, category, is_featured, view_count, published_at, updated_at
             FROM blog_posts WHERE 1=1`
  const binds: any[] = []
  if (status) { sql += ' AND status = ?'; binds.push(status) }
  if (search) { sql += ' AND (LOWER(title) LIKE ? OR LOWER(slug) LIKE ?)'; binds.push(search, search) }
  sql += ' ORDER BY updated_at DESC LIMIT ?'
  binds.push(limit)

  const result = await db.prepare(sql).bind(...binds).all()
  return { posts: result.results, count: result.results?.length ?? 0 }
}

async function readBlogPost(db: D1Database, input: any) {
  const id = Number(input?.id)
  if (!id) return { error: 'id is required' }
  const row = await db.prepare('SELECT * FROM blog_posts WHERE id = ?').bind(id).first()
  if (!row) return { error: `No blog post with id ${id}` }
  return { post: row }
}

async function createBlogPost(db: D1Database, input: any) {
  if (!input?.slug || !input?.title || !input?.content) {
    return { error: 'slug, title, content are required' }
  }
  const status = input.status === 'published' ? 'published' : 'draft'
  const publishedAt = status === 'published' ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null
  try {
    const result = await db.prepare(`
      INSERT INTO blog_posts (slug, title, content, excerpt, category, tags, cover_image_url,
                              meta_title, meta_description, status, is_featured, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      input.slug,
      input.title,
      input.content,
      input.excerpt ?? null,
      input.category ?? 'roofing',
      input.tags ?? null,
      input.cover_image_url ?? null,
      input.meta_title ?? null,
      input.meta_description ?? null,
      status,
      input.is_featured ? 1 : 0,
      publishedAt,
    ).run()
    return { ok: true, id: result.meta?.last_row_id, slug: input.slug, status }
  } catch (e: any) {
    return { error: `Insert failed: ${e?.message || e}` }
  }
}

async function updateBlogPost(db: D1Database, input: any) {
  const id = Number(input?.id)
  if (!id) return { error: 'id is required' }
  const allowed = ['slug', 'title', 'content', 'excerpt', 'category', 'tags', 'cover_image_url',
                   'meta_title', 'meta_description', 'status', 'is_featured']
  const sets: string[] = []
  const binds: any[] = []
  for (const f of allowed) {
    if (input[f] === undefined) continue
    sets.push(`${f} = ?`)
    binds.push(f === 'is_featured' ? (input[f] ? 1 : 0) : input[f])
  }
  // Auto-stamp published_at the first time status flips to published
  if (input.status === 'published') {
    const current = await db.prepare('SELECT published_at FROM blog_posts WHERE id = ?').bind(id).first<any>()
    if (current && !current.published_at) {
      sets.push('published_at = ?')
      binds.push(new Date().toISOString().replace('T', ' ').slice(0, 19))
    }
  }
  if (!sets.length) return { error: 'No fields to update' }
  sets.push("updated_at = datetime('now')")
  binds.push(id)
  try {
    await db.prepare(`UPDATE blog_posts SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run()
    return { ok: true, id, fields_updated: sets.length - 1 }
  } catch (e: any) {
    return { error: `Update failed: ${e?.message || e}` }
  }
}

async function archiveBlogPost(db: D1Database, input: any) {
  const id = Number(input?.id)
  if (!id) return { error: 'id is required' }
  await db.prepare(`UPDATE blog_posts SET status='archived', updated_at=datetime('now') WHERE id = ?`).bind(id).run()
  return { ok: true, id, status: 'archived' }
}

async function listAgentConfigs(db: D1Database) {
  const result = await db.prepare(
    `SELECT agent_type, enabled, config_json, last_run_at, last_run_status, run_count, error_count, updated_at
     FROM agent_configs ORDER BY agent_type`
  ).all()
  return { configs: result.results }
}

async function readAgentConfig(db: D1Database, input: any) {
  if (!input?.agent_type) return { error: 'agent_type is required' }
  const row = await db.prepare('SELECT * FROM agent_configs WHERE agent_type = ?').bind(input.agent_type).first()
  if (!row) return { error: `No agent_config for agent_type=${input.agent_type}` }
  return { config: row }
}

// ─── Loop Tracker handlers ─────────────────────────────────

async function listLoopDefinitions(db: D1Database, input: any) {
  let sql = `SELECT loop_id, name, category, source, schedule_human, expected_period_seconds,
                    enabled, last_run_at, last_status, consecutive_failures, total_runs, total_failures
             FROM loop_definitions`
  if (input?.only_failing) sql += ` WHERE consecutive_failures > 0 OR (last_status IS NOT NULL AND last_status != 'pass')`
  sql += ` ORDER BY consecutive_failures DESC, last_run_at DESC`
  const result = await db.prepare(sql).all()
  return { loops: result.results, count: result.results?.length ?? 0 }
}

async function listRecentLoopRuns(db: D1Database, input: any) {
  const limit = Math.min(Math.max(1, Number(input?.limit) || 25), 200)
  let sql = `SELECT id, loop_id, scan_type, status, started_at, finished_at, duration_ms,
                    pages_checked, ok_count, fail_count, summary, source
             FROM loop_scan_runs`
  const binds: any[] = []
  if (input?.loop_id) { sql += ' WHERE loop_id = ?'; binds.push(input.loop_id) }
  sql += ' ORDER BY started_at DESC LIMIT ?'
  binds.push(limit)
  const result = await db.prepare(sql).bind(...binds).all()
  return { runs: result.results, count: result.results?.length ?? 0 }
}

async function listLoopFindings(db: D1Database, input: any) {
  const hours = Math.min(Math.max(1, Number(input?.hours) || 24), 720)
  const limit = Math.min(Math.max(1, Number(input?.limit) || 50), 500)
  let sql = `SELECT id, run_id, severity, category, url, message, created_at, resolved_at
             FROM loop_scan_findings
             WHERE created_at >= datetime('now', ?)`
  const binds: any[] = [`-${hours} hours`]
  if (input?.severity && input.severity !== 'all') { sql += ' AND severity = ?'; binds.push(input.severity) }
  if (input?.category) { sql += ' AND category = ?'; binds.push(input.category) }
  if (!input?.include_resolved) sql += ' AND resolved_at IS NULL'
  sql += ' ORDER BY created_at DESC LIMIT ?'
  binds.push(limit)
  const result = await db.prepare(sql).bind(...binds).all()
  return { findings: result.results, count: result.results?.length ?? 0, lookback_hours: hours }
}

async function getLoopHealthSummary(db: D1Database) {
  const loops = await db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN last_status = 'pass' THEN 1 ELSE 0 END) as passing,
           SUM(CASE WHEN last_status IN ('fail','error') THEN 1 ELSE 0 END) as failing,
           SUM(CASE WHEN consecutive_failures > 0 THEN 1 ELSE 0 END) as stuck
    FROM loop_definitions WHERE enabled = 1
  `).first()

  const findings24h = await db.prepare(`
    SELECT severity, COUNT(*) as count
    FROM loop_scan_findings
    WHERE created_at >= datetime('now', '-24 hours') AND resolved_at IS NULL
    GROUP BY severity
  `).all()

  const topFailing = await db.prepare(`
    SELECT loop_id, name, consecutive_failures, last_status, last_run_at
    FROM loop_definitions
    WHERE enabled = 1 AND (consecutive_failures > 0 OR last_status IN ('fail','error'))
    ORDER BY consecutive_failures DESC LIMIT 10
  `).all()

  return {
    loops: loops,
    unresolved_findings_24h: findings24h.results,
    top_failing_loops: topFailing.results,
  }
}

async function updateAgentConfig(db: D1Database, input: any) {
  if (!input?.agent_type) return { error: 'agent_type is required' }
  const sets: string[] = []
  const binds: any[] = []
  if (input.enabled !== undefined) { sets.push('enabled = ?'); binds.push(input.enabled ? 1 : 0) }
  if (input.config_json !== undefined) {
    sets.push('config_json = ?')
    binds.push(typeof input.config_json === 'string' ? input.config_json : JSON.stringify(input.config_json))
  }
  if (!sets.length) return { error: 'Nothing to update — pass enabled and/or config_json' }
  sets.push("updated_at = datetime('now')")
  binds.push(input.agent_type)
  const result = await db.prepare(`UPDATE agent_configs SET ${sets.join(', ')} WHERE agent_type = ?`).bind(...binds).run()
  if (!result.meta?.changes) return { error: `No agent_config found for agent_type=${input.agent_type}` }
  return { ok: true, agent_type: input.agent_type }
}

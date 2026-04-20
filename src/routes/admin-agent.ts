// ============================================================
// Admin AI Agent — Anthropic Claude-powered autonomous admin
// Migrated from OpenAI to @anthropic-ai/sdk (claude-sonnet-4-6)
// ============================================================

import { Hono } from 'hono'
import Anthropic from '@anthropic-ai/sdk'
import { CLAUDE_MODEL } from '../services/anthropic-client'
import { getAdminSessionToken } from '../lib/session-tokens'

type Bindings = {
  DB: D1Database
  ANTHROPIC_API_KEY: string
  [key: string]: any
}

export const adminAgentRoutes = new Hono<{ Bindings: Bindings }>()

adminAgentRoutes.use('/*', async (c, next) => {
  const token = getAdminSessionToken(c)
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  const session = await c.env.DB.prepare(
    `SELECT s.*, a.email, a.name, a.role FROM admin_sessions s
     JOIN admin_users a ON s.admin_id = a.id
     WHERE s.session_token = ? AND s.expires_at > datetime('now')`
  ).bind(token).first<any>()
  if (!session || session.role !== 'superadmin') return c.json({ error: 'Forbidden' }, 403)
  c.set('adminId' as any, session.admin_id)
  await next()
})

// ── Tool definitions (Anthropic format) ──────────────────────

const TOOLS: Anthropic.Tool[] = [
  {
    name: 'query_database',
    description: 'READ-ONLY SELECT query. Tables: orders, customers, admin_users, settings, blog_posts, reports, invoices, credit_packages, payments, user_activity_log, admin_agent_threads, admin_agent_actions.',
    input_schema: {
      type: 'object',
      properties: {
        sql:    { type: 'string', description: 'SELECT SQL query' },
        params: { type: 'array', items: { type: 'string' }, description: 'Bind parameters' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'update_setting',
    description: 'Update a site setting. Prices in cents.',
    input_schema: {
      type: 'object',
      properties: {
        key:   { type: 'string' },
        value: { type: 'string' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'create_blog_post',
    description: 'Create a blog post (default draft).',
    input_schema: {
      type: 'object',
      properties: {
        title:            { type: 'string' },
        slug:             { type: 'string' },
        content:          { type: 'string' },
        excerpt:          { type: 'string' },
        meta_description: { type: 'string' },
        category:         { type: 'string' },
        tags:             { type: 'string' },
        status:           { type: 'string', enum: ['draft', 'published'] },
      },
      required: ['title', 'slug', 'content'],
    },
  },
  {
    name: 'update_order_status',
    description: 'Update an order status.',
    input_schema: {
      type: 'object',
      properties: {
        order_id: { type: 'number' },
        status:   { type: 'string', enum: ['pending', 'processing', 'enhancing', 'completed', 'failed', 'cancelled'] },
        notes:    { type: 'string' },
      },
      required: ['order_id', 'status'],
    },
  },
  {
    name: 'send_announcement',
    description: 'Create/update the site-wide announcement banner.',
    input_schema: {
      type: 'object',
      properties: {
        message:   { type: 'string' },
        type:      { type: 'string', enum: ['info', 'warning', 'success', 'promo'] },
        active:    { type: 'boolean' },
        link_url:  { type: 'string' },
        link_text: { type: 'string' },
      },
      required: ['message', 'type', 'active'],
    },
  },
  {
    name: 'manage_customer',
    description: 'Add credits or toggle active status for a customer.',
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'number' },
        action:      { type: 'string', enum: ['add_credits', 'toggle_active'] },
        credits:     { type: 'number' },
      },
      required: ['customer_id', 'action'],
    },
  },
  {
    name: 'get_dashboard_stats',
    description: 'Dashboard stats for a period.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'this_week', 'this_month', 'all_time'] },
      },
      required: ['period'],
    },
  },
]

// ── Tool executor ─────────────────────────────────────────────

async function executeTool(name: string, args: any, db: D1Database) {
  try {
    switch (name) {
      case 'query_database': {
        const sql = (args.sql || '').trim()
        if (!/^SELECT\s/i.test(sql)) return { success: false, message: 'Only SELECT allowed' }
        if (/DROP|ALTER|TRUNCATE|CREATE|INSERT|UPDATE|DELETE|PRAGMA/i.test(sql)) return { success: false, message: 'Unsafe SQL' }
        const stmt = db.prepare(sql)
        const r = await (args.params?.length ? stmt.bind(...args.params) : stmt).all()
        return { success: true, result: r.results?.slice(0, 50), count: r.results?.length || 0 }
      }
      case 'update_setting': {
        const existing = await db.prepare(`SELECT id FROM settings WHERE master_company_id = 1 AND setting_key = ?`).bind(args.key).first<any>()
        if (existing) await db.prepare(`UPDATE settings SET setting_value = ?, updated_at = datetime('now') WHERE master_company_id = 1 AND setting_key = ?`).bind(args.value, args.key).run()
        else await db.prepare(`INSERT INTO settings (master_company_id, setting_key, setting_value, is_encrypted) VALUES (1, ?, ?, 0)`).bind(args.key, args.value).run()
        return { success: true, message: `Setting ${args.key} updated` }
      }
      case 'create_blog_post': {
        const r = await db.prepare(
          `INSERT INTO blog_posts (title, slug, content, excerpt, meta_description, category, tags, status, author_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'AI Agent', datetime('now'), datetime('now'))`
        ).bind(args.title, args.slug, args.content, args.excerpt || '', args.meta_description || '', args.category || 'general', args.tags || '', args.status || 'draft').run()
        return { success: true, id: r.meta.last_row_id, status: args.status || 'draft' }
      }
      case 'update_order_status': {
        await db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(args.status, args.order_id).run()
        return { success: true, order_id: args.order_id, status: args.status }
      }
      case 'send_announcement': {
        const data = JSON.stringify({ ...args, updated_at: new Date().toISOString() })
        const existing = await db.prepare(`SELECT id FROM settings WHERE master_company_id = 1 AND setting_key = 'announcement_banner'`).first<any>()
        if (existing) await db.prepare(`UPDATE settings SET setting_value = ?, updated_at = datetime('now') WHERE master_company_id = 1 AND setting_key = 'announcement_banner'`).bind(data).run()
        else await db.prepare(`INSERT INTO settings (master_company_id, setting_key, setting_value, is_encrypted) VALUES (1, 'announcement_banner', ?, 0)`).bind(data).run()
        return { success: true, active: args.active }
      }
      case 'manage_customer': {
        if (args.action === 'add_credits') await db.prepare(`UPDATE customers SET report_credits = report_credits + ?, updated_at = datetime('now') WHERE id = ?`).bind(args.credits || 0, args.customer_id).run()
        else if (args.action === 'toggle_active') await db.prepare(`UPDATE customers SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?`).bind(args.customer_id).run()
        return { success: true, customer_id: args.customer_id, action: args.action }
      }
      case 'get_dashboard_stats': {
        const p = args.period || 'all_time'
        let df = ''
        if (p === 'today') df = `AND date(created_at) = date('now')`
        else if (p === 'this_week') df = `AND created_at >= datetime('now', '-7 days')`
        else if (p === 'this_month') df = `AND created_at >= datetime('now', '-30 days')`
        const [orders, customers, revenue] = await Promise.all([
          db.prepare(`SELECT COUNT(*) as count, status FROM orders WHERE 1=1 ${df} GROUP BY status`).all(),
          db.prepare(`SELECT COUNT(*) as count FROM customers WHERE 1=1 ${df}`).first<any>(),
          db.prepare(`SELECT SUM(amount_cents) as total FROM payments WHERE status = 'completed' ${df}`).first<any>()
        ])
        return { success: true, period: p, orders_by_status: orders.results, total_customers: customers?.count || 0, total_revenue_dollars: ((revenue?.total || 0) / 100).toFixed(2) }
      }
      default: return { success: false, message: `Unknown tool: ${name}` }
    }
  } catch (e: any) {
    return { success: false, message: e.message }
  }
}

const SYSTEM_PROMPT = `You are the **Roof Manager Autonomous Admin Agent** — you manage the platform, complete tasks, and help grow the business.

Capabilities: query the database, update settings, create/edit blog posts, update orders, manage customers, post announcements, read analytics.

Principles:
1. Be proactive — when given a goal, break it into steps and execute
2. Plan briefly first for multi-step tasks, then execute
3. Always query the DB before decisions that depend on current state
4. Confirm destructive actions (price changes, bulk updates, toggling customers)
5. Report results concisely
6. Growth mindset — suggest SEO blog topics, pricing experiments, announcement campaigns

Prices are in CENTS ($49 = 4900).`

// ── Chat endpoint ─────────────────────────────────────────────

adminAgentRoutes.post('/chat', async (c) => {
  const { message, thread_id } = await c.req.json<{ message: string; thread_id?: number }>()
  if (!message) return c.json({ error: 'No message' }, 400)

  const adminId = c.get('adminId' as any) as number
  const db = c.env.DB
  const apiKey = c.env.ANTHROPIC_API_KEY
  if (!apiKey) return c.json({ reply: 'ANTHROPIC_API_KEY not configured.', actions: [] })

  let threadId = thread_id
  if (!threadId) {
    const r = await db.prepare(`INSERT INTO admin_agent_threads (admin_user_id, title) VALUES (?, ?)`).bind(adminId, message.slice(0, 80)).run()
    threadId = r.meta.last_row_id as number
  }

  // Load history
  const hist = await db.prepare(
    `SELECT role, content, tool_calls, tool_call_id FROM admin_agent_messages WHERE thread_id = ? ORDER BY id ASC LIMIT 60`
  ).bind(threadId).all<any>()

  const messages: Anthropic.MessageParam[] = []
  for (const m of hist.results || []) {
    if (m.role === 'tool') {
      // Anthropic uses a user-role message with tool_result content for tool responses
      messages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content }],
      })
    } else if (m.role === 'assistant' && m.tool_calls) {
      const toolCalls = JSON.parse(m.tool_calls)
      const content: Anthropic.ContentBlock[] = []
      if (m.content) content.push({ type: 'text', text: m.content })
      for (const tc of toolCalls) {
        content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input ?? {} })
      }
      messages.push({ role: 'assistant', content })
    } else {
      messages.push({ role: m.role as 'user' | 'assistant', content: m.content })
    }
  }
  messages.push({ role: 'user', content: message })

  await db.prepare(`INSERT INTO admin_agent_messages (thread_id, role, content) VALUES (?, 'user', ?)`).bind(threadId, message).run()

  const client = new Anthropic({ apiKey })
  const actions: any[] = []

  try {
    let round = 0
    while (round < 6) {
      round++
      const response = await client.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      })

      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use') as Anthropic.ToolUseBlock[]
      const textBlock = response.content.find(b => b.type === 'text') as Anthropic.TextBlock | undefined

      if (toolUseBlocks.length > 0) {
        // Save assistant message with tool_calls
        const toolCallsJson = JSON.stringify(toolUseBlocks.map(b => ({ id: b.id, name: b.name, input: b.input })))
        await db.prepare(
          `INSERT INTO admin_agent_messages (thread_id, role, content, tool_calls) VALUES (?, 'assistant', ?, ?)`
        ).bind(threadId, textBlock?.text || '', toolCallsJson).run()

        messages.push({ role: 'assistant', content: response.content })

        // Execute tools and collect results
        const toolResults: Anthropic.ToolResultBlockParam[] = []
        for (const block of toolUseBlocks) {
          const r = await executeTool(block.name, block.input, db)
          actions.push({ tool: block.name, args: block.input, ...r })
          const toolContent = JSON.stringify(r).slice(0, 6000)
          try {
            await db.prepare(
              `INSERT INTO admin_agent_actions (thread_id, admin_user_id, tool_name, args, result, success) VALUES (?, ?, ?, ?, ?, ?)`
            ).bind(threadId, adminId, block.name, JSON.stringify(block.input), toolContent, r.success ? 1 : 0).run()
          } catch {}
          await db.prepare(
            `INSERT INTO admin_agent_messages (thread_id, role, content, tool_call_id) VALUES (?, 'tool', ?, ?)`
          ).bind(threadId, toolContent, block.id).run()
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: toolContent })
        }

        messages.push({ role: 'user', content: toolResults })
        continue
      }

      // Final text response
      const reply = textBlock?.text || '(no reply)'
      await db.prepare(`INSERT INTO admin_agent_messages (thread_id, role, content) VALUES (?, 'assistant', ?)`).bind(threadId, reply).run()
      await db.prepare(`UPDATE admin_agent_threads SET updated_at = datetime('now') WHERE id = ?`).bind(threadId).run()
      return c.json({ thread_id: threadId, reply, actions })
    }
    return c.json({ thread_id: threadId, reply: 'Stopped (max rounds reached)', actions })
  } catch (e: any) {
    console.error('[admin-agent] Exception', e)
    return c.json({ thread_id: threadId, reply: `Error: ${e.message}`, actions }, 200)
  }
})

adminAgentRoutes.get('/threads', async (c) => {
  const adminId = c.get('adminId' as any) as number
  const r = await c.env.DB.prepare(
    `SELECT id, title, created_at, updated_at FROM admin_agent_threads WHERE admin_user_id = ? ORDER BY updated_at DESC LIMIT 50`
  ).bind(adminId).all()
  return c.json({ threads: r.results })
})

adminAgentRoutes.get('/threads/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const msgs = await c.env.DB.prepare(
    `SELECT role, content, tool_calls, created_at FROM admin_agent_messages WHERE thread_id = ? ORDER BY id ASC`
  ).bind(id).all()
  return c.json({ thread_id: id, messages: msgs.results })
})

adminAgentRoutes.get('/actions', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT id, thread_id, tool_name, args, success, autonomous, created_at FROM admin_agent_actions ORDER BY id DESC LIMIT 100`
  ).all()
  return c.json({ actions: r.results })
})

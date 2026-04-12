import { Hono } from 'hono'
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { HumanMessage, AIMessage, SystemMessage, ToolMessage, BaseMessage } from '@langchain/core/messages'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { MemorySaver } from '@langchain/langgraph'
import { z } from 'zod'

type Bindings = {
  DB: D1Database
  OPENAI_API_KEY: string
  OPENAI_BASE_URL?: string
  [key: string]: any
}

export const adminAgentRoutes = new Hono<{ Bindings: Bindings }>()

// ── Superadmin auth ──────────────────────────────────────────────
adminAgentRoutes.use('/*', async (c, next) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  const session = await c.env.DB.prepare(
    `SELECT s.*, a.email, a.name, a.role FROM admin_sessions s
     JOIN admin_users a ON s.admin_user_id = a.id
     WHERE s.session_token = ? AND s.expires_at > datetime('now')`
  ).bind(token).first<any>()
  if (!session || session.role !== 'superadmin') return c.json({ error: 'Forbidden' }, 403)
  c.set('adminId' as any, session.admin_user_id)
  await next()
})

// ── Tool builder (D1-bound) ──────────────────────────────────────
function buildTools(db: D1Database, threadId: number | null, adminId: number, autonomous = false) {
  const logAction = async (name: string, args: any, result: any, success: boolean) => {
    try {
      await db.prepare(
        `INSERT INTO admin_agent_actions (thread_id, admin_user_id, tool_name, args, result, success, autonomous)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).bind(threadId, adminId, name, JSON.stringify(args), JSON.stringify(result).slice(0, 4000), success ? 1 : 0, autonomous ? 1 : 0).run()
    } catch {}
  }

  const queryDatabase = tool(async ({ sql, params }) => {
    const s = (sql || '').trim()
    if (!/^SELECT\s/i.test(s)) return JSON.stringify({ error: 'Only SELECT allowed' })
    if (/DROP|ALTER|TRUNCATE|CREATE|INSERT|UPDATE|DELETE|PRAGMA/i.test(s)) return JSON.stringify({ error: 'Unsafe SQL' })
    const stmt = db.prepare(s)
    const bound = params && params.length ? stmt.bind(...params) : stmt
    const r = await bound.all()
    const out = { rows: r.results?.slice(0, 50), count: r.results?.length || 0 }
    await logAction('query_database', { sql: s.slice(0, 200) }, out, true)
    return JSON.stringify(out)
  }, {
    name: 'query_database',
    description: 'Run a READ-ONLY SELECT query. Tables: orders, customers, admin_users, settings, blog_posts, reports, invoices, credit_packages, payments, user_activity_log, admin_agent_threads, admin_agent_actions.',
    schema: z.object({
      sql: z.string().describe('SELECT query'),
      params: z.array(z.any()).optional().describe('Bind parameters')
    })
  })

  const updateSetting = tool(async ({ key, value }) => {
    const existing = await db.prepare(`SELECT id FROM settings WHERE master_company_id = 1 AND setting_key = ?`).bind(key).first<any>()
    if (existing) {
      await db.prepare(`UPDATE settings SET setting_value = ?, updated_at = datetime('now') WHERE master_company_id = 1 AND setting_key = ?`).bind(value, key).run()
    } else {
      await db.prepare(`INSERT INTO settings (master_company_id, setting_key, setting_value, is_encrypted) VALUES (1, ?, ?, 0)`).bind(key, value).run()
    }
    const out = { key, value, message: `Setting ${key} updated` }
    await logAction('update_setting', { key, value }, out, true)
    return JSON.stringify(out)
  }, {
    name: 'update_setting',
    description: 'Update a site setting (pricing, feature flags, company info, etc.). Prices are in cents.',
    schema: z.object({ key: z.string(), value: z.string() })
  })

  const createBlogPost = tool(async (a) => {
    const r = await db.prepare(
      `INSERT INTO blog_posts (title, slug, content, excerpt, meta_description, category, tags, status, author_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'AI Agent', datetime('now'), datetime('now'))`
    ).bind(a.title, a.slug, a.content, a.excerpt || '', a.meta_description || '', a.category || 'general', a.tags || '', a.status || 'draft').run()
    const out = { id: r.meta.last_row_id, title: a.title, status: a.status || 'draft' }
    await logAction('create_blog_post', { title: a.title, slug: a.slug }, out, true)
    return JSON.stringify(out)
  }, {
    name: 'create_blog_post',
    description: 'Create a blog post (default draft).',
    schema: z.object({
      title: z.string(), slug: z.string(), content: z.string(),
      excerpt: z.string().optional(), meta_description: z.string().optional(),
      category: z.string().optional(), tags: z.string().optional(),
      status: z.enum(['draft', 'published']).optional()
    })
  })

  const updateOrderStatus = tool(async ({ order_id, status, notes }) => {
    await db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(status, order_id).run()
    const out = { order_id, status, notes: notes || null }
    await logAction('update_order_status', { order_id, status }, out, true)
    return JSON.stringify(out)
  }, {
    name: 'update_order_status',
    description: 'Update an order status.',
    schema: z.object({
      order_id: z.number(),
      status: z.enum(['pending', 'processing', 'enhancing', 'completed', 'failed', 'cancelled']),
      notes: z.string().optional()
    })
  })

  const sendAnnouncement = tool(async (a) => {
    const data = JSON.stringify({ ...a, updated_at: new Date().toISOString() })
    const existing = await db.prepare(`SELECT id FROM settings WHERE master_company_id = 1 AND setting_key = 'announcement_banner'`).first<any>()
    if (existing) {
      await db.prepare(`UPDATE settings SET setting_value = ?, updated_at = datetime('now') WHERE master_company_id = 1 AND setting_key = 'announcement_banner'`).bind(data).run()
    } else {
      await db.prepare(`INSERT INTO settings (master_company_id, setting_key, setting_value, is_encrypted) VALUES (1, 'announcement_banner', ?, 0)`).bind(data).run()
    }
    const out = { active: a.active, message: a.message }
    await logAction('send_announcement', a, out, true)
    return JSON.stringify(out)
  }, {
    name: 'send_announcement',
    description: 'Create/update the site-wide announcement banner.',
    schema: z.object({
      message: z.string(),
      type: z.enum(['info', 'warning', 'success', 'promo']),
      active: z.boolean(),
      link_url: z.string().optional(),
      link_text: z.string().optional()
    })
  })

  const manageCustomer = tool(async (a) => {
    if (a.action === 'add_credits') {
      await db.prepare(`UPDATE customers SET credits_remaining = credits_remaining + ?, updated_at = datetime('now') WHERE id = ?`).bind(a.credits || 0, a.customer_id).run()
    } else if (a.action === 'toggle_active') {
      await db.prepare(`UPDATE customers SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?`).bind(a.customer_id).run()
    }
    const out = { customer_id: a.customer_id, action: a.action }
    await logAction('manage_customer', a, out, true)
    return JSON.stringify(out)
  }, {
    name: 'manage_customer',
    description: 'Add credits or toggle active status for a customer.',
    schema: z.object({
      customer_id: z.number(),
      action: z.enum(['add_credits', 'toggle_active']),
      credits: z.number().optional()
    })
  })

  const dashboardStats = tool(async ({ period }) => {
    let df = ''
    if (period === 'today') df = `AND date(created_at) = date('now')`
    else if (period === 'this_week') df = `AND created_at >= datetime('now', '-7 days')`
    else if (period === 'this_month') df = `AND created_at >= datetime('now', '-30 days')`
    const [orders, customers, revenue] = await Promise.all([
      db.prepare(`SELECT COUNT(*) as count, status FROM orders WHERE 1=1 ${df} GROUP BY status`).all(),
      db.prepare(`SELECT COUNT(*) as count FROM customers WHERE 1=1 ${df}`).first<any>(),
      db.prepare(`SELECT SUM(amount_cents) as total FROM payments WHERE status = 'completed' ${df}`).first<any>()
    ])
    const out = {
      period,
      orders_by_status: orders.results,
      total_customers: customers?.count || 0,
      total_revenue_dollars: ((revenue?.total || 0) / 100).toFixed(2)
    }
    await logAction('get_dashboard_stats', { period }, out, true)
    return JSON.stringify(out)
  }, {
    name: 'get_dashboard_stats',
    description: 'Get dashboard stats for a period.',
    schema: z.object({ period: z.enum(['today', 'this_week', 'this_month', 'all_time']) })
  })

  return [queryDatabase, updateSetting, createBlogPost, updateOrderStatus, sendAnnouncement, manageCustomer, dashboardStats]
}

const SYSTEM_PROMPT = `You are the **Roof Manager Autonomous Admin Agent**. You manage the platform, complete tasks, and help grow the business.

Capabilities:
- Query the database (SELECT only)
- Update settings (pricing in CENTS, feature flags, company info)
- Create/edit blog posts (use for SEO growth — generate high-quality HTML content)
- Update order statuses
- Manage customers (credits, active status)
- Post site-wide announcement banners
- Read dashboard analytics

Principles:
1. **Be autonomous and proactive** — when given a goal, break it into steps and execute without excessive confirmation
2. **Plan first** — for multi-step tasks, briefly outline your plan, then execute
3. **Use data** — always query the DB before making decisions that depend on current state
4. **Confirm destructive actions** — toggling customers off, bulk updates, price changes should be confirmed
5. **Report results** — summarize what you did and what you observed
6. **Growth mindset** — suggest SEO blog topics, pricing experiments, announcement campaigns

Prices are stored in CENTS ($49.00 = 4900). Today's date is in the conversation context.`

// ── Load/save thread history ─────────────────────────────────────
async function loadThread(db: D1Database, threadId: number): Promise<BaseMessage[]> {
  const r = await db.prepare(
    `SELECT role, content, tool_calls, tool_call_id, name FROM admin_agent_messages
     WHERE thread_id = ? ORDER BY id ASC LIMIT 100`
  ).bind(threadId).all<any>()
  const msgs: BaseMessage[] = []
  for (const m of r.results || []) {
    if (m.role === 'user') msgs.push(new HumanMessage(m.content || ''))
    else if (m.role === 'assistant') {
      const tc = m.tool_calls ? JSON.parse(m.tool_calls) : undefined
      msgs.push(new AIMessage({ content: m.content || '', tool_calls: tc }))
    } else if (m.role === 'tool') {
      msgs.push(new ToolMessage({ content: m.content || '', tool_call_id: m.tool_call_id || '', name: m.name || undefined }))
    }
  }
  return msgs
}

async function saveMessages(db: D1Database, threadId: number, msgs: BaseMessage[]) {
  for (const m of msgs) {
    const role = m instanceof HumanMessage ? 'user' : m instanceof AIMessage ? 'assistant' : m instanceof ToolMessage ? 'tool' : 'system'
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    const toolCalls = m instanceof AIMessage && m.tool_calls?.length ? JSON.stringify(m.tool_calls) : null
    const toolCallId = m instanceof ToolMessage ? m.tool_call_id : null
    const name = m instanceof ToolMessage ? (m.name || null) : null
    await db.prepare(
      `INSERT INTO admin_agent_messages (thread_id, role, content, tool_calls, tool_call_id, name) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(threadId, role, content, toolCalls, toolCallId, name).run()
  }
  await db.prepare(`UPDATE admin_agent_threads SET updated_at = datetime('now') WHERE id = ?`).bind(threadId).run()
}

// ── POST /chat ───────────────────────────────────────────────────
adminAgentRoutes.post('/chat', async (c) => {
  const { message, thread_id } = await c.req.json<{ message: string; thread_id?: number }>()
  if (!message) return c.json({ error: 'No message' }, 400)

  const adminId = c.get('adminId' as any) as number
  const db = c.env.DB

  let threadId = thread_id
  if (!threadId) {
    const r = await db.prepare(
      `INSERT INTO admin_agent_threads (admin_user_id, title) VALUES (?, ?)`
    ).bind(adminId, message.slice(0, 80)).run()
    threadId = r.meta.last_row_id as number
  }

  const history = await loadThread(db, threadId)
  const newUserMsg = new HumanMessage(message)

  const llm = new ChatOpenAI({
    model: 'gpt-4o',
    temperature: 0.3,
    apiKey: c.env.OPENAI_API_KEY,
    configuration: c.env.OPENAI_BASE_URL ? { baseURL: c.env.OPENAI_BASE_URL } : undefined
  })

  const tools = buildTools(db, threadId, adminId, false)
  const agent = createReactAgent({
    llm,
    tools,
    checkpointSaver: new MemorySaver(),
    stateModifier: new SystemMessage(SYSTEM_PROMPT)
  })

  try {
    const result = await agent.invoke(
      { messages: [...history, newUserMsg] },
      { configurable: { thread_id: String(threadId) }, recursionLimit: 20 }
    )

    const allMsgs = result.messages as BaseMessage[]
    const newMsgs = allMsgs.slice(history.length)
    await saveMessages(db, threadId, newMsgs)

    const final = allMsgs[allMsgs.length - 1]
    const reply = typeof final.content === 'string' ? final.content : JSON.stringify(final.content)

    const actions = await db.prepare(
      `SELECT tool_name, args, result, success, created_at FROM admin_agent_actions
       WHERE thread_id = ? ORDER BY id DESC LIMIT 20`
    ).bind(threadId).all<any>()

    return c.json({ thread_id: threadId, reply, actions: actions.results })
  } catch (err: any) {
    console.error('[Admin Agent] Error:', err)
    return c.json({ thread_id: threadId, reply: `Error: ${err.message}`, actions: [] }, 500)
  }
})

// ── GET /threads ─────────────────────────────────────────────────
adminAgentRoutes.get('/threads', async (c) => {
  const adminId = c.get('adminId' as any) as number
  const r = await c.env.DB.prepare(
    `SELECT id, title, created_at, updated_at FROM admin_agent_threads
     WHERE admin_user_id = ? ORDER BY updated_at DESC LIMIT 50`
  ).bind(adminId).all()
  return c.json({ threads: r.results })
})

// ── GET /threads/:id ─────────────────────────────────────────────
adminAgentRoutes.get('/threads/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const msgs = await c.env.DB.prepare(
    `SELECT role, content, tool_calls, created_at FROM admin_agent_messages WHERE thread_id = ? ORDER BY id ASC`
  ).bind(id).all()
  return c.json({ thread_id: id, messages: msgs.results })
})

// ── GET /actions — recent audit log ──────────────────────────────
adminAgentRoutes.get('/actions', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT id, thread_id, tool_name, args, success, autonomous, created_at
     FROM admin_agent_actions ORDER BY id DESC LIMIT 100`
  ).all()
  return c.json({ actions: r.results })
})

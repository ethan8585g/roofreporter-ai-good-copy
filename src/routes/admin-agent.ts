import { Hono } from 'hono'

type Bindings = {
  DB: D1Database
  OPENAI_API_KEY: string
  OPENAI_BASE_URL?: string
  [key: string]: any
}

export const adminAgentRoutes = new Hono<{ Bindings: Bindings }>()

adminAgentRoutes.use('/*', async (c, next) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '')
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

const TOOLS = [
  { type: 'function', function: { name: 'query_database', description: 'READ-ONLY SELECT query. Tables: orders, customers, admin_users, settings, blog_posts, reports, invoices, credit_packages, payments, user_activity_log, admin_agent_threads, admin_agent_actions.',
    parameters: { type: 'object', properties: { sql: { type: 'string' }, params: { type: 'array', items: { type: 'string' } } }, required: ['sql'] } } },
  { type: 'function', function: { name: 'update_setting', description: 'Update a site setting. Prices in cents.',
    parameters: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] } } },
  { type: 'function', function: { name: 'create_blog_post', description: 'Create a blog post (default draft).',
    parameters: { type: 'object', properties: { title: { type: 'string' }, slug: { type: 'string' }, content: { type: 'string' }, excerpt: { type: 'string' }, meta_description: { type: 'string' }, category: { type: 'string' }, tags: { type: 'string' }, status: { type: 'string', enum: ['draft', 'published'] } }, required: ['title', 'slug', 'content'] } } },
  { type: 'function', function: { name: 'update_order_status', description: 'Update an order status.',
    parameters: { type: 'object', properties: { order_id: { type: 'number' }, status: { type: 'string', enum: ['pending', 'processing', 'enhancing', 'completed', 'failed', 'cancelled'] }, notes: { type: 'string' } }, required: ['order_id', 'status'] } } },
  { type: 'function', function: { name: 'send_announcement', description: 'Create/update the site-wide announcement banner.',
    parameters: { type: 'object', properties: { message: { type: 'string' }, type: { type: 'string', enum: ['info', 'warning', 'success', 'promo'] }, active: { type: 'boolean' }, link_url: { type: 'string' }, link_text: { type: 'string' } }, required: ['message', 'type', 'active'] } } },
  { type: 'function', function: { name: 'manage_customer', description: 'Add credits or toggle active status for a customer.',
    parameters: { type: 'object', properties: { customer_id: { type: 'number' }, action: { type: 'string', enum: ['add_credits', 'toggle_active'] }, credits: { type: 'number' } }, required: ['customer_id', 'action'] } } },
  { type: 'function', function: { name: 'get_dashboard_stats', description: 'Dashboard stats for a period.',
    parameters: { type: 'object', properties: { period: { type: 'string', enum: ['today', 'this_week', 'this_month', 'all_time'] } }, required: ['period'] } } }
]

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
        const r = await db.prepare(`INSERT INTO blog_posts (title, slug, content, excerpt, meta_description, category, tags, status, author_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'AI Agent', datetime('now'), datetime('now'))`).bind(args.title, args.slug, args.content, args.excerpt || '', args.meta_description || '', args.category || 'general', args.tags || '', args.status || 'draft').run()
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
        if (args.action === 'add_credits') await db.prepare(`UPDATE customers SET credits_remaining = credits_remaining + ?, updated_at = datetime('now') WHERE id = ?`).bind(args.credits || 0, args.customer_id).run()
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

adminAgentRoutes.post('/chat', async (c) => {
  const { message, thread_id } = await c.req.json<{ message: string; thread_id?: number }>()
  if (!message) return c.json({ error: 'No message' }, 400)

  const adminId = c.get('adminId' as any) as number
  const db = c.env.DB
  const apiKey = c.env.OPENAI_API_KEY
  const baseUrl = c.env.OPENAI_BASE_URL || 'https://www.genspark.ai/api/llm_proxy/v1'
  if (!apiKey) return c.json({ reply: 'OPENAI_API_KEY not configured.', actions: [] })

  let threadId = thread_id
  if (!threadId) {
    const r = await db.prepare(`INSERT INTO admin_agent_threads (admin_user_id, title) VALUES (?, ?)`).bind(adminId, message.slice(0, 80)).run()
    threadId = r.meta.last_row_id as number
  }

  // Load history
  const hist = await db.prepare(`SELECT role, content, tool_calls, tool_call_id FROM admin_agent_messages WHERE thread_id = ? ORDER BY id ASC LIMIT 60`).bind(threadId).all<any>()
  const messages: any[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  for (const m of hist.results || []) {
    const msg: any = { role: m.role, content: m.content }
    if (m.tool_calls) msg.tool_calls = JSON.parse(m.tool_calls)
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id
    messages.push(msg)
  }
  messages.push({ role: 'user', content: message })

  // Persist user msg
  await db.prepare(`INSERT INTO admin_agent_messages (thread_id, role, content) VALUES (?, 'user', ?)`).bind(threadId, message).run()

  const actions: any[] = []

  try {
    let round = 0
    while (round < 6) {
      round++
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-5', messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.3, max_tokens: 4096 })
      })
      if (!res.ok) {
        const txt = await res.text()
        console.error('[admin-agent] API error', res.status, txt.slice(0, 500))
        return c.json({ thread_id: threadId, reply: `AI service error ${res.status}: ${txt.slice(0, 400)}`, actions }, 200)
      }
      const data = await res.json() as any
      const msg = data.choices?.[0]?.message
      if (!msg) break

      if (msg.tool_calls?.length) {
        messages.push(msg)
        await db.prepare(`INSERT INTO admin_agent_messages (thread_id, role, content, tool_calls) VALUES (?, 'assistant', ?, ?)`).bind(threadId, msg.content || '', JSON.stringify(msg.tool_calls)).run()

        for (const tc of msg.tool_calls) {
          let args: any = {}
          try { args = JSON.parse(tc.function.arguments) } catch {}
          const r = await executeTool(tc.function.name, args, db)
          actions.push({ tool: tc.function.name, args, ...r })
          try {
            await db.prepare(`INSERT INTO admin_agent_actions (thread_id, admin_user_id, tool_name, args, result, success) VALUES (?, ?, ?, ?, ?, ?)`).bind(threadId, adminId, tc.function.name, JSON.stringify(args), JSON.stringify(r).slice(0, 4000), r.success ? 1 : 0).run()
          } catch {}
          const toolContent = JSON.stringify(r).slice(0, 6000)
          messages.push({ role: 'tool', tool_call_id: tc.id, content: toolContent })
          await db.prepare(`INSERT INTO admin_agent_messages (thread_id, role, content, tool_call_id) VALUES (?, 'tool', ?, ?)`).bind(threadId, toolContent, tc.id).run()
        }
        continue
      }

      const reply = msg.content || '(no reply)'
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
  const r = await c.env.DB.prepare(`SELECT id, title, created_at, updated_at FROM admin_agent_threads WHERE admin_user_id = ? ORDER BY updated_at DESC LIMIT 50`).bind(adminId).all()
  return c.json({ threads: r.results })
})

adminAgentRoutes.get('/threads/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const msgs = await c.env.DB.prepare(`SELECT role, content, tool_calls, created_at FROM admin_agent_messages WHERE thread_id = ? ORDER BY id ASC`).bind(id).all()
  return c.json({ thread_id: id, messages: msgs.results })
})

adminAgentRoutes.get('/actions', async (c) => {
  const r = await c.env.DB.prepare(`SELECT id, thread_id, tool_name, args, success, autonomous, created_at FROM admin_agent_actions ORDER BY id DESC LIMIT 100`).all()
  return c.json({ actions: r.results })
})

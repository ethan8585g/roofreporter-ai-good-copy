import { Hono } from 'hono'
import { logAdminToolCall } from '../lib/audit-log'
import { limitByKey, clientIp } from '../lib/rate-limit'
import { getAdminSessionToken } from '../lib/session-tokens'

type Bindings = {
  DB: D1Database
  OPENAI_API_KEY: string
  OPENAI_BASE_URL: string
  [key: string]: any
}

export const aiAdminChatRoutes = new Hono<{ Bindings: Bindings }>()

// P0-08: allowlist of setting keys this tool may touch. Pricing and feature
// flags are intentionally excluded — those changes must go through an explicit
// admin UI, not a chat-driven tool call.
const ALLOWED_SETTING_KEYS = new Set<string>([
  'company_name', 'company_email', 'company_phone',
  'landing_hero_title', 'landing_hero_subtitle', 'landing_cta_text',
  'report_header_text', 'report_footer_text',
  'announcement_banner',
])

// P0-08: tools that mutate state require per-admin rate limiting.
const MUTATION_TOOLS = new Set<string>([
  'update_setting', 'create_blog_post', 'update_blog_post',
  'update_order_status', 'update_site_content', 'manage_credit_package',
  'send_announcement', 'manage_customer', 'generate_report_content',
])
const CREDIT_GRANT_TOOLS = new Set<string>(['manage_customer'])

// ── Auth middleware — superadmin only ──────────────────────────────
aiAdminChatRoutes.use('/*', async (c, next) => {
  const token = getAdminSessionToken(c)
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  const session = await c.env.DB.prepare(
    `SELECT s.*, a.email, a.name, a.role FROM admin_sessions s JOIN admin_users a ON s.admin_id = a.id WHERE s.session_token = ? AND s.expires_at > datetime('now')`
  ).bind(token).first<any>()
  if (!session || session.role !== 'superadmin') return c.json({ error: 'Forbidden' }, 403)
  c.set('adminId' as any, session.admin_id)
  c.set('adminName' as any, session.name || session.email)
  c.set('adminEmail' as any, session.email)
  await next()
})

// ── Tool definitions for the AI ───────────────────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'query_database',
      description: 'Run a READ-ONLY SQL query on the database. Use this to look up orders, users, customers, settings, blog posts, invoices, reports, secretary configs, CRM data, etc. NEVER use INSERT/UPDATE/DELETE here — use the specific mutation tools instead.',
      parameters: {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'A SELECT SQL query. Tables: orders, customers, admin_users, settings, blog_posts, reports, invoices, invoice_items, crm_customers, crm_invoices, crm_jobs, crm_proposals, secretary_config, rover_conversations, credit_packages, payments, square_payments, user_activity_log' },
          params: { type: 'array', items: { type: 'string' }, description: 'Bind parameters for the query' }
        },
        required: ['sql']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_setting',
      description: 'Update a site setting in the settings table. Use for pricing, company info, feature flags, etc. Settings keys include: price_per_report_cents, secretary_monthly_price_cents, secretary_per_call_price_cents, subscription_monthly_price_cents, subscription_annual_price_cents, free_trial_reports, subscription_features, company_name, company_email, company_phone, landing_hero_title, landing_hero_subtitle, landing_cta_text, report_header_text, report_footer_text, etc.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The setting key' },
          value: { type: 'string', description: 'The new value' }
        },
        required: ['key', 'value']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_blog_post',
      description: 'Create a new blog post. The post will be saved as a draft by default.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Blog post title' },
          slug: { type: 'string', description: 'URL-friendly slug (e.g. my-blog-post)' },
          content: { type: 'string', description: 'Full HTML content of the blog post' },
          excerpt: { type: 'string', description: 'Short excerpt/summary (1-2 sentences)' },
          meta_description: { type: 'string', description: 'SEO meta description' },
          category: { type: 'string', description: 'Post category' },
          tags: { type: 'string', description: 'Comma-separated tags' },
          status: { type: 'string', enum: ['draft', 'published'], description: 'Post status. Default: draft' }
        },
        required: ['title', 'slug', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_blog_post',
      description: 'Update an existing blog post by ID.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Blog post ID' },
          title: { type: 'string' },
          content: { type: 'string' },
          excerpt: { type: 'string' },
          meta_description: { type: 'string' },
          category: { type: 'string' },
          tags: { type: 'string' },
          status: { type: 'string', enum: ['draft', 'published'] }
        },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_order_status',
      description: 'Update the status of an order.',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'number', description: 'The order ID' },
          status: { type: 'string', enum: ['pending', 'processing', 'enhancing', 'completed', 'failed', 'cancelled'], description: 'New status' },
          notes: { type: 'string', description: 'Optional notes about the status change' }
        },
        required: ['order_id', 'status']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_site_content',
      description: 'Update dynamic site content blocks stored in the site_content table. This controls what appears on the frontend pages (landing page, about page, pricing page, etc.). Content types: hero_title, hero_subtitle, hero_cta, about_text, pricing_header, testimonial, feature_highlight, footer_text, announcement_banner, etc.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'string', description: 'Page identifier: landing, about, pricing, reports, dashboard' },
          section: { type: 'string', description: 'Section identifier: hero, features, testimonials, cta, footer, announcement' },
          content: { type: 'string', description: 'HTML content for this section' },
          title: { type: 'string', description: 'Optional title/heading for this section' }
        },
        required: ['page', 'section', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'manage_credit_package',
      description: 'Create or update a credit/pricing package.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'update'], description: 'Create new or update existing' },
          id: { type: 'number', description: 'Package ID (required for update)' },
          name: { type: 'string', description: 'Package name' },
          credits: { type: 'number', description: 'Number of credits/reports included' },
          price_cents: { type: 'number', description: 'Price in cents' },
          description: { type: 'string', description: 'Package description' },
          is_active: { type: 'boolean', description: 'Whether the package is active' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'send_announcement',
      description: 'Create a site-wide announcement banner that appears on all pages.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Announcement text' },
          type: { type: 'string', enum: ['info', 'warning', 'success', 'promo'], description: 'Banner type/style' },
          active: { type: 'boolean', description: 'Whether to show or hide the banner' },
          link_url: { type: 'string', description: 'Optional CTA link URL' },
          link_text: { type: 'string', description: 'Optional CTA link text' }
        },
        required: ['message', 'type', 'active']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'manage_customer',
      description: 'Update customer details or credits.',
      parameters: {
        type: 'object',
        properties: {
          customer_id: { type: 'number', description: 'Customer ID' },
          action: { type: 'string', enum: ['add_credits', 'update_info', 'toggle_active'], description: 'Action to perform' },
          credits: { type: 'number', description: 'Credits to add (for add_credits action)' },
          name: { type: 'string' },
          email: { type: 'string' },
          company_name: { type: 'string' },
          phone: { type: 'string' }
        },
        required: ['customer_id', 'action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'generate_report_content',
      description: 'Generate or update content for a roofing report. Can update report text sections like executive summary, recommendations, condition assessment, etc.',
      parameters: {
        type: 'object',
        properties: {
          report_id: { type: 'number', description: 'Report ID to update' },
          section: { type: 'string', enum: ['executive_summary', 'condition_assessment', 'recommendations', 'materials_assessment', 'cost_estimate_notes'], description: 'Which report section to update' },
          content: { type: 'string', description: 'New content for this section' }
        },
        required: ['report_id', 'section', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_dashboard_stats',
      description: 'Get real-time dashboard statistics including order counts, revenue, customer counts, recent activity, etc.',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['today', 'this_week', 'this_month', 'all_time'], description: 'Time period for stats' }
        },
        required: ['period']
      }
    }
  }
]

// ── Tool execution functions ──────────────────────────────────────

async function executeTool(toolName: string, args: any, db: D1Database): Promise<{ result: any; success: boolean; message: string }> {
  try {
    switch (toolName) {

      case 'query_database': {
        const sql = (args.sql || '').trim()
        // Security: Only allow SELECT queries
        if (!/^SELECT\s/i.test(sql)) {
          return { result: null, success: false, message: 'Only SELECT queries are allowed. Use specific tools for mutations.' }
        }
        // Block dangerous patterns
        if (/DROP|ALTER|TRUNCATE|CREATE|INSERT|UPDATE|DELETE|PRAGMA/i.test(sql)) {
          return { result: null, success: false, message: 'Unsafe SQL detected. Only SELECT queries are allowed.' }
        }
        const params = args.params || []
        const stmt = db.prepare(sql)
        const bound = params.length > 0 ? stmt.bind(...params) : stmt
        const result = await bound.all()
        return { result: result.results?.slice(0, 50), success: true, message: `Query returned ${result.results?.length || 0} rows` }
      }

      case 'update_setting': {
        // P0-08: refuse keys outside the allowlist. Price/feature-flag changes
        // must go through an explicit admin UI.
        if (!ALLOWED_SETTING_KEYS.has(args.key)) {
          return { result: null, success: false, message: `Setting key "${args.key}" is not allowed via chat. Use the admin Settings UI.` }
        }
        const existing = await db.prepare(
          `SELECT id FROM settings WHERE master_company_id = 1 AND setting_key = ?`
        ).bind(args.key).first<any>()
        if (existing) {
          await db.prepare(
            `UPDATE settings SET setting_value = ?, updated_at = datetime('now') WHERE master_company_id = 1 AND setting_key = ?`
          ).bind(args.value, args.key).run()
        } else {
          await db.prepare(
            `INSERT INTO settings (master_company_id, setting_key, setting_value, is_encrypted) VALUES (1, ?, ?, 0)`
          ).bind(args.key, args.value).run()
        }
        return { result: { key: args.key, value: args.value }, success: true, message: `Setting "${args.key}" updated to "${args.value}"` }
      }

      case 'create_blog_post': {
        const result = await db.prepare(`
          INSERT INTO blog_posts (title, slug, content, excerpt, meta_description, category, tags, status, author_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'AI Admin', datetime('now'), datetime('now'))
        `).bind(
          args.title, args.slug, args.content,
          args.excerpt || '', args.meta_description || '',
          args.category || 'general', args.tags || '',
          args.status || 'draft'
        ).run()
        return { result: { id: result.meta.last_row_id, title: args.title, slug: args.slug, status: args.status || 'draft' }, success: true, message: `Blog post "${args.title}" created as ${args.status || 'draft'}` }
      }

      case 'update_blog_post': {
        const sets: string[] = []
        const vals: any[] = []
        for (const field of ['title', 'content', 'excerpt', 'meta_description', 'category', 'tags', 'status']) {
          if (args[field] !== undefined) {
            sets.push(`${field} = ?`)
            vals.push(args[field])
          }
        }
        if (sets.length === 0) return { result: null, success: false, message: 'No fields to update' }
        sets.push(`updated_at = datetime('now')`)
        vals.push(args.id)
        await db.prepare(`UPDATE blog_posts SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
        return { result: { id: args.id }, success: true, message: `Blog post #${args.id} updated` }
      }

      case 'update_order_status': {
        await db.prepare(
          `UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`
        ).bind(args.status, args.order_id).run()
        if (args.notes) {
          await db.prepare(
            `INSERT INTO user_activity_log (action, details, created_at) VALUES ('order_status_change', ?, datetime('now'))`
          ).bind(JSON.stringify({ order_id: args.order_id, new_status: args.status, notes: args.notes, source: 'ai_admin' })).run()
        }
        return { result: { order_id: args.order_id, status: args.status }, success: true, message: `Order #${args.order_id} status updated to "${args.status}"` }
      }

      case 'update_site_content': {
        const existing = await db.prepare(
          `SELECT id FROM settings WHERE master_company_id = 1 AND setting_key = ?`
        ).bind(`content_${args.page}_${args.section}`).first<any>()
        const contentValue = JSON.stringify({ title: args.title || '', content: args.content, updated_by: 'ai_admin', updated_at: new Date().toISOString() })
        if (existing) {
          await db.prepare(
            `UPDATE settings SET setting_value = ?, updated_at = datetime('now') WHERE master_company_id = 1 AND setting_key = ?`
          ).bind(contentValue, `content_${args.page}_${args.section}`).run()
        } else {
          await db.prepare(
            `INSERT INTO settings (master_company_id, setting_key, setting_value, is_encrypted) VALUES (1, ?, ?, 0)`
          ).bind(`content_${args.page}_${args.section}`, contentValue).run()
        }
        return { result: { page: args.page, section: args.section }, success: true, message: `Site content for ${args.page}/${args.section} updated` }
      }

      case 'manage_credit_package': {
        if (args.action === 'create') {
          const result = await db.prepare(`
            INSERT INTO credit_packages (name, credits, price_cents, description, is_active, created_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
          `).bind(args.name || 'New Package', args.credits || 1, args.price_cents || 0, args.description || '', args.is_active !== false ? 1 : 0).run()
          return { result: { id: result.meta.last_row_id }, success: true, message: `Credit package "${args.name}" created` }
        } else {
          const sets: string[] = []
          const vals: any[] = []
          for (const field of ['name', 'credits', 'price_cents', 'description']) {
            if (args[field] !== undefined) { sets.push(`${field} = ?`); vals.push(args[field]) }
          }
          if (args.is_active !== undefined) { sets.push(`is_active = ?`); vals.push(args.is_active ? 1 : 0) }
          if (sets.length === 0) return { result: null, success: false, message: 'No fields to update' }
          vals.push(args.id)
          await db.prepare(`UPDATE credit_packages SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
          return { result: { id: args.id }, success: true, message: `Credit package #${args.id} updated` }
        }
      }

      case 'send_announcement': {
        const announcementData = JSON.stringify({
          message: args.message,
          type: args.type,
          active: args.active,
          link_url: args.link_url || '',
          link_text: args.link_text || '',
          updated_at: new Date().toISOString()
        })
        const existing = await db.prepare(
          `SELECT id FROM settings WHERE master_company_id = 1 AND setting_key = 'announcement_banner'`
        ).first<any>()
        if (existing) {
          await db.prepare(
            `UPDATE settings SET setting_value = ?, updated_at = datetime('now') WHERE master_company_id = 1 AND setting_key = 'announcement_banner'`
          ).bind(announcementData).run()
        } else {
          await db.prepare(
            `INSERT INTO settings (master_company_id, setting_key, setting_value, is_encrypted) VALUES (1, 'announcement_banner', ?, 0)`
          ).bind(announcementData).run()
        }
        return { result: { active: args.active, message: args.message }, success: true, message: args.active ? `Announcement banner activated: "${args.message}"` : 'Announcement banner deactivated' }
      }

      case 'manage_customer': {
        if (args.action === 'add_credits') {
          await db.prepare(
            `UPDATE customers SET credits_remaining = credits_remaining + ?, updated_at = datetime('now') WHERE id = ?`
          ).bind(args.credits || 0, args.customer_id).run()
          return { result: { customer_id: args.customer_id, credits_added: args.credits }, success: true, message: `Added ${args.credits} credits to customer #${args.customer_id}` }
        } else if (args.action === 'update_info') {
          const sets: string[] = []
          const vals: any[] = []
          for (const field of ['name', 'email', 'company_name', 'phone']) {
            if (args[field]) { sets.push(`${field} = ?`); vals.push(args[field]) }
          }
          if (sets.length === 0) return { result: null, success: false, message: 'No fields to update' }
          sets.push(`updated_at = datetime('now')`)
          vals.push(args.customer_id)
          await db.prepare(`UPDATE customers SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
          return { result: { customer_id: args.customer_id }, success: true, message: `Customer #${args.customer_id} info updated` }
        } else if (args.action === 'toggle_active') {
          await db.prepare(
            `UPDATE customers SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END, updated_at = datetime('now') WHERE id = ?`
          ).bind(args.customer_id).run()
          return { result: { customer_id: args.customer_id }, success: true, message: `Customer #${args.customer_id} active status toggled` }
        }
        return { result: null, success: false, message: 'Unknown action' }
      }

      case 'generate_report_content': {
        const column = args.section === 'executive_summary' ? 'executive_summary' :
                       args.section === 'condition_assessment' ? 'condition_assessment' :
                       args.section === 'recommendations' ? 'recommendations' :
                       args.section === 'materials_assessment' ? 'materials_assessment' :
                       args.section === 'cost_estimate_notes' ? 'cost_estimate_notes' : null
        if (!column) return { result: null, success: false, message: 'Invalid report section' }
        await db.prepare(
          `UPDATE reports SET ${column} = ?, updated_at = datetime('now') WHERE id = ?`
        ).bind(args.content, args.report_id).run()
        return { result: { report_id: args.report_id, section: args.section }, success: true, message: `Report #${args.report_id} section "${args.section}" updated` }
      }

      case 'get_dashboard_stats': {
        const period = args.period || 'all_time'
        let dateFilter = ''
        if (period === 'today') dateFilter = `AND date(created_at) = date('now')`
        else if (period === 'this_week') dateFilter = `AND created_at >= datetime('now', '-7 days')`
        else if (period === 'this_month') dateFilter = `AND created_at >= datetime('now', '-30 days')`

        const [orders, customers, revenue, recentOrders] = await Promise.all([
          db.prepare(`SELECT COUNT(*) as count, status FROM orders WHERE 1=1 ${dateFilter} GROUP BY status`).all(),
          db.prepare(`SELECT COUNT(*) as count FROM customers WHERE 1=1 ${dateFilter}`).first<any>(),
          db.prepare(`SELECT SUM(amount_cents) as total FROM payments WHERE status = 'completed' ${dateFilter}`).first<any>(),
          db.prepare(`SELECT id, address, status, tier, created_at FROM orders ORDER BY created_at DESC LIMIT 5`).all()
        ])

        return {
          result: {
            period,
            orders_by_status: orders.results,
            total_customers: customers?.count || 0,
            total_revenue_cents: revenue?.total || 0,
            total_revenue_dollars: ((revenue?.total || 0) / 100).toFixed(2),
            recent_orders: recentOrders.results
          },
          success: true,
          message: `Dashboard stats for ${period}`
        }
      }

      default:
        return { result: null, success: false, message: `Unknown tool: ${toolName}` }
    }
  } catch (err: any) {
    return { result: null, success: false, message: `Error: ${err.message}` }
  }
}

// ── System prompt ─────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the **Roof Manager Admin Assistant** — an intelligent AI built into the admin control panel. You help the site administrator manage and modify the Roof Manager platform.

**Your Capabilities:**
1. **Database Queries** — Look up any data: orders, customers, reports, blog posts, invoices, settings, CRM data, payments, secretary configs
2. **Settings Management** — Update pricing, company info, feature flags, report templates
3. **Blog Management** — Create and edit blog posts with full HTML content, SEO metadata
4. **Order Management** — View and update order statuses
5. **Site Content** — Update landing page text, hero sections, CTAs, announcement banners
6. **Customer Management** — Add credits, update info, toggle active status
7. **Report Content** — Update report text sections (executive summary, recommendations, etc.)
8. **Credit Packages** — Create and manage pricing/credit packages
9. **Announcements** — Create site-wide banner announcements
10. **Analytics** — Get real-time dashboard statistics

**Important Rules:**
- When the user asks about data, ALWAYS use query_database first to look it up
- When making changes, confirm what you're about to do and then execute
- For content/text changes, generate professional, well-written content
- Always report back what actions you took and their results
- If you're unsure about something, ask for clarification
- For pricing, values are stored in CENTS (e.g., $49.00 = 4900 cents)
- You can chain multiple tool calls to accomplish complex tasks
- Be concise but thorough in your responses

**Database Tables (key ones):**
- orders: id, address, status, tier, payment_status, created_at
- customers: id, email, name, company_name, phone, credits_remaining, is_active
- settings: setting_key, setting_value, master_company_id
- blog_posts: id, title, slug, content, status, category, tags
- reports: id, order_id, executive_summary, condition_assessment, recommendations
- invoices, invoice_items: customer invoicing
- crm_customers, crm_invoices, crm_jobs, crm_proposals: CRM module
- secretary_config: AI secretary settings per customer
- payments, square_payments: payment records
- credit_packages: pricing packages

You are speaking with the site administrator. Be helpful, proactive, and efficient.`

// ── Chat endpoint (streaming) ─────────────────────────────────────
aiAdminChatRoutes.post('/chat', async (c) => {
  const { messages, conversation_id } = await c.req.json<{ messages: Array<{ role: string; content: string }>; conversation_id?: string }>()

  if (!messages || messages.length === 0) {
    return c.json({ error: 'No messages provided' }, 400)
  }

  const apiKey = c.env.OPENAI_API_KEY
  const baseUrl = c.env.OPENAI_BASE_URL || 'https://www.genspark.ai/api/llm_proxy/v1'

  if (!apiKey) {
    return c.json({
      reply: "I'm sorry, but the AI service isn't configured yet. Please add your OPENAI_API_KEY in the Cloudflare dashboard environment variables or .dev.vars file.",
      actions: []
    })
  }

  const fullMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages.slice(-20) // Keep last 20 messages for context
  ]

  const actions: Array<{ tool: string; args: any; result: any; success: boolean; message: string }> = []

  try {
    // Initial AI call
    let response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5',
        messages: fullMessages,
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.7,
        max_tokens: 4096
      })
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('[AI Admin Chat] API error:', response.status, errText)
      return c.json({
        reply: `AI service error (${response.status}). Please try again.`,
        actions: []
      })
    }

    let data = await response.json() as any
    let assistantMessage = data.choices?.[0]?.message

    // Tool calling loop (max 5 rounds)
    let round = 0
    while (assistantMessage?.tool_calls && round < 5) {
      round++
      fullMessages.push(assistantMessage)

      // Execute all tool calls
      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function.name
        let toolArgs: any
        try {
          toolArgs = JSON.parse(toolCall.function.arguments)
        } catch {
          toolArgs = {}
        }

        const adminId = c.get('adminId' as any) as number
        const adminEmail = c.get('adminEmail' as any) as string | undefined

        // P0-08: rate limits. 10 mutations / hour / admin; 1 credit-grant / day.
        if (MUTATION_TOOLS.has(toolName)) {
          const rl = await limitByKey(c, 'ai-admin-mut', `admin:${adminId}`, 10, 3600)
          if (!rl.ok) {
            const toolResult = { result: null, success: false, message: `Rate limit: too many mutations this hour. Try again in ${rl.resetSeconds}s.` }
            await logAdminToolCall(c.env.DB, { admin: { id: adminId, email: adminEmail }, tool: toolName, args: toolArgs, result: 'denied', ip: clientIp(c), error: 'rate_limit_mutations' })
            actions.push({ tool: toolName, args: toolArgs, ...toolResult })
            fullMessages.push({ role: 'tool', content: JSON.stringify(toolResult), tool_call_id: toolCall.id } as any)
            continue
          }
        }
        if (CREDIT_GRANT_TOOLS.has(toolName) && toolArgs?.action === 'add_credits') {
          const rl = await limitByKey(c, 'ai-admin-credit', `admin:${adminId}`, 1, 86400)
          if (!rl.ok) {
            const toolResult = { result: null, success: false, message: `Rate limit: only one credit grant per day via chat. Try again in ${rl.resetSeconds}s.` }
            await logAdminToolCall(c.env.DB, { admin: { id: adminId, email: adminEmail }, tool: toolName, args: toolArgs, result: 'denied', ip: clientIp(c), error: 'rate_limit_credit' })
            actions.push({ tool: toolName, args: toolArgs, ...toolResult })
            fullMessages.push({ role: 'tool', content: JSON.stringify(toolResult), tool_call_id: toolCall.id } as any)
            continue
          }
        }

        console.log(`[AI Admin Chat] Executing tool: ${toolName}`, JSON.stringify(toolArgs).slice(0, 200))
        const toolResult = await executeTool(toolName, toolArgs, c.env.DB)
        actions.push({ tool: toolName, args: toolArgs, ...toolResult })

        // P0-08: persist every tool call to admin_tool_audit.
        await logAdminToolCall(c.env.DB, {
          admin: { id: adminId, email: adminEmail },
          tool: toolName,
          args: toolArgs,
          result: toolResult.success ? 'ok' : 'error',
          ip: clientIp(c),
          error: toolResult.success ? undefined : toolResult.message,
        })

        fullMessages.push({
          role: 'tool',
          content: JSON.stringify(toolResult),
          tool_call_id: toolCall.id
        } as any)
      }

      // Call AI again with tool results
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'gpt-5',
          messages: fullMessages,
          tools: TOOLS,
          tool_choice: 'auto',
          temperature: 0.7,
          max_tokens: 4096
        })
      })

      if (!response.ok) break
      data = await response.json() as any
      assistantMessage = data.choices?.[0]?.message
    }

    const reply = assistantMessage?.content || 'I completed the requested actions. Check the results above.'

    // Log the interaction
    try {
      await c.env.DB.prepare(
        `INSERT INTO user_activity_log (action, details, created_at) VALUES ('ai_admin_chat', ?, datetime('now'))`
      ).bind(JSON.stringify({
        admin_id: c.get('adminId' as any),
        user_message: messages[messages.length - 1]?.content?.slice(0, 200),
        actions_taken: actions.map(a => a.tool),
        actions_count: actions.length
      })).run()
    } catch {}

    return c.json({ reply, actions })

  } catch (err: any) {
    console.error('[AI Admin Chat] Error:', err)
    return c.json({
      reply: `Sorry, I encountered an error: ${err.message}. Please try again.`,
      actions: []
    })
  }
})

// ── GET /capabilities — List what the AI can do ───────────────────
aiAdminChatRoutes.get('/capabilities', async (c) => {
  return c.json({
    tools: TOOLS.map(t => ({
      name: t.function.name,
      description: t.function.description
    })),
    model: 'gpt-5',
    max_rounds: 5,
    features: [
      'Database queries (read-only)',
      'Site settings management',
      'Blog post creation & editing',
      'Order status management',
      'Dynamic site content editing',
      'Credit package management',
      'Announcement banners',
      'Customer management',
      'Report content editing',
      'Dashboard analytics'
    ]
  })
})

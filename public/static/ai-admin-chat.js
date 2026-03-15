// ═══════════════════════════════════════════════════════════════════
// AI Admin Chat — Intelligent Admin Assistant
// ═══════════════════════════════════════════════════════════════════

const AIChat = {
  messages: [],
  input: '',
  loading: false,
  expanded: false,
  capabilities: null,
  conversationId: null,
}

function adminHeaders() {
  const token = localStorage.getItem('rc_token')
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
}

// ── Render the AI Chat tab ────────────────────────────────────────
function renderAIChat() {
  return `
  <div class="max-w-5xl mx-auto">
    <!-- Header -->
    <div class="bg-gradient-to-r from-purple-700 via-indigo-700 to-blue-700 rounded-2xl p-6 mb-6 shadow-xl text-white relative overflow-hidden">
      <div class="absolute inset-0 opacity-10">
        <div class="absolute top-4 right-4 w-32 h-32 bg-white rounded-full blur-3xl"></div>
        <div class="absolute bottom-4 left-4 w-24 h-24 bg-purple-300 rounded-full blur-3xl"></div>
      </div>
      <div class="relative z-10 flex items-center justify-between">
        <div>
          <div class="flex items-center gap-3 mb-2">
            <div class="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
              <i class="fas fa-brain text-2xl text-purple-200"></i>
            </div>
            <div>
              <h2 class="text-2xl font-bold">AI Site Manager</h2>
              <p class="text-purple-200 text-sm">Your intelligent admin assistant — ask me to do anything</p>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <span class="px-3 py-1 bg-green-500/20 border border-green-400/30 text-green-300 rounded-full text-xs font-semibold">
            <i class="fas fa-circle text-[8px] mr-1 animate-pulse"></i>Online
          </span>
          <button onclick="aiChatLoadCapabilities()" class="px-3 py-1 bg-white/10 hover:bg-white/20 rounded-lg text-xs transition-all" title="View capabilities">
            <i class="fas fa-info-circle mr-1"></i>What can I do?
          </button>
          <button onclick="aiChatClear()" class="px-3 py-1 bg-white/10 hover:bg-white/20 rounded-lg text-xs transition-all" title="Clear chat">
            <i class="fas fa-trash mr-1"></i>Clear
          </button>
        </div>
      </div>
    </div>

    <!-- Capabilities Panel (hidden by default) -->
    <div id="ai-capabilities-panel" class="hidden mb-6">
      <div class="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-bold text-gray-800"><i class="fas fa-tools mr-2 text-purple-600"></i>AI Capabilities</h3>
          <button onclick="document.getElementById('ai-capabilities-panel').classList.add('hidden')" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>
        </div>
        <div id="ai-capabilities-list" class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div class="text-gray-500 text-sm">Loading capabilities...</div>
        </div>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      ${[
        { icon: 'fa-chart-bar', label: 'Dashboard Stats', prompt: 'Show me today\'s dashboard stats — orders, revenue, new customers' },
        { icon: 'fa-blog', label: 'Write Blog Post', prompt: 'Write a professional blog post about the benefits of AI-powered roof inspections for commercial properties' },
        { icon: 'fa-dollar-sign', label: 'View Pricing', prompt: 'Show me all current pricing packages and settings' },
        { icon: 'fa-bullhorn', label: 'Create Banner', prompt: 'Create a promotional announcement banner: "Spring Special — 25% off all roof reports this month!"' },
        { icon: 'fa-users', label: 'Recent Customers', prompt: 'Show me the 10 most recent customers with their order counts and credits' },
        { icon: 'fa-file-alt', label: 'Recent Orders', prompt: 'Show me the 10 most recent orders with their status and addresses' },
        { icon: 'fa-edit', label: 'Update Landing', prompt: 'Update the landing page hero section with compelling new copy for our AI-powered roofing reports service' },
        { icon: 'fa-cog', label: 'Site Settings', prompt: 'Show me all current site settings and configurations' }
      ].map(a => `
        <button onclick="aiChatQuickAction('${a.prompt.replace(/'/g, "\\'")}')" class="bg-white hover:bg-gray-50 border border-gray-200 hover:border-purple-300 rounded-xl p-3 text-left transition-all group shadow-sm">
          <i class="fas ${a.icon} text-purple-500 group-hover:text-purple-600 mb-1 text-lg"></i>
          <div class="text-xs font-semibold text-gray-700 group-hover:text-purple-700">${a.label}</div>
        </button>
      `).join('')}
    </div>

    <!-- Chat Container -->
    <div class="bg-white rounded-2xl border border-gray-200 shadow-lg overflow-hidden flex flex-col" style="height: 600px;">
      <!-- Messages Area -->
      <div id="ai-chat-messages" class="flex-1 overflow-y-auto p-6 space-y-4" style="scroll-behavior: smooth;">
        ${AIChat.messages.length === 0 ? `
          <div class="text-center py-16">
            <div class="w-20 h-20 bg-gradient-to-br from-purple-100 to-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <i class="fas fa-robot text-3xl text-purple-500"></i>
            </div>
            <h3 class="text-lg font-bold text-gray-700 mb-2">Hi! I'm your AI Site Manager</h3>
            <p class="text-gray-500 text-sm max-w-md mx-auto mb-4">I can make real changes to your site — update content, manage orders, write blog posts, change pricing, view analytics, and more. Just ask!</p>
            <div class="flex flex-wrap gap-2 justify-center">
              ${['Show me today\'s stats', 'Create a blog post', 'Update pricing', 'View recent orders'].map(s => `
                <button onclick="aiChatQuickAction('${s.replace(/'/g, "\\'")}')" class="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg text-xs font-medium transition-all">${s}</button>
              `).join('')}
            </div>
          </div>
        ` : AIChat.messages.map((m, i) => renderChatMessage(m, i)).join('')}
      </div>

      <!-- Input Area -->
      <div class="border-t border-gray-200 bg-gray-50 p-4">
        <div class="flex gap-3">
          <div class="flex-1 relative">
            <textarea
              id="ai-chat-input"
              rows="2"
              class="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none text-sm"
              placeholder="Ask me anything — update content, check stats, write blog posts, manage orders..."
              onkeydown="if(event.key==='Enter' && !event.shiftKey){event.preventDefault(); aiChatSend()}"
              ${AIChat.loading ? 'disabled' : ''}
            ></textarea>
          </div>
          <button
            onclick="aiChatSend()"
            class="px-6 py-3 rounded-xl font-semibold text-sm transition-all shadow-sm ${AIChat.loading ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white'}"
            ${AIChat.loading ? 'disabled' : ''}
          >
            ${AIChat.loading ? '<i class="fas fa-spinner fa-spin mr-1"></i>Thinking...' : '<i class="fas fa-paper-plane mr-1"></i>Send'}
          </button>
        </div>
        <div class="flex items-center justify-between mt-2">
          <span class="text-[10px] text-gray-400">Press Enter to send, Shift+Enter for new line</span>
          <span class="text-[10px] text-gray-400">${AIChat.messages.length} messages in conversation</span>
        </div>
      </div>
    </div>
  </div>
  `
}

// ── Render a single chat message ──────────────────────────────────
function renderChatMessage(msg, index) {
  if (msg.role === 'user') {
    return `
      <div class="flex justify-end">
        <div class="max-w-[75%] bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-2xl rounded-br-md px-5 py-3 shadow-sm">
          <div class="text-sm whitespace-pre-wrap">${escapeHtml(msg.content)}</div>
          <div class="text-[10px] text-purple-200 mt-1 text-right">${formatTime(msg.timestamp)}</div>
        </div>
      </div>
    `
  }

  // Assistant message
  let actionsHtml = ''
  if (msg.actions && msg.actions.length > 0) {
    actionsHtml = `
      <div class="mt-3 space-y-2">
        <div class="text-xs font-semibold text-gray-500 flex items-center gap-1"><i class="fas fa-bolt text-amber-500"></i>Actions Taken:</div>
        ${msg.actions.map(a => `
          <div class="bg-gray-50 rounded-lg p-2.5 border border-gray-100">
            <div class="flex items-center gap-2">
              <span class="${a.success ? 'text-green-500' : 'text-red-500'}">
                <i class="fas ${a.success ? 'fa-check-circle' : 'fa-times-circle'}"></i>
              </span>
              <span class="text-xs font-mono font-semibold text-gray-700">${a.tool}</span>
              <span class="text-[10px] text-gray-400">${a.message}</span>
            </div>
            ${a.result ? `
              <details class="mt-1">
                <summary class="text-[10px] text-gray-400 cursor-pointer hover:text-gray-600">View details</summary>
                <pre class="mt-1 text-[10px] text-gray-500 bg-white rounded p-2 overflow-x-auto max-h-40">${escapeHtml(JSON.stringify(a.result, null, 2))}</pre>
              </details>
            ` : ''}
          </div>
        `).join('')}
      </div>
    `
  }

  return `
    <div class="flex justify-start">
      <div class="max-w-[80%]">
        <div class="flex items-center gap-2 mb-1">
          <div class="w-7 h-7 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg flex items-center justify-center">
            <i class="fas fa-brain text-white text-xs"></i>
          </div>
          <span class="text-xs font-semibold text-gray-600">AI Site Manager</span>
          <span class="text-[10px] text-gray-400">${formatTime(msg.timestamp)}</span>
        </div>
        <div class="bg-white border border-gray-200 rounded-2xl rounded-tl-md px-5 py-3 shadow-sm">
          <div class="text-sm text-gray-800 prose prose-sm max-w-none ai-response-content">${formatAIResponse(msg.content)}</div>
          ${actionsHtml}
        </div>
      </div>
    </div>
  `
}

// ── Send message ──────────────────────────────────────────────────
async function aiChatSend() {
  const input = document.getElementById('ai-chat-input')
  const message = (input?.value || '').trim()
  if (!message || AIChat.loading) return

  // Add user message
  AIChat.messages.push({ role: 'user', content: message, timestamp: new Date() })
  input.value = ''
  AIChat.loading = true
  renderAIChatUpdate()

  try {
    const apiMessages = AIChat.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content }))

    const res = await fetch('/api/ai-admin/chat', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ messages: apiMessages })
    })

    const data = await res.json()

    if (data.error) {
      AIChat.messages.push({
        role: 'assistant',
        content: `Error: ${data.error}`,
        timestamp: new Date(),
        actions: []
      })
    } else {
      AIChat.messages.push({
        role: 'assistant',
        content: data.reply || 'Done!',
        timestamp: new Date(),
        actions: data.actions || []
      })
    }
  } catch (err) {
    AIChat.messages.push({
      role: 'assistant',
      content: `Connection error: ${err.message}. Please check your connection and try again.`,
      timestamp: new Date(),
      actions: []
    })
  }

  AIChat.loading = false
  renderAIChatUpdate()
}

// ── Quick action ──────────────────────────────────────────────────
function aiChatQuickAction(prompt) {
  const input = document.getElementById('ai-chat-input')
  if (input) {
    input.value = prompt
    aiChatSend()
  }
}

// ── Update chat UI without full re-render ─────────────────────────
function renderAIChatUpdate() {
  const container = document.getElementById('ai-chat-messages')
  if (!container) { if (typeof render === 'function') render(); return }

  if (AIChat.messages.length === 0) return

  // Re-render messages
  container.innerHTML = AIChat.messages.map((m, i) => renderChatMessage(m, i)).join('')

  // Add loading indicator if AI is thinking
  if (AIChat.loading) {
    container.innerHTML += `
      <div class="flex justify-start">
        <div class="flex items-center gap-2">
          <div class="w-7 h-7 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-lg flex items-center justify-center">
            <i class="fas fa-brain text-white text-xs"></i>
          </div>
          <div class="bg-white border border-gray-200 rounded-2xl px-5 py-3 shadow-sm">
            <div class="flex items-center gap-2">
              <div class="flex gap-1">
                <span class="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style="animation-delay:0s"></span>
                <span class="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style="animation-delay:0.15s"></span>
                <span class="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style="animation-delay:0.3s"></span>
              </div>
              <span class="text-xs text-gray-500">Thinking & executing...</span>
            </div>
          </div>
        </div>
      </div>
    `
  }

  // Scroll to bottom
  container.scrollTop = container.scrollHeight

  // Update send button state
  const sendBtn = container.closest('.bg-white')?.querySelector('button[onclick="aiChatSend()"]')
  if (sendBtn) {
    sendBtn.disabled = AIChat.loading
    sendBtn.innerHTML = AIChat.loading
      ? '<i class="fas fa-spinner fa-spin mr-1"></i>Thinking...'
      : '<i class="fas fa-paper-plane mr-1"></i>Send'
    sendBtn.className = `px-6 py-3 rounded-xl font-semibold text-sm transition-all shadow-sm ${AIChat.loading ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white'}`
  }

  // Update textarea state
  const textarea = document.getElementById('ai-chat-input')
  if (textarea) textarea.disabled = AIChat.loading
}

// ── Load capabilities ─────────────────────────────────────────────
async function aiChatLoadCapabilities() {
  const panel = document.getElementById('ai-capabilities-panel')
  const list = document.getElementById('ai-capabilities-list')
  if (!panel || !list) return

  panel.classList.toggle('hidden')
  if (!panel.classList.contains('hidden') && !AIChat.capabilities) {
    list.innerHTML = '<div class="text-gray-400 text-sm"><i class="fas fa-spinner fa-spin mr-1"></i>Loading...</div>'
    try {
      const res = await fetch('/api/ai-admin/capabilities', { headers: adminHeaders() })
      const data = await res.json()
      AIChat.capabilities = data

      const icons = {
        query_database: 'fa-database',
        update_setting: 'fa-cog',
        create_blog_post: 'fa-blog',
        update_blog_post: 'fa-edit',
        update_order_status: 'fa-shopping-cart',
        update_site_content: 'fa-palette',
        manage_credit_package: 'fa-tag',
        send_announcement: 'fa-bullhorn',
        manage_customer: 'fa-users',
        generate_report_content: 'fa-file-alt',
        get_dashboard_stats: 'fa-chart-bar'
      }

      list.innerHTML = data.tools.map(t => `
        <div class="bg-gray-50 rounded-lg p-3 border border-gray-100">
          <div class="flex items-center gap-2 mb-1">
            <i class="fas ${icons[t.name] || 'fa-wrench'} text-purple-500 text-sm"></i>
            <span class="text-xs font-bold text-gray-700">${t.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</span>
          </div>
          <p class="text-[11px] text-gray-500 leading-snug">${t.description.slice(0, 150)}${t.description.length > 150 ? '...' : ''}</p>
        </div>
      `).join('')
    } catch (err) {
      list.innerHTML = `<div class="text-red-500 text-sm">Failed to load capabilities: ${err.message}</div>`
    }
  }
}

// ── Clear chat ────────────────────────────────────────────────────
function aiChatClear() {
  AIChat.messages = []
  AIChat.conversationId = null
  if (typeof render === 'function') render()
}

// ── Helpers ───────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return ''
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function formatTime(date) {
  if (!date) return ''
  const d = new Date(date)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function formatAIResponse(content) {
  if (!content) return ''
  // Convert markdown-like formatting to HTML
  let html = escapeHtml(content)
  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  // Italic
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>')
  // Code blocks
  html = html.replace(/```([\s\S]*?)```/g, '<pre class="bg-gray-50 rounded-lg p-3 text-xs overflow-x-auto my-2 border border-gray-200">$1</pre>')
  // Inline code
  html = html.replace(/`(.*?)`/g, '<code class="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono text-purple-700">$1</code>')
  // Headers
  html = html.replace(/^### (.*?)$/gm, '<h4 class="font-bold text-gray-800 mt-3 mb-1">$1</h4>')
  html = html.replace(/^## (.*?)$/gm, '<h3 class="font-bold text-gray-800 text-lg mt-3 mb-1">$1</h3>')
  // Bullet lists
  html = html.replace(/^[•\-] (.*?)$/gm, '<li class="ml-4 text-gray-700">$1</li>')
  html = html.replace(/(<li.*?<\/li>\n?)+/g, '<ul class="list-disc my-2">$&</ul>')
  // Numbered lists
  html = html.replace(/^\d+\. (.*?)$/gm, '<li class="ml-4 text-gray-700">$1</li>')
  // Line breaks
  html = html.replace(/\n/g, '<br>')
  return html
}

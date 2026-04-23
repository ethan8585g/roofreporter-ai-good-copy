// ============================================================
// ROVER AI ASSISTANT — Authenticated Customer Assistant
// Slide-out panel for logged-in users with full AI capabilities
// Replaces chatbot widget on authenticated pages
// ============================================================

(function() {
  'use strict';

  if (window.__roverAssistantInit) return;
  window.__roverAssistantInit = true;

  // ============================================================
  // STATE
  // ============================================================
  var state = {
    open: false,
    sessionId: null,
    messages: [],
    loading: false,
    customerName: ''
  };

  function getToken() { return localStorage.getItem('rc_customer_token') || ''; }
  function authHeaders() { return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }; }

  // Generate or restore assistant session (persistent per browser session)
  function getSessionId() {
    var sid = sessionStorage.getItem('rover_assistant_sid');
    if (!sid) {
      sid = 'ra_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
      sessionStorage.setItem('rover_assistant_sid', sid);
    }
    return sid;
  }
  state.sessionId = getSessionId();

  // Get customer name from localStorage
  try {
    var cust = JSON.parse(localStorage.getItem('rc_customer') || '{}');
    state.customerName = cust.name || cust.email || '';
  } catch(e) {}

  // ============================================================
  // INJECT STYLES
  // ============================================================
  var style = document.createElement('style');
  style.textContent = `
    /* ── Overlay ── */
    #rover-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.3);
      backdrop-filter: blur(2px);
      z-index: 99998;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
    }
    #rover-overlay.show {
      opacity: 1;
      pointer-events: auto;
    }

    /* ── Slide-out Panel ── */
    #rover-assistant {
      position: fixed;
      top: 0;
      right: 0;
      width: 440px;
      max-width: 100vw;
      height: 100vh;
      height: 100dvh;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      background: #fff;
      box-shadow: -8px 0 40px rgba(0,0,0,0.15);
      transform: translateX(100%);
      transition: transform 0.35s cubic-bezier(0.4,0,0.2,1);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #rover-assistant.open {
      transform: translateX(0);
    }

    /* ── Header ── */
    .ra-header {
      background: linear-gradient(135deg, #0ea5e9, #2563eb);
      color: white;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }
    .ra-header-avatar {
      width: 44px;
      height: 44px;
      background: rgba(255,255,255,0.2);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      flex-shrink: 0;
    }
    .ra-header-info h3 { margin: 0; font-size: 16px; font-weight: 800; }
    .ra-header-info p { margin: 2px 0 0; font-size: 11px; opacity: 0.8; }
    .ra-header-close {
      margin-left: auto;
      background: rgba(255,255,255,0.15);
      border: none;
      color: white;
      width: 36px;
      height: 36px;
      border-radius: 10px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      transition: background 0.2s;
    }
    .ra-header-close:hover { background: rgba(255,255,255,0.25); }

    /* ── Quick Actions Bar ── */
    .ra-quick-bar {
      display: flex;
      gap: 6px;
      padding: 10px 16px;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      overflow-x: auto;
      flex-shrink: 0;
    }
    .ra-quick-bar::-webkit-scrollbar { height: 0; }
    .ra-quick-btn {
      white-space: nowrap;
      background: white;
      border: 1px solid #e2e8f0;
      color: #334155;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s;
      flex-shrink: 0;
    }
    .ra-quick-btn:hover {
      background: #0ea5e9;
      color: white;
      border-color: #0ea5e9;
    }

    /* ── Messages ── */
    .ra-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      scroll-behavior: smooth;
    }
    .ra-messages::-webkit-scrollbar { width: 4px; }
    .ra-messages::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 2px; }

    .ra-msg {
      max-width: 88%;
      padding: 12px 16px;
      border-radius: 16px;
      font-size: 14px;
      line-height: 1.6;
      word-wrap: break-word;
      animation: raMsgIn 0.3s ease-out;
    }
    @keyframes raMsgIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .ra-msg.assistant {
      align-self: flex-start;
      background: #f1f5f9;
      color: #1e293b;
      border-bottom-left-radius: 4px;
    }
    .ra-msg.assistant a {
      color: #0ea5e9;
      text-decoration: underline;
      font-weight: 600;
    }
    .ra-msg.user {
      align-self: flex-end;
      background: linear-gradient(135deg, #0ea5e9, #2563eb);
      color: white;
      border-bottom-right-radius: 4px;
    }

    /* ── Typing indicator ── */
    .ra-typing {
      display: flex;
      gap: 5px;
      padding: 14px 18px;
      align-self: flex-start;
      background: #f1f5f9;
      border-radius: 16px;
      border-bottom-left-radius: 4px;
    }
    .ra-typing span {
      width: 8px; height: 8px;
      background: #94a3b8;
      border-radius: 50%;
      animation: raBounce 1.4s infinite ease-in-out;
    }
    .ra-typing span:nth-child(2) { animation-delay: 0.2s; }
    .ra-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes raBounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-6px); }
    }

    /* ── Thinking indicator (tool execution) ── */
    .ra-thinking {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      align-self: flex-start;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 12px;
      font-size: 12px;
      color: #1d4ed8;
      font-weight: 500;
    }
    .ra-thinking-spinner {
      width: 14px; height: 14px;
      border: 2px solid #bfdbfe;
      border-top-color: #1d4ed8;
      border-radius: 50%;
      animation: raSpinThink 0.7s linear infinite;
      flex-shrink: 0;
    }
    @keyframes raSpinThink {
      to { transform: rotate(360deg); }
    }

    /* ── Input ── */
    .ra-input-area {
      padding: 12px 16px 16px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      gap: 10px;
      align-items: flex-end;
      background: #fafbfc;
      flex-shrink: 0;
    }
    .ra-input {
      flex: 1;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 12px 16px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
      background: white;
      resize: none;
      min-height: 44px;
      max-height: 120px;
      font-family: inherit;
      line-height: 1.4;
    }
    .ra-input:focus { border-color: #0ea5e9; box-shadow: 0 0 0 3px rgba(14,165,233,0.1); }
    .ra-input::placeholder { color: #94a3b8; }
    .ra-send {
      width: 44px;
      height: 44px;
      border: none;
      background: linear-gradient(135deg, #0ea5e9, #2563eb);
      color: white;
      border-radius: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      transition: all 0.2s;
      flex-shrink: 0;
    }
    .ra-send:hover { transform: scale(1.05); box-shadow: 0 4px 12px rgba(14,165,233,0.3); }
    .ra-send:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }

    /* ── Powered-by ── */
    .ra-powered {
      text-align: center;
      padding: 6px;
      font-size: 10px;
      color: #94a3b8;
      background: #fafbfc;
    }

    /* ── FAB Button ── */
    #rover-assistant-fab {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 99997;
      width: 60px;
      height: 60px;
      border-radius: 16px;
      background: linear-gradient(135deg, #0ea5e9, #2563eb);
      border: none;
      cursor: grab;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 8px 30px rgba(14,165,233,0.4);
      transition: box-shadow 0.3s cubic-bezier(0.4,0,0.2,1), transform 0.2s;
      color: white;
      font-size: 24px;
      touch-action: none;
      user-select: none;
    }
    #rover-assistant-fab:hover {
      transform: scale(1.08);
      box-shadow: 0 12px 40px rgba(14,165,233,0.5);
    }
    #rover-assistant-fab.dragging {
      cursor: grabbing;
      transition: none;
      transform: scale(1.05);
    }
    #rover-assistant-fab.hidden { display: none; }
    .ra-fab-close {
      position: absolute;
      top: -6px;
      right: -6px;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #ef4444;
      color: white;
      border: 2px solid white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      font-weight: 700;
      line-height: 1;
      padding: 0;
      opacity: 0;
      transform: scale(0.8);
      transition: all 0.2s;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      z-index: 2;
    }
    #rover-assistant-fab:hover .ra-fab-close {
      opacity: 1;
      transform: scale(1);
    }
    .ra-fab-close:hover {
      background: #dc2626;
      transform: scale(1.15) !important;
    }
    .ra-fab-label {
      position: absolute;
      bottom: 68px;
      right: 0;
      background: white;
      color: #1e293b;
      padding: 8px 14px;
      border-radius: 12px 12px 4px 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.12);
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      opacity: 0;
      transform: translateY(4px);
      transition: all 0.3s;
      pointer-events: none;
    }
    #rover-assistant-fab:hover .ra-fab-label {
      opacity: 1;
      transform: translateY(0);
    }

    /* ── Mobile ── */
    @media (max-width: 480px) {
      #rover-assistant { width: 100vw; }
      .ra-quick-bar { padding: 8px 12px; }
    }
  `;
  document.head.appendChild(style);

  // ============================================================
  // BUILD DOM
  // ============================================================
  // Overlay
  var overlay = document.createElement('div');
  overlay.id = 'rover-overlay';
  overlay.onclick = function() { window.__roverAssistantToggle(); };
  document.body.appendChild(overlay);

  // Panel
  var panel = document.createElement('div');
  panel.id = 'rover-assistant';
  panel.innerHTML = [
    '<div class="ra-header">',
      '<div class="ra-header-avatar">🐕</div>',
      '<div class="ra-header-info">',
        '<h3>Rover AI Assistant</h3>',
        '<p>Your business assistant</p>',
      '</div>',
      '<button class="ra-header-close" onclick="window.__roverAssistantToggle()" title="Close">',
        '<i class="fas fa-times"></i>',
      '</button>',
    '</div>',
    '<div class="ra-quick-bar" id="ra-quick-bar">',
      '<button class="ra-quick-btn" data-msg="What can you help me with?">💡 What can you do?</button>',
      '<button class="ra-quick-btn" data-msg="How many reports and credits do I have?">📊 My Account</button>',
      '<button class="ra-quick-btn" data-msg="Help me order a new roof report">🏠 New Report</button>',
      '<button class="ra-quick-btn" data-msg="Show me a summary of my CRM data">💼 CRM Summary</button>',
      '<button class="ra-quick-btn" data-msg="Help me draft a professional proposal for a roofing client">📝 Draft Proposal</button>',
      '<button class="ra-quick-btn" data-msg="What is the Roofer Secretary AI and how do I set it up?">📞 Secretary AI</button>',
    '</div>',
    '<div class="ra-messages" id="ra-messages"></div>',
    '<div class="ra-input-area">',
      '<textarea class="ra-input" id="ra-input" placeholder="Ask Rover anything..." rows="1"></textarea>',
      '<button class="ra-send" id="ra-send" onclick="window.__roverAssistantSend()">',
        '<i class="fas fa-paper-plane"></i>',
      '</button>',
    '</div>',
    '<div class="ra-powered">Powered by <strong>Roof Manager</strong> AI Assistant</div>'
  ].join('');
  document.body.appendChild(panel);

  // FAB — hidden-for-session check
  var fab = document.createElement('button');
  fab.id = 'rover-assistant-fab';
  fab.innerHTML = '<button class="ra-fab-close" id="ra-fab-close" title="Hide Rover" aria-label="Hide Rover">×</button><span>🐕</span><div class="ra-fab-label">Ask Rover AI (drag to move)</div>';
  if (sessionStorage.getItem('rover_fab_hidden') === '1') {
    fab.classList.add('hidden');
  }
  document.body.appendChild(fab);

  // Restore saved FAB position (per-browser)
  (function restoreFabPosition() {
    try {
      var saved = JSON.parse(localStorage.getItem('rover_fab_pos') || 'null');
      if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
        var maxLeft = window.innerWidth - 60;
        var maxTop = window.innerHeight - 60;
        var left = Math.max(0, Math.min(saved.left, maxLeft));
        var top = Math.max(0, Math.min(saved.top, maxTop));
        fab.style.left = left + 'px';
        fab.style.top = top + 'px';
        fab.style.right = 'auto';
        fab.style.bottom = 'auto';
      }
    } catch(e) { /* ignore */ }
  })();

  // ============================================================
  // DRAG + CLOSE behavior for FAB
  // ============================================================
  var dragState = { active: false, moved: false, startX: 0, startY: 0, offsetX: 0, offsetY: 0 };
  var DRAG_THRESHOLD = 5; // px before click becomes drag

  function onPointerDown(e) {
    // Ignore close-button clicks
    if (e.target && e.target.closest && e.target.closest('.ra-fab-close')) return;
    var point = e.touches ? e.touches[0] : e;
    var rect = fab.getBoundingClientRect();
    dragState.active = true;
    dragState.moved = false;
    dragState.startX = point.clientX;
    dragState.startY = point.clientY;
    dragState.offsetX = point.clientX - rect.left;
    dragState.offsetY = point.clientY - rect.top;
    document.addEventListener('mousemove', onPointerMove);
    document.addEventListener('mouseup', onPointerUp);
    document.addEventListener('touchmove', onPointerMove, { passive: false });
    document.addEventListener('touchend', onPointerUp);
  }

  function onPointerMove(e) {
    if (!dragState.active) return;
    var point = e.touches ? e.touches[0] : e;
    var dx = point.clientX - dragState.startX;
    var dy = point.clientY - dragState.startY;
    if (!dragState.moved && Math.sqrt(dx*dx + dy*dy) < DRAG_THRESHOLD) return;
    dragState.moved = true;
    fab.classList.add('dragging');
    if (e.cancelable) e.preventDefault();
    var left = point.clientX - dragState.offsetX;
    var top = point.clientY - dragState.offsetY;
    var maxLeft = window.innerWidth - fab.offsetWidth;
    var maxTop = window.innerHeight - fab.offsetHeight;
    left = Math.max(0, Math.min(left, maxLeft));
    top = Math.max(0, Math.min(top, maxTop));
    fab.style.left = left + 'px';
    fab.style.top = top + 'px';
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
  }

  function onPointerUp() {
    document.removeEventListener('mousemove', onPointerMove);
    document.removeEventListener('mouseup', onPointerUp);
    document.removeEventListener('touchmove', onPointerMove);
    document.removeEventListener('touchend', onPointerUp);
    if (!dragState.active) return;
    var wasMoved = dragState.moved;
    dragState.active = false;
    fab.classList.remove('dragging');
    if (wasMoved) {
      // Save position
      try {
        var rect = fab.getBoundingClientRect();
        localStorage.setItem('rover_fab_pos', JSON.stringify({ left: rect.left, top: rect.top }));
      } catch(e) { /* ignore */ }
    } else {
      // Treat as click — open the assistant
      window.__roverAssistantToggle();
    }
  }

  fab.addEventListener('mousedown', onPointerDown);
  fab.addEventListener('touchstart', onPointerDown, { passive: true });

  // Close button — hide FAB for this session
  var fabCloseBtn = document.getElementById('ra-fab-close');
  if (fabCloseBtn) {
    fabCloseBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      fab.classList.add('hidden');
      try { sessionStorage.setItem('rover_fab_hidden', '1'); } catch(err) {}
    });
    fabCloseBtn.addEventListener('mousedown', function(e) { e.stopPropagation(); });
    fabCloseBtn.addEventListener('touchstart', function(e) { e.stopPropagation(); });
  }

  // Keep FAB on-screen if window resizes
  window.addEventListener('resize', function() {
    if (!fab.style.left) return;
    var left = parseFloat(fab.style.left) || 0;
    var top = parseFloat(fab.style.top) || 0;
    var maxLeft = window.innerWidth - fab.offsetWidth;
    var maxTop = window.innerHeight - fab.offsetHeight;
    fab.style.left = Math.max(0, Math.min(left, maxLeft)) + 'px';
    fab.style.top = Math.max(0, Math.min(top, maxTop)) + 'px';
  });

  // ============================================================
  // ELEMENT REFS
  // ============================================================
  var messagesEl = document.getElementById('ra-messages');
  var inputEl = document.getElementById('ra-input');
  var sendBtn = document.getElementById('ra-send');
  var quickBar = document.getElementById('ra-quick-bar');

  // ============================================================
  // HELPERS
  // ============================================================
  function esc(str) {
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function formatContent(text) {
    return esc(text)
      .replace(/\n/g, '<br>')
      // Convert internal routes to clickable links
      .replace(/(\/customer\/[a-z-]+|\/pricing|\/blog)/g, '<a href="$1">$1</a>')
      .replace(/(reports@reusecanada\.ca)/g, '<a href="mailto:$1">$1</a>')
      // Bold text between ** **
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function addMessage(role, content) {
    state.messages.push({ role: role, content: content });
    var msg = document.createElement('div');
    msg.className = 'ra-msg ' + role;
    msg.innerHTML = formatContent(content);
    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showTyping() {
    var t = document.createElement('div');
    t.className = 'ra-typing';
    t.id = 'ra-typing';
    t.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(t);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function hideTyping() {
    var t = document.getElementById('ra-typing');
    if (t) t.remove();
  }

  // Auto-resize textarea
  inputEl.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  // ============================================================
  // TOGGLE
  // ============================================================
  window.__roverAssistantToggle = function() {
    state.open = !state.open;
    panel.classList.toggle('open', state.open);
    overlay.classList.toggle('show', state.open);
    fab.classList.toggle('hidden', state.open);

    if (state.open) {
      // Show welcome on first open
      if (state.messages.length === 0) {
        var name = state.customerName ? state.customerName.split(' ')[0] : 'there';
        addMessage('assistant', 'Hi! I\'m Roof Manager AI — your AI assistant to help you with anything Roof Manager! Whether it\'s navigating your user dashboard, helping with set-ups, acting as your personal sales assistant, or finding any data or information your business needs — I\'m here for you. How can I help you?');
      }
      setTimeout(function() { inputEl.focus(); }, 350);
    }
  };

  // Show/hide thinking indicator (shown while tools execute between phase 1 and phase 2)
  function showThinking() {
    var t = document.createElement('div');
    t.className = 'ra-thinking';
    t.id = 'ra-thinking';
    t.innerHTML = '<div class="ra-thinking-spinner"></div>Looking up your data…';
    messagesEl.appendChild(t);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  function hideThinking() {
    var t = document.getElementById('ra-thinking');
    if (t) t.remove();
  }

  // ============================================================
  // SEND — SSE streaming with tool-call support
  // ============================================================
  window.__roverAssistantSend = async function(overrideMsg) {
    var msg = overrideMsg || inputEl.value.trim();
    if (!msg || state.loading) return;

    if (!overrideMsg) inputEl.value = '';
    inputEl.style.height = 'auto';
    addMessage('user', msg);
    state.loading = true;
    inputEl.disabled = true;
    sendBtn.disabled = true;
    showTyping();

    var msgEl = null;    // streaming bubble
    var fullContent = '';

    try {
      var res = await fetch('/api/rover/assistant/stream', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ session_id: state.sessionId, message: msg })
      });

      if (res.status === 401) {
        hideTyping();
        addMessage('assistant', 'Your session has expired. Please log in again at /customer/login.');
        state.loading = false;
        inputEl.disabled = false;
        sendBtn.disabled = false;
        return;
      }

      if (!res.ok || !res.body) throw new Error('stream unavailable');

      hideTyping();

      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = '';

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;

        buf += decoder.decode(chunk.value, { stream: true });
        var lines = buf.split('\n');
        buf = lines.pop();

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (!line.startsWith('data: ')) continue;
          var raw = line.slice(6).trim();
          if (!raw) continue;
          try {
            var data = JSON.parse(raw);

            if (data.thinking) {
              // Tool execution in progress — show thinking indicator
              showThinking();
            }

            if (data.delta) {
              // Hide thinking indicator on first token of the real answer
              hideThinking();
              if (!msgEl) {
                msgEl = document.createElement('div');
                msgEl.className = 'ra-msg assistant';
                messagesEl.appendChild(msgEl);
              }
              fullContent += data.delta;
              msgEl.innerHTML = formatContent(fullContent);
              messagesEl.scrollTop = messagesEl.scrollHeight;
            }

            if (data.done) {
              hideThinking();
              // Final re-render for any remaining formatting
              if (msgEl) msgEl.innerHTML = formatContent(fullContent);
            }
          } catch (e) { /* malformed chunk */ }
        }
      }

      if (!fullContent) {
        addMessage('assistant', 'I had a hiccup processing that. Try again or check your dashboard directly.');
      }

    } catch (e) {
      hideTyping();
      hideThinking();

      // Fall back to non-streaming endpoint
      try {
        var fallback = await fetch('/api/rover/assistant', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ session_id: state.sessionId, message: msg })
        });
        if (fallback.status === 401) {
          addMessage('assistant', 'Your session has expired. Please log in again at /customer/login.');
        } else if (fallback.ok) {
          var fd = await fallback.json();
          if (fd.reply) addMessage('assistant', fd.reply);
        } else {
          addMessage('assistant', 'Connection issue — please check your internet and try again.');
        }
      } catch (e2) {
        addMessage('assistant', 'Connection issue — please check your internet and try again.');
      }
    }

    state.loading = false;
    inputEl.disabled = false;
    sendBtn.disabled = false;
    inputEl.focus();
  };

  // Enter to send (Shift+Enter for newline)
  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      window.__roverAssistantSend();
    }
  });

  // Quick action buttons
  quickBar.addEventListener('click', function(e) {
    var btn = e.target.closest('.ra-quick-btn');
    if (btn && btn.dataset.msg) {
      window.__roverAssistantSend(btn.dataset.msg);
    }
  });

  // ============================================================
  // RESTORE HISTORY
  // ============================================================
  async function restoreHistory() {
    try {
      var res = await fetch('/api/rover/assistant/history?session_id=' + state.sessionId, {
        headers: authHeaders()
      });
      if (res.ok) {
        var data = await res.json();
        if (data.messages && data.messages.length > 0) {
          data.messages.forEach(function(m) {
            state.messages.push({ role: m.role, content: m.content });
            var msgEl = document.createElement('div');
            msgEl.className = 'ra-msg ' + m.role;
            msgEl.innerHTML = formatContent(m.content);
            messagesEl.appendChild(msgEl);
          });
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      }
    } catch(e) { /* silent */ }
  }
  restoreHistory();

  // ============================================================
  // KEYBOARD SHORTCUT: Ctrl+K or Cmd+K to toggle
  // ============================================================
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      window.__roverAssistantToggle();
    }
    if (e.key === 'Escape' && state.open) {
      window.__roverAssistantToggle();
    }
  });

})();

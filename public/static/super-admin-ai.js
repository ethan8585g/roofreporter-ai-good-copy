// ============================================================
// Super Admin — AI Assistant chat UI
// Streams SSE events from /super-admin/ai-assistant/chat and renders
// text deltas, tool calls, and tool results inline.
// ============================================================
(function () {
  'use strict';

  var msgs = document.getElementById('aiMsgs');
  var form = document.getElementById('aiForm');
  var input = document.getElementById('aiInput');
  var sendBtn = document.getElementById('aiSend');
  var modelSel = document.getElementById('aiModel');
  var newChatBtn = document.getElementById('aiNewChat');
  var convoList = document.getElementById('aiConvoList');

  // Conversation history sent to the backend each turn
  var history = [];
  var inFlight = false;
  var currentConvoId = null;

  function getAuthHeaders() {
    var t = localStorage.getItem('admin_session_token');
    return t ? { 'Authorization': 'Bearer ' + t } : {};
  }

  async function loadConversationList() {
    try {
      var res = await fetch('/super-admin/ai-assistant/conversations', { credentials: 'include', headers: getAuthHeaders() });
      if (!res.ok) { convoList.innerHTML = '<div class="ai-convo-empty">Not loaded</div>'; return; }
      var data = await res.json();
      if (!data.conversations || !data.conversations.length) {
        convoList.innerHTML = '<div class="ai-convo-empty">No saved chats yet</div>';
        return;
      }
      var html = '';
      for (var i = 0; i < data.conversations.length; i++) {
        var c = data.conversations[i];
        var when = new Date(c.updated_at.replace(' ', 'T') + 'Z').toLocaleString();
        var active = (c.id === currentConvoId) ? ' active' : '';
        html += '<div class="ai-convo-item' + active + '" data-id="' + c.id + '">' +
          '<div class="title">' + escapeHtml(c.title || 'Untitled') + '</div>' +
          '<div class="meta">' + escapeHtml(c.model || '') + ' · ' + c.turn_count + ' turn' + (c.turn_count === 1 ? '' : 's') + ' · ' + when + '</div>' +
          '</div>';
      }
      convoList.innerHTML = html;
      var items = convoList.querySelectorAll('.ai-convo-item');
      for (var k = 0; k < items.length; k++) {
        items[k].addEventListener('click', function (e) { loadConversation(Number(e.currentTarget.getAttribute('data-id'))); });
      }
    } catch (_) {
      convoList.innerHTML = '<div class="ai-convo-empty">Error loading</div>';
    }
  }

  async function loadConversation(id) {
    try {
      var res = await fetch('/super-admin/ai-assistant/conversations/' + id, { credentials: 'include', headers: getAuthHeaders() });
      if (!res.ok) return;
      var data = await res.json();
      currentConvoId = data.id;
      history = data.messages || [];
      if (data.model) modelSel.value = data.model;
      rerenderHistory();
      loadConversationList();
    } catch (_) { /* ignore */ }
  }

  function rerenderHistory() {
    msgs.innerHTML = '';
    if (!history.length) { showEmptyState(); return; }
    for (var i = 0; i < history.length; i++) {
      var m = history[i];
      var text = typeof m.content === 'string' ? m.content :
        (Array.isArray(m.content) ? (m.content.find(function (b) { return b.type === 'text'; }) || {}).text || '' : '');
      if (!text) continue;
      var div = document.createElement('div');
      div.className = 'ai-msg ' + (m.role === 'user' ? 'user' : 'assistant');
      if (m.role === 'user') div.textContent = text;
      else div.innerHTML = renderMd(text);
      msgs.appendChild(div);
    }
    scrollToBottom();
  }

  async function persistConversation() {
    if (!history.length) return;
    try {
      var res = await fetch('/super-admin/ai-assistant/conversations', {
        method: 'POST',
        credentials: 'include',
        headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
        body: JSON.stringify({ id: currentConvoId, messages: history, model: modelSel.value }),
      });
      if (res.ok) {
        var data = await res.json();
        if (data.id) currentConvoId = data.id;
      }
    } catch (_) { /* ignore */ }
  }

  function newChat() {
    history = [];
    currentConvoId = null;
    msgs.innerHTML = '';
    showEmptyState();
    loadConversationList();
    input.focus();
  }
  if (newChatBtn) newChatBtn.addEventListener('click', newChat);

  function showEmptyState() {
    if (history.length) return;
    msgs.innerHTML =
      '<div class="ai-empty">' +
        '<i class="fas fa-sparkles"></i>' +
        '<h2>How can I help?</h2>' +
        '<p>I can edit blog posts, tweak agent configs, read &amp; write any file in the repo (commits trigger auto-deploy in ~30s), and pull loop-monitor data. I cannot send emails or run jobs.</p>' +
        '<div class="ai-suggest">' +
          '<div class="ai-chip" data-q="What’s in CLAUDE.md? Just confirm you can see the project context.">Confirm CLAUDE.md context</div>' +
          '<div class="ai-chip" data-q="Is everything healthy? Give me a loop health summary.">Loop health check</div>' +
          '<div class="ai-chip" data-q="List my 10 most recent blog posts">10 most recent blog posts</div>' +
          '<div class="ai-chip" data-q="What commits have you pushed in the last 24 hours?">Show your recent commits</div>' +
        '</div>' +
      '</div>';
    var chips = msgs.querySelectorAll('.ai-chip');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function (e) {
        input.value = e.currentTarget.getAttribute('data-q');
        input.focus();
        autosize();
      });
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Light markdown: code fences, inline code, **bold**, line breaks
  function renderMd(text) {
    var s = escapeHtml(text);
    s = s.replace(/```([\s\S]*?)```/g, function (_, code) { return '<pre>' + code + '</pre>'; });
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\n/g, '<br>');
    return s;
  }

  function appendUser(text) {
    if (!history.length) msgs.innerHTML = '';
    var div = document.createElement('div');
    div.className = 'ai-msg user';
    div.textContent = text;
    msgs.appendChild(div);
    scrollToBottom();
  }

  function newAssistantBubble() {
    var div = document.createElement('div');
    div.className = 'ai-msg assistant ai-cursor';
    div.dataset.raw = '';
    msgs.appendChild(div);
    scrollToBottom();
    return div;
  }

  function appendAssistantText(bubble, deltaText) {
    bubble.dataset.raw = (bubble.dataset.raw || '') + deltaText;
    bubble.innerHTML = renderMd(bubble.dataset.raw);
    bubble.classList.add('ai-cursor');
    scrollToBottom();
  }

  function appendToolEvent(name, payload, kind) {
    var div = document.createElement('div');
    div.className = 'ai-msg tool';
    var label = kind === 'use'
      ? '<span class="tool-name">→ ' + escapeHtml(name) + '</span>'
      : '<span class="tool-status' + (payload && payload.error ? ' err' : '') + '">' +
          (payload && payload.error ? '✗ ' : '✓ ') + escapeHtml(name) +
        '</span>';
    var summary = kind === 'use' ? 'input' : 'result';
    var body = JSON.stringify(payload, null, 2);
    div.innerHTML = label +
      '<details><summary>' + summary + '</summary><pre>' + escapeHtml(body) + '</pre></details>';
    msgs.appendChild(div);
    scrollToBottom();
  }

  function appendError(msg) {
    var div = document.createElement('div');
    div.className = 'ai-msg assistant';
    div.style.borderColor = '#dc2626';
    div.innerHTML = '<strong style="color:#fca5a5">Error:</strong> ' + escapeHtml(msg);
    msgs.appendChild(div);
    scrollToBottom();
  }

  function scrollToBottom() {
    requestAnimationFrame(function () {
      window.scrollTo(0, document.body.scrollHeight);
    });
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  }

  input.addEventListener('input', autosize);

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || inFlight) return;
    inFlight = true;
    sendBtn.disabled = true;

    appendUser(text);
    history.push({ role: 'user', content: text });
    input.value = '';
    autosize();

    var bubble = newAssistantBubble();
    var assistantText = '';

    try {
      var res = await fetch('/super-admin/ai-assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ messages: history, model: modelSel.value }),
      });
      if (!res.ok) {
        var errText = await res.text();
        appendError('HTTP ' + res.status + ': ' + errText.slice(0, 300));
        bubble.remove();
        return;
      }

      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = '';

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buf += dec.decode(chunk.value, { stream: true });

        // Parse SSE frames separated by blank lines
        var frames = buf.split('\n\n');
        buf = frames.pop() || '';
        for (var i = 0; i < frames.length; i++) {
          var frame = frames[i];
          var ev = '';
          var data = '';
          var lines = frame.split('\n');
          for (var j = 0; j < lines.length; j++) {
            var line = lines[j];
            if (line.indexOf('event: ') === 0) ev = line.slice(7);
            else if (line.indexOf('data: ') === 0) data = line.slice(6);
          }
          if (!ev) continue;
          var parsed;
          try { parsed = JSON.parse(data); } catch (_) { continue; }

          if (ev === 'text') {
            assistantText += parsed.text;
            appendAssistantText(bubble, parsed.text);
          } else if (ev === 'tool_use') {
            bubble.classList.remove('ai-cursor');
            appendToolEvent(parsed.name, parsed.input, 'use');
            // After tool calls, the model may produce more text — make a fresh bubble next time
            bubble = newAssistantBubble();
          } else if (ev === 'tool_result') {
            appendToolEvent(parsed.name, parsed.result, 'result');
          } else if (ev === 'usage') {
            // Optional: render token usage as a tiny meta line
            var meta = document.createElement('div');
            meta.className = 'ai-meta';
            var u = parsed;
            meta.textContent =
              'in: ' + (u.input_tokens || 0) +
              (u.cache_read_input_tokens ? ' (cached: ' + u.cache_read_input_tokens + ')' : '') +
              ' · out: ' + (u.output_tokens || 0);
            msgs.appendChild(meta);
          } else if (ev === 'done') {
            bubble.classList.remove('ai-cursor');
          } else if (ev === 'error') {
            bubble.classList.remove('ai-cursor');
            appendError(parsed.message || 'Stream error');
          }
        }
      }

      // Add the final assistant turn to history so multi-turn works
      if (assistantText) history.push({ role: 'assistant', content: assistantText });
      bubble.classList.remove('ai-cursor');
      if (!bubble.textContent.trim()) bubble.remove();
      // Auto-save to D1 so refresh / tab close doesn't lose this conversation
      persistConversation().then(loadConversationList);
    } catch (err) {
      appendError(err && err.message ? err.message : String(err));
    } finally {
      inFlight = false;
      sendBtn.disabled = false;
      input.focus();
    }
  });

  showEmptyState();
  loadConversationList();
  input.focus();
})();

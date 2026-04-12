// Autonomous Admin Agent chat widget — floating panel on /super-admin
(function() {
  'use strict';

  const STYLES = `
    #aa-fab { position: fixed; bottom: 24px; right: 24px; width: 60px; height: 60px; border-radius: 50%;
      background: linear-gradient(135deg, #7c3aed, #4f46e5); color: #fff; border: none; cursor: pointer;
      box-shadow: 0 8px 24px rgba(124, 58, 237, 0.4); font-size: 24px; z-index: 9998;
      display: flex; align-items: center; justify-content: center; transition: transform 0.2s; }
    #aa-fab:hover { transform: scale(1.08); }
    #aa-panel { position: fixed; bottom: 96px; right: 24px; width: 420px; max-width: calc(100vw - 48px);
      height: 620px; max-height: calc(100vh - 120px); background: #0f172a; color: #e2e8f0;
      border: 1px solid #334155; border-radius: 16px; box-shadow: 0 20px 50px rgba(0,0,0,0.5);
      display: none; flex-direction: column; overflow: hidden; z-index: 9999; font-family: system-ui, sans-serif; }
    #aa-panel.open { display: flex; }
    #aa-header { padding: 14px 16px; background: linear-gradient(135deg, #7c3aed, #4f46e5);
      display: flex; justify-content: space-between; align-items: center; }
    #aa-header h3 { margin: 0; font-size: 15px; font-weight: 600; color: #fff; }
    #aa-header .sub { font-size: 11px; color: #c4b5fd; margin-top: 2px; }
    #aa-header button { background: transparent; border: none; color: #fff; cursor: pointer; font-size: 18px; padding: 4px 8px; }
    #aa-messages { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
    .aa-msg { padding: 10px 12px; border-radius: 10px; font-size: 13px; line-height: 1.5; word-wrap: break-word; }
    .aa-msg.user { background: #4f46e5; color: #fff; align-self: flex-end; max-width: 85%; }
    .aa-msg.assistant { background: #1e293b; color: #e2e8f0; align-self: flex-start; max-width: 90%; border: 1px solid #334155; }
    .aa-msg.action { background: #0c4a6e; color: #bae6fd; align-self: flex-start; max-width: 90%;
      font-family: ui-monospace, monospace; font-size: 11px; border-left: 3px solid #0ea5e9; }
    .aa-msg.error { background: #450a0a; color: #fecaca; border-left: 3px solid #ef4444; }
    .aa-loading { color: #94a3b8; font-style: italic; font-size: 12px; padding: 8px 12px; }
    #aa-input-bar { padding: 12px; border-top: 1px solid #334155; background: #0f172a; display: flex; gap: 8px; }
    #aa-input { flex: 1; background: #1e293b; color: #e2e8f0; border: 1px solid #334155; border-radius: 8px;
      padding: 10px 12px; font-size: 13px; resize: none; font-family: inherit; min-height: 40px; max-height: 120px; }
    #aa-input:focus { outline: none; border-color: #7c3aed; }
    #aa-send { background: #7c3aed; color: #fff; border: none; border-radius: 8px; padding: 0 16px;
      cursor: pointer; font-weight: 600; font-size: 13px; }
    #aa-send:disabled { opacity: 0.5; cursor: not-allowed; }
    #aa-toolbar { padding: 8px 14px; border-bottom: 1px solid #334155; display: flex; justify-content: space-between;
      align-items: center; font-size: 11px; color: #94a3b8; }
    #aa-toolbar button { background: transparent; color: #94a3b8; border: 1px solid #334155;
      border-radius: 6px; padding: 4px 10px; cursor: pointer; font-size: 11px; }
    #aa-toolbar button:hover { color: #e2e8f0; border-color: #7c3aed; }
    .aa-suggestions { padding: 10px 14px; display: flex; flex-wrap: wrap; gap: 6px; border-bottom: 1px solid #334155; }
    .aa-suggestion { background: #1e293b; color: #c4b5fd; border: 1px solid #334155;
      border-radius: 16px; padding: 5px 10px; font-size: 11px; cursor: pointer; }
    .aa-suggestion:hover { background: #4f46e5; color: #fff; }
  `;

  const SUGGESTIONS = [
    'Revenue this week',
    'Orders stuck in processing',
    'Draft a blog post about roof measurement accuracy',
    'Show top 5 customers by credits used',
    'Post an announcement: 20% off this weekend'
  ];

  function getToken() {
    return localStorage.getItem('rc_token') || localStorage.getItem('admin_token') || localStorage.getItem('sa_token') || '';
  }

  let threadId = null;

  function addMsg(role, content) {
    const box = document.getElementById('aa-messages');
    const div = document.createElement('div');
    div.className = 'aa-msg ' + role;
    if (role === 'assistant' || role === 'user') {
      div.innerHTML = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>');
    } else {
      div.textContent = content;
    }
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
  }

  async function send(message) {
    const input = document.getElementById('aa-input');
    const sendBtn = document.getElementById('aa-send');
    input.value = '';
    input.style.height = 'auto';
    addMsg('user', message);
    sendBtn.disabled = true;

    const loading = document.createElement('div');
    loading.className = 'aa-loading';
    loading.textContent = 'Agent thinking...';
    document.getElementById('aa-messages').appendChild(loading);

    try {
      const res = await fetch('/api/admin-agent/chat', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, thread_id: threadId })
      });
      const data = await res.json();
      loading.remove();
      if (!res.ok) { addMsg('error', data.error || data.reply || 'Request failed'); return; }
      threadId = data.thread_id;
      if (Array.isArray(data.actions)) {
        const fresh = data.actions.filter(a => !window._aa_seen_actions?.has(a.id));
        window._aa_seen_actions = window._aa_seen_actions || new Set();
        fresh.forEach(a => window._aa_seen_actions.add(a.id));
        fresh.reverse().forEach(a => {
          const ok = a.success ? 'OK' : 'FAIL';
          addMsg('action', `[${ok}] ${a.tool_name} ${(a.args || '').slice(0, 120)}`);
        });
      }
      addMsg('assistant', data.reply || '(no reply)');
    } catch (e) {
      loading.remove();
      addMsg('error', 'Network error: ' + e.message);
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  function newThread() {
    threadId = null;
    window._aa_seen_actions = new Set();
    document.getElementById('aa-messages').innerHTML = '';
    addMsg('assistant', "Hi — I'm your autonomous admin agent. Ask me about the platform, or give me a goal and I'll plan and execute it. Try a suggestion below.");
  }

  function build() {
    if (document.getElementById('aa-fab')) return;
    const style = document.createElement('style');
    style.textContent = STYLES;
    document.head.appendChild(style);

    const fab = document.createElement('button');
    fab.id = 'aa-fab';
    fab.title = 'AI Admin Agent';
    fab.innerHTML = '<i class="fas fa-robot"></i>';
    fab.onclick = () => {
      const panel = document.getElementById('aa-panel');
      panel.classList.toggle('open');
      if (panel.classList.contains('open') && !document.getElementById('aa-messages').children.length) {
        newThread();
      }
    };

    const panel = document.createElement('div');
    panel.id = 'aa-panel';
    panel.innerHTML = `
      <div id="aa-header">
        <div>
          <h3><i class="fas fa-robot"></i> Admin Agent</h3>
          <div class="sub">Autonomous platform manager</div>
        </div>
        <button id="aa-close" title="Close">×</button>
      </div>
      <div id="aa-toolbar">
        <span id="aa-thread-label">New thread</span>
        <button id="aa-new-thread">New thread</button>
      </div>
      <div class="aa-suggestions">
        ${SUGGESTIONS.map(s => `<div class="aa-suggestion">${s}</div>`).join('')}
      </div>
      <div id="aa-messages"></div>
      <div id="aa-input-bar">
        <textarea id="aa-input" placeholder="Ask or command the agent..." rows="1"></textarea>
        <button id="aa-send">Send</button>
      </div>
    `;

    document.body.appendChild(fab);
    document.body.appendChild(panel);

    document.getElementById('aa-close').onclick = () => panel.classList.remove('open');
    document.getElementById('aa-new-thread').onclick = newThread;

    const input = document.getElementById('aa-input');
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(120, input.scrollHeight) + 'px';
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const v = input.value.trim();
        if (v) send(v);
      }
    });
    document.getElementById('aa-send').onclick = () => {
      const v = input.value.trim();
      if (v) send(v);
    };
    panel.querySelectorAll('.aa-suggestion').forEach(el => {
      el.onclick = () => send(el.textContent);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();

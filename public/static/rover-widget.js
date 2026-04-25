// ============================================================
// ROVER AI CHATBOT — Frontend Widget
// Injectable floating chat widget for all public pages
// Connects to /api/rover/* endpoints
// Includes contact form fallback when AI can't answer
// ============================================================

(function() {
  'use strict';

  // Prevent double-init
  if (window.__roverInit) return;
  window.__roverInit = true;

  // ============================================================
  // STATE
  // ============================================================
  const state = {
    open: false,
    sessionId: null,
    messages: [],
    loading: false,
    leadSubmitted: false,
    minimized: false,
    unread: 0,
    contactFormShown: false
  };

  // Generate or restore session ID
  function getSessionId() {
    let sid = sessionStorage.getItem('rover_session_id');
    if (!sid) {
      sid = 'rv_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
      sessionStorage.setItem('rover_session_id', sid);
    }
    return sid;
  }
  state.sessionId = getSessionId();

  // Funnel beacon — fires once per session per event_type (server also dedupes)
  function fireRoverEvent(eventType) {
    try {
      var key = 'rover_evt_' + eventType;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
      var payload = JSON.stringify({
        session_id: state.sessionId,
        event_type: eventType,
        page_url: location.pathname + location.search,
        referrer: document.referrer || ''
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/rover/event', new Blob([payload], { type: 'application/json' }));
      } else {
        fetch('/api/rover/event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(function(){});
      }
    } catch (e) { /* best-effort */ }
  }
  fireRoverEvent('widget_impression');

  // ============================================================
  // INJECT STYLES
  // ============================================================
  const style = document.createElement('style');
  style.textContent = `
    #rover-widget {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 99999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    /* Floating button */
    #rover-fab {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: linear-gradient(135deg, #00FF88, #00cc6a);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 8px 30px rgba(0, 255, 136, 0.35);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
    }
    #rover-fab:hover {
      transform: scale(1.08);
      box-shadow: 0 12px 40px rgba(0, 255, 136, 0.45);
    }
    #rover-fab .rover-icon {
      font-size: 28px;
      transition: transform 0.3s;
    }
    #rover-fab.open .rover-icon { transform: rotate(90deg); }
    #rover-fab .rover-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      background: #ef4444;
      color: white;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      font-size: 11px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid white;
      opacity: 0;
      transform: scale(0);
      transition: all 0.3s;
    }
    #rover-fab .rover-badge.show { opacity: 1; transform: scale(1); }

    /* Greeting bubble */
    #rover-greeting {
      position: absolute;
      bottom: 76px;
      right: 0;
      background: white;
      color: #1e293b;
      padding: 14px 18px;
      border-radius: 16px 16px 4px 16px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.12);
      font-size: 14px;
      line-height: 1.5;
      max-width: 280px;
      opacity: 0;
      transform: translateY(10px) scale(0.95);
      transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      pointer-events: none;
    }
    #rover-greeting.show {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
      cursor: pointer;
    }
    #rover-greeting .rover-g-name {
      font-weight: 700;
      color: #0ea5e9;
    }
    #rover-greeting .rover-g-close {
      position: absolute;
      top: 6px;
      right: 10px;
      cursor: pointer;
      color: #94a3b8;
      font-size: 16px;
      line-height: 1;
    }
    #rover-greeting .rover-g-close:hover { color: #475569; }

    /* Chat window */
    #rover-chat {
      position: absolute;
      bottom: 80px;
      right: 0;
      width: 380px;
      max-width: calc(100vw - 32px);
      height: 540px;
      max-height: calc(100vh - 120px);
      background: white;
      border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.2);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      opacity: 0;
      transform: translateY(20px) scale(0.9);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      pointer-events: none;
    }
    #rover-chat.open {
      opacity: 1;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    /* Chat header */
    .rover-header {
      background: linear-gradient(135deg, #0ea5e9, #2563eb);
      color: white;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }
    .rover-header-avatar {
      width: 40px;
      height: 40px;
      background: rgba(255,255,255,0.2);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      flex-shrink: 0;
    }
    .rover-header-info h3 {
      margin: 0;
      font-size: 15px;
      font-weight: 700;
    }
    .rover-header-info p {
      margin: 2px 0 0;
      font-size: 11px;
      opacity: 0.8;
    }
    .rover-header-close {
      margin-left: auto;
      background: rgba(255,255,255,0.15);
      border: none;
      color: white;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      transition: background 0.2s;
    }
    .rover-header-close:hover { background: rgba(255,255,255,0.25); }

    /* Messages area */
    .rover-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      scroll-behavior: smooth;
    }
    .rover-messages::-webkit-scrollbar { width: 4px; }
    .rover-messages::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 2px; }

    .rover-msg {
      max-width: 85%;
      padding: 12px 16px;
      border-radius: 16px;
      font-size: 13.5px;
      line-height: 1.5;
      word-wrap: break-word;
      animation: roverMsgIn 0.3s ease-out;
    }
    @keyframes roverMsgIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .rover-msg.assistant {
      align-self: flex-start;
      background: #f1f5f9;
      color: #1e293b;
      border-bottom-left-radius: 4px;
    }
    .rover-msg.user {
      align-self: flex-end;
      background: linear-gradient(135deg, #0ea5e9, #2563eb);
      color: white;
      border-bottom-right-radius: 4px;
    }

    /* Typing indicator */
    .rover-typing {
      display: flex;
      gap: 4px;
      padding: 12px 16px;
      align-self: flex-start;
      background: #f1f5f9;
      border-radius: 16px;
      border-bottom-left-radius: 4px;
    }
    .rover-typing span {
      width: 8px;
      height: 8px;
      background: #94a3b8;
      border-radius: 50%;
      animation: roverBounce 1.4s infinite ease-in-out;
    }
    .rover-typing span:nth-child(2) { animation-delay: 0.2s; }
    .rover-typing span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes roverBounce {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-6px); }
    }

    /* Input area */
    .rover-input-area {
      padding: 12px 16px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      gap: 8px;
      align-items: center;
      background: #fafbfc;
      flex-shrink: 0;
    }
    .rover-input {
      flex: 1;
      border: 1px solid #e2e8f0;
      border-radius: 24px;
      padding: 10px 16px;
      font-size: 13.5px;
      outline: none;
      transition: border-color 0.2s;
      background: white;
    }
    .rover-input:focus { border-color: #0ea5e9; }
    .rover-input::placeholder { color: #94a3b8; }
    .rover-send {
      width: 40px;
      height: 40px;
      border: none;
      background: linear-gradient(135deg, #0ea5e9, #2563eb);
      color: white;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      transition: all 0.2s;
      flex-shrink: 0;
    }
    .rover-send:hover { transform: scale(1.05); }
    .rover-send:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

    /* Powered by */
    .rover-powered {
      text-align: center;
      padding: 6px;
      font-size: 10px;
      color: #94a3b8;
      background: #fafbfc;
      border-top: 1px solid #f1f5f9;
    }

    /* Quick action buttons in messages */
    .rover-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }
    .rover-action-btn {
      background: white;
      border: 1px solid #e2e8f0;
      color: #0ea5e9;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 12px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s;
    }
    .rover-action-btn:hover {
      background: #0ea5e9;
      color: white;
      border-color: #0ea5e9;
    }

    /* CTA buttons emitted after each Rover reply */
    .rover-cta-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 6px 0 10px;
      align-self: flex-start;
      max-width: 92%;
    }
    .rover-cta-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 7px 12px;
      background: linear-gradient(135deg, #00FF88, #00cc6a);
      color: #052e19;
      border: none;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      transition: transform 0.15s, box-shadow 0.15s;
      box-shadow: 0 2px 8px rgba(0, 204, 106, 0.25);
      text-decoration: none;
    }
    .rover-cta-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(0, 204, 106, 0.35);
    }

    /* Inline email-capture chip below first Rover reply */
    .rover-email-chip {
      display: flex;
      gap: 6px;
      align-items: center;
      background: #fff7ed;
      border: 1px solid #fed7aa;
      border-radius: 10px;
      padding: 8px 10px;
      margin: 4px 0 10px;
      align-self: stretch;
      max-width: 100%;
      animation: roverMsgIn 0.3s ease-out;
    }
    .rover-email-chip input {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid #fdba74;
      border-radius: 8px;
      font-size: 12px;
      outline: none;
      background: #fff;
      min-width: 0;
    }
    .rover-email-chip input:focus { border-color: #f97316; box-shadow: 0 0 0 2px rgba(249,115,22,0.15); }
    .rover-email-chip button {
      padding: 6px 10px;
      background: #f97316;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
    }
    .rover-email-chip button:disabled { opacity: 0.6; cursor: not-allowed; }
    .rover-email-chip .chip-label { font-size: 11px; color: #9a3412; font-weight: 600; white-space: nowrap; }
    .rover-email-chip .chip-dismiss {
      background: transparent;
      color: #9a3412;
      font-size: 11px;
      font-weight: 500;
      padding: 6px 6px;
      cursor: pointer;
      border: none;
    }

    /* Contact form inside chat */
    .rover-contact-form {
      background: linear-gradient(135deg, #f0f9ff, #e0f2fe);
      border: 1px solid #bae6fd;
      border-radius: 12px;
      padding: 16px;
      margin: 8px 0;
      animation: roverMsgIn 0.3s ease-out;
      align-self: stretch;
      max-width: 100%;
    }
    .rover-contact-form h4 {
      margin: 0 0 12px;
      font-size: 14px;
      font-weight: 700;
      color: #0369a1;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .rover-contact-form .rover-form-field {
      margin-bottom: 10px;
    }
    .rover-contact-form label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      color: #475569;
      margin-bottom: 3px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .rover-contact-form input,
    .rover-contact-form textarea {
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 13px;
      outline: none;
      transition: border-color 0.2s;
      background: white;
      box-sizing: border-box;
      font-family: inherit;
    }
    .rover-contact-form input:focus,
    .rover-contact-form textarea:focus {
      border-color: #0ea5e9;
      box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.1);
    }
    .rover-contact-form textarea {
      height: 60px;
      resize: vertical;
    }
    .rover-contact-form .rover-form-row {
      display: flex;
      gap: 8px;
    }
    .rover-contact-form .rover-form-row .rover-form-field {
      flex: 1;
    }
    .rover-contact-submit {
      width: 100%;
      padding: 10px;
      background: linear-gradient(135deg, #0ea5e9, #2563eb);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      margin-top: 4px;
    }
    .rover-contact-submit:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3);
    }
    .rover-contact-submit:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }
    .rover-contact-success {
      text-align: center;
      padding: 16px;
      background: linear-gradient(135deg, #f0fdf4, #dcfce7);
      border: 1px solid #86efac;
      border-radius: 12px;
      animation: roverMsgIn 0.3s ease-out;
      align-self: stretch;
    }
    .rover-contact-success .success-icon {
      font-size: 32px;
      margin-bottom: 8px;
    }
    .rover-contact-success h4 {
      margin: 0 0 4px;
      font-size: 14px;
      color: #166534;
    }
    .rover-contact-success p {
      margin: 0;
      font-size: 12px;
      color: #4ade80;
    }

    /* Mobile adjustments */
    @media (max-width: 440px) {
      #rover-chat {
        width: calc(100vw - 16px);
        right: -16px;
        bottom: 72px;
        height: calc(100vh - 100px);
        border-radius: 16px;
      }
      #rover-fab {
        width: 56px;
        height: 56px;
      }
      #rover-greeting { max-width: 240px; }
      .rover-contact-form .rover-form-row {
        flex-direction: column;
        gap: 0;
      }
    }
  `;
  document.head.appendChild(style);

  // ============================================================
  // BUILD WIDGET HTML
  // ============================================================
  const widget = document.createElement('div');
  widget.id = 'rover-widget';
  widget.innerHTML = `
    <!-- Greeting bubble -->
    <div id="rover-greeting">
      <span class="rover-g-close" onclick="window.__roverCloseGreeting()">&times;</span>
      <span class="rover-g-name">Rover</span> here! 👋<br>
      <span class="rover-greeting-text">Need help with roof measurement reports? I'm here to help!</span>
    </div>

    <!-- Chat window -->
    <div id="rover-chat">
      <div class="rover-header">
        <div class="rover-header-avatar"><img src="/static/logo.png" alt="Roof Manager" style="width:28px;height:28px;object-fit:contain;display:block"></div>
        <div class="rover-header-info">
          <h3>Rover</h3>
          <p>Roof Manager Expert Helper</p>
        </div>
        <button class="rover-header-close" onclick="window.__roverToggle()" title="Close chat">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="rover-messages" id="rover-messages"></div>
      <div class="rover-input-area">
        <input type="text" class="rover-input" id="rover-input" placeholder="Ask Rover anything..." autocomplete="off">
        <button class="rover-send" id="rover-send" onclick="window.__roverSend()">
          <i class="fas fa-paper-plane"></i>
        </button>
      </div>
      <div class="rover-powered">
        Powered by <strong>Roof Manager</strong>
      </div>
    </div>

    <!-- FAB Button -->
    <button id="rover-fab" onclick="window.__roverToggle()">
      <span class="rover-icon"><img src="/static/logo.png" alt="Roof Manager" style="width:34px;height:34px;object-fit:contain;display:block"></span>
      <span class="rover-badge" id="rover-badge">0</span>
    </button>
  `;
  document.body.appendChild(widget);

  // ============================================================
  // CORE FUNCTIONS
  // ============================================================
  const chatEl = document.getElementById('rover-chat');
  const messagesEl = document.getElementById('rover-messages');
  const inputEl = document.getElementById('rover-input');
  const fabEl = document.getElementById('rover-fab');
  const badgeEl = document.getElementById('rover-badge');
  const greetingEl = document.getElementById('rover-greeting');

  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function formatRoverContent(text) {
    return esc(text)
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(\/customer\/login|\/customer\/[a-z-]+|\/pricing|\/blog|\/coverage)/g, '<a href="$1" style="color:inherit;text-decoration:underline;font-weight:600" target="_blank">$1</a>')
      .replace(/(sales@roofmanager\.ca)/g, '<a href="mailto:$1" style="color:inherit;text-decoration:underline;font-weight:600">$1</a>');
  }

  function addMessage(role, content, withActions) {
    state.messages.push({ role, content });
    const msg = document.createElement('div');
    msg.className = 'rover-msg ' + role;
    msg.innerHTML = formatRoverContent(content);

    // Add quick action buttons for first message
    if (withActions) {
      const actions = document.createElement('div');
      actions.className = 'rover-actions';
      const buttons = [
        { text: '📊 What\'s in a report?', msg: 'What\'s included in a roof measurement report?' },
        { text: '💰 How much?', msg: 'How much does a roof report cost?' },
        { text: '🆓 Free trial', msg: 'Can I try it for free?' },
        { text: '📞 Contact us', msg: 'How can I contact your team?' },
        { text: '🏆 Why Roof Manager?', msg: 'Why should I choose Roof Manager over competitors?' }
      ];
      buttons.forEach(function(b) {
        var btn = document.createElement('button');
        btn.className = 'rover-action-btn';
        btn.textContent = b.text;
        btn.onclick = function() {
          inputEl.value = b.msg;
          window.__roverSend();
        };
        actions.appendChild(btn);
      });
      msg.appendChild(actions);
    }

    messagesEl.appendChild(msg);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Render CTA buttons below the latest assistant bubble
  function renderCtas(ctas) {
    if (!ctas || !ctas.length) return;
    var row = document.createElement('div');
    row.className = 'rover-cta-row';
    ctas.forEach(function(cta) {
      var btn;
      if (cta.action === 'link') {
        btn = document.createElement('a');
        btn.href = cta.value || '#';
        btn.target = '_blank';
        btn.rel = 'noopener';
      } else {
        btn = document.createElement('button');
        btn.type = 'button';
      }
      btn.className = 'rover-cta-btn';
      btn.textContent = cta.label;
      btn.addEventListener('click', function() {
        fireRoverEvent('cta_clicked');
        if (cta.action === 'contact_form') showContactForm();
      });
      row.appendChild(btn);
    });
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Render a compact inline email-capture chip right after the first reply.
  // Only shows once per session and only if we haven't already captured email.
  function renderEmailChip() {
    if (state.leadSubmitted) return;
    if (sessionStorage.getItem('rover_email_chip_shown')) return;
    sessionStorage.setItem('rover_email_chip_shown', '1');
    var chip = document.createElement('div');
    chip.className = 'rover-email-chip';
    chip.innerHTML =
      '<span class="chip-label">📬 Get a sample + follow-ups:</span>' +
      '<input type="email" placeholder="you@company.com" aria-label="email" />' +
      '<button type="button">Send</button>' +
      '<button type="button" class="chip-dismiss" aria-label="dismiss">✕</button>';
    var input = chip.querySelector('input');
    var sendBtn = chip.querySelectorAll('button')[0];
    var dismissBtn = chip.querySelector('.chip-dismiss');
    sendBtn.addEventListener('click', function() {
      var email = (input.value || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { input.focus(); return; }
      sendBtn.disabled = true;
      fetch('/api/rover/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: state.sessionId, email: email, source: 'inline_chip' })
      }).catch(function(){}).finally(function() {
        fireRoverEvent('email_captured');
        state.leadSubmitted = true;
        chip.innerHTML = '<span class="chip-label">✅ Got it — we\'ll be in touch!</span>';
      });
    });
    dismissBtn.addEventListener('click', function() { chip.remove(); });
    messagesEl.appendChild(chip);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Show contact form in chat
  function showContactForm() {
    if (state.contactFormShown) return; // Only show once
    state.contactFormShown = true;

    var formDiv = document.createElement('div');
    formDiv.className = 'rover-contact-form';
    formDiv.innerHTML = `
      <h4>📋 Get in Touch</h4>
      <div class="rover-form-row">
        <div class="rover-form-field">
          <label>Name</label>
          <input type="text" id="rover-cf-name" placeholder="Your name">
        </div>
        <div class="rover-form-field">
          <label>Company</label>
          <input type="text" id="rover-cf-company" placeholder="Company name">
        </div>
      </div>
      <div class="rover-form-row">
        <div class="rover-form-field">
          <label>Email *</label>
          <input type="email" id="rover-cf-email" placeholder="you@company.com" required>
        </div>
        <div class="rover-form-field">
          <label>Phone</label>
          <input type="tel" id="rover-cf-phone" placeholder="780-555-0000">
        </div>
      </div>
      <div class="rover-form-field">
        <label>Message</label>
        <textarea id="rover-cf-message" placeholder="How can we help you?"></textarea>
      </div>
      <button class="rover-contact-submit" onclick="window.__roverSubmitContact()">
        Send to Our Team →
      </button>
    `;
    messagesEl.appendChild(formDiv);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // Submit contact form
  window.__roverSubmitContact = async function() {
    var name = document.getElementById('rover-cf-name');
    var email = document.getElementById('rover-cf-email');
    var phone = document.getElementById('rover-cf-phone');
    var company = document.getElementById('rover-cf-company');
    var message = document.getElementById('rover-cf-message');
    var submitBtn = document.querySelector('.rover-contact-submit');

    if (!email || !email.value.trim()) {
      email.style.borderColor = '#ef4444';
      email.focus();
      return;
    }

    // Validate email format
    if (!/\S+@\S+\.\S+/.test(email.value.trim())) {
      email.style.borderColor = '#ef4444';
      email.focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    try {
      var res = await fetch('/api/rover/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: state.sessionId,
          name: name ? name.value.trim() : '',
          email: email.value.trim(),
          phone: phone ? phone.value.trim() : '',
          company: company ? company.value.trim() : '',
          message: message ? message.value.trim() : ''
        })
      });

      // Replace form with success message
      var formEl = document.querySelector('.rover-contact-form');
      if (formEl) {
        var successDiv = document.createElement('div');
        successDiv.className = 'rover-contact-success';
        successDiv.innerHTML = `
          <div class="success-icon">✅</div>
          <h4>Message Sent!</h4>
          <p>Our team will get back to you shortly at ${esc(email.value.trim())}</p>
        `;
        formEl.replaceWith(successDiv);
      }

      // Add Rover confirmation message
      addMessage('assistant', "Thanks for reaching out! Our team has your info and will get back to you shortly. In the meantime, feel free to try our 4 free roof reports at /customer/login — no credit card needed! 🏠");

      state.leadSubmitted = true;
    } catch (e) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send to Our Team →';
      addMessage('assistant', "Sorry, I had trouble sending that. You can also email us directly at sales@roofmanager.ca and we'll get right back to you!");
    }
  };

  function showTyping() {
    var typing = document.createElement('div');
    typing.className = 'rover-typing';
    typing.id = 'rover-typing';
    typing.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(typing);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function hideTyping() {
    var t = document.getElementById('rover-typing');
    if (t) t.remove();
  }

  // Toggle chat open/close
  window.__roverToggle = function() {
    state.open = !state.open;
    chatEl.classList.toggle('open', state.open);
    fabEl.classList.toggle('open', state.open);
    greetingEl.classList.remove('show');

    if (state.open) {
      fireRoverEvent('widget_opened');
      state.unread = 0;
      badgeEl.classList.remove('show');

      // If no messages yet, show greeting
      if (state.messages.length === 0) {
        var greeting = "Hey there! 🐕 I'm Rover, your Roof Manager expert helper! Ask me anything about our AI-powered roof measurement reports, pricing, or features. How can I help you today?";
        addMessage('assistant', greeting, true);
      }

      setTimeout(function() { inputEl.focus(); }, 300);
    }
  };

  // Close greeting bubble
  window.__roverCloseGreeting = function() {
    greetingEl.classList.remove('show');
    sessionStorage.setItem('rover_greeting_dismissed', '1');
  };

  // Send message — uses SSE streaming endpoint, falls back to JSON endpoint
  window.__roverSend = async function() {
    var msg = inputEl.value.trim();
    if (!msg || state.loading) return;

    inputEl.value = '';
    addMessage('user', msg);
    fireRoverEvent('first_message_sent');
    state.loading = true;
    inputEl.disabled = true;
    document.getElementById('rover-send').disabled = true;
    showTyping();

    // Safety timeout — 30s for streaming
    var safetyTimeout = setTimeout(function() {
      state.loading = false;
      inputEl.disabled = false;
      document.getElementById('rover-send').disabled = false;
      hideTyping();
      addMessage('assistant', "Sorry, that took too long! Please try again or email sales@roofmanager.ca");
    }, 30000);

    var msgEl = null;   // streaming bubble element
    var fullContent = '';

    try {
      var res = await fetch('/api/rover/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: state.sessionId,
          message: msg,
          page_url: window.location.pathname
        })
      });

      clearTimeout(safetyTimeout);

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

            if (data.delta) {
              if (!msgEl) {
                // Create the assistant bubble on first token
                msgEl = document.createElement('div');
                msgEl.className = 'rover-msg assistant';
                messagesEl.appendChild(msgEl);
              }
              fullContent += data.delta;
              msgEl.innerHTML = formatRoverContent(fullContent);
              messagesEl.scrollTop = messagesEl.scrollHeight;
            }

            if (data.done) {
              if (data.show_contact_form) showContactForm();
              // Final re-render with full formatting
              if (msgEl) msgEl.innerHTML = formatRoverContent(fullContent);
              if (data.ctas && data.ctas.length) renderCtas(data.ctas);
              if (data.ask_email) renderEmailChip();
            }
          } catch (e) { /* malformed SSE chunk — skip */ }
        }
      }

      // If the stream returned nothing at all, show a fallback
      if (!fullContent) {
        addMessage('assistant', "I'm having a quick technical hiccup! You can reach us at sales@roofmanager.ca or sign up at /customer/login for 4 free reports.");
        showContactForm();
      }

      if (!state.open) {
        state.unread++;
        badgeEl.textContent = state.unread;
        badgeEl.classList.add('show');
      }

    } catch (e) {
      clearTimeout(safetyTimeout);
      hideTyping();

      // Streaming failed — fall back to the non-streaming JSON endpoint
      try {
        var fallback = await fetch('/api/rover/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: state.sessionId, message: msg, page_url: window.location.pathname })
        });
        if (fallback.ok) {
          var fd = await fallback.json();
          if (fd.reply) addMessage('assistant', fd.reply);
          if (fd.show_contact_form) showContactForm();
          if (fd.ctas && fd.ctas.length) renderCtas(fd.ctas);
          if (fd.ask_email) renderEmailChip();
        } else {
          addMessage('assistant', "Oops, connection issue! You can email us at sales@roofmanager.ca or try again in a moment.");
          showContactForm();
        }
      } catch (e2) {
        addMessage('assistant', "Oops, connection issue! You can email us at sales@roofmanager.ca or try again in a moment.");
        showContactForm();
      }
    } finally {
      state.loading = false;
      inputEl.disabled = false;
      document.getElementById('rover-send').disabled = false;
      inputEl.focus();
    }
  };

  // Enter key to send
  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      window.__roverSend();
    }
  });

  // ============================================================
  // RESTORE HISTORY ON LOAD
  // ============================================================
  async function restoreHistory() {
    try {
      var res = await fetch('/api/rover/history?session_id=' + state.sessionId);
      if (res.ok) {
        var data = await res.json();
        if (data.messages && data.messages.length > 0) {
          data.messages.forEach(function(m) {
            state.messages.push({ role: m.role, content: m.content });
            var msgEl = document.createElement('div');
            msgEl.className = 'rover-msg ' + m.role;
            msgEl.innerHTML = formatRoverContent(m.content);
            messagesEl.appendChild(msgEl);
          });
        }
      }
    } catch (e) { /* silent failure on history restore */ }
  }
  restoreHistory();

  // Always ensure clean loading state on page load
  state.loading = false;
  if (inputEl) inputEl.disabled = false;
  var sendBtn = document.getElementById('rover-send');
  if (sendBtn) sendBtn.disabled = false;

  // ============================================================
  // AUTO-SHOW GREETING — page-tailored hook after dwell
  // Writes into the existing greeting bubble so visitors see a relevant
  // nudge instead of a generic "click to chat" prompt.
  // ============================================================
  function pageHook() {
    var p = (location.pathname || '').toLowerCase();
    if (p.indexOf('/pricing') === 0) return "Looking at pricing? Ask me how to get 4 free reports 👀";
    if (p.indexOf('/coverage') === 0) return "Checking coverage? Tell me your city — I can confirm instantly 🌍";
    if (p.indexOf('/customer/login') === 0 || p.indexOf('/register') === 0) return "Need help signing up? I'll walk you through — 4 free reports, no card 🎁";
    if (p.indexOf('/blog') === 0 || p.indexOf('/help') === 0) return "Want a shortcut? I can explain it in 30 seconds 💡";
    if (p.indexOf('/secretary') === 0 || p.indexOf('receptionist') >= 0) return "Curious about the AI Secretary? Ask me how it catches every call 📞";
    if (p.indexOf('/solar') === 0) return "Solar question? I've got pitch, area & yield info 🌞";
    if (p === '/' || p === '') return "Hey! Want to see how Roof Manager saves you 20+ min per report? 🐕";
    return "Hey! Got a roofing question? I can help 🐕";
  }
  var greetingDismissed = sessionStorage.getItem('rover_greeting_dismissed');
  if (!greetingDismissed && greetingEl) {
    try {
      var textEl = greetingEl.querySelector('.rover-greeting-text');
      if (textEl) textEl.textContent = pageHook();
    } catch (e) {}
    // Click the bubble body (not the X) to open the chat
    greetingEl.addEventListener('click', function(e) {
      if (e.target && e.target.classList && e.target.classList.contains('rover-g-close')) return;
      if (!state.open) window.__roverToggle();
    });
    setTimeout(function() {
      if (!state.open) {
        greetingEl.classList.add('show');
        setTimeout(function() {
          if (!state.open) greetingEl.classList.remove('show');
        }, 12000);
      }
    }, 8000);
  }

  // Exit-intent (desktop) — open widget when the cursor darts toward top.
  // Fires at most once per session.
  document.addEventListener('mouseout', function(e) {
    if (state.open) return;
    if (sessionStorage.getItem('rover_exit_intent_fired')) return;
    if (e.clientY > 10) return;
    if (e.relatedTarget || e.toElement) return;
    sessionStorage.setItem('rover_exit_intent_fired', '1');
    window.__roverToggle();
  });

  // ============================================================
  // END CONVERSATION ON PAGE UNLOAD
  // ============================================================
  window.addEventListener('beforeunload', function() {
    if (state.messages.length > 2) {
      navigator.sendBeacon('/api/rover/end', JSON.stringify({
        session_id: state.sessionId
      }));
    }
  });

})();

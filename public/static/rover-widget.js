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
      background: linear-gradient(135deg, #0ea5e9, #2563eb);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 8px 30px rgba(14, 165, 233, 0.4);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
    }
    #rover-fab:hover {
      transform: scale(1.08);
      box-shadow: 0 12px 40px rgba(14, 165, 233, 0.5);
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
      Need help with roof measurement reports? I'm here to help!
    </div>

    <!-- Chat window -->
    <div id="rover-chat">
      <div class="rover-header">
        <div class="rover-header-avatar">🐕</div>
        <div class="rover-header-info">
          <h3>Rover</h3>
          <p>RoofReporterAI Expert Helper</p>
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
        Powered by <strong>RoofReporterAI</strong>
      </div>
    </div>

    <!-- FAB Button -->
    <button id="rover-fab" onclick="window.__roverToggle()">
      <span class="rover-icon">🐕</span>
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

  function addMessage(role, content, withActions) {
    state.messages.push({ role, content });
    const msg = document.createElement('div');
    msg.className = 'rover-msg ' + role;

    // Process content: convert links and line breaks
    let html = esc(content)
      .replace(/\n/g, '<br>')
      .replace(/(\/customer\/login|\/pricing|\/blog)/g, '<a href="$1" style="color:inherit;text-decoration:underline;font-weight:600" target="_blank">$1</a>')
      .replace(/(reports@reusecanada\.ca)/g, '<a href="mailto:$1" style="color:inherit;text-decoration:underline;font-weight:600">$1</a>')
      .replace(/(roofreporterai\.com)/g, '<a href="https://$1" style="color:inherit;text-decoration:underline;font-weight:600" target="_blank">$1</a>');
    
    msg.innerHTML = html;

    // Add quick action buttons for first message
    if (withActions) {
      const actions = document.createElement('div');
      actions.className = 'rover-actions';
      const buttons = [
        { text: '📊 What\'s in a report?', msg: 'What\'s included in a roof measurement report?' },
        { text: '💰 How much?', msg: 'How much does a roof report cost?' },
        { text: '🆓 Free trial', msg: 'Can I try it for free?' },
        { text: '📞 Contact us', msg: 'How can I contact your team?' },
        { text: '🏆 Why RoofReporterAI?', msg: 'Why should I choose RoofReporterAI over competitors?' }
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
      addMessage('assistant', "Thanks for reaching out! Our team has your info and will get back to you shortly. In the meantime, feel free to try our 3 free roof reports at /customer/login — no credit card needed! 🏠");

      state.leadSubmitted = true;
    } catch (e) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send to Our Team →';
      addMessage('assistant', "Sorry, I had trouble sending that. You can also email us directly at reports@reusecanada.ca and we'll get right back to you!");
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
      state.unread = 0;
      badgeEl.classList.remove('show');

      // If no messages yet, show greeting
      if (state.messages.length === 0) {
        var greeting = "Hey there! 🐕 I'm Rover, your RoofReporterAI expert helper! Ask me anything about our AI-powered roof measurement reports, pricing, or features. How can I help you today?";
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

  // Send message
  window.__roverSend = async function() {
    var msg = inputEl.value.trim();
    if (!msg || state.loading) return;

    inputEl.value = '';
    addMessage('user', msg);
    state.loading = true;
    inputEl.disabled = true;
    document.getElementById('rover-send').disabled = true;
    showTyping();

    try {
      var res = await fetch('/api/rover/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: state.sessionId,
          message: msg,
          page_url: window.location.pathname
        })
      });

      hideTyping();

      if (res.ok) {
        var data = await res.json();
        
        if (data.reply) {
          addMessage('assistant', data.reply);
        } else if (data.error) {
          addMessage('assistant', data.error);
        }

        // Show contact form if API indicates it
        if (data.show_contact_form) {
          showContactForm();
        }

        // Check if the reply mentions filling out a contact form or reaching out
        if (data.reply && (
          data.reply.includes('fill out the contact form') ||
          data.reply.includes('contact form below')
        )) {
          showContactForm();
        }

        if (!state.open) {
          state.unread++;
          badgeEl.textContent = state.unread;
          badgeEl.classList.add('show');
        }
      } else {
        // Server error — show fallback + contact form
        addMessage('assistant', "I'm having a quick technical hiccup! You can reach us at reports@reusecanada.ca or sign up at /customer/login for 3 free reports. Or fill out the contact form below and our team will reach out! 😊");
        showContactForm();
      }
    } catch (e) {
      hideTyping();
      addMessage('assistant', "Oops, connection issue! You can email us at reports@reusecanada.ca or fill out the contact form below. We'll get back to you right away!");
      showContactForm();
    }

    state.loading = false;
    inputEl.disabled = false;
    document.getElementById('rover-send').disabled = false;
    inputEl.focus();
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
            msgEl.innerHTML = esc(m.content)
              .replace(/\n/g, '<br>')
              .replace(/(\/customer\/login|\/pricing|\/blog)/g, '<a href="$1" style="color:inherit;text-decoration:underline;font-weight:600" target="_blank">$1</a>')
              .replace(/(reports@reusecanada\.ca)/g, '<a href="mailto:$1" style="color:inherit;text-decoration:underline;font-weight:600">$1</a>');
            messagesEl.appendChild(msgEl);
          });
        }
      }
    } catch (e) { /* silent failure on history restore */ }
  }
  restoreHistory();

  // ============================================================
  // AUTO-SHOW GREETING AFTER DELAY
  // ============================================================
  var greetingDismissed = sessionStorage.getItem('rover_greeting_dismissed');
  if (!greetingDismissed) {
    setTimeout(function() {
      if (!state.open) {
        greetingEl.classList.add('show');
        setTimeout(function() {
          if (!state.open) greetingEl.classList.remove('show');
        }, 10000);
      }
    }, 5000);
  }

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

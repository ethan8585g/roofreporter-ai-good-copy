// ============================================================
// Roofer Secretary — AI Phone Answering Service Frontend
// v2.0: Full telephony integration with phone connection wizard
// Flow: Subscribe → Configure → Connect Phone → Activate
// ============================================================
(function() {
  'use strict';
  var root = document.getElementById('secretary-root');
  if (!root) return;

  function getToken() { return localStorage.getItem('rc_customer_token') || ''; }
  function authHeaders() { return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }; }
  function authOnly() { return { 'Authorization': 'Bearer ' + getToken() }; }

  var state = {
    loading: true,
    subscription: null,
    hasActive: false,
    config: null,
    directories: [],
    totalCalls: 0,
    isConfigured: false,
    isActive: false,
    calls: [],
    activeTab: 'setup',
    saving: false,
    // Mode
    secretaryMode: 'directory',
    // Messages (answering mode)
    messages: [],
    unreadCount: 0,
    // Appointments (full mode)
    appointments: [],
    pendingAppts: 0,
    // Callbacks (full mode)
    callbacks: [],
    pendingCallbacks: 0,
    // Phone connection state
    phoneSetup: null,
    carriers: [],
    selectedCarrier: '',
    connectStep: 1,
    // Quick Connect state
    quickConnect: {},
    // Leads
    leads: [],
    leadsCount: 0,
    leadStages: [],
    // Call detail modal
    callDetail: null,
    // Customer info
    customerCompany: '',
    // Agent persona selection
    selectedAgentName: '',
    selectedAgentVoice: '',
  };

  // ── On load: check for Square redirect, then fetch status ──
  async function init() {
    try { var cd = JSON.parse(localStorage.getItem('rc_customer') || '{}'); state.customerCompany = cd.company_name || cd.brand_business_name || ''; } catch(e) {}
    var params = new URLSearchParams(window.location.search);
    if (params.get('setup') === 'true' && params.get('session_id')) {
      try {
        await fetch('/api/secretary/verify-session', {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({ session_id: params.get('session_id') })
        });
      } catch(e) {}
      window.history.replaceState({}, '', '/customer/secretary');
    }
    await loadStatus();
    await loadCarriers();
  }

  async function loadStatus() {
    state.loading = true;
    render();
    try {
      var res = await fetch('/api/secretary/status', { headers: authOnly() });
      if (res.ok) {
        var data = await res.json();
        state.subscription = data.subscription;
        state.hasActive = data.has_active_subscription;
        state.config = data.config;
        state.directories = data.directories || [];
        state.totalCalls = data.total_calls;
        state.isConfigured = data.is_configured;
        state.isActive = data.is_active;
        state.secretaryMode = data.secretary_mode || (data.config && data.config.secretary_mode) || 'directory';
        state.isDev = !!data.is_dev;
        // Load agent persona from config
        if (data.config) {
          state.selectedAgentName = data.config.agent_name || 'Sarah';
          state.selectedAgentVoice = data.config.agent_voice || 'alloy';
        }
      }
    } catch(e) { console.error('Failed to load status', e); }

    // Load phone setup status
    try {
      var res2 = await fetch('/api/secretary/phone-setup', { headers: authOnly() });
      if (res2.ok) {
        var data2 = await res2.json();
        state.phoneSetup = data2.setup;
        if (data2.setup) {
          state.selectedCarrier = data2.setup.carrier_name || '';
        }
      }
    } catch(e) {}

    // Load quick-connect status for the new simplified flow
    try {
      var res3 = await fetch('/api/secretary/quick-connect/status', { headers: authOnly() });
      if (res3.ok) {
        var qcData = await res3.json();
        if (qcData.ai_phone_number) {
          state.quickConnect = state.quickConnect || {};
          state.quickConnect.ai_phone_number = qcData.ai_phone_number;
          state.quickConnect.ai_phone_display = qcData.ai_phone_display;
          state.quickConnect.business_phone = qcData.business_phone;
          state.quickConnect.business_phone_display = qcData.business_phone_display;
          state.quickConnect.connected = qcData.status === 'connected';
        }
      }
    } catch(e) {}

    // Load leads count
    try {
      var res4 = await fetch('/api/secretary/leads?limit=1', { headers: authOnly() });
      if (res4.ok) {
        var leadsData = await res4.json();
        state.leadsCount = leadsData.total || 0;
        state.leadStages = leadsData.stages || [];
      }
    } catch(e) {}

    // Check URL params for tab deep-linking
    var urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('tab')) state.activeTab = urlParams.get('tab');

    state.loading = false;
    render();
  }

  async function loadCarriers() {
    try {
      var res = await fetch('/api/secretary/carriers', { headers: authOnly() });
      if (res.ok) {
        var data = await res.json();
        state.carriers = data.carriers || [];
      }
    } catch(e) {}
  }

  // ── RENDER ──
  function render() {
    if (state.loading) {
      root.innerHTML = '<div class="flex items-center justify-center py-20"><i class="fas fa-spinner fa-spin text-3xl text-sky-500"></i></div>';
      return;
    }
    if (!state.hasActive) { renderSubscriptionPage(); return; }

    root.innerHTML =
      '<div class="flex flex-wrap gap-2 mb-6">' +
        tabBtn('setup', 'fa-cog', 'Setup & Config') +
        tabBtn('connect', 'fa-phone-alt', 'Connect Phone') +
        tabBtn('calls', 'fa-history', 'Call Log' + (state.totalCalls > 0 ? ' (' + state.totalCalls + ')' : '')) +
        tabBtn('leads', 'fa-fire', 'Leads' + (state.leadsCount > 0 ? ' (' + state.leadsCount + ')' : '')) +
        (state.secretaryMode === 'answering' ? tabBtn('messages', 'fa-envelope', 'Messages' + (state.unreadCount > 0 ? ' (' + state.unreadCount + ')' : '')) : '') +
        (state.secretaryMode === 'full' ? tabBtn('appointments', 'fa-calendar-check', 'Appointments' + (state.pendingAppts > 0 ? ' (' + state.pendingAppts + ')' : '')) : '') +
        (state.secretaryMode === 'full' ? tabBtn('callbacks', 'fa-phone-volume', 'Callbacks' + (state.pendingCallbacks > 0 ? ' (' + state.pendingCallbacks + ')' : '')) : '') +
      '</div>' +
      '<div id="secContent"></div>';

    if (state.activeTab === 'setup') renderSetupTab();
    else if (state.activeTab === 'connect') renderConnectTab();
    else if (state.activeTab === 'messages') loadAndRenderMessages();
    else if (state.activeTab === 'appointments') loadAndRenderAppointments();
    else if (state.activeTab === 'callbacks') loadAndRenderCallbacks();
    else if (state.activeTab === 'calls') renderCallsTab();
    else if (state.activeTab === 'leads') renderLeadsTab();
  }

  function tabBtn(id, icon, label) {
    var active = state.activeTab === id;
    var isConnect = id === 'connect';
    var needsAttention = isConnect && state.phoneSetup && state.phoneSetup.connection_status !== 'connected';
    return '<button onclick="secSetTab(\'' + id + '\')" class="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ' +
      (active ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg' :
       needsAttention ? 'bg-amber-50 text-amber-700 border-2 border-amber-300 animate-pulse' :
       'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200') +
      '"><i class="fas ' + icon + ' text-xs"></i>' + label +
      (needsAttention ? ' <span class="w-2 h-2 bg-amber-500 rounded-full"></span>' : '') +
      '</button>';
  }
  window.secSetTab = function(t) { state.activeTab = t; render(); if (t === 'calls') loadCalls(); if (t === 'leads') loadLeads(); if (t === 'messages') loadAndRenderMessages(); if (t === 'appointments') loadAndRenderAppointments(); if (t === 'callbacks') loadAndRenderCallbacks(); };

  // ============================================================
  // SUBSCRIPTION PAGE — Contact Us for Enrolment
  // ============================================================
  function renderSubscriptionPage() {
    // Pre-fill from customer data if available
    var custData = {};
    try { custData = JSON.parse(localStorage.getItem('rc_customer') || '{}'); } catch(e) {}

    root.innerHTML =
      '<div class="max-w-2xl mx-auto px-4">' +
        '<div class="bg-gradient-to-br from-sky-500 to-blue-700 rounded-2xl p-6 sm:p-8 text-white text-center mb-8 shadow-xl">' +
          '<div class="w-20 h-20 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4"><i class="fas fa-headset text-4xl"></i></div>' +
          '<h2 class="text-2xl sm:text-3xl font-extrabold mb-2">Roofer Secretary</h2>' +
          '<p class="text-sky-100 text-base sm:text-lg">AI-Powered Phone Answering Service</p>' +
          '<p class="text-sky-200 text-sm mt-2">Never miss a customer call again. AI answers <strong>only when you can\'t</strong> — your phone rings first. Works with your existing business number.</p>' +
        '</div>' +

        '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 sm:p-6 mb-6">' +
          '<h3 class="font-bold text-gray-800 text-lg mb-4"><i class="fas fa-check-circle text-green-500 mr-2"></i>What You Get</h3>' +
          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">' +
            feature('fa-phone-alt', 'Keep Your Number', 'Connects to your existing business phone — no new number needed') +
            feature('fa-user-clock', 'Answers Only If You Can\'t', 'Your phone rings first. AI only picks up when you miss or are busy — like a real secretary') +
            feature('fa-sms', 'SMS Call Summary', 'Get a text with a full transcript and summary after every AI-handled call') +
            feature('fa-route', 'Smart Routing', 'Route callers to Parts, Sales, Service, etc.') +
            feature('fa-comment-dots', 'Custom Greeting', 'Your business, your script, your personality') +
            feature('fa-question-circle', 'FAQ Handling', 'AI answers common questions automatically') +
          '</div>' +
        '</div>' +

        '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 sm:p-6 mb-6">' +
          '<h3 class="font-bold text-gray-800 text-lg mb-4"><i class="fas fa-plug text-sky-500 mr-2"></i>How It Works</h3>' +
          '<div class="space-y-4">' +
            howStep(1, 'Request Enrolment', 'Fill out the form below and our team will contact you to get started.') +
            howStep(2, 'Personalized Setup', 'We\'ll configure your AI secretary with your greeting script, FAQ answers, and call routing departments.') +
            howStep(3, 'Connect Your Phone', 'Enter your business phone number and verify. Your AI secretary goes live instantly.') +
            howStep(4, 'AI Answers When You Can\'t', 'Your phone rings first. If you don\'t answer, the AI picks up, greets the caller, answers questions, routes to departments, and takes messages.') +
          '</div>' +
        '</div>' +

        // ── Contact Us for Enrolment Form ──
        '<div class="bg-white rounded-2xl border-2 border-sky-500 shadow-lg p-4 sm:p-6 mb-6">' +
          '<div class="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-2">' +
            '<div><h3 class="font-bold text-gray-800 text-xl"><i class="fas fa-paper-plane text-sky-500 mr-2"></i>Contact Us for Enrolment</h3><p class="text-gray-500 text-sm mt-1">Our team will personally set up your AI Secretary</p></div>' +
            '<div class="text-right"><div class="text-2xl sm:text-3xl font-extrabold text-sky-600">$249<span class="text-sm font-normal text-gray-500">/mo CAD</span></div></div>' +
          '</div>' +
          '<div id="enrollFormContainer">' +
            '<div class="space-y-4">' +
              '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
                '<div><label class="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>' +
                  '<input type="text" id="enrollName" value="' + (custData.name || '') + '" class="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none" placeholder="John Smith"></div>' +
                '<div><label class="block text-sm font-medium text-gray-700 mb-1">Email *</label>' +
                  '<input type="email" id="enrollEmail" value="' + (custData.email || '') + '" class="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none" placeholder="john@roofingco.com"></div>' +
              '</div>' +
              '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +
                '<div><label class="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>' +
                  '<input type="tel" id="enrollPhone" value="' + (custData.phone || '') + '" class="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none" placeholder="(780) 555-0123"></div>' +
                '<div><label class="block text-sm font-medium text-gray-700 mb-1">Company Name</label>' +
                  '<input type="text" id="enrollCompany" value="' + (custData.company_name || custData.brand_business_name || '') + '" class="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none" placeholder="ABC Roofing Ltd."></div>' +
              '</div>' +
              '<div><label class="block text-sm font-medium text-gray-700 mb-1">Message (optional)</label>' +
                '<textarea id="enrollMessage" rows="3" class="w-full px-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none resize-none" placeholder="Tell us about your business and how many calls you typically receive..."></textarea></div>' +
            '</div>' +
            '<button onclick="secSubmitEnrollment()" id="enrollBtn" class="w-full mt-4 py-4 bg-gradient-to-r from-sky-500 to-blue-600 text-white rounded-xl font-bold text-lg hover:from-sky-600 hover:to-blue-700 transition-all shadow-lg hover:shadow-xl">' +
              '<i class="fas fa-paper-plane mr-2"></i>Request Enrolment</button>' +
          '</div>' +
        '</div>' +
        '<p class="text-center text-xs text-gray-400 mb-8"><i class="fas fa-shield-alt mr-1"></i>Our team will contact you within 24 hours &bull; Powered by LiveKit AI</p>' +
      '</div>';
  }

  function feature(icon, title, desc) {
    return '<div class="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">' +
      '<div class="w-8 h-8 bg-sky-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"><i class="fas ' + icon + ' text-sky-600 text-sm"></i></div>' +
      '<div><p class="font-semibold text-gray-800 text-sm">' + title + '</p><p class="text-gray-500 text-xs">' + desc + '</p></div></div>';
  }

  function howStep(num, title, desc) {
    return '<div class="flex items-start gap-4">' +
      '<div class="w-10 h-10 bg-sky-500 text-white rounded-full flex items-center justify-center flex-shrink-0 font-bold text-lg">' + num + '</div>' +
      '<div><p class="font-semibold text-gray-800">' + title + '</p><p class="text-gray-500 text-sm">' + desc + '</p></div></div>';
  }

  window.secSubmitEnrollment = async function() {
    var btn = document.getElementById('enrollBtn');
    var name = document.getElementById('enrollName').value.trim();
    var email = document.getElementById('enrollEmail').value.trim();
    var phone = document.getElementById('enrollPhone').value.trim();
    var company = document.getElementById('enrollCompany').value.trim();
    var message = document.getElementById('enrollMessage').value.trim();
    if (!name || !email) { alert('Please enter your name and email.'); return; }
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Submitting...'; }
    try {
      var res = await fetch('/api/secretary/enroll-inquiry', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ name: name, email: email, phone: phone, company_name: company, message: message })
      });
      var data = await res.json();
      if (data.success) {
        document.getElementById('enrollFormContainer').innerHTML =
          '<div class="text-center py-8">' +
            '<div class="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4"><i class="fas fa-check-circle text-green-500 text-3xl"></i></div>' +
            '<h3 class="text-xl font-bold text-gray-800 mb-2">Enrolment Request Received!</h3>' +
            '<p class="text-gray-500">Thank you, ' + name + '. Our team will contact you within 24 hours to set up your AI Secretary service.</p>' +
            '<p class="text-gray-400 text-sm mt-4"><i class="fas fa-phone mr-1"></i>Questions? Call us anytime.</p>' +
          '</div>';
      } else {
        alert(data.error || 'Failed to submit. Please try again.');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>Request Enrolment'; }
      }
    } catch(e) { alert('Network error. Please try again.'); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-paper-plane mr-2"></i>Request Enrolment'; } }
  };

  // ============================================================
  // SETUP TAB — Config form + Directories (existing, streamlined)
  // ============================================================
  function renderSetupTab() {
    var c = state.config || {};
    var dirs = state.directories.length > 0 ? state.directories : [
      { name: 'Sales / Estimates', phone_or_action: '(780) 555-0101', special_notes: 'Free estimates, new roof quotes, storm damage assessments. Available Mon-Fri 8am-5pm.' },
      { name: 'Service / Repairs', phone_or_action: '(780) 555-0102', special_notes: 'Emergency leak repairs, shingle replacement, flashing repairs. 24/7 emergency line.' },
      { name: 'Office / Billing', phone_or_action: 'Take a message', special_notes: 'Invoice questions, payment arrangements, warranty claims. Office hours Mon-Fri 9am-4pm.' },
    ];

    var content = document.getElementById('secContent');
    if (!content) return;

    // Status bar
    var statusHtml = '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-6">' +
      '<div class="flex items-center justify-between flex-wrap gap-3">' +
        '<div class="flex items-center gap-3">' +
          '<div class="w-10 h-10 rounded-full flex items-center justify-center ' + (state.isActive ? 'bg-green-100' : 'bg-gray-100') + '">' +
            '<i class="fas ' + (state.isActive ? 'fa-check-circle text-green-600' : 'fa-pause-circle text-gray-400') + ' text-lg"></i></div>' +
          '<div><p class="font-bold text-gray-800">' + (state.isActive ? 'Service ACTIVE' : 'Service PAUSED') + '</p>' +
            '<p class="text-xs text-gray-500">' +
              (state.phoneSetup?.connection_status === 'connected' ? '<span class="text-green-600"><i class="fas fa-link mr-1"></i>Phone Connected</span>' :
               state.phoneSetup?.assigned_phone_number ? '<span class="text-amber-600"><i class="fas fa-exclamation-triangle mr-1"></i>Phone Setup Incomplete</span>' :
               '<span class="text-gray-400"><i class="fas fa-phone-slash mr-1"></i>No Phone Connected</span>') +
              ' &bull; ' + (state.subscription?.status || 'unknown') + '</p></div></div>' +
        '<div class="flex gap-2">' +
          (state.phoneSetup?.connection_status !== 'connected' ? '<button onclick="secSetTab(\'connect\')" class="px-4 py-2 rounded-xl text-sm font-semibold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-all"><i class="fas fa-phone-alt mr-1"></i>Connect Phone</button>' : '') +
          '<button onclick="secToggle()" class="px-4 py-2 rounded-xl text-sm font-semibold transition-all ' +
            (state.isActive ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200' : 'bg-green-50 text-green-600 hover:bg-green-100 border border-green-200') + '">' +
            '<i class="fas ' + (state.isActive ? 'fa-pause' : 'fa-play') + ' mr-1"></i>' + (state.isActive ? 'Pause' : 'Activate') + '</button>' +
        '</div></div></div>';

    // Getting Started checklist
    var hasGreeting = !!(state.config && state.config.greeting_script);
    var hasDirs = !!(state.directories && state.directories.length >= 2);
    var hasPhone = !!(state.phoneSetup && state.phoneSetup.connection_status === 'connected');
    var checkDone = function(done) { return done ? '<i class="fas fa-check-circle text-green-500 mr-2"></i>' : '<i class="far fa-circle text-gray-300 mr-2"></i>'; };
    var stepsComplete = 2 + (hasGreeting ? 1 : 0) + (hasDirs ? 1 : 0) + (hasPhone ? 1 : 0);
    var checklistHtml = '';
    if (stepsComplete < 5) {
      checklistHtml = '<div class="bg-gradient-to-r from-sky-50 to-blue-50 border border-sky-200 rounded-2xl p-5 mb-6">' +
        '<div class="flex items-center justify-between mb-3"><h3 class="font-bold text-sky-800 text-sm"><i class="fas fa-tasks mr-2"></i>Getting Started</h3><span class="text-xs font-bold text-sky-600 bg-sky-100 px-2 py-0.5 rounded-full">' + stepsComplete + ' of 5 complete</span></div>' +
        '<div class="space-y-2 text-sm">' +
          '<div class="flex items-center text-gray-700">' + checkDone(true) + '<span class="' + (true ? 'text-gray-400 line-through' : '') + '">Account created</span></div>' +
          '<div class="flex items-center text-gray-700">' + checkDone(true) + '<span class="' + (true ? 'text-gray-400 line-through' : '') + '">Secretary subscription active</span></div>' +
          '<div class="flex items-center text-gray-700">' + checkDone(hasGreeting) + '<span class="' + (hasGreeting ? 'text-gray-400 line-through' : 'font-medium') + '">Customize greeting script</span>' + (!hasGreeting ? ' <button onclick="document.getElementById(\'secGreeting\')?.focus()" class="ml-2 text-xs text-sky-600 hover:underline">Set up</button>' : '') + '</div>' +
          '<div class="flex items-center text-gray-700">' + checkDone(hasDirs) + '<span class="' + (hasDirs ? 'text-gray-400 line-through' : 'font-medium') + '">Set up call directories (2-4 depts)</span>' + (!hasDirs ? ' <button onclick="document.getElementById(\'secDirs\')?.scrollIntoView({behavior:\'smooth\'})" class="ml-2 text-xs text-sky-600 hover:underline">Set up</button>' : '') + '</div>' +
          '<div class="flex items-center text-gray-700">' + checkDone(hasPhone) + '<span class="' + (hasPhone ? 'text-gray-400 line-through' : 'font-medium') + '">Connect phone (call forwarding)</span>' + (!hasPhone ? ' <button onclick="secSetTab(\'connect\')" class="ml-2 text-xs text-sky-600 hover:underline">Connect</button>' : '') + '</div>' +
        '</div>' +
        '<div class="mt-3 bg-sky-100 rounded-lg h-2"><div class="bg-sky-500 rounded-lg h-2 transition-all" style="width:' + (stepsComplete / 5 * 100) + '%"></div></div>' +
      '</div>';
    }

    content.innerHTML = statusHtml + checklistHtml +

      // MODE SELECTOR — 3 Secretary Modes
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">' +
        '<h3 class="font-bold text-gray-800 text-lg mb-1"><i class="fas fa-sliders-h text-sky-500 mr-2"></i>Secretary Mode</h3>' +
        '<p class="text-gray-500 text-sm mb-4">Choose how your AI secretary operates</p>' +
        '<div class="grid grid-cols-1 md:grid-cols-3 gap-4">' +
          modeCard('directory', 'fa-sitemap', 'Directory Service',
            'Routes callers to departments. "Press 1 for Sales, 2 for Service…" Clean, professional call routing.',
            '#0ea5e9', '#f0f9ff') +
          modeCard('answering', 'fa-phone-volume', 'Never-Voicemail Answering',
            'Every call gets a live response. Takes messages, flags urgents, forwards emergencies. No voicemail ever.',
            '#8b5cf6', '#f5f3ff') +
          modeCard('full', 'fa-user-tie', 'Full AI Secretary',
            'Your main office line. Books appointments, answers FAQs, schedules callbacks, sends emails. Does it all.',
            '#059669', '#ecfdf5') +
        '</div>' +
      '</div>' +

      // AGENT PERSONA — Choose voice & name
      renderAgentPersonaSelector(c) +

      // STEP 1: Phone & Greeting
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">' +
        '<h3 class="font-bold text-gray-800 text-lg mb-1"><span class="inline-flex items-center justify-center w-7 h-7 bg-sky-500 text-white rounded-full text-sm font-bold mr-2">1</span>Phone & Greeting Setup</h3>' +
        '<p class="text-gray-500 text-sm mb-4 ml-9">How should your AI secretary answer the phone?</p>' +
        '<div class="space-y-4 ml-9">' +
          '<div>' +
            '<label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-phone mr-1 text-sky-500"></i>Your Business Phone Number</label>' +
            '<input type="tel" id="secPhone" value="' + esc(c.business_phone || '') + '" placeholder="(780) 983-3335" class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-sky-400 focus:border-sky-400">' +
            '<p class="text-xs text-gray-400 mt-1">Your existing business line — the AI only answers when you don\'t pick up. SMS summaries sent to this number after each call.</p></div>' +
          '<div>' +
            '<label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-comment-dots mr-1 text-sky-500"></i>How Should We Answer?</label>' +
            '<textarea id="secGreeting" rows="4" maxlength="3000" placeholder="Thank you for calling ' + esc(state.customerCompany || 'Your Company') + '! My name is ' + esc(c.agent_name || 'Sarah') + '. Sorry we missed your call — I\'m the AI assistant and I can help you right away. How can I help you today?" class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-sky-400 focus:border-sky-400 resize-none">' + esc(c.greeting_script || '') + '</textarea></div>' +
          '<div>' +
            '<label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-question-circle mr-1 text-sky-500"></i>Common Q&A\'s</label>' +
            '<textarea id="secQA" rows="5" maxlength="3000" placeholder="Q: What areas do you serve?\nA: We serve Edmonton, Sherwood Park, St. Albert, Spruce Grove, Leduc, Fort Saskatchewan, Beaumont, and all surrounding areas within 100km of Edmonton.\n\nQ: Do you offer free estimates?\nA: Absolutely! We provide free no-obligation on-site estimates. We can usually get someone out within 1-2 business days.\n\nQ: Do you handle insurance claims?\nA: Yes, we work directly with all major insurance companies on storm damage and hail claims. We\'ll help you through the entire claims process.\n\nQ: What types of roofing do you do?\nA: We do asphalt shingles, metal roofing, flat roofs (TPO/EPDM), cedar shakes, and rubber roofing. Residential and commercial.\n\nQ: Are you licensed and insured?\nA: Yes, fully licensed, insured, and WCB covered. We\'re also a certified CertainTeed and GAF installer." class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-sky-400 focus:border-sky-400 resize-none font-mono text-xs">' + esc(c.common_qa || '') + '</textarea></div>' +
          '<div>' +
            '<label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-sticky-note mr-1 text-sky-500"></i>General Notes</label>' +
            '<textarea id="secNotes" rows="3" maxlength="3000" placeholder="Spring Special: 10% off all full roof replacements booked before June 30th. Mention this offer!\n\nWe\'re currently booking estimates 3-5 business days out due to high demand from recent hail storms.\n\nEmergency repairs (active leaks) — tell callers we offer same-day emergency service, have them press 2 for Service/Repairs.\n\nAfter hours: Take a detailed message with their name, phone, address, and description of the issue. Let them know we\'ll call back first thing next business day." class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-sky-400 focus:border-sky-400 resize-none">' + esc(c.general_notes || '') + '</textarea></div>' +
          '<div class="flex gap-3 flex-wrap">' +
          '<button onclick="secSaveConfig()" id="saveConfigBtn" class="px-6 py-3 bg-sky-500 text-white rounded-xl font-semibold text-sm hover:bg-sky-600 transition-all shadow"><i class="fas fa-save mr-2"></i>Save Configuration</button>' +
          '<button onclick="secTestAgent()" class="px-6 py-3 bg-emerald-500 text-white rounded-xl font-semibold text-sm hover:bg-emerald-600 transition-all shadow"><i class="fas fa-microphone mr-2"></i>Test Agent</button>' +
          '</div>' +
        '</div></div>' +

      // STEP 2: Directories
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">' +
        '<h3 class="font-bold text-gray-800 text-lg mb-1"><span class="inline-flex items-center justify-center w-7 h-7 bg-sky-500 text-white rounded-full text-sm font-bold mr-2">2</span>Call Routing Directories</h3>' +
        '<p class="text-gray-500 text-sm mb-4 ml-9">Set up 2-4 departments the AI can route callers to</p>' +
        '<div id="directoriesList" class="space-y-3 ml-9">' +
          dirs.map(function(d, i) { return dirCard(d, i); }).join('') +
        '</div>' +
        '<div class="ml-9 mt-4 flex gap-3">' +
          '<button onclick="secAddDir()" id="addDirBtn" class="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-200 transition-all ' + (dirs.length >= 4 ? 'opacity-50 cursor-not-allowed' : '') + '" ' + (dirs.length >= 4 ? 'disabled' : '') + '><i class="fas fa-plus mr-1"></i>Add Directory</button>' +
          '<button onclick="secSaveDirs()" id="saveDirsBtn" class="px-6 py-2 bg-sky-500 text-white rounded-xl text-sm font-semibold hover:bg-sky-600 transition-all shadow"><i class="fas fa-save mr-2"></i>Save Directories</button>' +
        '</div></div>' +

      // MODE-SPECIFIC CONFIG
      renderModeSpecificConfig(c);
  }

  // ── Agent Persona Selector — Choose your AI answering agent ──
  function renderAgentPersonaSelector(c) {
    var currentVoice = c.agent_voice || (state.phoneSetup && state.phoneSetup.agent_voice) || 'alloy';
    var currentName = c.agent_name || (state.phoneSetup && state.phoneSetup.agent_name) || 'Sarah';

    // Agent profiles with voice IDs and descriptions
    var agents = [
      { id: 'sarah', name: 'Sarah', voice: 'alloy', gender: 'Female', desc: 'Professional, warm, and confident. Ideal for a friendly front desk feel.', icon: 'fa-user-tie', color: 'from-pink-500 to-rose-600', badge: 'Most Popular' },
      { id: 'emily', name: 'Emily', voice: 'shimmer', gender: 'Female', desc: 'Bright, energetic, and approachable. Great for high-energy sales teams.', icon: 'fa-smile-beam', color: 'from-purple-500 to-violet-600', badge: '' },
      { id: 'jessica', name: 'Jessica', voice: 'nova', gender: 'Female', desc: 'Calm, authoritative, and trustworthy. Perfect for insurance and professional services.', icon: 'fa-user-shield', color: 'from-indigo-500 to-blue-600', badge: '' },
      { id: 'james', name: 'James', voice: 'echo', gender: 'Male', desc: 'Deep, professional, and reassuring. Ideal for contractor and trade businesses.', icon: 'fa-hard-hat', color: 'from-sky-500 to-cyan-600', badge: '' },
      { id: 'mike', name: 'Mike', voice: 'onyx', gender: 'Male', desc: 'Strong, confident, and direct. Great for sales-focused operations.', icon: 'fa-user-check', color: 'from-emerald-500 to-teal-600', badge: '' },
      { id: 'alex', name: 'Alex', voice: 'fable', gender: 'Male', desc: 'Friendly, conversational, and relaxed. Perfect for a casual, personable vibe.', icon: 'fa-comments', color: 'from-amber-500 to-orange-600', badge: '' },
    ];

    var agentCards = agents.map(function(agent) {
      var selected = (currentVoice === agent.voice && currentName === agent.name) || 
                     (!agents.some(function(a) { return a.voice === currentVoice && a.name === currentName; }) && agent.id === 'sarah');
      return '<div onclick="secSelectAgent(\'' + agent.name + '\', \'' + agent.voice + '\')" ' +
        'class="cursor-pointer border-2 rounded-xl p-4 transition-all hover:shadow-lg ' +
        (selected ? 'border-sky-500 shadow-lg ring-2 ring-sky-400/30 bg-sky-50' : 'border-gray-200 hover:border-gray-300 bg-white') + '">' +
        '<div class="flex items-center gap-3 mb-2">' +
          '<div class="w-11 h-11 bg-gradient-to-br ' + agent.color + ' rounded-full flex items-center justify-center shadow-lg flex-shrink-0">' +
            '<i class="fas ' + agent.icon + ' text-white text-sm"></i>' +
          '</div>' +
          '<div class="flex-1 min-w-0">' +
            '<div class="flex items-center gap-2">' +
              '<p class="font-bold text-gray-800 text-sm">' + agent.name + '</p>' +
              '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold ' + (agent.gender === 'Female' ? 'bg-pink-100 text-pink-700' : 'bg-blue-100 text-blue-700') + '">' + agent.gender + '</span>' +
              (agent.badge ? '<span class="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[9px] font-bold">' + agent.badge + '</span>' : '') +
            '</div>' +
            '<p class="text-xs text-gray-500 line-clamp-1">' + agent.desc + '</p>' +
          '</div>' +
          (selected ? '<span class="w-6 h-6 bg-sky-500 rounded-full flex items-center justify-center flex-shrink-0"><i class="fas fa-check text-white text-[10px]"></i></span>' : '<span class="w-6 h-6 border-2 border-gray-300 rounded-full flex-shrink-0"></span>') +
        '</div>' +
      '</div>';
    }).join('');

    return '<div class="bg-white rounded-2xl border-2 border-sky-200 shadow-sm p-6 mb-6">' +
      '<div class="flex items-center gap-3 mb-1">' +
        '<div class="w-10 h-10 bg-gradient-to-br from-sky-500 to-blue-600 rounded-xl flex items-center justify-center shadow"><i class="fas fa-user-astronaut text-white"></i></div>' +
        '<div><h3 class="font-bold text-gray-800 text-lg">Choose Your AI Secretary Agent</h3>' +
        '<p class="text-gray-500 text-sm">Select the voice and personality that represents your business</p></div>' +
      '</div>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">' + agentCards + '</div>' +
      '<div class="mt-3 flex items-center gap-2">' +
        '<div class="flex-1">' +
          '<label class="block text-xs font-semibold text-gray-600 mb-1">Custom Agent Name</label>' +
          '<input type="text" id="agentNameInput" value="' + esc(currentName) + '" placeholder="Sarah" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400 focus:border-sky-400">' +
        '</div>' +
        '<div class="text-xs text-gray-400 self-end pb-2"><i class="fas fa-info-circle mr-1"></i>Your agent will introduce themselves with this name</div>' +
      '</div>' +
    '</div>';
  }

  window.secSelectAgent = function(name, voice) {
    state.selectedAgentName = name;
    state.selectedAgentVoice = voice;
    var input = document.getElementById('agentNameInput');
    if (input) input.value = name;
    render();
  };

  // ── Mode-specific config sections ──
  function renderModeSpecificConfig(c) {
    var mode = state.secretaryMode;
    var el = document.getElementById('secContent');
    if (!el) return;

    if (mode === 'answering') {
      el.innerHTML += renderAnsweringConfig(c);
    } else if (mode === 'full') {
      el.innerHTML += renderFullSecretaryConfig(c);
    }
  }

  function renderAnsweringConfig(c) {
    var fallback = c.answering_fallback_action || 'take_message';
    var fwdNum = c.answering_forward_number || '';
    var notifyEmail = c.answering_notify_email || '';
    return '<div class="bg-white rounded-2xl border-2 border-purple-200 shadow-sm p-6 mb-6">' +
      '<h3 class="font-bold text-gray-800 text-lg mb-1"><span class="inline-flex items-center justify-center w-7 h-7 bg-purple-500 text-white rounded-full text-sm font-bold mr-2"><i class="fas fa-phone-volume text-xs"></i></span>Never-Voicemail Answering Settings</h3>' +
      '<p class="text-gray-500 text-sm mb-4 ml-9">Configure how the AI handles calls when you can\'t answer</p>' +
      '<div class="space-y-4 ml-9">' +
        '<div>' +
          '<label class="block text-sm font-semibold text-gray-700 mb-2"><i class="fas fa-route mr-1 text-purple-500"></i>When a caller reaches the AI:</label>' +
          '<div class="space-y-2">' +
            radioOpt('answering_fallback', 'take_message', 'Take a detailed message', fallback) +
            radioOpt('answering_fallback', 'forward_urgent', 'Take message — forward URGENT calls to a number', fallback) +
            radioOpt('answering_fallback', 'always_forward', 'Take message then offer to transfer caller', fallback) +
          '</div>' +
        '</div>' +
        '<div id="answeringFwdWrap" class="' + (fallback === 'take_message' ? 'hidden' : '') + '">' +
          '<label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-phone mr-1 text-purple-500"></i>Forward-to Number</label>' +
          '<input type="tel" id="answeringFwdNum" value="' + esc(fwdNum) + '" placeholder="(780) 555-0199" class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-purple-400 focus:border-purple-400">' +
          '<p class="text-xs text-gray-400 mt-1">For urgent/emergency calls that need to be forwarded immediately</p>' +
        '</div>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
          '<label class="flex items-center gap-3 p-3 bg-purple-50 rounded-xl cursor-pointer"><input type="checkbox" id="answeringSms" ' + (c.answering_sms_notify !== 0 ? 'checked' : '') + ' class="w-4 h-4 text-purple-500 rounded"><span class="text-sm text-gray-700"><i class="fas fa-sms text-purple-400 mr-1"></i>SMS notify after each call</span></label>' +
          '<label class="flex items-center gap-3 p-3 bg-purple-50 rounded-xl cursor-pointer"><input type="checkbox" id="answeringEmail" ' + (c.answering_email_notify !== 0 ? 'checked' : '') + ' class="w-4 h-4 text-purple-500 rounded"><span class="text-sm text-gray-700"><i class="fas fa-envelope text-purple-400 mr-1"></i>Email notify after each call</span></label>' +
        '</div>' +
        '<div>' +
          '<label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-at mr-1 text-purple-500"></i>Notification Email</label>' +
          '<input type="email" id="answeringNotifyEmail" value="' + esc(notifyEmail) + '" placeholder="owner@yourroofing.ca" class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-purple-400 focus:border-purple-400">' +
        '</div>' +
        '<button onclick="secSaveConfig()" class="px-6 py-3 bg-purple-500 text-white rounded-xl font-semibold text-sm hover:bg-purple-600 transition-all shadow"><i class="fas fa-save mr-2"></i>Save Answering Settings</button>' +
      '</div></div>';
  }

  function renderFullSecretaryConfig(c) {
    var hrs = {};
    try { hrs = JSON.parse(c.full_business_hours || '{}'); } catch(e) {}
    var days = [['mon','Monday'],['tue','Tuesday'],['wed','Wednesday'],['thu','Thursday'],['fri','Friday'],['sat','Saturday'],['sun','Sunday']];

    return '<div class="bg-white rounded-2xl border-2 border-emerald-200 shadow-sm p-6 mb-6">' +
      '<h3 class="font-bold text-gray-800 text-lg mb-1"><span class="inline-flex items-center justify-center w-7 h-7 bg-emerald-500 text-white rounded-full text-sm font-bold mr-2"><i class="fas fa-user-tie text-xs"></i></span>Full AI Secretary Settings</h3>' +
      '<p class="text-gray-500 text-sm mb-4 ml-9">Your AI secretary\'s full capabilities — it can do everything a real secretary does</p>' +
      '<div class="space-y-4 ml-9">' +

        // Capabilities toggles
        '<div><label class="block text-sm font-semibold text-gray-700 mb-2"><i class="fas fa-tasks mr-1 text-emerald-500"></i>Capabilities</label>' +
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-2">' +
          capToggle('fullBookAppts', 'fa-calendar-check', 'Book appointments & estimates', c.full_can_book_appointments !== 0) +
          capToggle('fullAnswerFaq', 'fa-question-circle', 'Answer FAQs about your business', c.full_can_answer_faq !== 0) +
          capToggle('fullScheduleCallback', 'fa-phone-volume', 'Schedule callback requests', c.full_can_schedule_callback !== 0) +
          capToggle('fullSendEmail', 'fa-envelope', 'Send follow-up emails', c.full_can_send_email !== 0) +
          capToggle('fullTakePayment', 'fa-credit-card', 'Collect payment/deposit info', c.full_can_take_payment_info === 1) +
        '</div></div>' +

        // Business hours
        '<div><label class="block text-sm font-semibold text-gray-700 mb-2"><i class="fas fa-clock mr-1 text-emerald-500"></i>Business Hours</label>' +
        '<div class="grid grid-cols-2 md:grid-cols-4 gap-2">' +
          days.map(function(d) {
            return '<div class="bg-gray-50 rounded-lg p-2">' +
              '<label class="block text-xs font-medium text-gray-600 mb-1">' + d[1] + '</label>' +
              '<input type="text" id="fullHrs_' + d[0] + '" value="' + esc(hrs[d[0]] || (d[0] === 'sat' || d[0] === 'sun' ? 'closed' : '9:00-17:00')) + '" placeholder="9:00-17:00 or closed" class="w-full border border-gray-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-emerald-400">' +
            '</div>';
          }).join('') +
        '</div></div>' +

        // Services & info
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
          '<div><label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-tools mr-1 text-emerald-500"></i>Services Offered</label>' +
            '<textarea id="fullServices" rows="4" placeholder="Free roof estimates and inspections\nShingle repair and replacement\nFlat roof systems (TPO, EPDM)\nMetal roofing installation\nEmergency leak repairs (same-day)\nGutter installation and repair\nStorm damage assessment\nInsurance claim assistance" class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-400 resize-none">' + esc(c.full_services_offered || '') + '</textarea></div>' +
          '<div><label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-dollar-sign mr-1 text-emerald-500"></i>Pricing Info (what AI can share)</label>' +
            '<textarea id="fullPricing" rows="4" placeholder="Free estimates — we come to you\nRoof inspections: Free\nMinor repairs: Starting from $250\nFull replacements: Starting from $5,000\nWe match any written quote\nFinancing available OAC" class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-400 resize-none">' + esc(c.full_pricing_info || '') + '</textarea></div>' +
        '</div>' +

        '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
          '<div><label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-map-marker-alt mr-1 text-emerald-500"></i>Service Area</label>' +
            '<input type="text" id="fullServiceArea" value="' + esc(c.full_service_area || '') + '" placeholder="Edmonton, Sherwood Park, St. Albert, Spruce Grove, Leduc + 100km" class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-400"></div>' +
          '<div><label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-link mr-1 text-emerald-500"></i>Online Booking Link (optional)</label>' +
            '<input type="text" id="fullBookingLink" value="' + esc(c.full_booking_link || '') + '" placeholder="https://calendly.com/yourbusiness" class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-400"></div>' +
        '</div>' +

        // Email settings
        '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">' +
          '<div><label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-signature mr-1 text-emerald-500"></i>Email From Name</label>' +
            '<input type="text" id="fullEmailFromName" value="' + esc(c.full_email_from_name || '') + '" placeholder="Reuse Canada Roofing" class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-400"></div>' +
          '<div><label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-file-signature mr-1 text-emerald-500"></i>Email Signature</label>' +
            '<input type="text" id="fullEmailSig" value="' + esc(c.full_email_signature || '') + '" placeholder="Best regards, The Reuse Canada Roofing Team" class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-emerald-400"></div>' +
        '</div>' +

        '<button onclick="secSaveConfig()" class="px-6 py-3 bg-emerald-500 text-white rounded-xl font-semibold text-sm hover:bg-emerald-600 transition-all shadow"><i class="fas fa-save mr-2"></i>Save Full Secretary Settings</button>' +
      '</div></div>';
  }

  function radioOpt(name, value, label, current) {
    return '<label class="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer">' +
      '<input type="radio" name="' + name + '" value="' + value + '" ' + (current === value ? 'checked' : '') + ' onchange="document.getElementById(\'answeringFwdWrap\').classList.toggle(\'hidden\', this.value===\'take_message\')" class="w-4 h-4 text-purple-500">' +
      '<span class="text-sm text-gray-700">' + label + '</span></label>';
  }

  function capToggle(id, icon, label, checked) {
    return '<label class="flex items-center gap-3 p-3 bg-emerald-50 rounded-xl cursor-pointer">' +
      '<input type="checkbox" id="' + id + '" ' + (checked ? 'checked' : '') + ' class="w-4 h-4 text-emerald-500 rounded">' +
      '<span class="text-sm text-gray-700"><i class="fas ' + icon + ' text-emerald-400 mr-1"></i>' + label + '</span></label>';
  }

  function dirCard(d, i) {
    return '<div class="border border-gray-200 rounded-xl p-4 bg-gray-50" data-dir="' + i + '">' +
      '<div class="flex items-center justify-between mb-2">' +
        '<span class="font-semibold text-gray-700 text-sm"><i class="fas fa-folder text-amber-500 mr-1"></i>Directory ' + (i+1) + '</span>' +
        (i >= 2 ? '<button onclick="secRemoveDir(' + i + ')" class="text-red-400 hover:text-red-600 text-xs"><i class="fas fa-trash mr-1"></i>Remove</button>' : '') +
      '</div>' +
      '<div class="grid grid-cols-1 md:grid-cols-3 gap-3">' +
        '<div><label class="block text-xs font-medium text-gray-600 mb-1">Department Name</label>' +
          '<input type="text" id="dirName' + i + '" value="' + esc(d.name || '') + '" placeholder="e.g. Sales / Estimates" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400"></div>' +
        '<div><label class="block text-xs font-medium text-gray-600 mb-1">Transfer To</label>' +
          '<input type="text" id="dirAction' + i + '" value="' + esc(d.phone_or_action || '') + '" placeholder="(780) 555-0101 or Take a message" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400"></div>' +
        '<div><label class="block text-xs font-medium text-gray-600 mb-1">Special Notes</label>' +
          '<input type="text" id="dirNotes' + i + '" value="' + esc(d.special_notes || '') + '" placeholder="Hours, key info, special instructions..." class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400"></div>' +
      '</div></div>';
  }

  function modeCard(mode, icon, title, desc, color, bg) {
    var selected = state.secretaryMode === mode;
    return '<div onclick="secSetMode(\'' + mode + '\')" class="cursor-pointer border-2 rounded-xl p-4 transition-all hover:shadow-md ' +
      (selected ? 'border-[' + color + '] shadow-lg ring-2 ring-[' + color + ']/30' : 'border-gray-200 hover:border-gray-300') + '" ' +
      'style="' + (selected ? 'border-color:' + color + ';background:' + bg : '') + '">' +
      '<div class="flex items-center gap-3 mb-2">' +
        '<div class="w-10 h-10 rounded-xl flex items-center justify-center" style="background:' + color + '20"><i class="fas ' + icon + '" style="color:' + color + ';font-size:16px"></i></div>' +
        '<div class="flex-1"><p class="font-bold text-gray-800 text-sm">' + title + '</p></div>' +
        (selected ? '<span class="w-5 h-5 bg-green-500 rounded-full flex items-center justify-center"><i class="fas fa-check text-white text-[10px]"></i></span>' : '<span class="w-5 h-5 border-2 border-gray-300 rounded-full"></span>') +
      '</div>' +
      '<p class="text-xs text-gray-500 leading-relaxed">' + desc + '</p>' +
    '</div>';
  }

  window.secSetMode = function(mode) {
    state.secretaryMode = mode;
    render();
  };

  // ============================================================
  // CONNECT PHONE TAB — Real Phone Setup Flow
  // Step 1: Enter your business phone + your purchased AI phone number
  // Step 2: Save → get carrier forwarding instructions → set up forwarding
  // Step 3: Press Confirm → deploy agent to LiveKit → LIVE
  // ============================================================
  function renderConnectTab() {
    var content = document.getElementById('secContent');
    if (!content) return;
    var ps = state.phoneSetup || {};
    var qc = state.quickConnect || {};
    var isConnected = ps.connection_status === 'connected' || qc.connected;
    var hasAiNumber = !!(qc.ai_phone_number || ps.assigned_phone_number);
    // Filter out placeholder numbers
    if (hasAiNumber) {
      var aiNum = qc.ai_phone_number || ps.assigned_phone_number || '';
      if (aiNum.includes('0000')) hasAiNumber = false; // Placeholder
    }

    // Determine current step
    var step = 1;
    if (isConnected && hasAiNumber) step = 3;
    else if (hasAiNumber) step = 2;

    var steps = [
      { num: 1, label: 'Enter Phone Numbers', icon: 'fa-phone-alt', done: step > 1 },
      { num: 2, label: 'Set Up Call Forwarding', icon: 'fa-random', done: step > 2 },
      { num: 3, label: 'Live!', icon: 'fa-bolt', done: step >= 3 },
    ];

    var html = '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-6">' +
      '<div class="flex items-center justify-between mb-2">' +
        '<h3 class="font-bold text-gray-800 text-lg"><i class="fas fa-phone-alt text-sky-500 mr-2"></i>Connect Your Phone</h3>' +
        (isConnected ? '<span class="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-semibold"><i class="fas fa-check-circle mr-1"></i>Connected</span>' :
         '<span class="px-3 py-1 bg-sky-50 text-sky-600 rounded-full text-sm font-medium">3 easy steps</span>') +
      '</div>' +
      '<p class="text-gray-500 text-sm mb-4">Enter your business phone number and the AI phone number you purchased from Twilio, Vonage, or Telnyx. Set up call forwarding, confirm, and your AI secretary goes live.</p>' +
      '<div class="flex items-center gap-1">';
    for (var si = 0; si < steps.length; si++) {
      var s = steps[si];
      var isCurrent = step === s.num;
      html += '<div class="flex-1">' +
        '<div class="flex items-center gap-2 mb-1">' +
          '<div class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ' +
            (s.done ? 'bg-green-500 text-white' : isCurrent ? 'bg-sky-500 text-white ring-4 ring-sky-100' : 'bg-gray-200 text-gray-400') + '">' +
            (s.done ? '<i class="fas fa-check text-xs"></i>' : '<i class="fas ' + s.icon + ' text-xs"></i>') + '</div>' +
          '<span class="text-xs font-semibold ' + (s.done ? 'text-green-600' : isCurrent ? 'text-sky-600' : 'text-gray-400') + '">' + s.label + '</span>' +
        '</div>' +
        '<div class="h-1.5 rounded-full ' + (s.done ? 'bg-green-400' : isCurrent ? 'bg-sky-400' : 'bg-gray-200') + '"></div>' +
      '</div>';
      if (si < steps.length - 1) html += '<div class="w-4"></div>';
    }
    html += '</div></div><div id="qcStepContent"></div>';
    content.innerHTML = html;

    if (step === 3) renderQCComplete();
    else if (step === 2) renderQCForwarding();
    else renderQCGetNumber();
  }

  // ── Step 1: Enter BOTH phone numbers — business + AI purchased number ──
  function renderQCGetNumber() {
    var el = document.getElementById('qcStepContent');
    if (!el) return;
    var existingBizPhone = state._editBizPhone || (state.phoneSetup || {}).business_phone || (state.config || {}).business_phone || '';
    var existingAiPhone = state._editAiPhone || (state.quickConnect || {}).ai_phone_number || (state.phoneSetup || {}).assigned_phone_number || '';
    // Clear temp edit state
    state._editBizPhone = '';
    state._editAiPhone = '';
    // Clear placeholder numbers
    if (existingAiPhone && existingAiPhone.includes('0000')) existingAiPhone = '';

    el.innerHTML =
      '<div class="bg-white rounded-2xl border-2 border-sky-100 shadow-sm p-8">' +
        '<div class="max-w-lg mx-auto">' +
          '<div class="text-center mb-6">' +
            '<div class="w-16 h-16 bg-sky-100 rounded-full flex items-center justify-center mx-auto mb-4">' +
              '<i class="fas fa-mobile-alt text-sky-500 text-2xl"></i></div>' +
            '<h4 class="text-xl font-extrabold text-gray-800 mb-2">Set Up Your Phone Numbers</h4>' +
            '<p class="text-gray-500 text-sm">Enter your regular business cell number and the AI phone number you purchased from Twilio, Vonage, or Telnyx.</p>' +
          '</div>' +

          // Business Phone Number
          '<div class="mb-5">' +
            '<label class="block text-sm font-semibold text-gray-700 mb-2"><i class="fas fa-phone text-sky-500 mr-1"></i>Your Business Phone Number</label>' +
            '<p class="text-xs text-gray-400 mb-2">This is your regular cell phone number — the one your customers call. You\'ll forward unanswered calls from this number to the AI.</p>' +
            '<div class="relative">' +
              '<div class="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">' +
                '<span class="text-gray-400 font-mono text-lg">+1</span></div>' +
              '<input type="tel" id="qcBizPhoneInput" value="' + esc(existingBizPhone.replace(/^\+1/, '')) + '" placeholder="(780) 983-3335" ' +
                'class="w-full pl-14 pr-4 py-4 text-lg font-mono border-2 border-gray-300 rounded-2xl focus:ring-4 focus:ring-sky-200 focus:border-sky-500 transition-all text-center" ' +
                'maxlength="14" autocomplete="tel">' +
            '</div>' +
          '</div>' +

          // AI Phone Number (purchased from Twilio/Vonage/Telnyx)
          '<div class="mb-5">' +
            '<label class="block text-sm font-semibold text-gray-700 mb-2"><i class="fas fa-robot text-emerald-500 mr-1"></i>AI Phone Number (Purchased for the AI)</label>' +
            '<p class="text-xs text-gray-400 mb-2">This is the phone number you purchased from <strong>Twilio</strong>, <strong>Vonage</strong>, or <strong>Telnyx</strong> for the AI to answer calls on. You\'ll forward your cell to this number.</p>' +
            '<div class="relative">' +
              '<div class="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none">' +
                '<span class="text-gray-400 font-mono text-lg">+1</span></div>' +
              '<input type="tel" id="qcAiPhoneInput" value="' + esc(existingAiPhone.replace(/^\+1/, '')) + '" placeholder="(484) 964-9758" ' +
                'class="w-full pl-14 pr-4 py-4 text-lg font-mono border-2 border-emerald-300 rounded-2xl focus:ring-4 focus:ring-emerald-200 focus:border-emerald-500 transition-all text-center bg-emerald-50/50" ' +
                'maxlength="14" autocomplete="tel">' +
            '</div>' +
          '</div>' +

          // Purchase help
          '<div class="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">' +
            '<p class="text-sm font-semibold text-amber-800 mb-2"><i class="fas fa-lightbulb text-amber-500 mr-1"></i>Don\'t have an AI phone number yet?</p>' +
            '<p class="text-xs text-amber-700 mb-2">You need to purchase a phone number from one of these VoIP/SIP providers to use with LiveKit:</p>' +
            '<div class="flex flex-wrap gap-2">' +
              '<a href="https://www.twilio.com/phone-numbers" target="_blank" class="text-xs bg-white border border-amber-200 rounded-lg px-3 py-1.5 text-amber-700 hover:bg-amber-100 font-medium"><i class="fas fa-external-link-alt mr-1"></i>Twilio</a>' +
              '<a href="https://www.vonage.com/communications-apis/numbers/" target="_blank" class="text-xs bg-white border border-amber-200 rounded-lg px-3 py-1.5 text-amber-700 hover:bg-amber-100 font-medium"><i class="fas fa-external-link-alt mr-1"></i>Vonage</a>' +
              '<a href="https://telnyx.com/products/phone-numbers" target="_blank" class="text-xs bg-white border border-amber-200 rounded-lg px-3 py-1.5 text-amber-700 hover:bg-amber-100 font-medium"><i class="fas fa-external-link-alt mr-1"></i>Telnyx</a>' +
              '<a href="https://docs.livekit.io/agents/quickstarts/sip/" target="_blank" class="text-xs bg-white border border-amber-200 rounded-lg px-3 py-1.5 text-amber-700 hover:bg-amber-100 font-medium"><i class="fas fa-external-link-alt mr-1"></i>LiveKit SIP</a>' +
            '</div>' +
            '<p class="text-xs text-amber-600 mt-2">Pre-configured dev number: <strong class="font-mono">+1 (484) 964-9758</strong> (LiveKit-provided)</p>' +
          '</div>' +

          '<button onclick="qcSavePhones()" id="qcSaveBtn" class="w-full py-4 bg-sky-500 text-white rounded-2xl font-bold text-base hover:bg-sky-600 transition-all shadow-lg hover:shadow-xl">' +
            '<i class="fas fa-save mr-2"></i>Save Phone Numbers & Continue</button>' +

          '<p class="text-xs text-gray-400 mt-4 text-center"><i class="fas fa-lock mr-1"></i>Your phone numbers are stored securely and used only for call forwarding setup.</p>' +
        '</div>' +
      '</div>';

    // Add phone formatting to both inputs
    ['qcBizPhoneInput', 'qcAiPhoneInput'].forEach(function(inputId) {
      var phoneInput = document.getElementById(inputId);
      if (phoneInput) {
        phoneInput.addEventListener('input', function() {
          var v = this.value.replace(/\D/g, '').slice(0, 10);
          if (v.length >= 7) this.value = '(' + v.slice(0,3) + ') ' + v.slice(3,6) + '-' + v.slice(6);
          else if (v.length >= 4) this.value = '(' + v.slice(0,3) + ') ' + v.slice(3);
          else if (v.length > 0) this.value = '(' + v;
        });
      }
    });
  }

  // Save both phone numbers (manual entry flow)
  window.qcSavePhones = async function() {
    var bizInput = document.getElementById('qcBizPhoneInput');
    var aiInput = document.getElementById('qcAiPhoneInput');
    var bizRaw = bizInput ? bizInput.value.replace(/\D/g, '') : '';
    var aiRaw = aiInput ? aiInput.value.replace(/\D/g, '') : '';

    if (bizRaw.length < 10) { showToast('Please enter a valid 10-digit business phone number', 'error'); return; }
    if (aiRaw.length < 10) { showToast('Please enter a valid 10-digit AI phone number', 'error'); return; }
    if (bizRaw === aiRaw) { showToast('Business phone and AI phone cannot be the same number', 'error'); return; }

    var btn = document.getElementById('qcSaveBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving phone numbers...'; }

    try {
      var res = await fetch('/api/secretary/quick-connect/save-phones', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ business_phone: bizRaw, ai_phone_number: aiRaw })
      });
      var data = await res.json();
      if (data.success) {
        state.quickConnect = state.quickConnect || {};
        state.quickConnect.ai_phone_number = data.ai_phone_number;
        state.quickConnect.ai_phone_display = data.ai_phone_display;
        state.quickConnect.business_phone = data.business_phone;
        state.quickConnect.business_phone_display = data.business_phone_display;
        if (state.phoneSetup) {
          state.phoneSetup.assigned_phone_number = data.ai_phone_number;
          state.phoneSetup.business_phone = data.business_phone;
          state.phoneSetup.connection_status = 'pending_forwarding';
        } else {
          state.phoneSetup = { assigned_phone_number: data.ai_phone_number, business_phone: data.business_phone, connection_status: 'pending_forwarding' };
        }
        showToast('Phone numbers saved! Now set up call forwarding.', 'success');
        renderConnectTab();
      } else {
        showToast(data.error || 'Failed to save phone numbers', 'error');
      }
    } catch(e) { showToast('Network error — check your connection', 'error'); }
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Phone Numbers & Continue'; }
  };

  // Legacy: purchase-number still works if LiveKit keys are configured
  window.qcPurchaseNumber = async function() {
    var input = document.getElementById('qcBizPhoneInput');
    var rawPhone = input ? input.value.replace(/\D/g, '') : '';
    if (rawPhone.length < 10) { showToast('Please enter a valid 10-digit phone number', 'error'); return; }

    try {
      var res = await fetch('/api/secretary/quick-connect/purchase-number', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ phone_number: rawPhone })
      });
      var data = await res.json();
      if (data.success) {
        state.quickConnect = state.quickConnect || {};
        state.quickConnect.ai_phone_number = data.ai_phone_number;
        state.quickConnect.ai_phone_display = data.ai_phone_display;
        state.quickConnect.business_phone = data.business_phone;
        state.quickConnect.business_phone_display = data.business_phone_display;
        state.quickConnect.dispatch_rule_id = data.dispatch_rule_id;
        if (state.phoneSetup) {
          state.phoneSetup.assigned_phone_number = data.ai_phone_number;
          state.phoneSetup.business_phone = data.business_phone;
        } else {
          state.phoneSetup = { assigned_phone_number: data.ai_phone_number, business_phone: data.business_phone };
        }
        showToast('AI phone number purchased! Now set up call forwarding.', 'success');
        renderConnectTab();
      } else if (data.needs_manual) {
        // Auto-purchase failed — manual entry is already shown
        showToast('Auto-purchase not available. Please enter your AI phone number manually.', 'info');
      } else {
        showToast(data.error || 'Failed to purchase number', 'error');
      }
    } catch(e) { showToast('Network error — check your connection', 'error'); }
  };

  // ── Step 2: Call Forwarding Instructions ──
  // Shows both phone numbers, forwarding instructions per carrier, and Edit/Confirm buttons
  function renderQCForwarding() {
    var el = document.getElementById('qcStepContent');
    if (!el) return;
    var qc = state.quickConnect || {};
    var ps = state.phoneSetup || {};
    var aiPhone = qc.ai_phone_display || formatPhone(qc.ai_phone_number || ps.assigned_phone_number || '');
    var aiPhoneRaw = qc.ai_phone_number || ps.assigned_phone_number || '';
    var bizPhone = qc.business_phone_display || formatPhone(qc.business_phone || ps.business_phone || '');
    var bizPhoneRaw = qc.business_phone || ps.business_phone || '';
    var mode = state.secretaryMode || 'directory';

    // Always show carrier forwarding form
    var carrierFormHtml = renderCarrierForwardingForm(aiPhoneRaw, false);

    el.innerHTML =
      '<div class="bg-white rounded-2xl border-2 border-amber-100 shadow-sm p-8">' +
        '<div class="max-w-lg mx-auto">' +
          '<div class="text-center mb-6">' +
            '<div class="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">' +
              '<i class="fas fa-random text-amber-500 text-2xl"></i></div>' +
            '<h4 class="text-xl font-extrabold text-gray-800 mb-2">Set Up Call Forwarding</h4>' +
            '<p class="text-gray-500 text-sm">Forward unanswered calls from your business phone to your AI number so the AI secretary can pick up when you can\'t.</p>' +
          '</div>' +

          // Both phone numbers display
          '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">' +
            '<div class="bg-gray-50 border border-gray-200 rounded-xl p-4 text-center">' +
              '<p class="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Your Business Phone</p>' +
              '<p class="font-mono font-bold text-gray-800 text-lg">' + bizPhone + '</p>' +
              '<p class="text-xs text-gray-400 mt-1">Forwards unanswered calls →</p>' +
            '</div>' +
            '<div class="bg-sky-50 border-2 border-sky-200 rounded-xl p-4 text-center">' +
              '<p class="text-xs text-sky-600 uppercase tracking-wide font-semibold mb-1">AI Secretary Number</p>' +
              '<p class="font-mono font-black text-sky-800 text-lg">' + aiPhone + '</p>' +
              '<button onclick="copyToClipboard(\'' + esc(aiPhoneRaw) + '\')" class="text-xs text-sky-500 hover:text-sky-700 font-medium mt-1"><i class="fas fa-copy mr-1"></i>Copy</button>' +
            '</div>' +
          '</div>' +

          // Edit phone numbers button
          '<div class="text-center mb-4">' +
            '<button onclick="qcEditPhones()" class="text-sm text-sky-600 hover:text-sky-800 font-semibold"><i class="fas fa-edit mr-1"></i>Edit Phone Numbers</button>' +
          '</div>' +

          // Forwarding instructions — always show generic with carrier selector
          renderGenericForwarding(aiPhoneRaw) +

          carrierFormHtml +

          // Confirm + Activate button
          '<div class="mt-6 text-center">' +
            '<button onclick="qcActivate()" id="qcActivateBtn" class="w-full py-4 bg-green-500 text-white rounded-2xl font-bold text-base hover:bg-green-600 transition-all shadow-lg hover:shadow-xl">' +
              '<i class="fas fa-check-circle mr-2"></i>I\'ve Set Up Call Forwarding — Confirm & Activate</button>' +
            '<p class="text-xs text-gray-400 mt-3">This will save your configuration and deploy the AI agent to your LiveKit account.</p>' +
          '</div>' +

          '<div class="mt-4 text-center">' +
            '<button onclick="qcGoBack()" class="text-sm text-gray-500 hover:text-gray-600 font-semibold"><i class="fas fa-arrow-left mr-1"></i>Go Back & Edit Phone Numbers</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  // Edit phone numbers — go back to step 1 with existing data
  window.qcEditPhones = function() {
    // Reset connection status so we go back to step 1 but keep data
    if (state.phoneSetup) state.phoneSetup.connection_status = 'pending_forwarding';
    // Clear the assigned number temporarily to show step 1
    var savedAi = state.quickConnect?.ai_phone_number || state.phoneSetup?.assigned_phone_number || '';
    var savedBiz = state.quickConnect?.business_phone || state.phoneSetup?.business_phone || '';
    state.quickConnect = { ai_phone_number: '', business_phone: savedBiz };
    if (state.phoneSetup) state.phoneSetup.assigned_phone_number = '';
    // Store originals so step 1 can pre-fill
    state._editBizPhone = savedBiz;
    state._editAiPhone = savedAi;
    renderConnectTab();
  };

  // Go back from step 2 to step 1
  window.qcGoBack = function() {
    window.qcEditPhones();
  };

  // Telus-specific forwarding instructions (for dev/test account)
  function renderTelusForwarding(aiNumber) {
    var digits = aiNumber.replace(/^\+1/, '').replace(/\D/g, '');
    return '<div class="bg-gradient-to-r from-emerald-50 to-green-50 border-2 border-emerald-300 rounded-xl p-5 mb-4">' +
      '<div class="flex items-center gap-2 mb-3"><i class="fas fa-mobile-alt text-emerald-600"></i><span class="font-bold text-emerald-800">Telus Call Forwarding Instructions</span></div>' +
      '<div class="space-y-3">' +
        '<div class="flex items-start gap-3">' +
          '<span class="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold">1</span>' +
          '<div><p class="text-sm text-emerald-800 font-semibold">Forward when busy or no answer</p>' +
            '<p class="text-xs text-emerald-600 mt-1">From your Telus phone, dial:</p>' +
            '<div class="bg-white border border-emerald-300 rounded-lg p-3 mt-2 font-mono text-lg text-center">' +
              '<span class="text-emerald-700 font-black">*92 ' + digits + '</span>' +
              '<button onclick="copyToClipboard(\'*92' + digits + '\')" class="ml-2 text-xs text-emerald-500 hover:text-emerald-700"><i class="fas fa-copy"></i></button>' +
            '</div>' +
            '<p class="text-xs text-emerald-500 mt-1">This forwards calls to your AI when you don\'t answer or are on another call.</p>' +
          '</div></div>' +
        '<div class="flex items-start gap-3">' +
          '<span class="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold">2</span>' +
          '<div><p class="text-sm text-emerald-800 font-semibold">Wait for confirmation tone</p>' +
            '<p class="text-xs text-emerald-600 mt-1">You\'ll hear a confirmation tone or see a notification that call forwarding is active.</p></div></div>' +
        '<div class="flex items-start gap-3">' +
          '<span class="flex-shrink-0 w-6 h-6 rounded-full bg-gray-300 text-gray-600 flex items-center justify-center text-xs font-bold"><i class="fas fa-undo text-xs"></i></span>' +
          '<div><p class="text-sm text-gray-700 font-semibold">To deactivate later</p>' +
            '<p class="text-xs text-gray-500 mt-1">Dial <span class="font-mono font-bold">*93</span> from your Telus phone to cancel forwarding.</p></div></div>' +
      '</div>' +
    '</div>';
  }

  // Generic forwarding instructions (for all other carriers)
  function renderGenericForwarding(aiNumber) {
    var formattedNum = formatPhone(aiNumber);
    return '<div class="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-xl p-5 mb-4">' +
      '<div class="flex items-center gap-2 mb-3"><i class="fas fa-info-circle text-blue-600"></i><span class="font-bold text-blue-800">How to Set Up Call Forwarding</span></div>' +
      '<p class="text-sm text-blue-700 mb-3">You need to set up <strong>conditional call forwarding</strong> (forward when no answer / busy) with your mobile carrier so unanswered calls go to your AI secretary.</p>' +
      '<div class="space-y-3">' +
        '<div class="flex items-start gap-3">' +
          '<span class="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold">1</span>' +
          '<div><p class="text-sm text-blue-800 font-semibold">Find your carrier\'s forwarding instructions</p>' +
            '<p class="text-xs text-blue-600 mt-1">Search: <em>"[Your Carrier] set up conditional call forwarding"</em> or call your carrier\'s customer service line.</p>' +
            '<div class="flex flex-wrap gap-2 mt-2">' +
              '<a href="https://www.google.com/search?q=Telus+conditional+call+forwarding" target="_blank" class="text-xs bg-white border border-blue-200 rounded-lg px-3 py-1 text-blue-600 hover:bg-blue-50">Telus</a>' +
              '<a href="https://www.google.com/search?q=Rogers+conditional+call+forwarding" target="_blank" class="text-xs bg-white border border-blue-200 rounded-lg px-3 py-1 text-blue-600 hover:bg-blue-50">Rogers</a>' +
              '<a href="https://www.google.com/search?q=Bell+conditional+call+forwarding" target="_blank" class="text-xs bg-white border border-blue-200 rounded-lg px-3 py-1 text-blue-600 hover:bg-blue-50">Bell</a>' +
              '<a href="https://www.google.com/search?q=Koodo+conditional+call+forwarding" target="_blank" class="text-xs bg-white border border-blue-200 rounded-lg px-3 py-1 text-blue-600 hover:bg-blue-50">Koodo</a>' +
              '<a href="https://www.google.com/search?q=Fido+conditional+call+forwarding" target="_blank" class="text-xs bg-white border border-blue-200 rounded-lg px-3 py-1 text-blue-600 hover:bg-blue-50">Fido</a>' +
              '<a href="https://www.google.com/search?q=Freedom+Mobile+conditional+call+forwarding" target="_blank" class="text-xs bg-white border border-blue-200 rounded-lg px-3 py-1 text-blue-600 hover:bg-blue-50">Freedom</a>' +
              '<a href="https://www.google.com/search?q=AT%26T+conditional+call+forwarding" target="_blank" class="text-xs bg-white border border-blue-200 rounded-lg px-3 py-1 text-blue-600 hover:bg-blue-50">AT&T</a>' +
              '<a href="https://www.google.com/search?q=T-Mobile+conditional+call+forwarding" target="_blank" class="text-xs bg-white border border-blue-200 rounded-lg px-3 py-1 text-blue-600 hover:bg-blue-50">T-Mobile</a>' +
              '<a href="https://www.google.com/search?q=Verizon+conditional+call+forwarding" target="_blank" class="text-xs bg-white border border-blue-200 rounded-lg px-3 py-1 text-blue-600 hover:bg-blue-50">Verizon</a>' +
            '</div></div></div>' +
        '<div class="flex items-start gap-3">' +
          '<span class="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold">2</span>' +
          '<div><p class="text-sm text-blue-800 font-semibold">Set the forwarding number to:</p>' +
            '<div class="bg-white border border-blue-300 rounded-lg p-3 mt-2 font-mono text-lg text-center">' +
              '<span class="text-blue-700 font-black">' + formattedNum + '</span>' +
              '<button onclick="copyToClipboard(\'' + esc(aiNumber) + '\')" class="ml-2 text-xs text-blue-500 hover:text-blue-700"><i class="fas fa-copy"></i></button>' +
            '</div></div></div>' +
        '<div class="flex items-start gap-3">' +
          '<span class="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold">3</span>' +
          '<div><p class="text-sm text-blue-800 font-semibold">Choose "Forward when no answer" or "Forward when busy"</p>' +
            '<p class="text-xs text-blue-600 mt-1">This way your phone rings first. If you don\'t answer, the AI picks up. You stay in control.</p></div></div>' +
      '</div>' +
      '<div class="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">' +
        '<p class="text-xs text-amber-700"><i class="fas fa-lightbulb text-amber-500 mr-1"></i><strong>Tip:</strong> Most carriers let you do this from your phone by dialing a short code (like *92 or **62*). Check with your carrier for the exact code.</p>' +
      '</div>' +
    '</div>';
  }

  // Carrier-specific forwarding form (only for Directory mode)
  function renderCarrierForwardingForm(aiNumber, isDev) {
    if (isDev) return ''; // Dev account already has Telus instructions
    return '<div class="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4">' +
      '<p class="text-sm font-semibold text-gray-700 mb-2"><i class="fas fa-question-circle text-sky-500 mr-1"></i>Need help finding your carrier\'s forwarding code?</p>' +
      '<p class="text-xs text-gray-500 mb-3">Select your carrier below for specific dial codes:</p>' +
      '<select id="qcCarrierSelect" onchange="qcShowCarrierCode()" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400 mb-2">' +
        '<option value="">Select your carrier...</option>' +
        '<option value="telus">Telus / Koodo / Public Mobile</option>' +
        '<option value="rogers">Rogers / Fido / Chatr</option>' +
        '<option value="bell">Bell / Virgin Plus / Lucky Mobile</option>' +
        '<option value="freedom">Freedom Mobile</option>' +
        '<option value="att">AT&T / Cricket</option>' +
        '<option value="tmobile">T-Mobile / Metro</option>' +
        '<option value="verizon">Verizon</option>' +
      '</select>' +
      '<div id="qcCarrierCodeResult"></div>' +
    '</div>';
  }

  // Show carrier-specific forwarding codes
  window.qcShowCarrierCode = function() {
    var sel = document.getElementById('qcCarrierSelect');
    var result = document.getElementById('qcCarrierCodeResult');
    if (!sel || !result) return;
    var qc = state.quickConnect || {};
    var ps = state.phoneSetup || {};
    var aiNum = (qc.ai_phone_number || ps.assigned_phone_number || '').replace(/^\+1/, '').replace(/\D/g, '');
    if (!aiNum) { result.innerHTML = '<p class="text-xs text-red-500">No AI number assigned yet.</p>'; return; }

    var codes = {
      telus:   { activate: '*92' + aiNum, deactivate: '*93', note: 'Telus/Koodo/Public Mobile' },
      rogers:  { activate: '*92' + aiNum, deactivate: '*93', note: 'Rogers/Fido/Chatr — may also use **004*+1' + aiNum + '#' },
      bell:    { activate: '*92' + aiNum, deactivate: '*93', note: 'Bell/Virgin Plus/Lucky Mobile' },
      freedom: { activate: '**62*+1' + aiNum + '#', deactivate: '##62#', note: 'Freedom Mobile' },
      att:     { activate: '*92' + aiNum, deactivate: '*93', note: 'AT&T / Cricket — may also use **004*1' + aiNum + '#' },
      tmobile: { activate: '**004*1' + aiNum + '#', deactivate: '##004#', note: 'T-Mobile / Metro by T-Mobile' },
      verizon: { activate: '*71' + aiNum, deactivate: '*73', note: 'Verizon' },
    };
    var c = codes[sel.value];
    if (!c) { result.innerHTML = ''; return; }
    result.innerHTML =
      '<div class="bg-white border border-sky-200 rounded-lg p-3 mt-2">' +
        '<p class="text-xs text-gray-500 mb-1">' + c.note + '</p>' +
        '<div class="flex items-center gap-2">' +
          '<span class="text-sm font-semibold text-gray-700">Dial:</span>' +
          '<span class="font-mono font-bold text-sky-700 text-lg">' + c.activate + '</span>' +
          '<button onclick="copyToClipboard(\'' + c.activate + '\')" class="text-xs text-sky-500 hover:text-sky-700"><i class="fas fa-copy"></i></button>' +
        '</div>' +
        '<p class="text-xs text-gray-400 mt-1">To deactivate: <span class="font-mono">' + c.deactivate + '</span></p>' +
      '</div>';
  };

  // Activate the AI secretary (Step 2 → Step 3) — deploys agent to LiveKit
  window.qcActivate = async function() {
    var btn = document.getElementById('qcActivateBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Deploying AI agent to LiveKit & activating...'; }

    try {
      var res = await fetch('/api/secretary/quick-connect/activate', {
        method: 'POST', headers: authHeaders()
      });
      var data = await res.json();
      if (data.success) {
        state.quickConnect = state.quickConnect || {};
        state.quickConnect.connected = true;
        state.quickConnect.business_phone = data.business_phone || state.quickConnect.business_phone;
        state.quickConnect.ai_phone_number = data.ai_phone_number || state.quickConnect.ai_phone_number;
        if (state.phoneSetup) {
          state.phoneSetup.connection_status = 'connected';
        } else {
          state.phoneSetup = { connection_status: 'connected', assigned_phone_number: data.ai_phone_number, business_phone: data.business_phone };
        }
        state.isActive = true;
        var msg = data.livekit_deployed
          ? 'Your AI secretary is now LIVE and deployed to LiveKit!'
          : 'Configuration saved and activated! LiveKit deployment will complete when API keys are configured.';
        showToast(msg, 'success');
        renderConnectTab();
      } else {
        showToast(data.error || 'Activation failed', 'error');
      }
    } catch(e) { showToast('Network error', 'error'); }
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-check-circle mr-2"></i>I\'ve Set Up Call Forwarding — Confirm & Activate'; }
  };

  // ── Step 3: CONNECTED — AI Secretary is Live ──
  function renderQCComplete() {
    var el = document.getElementById('qcStepContent');
    if (!el) return;
    var ps = state.phoneSetup || {};
    var qc = state.quickConnect || {};
    var bizPhone = qc.business_phone_display || formatPhone(qc.business_phone || ps.business_phone || '');
    var aiPhone = qc.ai_phone_display || formatPhone(qc.ai_phone_number || ps.assigned_phone_number || '');
    var bizPhoneRaw = qc.business_phone || ps.business_phone || '';
    var aiPhoneRaw = qc.ai_phone_number || ps.assigned_phone_number || '';

    el.innerHTML =
      '<div class="bg-white rounded-2xl border-2 border-green-200 shadow-sm p-8 text-center">' +
        '<div class="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">' +
          '<i class="fas fa-check-circle text-green-500 text-4xl"></i></div>' +
        '<h3 class="text-2xl font-extrabold text-gray-800 mb-2">Your AI Secretary is LIVE!</h3>' +
        '<p class="text-gray-500 mb-6">Every call to your business number is now backed by AI. Powered by LiveKit — never miss a lead again.</p>' +

        '<div class="bg-sky-50 border border-sky-200 rounded-xl p-4 mb-6 text-left max-w-lg mx-auto">' +
          '<p class="text-sm text-sky-800 font-semibold"><i class="fas fa-phone-volume text-sky-500 mr-2"></i>AI Secretary Connected via LiveKit</p>' +
          '<p class="text-xs text-sky-600 mt-1">When customers call and you don\'t answer, calls forward to your AI number and LiveKit\'s voice AI handles the conversation.</p>' +
        '</div>' +

        '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-lg mx-auto mb-6">' +
          '<div class="bg-gray-50 rounded-xl p-4">' +
            '<p class="text-xs text-gray-500 uppercase tracking-wide">Your Business Number</p>' +
            '<p class="font-mono font-bold text-gray-800 text-lg mt-1">' + bizPhone + '</p></div>' +
          '<div class="bg-sky-50 rounded-xl p-4">' +
            '<p class="text-xs text-sky-600 uppercase tracking-wide">AI Secretary Number</p>' +
            '<p class="font-mono font-bold text-sky-800 text-lg mt-1">' + aiPhone + '</p>' +
            '<button onclick="copyToClipboard(\'' + esc(aiPhoneRaw) + '\')" class="text-xs text-sky-500 hover:text-sky-700 mt-1"><i class="fas fa-copy mr-1"></i>Copy</button></div>' +
        '</div>' +

        '<div class="bg-emerald-50 border border-emerald-200 rounded-xl p-5 mb-6 text-left max-w-lg mx-auto">' +
          '<p class="text-sm font-bold text-emerald-800 mb-3"><i class="fas fa-route mr-1"></i>How calls are handled:</p>' +
          '<div class="space-y-2">' +
            '<div class="flex items-start gap-3">' +
              '<span class="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold">1</span>' +
              '<p class="text-sm text-emerald-700">Customer calls <strong>' + bizPhone + '</strong></p></div>' +
            '<div class="flex items-start gap-3">' +
              '<span class="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold">2</span>' +
              '<p class="text-sm text-emerald-700"><strong>Your phone rings first</strong> — you get first priority</p></div>' +
            '<div class="flex items-start gap-3">' +
              '<span class="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold">3</span>' +
              '<p class="text-sm text-emerald-700">If you don\'t answer → call forwards to AI at <strong>' + aiPhone + '</strong></p></div>' +
            '<div class="flex items-start gap-3">' +
              '<span class="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-bold">4</span>' +
              '<p class="text-sm text-emerald-700">AI secretary answers professionally, handles the call, logs it to your dashboard</p></div>' +
          '</div>' +
        '</div>' +

        '<div class="flex justify-center gap-3 mb-6 flex-wrap">' +
          '<button onclick="qcOpenPhoneConfig()" class="px-6 py-3 bg-sky-500 text-white rounded-xl font-semibold text-sm hover:bg-sky-600 transition-all shadow"><i class="fas fa-edit mr-2"></i>Edit Phone Configuration</button>' +
          '<button onclick="secSetTab(\'setup\')" class="px-6 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold text-sm hover:bg-gray-200 transition-all"><i class="fas fa-cog mr-2"></i>Edit AI Settings</button>' +
          '<button onclick="secSetTab(\'calls\')" class="px-6 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold text-sm hover:bg-gray-200 transition-all"><i class="fas fa-phone-volume mr-2"></i>View Call Log</button>' +
        '</div>' +

        '<div class="text-center mb-4">' +
          '<button onclick="qcDisconnect()" class="text-sm text-red-400 hover:text-red-600 font-medium"><i class="fas fa-unlink mr-1"></i>Disconnect AI Secretary</button>' +
        '</div>' +

        '<p class="text-xs text-gray-400 text-center">Need help? Contact support. Your AI secretary is powered by LiveKit voice AI.</p>' +
      '</div>';
  }

  // ── Phone Config Modal — Edit phone numbers while connected ──
  window.qcOpenPhoneConfig = function() {
    var existing = document.getElementById('phoneConfigModal');
    if (existing) existing.remove();

    var qc = state.quickConnect || {};
    var ps = state.phoneSetup || {};
    var bizPhone = qc.business_phone || ps.business_phone || '';
    var aiPhone = qc.ai_phone_number || ps.assigned_phone_number || '';

    var modal = document.createElement('div');
    modal.id = 'phoneConfigModal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm';
    modal.innerHTML =
      '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">' +
        '<div class="bg-gradient-to-r from-sky-500 to-blue-600 p-5 text-white">' +
          '<div class="flex items-center justify-between">' +
            '<div><h2 class="text-lg font-bold"><i class="fas fa-phone-alt mr-2"></i>Edit Phone Configuration</h2>' +
            '<p class="text-sky-100 text-xs mt-1">Update your business phone and AI phone numbers</p></div>' +
            '<button onclick="document.getElementById(\'phoneConfigModal\').remove()" class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-all"><i class="fas fa-times text-sm"></i></button>' +
          '</div>' +
        '</div>' +
        '<div class="p-6">' +
          '<div class="mb-5">' +
            '<label class="block text-sm font-semibold text-gray-700 mb-2"><i class="fas fa-phone text-sky-500 mr-1"></i>Your Business Phone Number</label>' +
            '<p class="text-xs text-gray-400 mb-2">Your regular cell number that customers call</p>' +
            '<div class="relative">' +
              '<div class="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none"><span class="text-gray-400 font-mono">+1</span></div>' +
              '<input type="tel" id="pcBizPhone" value="' + esc(bizPhone.replace(/^\+1/, '')) + '" placeholder="(780) 983-3335" ' +
                'class="w-full pl-12 pr-4 py-3 font-mono border-2 border-gray-300 rounded-xl focus:ring-4 focus:ring-sky-200 focus:border-sky-500 text-center" maxlength="14">' +
            '</div>' +
          '</div>' +
          '<div class="mb-5">' +
            '<label class="block text-sm font-semibold text-gray-700 mb-2"><i class="fas fa-robot text-emerald-500 mr-1"></i>AI Phone Number (Purchased)</label>' +
            '<p class="text-xs text-gray-400 mb-2">Phone number purchased from Twilio/Vonage/Telnyx for the AI</p>' +
            '<div class="relative">' +
              '<div class="absolute inset-y-0 left-0 flex items-center pl-4 pointer-events-none"><span class="text-gray-400 font-mono">+1</span></div>' +
              '<input type="tel" id="pcAiPhone" value="' + esc(aiPhone.replace(/^\+1/, '')) + '" placeholder="(484) 964-9758" ' +
                'class="w-full pl-12 pr-4 py-3 font-mono border-2 border-emerald-300 rounded-xl focus:ring-4 focus:ring-emerald-200 focus:border-emerald-500 text-center bg-emerald-50/50" maxlength="14">' +
            '</div>' +
          '</div>' +
          '<div class="flex gap-3">' +
            '<button onclick="qcSavePhoneConfig()" id="pcSaveBtn" class="flex-1 py-3 bg-sky-500 text-white rounded-xl font-bold hover:bg-sky-600 transition-all shadow"><i class="fas fa-save mr-2"></i>Save Changes</button>' +
            '<button onclick="document.getElementById(\'phoneConfigModal\').remove()" class="px-6 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold hover:bg-gray-200 transition-all">Cancel</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });

    // Add phone formatting
    ['pcBizPhone', 'pcAiPhone'].forEach(function(id) {
      var inp = document.getElementById(id);
      if (inp) inp.addEventListener('input', function() {
        var v = this.value.replace(/\D/g, '').slice(0, 10);
        if (v.length >= 7) this.value = '(' + v.slice(0,3) + ') ' + v.slice(3,6) + '-' + v.slice(6);
        else if (v.length >= 4) this.value = '(' + v.slice(0,3) + ') ' + v.slice(3);
        else if (v.length > 0) this.value = '(' + v;
      });
    });
  };

  // Save phone config from modal
  window.qcSavePhoneConfig = async function() {
    var bizRaw = (document.getElementById('pcBizPhone')?.value || '').replace(/\D/g, '');
    var aiRaw = (document.getElementById('pcAiPhone')?.value || '').replace(/\D/g, '');
    if (bizRaw.length < 10 || aiRaw.length < 10) { showToast('Both phone numbers must be at least 10 digits', 'error'); return; }
    if (bizRaw === aiRaw) { showToast('Business phone and AI phone cannot be the same', 'error'); return; }

    var btn = document.getElementById('pcSaveBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...'; }

    try {
      var res = await fetch('/api/secretary/quick-connect/save-phones', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ business_phone: bizRaw, ai_phone_number: aiRaw })
      });
      var data = await res.json();
      if (data.success) {
        state.quickConnect = state.quickConnect || {};
        state.quickConnect.ai_phone_number = data.ai_phone_number;
        state.quickConnect.ai_phone_display = data.ai_phone_display;
        state.quickConnect.business_phone = data.business_phone;
        state.quickConnect.business_phone_display = data.business_phone_display;
        if (state.phoneSetup) {
          state.phoneSetup.assigned_phone_number = data.ai_phone_number;
          state.phoneSetup.business_phone = data.business_phone;
        }
        showToast('Phone numbers updated!', 'success');
        document.getElementById('phoneConfigModal')?.remove();
        renderConnectTab();
      } else {
        showToast(data.error || 'Failed to save', 'error');
      }
    } catch(e) { showToast('Network error', 'error'); }
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Changes'; }
  };

  window.qcUpdateBizPhone = async function() {
    var input = document.getElementById('connectedBizPhone');
    if (!input || !input.value.trim()) { showToast('Enter a phone number', 'error'); return; }
    try {
      var res = await fetch('/api/secretary/config', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ business_phone: input.value.trim() })
      });
      if (res.ok) {
        if (state.config) state.config.business_phone = input.value.trim();
        if (state.phoneSetup) state.phoneSetup.business_phone = input.value.trim();
        showToast('Business phone updated!', 'success');
      } else { showToast('Failed to update', 'error'); }
    } catch(e) { showToast('Network error', 'error'); }
  };

  // LEGACY PLACEHOLDERS
  window.secTestConnection = function() { showToast('Your phone is connected via LiveKit', 'info'); };
  window.secUpdateBizPhone = window.qcUpdateBizPhone;
  window.secConfirmConnection = function() { showToast('Your phone is connected via LiveKit', 'info'); };

  // Disconnect AI secretary
  window.qcDisconnect = async function() {
    if (!confirm('Are you sure you want to disconnect your AI secretary? Remember to disable call forwarding on your carrier too.')) return;
    try {
      var res = await fetch('/api/secretary/quick-connect/disconnect', {
        method: 'POST', headers: authHeaders()
      });
      var data = await res.json();
      if (data.success) {
        state.quickConnect = {};
        if (state.phoneSetup) state.phoneSetup.connection_status = 'disconnected';
        state.isActive = false;
        showToast('AI secretary disconnected. Don\'t forget to disable call forwarding on your phone.', 'info');
        renderConnectTab();
      } else {
        showToast(data.error || 'Failed to disconnect', 'error');
      }
    } catch(e) { showToast('Network error', 'error'); }
  };

  // ============================================================
  // CALLS TAB
  // ============================================================
  async function loadCalls(filter) {
    var f = filter || state.callFilter || 'all';
    state.callFilter = f;
    var search = state.callSearch || '';
    try {
      var url = '/api/secretary/calls?limit=50&filter=' + f;
      if (search) url += '&search=' + encodeURIComponent(search);
      var res = await fetch(url, { headers: authOnly() });
      if (res.ok) { var data = await res.json(); state.calls = data.calls || []; state.totalCalls = data.total || 0; renderCallsTab(); }
    } catch(e) {}
  }

  async function loadLeads(status) {
    var url = '/api/secretary/leads?limit=50';
    if (status) url += '&status=' + status;
    try {
      var res = await fetch(url, { headers: authOnly() });
      if (res.ok) { var data = await res.json(); state.leads = data.leads || []; state.leadsCount = data.total || 0; state.leadStages = data.stages || []; renderLeadsTab(); }
    } catch(e) {}
  }

  function renderCallsTab() {
    var content = document.getElementById('secContent');
    if (!content) return;

    if (state.calls.length === 0 && !state.callSearch) {
      content.innerHTML =
        '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-12 text-center">' +
          '<div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-phone-slash text-gray-400 text-2xl"></i></div>' +
          '<h3 class="font-bold text-gray-800 text-lg mb-1">No Calls Yet</h3>' +
          '<p class="text-gray-500 text-sm">When your AI secretary handles calls, they\'ll appear here with full transcripts, lead info, and conversation summaries.</p>' +
          '<div class="flex flex-wrap gap-3 justify-center mt-4">' +
            (state.phoneSetup?.connection_status !== 'connected' ? '<button onclick="secSetTab(\'connect\')" class="px-6 py-3 bg-sky-500 text-white rounded-xl font-semibold text-sm hover:bg-sky-600 transition-all"><i class="fas fa-phone-alt mr-2"></i>Connect Your Phone First</button>' : '') +
            (state.isDev ? '<button onclick="secSimulateCall()" class="px-6 py-3 bg-violet-500 text-white rounded-xl font-semibold text-sm hover:bg-violet-600 transition-all"><i class="fas fa-vial mr-2"></i>Simulate Test Call</button>' : '') +
          '</div>' +
          (state.isDev ? '<p class="text-xs text-gray-400 mt-3"><i class="fas fa-flask mr-1"></i>Dev mode: Use "Simulate Test Call" to generate sample call data and verify the UI.</p>' : '') +
        '</div>';
      return;
    }

    var filterBtns = ['all', 'leads', 'follow_up'].map(function(f) {
      var active = (state.callFilter || 'all') === f;
      var labels = { all: 'All Calls', leads: 'Leads Only', follow_up: 'Needs Follow-Up' };
      var icons = { all: 'fa-list', leads: 'fa-fire', follow_up: 'fa-exclamation-circle' };
      return '<button onclick="secFilterCalls(\'' + f + '\')" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ' +
        (active ? 'bg-violet-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200') + '">' +
        '<i class="fas ' + icons[f] + ' mr-1"></i>' + labels[f] + '</button>';
    }).join('');

    content.innerHTML =
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">' +
        '<div class="px-6 py-4 border-b border-gray-100">' +
          '<div class="flex flex-col md:flex-row md:items-center justify-between gap-3">' +
            '<h3 class="font-bold text-gray-800 text-lg"><i class="fas fa-history text-violet-500 mr-2"></i>Call Log <span class="text-gray-400 font-normal text-sm">(' + state.totalCalls + ')</span></h3>' +
            '<div class="flex items-center gap-2">' +
              '<div class="relative">' +
                '<input type="text" id="callSearchInput" placeholder="Search calls..." value="' + esc(state.callSearch || '') + '" class="pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-violet-300 focus:border-violet-400 w-44" onkeyup="if(event.key===\'Enter\')secSearchCalls()">' +
                '<i class="fas fa-search absolute left-2.5 top-2 text-gray-400 text-xs"></i>' +
              '</div>' +
              filterBtns +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="divide-y divide-gray-100">' +
          (state.calls.length === 0 ? '<div class="p-8 text-center text-gray-400 text-sm"><i class="fas fa-search mr-2"></i>No calls match your filter</div>' :
          state.calls.map(function(call) {
            var oc = call.call_outcome === 'answered' ? 'text-green-600 bg-green-50' :
              call.call_outcome === 'transferred' ? 'text-blue-600 bg-blue-50' :
              call.call_outcome === 'voicemail' ? 'text-amber-600 bg-amber-50' : 'text-gray-600 bg-gray-50';
            var sentimentIcon = call.sentiment === 'positive' ? 'fa-smile text-green-500' : (call.sentiment === 'negative' ? 'fa-frown text-red-500' : 'fa-meh text-gray-400');
            var isLead = call.is_lead;
            return '<div class="px-6 py-4 hover:bg-gray-50 transition-colors cursor-pointer" onclick="secViewCall(' + call.id + ')">' +
              '<div class="flex items-center justify-between mb-2">' +
                '<div class="flex items-center gap-3">' +
                  '<div class="w-10 h-10 rounded-full flex items-center justify-center ' + (isLead ? 'bg-amber-100' : 'bg-sky-100') + '">' +
                    '<i class="fas ' + (isLead ? 'fa-fire text-amber-600' : 'fa-phone text-sky-600') + '"></i>' +
                  '</div>' +
                  '<div>' +
                    '<div class="flex items-center gap-2">' +
                      '<p class="font-semibold text-gray-800 text-sm">' + esc(call.caller_name || 'Unknown Caller') + '</p>' +
                      (isLead ? '<span class="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[9px] font-bold">LEAD</span>' : '') +
                      (call.follow_up_required && !call.follow_up_completed ? '<span class="px-1.5 py-0.5 bg-red-100 text-red-700 rounded text-[9px] font-bold">FOLLOW UP</span>' : '') +
                    '</div>' +
                    '<p class="text-xs text-gray-500">' + esc(call.caller_phone || '') +
                      (call.service_type ? ' — <span class="text-violet-600 font-medium">' + esc(call.service_type) + '</span>' : '') +
                      (call.property_address ? ' — <i class="fas fa-map-marker-alt text-red-400 ml-1 mr-0.5"></i>' + esc(call.property_address) : '') +
                    '</p>' +
                  '</div>' +
                '</div>' +
                '<div class="text-right flex-shrink-0">' +
                  '<div class="flex items-center gap-2 justify-end">' +
                    '<i class="fas ' + sentimentIcon + ' text-xs"></i>' +
                    '<span class="px-2 py-0.5 rounded-full text-xs font-semibold ' + oc + '">' + (call.call_outcome || 'unknown') + '</span>' +
                  '</div>' +
                  '<p class="text-xs text-gray-400 mt-1">' + formatDuration(call.call_duration_seconds) + ' — ' + formatTimeAgo(call.created_at) + '</p>' +
                '</div>' +
              '</div>' +
              (call.call_summary ? '<p class="text-sm text-gray-600 ml-13 bg-gray-50 rounded-lg p-3 line-clamp-2"><i class="fas fa-robot text-gray-400 mr-1"></i>' + esc(call.call_summary) + '</p>' : '') +
              (call.conversation_highlights ? '<p class="text-xs text-violet-600 ml-13 mt-1"><i class="fas fa-star text-violet-400 mr-1"></i>' + esc(call.conversation_highlights).substring(0, 120) + '</p>' : '') +
              '<div class="flex items-center gap-2 ml-13 mt-2">' +
                '<button onclick="event.stopPropagation(); secViewCall(' + call.id + ')" class="text-xs text-violet-600 hover:text-violet-800 font-medium"><i class="fas fa-file-alt mr-1"></i>Full Transcript</button>' +
                (isLead && call.lead_status === 'new' ? '<button onclick="event.stopPropagation(); secUpdateLeadStatus(' + call.id + ', \'contacted\')" class="text-xs text-green-600 hover:text-green-800 font-medium"><i class="fas fa-check mr-1"></i>Mark Contacted</button>' : '') +
                (call.follow_up_required && !call.follow_up_completed ? '<button onclick="event.stopPropagation(); secCompleteFollowUp(' + call.id + ')" class="text-xs text-blue-600 hover:text-blue-800 font-medium"><i class="fas fa-check-double mr-1"></i>Follow-Up Done</button>' : '') +
              '</div>' +
            '</div>';
          }).join('')) +
        '</div>' +
      '</div>';
  }

  // ── Leads Tab ──
  function renderLeadsTab() {
    var content = document.getElementById('secContent');
    if (!content) return;

    if (state.leads.length === 0 && state.leadsCount === 0) {
      content.innerHTML =
        '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-12 text-center">' +
          '<div class="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-fire text-amber-500 text-2xl"></i></div>' +
          '<h3 class="font-bold text-gray-800 text-lg mb-1">No Leads Yet</h3>' +
          '<p class="text-gray-500 text-sm">When callers provide their name, phone, and address, they\'re automatically captured as leads. The AI marks callers as leads when they request an estimate, repair, or service.</p>' +
        '</div>';
      return;
    }

    // Stage filters
    var stages = [
      { id: '', label: 'All', icon: 'fa-list', color: 'violet' },
      { id: 'new', label: 'New', icon: 'fa-fire', color: 'amber' },
      { id: 'contacted', label: 'Contacted', icon: 'fa-phone-alt', color: 'blue' },
      { id: 'qualified', label: 'Qualified', icon: 'fa-star', color: 'green' },
      { id: 'converted', label: 'Converted', icon: 'fa-check-circle', color: 'emerald' },
      { id: 'lost', label: 'Lost', icon: 'fa-times-circle', color: 'red' },
    ];
    var stageCountMap = {};
    (state.leadStages || []).forEach(function(s) { stageCountMap[s.lead_status] = s.cnt; });

    var stageFilter = stages.map(function(s) {
      var cnt = s.id ? (stageCountMap[s.id] || 0) : state.leadsCount;
      var active = (state.leadStatusFilter || '') === s.id;
      return '<button onclick="secFilterLeads(\'' + s.id + '\')" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ' +
        (active ? 'bg-' + s.color + '-600 text-white shadow' : 'bg-gray-100 text-gray-600 hover:bg-gray-200') + '">' +
        '<i class="fas ' + s.icon + ' mr-1"></i>' + s.label + (cnt > 0 ? ' (' + cnt + ')' : '') + '</button>';
    }).join('');

    content.innerHTML =
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">' +
        '<div class="px-6 py-4 border-b border-gray-100">' +
          '<div class="flex flex-col md:flex-row md:items-center justify-between gap-3">' +
            '<h3 class="font-bold text-gray-800 text-lg"><i class="fas fa-fire text-amber-500 mr-2"></i>Leads <span class="text-gray-400 font-normal text-sm">(' + state.leadsCount + ')</span></h3>' +
            '<div class="flex flex-wrap items-center gap-2">' + stageFilter + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="divide-y divide-gray-100">' +
          state.leads.map(function(lead) {
            var statusColors = { new: 'bg-amber-100 text-amber-700', contacted: 'bg-blue-100 text-blue-700', qualified: 'bg-green-100 text-green-700', converted: 'bg-emerald-100 text-emerald-800', lost: 'bg-red-100 text-red-700' };
            var sc = statusColors[lead.lead_status] || 'bg-gray-100 text-gray-600';
            var qualityStars = lead.lead_quality === 'hot' ? 3 : (lead.lead_quality === 'warm' ? 2 : 1);
            return '<div class="px-6 py-4 hover:bg-gray-50 transition-colors cursor-pointer" onclick="secViewCall(' + lead.id + ')">' +
              '<div class="flex items-center justify-between">' +
                '<div class="flex items-center gap-3">' +
                  '<div class="w-11 h-11 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center shadow">' +
                    '<i class="fas fa-user text-white text-sm"></i>' +
                  '</div>' +
                  '<div>' +
                    '<div class="flex items-center gap-2">' +
                      '<p class="font-bold text-gray-800">' + esc(lead.caller_name || 'Unknown') + '</p>' +
                      '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold ' + sc + '">' + (lead.lead_status || 'new').toUpperCase() + '</span>' +
                      '<span class="text-amber-400 text-xs">' + '★'.repeat(qualityStars) + '<span class="text-gray-300">' + '★'.repeat(3 - qualityStars) + '</span></span>' +
                    '</div>' +
                    '<p class="text-xs text-gray-500 mt-0.5">' +
                      '<i class="fas fa-phone text-gray-400 mr-1"></i>' + esc(lead.caller_phone || '') +
                      (lead.caller_email ? ' &middot; <i class="fas fa-envelope text-gray-400 mr-1"></i>' + esc(lead.caller_email) : '') +
                    '</p>' +
                    (lead.property_address ? '<p class="text-xs text-gray-500"><i class="fas fa-map-marker-alt text-red-400 mr-1"></i>' + esc(lead.property_address) + '</p>' : '') +
                    (lead.service_type ? '<p class="text-xs text-violet-600 font-medium mt-0.5"><i class="fas fa-tools mr-1"></i>' + esc(lead.service_type) + '</p>' : '') +
                  '</div>' +
                '</div>' +
                '<div class="text-right flex-shrink-0">' +
                  '<p class="text-xs text-gray-400">' + formatTimeAgo(lead.created_at) + '</p>' +
                  '<p class="text-xs text-gray-400 mt-0.5">' + formatDuration(lead.call_duration_seconds) + '</p>' +
                  '<div class="flex items-center gap-1 mt-1 justify-end">' +
                    '<select onclick="event.stopPropagation()" onchange="secUpdateLeadStatus(' + lead.id + ', this.value)" class="text-[10px] border border-gray-200 rounded px-1 py-0.5">' +
                      '<option value="new"' + (lead.lead_status === 'new' ? ' selected' : '') + '>New</option>' +
                      '<option value="contacted"' + (lead.lead_status === 'contacted' ? ' selected' : '') + '>Contacted</option>' +
                      '<option value="qualified"' + (lead.lead_status === 'qualified' ? ' selected' : '') + '>Qualified</option>' +
                      '<option value="converted"' + (lead.lead_status === 'converted' ? ' selected' : '') + '>Converted</option>' +
                      '<option value="lost"' + (lead.lead_status === 'lost' ? ' selected' : '') + '>Lost</option>' +
                    '</select>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              (lead.call_summary ? '<p class="text-sm text-gray-600 mt-2 bg-gray-50 rounded-lg p-3 line-clamp-2"><i class="fas fa-robot text-gray-400 mr-1"></i>' + esc(lead.call_summary) + '</p>' : '') +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>';
  }

  // ── Call Detail / Full Transcript Modal ──
  window.secViewCall = async function(callId) {
    try {
      var res = await fetch('/api/secretary/calls/' + callId, { headers: authOnly() });
      if (!res.ok) return;
      var data = await res.json();
      var call = data.call;
      if (!call) return;
      showCallDetailModal(call, data.messages || [], data.appointments || [], data.callbacks || []);
    } catch(e) { console.error('Failed to load call detail', e); }
  };

  function showCallDetailModal(call, messages, appointments, callbacks) {
    // Remove any existing modal
    var existing = document.getElementById('callDetailModal');
    if (existing) existing.remove();

    var isLead = call.is_lead;
    var sentimentLabel = call.sentiment === 'positive' ? 'Positive' : (call.sentiment === 'negative' ? 'Negative' : 'Neutral');
    var sentimentColor = call.sentiment === 'positive' ? 'text-green-600 bg-green-50' : (call.sentiment === 'negative' ? 'text-red-600 bg-red-50' : 'text-gray-600 bg-gray-50');

    var transcript = call.call_transcript || 'No transcript available for this call.';
    // Format transcript lines
    var transcriptHtml = esc(transcript).replace(/\n/g, '<br>').replace(/(Sarah|Agent|AI):/gi, '<span class="font-bold text-violet-600">$1:</span>').replace(/(Caller|Customer|User):/gi, '<span class="font-bold text-blue-600">$1:</span>');

    var modal = document.createElement('div');
    modal.id = 'callDetailModal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4';
    modal.innerHTML =
      '<div class="absolute inset-0 bg-black/50 backdrop-blur-sm" onclick="document.getElementById(\'callDetailModal\').remove()"></div>' +
      '<div class="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">' +
        // Header
        '<div class="bg-gradient-to-r from-violet-600 to-purple-700 px-6 py-4 flex items-center justify-between">' +
          '<div class="flex items-center gap-3">' +
            '<div class="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">' +
              '<i class="fas ' + (isLead ? 'fa-fire text-amber-300' : 'fa-phone text-white') + '"></i>' +
            '</div>' +
            '<div>' +
              '<h3 class="text-white font-bold">' + esc(call.caller_name || 'Unknown Caller') + '</h3>' +
              '<p class="text-purple-200 text-xs">' + esc(call.caller_phone || '') + ' — ' + new Date(call.created_at).toLocaleString() + '</p>' +
            '</div>' +
          '</div>' +
          '<button onclick="document.getElementById(\'callDetailModal\').remove()" class="text-white/70 hover:text-white text-lg"><i class="fas fa-times"></i></button>' +
        '</div>' +
        // Info bar
        '<div class="px-6 py-3 bg-gray-50 border-b border-gray-200 flex flex-wrap gap-3">' +
          '<span class="px-2.5 py-1 rounded-full text-xs font-bold ' + (call.call_outcome === 'answered' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600') + '"><i class="fas fa-phone-alt mr-1"></i>' + (call.call_outcome || 'unknown') + '</span>' +
          '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-violet-100 text-violet-700"><i class="fas fa-clock mr-1"></i>' + formatDuration(call.call_duration_seconds) + '</span>' +
          '<span class="px-2.5 py-1 rounded-full text-xs font-bold ' + sentimentColor + '"><i class="fas fa-' + (call.sentiment === 'positive' ? 'smile' : call.sentiment === 'negative' ? 'frown' : 'meh') + ' mr-1"></i>' + sentimentLabel + '</span>' +
          (isLead ? '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700"><i class="fas fa-fire mr-1"></i>Lead — ' + (call.lead_status || 'new') + '</span>' : '') +
          (call.service_type ? '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-700"><i class="fas fa-tools mr-1"></i>' + esc(call.service_type) + '</span>' : '') +
        '</div>' +
        // Scrollable body
        '<div class="flex-1 overflow-y-auto px-6 py-4 space-y-4">' +
          // Contact info
          (call.property_address ? '<div class="flex items-center gap-2 text-sm text-gray-600"><i class="fas fa-map-marker-alt text-red-400 w-5"></i><strong>Address:</strong> ' + esc(call.property_address) + '</div>' : '') +
          (call.caller_email ? '<div class="flex items-center gap-2 text-sm text-gray-600"><i class="fas fa-envelope text-gray-400 w-5"></i><strong>Email:</strong> ' + esc(call.caller_email) + '</div>' : '') +
          (call.directory_routed ? '<div class="flex items-center gap-2 text-sm text-gray-600"><i class="fas fa-arrow-right text-gray-400 w-5"></i><strong>Routed to:</strong> ' + esc(call.directory_routed) + '</div>' : '') +

          // AI Summary
          (call.call_summary ? '<div class="bg-violet-50 border border-violet-200 rounded-xl p-4"><h4 class="font-bold text-violet-800 text-sm mb-1"><i class="fas fa-robot mr-1"></i>AI Call Summary</h4><p class="text-sm text-violet-700">' + esc(call.call_summary) + '</p></div>' : '') +

          // Highlights
          (call.conversation_highlights ? '<div class="bg-amber-50 border border-amber-200 rounded-xl p-4"><h4 class="font-bold text-amber-800 text-sm mb-1"><i class="fas fa-star mr-1"></i>Key Highlights</h4><p class="text-sm text-amber-700">' + esc(call.conversation_highlights) + '</p></div>' : '') +

          // Follow-up notes
          (call.follow_up_notes ? '<div class="bg-red-50 border border-red-200 rounded-xl p-4"><h4 class="font-bold text-red-800 text-sm mb-1"><i class="fas fa-exclamation-circle mr-1"></i>Follow-Up Notes</h4><p class="text-sm text-red-700">' + esc(call.follow_up_notes) + '</p></div>' : '') +

          // Messages taken
          (messages.length > 0 ? '<div class="bg-blue-50 border border-blue-200 rounded-xl p-4"><h4 class="font-bold text-blue-800 text-sm mb-2"><i class="fas fa-envelope mr-1"></i>Messages Taken (' + messages.length + ')</h4>' +
            messages.map(function(m) { return '<div class="text-sm text-blue-700 mb-1">• ' + esc(m.message_text) + (m.urgency !== 'normal' ? ' <span class="text-red-600 font-bold">(' + m.urgency + ')</span>' : '') + '</div>'; }).join('') +
          '</div>' : '') +

          // Appointments booked
          (appointments.length > 0 ? '<div class="bg-green-50 border border-green-200 rounded-xl p-4"><h4 class="font-bold text-green-800 text-sm mb-2"><i class="fas fa-calendar-check mr-1"></i>Appointments Booked (' + appointments.length + ')</h4>' +
            appointments.map(function(a) { return '<div class="text-sm text-green-700 mb-1">• ' + esc(a.appointment_type || 'Estimate') + (a.property_address ? ' at ' + esc(a.property_address) : '') + (a.notes ? ' — ' + esc(a.notes) : '') + '</div>'; }).join('') +
          '</div>' : '') +

          // Full Transcript
          '<div class="bg-gray-50 border border-gray-200 rounded-xl p-4">' +
            '<h4 class="font-bold text-gray-800 text-sm mb-3"><i class="fas fa-file-alt mr-1"></i>Full Call Transcript</h4>' +
            '<div class="text-sm text-gray-700 leading-relaxed font-mono bg-white rounded-lg p-4 border border-gray-100 max-h-64 overflow-y-auto">' +
              transcriptHtml +
            '</div>' +
          '</div>' +
        '</div>' +
        // Footer actions
        '<div class="px-6 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between">' +
          '<div class="flex gap-2">' +
            (isLead ? '<select id="modalLeadStatus" onchange="secUpdateLeadStatus(' + call.id + ', this.value)" class="text-xs border border-gray-200 rounded-lg px-2 py-1.5">' +
              '<option value="new"' + (call.lead_status === 'new' ? ' selected' : '') + '>New</option>' +
              '<option value="contacted"' + (call.lead_status === 'contacted' ? ' selected' : '') + '>Contacted</option>' +
              '<option value="qualified"' + (call.lead_status === 'qualified' ? ' selected' : '') + '>Qualified</option>' +
              '<option value="converted"' + (call.lead_status === 'converted' ? ' selected' : '') + '>Converted</option>' +
              '<option value="lost"' + (call.lead_status === 'lost' ? ' selected' : '') + '>Lost</option>' +
            '</select>' : '') +
          '</div>' +
          '<button onclick="document.getElementById(\'callDetailModal\').remove()" class="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-medium transition-all">Close</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
  }

  // ── Call action handlers ──
  window.secFilterCalls = function(filter) { state.callFilter = filter; loadCalls(filter); };
  window.secSearchCalls = function() { state.callSearch = (document.getElementById('callSearchInput') || {}).value || ''; loadCalls(); };
  window.secFilterLeads = function(status) { state.leadStatusFilter = status; loadLeads(status); };

  window.secSimulateCall = async function() {
    try {
      var res = await fetch('/api/secretary/simulate-call', { method: 'POST', headers: authHeaders() });
      if (res.ok) {
        var data = await res.json();
        alert('✅ ' + data.message);
        loadCalls();
      } else {
        var err = await res.json().catch(function() { return {}; });
        alert('❌ ' + (err.error || 'Failed to simulate call'));
      }
    } catch(e) { alert('❌ Network error: ' + e.message); }
  };

  window.secUpdateLeadStatus = async function(callId, status) {
    try {
      await fetch('/api/secretary/calls/' + callId, {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ lead_status: status })
      });
      // Refresh data
      if (state.activeTab === 'leads') loadLeads(state.leadStatusFilter);
      else loadCalls();
    } catch(e) {}
  };

  window.secCompleteFollowUp = async function(callId) {
    try {
      await fetch('/api/secretary/calls/' + callId, {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ follow_up_completed: true })
      });
      loadCalls();
    } catch(e) {}
  };

  function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    var diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return new Date(dateStr).toLocaleDateString();
  }

  // ── Shared functions ──
  window.secAddDir = function() {
    var list = document.getElementById('directoriesList');
    if (!list || list.children.length >= 4) return;
    var count = list.children.length;
    var div = document.createElement('div');
    div.innerHTML = dirCard({ name: '', phone_or_action: '', special_notes: '' }, count);
    list.appendChild(div.firstChild);
    if (count + 1 >= 4) { var btn = document.getElementById('addDirBtn'); if (btn) { btn.disabled = true; btn.classList.add('opacity-50','cursor-not-allowed'); } }
  };

  window.secRemoveDir = function(idx) {
    var list = document.getElementById('directoriesList');
    if (!list || list.children.length <= 2) { alert('Minimum 2 directories required'); return; }
    list.children[idx].remove();
    Array.from(list.children).forEach(function(el, i) { el.setAttribute('data-dir', i); });
  };

  window.secSaveConfig = async function() {
    var btn = document.getElementById('saveConfigBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...'; }

    // Build business hours object for full mode
    var businessHours = {};
    ['mon','tue','wed','thu','fri','sat','sun'].forEach(function(d) {
      var el = document.getElementById('fullHrs_' + d);
      if (el) businessHours[d] = el.value || 'closed';
    });

    // Gather answering fallback radio
    var fallbackRadio = document.querySelector('input[name="answering_fallback"]:checked');

    try {
      var res = await fetch('/api/secretary/config', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          business_phone: document.getElementById('secPhone')?.value || '',
          greeting_script: document.getElementById('secGreeting')?.value || '',
          common_qa: document.getElementById('secQA')?.value || '',
          general_notes: document.getElementById('secNotes')?.value || '',
          secretary_mode: state.secretaryMode,
          // Agent persona
          agent_name: document.getElementById('agentNameInput')?.value || state.selectedAgentName || 'Sarah',
          agent_voice: state.selectedAgentVoice || (state.phoneSetup && state.phoneSetup.agent_voice) || 'alloy',
          // Answering mode
          answering_fallback_action: fallbackRadio ? fallbackRadio.value : 'take_message',
          answering_forward_number: document.getElementById('answeringFwdNum')?.value || '',
          answering_sms_notify: document.getElementById('answeringSms')?.checked ? 1 : 0,
          answering_email_notify: document.getElementById('answeringEmail')?.checked ? 1 : 0,
          answering_notify_email: document.getElementById('answeringNotifyEmail')?.value || '',
          // Full mode
          full_can_book_appointments: document.getElementById('fullBookAppts')?.checked ? 1 : 0,
          full_can_send_email: document.getElementById('fullSendEmail')?.checked ? 1 : 0,
          full_can_schedule_callback: document.getElementById('fullScheduleCallback')?.checked ? 1 : 0,
          full_can_answer_faq: document.getElementById('fullAnswerFaq')?.checked ? 1 : 0,
          full_can_take_payment_info: document.getElementById('fullTakePayment')?.checked ? 1 : 0,
          full_business_hours: JSON.stringify(businessHours),
          full_booking_link: document.getElementById('fullBookingLink')?.value || '',
          full_services_offered: document.getElementById('fullServices')?.value || '',
          full_pricing_info: document.getElementById('fullPricing')?.value || '',
          full_service_area: document.getElementById('fullServiceArea')?.value || '',
          full_email_from_name: document.getElementById('fullEmailFromName')?.value || '',
          full_email_signature: document.getElementById('fullEmailSig')?.value || '',
        })
      });
      var data = await res.json();
      if (data.success) { showToast('Configuration saved! Mode: ' + state.secretaryMode, 'success'); await loadStatus(); }
      else alert(data.error || 'Save failed');
    } catch(e) { alert('Network error'); }
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Configuration'; }
  };

  window.secSaveDirs = async function() {
    var list = document.getElementById('directoriesList');
    if (!list) return;
    var dirs = [];
    for (var i = 0; i < list.children.length; i++) {
      dirs.push({
        name: document.getElementById('dirName' + i)?.value || '',
        phone_or_action: document.getElementById('dirAction' + i)?.value || '',
        special_notes: document.getElementById('dirNotes' + i)?.value || '',
      });
    }
    if (dirs.length < 2) { alert('Minimum 2 directories required'); return; }
    var btn = document.getElementById('saveDirsBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...'; }
    try {
      var res = await fetch('/api/secretary/directories', { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ directories: dirs }) });
      var data = await res.json();
      if (data.success) { showToast('Directories saved!', 'success'); await loadStatus(); }
      else alert(data.error || 'Save failed');
    } catch(e) { alert('Network error'); }
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Directories'; }
  };

  window.secToggle = async function() {
    try {
      var res = await fetch('/api/secretary/toggle', { method: 'POST', headers: authHeaders() });
      var data = await res.json();
      if (data.message) { showToast(data.message, data.is_active ? 'success' : 'info'); await loadStatus(); }
      else alert(data.error || 'Toggle failed');
    } catch(e) { alert('Network error'); }
  };

  // ── Helpers ──
  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function formatDuration(s) { if (!s) return '0s'; var m = Math.floor(s/60); var sec = s%60; return m > 0 ? m + 'm ' + sec + 's' : sec + 's'; }

  function formatPhone(num) {
    if (!num) return '';
    var clean = num.replace(/\D/g, '');
    if (clean.length === 11 && clean[0] === '1') clean = clean.slice(1);
    if (clean.length === 10) return '(' + clean.slice(0,3) + ') ' + clean.slice(3,6) + '-' + clean.slice(6);
    return num;
  }

  window.copyToClipboard = function(text) {
    navigator.clipboard.writeText(text).then(function() {
      showToast('Copied to clipboard!', 'success');
    }).catch(function() {
      // Fallback
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      showToast('Copied!', 'success');
    });
  };

  function showToast(msg, type) {
    var toast = document.createElement('div');
    toast.className = 'fixed bottom-6 right-6 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold z-50 transition-all ' +
      (type === 'success' ? 'bg-green-500 text-white' : 'bg-sky-500 text-white');
    toast.innerHTML = '<i class="fas ' + (type === 'success' ? 'fa-check-circle' : 'fa-info-circle') + ' mr-2"></i>' + msg;
    document.body.appendChild(toast);
    setTimeout(function() { toast.remove(); }, 3000);
  }

  // ============================================================
  // MESSAGES TAB (Answering Mode)
  // ============================================================
  async function loadAndRenderMessages() {
    var content = document.getElementById('secContent');
    if (!content) return;
    content.innerHTML = '<div class="flex items-center justify-center py-12"><i class="fas fa-spinner fa-spin text-2xl text-purple-500"></i></div>';
    try {
      var res = await fetch('/api/secretary/messages?limit=50', { headers: authOnly() });
      var data = await res.json();
      state.messages = data.messages || [];
      state.unreadCount = data.unread_count || 0;
    } catch(e) {}
    renderMessagesTab();
  }

  function renderMessagesTab() {
    var content = document.getElementById('secContent');
    if (!content) return;
    var msgs = state.messages;

    content.innerHTML =
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">' +
        '<div class="flex items-center justify-between mb-4">' +
          '<h3 class="font-bold text-gray-800 text-lg"><i class="fas fa-envelope text-purple-500 mr-2"></i>Messages' +
            (state.unreadCount > 0 ? ' <span class="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-bold">' + state.unreadCount + ' unread</span>' : '') + '</h3>' +
          (state.unreadCount > 0 ? '<button onclick="secMarkAllRead()" class="text-xs text-purple-600 hover:text-purple-800 font-semibold"><i class="fas fa-check-double mr-1"></i>Mark All Read</button>' : '') +
        '</div>' +
        (msgs.length === 0 ? '<p class="text-gray-400 text-center py-8"><i class="fas fa-inbox text-3xl block mb-2"></i>No messages yet. When callers leave messages, they\'ll appear here.</p>' :
          '<div class="space-y-3">' +
            msgs.map(function(m) {
              var unread = !m.is_read;
              var urgentBadge = m.urgency === 'urgent' ? '<span class="px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-[10px] font-bold">URGENT</span>' :
                m.urgency === 'emergency' ? '<span class="px-2 py-0.5 bg-red-600 text-white rounded-full text-[10px] font-bold">EMERGENCY</span>' : '';
              return '<div class="border ' + (unread ? 'border-purple-200 bg-purple-50' : 'border-gray-200 bg-gray-50') + ' rounded-xl p-4 ' + (unread ? 'ring-1 ring-purple-300' : '') + '">' +
                '<div class="flex items-start justify-between mb-2">' +
                  '<div class="flex items-center gap-2">' +
                    (unread ? '<span class="w-2 h-2 bg-purple-500 rounded-full"></span>' : '') +
                    '<span class="font-semibold text-gray-800 text-sm">' + esc(m.caller_name || 'Unknown Caller') + '</span>' +
                    '<span class="text-gray-400 text-xs">' + esc(m.caller_phone || '') + '</span>' +
                    urgentBadge +
                  '</div>' +
                  '<span class="text-gray-400 text-xs">' + new Date(m.created_at).toLocaleString() + '</span>' +
                '</div>' +
                '<p class="text-sm text-gray-700 leading-relaxed">' + esc(m.message_text) + '</p>' +
                (unread ? '<button onclick="secMarkRead(' + m.id + ')" class="mt-2 text-xs text-purple-600 hover:text-purple-800 font-semibold"><i class="fas fa-check mr-1"></i>Mark Read</button>' : '') +
              '</div>';
            }).join('') +
          '</div>') +
      '</div>';
  }

  window.secMarkRead = async function(id) {
    await fetch('/api/secretary/messages/' + id + '/read', { method: 'POST', headers: authHeaders() });
    loadAndRenderMessages();
  };
  window.secMarkAllRead = async function() {
    await fetch('/api/secretary/messages/read-all', { method: 'POST', headers: authHeaders() });
    loadAndRenderMessages();
  };

  // ============================================================
  // APPOINTMENTS TAB (Full Mode)
  // ============================================================
  async function loadAndRenderAppointments() {
    var content = document.getElementById('secContent');
    if (!content) return;
    content.innerHTML = '<div class="flex items-center justify-center py-12"><i class="fas fa-spinner fa-spin text-2xl text-emerald-500"></i></div>';
    try {
      var res = await fetch('/api/secretary/appointments?limit=50', { headers: authOnly() });
      var data = await res.json();
      state.appointments = data.appointments || [];
      state.pendingAppts = data.pending_count || 0;
    } catch(e) {}
    renderAppointmentsTab();
  }

  function renderAppointmentsTab() {
    var content = document.getElementById('secContent');
    if (!content) return;
    var appts = state.appointments;

    var statusColors = {
      pending: 'bg-amber-100 text-amber-700',
      confirmed: 'bg-green-100 text-green-700',
      cancelled: 'bg-red-100 text-red-700',
      completed: 'bg-blue-100 text-blue-700'
    };

    content.innerHTML =
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">' +
        '<div class="flex items-center justify-between mb-4">' +
          '<h3 class="font-bold text-gray-800 text-lg"><i class="fas fa-calendar-check text-emerald-500 mr-2"></i>Appointments' +
            (state.pendingAppts > 0 ? ' <span class="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">' + state.pendingAppts + ' pending</span>' : '') + '</h3>' +
        '</div>' +
        (appts.length === 0 ? '<p class="text-gray-400 text-center py-8"><i class="fas fa-calendar text-3xl block mb-2"></i>No appointments yet. When the AI books appointments, they\'ll appear here.</p>' :
          '<div class="overflow-x-auto"><table class="w-full text-sm">' +
            '<thead><tr class="border-b border-gray-200"><th class="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Caller</th><th class="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Date/Time</th><th class="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Type</th><th class="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Address</th><th class="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Status</th><th class="text-left py-2 px-3 text-xs font-semibold text-gray-500 uppercase">Actions</th></tr></thead>' +
            '<tbody>' + appts.map(function(a) {
              return '<tr class="border-b border-gray-100 hover:bg-gray-50">' +
                '<td class="py-3 px-3"><div class="font-semibold text-gray-800">' + esc(a.caller_name || 'Unknown') + '</div><div class="text-xs text-gray-400">' + esc(a.caller_phone || '') + '</div></td>' +
                '<td class="py-3 px-3 text-gray-700">' + esc(a.appointment_date || '—') + ' ' + esc(a.appointment_time || '') + '</td>' +
                '<td class="py-3 px-3"><span class="px-2 py-0.5 bg-sky-100 text-sky-700 rounded text-xs">' + esc(a.appointment_type || 'estimate') + '</span></td>' +
                '<td class="py-3 px-3 text-gray-600 text-xs">' + esc(a.property_address || '—') + '</td>' +
                '<td class="py-3 px-3"><span class="px-2 py-0.5 rounded text-xs font-semibold ' + (statusColors[a.status] || 'bg-gray-100 text-gray-600') + '">' + esc(a.status) + '</span></td>' +
                '<td class="py-3 px-3">' +
                  (a.status === 'pending' ? '<button onclick="secUpdateAppt(' + a.id + ',\'confirmed\')" class="text-xs text-green-600 hover:text-green-800 font-semibold mr-2"><i class="fas fa-check mr-1"></i>Confirm</button>' +
                    '<button onclick="secUpdateAppt(' + a.id + ',\'cancelled\')" class="text-xs text-red-500 hover:text-red-700 font-semibold"><i class="fas fa-times mr-1"></i>Cancel</button>' :
                   a.status === 'confirmed' ? '<button onclick="secUpdateAppt(' + a.id + ',\'completed\')" class="text-xs text-blue-600 hover:text-blue-800 font-semibold"><i class="fas fa-check-double mr-1"></i>Complete</button>' : '—') +
                '</td></tr>';
            }).join('') + '</tbody></table></div>') +
      '</div>';
  }

  window.secUpdateAppt = async function(id, status) {
    await fetch('/api/secretary/appointments/' + id, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ status: status }) });
    loadAndRenderAppointments();
  };

  // ============================================================
  // CALLBACKS TAB (Full Mode)
  // ============================================================
  async function loadAndRenderCallbacks() {
    var content = document.getElementById('secContent');
    if (!content) return;
    content.innerHTML = '<div class="flex items-center justify-center py-12"><i class="fas fa-spinner fa-spin text-2xl text-sky-500"></i></div>';
    try {
      var res = await fetch('/api/secretary/callbacks?limit=50', { headers: authOnly() });
      var data = await res.json();
      state.callbacks = data.callbacks || [];
      state.pendingCallbacks = data.pending_count || 0;
    } catch(e) {}
    renderCallbacksTab();
  }

  function renderCallbacksTab() {
    var content = document.getElementById('secContent');
    if (!content) return;
    var cbs = state.callbacks;

    content.innerHTML =
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">' +
        '<div class="flex items-center justify-between mb-4">' +
          '<h3 class="font-bold text-gray-800 text-lg"><i class="fas fa-phone-volume text-sky-500 mr-2"></i>Scheduled Callbacks' +
            (state.pendingCallbacks > 0 ? ' <span class="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">' + state.pendingCallbacks + ' pending</span>' : '') + '</h3>' +
        '</div>' +
        (cbs.length === 0 ? '<p class="text-gray-400 text-center py-8"><i class="fas fa-phone text-3xl block mb-2"></i>No callbacks yet. When the AI schedules callbacks, they\'ll appear here.</p>' :
          '<div class="space-y-3">' + cbs.map(function(cb) {
            var isPending = cb.status === 'pending';
            return '<div class="border ' + (isPending ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50') + ' rounded-xl p-4">' +
              '<div class="flex items-start justify-between">' +
                '<div>' +
                  '<div class="font-semibold text-gray-800 text-sm">' + esc(cb.caller_name || 'Unknown') + ' — <a href="tel:' + esc(cb.caller_phone) + '" class="text-sky-600 hover:underline">' + formatPhone(cb.caller_phone) + '</a></div>' +
                  (cb.preferred_time ? '<div class="text-xs text-gray-500 mt-1"><i class="fas fa-clock mr-1"></i>Preferred: ' + esc(cb.preferred_time) + '</div>' : '') +
                  (cb.reason ? '<div class="text-sm text-gray-600 mt-1">' + esc(cb.reason) + '</div>' : '') +
                  '<div class="text-xs text-gray-400 mt-1">' + new Date(cb.created_at).toLocaleString() + '</div>' +
                '</div>' +
                '<div class="flex items-center gap-2">' +
                  '<span class="px-2 py-0.5 rounded text-xs font-semibold ' + (isPending ? 'bg-amber-100 text-amber-700' : cb.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600') + '">' + esc(cb.status) + '</span>' +
                  (isPending ? '<button onclick="secUpdateCallback(' + cb.id + ',\'completed\')" class="text-xs text-green-600 hover:text-green-800 font-semibold px-2 py-1 bg-green-50 rounded"><i class="fas fa-check mr-1"></i>Done</button>' : '') +
                '</div>' +
              '</div>' +
            '</div>';
          }).join('') + '</div>') +
      '</div>';
  }

  window.secUpdateCallback = async function(id, status) {
    await fetch('/api/secretary/callbacks/' + id, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ status: status }) });
    loadAndRenderCallbacks();
  };

  // ============================================================
  // VOICE TEST AGENT — Browser microphone test
  // Uses Web Speech API for transcription (works in Chrome, Edge, Safari)
  // Then sends text to AI chat endpoint for response
  // ============================================================
  var testState = { active: false, recognition: null, conversationHistory: [], processing: false };

  window.secTestAgent = function() {
    // Build the test modal
    var existing = document.getElementById('voiceTestModal');
    if (existing) existing.remove();

    // Check for Web Speech API support
    var hasSpeechAPI = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

    var modal = document.createElement('div');
    modal.id = 'voiceTestModal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm';
    modal.innerHTML =
      '<div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">' +
        '<div class="bg-gradient-to-r from-emerald-500 to-teal-600 p-5 text-white">' +
          '<div class="flex items-center justify-between">' +
            '<div><h2 class="text-lg font-bold"><i class="fas fa-comment-dots mr-2"></i>Test Your AI Secretary</h2>' +
            '<p class="text-emerald-100 text-xs mt-1">Preview how your AI responds to questions. Type a message below to test.</p></div>' +
            '<button onclick="secCloseTestModal()" class="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-all"><i class="fas fa-times text-sm"></i></button>' +
          '</div>' +
        '</div>' +
        '<div class="p-5">' +
          '<div class="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-3 flex items-start gap-2.5">' +
            '<i class="fas fa-info-circle text-blue-500 mt-0.5 flex-shrink-0"></i>' +
            '<div class="text-xs text-blue-700"><strong>Text Preview Only</strong> — This tests your AI\'s responses as text. The real phone experience uses professional <strong>Cartesia</strong> voice synthesis and sounds much more natural.' +
            (state.config && state.config.assigned_phone_number ? '<div class="mt-1.5 flex items-center gap-2"><i class="fas fa-phone-alt text-emerald-600"></i><strong class="text-emerald-700">Call ' + state.config.assigned_phone_number + ' to hear the real voice.</strong></div>' : '') +
            '</div>' +
          '</div>' +
          '<div id="vtConversation" class="h-56 overflow-y-auto mb-3 space-y-3 p-3 bg-gray-50 rounded-xl border border-gray-200">' +
            '<div class="text-center text-gray-400 text-sm py-6"><i class="fas fa-robot text-3xl block mb-2 text-emerald-300"></i>' +
            'Type a message below to test your AI secretary.<br><span class="text-xs">The AI responds based on your saved greeting, Q&A, and notes.</span>' +
            '</div>' +
          '</div>' +
          '<div id="vtStatus" class="text-center text-xs text-gray-400 mb-2 h-4"></div>' +
          '<div class="flex items-center gap-2 mb-3">' +
            '<input type="text" id="vtTextInput" placeholder="Type a caller question... e.g. \'Do you do free estimates?\'" class="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400" onkeydown="if(event.key===\'Enter\')secSendText()">' +
            '<button onclick="secSendText()" class="px-4 py-2.5 bg-emerald-500 text-white rounded-xl text-sm font-semibold hover:bg-emerald-600 transition-all"><i class="fas fa-paper-plane"></i></button>' +
          '</div>' +
          '<div class="flex items-center justify-center gap-3">' +
            (hasSpeechAPI ?
              '<button onclick="secStartRecording()" id="vtRecordBtn" class="w-10 h-10 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center hover:bg-gray-300 transition-all" title="Use microphone">' +
                '<i class="fas fa-microphone text-sm"></i>' +
              '</button>' +
              '<button onclick="secStopRecording()" id="vtStopBtn" class="w-10 h-10 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-all hidden animate-pulse" title="Stop recording">' +
                '<i class="fas fa-stop text-sm"></i>' +
              '</button>'
              : '') +
            '<button onclick="secResetTest()" class="w-10 h-10 rounded-full bg-gray-200 text-gray-500 flex items-center justify-center hover:bg-gray-300 transition-all" title="Reset conversation">' +
              '<i class="fas fa-redo text-sm"></i>' +
            '</button>' +
          '</div>' +
          (state.config && state.config.assigned_phone_number ?
            '<div class="mt-4 bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">' +
              '<p class="text-xs text-emerald-800 font-semibold"><i class="fas fa-phone-alt mr-1"></i>Want to hear ' + (state.config.agent_name || 'Sarah') + '\'s real voice?</p>' +
              '<p class="text-lg font-black text-emerald-700 mt-1">' + state.config.assigned_phone_number + '</p>' +
              '<p class="text-[10px] text-emerald-600 mt-0.5">Call this number from your phone — the AI will answer exactly as it would for your customers.</p>' +
            '</div>'
            : '<p class="text-center text-xs text-gray-400 mt-3">Connect a phone number to test the real voice experience.</p>') +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    testState.conversationHistory = [];
    modal.addEventListener('click', function(e) { if (e.target === modal) secCloseTestModal(); });
  };

  window.secCloseTestModal = function() {
    if (testState.recognition) {
      try { testState.recognition.stop(); } catch(e) {}
      testState.recognition = null;
    }
    testState.active = false;
    testState.conversationHistory = [];
    var m = document.getElementById('voiceTestModal');
    if (m) m.remove();
  };

  window.secResetTest = function() {
    testState.conversationHistory = [];
    var conv = document.getElementById('vtConversation');
    if (conv) conv.innerHTML = '<div class="text-center text-gray-400 text-sm py-8"><i class="fas fa-robot text-3xl block mb-2 text-emerald-300"></i>Conversation reset. Press the microphone or type to start again.</div>';
  };

  // Text input method (always works)
  window.secSendText = function() {
    if (testState.processing) return;
    var input = document.getElementById('vtTextInput');
    if (!input || !input.value.trim()) return;
    var text = input.value.trim();
    input.value = '';
    processAIChat(text);
  };

  // Speech recognition using Web Speech API
  window.secStartRecording = function() {
    if (testState.processing) return;
    var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition not supported. Please use the text input or try Chrome/Edge.');
      return;
    }

    testState.recognition = new SpeechRecognition();
    testState.recognition.continuous = false;
    testState.recognition.interimResults = true;
    testState.recognition.lang = 'en-US';
    testState.recognition.maxAlternatives = 1;

    var recordBtn = document.getElementById('vtRecordBtn');
    var stopBtn = document.getElementById('vtStopBtn');
    var statusEl = document.getElementById('vtStatus');

    testState.recognition.onstart = function() {
      testState.active = true;
      if (recordBtn) recordBtn.classList.add('hidden');
      if (stopBtn) stopBtn.classList.remove('hidden');
      if (statusEl) { statusEl.textContent = 'Listening... speak now'; statusEl.className = 'text-center text-xs text-red-500 mb-3 h-4 font-semibold'; }
    };

    testState.recognition.onresult = function(event) {
      var transcript = '';
      for (var i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      if (statusEl && transcript) statusEl.textContent = 'Heard: "' + transcript.substring(0, 60) + (transcript.length > 60 ? '...' : '') + '"';
    };

    testState.recognition.onend = function() {
      testState.active = false;
      if (recordBtn) recordBtn.classList.remove('hidden');
      if (stopBtn) stopBtn.classList.add('hidden');

      // Get final transcript
      if (testState._lastTranscript && testState._lastTranscript.trim()) {
        processAIChat(testState._lastTranscript.trim());
        testState._lastTranscript = '';
      } else {
        if (statusEl) { statusEl.textContent = 'No speech detected. Try again or type your message.'; statusEl.className = 'text-center text-xs text-amber-500 mb-3 h-4'; }
      }
    };

    testState.recognition.onerror = function(event) {
      testState.active = false;
      if (recordBtn) recordBtn.classList.remove('hidden');
      if (stopBtn) stopBtn.classList.add('hidden');
      if (event.error === 'not-allowed') {
        alert('Microphone access denied. Please allow microphone access in your browser settings.');
      } else {
        if (statusEl) { statusEl.textContent = 'Error: ' + event.error + '. Try typing instead.'; statusEl.className = 'text-center text-xs text-red-500 mb-3 h-4'; }
      }
    };

    testState._lastTranscript = '';
    // Override onresult to capture final transcript
    var origOnResult = testState.recognition.onresult;
    testState.recognition.onresult = function(event) {
      var transcript = '';
      var isFinal = false;
      for (var i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
        if (event.results[i].isFinal) isFinal = true;
      }
      testState._lastTranscript = transcript;
      if (statusEl && transcript) statusEl.textContent = 'Heard: "' + transcript.substring(0, 60) + '"';
      if (isFinal) {
        // Auto-process on final result
        try { testState.recognition.stop(); } catch(e) {}
      }
    };

    try {
      testState.recognition.start();
    } catch(e) {
      alert('Could not start microphone. Please check your browser permissions.');
    }
  };

  window.secStopRecording = function() {
    if (testState.recognition) {
      try { testState.recognition.stop(); } catch(e) {}
    }
    testState.active = false;
    var recordBtn = document.getElementById('vtRecordBtn');
    var stopBtn = document.getElementById('vtStopBtn');
    if (recordBtn) recordBtn.classList.remove('hidden');
    if (stopBtn) stopBtn.classList.add('hidden');
  };

  async function processAIChat(userText) {
    if (testState.processing || !userText) return;
    testState.processing = true;
    var conv = document.getElementById('vtConversation');
    var statusEl = document.getElementById('vtStatus');

    // Show user message
    conv.innerHTML += '<div class="flex justify-end"><div class="bg-sky-500 text-white rounded-xl rounded-tr-sm px-3 py-2 max-w-xs text-sm">' + esc(userText) + '</div></div>';
    testState.conversationHistory.push({ role: 'user', content: userText });

    // Show AI thinking
    conv.innerHTML += '<div class="flex justify-start" id="vtThinking"><div class="bg-emerald-50 text-emerald-800 rounded-xl rounded-tl-sm px-3 py-2 max-w-xs text-sm"><i class="fas fa-robot mr-1"></i><i class="fas fa-spinner fa-spin ml-1 text-xs"></i> Thinking...</div></div>';
    conv.scrollTop = conv.scrollHeight;
    if (statusEl) { statusEl.textContent = 'AI is responding...'; statusEl.className = 'text-center text-xs text-amber-500 mb-3 h-4 font-semibold'; }

    try {
      // Get AI response
      var greeting = document.getElementById('secGreeting') ? document.getElementById('secGreeting').value : (state.config?.greeting_script || '');
      var qa = document.getElementById('secQA') ? document.getElementById('secQA').value : (state.config?.common_qa || '');
      var notes = document.getElementById('secNotes') ? document.getElementById('secNotes').value : (state.config?.general_notes || '');

      var aiRes = await fetch('/api/secretary/test/chat', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          message: userText,
          history: testState.conversationHistory.slice(0, -1),
          greeting_script: greeting,
          common_qa: qa,
          general_notes: notes
        })
      });
      var aiData = await aiRes.json();

      // Replace thinking with response
      var thinking = document.getElementById('vtThinking');
      if (thinking) thinking.remove();
      var aiText = aiData.response || 'Sorry, I had trouble responding. Please try again.';
      conv.innerHTML += '<div class="flex justify-start"><div class="bg-emerald-50 text-emerald-800 rounded-xl rounded-tl-sm px-3 py-2 max-w-xs text-sm"><i class="fas fa-robot text-emerald-500 mr-1"></i>' + esc(aiText) + '</div></div>';
      testState.conversationHistory.push({ role: 'assistant', content: aiText });
      conv.scrollTop = conv.scrollHeight;

      // TTS playback only if server provides audio URL (Cartesia voice)
      // Browser SpeechSynthesis removed — it sounds robotic and doesn't represent the real experience
      if (aiData.audio_url) {
        var audio = new Audio(aiData.audio_url);
        audio.play().catch(function() {});
      }

      if (statusEl) { statusEl.textContent = 'Press mic or type to continue'; statusEl.className = 'text-center text-xs text-emerald-500 mb-3 h-4'; }
    } catch(e) {
      var thinking2 = document.getElementById('vtThinking');
      if (thinking2) thinking2.remove();
      conv.innerHTML += '<div class="flex justify-start"><div class="bg-red-50 text-red-600 rounded-xl rounded-tl-sm px-3 py-2 max-w-xs text-sm"><i class="fas fa-exclamation-triangle mr-1"></i>Error: ' + (e.message || 'Network error') + '</div></div>';
      conv.scrollTop = conv.scrollHeight;
      if (statusEl) { statusEl.textContent = 'Error occurred. Try again.'; statusEl.className = 'text-center text-xs text-red-500 mb-3 h-4'; }
    }
    testState.processing = false;
  }

  init();
})();

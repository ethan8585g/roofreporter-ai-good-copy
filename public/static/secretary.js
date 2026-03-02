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
    // Phone connection state
    phoneSetup: null,
    carriers: [],
    selectedCarrier: '',
    forwardingInstructions: null,
    connectStep: 1, // 1=method, 2=carrier+assign, 3=forwarding codes, 4=test
  };

  // ── On load: check for Stripe redirect, then fetch status ──
  async function init() {
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
          state.forwardingInstructions = data2.setup.forwarding_instructions || null;
          // Auto-determine connect step
          if (data2.setup.connection_status === 'connected') state.connectStep = 4;
          else if (data2.setup.assigned_phone_number) state.connectStep = 3;
          else if (data2.setup.carrier_name) state.connectStep = 2;
          else state.connectStep = 1;
        }
      }
    } catch(e) {}

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
        tabBtn('calls', 'fa-phone-volume', 'Call Log' + (state.totalCalls > 0 ? ' (' + state.totalCalls + ')' : '')) +
      '</div>' +
      '<div id="secContent"></div>';

    if (state.activeTab === 'setup') renderSetupTab();
    else if (state.activeTab === 'connect') renderConnectTab();
    else if (state.activeTab === 'calls') renderCallsTab();
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
  window.secSetTab = function(t) { state.activeTab = t; render(); if (t === 'calls') loadCalls(); };

  // ============================================================
  // SUBSCRIPTION PAGE
  // ============================================================
  function renderSubscriptionPage() {
    root.innerHTML =
      '<div class="max-w-2xl mx-auto">' +
        '<div class="bg-gradient-to-br from-sky-500 to-blue-700 rounded-2xl p-8 text-white text-center mb-8 shadow-xl">' +
          '<div class="w-20 h-20 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4"><i class="fas fa-headset text-4xl"></i></div>' +
          '<h2 class="text-3xl font-extrabold mb-2">Roofer Secretary</h2>' +
          '<p class="text-sky-100 text-lg">AI-Powered Phone Answering Service</p>' +
          '<p class="text-sky-200 text-sm mt-2">Never miss a customer call again. Works with your <strong>existing business phone number</strong> — no new number needed.</p>' +
        '</div>' +

        '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">' +
          '<h3 class="font-bold text-gray-800 text-lg mb-4"><i class="fas fa-check-circle text-green-500 mr-2"></i>What You Get</h3>' +
          '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">' +
            feature('fa-phone-alt', 'Keep Your Number', 'Connect to your existing business phone — no new number needed') +
            feature('fa-clock', '24/7 Coverage', 'AI answers every call, day or night') +
            feature('fa-route', 'Smart Routing', 'Route callers to Parts, Sales, Service, etc.') +
            feature('fa-comment-dots', 'Custom Greeting', 'Your business, your script, your personality') +
            feature('fa-file-alt', 'Call Transcripts', 'Full transcript & AI summary of every call') +
            feature('fa-question-circle', 'FAQ Handling', 'AI answers common questions automatically') +
          '</div>' +
        '</div>' +

        '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">' +
          '<h3 class="font-bold text-gray-800 text-lg mb-4"><i class="fas fa-plug text-sky-500 mr-2"></i>How It Works</h3>' +
          '<div class="space-y-4">' +
            howStep(1, 'Subscribe & Configure', 'Set up your AI secretary with your custom greeting, Q&A, and call routing directories.') +
            howStep(2, 'Connect Your Phone', 'We assign you an AI answering line. Set up simple call forwarding from your existing number — takes 30 seconds.') +
            howStep(3, 'Calls Get Answered', 'When you can\'t pick up, calls forward to the AI. It greets callers, answers questions, routes to departments, and takes messages.') +
            howStep(4, 'Review Call Logs', 'See every call with full transcripts, AI summaries, and which department was selected.') +
          '</div>' +
        '</div>' +

        '<div class="bg-white rounded-2xl border-2 border-sky-500 shadow-lg p-6 mb-6">' +
          '<div class="flex items-center justify-between mb-4">' +
            '<div><h3 class="font-bold text-gray-800 text-xl">Monthly Subscription</h3><p class="text-gray-500 text-sm">Cancel anytime. No contracts.</p></div>' +
            '<div class="text-right"><div class="text-4xl font-extrabold text-gray-900">$149<span class="text-lg font-normal text-gray-500">/mo</span></div><p class="text-xs text-gray-400">CAD + applicable taxes</p></div>' +
          '</div>' +
          '<div class="bg-sky-50 border border-sky-100 rounded-xl p-4 mb-4">' +
            '<p class="text-sm text-sky-700"><i class="fas fa-info-circle mr-1"></i>Includes unlimited AI-answered calls, full transcripts, smart routing, and 24/7 coverage. Works with any Canadian carrier.</p>' +
          '</div>' +
          '<button onclick="secSubscribe()" id="subscribeBtn" class="w-full py-4 bg-gradient-to-r from-sky-500 to-blue-600 text-white rounded-xl font-bold text-lg hover:from-sky-600 hover:to-blue-700 transition-all shadow-lg hover:shadow-xl">' +
            '<i class="fas fa-lock mr-2"></i>Subscribe & Setup — $149/month</button>' +
        '</div>' +
        '<p class="text-center text-xs text-gray-400 mb-8"><i class="fas fa-shield-alt mr-1"></i>Secure payment via Stripe &bull; Powered by LiveKit AI</p>' +
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

  window.secSubscribe = async function() {
    var btn = document.getElementById('subscribeBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Redirecting to Stripe...'; }
    try {
      var res = await fetch('/api/secretary/subscribe', { method: 'POST', headers: authHeaders() });
      var data = await res.json();
      if (data.checkout_url) { window.location.href = data.checkout_url; }
      else { alert(data.error || 'Failed to create subscription'); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-lock mr-2"></i>Subscribe & Setup — $149/month'; } }
    } catch(e) { alert('Network error. Please try again.'); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-lock mr-2"></i>Subscribe & Setup — $149/month'; } }
  };

  // ============================================================
  // SETUP TAB — Config form + Directories (existing, streamlined)
  // ============================================================
  function renderSetupTab() {
    var c = state.config || {};
    var dirs = state.directories.length > 0 ? state.directories : [
      { name: 'Sales', phone_or_action: '', special_notes: '' },
      { name: 'Service', phone_or_action: '', special_notes: '' },
      { name: 'Parts', phone_or_action: '', special_notes: '' },
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
               state.phoneSetup?.assigned_phone_number ? '<span class="text-amber-600"><i class="fas fa-exclamation-triangle mr-1"></i>Phone Not Yet Forwarded</span>' :
               '<span class="text-gray-400"><i class="fas fa-phone-slash mr-1"></i>No Phone Connected</span>') +
              ' &bull; ' + (state.subscription?.status || 'unknown') + '</p></div></div>' +
        '<div class="flex gap-2">' +
          (state.phoneSetup?.connection_status !== 'connected' ? '<button onclick="secSetTab(\'connect\')" class="px-4 py-2 rounded-xl text-sm font-semibold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-all"><i class="fas fa-phone-alt mr-1"></i>Connect Phone</button>' : '') +
          '<button onclick="secToggle()" class="px-4 py-2 rounded-xl text-sm font-semibold transition-all ' +
            (state.isActive ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200' : 'bg-green-50 text-green-600 hover:bg-green-100 border border-green-200') + '">' +
            '<i class="fas ' + (state.isActive ? 'fa-pause' : 'fa-play') + ' mr-1"></i>' + (state.isActive ? 'Pause' : 'Activate') + '</button>' +
        '</div></div></div>';

    content.innerHTML = statusHtml +

      // STEP 1: Phone & Greeting
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">' +
        '<h3 class="font-bold text-gray-800 text-lg mb-1"><span class="inline-flex items-center justify-center w-7 h-7 bg-sky-500 text-white rounded-full text-sm font-bold mr-2">1</span>Phone & Greeting Setup</h3>' +
        '<p class="text-gray-500 text-sm mb-4 ml-9">How should your AI secretary answer the phone?</p>' +
        '<div class="space-y-4 ml-9">' +
          '<div>' +
            '<label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-phone mr-1 text-sky-500"></i>Your Business Phone Number</label>' +
            '<input type="tel" id="secPhone" value="' + esc(c.business_phone || '') + '" placeholder="e.g. (780) 555-1234" class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-sky-400 focus:border-sky-400">' +
            '<p class="text-xs text-gray-400 mt-1">The number customers currently call — your existing business line</p></div>' +
          '<div>' +
            '<label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-comment-dots mr-1 text-sky-500"></i>How Should We Answer?</label>' +
            '<textarea id="secGreeting" rows="4" maxlength="3000" placeholder="e.g. Thank you for calling ABC Roofing! My name is Sarah, how can I help you today? We offer free estimates, emergency repairs, and full roof replacements across the Edmonton area..." class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-sky-400 focus:border-sky-400 resize-none">' + esc(c.greeting_script || '') + '</textarea></div>' +
          '<div>' +
            '<label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-question-circle mr-1 text-sky-500"></i>Common Q&A\'s</label>' +
            '<textarea id="secQA" rows="5" maxlength="3000" placeholder="Q: What areas do you serve?\nA: We serve all of Edmonton, Sherwood Park, St. Albert, and surrounding areas.\n\nQ: Do you offer free estimates?\nA: Yes! We provide free on-site estimates." class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-sky-400 focus:border-sky-400 resize-none font-mono text-xs">' + esc(c.common_qa || '') + '</textarea></div>' +
          '<div>' +
            '<label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-sticky-note mr-1 text-sky-500"></i>General Notes</label>' +
            '<textarea id="secNotes" rows="3" maxlength="3000" placeholder="Any additional context, seasonal promotions, or special instructions..." class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-sky-400 focus:border-sky-400 resize-none">' + esc(c.general_notes || '') + '</textarea></div>' +
          '<button onclick="secSaveConfig()" id="saveConfigBtn" class="px-6 py-3 bg-sky-500 text-white rounded-xl font-semibold text-sm hover:bg-sky-600 transition-all shadow"><i class="fas fa-save mr-2"></i>Save Configuration</button>' +
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
        '</div></div>';
  }

  function dirCard(d, i) {
    return '<div class="border border-gray-200 rounded-xl p-4 bg-gray-50" data-dir="' + i + '">' +
      '<div class="flex items-center justify-between mb-2">' +
        '<span class="font-semibold text-gray-700 text-sm"><i class="fas fa-folder text-amber-500 mr-1"></i>Directory ' + (i+1) + '</span>' +
        (i >= 2 ? '<button onclick="secRemoveDir(' + i + ')" class="text-red-400 hover:text-red-600 text-xs"><i class="fas fa-trash mr-1"></i>Remove</button>' : '') +
      '</div>' +
      '<div class="grid grid-cols-1 md:grid-cols-3 gap-3">' +
        '<div><label class="block text-xs font-medium text-gray-600 mb-1">Department Name</label>' +
          '<input type="text" id="dirName' + i + '" value="' + esc(d.name || '') + '" placeholder="e.g. Sales" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400"></div>' +
        '<div><label class="block text-xs font-medium text-gray-600 mb-1">Transfer To</label>' +
          '<input type="text" id="dirAction' + i + '" value="' + esc(d.phone_or_action || '') + '" placeholder="(780) 555-1234 or take message" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400"></div>' +
        '<div><label class="block text-xs font-medium text-gray-600 mb-1">Special Notes</label>' +
          '<input type="text" id="dirNotes' + i + '" value="' + esc(d.special_notes || '') + '" placeholder="Hours, key contacts..." class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400"></div>' +
      '</div></div>';
  }

  // ============================================================
  // CONNECT PHONE TAB — The big new feature
  // ============================================================
  function renderConnectTab() {
    var content = document.getElementById('secContent');
    if (!content) return;
    var ps = state.phoneSetup || {};
    var isConnected = ps.connection_status === 'connected';

    // Progress bar
    var steps = [
      { num: 1, label: 'Method', done: !!ps.forwarding_method },
      { num: 2, label: 'Carrier', done: !!ps.carrier_name && !!ps.assigned_phone_number },
      { num: 3, label: 'Forward', done: ps.connection_status === 'connected' || ps.connection_status === 'pending_forwarding' },
      { num: 4, label: 'Verify', done: isConnected },
    ];

    var progressHtml = '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 mb-6">' +
      '<div class="flex items-center justify-between mb-2">' +
        '<h3 class="font-bold text-gray-800 text-lg"><i class="fas fa-phone-alt text-sky-500 mr-2"></i>Connect Your Phone</h3>' +
        (isConnected ? '<span class="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-semibold"><i class="fas fa-check-circle mr-1"></i>Connected</span>' : '') +
      '</div>' +
      '<div class="flex items-center gap-1 mt-4">';
    for (var si = 0; si < steps.length; si++) {
      var s = steps[si];
      var isCurrent = state.connectStep === s.num;
      progressHtml += '<div class="flex-1">' +
        '<div class="flex items-center gap-2 mb-1">' +
          '<div class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ' +
            (s.done ? 'bg-green-500 text-white' : isCurrent ? 'bg-sky-500 text-white' : 'bg-gray-200 text-gray-500') + '">' +
            (s.done ? '<i class="fas fa-check text-xs"></i>' : s.num) + '</div>' +
          '<span class="text-xs font-medium ' + (isCurrent ? 'text-sky-600' : 'text-gray-500') + '">' + s.label + '</span>' +
        '</div>' +
        '<div class="h-1 rounded-full ' + (s.done ? 'bg-green-400' : isCurrent ? 'bg-sky-400' : 'bg-gray-200') + '"></div>' +
      '</div>';
      if (si < steps.length - 1) progressHtml += '<div class="w-4"></div>';
    }
    progressHtml += '</div></div>';

    content.innerHTML = progressHtml + '<div id="connectStepContent"></div>';

    // Render the current step
    if (isConnected) renderConnectComplete();
    else if (state.connectStep === 1) renderConnectStep1();
    else if (state.connectStep === 2) renderConnectStep2();
    else if (state.connectStep === 3) renderConnectStep3();
    else if (state.connectStep === 4) renderConnectStep4();
  }

  // ── Step 1: Choose connection method ──
  function renderConnectStep1() {
    var el = document.getElementById('connectStepContent');
    if (!el) return;
    var current = (state.phoneSetup || {}).forwarding_method || 'call_forwarding';

    el.innerHTML =
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">' +
        '<h4 class="font-bold text-gray-800 mb-1">How do you want to connect?</h4>' +
        '<p class="text-gray-500 text-sm mb-5">99% of roofers already have a business number. Keep using it — just forward unanswered calls to the AI.</p>' +

        '<div class="space-y-3">' +
          methodCard('call_forwarding', 'fa-phone-alt', 'Call Forwarding (Recommended)',
            'Keep your existing number. Forward unanswered calls to the AI secretary.',
            'Works with any carrier — Rogers, Telus, Bell, Freedom, landline, VoIP. Takes 30 seconds to set up. No hardware or software needed.',
            current === 'call_forwarding') +
          methodCard('sip_trunk', 'fa-network-wired', 'SIP Trunk (Advanced)',
            'Connect your VoIP phone system directly to the AI via SIP.',
            'Best for large companies using RingCentral, Vonage, 8x8, or on-premise PBX. Lower latency, more control. Requires VoIP admin access.',
            current === 'sip_trunk') +
          methodCard('livekit_number', 'fa-plus-circle', 'New AI Number',
            'Get a new local number dedicated to the AI secretary.',
            'Best if you want a separate number for AI calls. We\'ll provide a new Alberta (780/587) number.',
            current === 'livekit_number') +
        '</div>' +

        '<div class="mt-6 flex justify-end">' +
          '<button onclick="secSaveMethod()" id="saveMethodBtn" class="px-8 py-3 bg-sky-500 text-white rounded-xl font-semibold text-sm hover:bg-sky-600 transition-all shadow"><i class="fas fa-arrow-right mr-2"></i>Next: Select Carrier</button>' +
        '</div>' +
      '</div>';
  }

  function methodCard(id, icon, title, desc, details, selected) {
    return '<label class="block cursor-pointer" onclick="document.getElementById(\'method_' + id + '\').checked=true">' +
      '<div class="border-2 rounded-xl p-4 transition-all ' + (selected ? 'border-sky-500 bg-sky-50' : 'border-gray-200 hover:border-gray-300') + '">' +
        '<div class="flex items-start gap-3">' +
          '<input type="radio" name="connect_method" id="method_' + id + '" value="' + id + '" ' + (selected ? 'checked' : '') + ' class="mt-1">' +
          '<div class="flex-1">' +
            '<div class="flex items-center gap-2 mb-1">' +
              '<i class="fas ' + icon + ' text-sky-500"></i>' +
              '<span class="font-semibold text-gray-800">' + title + '</span>' +
              (id === 'call_forwarding' ? '<span class="px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-semibold">Most Popular</span>' : '') +
            '</div>' +
            '<p class="text-sm text-gray-600">' + desc + '</p>' +
            '<p class="text-xs text-gray-400 mt-1">' + details + '</p>' +
          '</div></div></div></label>';
  }

  window.secSaveMethod = async function() {
    var method = 'call_forwarding';
    var radios = document.getElementsByName('connect_method');
    for (var i = 0; i < radios.length; i++) { if (radios[i].checked) { method = radios[i].value; break; } }

    var btn = document.getElementById('saveMethodBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...'; }

    try {
      await fetch('/api/secretary/phone-setup', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ forwarding_method: method, carrier_name: state.selectedCarrier, agent_voice: 'alloy', agent_name: 'Sarah' })
      });
      state.connectStep = 2;
      if (state.phoneSetup) state.phoneSetup.forwarding_method = method;
      renderConnectTab();
    } catch(e) { alert('Failed to save'); }
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-arrow-right mr-2"></i>Next: Select Carrier'; }
  };

  // ── Step 2: Select carrier + assign number ──
  function renderConnectStep2() {
    var el = document.getElementById('connectStepContent');
    if (!el) return;
    var ps = state.phoneSetup || {};

    el.innerHTML =
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">' +
        '<h4 class="font-bold text-gray-800 mb-1">Select Your Phone Carrier</h4>' +
        '<p class="text-gray-500 text-sm mb-5">Who provides your current business phone service? This determines the forwarding instructions.</p>' +

        '<div class="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">' +
          state.carriers.map(function(cr) {
            var sel = state.selectedCarrier === cr.id;
            return '<button onclick="secSelectCarrier(\'' + cr.id + '\')" class="p-3 rounded-xl border-2 text-left transition-all ' +
              (sel ? 'border-sky-500 bg-sky-50' : 'border-gray-200 hover:border-gray-300') + '">' +
              '<p class="font-semibold text-sm text-gray-800">' + esc(cr.name) + '</p>' +
              (cr.subbrands ? '<p class="text-xs text-gray-400">' + esc(cr.subbrands) + '</p>' : '') +
            '</button>';
          }).join('') +
        '</div>' +

        (ps.assigned_phone_number ?
          '<div class="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">' +
            '<p class="font-semibold text-green-800"><i class="fas fa-check-circle mr-2"></i>AI Answering Number Assigned</p>' +
            '<p class="text-2xl font-mono font-bold text-green-700 mt-1">' + formatPhone(ps.assigned_phone_number) + '</p>' +
            '<p class="text-xs text-green-600 mt-1">This is the number your calls will forward to</p>' +
          '</div>'
          :
          '<div class="bg-sky-50 border border-sky-200 rounded-xl p-4 mb-4">' +
            '<p class="text-sm text-sky-700"><i class="fas fa-info-circle mr-1"></i>After selecting your carrier, we\'ll assign you a local AI answering number.</p>' +
          '</div>'
        ) +

        '<div class="flex justify-between">' +
          '<button onclick="state.connectStep=1;renderConnectTab()" class="px-6 py-3 bg-gray-100 text-gray-600 rounded-xl font-semibold text-sm hover:bg-gray-200 transition-all"><i class="fas fa-arrow-left mr-2"></i>Back</button>' +
          '<button onclick="secAssignAndNext()" id="assignBtn" class="px-8 py-3 bg-sky-500 text-white rounded-xl font-semibold text-sm hover:bg-sky-600 transition-all shadow" ' + (!state.selectedCarrier ? 'disabled style="opacity:0.5"' : '') + '><i class="fas fa-arrow-right mr-2"></i>' + (ps.assigned_phone_number ? 'Next: Forwarding Setup' : 'Assign Number & Continue') + '</button>' +
        '</div>' +
      '</div>';
  }

  window.secSelectCarrier = function(id) {
    state.selectedCarrier = id;
    renderConnectTab();
  };

  window.secAssignAndNext = async function() {
    var btn = document.getElementById('assignBtn');

    // Save carrier choice
    await fetch('/api/secretary/phone-setup', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ forwarding_method: (state.phoneSetup||{}).forwarding_method || 'call_forwarding', carrier_name: state.selectedCarrier, agent_voice: 'alloy', agent_name: 'Sarah' })
    });

    // If no number assigned yet, assign one
    if (!state.phoneSetup?.assigned_phone_number) {
      if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Assigning number...'; }
      try {
        var res = await fetch('/api/secretary/assign-number', { method: 'POST', headers: authHeaders() });
        var data = await res.json();
        if (data.assigned_phone_number || data.already_assigned) {
          if (state.phoneSetup) state.phoneSetup.assigned_phone_number = data.assigned_phone_number;
          state.forwardingInstructions = data.forwarding_instructions;
          showToast('AI answering number assigned!', 'success');

          // Also trigger LiveKit setup in background
          fetch('/api/secretary/setup-livekit', { method: 'POST', headers: authHeaders() }).catch(function(){});
        } else {
          alert(data.error || 'Failed to assign number');
          if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-arrow-right mr-2"></i>Assign Number & Continue'; }
          return;
        }
      } catch(e) { alert('Network error'); if (btn) { btn.disabled = false; } return; }
    }

    state.connectStep = 3;
    // Load fresh instructions
    try {
      var res2 = await fetch('/api/secretary/forwarding-instructions/' + state.selectedCarrier, { headers: authOnly() });
      if (res2.ok) {
        var data2 = await res2.json();
        state.forwardingInstructions = data2.instructions;
      }
    } catch(e) {}
    renderConnectTab();
  };

  // ── Step 3: Show forwarding instructions ──
  function renderConnectStep3() {
    var el = document.getElementById('connectStepContent');
    if (!el) return;
    var ps = state.phoneSetup || {};
    var fi = state.forwardingInstructions || {};
    var forwardTo = ps.assigned_phone_number || '+1XXXXXXXXXX';

    el.innerHTML =
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">' +
        '<h4 class="font-bold text-gray-800 mb-1"><i class="fas fa-arrow-right text-sky-500 mr-2"></i>Set Up Call Forwarding</h4>' +
        '<p class="text-gray-500 text-sm mb-5">Follow these steps to forward unanswered calls from your business phone to the AI secretary.</p>' +

        // AI Number display
        '<div class="bg-sky-50 border border-sky-200 rounded-xl p-4 mb-6">' +
          '<div class="flex items-center justify-between">' +
            '<div><p class="text-xs font-semibold text-sky-600 uppercase tracking-wide">Your AI Answering Number</p>' +
              '<p class="text-2xl font-mono font-bold text-sky-800 mt-1">' + formatPhone(forwardTo) + '</p></div>' +
            '<button onclick="copyToClipboard(\'' + forwardTo.replace('+1','') + '\')" class="px-3 py-2 bg-sky-200 text-sky-700 rounded-lg text-sm font-medium hover:bg-sky-300 transition-all"><i class="fas fa-copy mr-1"></i>Copy</button>' +
          '</div></div>' +

        // Carrier-specific instructions
        '<div class="bg-white border border-gray-200 rounded-xl overflow-hidden mb-6">' +
          '<div class="bg-gray-50 px-4 py-3 border-b border-gray-200">' +
            '<p class="font-semibold text-gray-800"><i class="fas fa-mobile-alt text-sky-500 mr-2"></i>' + esc(fi.name || 'Your Carrier') + ' — Forwarding Instructions</p></div>' +

          '<div class="p-4 space-y-4">' +
            // Option A: Forward All
            '<div class="border border-gray-100 rounded-xl p-4 bg-gray-50">' +
              '<div class="flex items-start gap-3">' +
                '<span class="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-bold">A</span>' +
                '<div class="flex-1">' +
                  '<p class="font-semibold text-gray-800 text-sm">Forward ALL Calls</p>' +
                  '<p class="text-xs text-gray-500 mb-2">Every incoming call goes to the AI — use when you\'re closed or away</p>' +
                  '<div class="bg-gray-900 text-green-400 rounded-lg px-4 py-3 font-mono text-lg select-all cursor-pointer" onclick="copyToClipboard(\'' + esc(fi.activate_all || '') + '\')">' +
                    esc(fi.activate_all || 'N/A') +
                  '</div>' +
                '</div></div></div>' +

            // Option B: Forward No Answer (recommended)
            '<div class="border-2 border-green-200 rounded-xl p-4 bg-green-50">' +
              '<div class="flex items-start gap-3">' +
                '<span class="px-2 py-0.5 bg-green-600 text-white rounded text-xs font-bold">B</span>' +
                '<div class="flex-1">' +
                  '<p class="font-semibold text-gray-800 text-sm">Forward When No Answer <span class="text-green-600">(Recommended)</span></p>' +
                  '<p class="text-xs text-gray-500 mb-2">Your phone rings first — if you don\'t pick up, it forwards to the AI</p>' +
                  '<div class="bg-gray-900 text-green-400 rounded-lg px-4 py-3 font-mono text-lg select-all cursor-pointer" onclick="copyToClipboard(\'' + esc(fi.activate_noanswer || '') + '\')">' +
                    esc(fi.activate_noanswer || 'N/A') +
                  '</div>' +
                '</div></div></div>' +

            // Option C: Forward When Busy
            '<div class="border border-gray-100 rounded-xl p-4 bg-gray-50">' +
              '<div class="flex items-start gap-3">' +
                '<span class="px-2 py-0.5 bg-amber-100 text-amber-700 rounded text-xs font-bold">C</span>' +
                '<div class="flex-1">' +
                  '<p class="font-semibold text-gray-800 text-sm">Forward When Busy</p>' +
                  '<p class="text-xs text-gray-500 mb-2">Only forwards when your line is busy (already on a call)</p>' +
                  '<div class="bg-gray-900 text-green-400 rounded-lg px-4 py-3 font-mono text-lg select-all cursor-pointer" onclick="copyToClipboard(\'' + esc(fi.activate_busy || '') + '\')">' +
                    esc(fi.activate_busy || 'N/A') +
                  '</div>' +
                '</div></div></div>' +

            // Deactivate
            '<div class="border border-red-100 rounded-xl p-3 bg-red-50">' +
              '<p class="text-sm text-red-700"><i class="fas fa-undo mr-1"></i><strong>To deactivate forwarding:</strong> Dial <span class="font-mono bg-white px-2 py-0.5 rounded">' + esc(fi.deactivate || '*73') + '</span> from your phone</p></div>' +

          '</div>' +

          // Notes
          (fi.notes ? '<div class="px-4 py-3 bg-amber-50 border-t border-amber-100">' +
            '<p class="text-sm text-amber-700"><i class="fas fa-lightbulb mr-1"></i>' + esc(fi.notes) + '</p></div>' : '') +
        '</div>' +

        // Setup time
        '<p class="text-center text-sm text-gray-500 mb-6"><i class="fas fa-clock mr-1"></i>Estimated setup time: <strong>' + esc(fi.estimated_setup_time || '1 minute') + '</strong></p>' +

        '<div class="flex justify-between">' +
          '<button onclick="state.connectStep=2;renderConnectTab()" class="px-6 py-3 bg-gray-100 text-gray-600 rounded-xl font-semibold text-sm hover:bg-gray-200 transition-all"><i class="fas fa-arrow-left mr-2"></i>Back</button>' +
          '<button onclick="state.connectStep=4;renderConnectTab()" class="px-8 py-3 bg-green-500 text-white rounded-xl font-semibold text-sm hover:bg-green-600 transition-all shadow"><i class="fas fa-check mr-2"></i>I\'ve Set Up Forwarding</button>' +
        '</div>' +
      '</div>';
  }

  // ── Step 4: Test & Verify ──
  function renderConnectStep4() {
    var el = document.getElementById('connectStepContent');
    if (!el) return;
    var ps = state.phoneSetup || {};

    el.innerHTML =
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">' +
        '<h4 class="font-bold text-gray-800 mb-1"><i class="fas fa-clipboard-check text-sky-500 mr-2"></i>Test Your Connection</h4>' +
        '<p class="text-gray-500 text-sm mb-5">Let\'s make sure calls are forwarding correctly to the AI secretary.</p>' +

        '<div class="bg-sky-50 border border-sky-200 rounded-xl p-5 mb-6">' +
          '<h5 class="font-bold text-sky-800 mb-3"><i class="fas fa-phone-alt mr-2"></i>Quick Test</h5>' +
          '<ol class="space-y-3 text-sm text-sky-700">' +
            '<li class="flex items-start gap-2"><span class="w-6 h-6 bg-sky-200 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold">1</span>Call your business number <strong class="font-mono">' + formatPhone(ps.business_phone || '') + '</strong> from a different phone (e.g. your personal cell)</li>' +
            '<li class="flex items-start gap-2"><span class="w-6 h-6 bg-sky-200 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold">2</span>Let it ring without answering (wait for forwarding to kick in)</li>' +
            '<li class="flex items-start gap-2"><span class="w-6 h-6 bg-sky-200 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold">3</span>You should hear the AI secretary answer with your custom greeting</li>' +
          '</ol></div>' +

        (ps.last_test_result ?
          '<div class="mb-6 p-4 rounded-xl border ' +
            (ps.last_test_result === 'success' ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200') + '">' +
            '<p class="text-sm font-semibold ' + (ps.last_test_result === 'success' ? 'text-green-800' : 'text-amber-800') + '">' +
              '<i class="fas ' + (ps.last_test_result === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle') + ' mr-1"></i>Last test: ' +
              esc(ps.last_test_result) + '</p>' +
            (ps.last_test_details ? '<p class="text-xs mt-1 ' + (ps.last_test_result === 'success' ? 'text-green-600' : 'text-amber-600') + '">' + esc(ps.last_test_details) + '</p>' : '') +
          '</div>' : '') +

        '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">' +
          '<button onclick="secConfirmConnection(true)" id="confirmYesBtn" class="p-4 border-2 border-green-200 rounded-xl hover:bg-green-50 transition-all text-center">' +
            '<i class="fas fa-check-circle text-green-500 text-2xl mb-2"></i>' +
            '<p class="font-semibold text-gray-800">Yes, It\'s Working!</p>' +
            '<p class="text-xs text-gray-500">The AI answered with my greeting</p></button>' +
          '<button onclick="secConfirmConnection(false)" class="p-4 border-2 border-red-200 rounded-xl hover:bg-red-50 transition-all text-center">' +
            '<i class="fas fa-times-circle text-red-400 text-2xl mb-2"></i>' +
            '<p class="font-semibold text-gray-800">Not Working Yet</p>' +
            '<p class="text-xs text-gray-500">I need to check my forwarding setup</p></button>' +
        '</div>' +

        '<div class="flex justify-between">' +
          '<button onclick="state.connectStep=3;renderConnectTab()" class="px-6 py-3 bg-gray-100 text-gray-600 rounded-xl font-semibold text-sm hover:bg-gray-200 transition-all"><i class="fas fa-arrow-left mr-2"></i>Back to Instructions</button>' +
          '<button onclick="secTestConnection()" id="testBtn" class="px-6 py-3 bg-sky-500 text-white rounded-xl font-semibold text-sm hover:bg-sky-600 transition-all shadow"><i class="fas fa-phone-alt mr-2"></i>Send Test Call</button>' +
        '</div>' +
      '</div>';
  }

  // ── Connected! ──
  function renderConnectComplete() {
    var el = document.getElementById('connectStepContent');
    if (!el) return;
    var ps = state.phoneSetup || {};

    el.innerHTML =
      '<div class="bg-white rounded-2xl border-2 border-green-200 shadow-sm p-8 text-center">' +
        '<div class="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-check-circle text-green-500 text-4xl"></i></div>' +
        '<h3 class="text-2xl font-extrabold text-gray-800 mb-2">Phone Connected!</h3>' +
        '<p class="text-gray-500 mb-6">Your AI secretary is answering calls on your behalf.</p>' +

        '<div class="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-lg mx-auto mb-6">' +
          '<div class="bg-gray-50 rounded-xl p-4">' +
            '<p class="text-xs text-gray-500 uppercase tracking-wide">Your Business Number</p>' +
            '<p class="font-mono font-bold text-gray-800 text-lg mt-1">' + formatPhone(ps.business_phone || '') + '</p></div>' +
          '<div class="bg-sky-50 rounded-xl p-4">' +
            '<p class="text-xs text-sky-600 uppercase tracking-wide">AI Secretary Number</p>' +
            '<p class="font-mono font-bold text-sky-800 text-lg mt-1">' + formatPhone(ps.assigned_phone_number || '') + '</p></div>' +
        '</div>' +

        '<div class="flex justify-center gap-3">' +
          '<button onclick="secSetTab(\'setup\')" class="px-6 py-3 bg-sky-500 text-white rounded-xl font-semibold text-sm hover:bg-sky-600 transition-all shadow"><i class="fas fa-cog mr-2"></i>Edit Configuration</button>' +
          '<button onclick="secSetTab(\'calls\')" class="px-6 py-3 bg-gray-100 text-gray-700 rounded-xl font-semibold text-sm hover:bg-gray-200 transition-all"><i class="fas fa-phone-volume mr-2"></i>View Call Log</button>' +
        '</div>' +

        '<div class="mt-6 bg-amber-50 border border-amber-200 rounded-xl p-4 text-left max-w-lg mx-auto">' +
          '<p class="text-sm text-amber-700"><i class="fas fa-info-circle mr-1"></i><strong>To deactivate forwarding:</strong> Dial <span class="font-mono bg-white px-2 py-0.5 rounded">*73</span> from your business phone. You can reactivate anytime.</p></div>' +
      '</div>';
  }

  window.secTestConnection = async function() {
    var btn = document.getElementById('testBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Calling...'; }
    try {
      var res = await fetch('/api/secretary/test-connection', { method: 'POST', headers: authHeaders() });
      var data = await res.json();
      showToast(data.details || 'Test initiated', data.test_result === 'in_progress' ? 'success' : 'info');
      if (state.phoneSetup) {
        state.phoneSetup.last_test_result = data.test_result;
        state.phoneSetup.last_test_details = data.details;
      }
      renderConnectTab();
    } catch(e) { alert('Test failed'); }
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-phone-alt mr-2"></i>Send Test Call'; }
  };

  window.secConfirmConnection = async function(connected) {
    var btn = document.getElementById('confirmYesBtn');
    if (connected && btn) { btn.innerHTML = '<i class="fas fa-spinner fa-spin text-2xl mb-2"></i><p>Confirming...</p>'; }
    try {
      var res = await fetch('/api/secretary/confirm-connection', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ connected: connected })
      });
      var data = await res.json();
      showToast(data.message, connected ? 'success' : 'info');
      if (connected && state.phoneSetup) state.phoneSetup.connection_status = 'connected';
      await loadStatus();
    } catch(e) { alert('Failed to confirm'); }
  };

  // ============================================================
  // CALLS TAB
  // ============================================================
  async function loadCalls() {
    try {
      var res = await fetch('/api/secretary/calls?limit=50', { headers: authOnly() });
      if (res.ok) { var data = await res.json(); state.calls = data.calls || []; renderCallsTab(); }
    } catch(e) {}
  }

  function renderCallsTab() {
    var content = document.getElementById('secContent');
    if (!content) return;

    if (state.calls.length === 0) {
      content.innerHTML =
        '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-12 text-center">' +
          '<div class="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4"><i class="fas fa-phone-slash text-gray-400 text-2xl"></i></div>' +
          '<h3 class="font-bold text-gray-800 text-lg mb-1">No Calls Yet</h3>' +
          '<p class="text-gray-500 text-sm">When your AI secretary handles calls, they\'ll appear here with full transcripts and summaries.</p>' +
          (state.phoneSetup?.connection_status !== 'connected' ? '<button onclick="secSetTab(\'connect\')" class="mt-4 px-6 py-3 bg-sky-500 text-white rounded-xl font-semibold text-sm hover:bg-sky-600 transition-all"><i class="fas fa-phone-alt mr-2"></i>Connect Your Phone First</button>' : '') +
        '</div>';
      return;
    }

    content.innerHTML =
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">' +
        '<div class="px-6 py-4 border-b border-gray-100"><h3 class="font-bold text-gray-800">Recent Calls <span class="text-gray-400 font-normal text-sm">(' + state.calls.length + ')</span></h3></div>' +
        '<div class="divide-y divide-gray-100">' +
          state.calls.map(function(call) {
            var oc = call.call_outcome === 'answered' ? 'text-green-600 bg-green-50' :
              call.call_outcome === 'transferred' ? 'text-blue-600 bg-blue-50' :
              call.call_outcome === 'voicemail' ? 'text-amber-600 bg-amber-50' : 'text-gray-600 bg-gray-50';
            return '<div class="px-6 py-4 hover:bg-gray-50 transition-colors">' +
              '<div class="flex items-center justify-between mb-2">' +
                '<div class="flex items-center gap-3">' +
                  '<div class="w-10 h-10 bg-sky-100 rounded-full flex items-center justify-center"><i class="fas fa-phone text-sky-600"></i></div>' +
                  '<div><p class="font-semibold text-gray-800 text-sm">' + esc(call.caller_name || 'Unknown Caller') + '</p>' +
                    '<p class="text-xs text-gray-500">' + esc(call.caller_phone || '') + '</p></div></div>' +
                '<div class="text-right">' +
                  '<span class="px-2 py-0.5 rounded-full text-xs font-semibold ' + oc + '">' + (call.call_outcome || 'unknown') + '</span>' +
                  '<p class="text-xs text-gray-400 mt-1">' + formatDuration(call.call_duration_seconds) + '</p></div></div>' +
              (call.call_summary ? '<p class="text-sm text-gray-600 ml-13 bg-gray-50 rounded-lg p-3"><i class="fas fa-robot text-gray-400 mr-1"></i>' + esc(call.call_summary) + '</p>' : '') +
              (call.directory_routed ? '<p class="text-xs text-gray-400 ml-13 mt-1"><i class="fas fa-arrow-right mr-1"></i>Routed to: <strong>' + esc(call.directory_routed) + '</strong></p>' : '') +
              '<p class="text-xs text-gray-400 ml-13 mt-1">' + new Date(call.created_at).toLocaleString() + '</p>' +
            '</div>';
          }).join('') +
        '</div></div>';
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
    try {
      var res = await fetch('/api/secretary/config', {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          business_phone: document.getElementById('secPhone')?.value || '',
          greeting_script: document.getElementById('secGreeting')?.value || '',
          common_qa: document.getElementById('secQA')?.value || '',
          general_notes: document.getElementById('secNotes')?.value || '',
        })
      });
      var data = await res.json();
      if (data.success) { showToast('Configuration saved!', 'success'); await loadStatus(); }
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

  init();
})();

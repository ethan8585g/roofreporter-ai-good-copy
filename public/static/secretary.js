// ============================================================
// Roofer Secretary — AI Phone Answering Service Frontend
// Setup wizard: Subscribe → Configure → Directories → Activate
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
    activeTab: 'setup', // setup, calls
    saving: false,
  };

  // ── On load: check for Stripe redirect, then fetch status ──
  async function init() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('setup') === 'true' && params.get('session_id')) {
      // Verify the Stripe session
      try {
        await fetch('/api/secretary/verify-session', {
          method: 'POST', headers: authHeaders(),
          body: JSON.stringify({ session_id: params.get('session_id') })
        });
      } catch(e) {}
      // Clean URL
      window.history.replaceState({}, '', '/customer/secretary');
    }
    await loadStatus();
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
    state.loading = false;
    render();
  }

  // ── RENDER ──
  function render() {
    if (state.loading) {
      root.innerHTML = '<div class="flex items-center justify-center py-20"><i class="fas fa-spinner fa-spin text-3xl text-sky-500"></i></div>';
      return;
    }

    if (!state.hasActive) {
      renderSubscriptionPage();
      return;
    }

    // Has subscription — show setup/config
    root.innerHTML =
      // Tab bar
      '<div class="flex gap-2 mb-6">' +
        tabBtn('setup', 'fa-cog', 'Setup & Config') +
        tabBtn('calls', 'fa-phone-volume', 'Call Log' + (state.totalCalls > 0 ? ' (' + state.totalCalls + ')' : '')) +
      '</div>' +
      '<div id="secContent"></div>';

    if (state.activeTab === 'setup') renderSetupTab();
    else if (state.activeTab === 'calls') renderCallsTab();
  }

  function tabBtn(id, icon, label) {
    var active = state.activeTab === id;
    return '<button onclick="secSetTab(\'' + id + '\')" class="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ' +
      (active ? 'bg-gradient-to-r from-sky-500 to-blue-600 text-white shadow-lg' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200') +
      '"><i class="fas ' + icon + ' text-xs"></i>' + label + '</button>';
  }
  window.secSetTab = function(t) { state.activeTab = t; render(); if (t === 'calls') loadCalls(); };

  // ============================================================
  // SUBSCRIPTION PAGE — Show pricing & subscribe button
  // ============================================================
  function renderSubscriptionPage() {
    root.innerHTML =
      '<div class="max-w-2xl mx-auto">' +
        // Hero
        '<div class="bg-gradient-to-br from-sky-500 to-blue-700 rounded-2xl p-8 text-white text-center mb-8 shadow-xl">' +
          '<div class="w-20 h-20 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4">' +
            '<i class="fas fa-headset text-4xl"></i>' +
          '</div>' +
          '<h2 class="text-3xl font-extrabold mb-2">Roofer Secretary</h2>' +
          '<p class="text-sky-100 text-lg">AI-Powered Phone Answering Service</p>' +
          '<p class="text-sky-200 text-sm mt-2">Never miss a customer call again. Your AI receptionist answers 24/7, routes calls to the right department, takes messages, and logs every conversation.</p>' +
        '</div>' +

        // Features
        '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">' +
          '<h3 class="font-bold text-gray-800 text-lg mb-4"><i class="fas fa-check-circle text-green-500 mr-2"></i>What You Get</h3>' +
          '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">' +
            feature('fa-clock', '24/7 Coverage', 'AI answers every call, day or night') +
            feature('fa-route', 'Smart Routing', 'Route callers to Parts, Sales, Service, etc.') +
            feature('fa-comment-dots', 'Custom Greeting', 'Your business, your script, your personality') +
            feature('fa-file-alt', 'Call Transcripts', 'Full transcript & AI summary of every call') +
            feature('fa-question-circle', 'FAQ Handling', 'AI answers common questions automatically') +
            feature('fa-bell', 'Instant Alerts', 'Get notified of urgent calls & messages') +
          '</div>' +
        '</div>' +

        // Pricing
        '<div class="bg-white rounded-2xl border-2 border-sky-500 shadow-lg p-6 mb-6">' +
          '<div class="flex items-center justify-between mb-4">' +
            '<div>' +
              '<h3 class="font-bold text-gray-800 text-xl">Monthly Subscription</h3>' +
              '<p class="text-gray-500 text-sm">Cancel anytime. No contracts.</p>' +
            '</div>' +
            '<div class="text-right">' +
              '<div class="text-4xl font-extrabold text-gray-900">$149<span class="text-lg font-normal text-gray-500">/mo</span></div>' +
              '<p class="text-xs text-gray-400">CAD + applicable taxes</p>' +
            '</div>' +
          '</div>' +
          '<div class="bg-sky-50 border border-sky-100 rounded-xl p-4 mb-4">' +
            '<p class="text-sm text-sky-700"><i class="fas fa-info-circle mr-1"></i>By subscribing, you agree to a recurring monthly charge of <strong>$149.00 CAD</strong> for the Roofer Secretary AI Phone Answering Service. You can cancel at any time from your dashboard.</p>' +
          '</div>' +
          '<button onclick="secSubscribe()" id="subscribeBtn" class="w-full py-4 bg-gradient-to-r from-sky-500 to-blue-600 text-white rounded-xl font-bold text-lg hover:from-sky-600 hover:to-blue-700 transition-all shadow-lg hover:shadow-xl">' +
            '<i class="fas fa-lock mr-2"></i>Subscribe & Setup — $149/month' +
          '</button>' +
        '</div>' +

        // Powered by
        '<p class="text-center text-xs text-gray-400 mb-8"><i class="fas fa-shield-alt mr-1"></i>Secure payment via Stripe &bull; Powered by LiveKit AI</p>' +
      '</div>';
  }

  function feature(icon, title, desc) {
    return '<div class="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">' +
      '<div class="w-8 h-8 bg-sky-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"><i class="fas ' + icon + ' text-sky-600 text-sm"></i></div>' +
      '<div><p class="font-semibold text-gray-800 text-sm">' + title + '</p><p class="text-gray-500 text-xs">' + desc + '</p></div>' +
    '</div>';
  }

  window.secSubscribe = async function() {
    var btn = document.getElementById('subscribeBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Redirecting to Stripe...'; }
    try {
      var res = await fetch('/api/secretary/subscribe', { method: 'POST', headers: authHeaders() });
      var data = await res.json();
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        alert(data.error || 'Failed to create subscription');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-lock mr-2"></i>Subscribe & Setup — $149/month'; }
      }
    } catch(e) {
      alert('Network error. Please try again.');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-lock mr-2"></i>Subscribe & Setup — $149/month'; }
    }
  };

  // ============================================================
  // SETUP TAB — Config form + Directories
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

    content.innerHTML =
      // Status bar
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 mb-6">' +
        '<div class="flex items-center justify-between">' +
          '<div class="flex items-center gap-3">' +
            '<div class="w-10 h-10 rounded-full flex items-center justify-center ' + (state.isActive ? 'bg-green-100' : 'bg-gray-100') + '">' +
              '<i class="fas ' + (state.isActive ? 'fa-check-circle text-green-600' : 'fa-pause-circle text-gray-400') + ' text-lg"></i>' +
            '</div>' +
            '<div>' +
              '<p class="font-bold text-gray-800">' + (state.isActive ? 'Service ACTIVE' : 'Service PAUSED') + '</p>' +
              '<p class="text-xs text-gray-500">Subscription: ' + (state.subscription?.status || 'unknown') + ' &bull; $149/mo</p>' +
            '</div>' +
          '</div>' +
          '<button onclick="secToggle()" class="px-5 py-2 rounded-xl text-sm font-semibold transition-all ' +
            (state.isActive
              ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
              : 'bg-green-50 text-green-600 hover:bg-green-100 border border-green-200') + '">' +
            '<i class="fas ' + (state.isActive ? 'fa-pause' : 'fa-play') + ' mr-1"></i>' +
            (state.isActive ? 'Pause Service' : 'Activate Service') +
          '</button>' +
        '</div>' +
      '</div>' +

      // STEP 1: Phone & Greeting
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">' +
        '<h3 class="font-bold text-gray-800 text-lg mb-1"><span class="inline-flex items-center justify-center w-7 h-7 bg-sky-500 text-white rounded-full text-sm font-bold mr-2">1</span>Phone & Greeting Setup</h3>' +
        '<p class="text-gray-500 text-sm mb-4 ml-9">How should your AI secretary answer the phone?</p>' +

        '<div class="space-y-4 ml-9">' +
          '<div>' +
            '<label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-phone mr-1 text-sky-500"></i>Business Phone Number</label>' +
            '<input type="tel" id="secPhone" value="' + esc(c.business_phone || '') + '" placeholder="e.g. (780) 555-1234" class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-sky-400 focus:border-sky-400">' +
            '<p class="text-xs text-gray-400 mt-1">The number you want the AI answering service connected to</p>' +
          '</div>' +

          '<div>' +
            '<label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-comment-dots mr-1 text-sky-500"></i>How Should We Answer?</label>' +
            '<textarea id="secGreeting" rows="4" maxlength="3000" placeholder="e.g. Thank you for calling ABC Roofing! My name is Sarah, how can I help you today? We offer free estimates, emergency repairs, and full roof replacements across the Edmonton area..." class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-sky-400 focus:border-sky-400 resize-none">' + esc(c.greeting_script || '') + '</textarea>' +
            '<p class="text-xs text-gray-400 mt-1">Describe exactly how you want the phone answered — tone, name, style, key info</p>' +
          '</div>' +

          '<div>' +
            '<label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-question-circle mr-1 text-sky-500"></i>Common Q&A\'s</label>' +
            '<textarea id="secQA" rows="5" maxlength="3000" placeholder="Q: What areas do you serve?\nA: We serve all of Edmonton, Sherwood Park, St. Albert, and surrounding areas.\n\nQ: Do you offer free estimates?\nA: Yes! We provide free on-site estimates for all residential and commercial roofing projects.\n\nQ: What are your hours?\nA: Our office is open Monday-Friday 8am-5pm, but our AI secretary is available 24/7." class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-sky-400 focus:border-sky-400 resize-none font-mono text-xs">' + esc(c.common_qa || '') + '</textarea>' +
            '<p class="text-xs text-gray-400 mt-1">Add common questions & answers so the AI can respond accurately</p>' +
          '</div>' +

          '<div>' +
            '<label class="block text-sm font-semibold text-gray-700 mb-1"><i class="fas fa-sticky-note mr-1 text-sky-500"></i>General Notes</label>' +
            '<textarea id="secNotes" rows="4" maxlength="3000" placeholder="Any additional context, special instructions, seasonal promotions, or important notes the AI should know about..." class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-sky-400 focus:border-sky-400 resize-none">' + esc(c.general_notes || '') + '</textarea>' +
            '<div class="flex justify-between items-center mt-1"><p class="text-xs text-gray-400">Additional context for your AI secretary</p><span id="notesCount" class="text-xs text-gray-400">0/3000</span></div>' +
          '</div>' +

          '<button onclick="secSaveConfig()" id="saveConfigBtn" class="px-6 py-3 bg-sky-500 text-white rounded-xl font-semibold text-sm hover:bg-sky-600 transition-all shadow"><i class="fas fa-save mr-2"></i>Save Phone Configuration</button>' +
        '</div>' +
      '</div>' +

      // STEP 2: Directories
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">' +
        '<h3 class="font-bold text-gray-800 text-lg mb-1"><span class="inline-flex items-center justify-center w-7 h-7 bg-sky-500 text-white rounded-full text-sm font-bold mr-2">2</span>Call Routing Directories</h3>' +
        '<p class="text-gray-500 text-sm mb-4 ml-9">Set up 2-4 departments the AI can route callers to</p>' +

        '<div id="directoriesList" class="space-y-4 ml-9">' +
          dirs.map(function(d, i) { return dirCard(d, i); }).join('') +
        '</div>' +

        '<div class="ml-9 mt-4 flex gap-3">' +
          '<button onclick="secAddDir()" id="addDirBtn" class="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-200 transition-all ' + (dirs.length >= 4 ? 'opacity-50 cursor-not-allowed' : '') + '" ' + (dirs.length >= 4 ? 'disabled' : '') + '><i class="fas fa-plus mr-1"></i>Add Directory</button>' +
          '<button onclick="secSaveDirs()" id="saveDirsBtn" class="px-6 py-2 bg-sky-500 text-white rounded-xl text-sm font-semibold hover:bg-sky-600 transition-all shadow"><i class="fas fa-save mr-2"></i>Save Directories</button>' +
        '</div>' +
      '</div>' +

      // STEP 3: Special Notes per Directory
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">' +
        '<h3 class="font-bold text-gray-800 text-lg mb-1"><span class="inline-flex items-center justify-center w-7 h-7 bg-sky-500 text-white rounded-full text-sm font-bold mr-2">3</span>Directory-Specific Notes</h3>' +
        '<p class="text-gray-500 text-sm mb-4 ml-9">Add special instructions for each department</p>' +
        '<div class="space-y-4 ml-9">' +
          dirs.map(function(d, i) {
            return '<div class="border border-gray-200 rounded-xl p-4">' +
              '<label class="block text-sm font-semibold text-gray-700 mb-2"><i class="fas fa-folder mr-1 text-amber-500"></i>' + esc(d.name || 'Directory ' + (i+1)) + ' — Special Notes</label>' +
              '<textarea id="dirNotes' + i + '" rows="3" maxlength="3000" placeholder="Special instructions for ' + esc(d.name || 'this department') + '... (e.g. hours, pricing, key contacts, common requests)" class="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-sky-400 focus:border-sky-400 resize-none">' + esc(d.special_notes || '') + '</textarea>' +
              '<p class="text-xs text-gray-400 mt-1 text-right">Max 3,000 characters</p>' +
            '</div>';
          }).join('') +
        '</div>' +
        '<div class="ml-9 mt-4">' +
          '<button onclick="secSaveDirs()" class="px-6 py-2 bg-sky-500 text-white rounded-xl text-sm font-semibold hover:bg-sky-600 transition-all shadow"><i class="fas fa-save mr-2"></i>Save All Directory Notes</button>' +
        '</div>' +
      '</div>';

    // Wire up character counters
    var notesEl = document.getElementById('secNotes');
    var countEl = document.getElementById('notesCount');
    if (notesEl && countEl) {
      countEl.textContent = notesEl.value.length + '/3000';
      notesEl.addEventListener('input', function() { countEl.textContent = this.value.length + '/3000'; });
    }
  }

  function dirCard(d, i) {
    return '<div class="border border-gray-200 rounded-xl p-4 bg-gray-50" data-dir="' + i + '">' +
      '<div class="flex items-center justify-between mb-3">' +
        '<span class="font-semibold text-gray-700 text-sm"><i class="fas fa-folder text-amber-500 mr-1"></i>Directory ' + (i+1) + '</span>' +
        (i >= 2 ? '<button onclick="secRemoveDir(' + i + ')" class="text-red-400 hover:text-red-600 text-xs"><i class="fas fa-trash mr-1"></i>Remove</button>' : '') +
      '</div>' +
      '<div class="grid grid-cols-1 md:grid-cols-2 gap-3">' +
        '<div>' +
          '<label class="block text-xs font-medium text-gray-600 mb-1">Department Name</label>' +
          '<input type="text" id="dirName' + i + '" value="' + esc(d.name || '') + '" placeholder="e.g. Sales, Parts, Service" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400">' +
        '</div>' +
        '<div>' +
          '<label class="block text-xs font-medium text-gray-600 mb-1">Transfer To (phone/action)</label>' +
          '<input type="text" id="dirAction' + i + '" value="' + esc(d.phone_or_action || '') + '" placeholder="e.g. (780) 555-1234 or take message" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-400">' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // ── Directory management ──
  window.secAddDir = function() {
    var list = document.getElementById('directoriesList');
    if (!list) return;
    var count = list.children.length;
    if (count >= 4) return;
    var div = document.createElement('div');
    div.innerHTML = dirCard({ name: '', phone_or_action: '', special_notes: '' }, count);
    list.appendChild(div.firstChild);
    // Update add button
    if (count + 1 >= 4) {
      var btn = document.getElementById('addDirBtn');
      if (btn) { btn.disabled = true; btn.classList.add('opacity-50', 'cursor-not-allowed'); }
    }
  };

  window.secRemoveDir = function(idx) {
    var list = document.getElementById('directoriesList');
    if (!list || list.children.length <= 2) { alert('Minimum 2 directories required'); return; }
    list.children[idx].remove();
    // Re-index
    Array.from(list.children).forEach(function(el, i) {
      el.setAttribute('data-dir', i);
    });
  };

  // ── Save Config ──
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
      if (data.success) {
        showToast('Configuration saved!', 'success');
        await loadStatus();
      } else {
        alert(data.error || 'Save failed');
      }
    } catch(e) { alert('Network error'); }
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Phone Configuration'; }
  };

  // ── Save Directories ──
  window.secSaveDirs = async function() {
    var list = document.getElementById('directoriesList');
    if (!list) return;
    var dirs = [];
    var count = list.children.length;
    for (var i = 0; i < count; i++) {
      var name = document.getElementById('dirName' + i)?.value || '';
      var action = document.getElementById('dirAction' + i)?.value || '';
      var notes = document.getElementById('dirNotes' + i)?.value || '';
      dirs.push({ name: name, phone_or_action: action, special_notes: notes });
    }
    if (dirs.length < 2) { alert('Minimum 2 directories required'); return; }

    var btn = document.getElementById('saveDirsBtn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...'; }
    try {
      var res = await fetch('/api/secretary/directories', {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ directories: dirs })
      });
      var data = await res.json();
      if (data.success) {
        showToast('Directories saved!', 'success');
        await loadStatus();
      } else {
        alert(data.error || 'Save failed');
      }
    } catch(e) { alert('Network error'); }
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Directories'; }
  };

  // ── Toggle service ──
  window.secToggle = async function() {
    try {
      var res = await fetch('/api/secretary/toggle', { method: 'POST', headers: authHeaders() });
      var data = await res.json();
      if (data.message) {
        showToast(data.message, data.is_active ? 'success' : 'info');
        await loadStatus();
      } else {
        alert(data.error || 'Toggle failed');
      }
    } catch(e) { alert('Network error'); }
  };

  // ============================================================
  // CALLS TAB — Call log history
  // ============================================================
  async function loadCalls() {
    try {
      var res = await fetch('/api/secretary/calls?limit=50', { headers: authOnly() });
      if (res.ok) {
        var data = await res.json();
        state.calls = data.calls || [];
        renderCallsTab();
      }
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
        '</div>';
      return;
    }

    content.innerHTML =
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">' +
        '<div class="px-6 py-4 border-b border-gray-100"><h3 class="font-bold text-gray-800">Recent Calls</h3></div>' +
        '<div class="divide-y divide-gray-100">' +
          state.calls.map(function(call) {
            var outcomeColor = call.call_outcome === 'answered' ? 'text-green-600 bg-green-50' :
              call.call_outcome === 'transferred' ? 'text-blue-600 bg-blue-50' :
              call.call_outcome === 'voicemail' ? 'text-amber-600 bg-amber-50' : 'text-gray-600 bg-gray-50';
            return '<div class="px-6 py-4 hover:bg-gray-50 transition-colors">' +
              '<div class="flex items-center justify-between mb-2">' +
                '<div class="flex items-center gap-3">' +
                  '<div class="w-10 h-10 bg-sky-100 rounded-full flex items-center justify-center"><i class="fas fa-phone text-sky-600"></i></div>' +
                  '<div>' +
                    '<p class="font-semibold text-gray-800 text-sm">' + esc(call.caller_name || 'Unknown Caller') + '</p>' +
                    '<p class="text-xs text-gray-500">' + esc(call.caller_phone || '') + '</p>' +
                  '</div>' +
                '</div>' +
                '<div class="text-right">' +
                  '<span class="px-2 py-0.5 rounded-full text-xs font-semibold ' + outcomeColor + '">' + (call.call_outcome || 'unknown') + '</span>' +
                  '<p class="text-xs text-gray-400 mt-1">' + formatDuration(call.call_duration_seconds) + '</p>' +
                '</div>' +
              '</div>' +
              (call.call_summary ? '<p class="text-sm text-gray-600 ml-13 bg-gray-50 rounded-lg p-3"><i class="fas fa-robot text-gray-400 mr-1"></i>' + esc(call.call_summary) + '</p>' : '') +
              (call.directory_routed ? '<p class="text-xs text-gray-400 ml-13 mt-1"><i class="fas fa-arrow-right mr-1"></i>Routed to: <strong>' + esc(call.directory_routed) + '</strong></p>' : '') +
              '<p class="text-xs text-gray-400 ml-13 mt-1">' + new Date(call.created_at).toLocaleString() + '</p>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>';
  }

  // ── Helpers ──
  function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function formatDuration(s) { if (!s) return '0s'; var m = Math.floor(s/60); var sec = s%60; return m > 0 ? m + 'm ' + sec + 's' : sec + 's'; }

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

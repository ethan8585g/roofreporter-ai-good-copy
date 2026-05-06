// ============================================================
// Roof Manager — Account Settings Page
//
// Sections:
//   1. Personal Info     — name, phone, email
//   2. Company Info      — company name, address, city, province, postal
//   3. Branding          — logo URL, business name, colors, tagline,
//                          contact info, license #, insurance
//   4. Report Preferences — auto-email, company type (roofing / solar),
//                          solar panel wattage
//   5. Security          — change password
//   6. Account           — billing status, delete account (danger zone)
// ============================================================

(function () {
  'use strict';

  var root = document.getElementById('profile-root');
  function tok() { return localStorage.getItem('rc_customer_token') || ''; }
  function hdrs() { return { 'Authorization': 'Bearer ' + tok(), 'Content-Type': 'application/json' }; }

  var profile = null;
  var dirty = {};           // tracks unsaved changes per section
  var saving = {};          // tracks in-flight saves per section
  var toastTimer = null;

  // ── Bootstrap ─────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    loadProfile();
  });

  async function loadProfile() {
    root.innerHTML = '<div class="flex items-center justify-center py-20"><div class="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-brand-500"></div></div>';
    try {
      var res = await fetch('/api/customer/profile', { headers: hdrs() });
      if (!res.ok) { window.location.href = '/customer/login'; return; }
      var data = await res.json();
      profile = data.customer || {};
      render();
    } catch (e) {
      root.innerHTML = '<p class="text-center text-red-500 py-12">Failed to load settings. Please refresh.</p>';
    }
  }

  // ── Render ────────────────────────────────────────────────
  function render() {
    root.innerHTML =
      '<div id="settings-toast" class="fixed top-4 right-4 z-50 hidden"></div>' +

      // ── 1. Personal Info ──────────────────────────────────
      section('Personal Information', 'fa-user-circle', 'blue',
        row('Full Name',    inp('name',     profile.name || '',         'Your full name')) +
        row('Phone',        inp('phone',    profile.phone || '',        '+1 (555) 000-0000', 'tel')) +
        row('Email Address','<p class="text-sm text-gray-600 py-2">' + esc(profile.email) + '</p><p class="text-xs text-gray-400">Email cannot be changed here. Contact support if needed.</p>'),
        'personal'
      ) +

      // ── 2. Company Info ───────────────────────────────────
      section('Company Information', 'fa-building', 'emerald',
        row('Company Name', inp('company_name', profile.company_name || '', 'Your roofing company')) +
        row('Address',      inp('address',      profile.address || '',       '123 Main St')) +
        '<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">' +
          '<div><label class="block text-xs font-semibold text-gray-500 mb-1">City</label>' + rawInp('city',     profile.city     || '', 'Calgary') + '</div>' +
          '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Province/State</label>' + rawInp('province', profile.province || '', 'AB') + '</div>' +
          '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Postal/ZIP</label>' + rawInp('postal_code', profile.postal_code || '', 'T2P 1J9') + '</div>' +
        '</div>',
        'company'
      ) +

      // ── 3. Branding ───────────────────────────────────────
      section('Brand &amp; Report Customization', 'fa-paint-brush', 'blue',
        row('Business Name (on reports)', inp('brand_business_name', profile.brand_business_name || '', 'Acme Roofing Ltd.')) +
        row('Logo URL',       inp('brand_logo_url',     profile.brand_logo_url || '',     'https://yoursite.com/logo.png', 'url')) +
        row('Tagline',        inp('brand_tagline',       profile.brand_tagline || '',       'Quality roofing since 1985')) +
        row('Business Phone', inp('brand_phone',         profile.brand_phone || '',         '+1 (555) 000-0000', 'tel')) +
        row('Business Email', inp('brand_email',         profile.brand_email || '',         'info@company.com', 'email')) +
        row('Website',        inp('brand_website',       profile.brand_website || '',       'https://yoursite.com', 'url')) +
        row('Business Address',inp('brand_address',      profile.brand_address || '',       '123 Main St, Calgary AB')) +
        row('License #',      inp('brand_license_number',profile.brand_license_number || '','ROC-123456')) +
        row('Insurance Info', inp('brand_insurance_info',profile.brand_insurance_info || '','Policy # / Provider')) +
        '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">' +
          '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Primary Color</label>' +
            '<input type="color" id="brand_primary_color" value="' + esc(profile.brand_primary_color || '#0ea5e9') + '" class="h-10 w-full rounded border border-gray-300 cursor-pointer" oninput="markDirty(\'branding\')"></div>' +
          '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Secondary Color</label>' +
            '<input type="color" id="brand_secondary_color" value="' + esc(profile.brand_secondary_color || '#0284c7') + '" class="h-10 w-full rounded border border-gray-300 cursor-pointer" oninput="markDirty(\'branding\')"></div>' +
        '</div>',
        'branding'
      ) +

      // ── 4. Company Type ───────────────────────────────────
      companyTypeSection() +

      // ── 4b. Material Defaults & Proposal Pricing ──────────
      materialDefaultsSection() +

      // ── 5. Report Preferences ─────────────────────────────
      section('Report Preferences', 'fa-sliders-h', 'gray',
        '<div id="solarWattRow" class="mb-4"' + (profile.company_type !== 'solar' ? ' style="display:none"' : '') + '>' +
          '<label class="block text-xs font-semibold text-gray-500 mb-1">Default Solar Panel Wattage (W)</label>' +
          '<input type="number" id="solar_panel_wattage_w" value="' + (profile.solar_panel_wattage_w || 400) + '" min="100" max="700" class="w-40 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-gray-400" oninput="markDirty(\'prefs\')">' +
          '<p class="text-xs text-gray-400 mt-1">Used for solar system sizing calculations.</p>' +
        '</div>' +
        '<p id="prefsNoOptions" class="text-sm text-gray-400"' + (profile.company_type === 'solar' ? ' style="display:none"' : '') + '>Switch to Solar Sales Company above to see solar-specific preferences.</p>',
        'prefs'
      ) +

      // ── Display Preferences ─────────────────────────────────
      '<div class="mt-6 bg-[#111111] rounded-2xl border border-white/10 overflow-hidden" style="background:var(--bg-card);border-color:var(--border-color)">' +
        '<div class="px-6 py-4 border-b" style="border-color:var(--border-color)">' +
          '<h3 class="font-bold" style="color:var(--text-primary)"><i class="fas fa-palette text-blue-400 mr-2"></i>Display Preferences</h3>' +
        '</div>' +
        '<div class="p-6">' +
          '<label class="block text-sm font-medium mb-3" style="color:var(--text-secondary)">Theme Mode</label>' +
          '<div class="flex gap-2" id="theme-mode-buttons">' +
            '<button onclick="window._setThemeMode(\'dark\')" class="flex-1 px-4 py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ' + ((!localStorage.getItem('rc_dashboard_theme') || localStorage.getItem('rc_dashboard_theme') === 'dark') ? 'bg-emerald-500/15 text-emerald-400 border-2 border-emerald-500/30' : 'bg-white/5 text-gray-400 border-2 border-transparent hover:bg-white/10') + '"><i class="fas fa-moon"></i>Dark</button>' +
            '<button onclick="window._setThemeMode(\'light\')" class="flex-1 px-4 py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ' + (localStorage.getItem('rc_dashboard_theme') === 'light' ? 'bg-blue-500/15 text-blue-400 border-2 border-blue-500/30' : 'bg-white/5 text-gray-400 border-2 border-transparent hover:bg-white/10') + '"><i class="fas fa-sun"></i>Light</button>' +
            '<button onclick="window._setThemeMode(\'auto\')" class="flex-1 px-4 py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2 ' + (localStorage.getItem('rc_dashboard_theme') === 'auto' ? 'bg-blue-500/15/15 text-blue-400 border-2 border-blue-500/30' : 'bg-white/5 text-gray-400 border-2 border-transparent hover:bg-white/10') + '"><i class="fas fa-adjust"></i>Auto</button>' +
          '</div>' +
          '<p class="text-xs mt-2" style="color:var(--text-muted)">Auto mode follows your system preference.</p>' +
        '</div>' +
      '</div>' +

      // ── Payment Integrations ──────────────────────────────
      squareIntegrationSection() +

      // ── 5. Security ───────────────────────────────────────
      section('Security', 'fa-lock', 'red',
        '<div class="mb-4">' +
          '<label class="block text-xs font-semibold text-gray-500 mb-1">Current Password</label>' +
          '<input type="password" id="pw_current" placeholder="Enter current password" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-400" oninput="markDirty(\'security\')">' +
        '</div>' +
        '<div class="mb-4">' +
          '<label class="block text-xs font-semibold text-gray-500 mb-1">New Password</label>' +
          '<input type="password" id="pw_new" placeholder="At least 8 characters" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-400" oninput="markDirty(\'security\')">' +
        '</div>' +
        '<div>' +
          '<label class="block text-xs font-semibold text-gray-500 mb-1">Confirm New Password</label>' +
          '<input type="password" id="pw_confirm" placeholder="Repeat new password" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-400" oninput="markDirty(\'security\')">' +
        '</div>',
        'security'
      ) +

      // ── 6. Account / Billing ──────────────────────────────
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">' +
        '<h2 class="text-base font-bold text-gray-800 mb-4"><i class="fas fa-credit-card text-gray-400 mr-2"></i>Billing &amp; Subscription</h2>' +
        renderBillingBlock() +
      '</div>' +

      // ── 7. Danger Zone ────────────────────────────────────
      '<div class="bg-red-50 rounded-2xl border border-red-200 p-6">' +
        '<h2 class="text-base font-bold text-red-700 mb-2"><i class="fas fa-exclamation-triangle mr-2"></i>Danger Zone</h2>' +
        '<p class="text-sm text-red-600 mb-4">Deleting your account is permanent and cannot be undone. All reports, data, and credits will be lost.</p>' +
        '<button onclick="requestAccountDeletion()" class="px-4 py-2 border border-red-400 text-red-600 rounded-lg text-sm font-semibold hover:bg-red-100 transition-colors"><i class="fas fa-trash mr-1"></i>Request Account Deletion</button>' +
      '</div>';

    // Wire all inputs to markDirty
    ['name','phone','company_name','address','city','province','postal_code'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', function () { markDirty('personal'); markDirty('company'); });
    });
    ['brand_business_name','brand_logo_url','brand_tagline','brand_phone','brand_email',
     'brand_website','brand_address','brand_license_number','brand_insurance_info'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('input', function () { markDirty('branding'); });
    });

    // Load current Square connection status
    refreshSquareStatus();
    // Load per-contractor material/pricing defaults
    loadMaterialDefaults();
  }

  // ── Payment Integrations Section (Square OAuth) ──────────
  function squareIntegrationSection() {
    return '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6" id="square-integration-section">' +
      '<h2 class="text-base font-bold text-gray-800 mb-2"><i class="fas fa-credit-card text-emerald-500 mr-2"></i>Payment Integrations</h2>' +
      '<p class="text-sm text-gray-500 mb-4">Connect your Square account so invoice and proposal payments go directly to your own Square merchant account. Without a connection, payment links cannot be generated.</p>' +
      '<div id="square-integration-status" class="border border-gray-200 rounded-xl p-4 bg-gray-50">' +
        '<div class="flex items-center gap-2 text-gray-500 text-sm"><i class="fas fa-spinner fa-spin"></i> Checking Square connection...</div>' +
      '</div>' +
    '</div>';
  }

  async function refreshSquareStatus() {
    var wrap = document.getElementById('square-integration-status');
    if (!wrap) return;
    try {
      var res = await fetch('/api/square/oauth/status', { headers: hdrs() });
      var data = await res.json();
      var connected = !!data.connected;
      var appConfigured = data.app_configured !== false;
      if (!appConfigured) {
        wrap.innerHTML =
          '<div class="flex items-start gap-3">' +
            '<div class="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0"><i class="fas fa-exclamation-triangle text-amber-600"></i></div>' +
            '<div><p class="font-semibold text-amber-800 text-sm">Square OAuth not configured on the server</p>' +
            '<p class="text-xs text-amber-700 mt-1">Ask Roof Manager support to finish Square OAuth setup (SQUARE_APPLICATION_ID + SQUARE_CLIENT_SECRET).</p></div>' +
          '</div>';
        return;
      }
      if (connected) {
        wrap.innerHTML =
          '<div class="flex items-start justify-between gap-4">' +
            '<div class="flex items-start gap-3">' +
              '<div class="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0"><i class="fas fa-check-circle text-emerald-600"></i></div>' +
              '<div>' +
                '<p class="font-semibold text-emerald-800 text-sm">Square connected</p>' +
                '<p class="text-xs text-gray-600 mt-1">' + esc(data.merchant_name || 'Merchant ID: ' + (data.merchant_id || '')) + '</p>' +
                (data.location_id ? '<p class="text-[10px] text-gray-400 mt-0.5">Location ' + esc(data.location_id) + '</p>' : '') +
              '</div>' +
            '</div>' +
            '<button onclick="disconnectSquare()" class="text-xs font-semibold text-red-600 hover:underline"><i class="fas fa-unlink mr-1"></i>Disconnect</button>' +
          '</div>';
      } else {
        wrap.innerHTML =
          '<div class="flex items-center justify-between gap-4">' +
            '<div class="flex items-start gap-3">' +
              '<div class="w-10 h-10 rounded-xl bg-gray-200 flex items-center justify-center flex-shrink-0"><i class="fas fa-plug text-gray-500"></i></div>' +
              '<div>' +
                '<p class="font-semibold text-gray-800 text-sm">Square not connected</p>' +
                '<p class="text-xs text-gray-500 mt-1">Connect your own Square account to accept invoice payments.</p>' +
              '</div>' +
            '</div>' +
            '<button onclick="connectSquare()" class="px-4 py-2 bg-gray-900 text-white text-sm font-semibold rounded-lg hover:bg-black transition-colors"><i class="fab fa-square mr-1"></i>Connect Square</button>' +
          '</div>';
      }
    } catch (e) {
      wrap.innerHTML = '<p class="text-sm text-red-600">Failed to load Square status: ' + esc(e.message || 'unknown') + '</p>';
    }
  }

  window.connectSquare = function () {
    var token = tok();
    var url = '/api/square/oauth/start?token=' + encodeURIComponent(token);
    var popup = window.open(url, 'square_oauth', 'width=600,height=800');
    function onMsg(ev) {
      if (!ev.data || typeof ev.data !== 'object') return;
      if (ev.data.type === 'square_oauth_success') {
        window.removeEventListener('message', onMsg);
        showToast('Square connected successfully!', 'success');
        refreshSquareStatus();
      } else if (ev.data.type === 'square_oauth_error') {
        window.removeEventListener('message', onMsg);
        showToast('Square connection failed: ' + (ev.data.error || 'unknown'), 'error');
      }
    }
    window.addEventListener('message', onMsg);
    var poll = setInterval(function () {
      if (popup && popup.closed) { clearInterval(poll); refreshSquareStatus(); }
    }, 1000);
  };

  window.disconnectSquare = async function () {
    if (!confirm('Disconnect your Square account? You won’t be able to send payment links until you reconnect.')) return;
    try {
      var res = await fetch('/api/square/oauth/disconnect', { method: 'POST', headers: hdrs() });
      if (!res.ok) throw new Error((await res.json()).error || 'Disconnect failed');
      showToast('Square disconnected.', 'success');
      refreshSquareStatus();
    } catch (e) {
      showToast(e.message || 'Disconnect failed', 'error');
    }
  };

  // ── Company Type Section ──────────────────────────────────
  function companyTypeSection() {
    var cur = profile.company_type || 'roofing';
    var roofActive = cur === 'roofing';
    var solActive  = cur === 'solar';
    return '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">' +
      '<div class="flex items-center justify-between mb-2">' +
        '<h2 class="text-base font-bold text-gray-800"><i class="fas fa-building text-sky-500 mr-2"></i>Company Type</h2>' +
        '<span id="ctype-saved" class="hidden text-xs text-green-600 font-semibold"><i class="fas fa-check-circle mr-1"></i>Saved</span>' +
      '</div>' +
      '<p class="text-sm text-gray-500 mb-4">Choose your business type. This changes dashboard labels, available tools, and default workflows.</p>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">' +

        // Roofing card
        '<button id="ctype-roofing" onclick="switchCompanyType(\'roofing\')" class="group relative border-2 rounded-2xl p-5 text-left transition-all duration-150 focus:outline-none ' +
          (roofActive ? 'border-sky-500 bg-sky-50 shadow-md' : 'border-gray-200 hover:border-sky-400 hover:shadow-md bg-white') + '">' +
          (roofActive ? '<span class="absolute top-3 right-3 bg-sky-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">ACTIVE</span>' : '') +
          '<div class="flex items-center gap-3 mb-2">' +
            '<div class="w-10 h-10 rounded-xl flex items-center justify-center ' + (roofActive ? 'bg-sky-500' : 'bg-sky-100 group-hover:bg-sky-200') + '">' +
              '<i class="fas fa-hard-hat text-lg ' + (roofActive ? 'text-white' : 'text-sky-500') + '"></i>' +
            '</div>' +
            '<span class="font-bold text-gray-800">Roofing Company</span>' +
          '</div>' +
          '<ul class="text-xs text-gray-500 space-y-1 mt-2">' +
            '<li><i class="fas fa-check text-sky-500 mr-1.5"></i>Order Roof Measurement Reports</li>' +
            '<li><i class="fas fa-check text-sky-500 mr-1.5"></i>Roofer Secretary AI</li>' +
            '<li><i class="fas fa-check text-sky-500 mr-1.5"></i>Job Management &amp; CRM</li>' +
          '</ul>' +
        '</button>' +

        // Solar card
        '<button id="ctype-solar" onclick="switchCompanyType(\'solar\')" class="group relative border-2 rounded-2xl p-5 text-left transition-all duration-150 focus:outline-none ' +
          (solActive ? 'border-white/15 bg-white/10 shadow-md' : 'border-gray-200 hover:border-white/15 hover:shadow-md bg-white') + '">' +
          (solActive ? '<span class="absolute top-3 right-3 bg-white/10 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">ACTIVE</span>' : '') +
          '<div class="flex items-center gap-3 mb-2">' +
            '<div class="w-10 h-10 rounded-xl flex items-center justify-center ' + (solActive ? 'bg-white/10' : 'bg-white/10 group-hover:bg-white/10') + '">' +
              '<i class="fas fa-solar-panel text-lg ' + (solActive ? 'text-white' : 'text-gray-400') + '"></i>' +
            '</div>' +
            '<span class="font-bold text-gray-800">Solar Sales Company</span>' +
          '</div>' +
          '<ul class="text-xs text-gray-500 space-y-1 mt-2">' +
            '<li><i class="fas fa-check text-gray-400 mr-1.5"></i>Order Solar Proposals</li>' +
            '<li><i class="fas fa-check text-gray-400 mr-1.5"></i>Solar Sales Secretary AI</li>' +
            '<li><i class="fas fa-check text-gray-400 mr-1.5"></i>Solar Calculator &amp; Panel Designer</li>' +
          '</ul>' +
        '</button>' +
      '</div>' +
    '</div>';
  }

  // ── Material Defaults & Proposal Pricing Section ──────────
  // Per-contractor; falls back to platform defaults until the user saves once.
  var materialPrefs = null;
  var proposalPricing = null;

  var SHINGLE_CATALOG = {
    '3tab':             { name: '3-Tab Standard',           price: '$32/bdl', warranty: '25-year',       wind: '96 km/h',  weight: '210 lbs/sq', desc: 'Budget-friendly strip shingle. Flat, uniform look.' },
    'architectural':    { name: 'Architectural (Laminate)', price: '$42/bdl', warranty: '30-year',       wind: '210 km/h', weight: '250 lbs/sq', desc: 'Industry standard. Dimensional shadow lines, enhanced wind resistance.' },
    'premium':          { name: 'Premium Architectural',    price: '$55/bdl', warranty: 'Ltd. Lifetime', wind: '210 km/h', weight: '280 lbs/sq', desc: 'SBS-modified bitumen, algae resistant, superior flexibility.' },
    'designer':         { name: 'Designer / Luxury',        price: '$72/bdl', warranty: 'Lifetime',      wind: '210 km/h', weight: '350 lbs/sq', desc: 'Multi-layered premium. Mimics slate or cedar shake.' },
    'impact_resistant': { name: 'Impact-Resistant (Class 4)', price: '$62/bdl', warranty: 'Ltd. Lifetime', wind: '210 km/h', weight: '290 lbs/sq', desc: 'UL 2218 Class 4 hail rated. May qualify for insurance discounts.' },
    'metal':            { name: 'Steel / Metal Shingles',   price: '$95/bdl', warranty: '50-year',       wind: '200 km/h', weight: '150 lbs/sq', desc: 'Interlocking steel panels. Fireproof, lightweight, extremely durable.' },
  };

  function materialDefaultsSection() {
    return '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">' +
      '<div class="flex items-center justify-between mb-2">' +
        '<h2 class="text-base font-bold text-gray-800"><i class="fas fa-layer-group text-blue-500 mr-2"></i>Material Defaults &amp; Proposal Pricing</h2>' +
        '<span id="mat-saved" class="hidden text-xs text-green-600 font-semibold"><i class="fas fa-check-circle mr-1"></i>Saved</span>' +
      '</div>' +
      '<p class="text-sm text-gray-500 mb-4">Your default shingle, waste %, tax, and per-unit prices for reports and proposals. Each contractor sets their own — these only affect your account.</p>' +
      '<div id="materialPanel" class="text-sm text-gray-500 py-6 text-center"><i class="fas fa-spinner fa-spin mr-2"></i>Loading your pricing&hellip;</div>' +
    '</div>';
  }

  async function loadMaterialDefaults() {
    try {
      var [mr, pr] = await Promise.all([
        fetch('/api/customer/material-preferences', { headers: hdrs() }),
        fetch('/api/customer/proposal-pricing', { headers: hdrs() }),
      ]);
      if (mr.ok) materialPrefs   = (await mr.json()).preferences || {};
      if (pr.ok) proposalPricing = (await pr.json()).presets || {};
      renderMaterialPanel();
    } catch (e) {
      var panel = document.getElementById('materialPanel');
      if (panel) panel.innerHTML = '<p class="text-red-500">Failed to load your pricing. Refresh to retry.</p>';
    }
  }

  function renderMaterialPanel() {
    var panel = document.getElementById('materialPanel');
    if (!panel) return;
    var p   = materialPrefs   || {};
    var pp  = proposalPricing || {};
    var mup = pp.material_unit_prices || {};
    var taxPct = ((p.tax_rate != null ? p.tax_rate : 0.05) * 100).toFixed(1);
    var wasteOptions = [10, 12, 15, 17, 20];

    var shingleCards = Object.keys(SHINGLE_CATALOG).map(function (key) {
      var s = SHINGLE_CATALOG[key];
      var sel = p.shingle_type === key;
      return '<div onclick="selectShingleCust(\'' + key + '\')" ' +
        'class="cursor-pointer rounded-xl border-2 p-3 transition-all hover:shadow-md ' +
        (sel ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200' : 'border-gray-200 bg-white hover:border-gray-300') + '">' +
        '<div class="flex items-start justify-between mb-1">' +
          '<span class="font-bold text-xs text-gray-800">' + esc(s.name) + '</span>' +
          (sel ? '<i class="fas fa-check-circle text-blue-500 text-xs"></i>' : '') +
        '</div>' +
        '<p class="text-[11px] text-gray-500 mb-2 leading-snug">' + esc(s.desc) + '</p>' +
        '<div class="grid grid-cols-2 gap-1 text-[11px]">' +
          '<div><i class="fas fa-dollar-sign text-green-500 mr-1"></i>' + esc(s.price) + '</div>' +
          '<div><i class="fas fa-shield-alt text-blue-500 mr-1"></i>' + esc(s.warranty) + '</div>' +
          '<div><i class="fas fa-wind text-cyan-500 mr-1"></i>' + esc(s.wind) + '</div>' +
          '<div><i class="fas fa-weight-hanging text-amber-500 mr-1"></i>' + esc(s.weight) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    var wasteButtons = wasteOptions.map(function (w) {
      var on = p.waste_factor_pct === w;
      return '<button onclick="selectWasteCust(' + w + ')" ' +
        'class="px-3 py-1.5 rounded-lg text-xs font-bold transition-all ' +
        (on ? 'bg-blue-500 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200') + '">' + w + '%</button>';
    }).join('');

    var unitPriceRows = [
      ['shingle_bundle',     'Shingle Bundle',              '$', '/bdl'],
      ['underlayment_roll',  'Underlayment Roll',           '$', '/roll'],
      ['ice_water_roll',     'Ice & Water Shield Roll',     '$', '/roll'],
      ['ridge_cap_bundle',   'Ridge Cap Bundle',            '$', '/bdl'],
      ['drip_edge_lf',       'Drip Edge',                   '$', '/lf'],
      ['starter_strip_lf',   'Starter Strip',               '$', '/lf'],
      ['valley_flashing_lf', 'Valley Flashing',             '$', '/lf'],
      ['nails_box',          'Nails (box)',                 '$', '/box'],
      ['caulk_tube',         'Caulk Tube',                  '$', '/tube'],
      ['labor_per_square',   'Labor',                       '$', '/sq'],
      ['tearoff_per_square', 'Tearoff',                     '$', '/sq'],
      ['dumpster_flat',      'Dumpster (flat)',             '$', ''],
    ].map(function (r) {
      var key = r[0], label = r[1], prefix = r[2], suffix = r[3];
      var v = (mup[key] != null) ? mup[key] : '';
      return '<div>' +
        '<label class="block text-[11px] font-semibold text-gray-500 mb-1">' + esc(label) + '</label>' +
        '<div class="flex items-center gap-1">' +
          '<span class="text-xs text-gray-400">' + prefix + '</span>' +
          '<input type="number" step="0.01" min="0" id="mup_' + key + '" value="' + v + '" ' +
            'class="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-400">' +
          '<span class="text-xs text-gray-400">' + suffix + '</span>' +
        '</div>' +
      '</div>';
    }).join('');

    panel.innerHTML =
      '<div id="matMsg" class="hidden mb-3"></div>' +

      // Shingle type
      '<label class="block text-xs font-semibold text-gray-700 mb-2">Shingle Type</label>' +
      '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-5">' + shingleCards + '</div>' +

      // Waste Factor
      '<label class="block text-xs font-semibold text-gray-700 mb-2">Default Waste Factor</label>' +
      '<div class="flex gap-2 mb-5 flex-wrap">' + wasteButtons + '</div>' +

      // Tax + toggles
      '<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">' +
        '<div><label class="block text-xs font-semibold text-gray-700 mb-1">Tax Rate (%)</label>' +
          '<input id="custTaxRate" type="number" step="0.5" min="0" max="20" value="' + taxPct + '" ' +
            'class="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-400">' +
          '<p class="text-[10px] text-gray-400 mt-1">Alberta GST 5%, Ontario HST 13%</p></div>' +
        '<div><label class="block text-xs font-semibold text-gray-700 mb-1">Include Ridge Vent</label>' +
          '<button onclick="toggleMatPrefCust(\'include_ventilation\')" ' +
            'class="px-4 py-2 rounded-lg text-sm font-bold transition-all ' +
            (p.include_ventilation !== false ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500') + '">' +
            (p.include_ventilation !== false ? 'Yes' : 'No') + '</button></div>' +
        '<div><label class="block text-xs font-semibold text-gray-700 mb-1">Include Pipe Boots</label>' +
          '<button onclick="toggleMatPrefCust(\'include_pipe_boots\')" ' +
            'class="px-4 py-2 rounded-lg text-sm font-bold transition-all ' +
            (p.include_pipe_boots !== false ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500') + '">' +
            (p.include_pipe_boots !== false ? 'Yes' : 'No') + '</button></div>' +
      '</div>' +

      // Per-unit prices
      '<details class="mb-5"><summary class="cursor-pointer text-xs font-semibold text-gray-700 mb-3">' +
        '<i class="fas fa-dollar-sign text-green-500 mr-1"></i>Per-unit prices for proposals (optional)</summary>' +
        '<p class="text-[11px] text-gray-500 mb-3 mt-2">Used when generating proposals from a report. Leave blank to use defaults.</p>' +
        '<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">' + unitPriceRows + '</div>' +
      '</details>' +

      // Save
      '<button onclick="saveMaterialDefaultsCust()" id="custMatSave" ' +
        'class="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors">' +
        '<i class="fas fa-save mr-1"></i>Save Material &amp; Pricing Defaults</button>';
  }

  window.selectShingleCust = function (key) {
    materialPrefs = materialPrefs || {};
    materialPrefs.shingle_type = key;
    renderMaterialPanel();
  };

  window.selectWasteCust = function (pct) {
    materialPrefs = materialPrefs || {};
    materialPrefs.waste_factor_pct = pct;
    renderMaterialPanel();
  };

  window.toggleMatPrefCust = function (field) {
    materialPrefs = materialPrefs || {};
    materialPrefs[field] = !(materialPrefs[field] !== false);
    renderMaterialPanel();
  };

  window.saveMaterialDefaultsCust = async function () {
    var btn = document.getElementById('custMatSave');
    var msg = document.getElementById('matMsg');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Saving...'; }

    var taxInput = document.getElementById('custTaxRate');
    var taxPct = taxInput ? parseFloat(taxInput.value) : 5;
    if (!isFinite(taxPct)) taxPct = 5;
    taxPct = Math.max(0, Math.min(20, taxPct));

    var prefsBody = {
      shingle_type:        materialPrefs?.shingle_type || 'architectural',
      waste_factor_pct:    Math.max(10, Math.min(25, materialPrefs?.waste_factor_pct || 15)),
      tax_rate:            taxPct / 100,
      include_ventilation: materialPrefs?.include_ventilation !== false,
      include_pipe_boots:  materialPrefs?.include_pipe_boots  !== false,
    };

    var pricingBody = { material_unit_prices: {} };
    var keys = ['shingle_bundle','underlayment_roll','ice_water_roll','ridge_cap_bundle',
                'drip_edge_lf','starter_strip_lf','valley_flashing_lf','nails_box','caulk_tube',
                'labor_per_square','tearoff_per_square','dumpster_flat'];
    keys.forEach(function (k) {
      var el = document.getElementById('mup_' + k);
      if (!el) return;
      var v = parseFloat(el.value);
      if (isFinite(v) && v >= 0) pricingBody.material_unit_prices[k] = v;
    });
    // Mirror tax onto material_unit_prices.tax_rate so proposal engine sees it
    pricingBody.material_unit_prices.tax_rate = prefsBody.tax_rate;

    try {
      var [mRes, pRes] = await Promise.all([
        fetch('/api/customer/material-preferences', { method: 'PUT', headers: hdrs(), body: JSON.stringify(prefsBody) }),
        fetch('/api/customer/proposal-pricing',     { method: 'PUT', headers: hdrs(), body: JSON.stringify(pricingBody) }),
      ]);
      if (!mRes.ok) throw new Error('Material save failed');
      if (!pRes.ok) throw new Error('Pricing save failed');
      materialPrefs   = (await mRes.json()).preferences || materialPrefs;
      proposalPricing = Object.assign({}, proposalPricing || {}, { material_unit_prices: pricingBody.material_unit_prices });
      var savedBadge = document.getElementById('mat-saved');
      if (savedBadge) { savedBadge.classList.remove('hidden'); setTimeout(function () { savedBadge.classList.add('hidden'); }, 2500); }
      if (msg) {
        msg.className = 'mb-3 p-2 rounded-lg text-xs bg-green-50 text-green-700 border border-green-200';
        msg.textContent = 'Saved. Future reports & proposals will use your settings automatically.';
        msg.classList.remove('hidden');
      }
      showToast('Material defaults saved', 'success');
    } catch (e) {
      if (msg) {
        msg.className = 'mb-3 p-2 rounded-lg text-xs bg-red-50 text-red-700 border border-red-200';
        msg.textContent = e.message || 'Save failed';
        msg.classList.remove('hidden');
      }
      showToast(e.message || 'Save failed', 'error');
    }
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save mr-1"></i>Save Material &amp; Pricing Defaults'; }
  };

  window.switchCompanyType = async function (type) {
    if (profile.company_type === type) return; // already set
    var savedEl = document.getElementById('ctype-saved');
    try {
      var res = await fetch('/api/customer/solar-settings', {
        method: 'PATCH', headers: hdrs(),
        body: JSON.stringify({ company_type: type, solar_panel_wattage_w: profile.solar_panel_wattage_w || 400 })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to switch type');
      profile.company_type = type;
      // Refresh localStorage so dashboard picks it up immediately
      var me = await fetch('/api/customer/me', { headers: hdrs() });
      if (me.ok) { var d = await me.json(); localStorage.setItem('rc_customer', JSON.stringify(d.customer)); }
      // Show solarWatt row if needed
      var wattRow = document.getElementById('solarWattRow');
      var noOpts  = document.getElementById('prefsNoOptions');
      if (wattRow) wattRow.style.display = type === 'solar' ? '' : 'none';
      if (noOpts)  noOpts.style.display  = type === 'solar' ? 'none' : '';
      // Re-render the company type section in-place
      var ctypeSection = document.querySelector('#ctype-roofing')?.closest('.bg-white.rounded-2xl');
      if (ctypeSection) ctypeSection.outerHTML = companyTypeSection();
      // Show saved badge
      if (savedEl) { savedEl.classList.remove('hidden'); setTimeout(function () { savedEl.classList.add('hidden'); }, 2500); }
      showToast('Switched to ' + (type === 'solar' ? 'Solar Sales Company' : 'Roofing Company') + '!', 'success');
    } catch (e) {
      showToast(e.message || 'Switch failed', 'error');
    }
  };

  // ── Section builder ───────────────────────────────────────
  function section(title, icon, color, body, sectionId) {
    var colorMap = {
      blue:   'text-blue-600',
      emerald:'text-emerald-600',
      violet: 'text-blue-400',
      gray:  'text-gray-400',
      red:    'text-red-600',
    };
    var btnColorMap = {
      blue:   'bg-blue-600 hover:bg-blue-700',
      emerald:'bg-emerald-600 hover:bg-emerald-700',
      violet: 'bg-blue-500/15 hover:bg-blue-500/15',
      gray:  'bg-white/10 hover:bg-white/10',
      red:    'bg-red-600 hover:bg-red-700',
    };
    return '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6">' +
      '<div class="flex items-center justify-between mb-5">' +
        '<h2 class="text-base font-bold text-gray-800"><i class="fas ' + icon + ' ' + (colorMap[color] || 'text-gray-500') + ' mr-2"></i>' + title + '</h2>' +
        '<button id="save-' + sectionId + '" onclick="saveSection(\'' + sectionId + '\')" class="hidden px-4 py-1.5 ' + (btnColorMap[color] || 'bg-gray-600 hover:bg-gray-700') + ' text-white text-xs font-semibold rounded-lg transition-colors">Save Changes</button>' +
      '</div>' +
      body +
    '</div>';
  }

  function row(label, content) {
    return '<div class="mb-4"><label class="block text-xs font-semibold text-gray-500 mb-1">' + label + '</label>' + content + '</div>';
  }

  function inp(id, val, placeholder, type) {
    return '<input type="' + (type || 'text') + '" id="' + id + '" value="' + esc(val) + '" placeholder="' + esc(placeholder || '') + '" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-400 focus:border-brand-400">';
  }

  function rawInp(id, val, placeholder) {
    return '<input type="text" id="' + id + '" value="' + esc(val) + '" placeholder="' + esc(placeholder || '') + '" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand-400">';
  }

  function renderBillingBlock() {
    var plan  = profile.subscription_plan || 'free';
    var status= profile.subscription_status || 'none';
    var free  = Math.max(0, (profile.free_trial_total || 3) - (profile.free_trial_used || 0));
    var paid  = Math.max(0, (profile.report_credits || 0) - (profile.credits_used || 0));
    var isActive = status === 'active';

    return '<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">' +
      stat('Plan', plan.charAt(0).toUpperCase() + plan.slice(1), isActive ? 'text-green-600' : 'text-gray-600') +
      stat('Status', status.charAt(0).toUpperCase() + status.slice(1), isActive ? 'text-green-600' : 'text-gray-400') +
      stat('Free Trials Left', free + '', 'text-blue-600') +
      stat('Paid Credits', paid + '', 'text-blue-400') +
    '</div>' +
    '<div class="flex gap-3 flex-wrap">' +
      '<a href="/pricing" class="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-lg transition-colors"><i class="fas fa-coins mr-1"></i>Buy Credits</a>' +
    '</div>';
  }

  function stat(label, value, cls) {
    return '<div class="bg-gray-50 rounded-xl p-3">' +
      '<div class="text-xs text-gray-400 font-medium mb-0.5">' + label + '</div>' +
      '<div class="text-lg font-bold ' + (cls || 'text-gray-800') + '">' + value + '</div>' +
    '</div>';
  }

  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Dirty tracking / save buttons ─────────────────────────
  window.markDirty = function (sectionId) {
    dirty[sectionId] = true;
    var btn = document.getElementById('save-' + sectionId);
    if (btn) btn.classList.remove('hidden');
  };

  // ── Save dispatchers ──────────────────────────────────────
  window.saveSection = async function (sectionId) {
    if (saving[sectionId]) return;
    saving[sectionId] = true;
    var btn = document.getElementById('save-' + sectionId);
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Saving...'; }

    try {
      if (sectionId === 'personal' || sectionId === 'company') {
        await saveProfile();
      } else if (sectionId === 'branding') {
        await saveBranding();
      } else if (sectionId === 'prefs') {
        await savePrefs();
      } else if (sectionId === 'security') {
        await savePassword();
      }
      dirty[sectionId] = false;
      if (btn) { btn.classList.add('hidden'); }
      showToast('Saved!', 'success');
    } catch (e) {
      showToast(e.message || 'Save failed', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = 'Save Changes'; }
    }
    saving[sectionId] = false;
  };

  async function saveProfile() {
    var res = await fetch('/api/customer/profile', {
      method: 'PUT', headers: hdrs(),
      body: JSON.stringify({
        name:         val('name'),
        phone:        val('phone'),
        company_name: val('company_name'),
        address:      val('address'),
        city:         val('city'),
        province:     val('province'),
        postal_code:  val('postal_code'),
      })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Profile save failed');
    // Refresh cached customer data
    var me = await fetch('/api/customer/me', { headers: hdrs() });
    if (me.ok) { var d = await me.json(); localStorage.setItem('rc_customer', JSON.stringify(d.customer)); }
  }

  async function saveBranding() {
    var res = await fetch('/api/customer/branding', {
      method: 'PUT', headers: hdrs(),
      body: JSON.stringify({
        brand_business_name:  val('brand_business_name'),
        brand_logo_url:       val('brand_logo_url'),
        brand_tagline:        val('brand_tagline'),
        brand_phone:          val('brand_phone'),
        brand_email:          val('brand_email'),
        brand_website:        val('brand_website'),
        brand_address:        val('brand_address'),
        brand_license_number: val('brand_license_number'),
        brand_insurance_info: val('brand_insurance_info'),
        brand_primary_color:  val('brand_primary_color'),
        brand_secondary_color:val('brand_secondary_color'),
      })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Branding save failed');
  }

  async function savePrefs() {
    var wattage = parseInt(val('solar_panel_wattage_w') || '400', 10);
    var res = await fetch('/api/customer/solar-settings', {
      method: 'PATCH', headers: hdrs(),
      body: JSON.stringify({ company_type: profile.company_type || 'roofing', solar_panel_wattage_w: wattage })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Preferences save failed');
    var me = await fetch('/api/customer/me', { headers: hdrs() });
    if (me.ok) { var d = await me.json(); localStorage.setItem('rc_customer', JSON.stringify(d.customer)); }
  }

  async function savePassword() {
    var current = val('pw_current');
    var newPw   = val('pw_new');
    var confirm = val('pw_confirm');
    if (!current) throw new Error('Enter your current password');
    if (!newPw || newPw.length < 8) throw new Error('New password must be at least 8 characters');
    if (newPw !== confirm) throw new Error('New passwords do not match');

    var res = await fetch('/api/customer/change-password', {
      method: 'POST', headers: hdrs(),
      body: JSON.stringify({ current_password: current, new_password: newPw })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Password change failed');
    document.getElementById('pw_current').value = '';
    document.getElementById('pw_new').value = '';
    document.getElementById('pw_confirm').value = '';
  }

  window.requestAccountDeletion = async function () {
    if (!(await window.rmConfirm('Are you absolutely sure? This will permanently delete your account and all data. This cannot be undone.'))) return
    var email = prompt('To confirm, type your email address:');
    if (!email || email.toLowerCase() !== (profile.email || '').toLowerCase()) {
      window.rmToast('Email did not match. Account deletion cancelled.', 'info');
      return;
    }
    showToast('Deletion request submitted. Support will contact you within 24 hours.', 'info');
  };

  // ── Toast ─────────────────────────────────────────────────
  function showToast(msg, type) {
    var el = document.getElementById('settings-toast');
    if (!el) return;
    clearTimeout(toastTimer);
    var bg = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';
    el.className = 'fixed top-4 right-4 z-50 px-5 py-3 rounded-xl text-white text-sm font-semibold shadow-lg ' + bg;
    el.textContent = msg;
    toastTimer = setTimeout(function () { el.className = 'fixed top-4 right-4 z-50 hidden'; }, 3000);
  }

  function val(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  window._setThemeMode = function(mode) {
    localStorage.setItem('rc_dashboard_theme', mode);

    var html = document.documentElement;
    html.classList.remove('light-theme');
    document.body.classList.remove('light-theme');

    if (mode === 'light') {
      html.classList.add('light-theme');
      document.body.classList.add('light-theme');
    } else if (mode === 'auto' && window.matchMedia('(prefers-color-scheme: light)').matches) {
      html.classList.add('light-theme');
      document.body.classList.add('light-theme');
    }

    // Re-render the settings page to update button states
    if (typeof render === 'function') render();
    else location.reload();
  };

})();

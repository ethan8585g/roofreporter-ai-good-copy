// ============================================================
// RoofReporterAI — Account Settings Page
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
        '<div class="grid grid-cols-3 gap-3 mb-4">' +
          '<div><label class="block text-xs font-semibold text-gray-500 mb-1">City</label>' + rawInp('city',     profile.city     || '', 'Calgary') + '</div>' +
          '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Province/State</label>' + rawInp('province', profile.province || '', 'AB') + '</div>' +
          '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Postal/ZIP</label>' + rawInp('postal_code', profile.postal_code || '', 'T2P 1J9') + '</div>' +
        '</div>',
        'company'
      ) +

      // ── 3. Branding ───────────────────────────────────────
      section('Brand &amp; Report Customization', 'fa-paint-brush', 'violet',
        row('Business Name (on reports)', inp('brand_business_name', profile.brand_business_name || '', 'Acme Roofing Ltd.')) +
        row('Logo URL',       inp('brand_logo_url',     profile.brand_logo_url || '',     'https://yoursite.com/logo.png', 'url')) +
        row('Tagline',        inp('brand_tagline',       profile.brand_tagline || '',       'Quality roofing since 1985')) +
        row('Business Phone', inp('brand_phone',         profile.brand_phone || '',         '+1 (555) 000-0000', 'tel')) +
        row('Business Email', inp('brand_email',         profile.brand_email || '',         'info@company.com', 'email')) +
        row('Website',        inp('brand_website',       profile.brand_website || '',       'https://yoursite.com', 'url')) +
        row('Business Address',inp('brand_address',      profile.brand_address || '',       '123 Main St, Calgary AB')) +
        row('License #',      inp('brand_license_number',profile.brand_license_number || '','ROC-123456')) +
        row('Insurance Info', inp('brand_insurance_info',profile.brand_insurance_info || '','Policy # / Provider')) +
        '<div class="grid grid-cols-2 gap-4 mb-4">' +
          '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Primary Color</label>' +
            '<input type="color" id="brand_primary_color" value="' + esc(profile.brand_primary_color || '#0ea5e9') + '" class="h-10 w-full rounded border border-gray-300 cursor-pointer" oninput="markDirty(\'branding\')"></div>' +
          '<div><label class="block text-xs font-semibold text-gray-500 mb-1">Secondary Color</label>' +
            '<input type="color" id="brand_secondary_color" value="' + esc(profile.brand_secondary_color || '#0284c7') + '" class="h-10 w-full rounded border border-gray-300 cursor-pointer" oninput="markDirty(\'branding\')"></div>' +
        '</div>',
        'branding'
      ) +

      // ── 4. Report Preferences ─────────────────────────────
      section('Report Preferences', 'fa-sliders-h', 'amber',
        '<div class="mb-4">' +
          '<label class="block text-xs font-semibold text-gray-500 mb-1">Company Type</label>' +
          '<select id="company_type" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400" onchange="markDirty(\'prefs\')">' +
            '<option value="roofing"' + (profile.company_type === 'roofing' ? ' selected' : '') + '>Roofing Company</option>' +
            '<option value="solar"'  + (profile.company_type === 'solar'   ? ' selected' : '') + '>Solar Sales Company</option>' +
          '</select>' +
        '</div>' +
        '<div id="solarWattRow" class="mb-4"' + (profile.company_type !== 'solar' ? ' style="display:none"' : '') + '>' +
          '<label class="block text-xs font-semibold text-gray-500 mb-1">Default Solar Panel Wattage (W)</label>' +
          '<input type="number" id="solar_panel_wattage_w" value="' + (profile.solar_panel_wattage_w || 400) + '" min="100" max="700" class="w-40 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400" oninput="markDirty(\'prefs\')">' +
        '</div>',
        'prefs'
      ) +

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

    // Wire company-type toggle
    document.getElementById('company_type').addEventListener('change', function () {
      document.getElementById('solarWattRow').style.display = this.value === 'solar' ? '' : 'none';
    });

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
  }

  // ── Section builder ───────────────────────────────────────
  function section(title, icon, color, body, sectionId) {
    var colorMap = {
      blue:   'text-blue-600',
      emerald:'text-emerald-600',
      violet: 'text-violet-600',
      amber:  'text-amber-600',
      red:    'text-red-600',
    };
    var btnColorMap = {
      blue:   'bg-blue-600 hover:bg-blue-700',
      emerald:'bg-emerald-600 hover:bg-emerald-700',
      violet: 'bg-violet-600 hover:bg-violet-700',
      amber:  'bg-amber-500 hover:bg-amber-600',
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
      stat('Status', status.charAt(0).toUpperCase() + status.slice(1), isActive ? 'text-green-600' : 'text-amber-600') +
      stat('Free Trials Left', free + '', 'text-blue-600') +
      stat('Paid Credits', paid + '', 'text-indigo-600') +
    '</div>' +
    '<div class="flex gap-3 flex-wrap">' +
      '<a href="/pricing" class="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-lg transition-colors"><i class="fas fa-coins mr-1"></i>Buy Credits</a>' +
      (profile.square_customer_id || profile.stripe_customer_id
        ? '<a href="/customer/billing" class="px-4 py-2 border border-gray-300 text-gray-600 text-sm font-semibold rounded-lg hover:bg-gray-50 transition-colors"><i class="fas fa-receipt mr-1"></i>Billing History</a>'
        : '') +
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
    var companyType = val('company_type');
    var wattage     = parseInt(val('solar_panel_wattage_w') || '400', 10);
    var res = await fetch('/api/customer/solar-settings', {
      method: 'PATCH', headers: hdrs(),
      body: JSON.stringify({ company_type: companyType, solar_panel_wattage_w: wattage })
    });
    if (!res.ok) throw new Error((await res.json()).error || 'Preferences save failed');
    // Update cached company type
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

  window.requestAccountDeletion = function () {
    if (!confirm('Are you absolutely sure? This will permanently delete your account and all data. This cannot be undone.')) return;
    var email = prompt('To confirm, type your email address:');
    if (!email || email.toLowerCase() !== (profile.email || '').toLowerCase()) {
      alert('Email did not match. Account deletion cancelled.');
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

})();

// ============================================================
// Customer Dashboard — 8-Module Navigation Hub
// Central hub after login: quick access to all BMS modules
// ============================================================

var custState = { loading: true, orders: [], billing: null, customer: null, crmStats: null, showAds: false, autoEmailEnabled: null, gcalEnabled: null };

var _chartInstances = { jobs: null, revenue: null, crew: null };

// Apply visual state to a custom-styled toggle (track color + knob position).
// Also syncs the hidden checkbox's .checked property.
function applyToggleVisual(id, checked) {
  var cb = document.getElementById(id);
  if (!cb) return;
  var label = cb.closest('label') || cb.parentElement;
  var track = label && label.querySelector('[data-toggle-track]');
  var knob  = label && label.querySelector('[data-toggle-knob]');
  var onColor = (id === 'gcal-sync-toggle') ? '#3b82f6' : '#10b981';
  var offColor = document.body.classList.contains('light-theme') ? '#c8d0d8' : '#374151';
  if (track) track.style.background = checked ? onColor : offColor;
  if (knob)  knob.style.transform   = checked ? 'translateX(20px)' : 'translateX(0)';
  cb.checked = checked;
}

// Set toggle value, persist to custState, and update visuals atomically.
function setToggle(id, val) {
  if (id === 'gcal-sync-toggle') custState.gcalEnabled = val;
  if (id === 'auto-email-toggle') custState.autoEmailEnabled = val;
  applyToggleVisual(id, val);
}

function getToken() { return localStorage.getItem('rc_customer_token') || ''; }
function authHeaders() { return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }; }

// No monthly memberships — users buy report credits after free trials

document.addEventListener('DOMContentLoaded', async function() {
  var params = new URLSearchParams(window.location.search);
  if (params.get('payment') === 'success') {
    try { await fetch('/api/square/verify-payment', { headers: authHeaders() }); } catch(e) {}
    window.history.replaceState({}, '', '/customer/dashboard');
  }
  await loadDashData();
  renderDashboard();
  // Show onboarding wizard for new customers
  if (custState.customer && !custState.customer.onboarding_completed) showOnboardingModal();
  // Check if material preferences have been configured
  checkMaterialSetup();
  // Initialize ads for non-subscribers after data is loaded
  if (window.RRAds) window.RRAds.init(custState.showAds, window.__rraPublisherId);
  // Auto-refresh when reports are generating
  startEnhancementPolling();
});

async function loadDashData() {
  custState.loading = true;
  try {
    var [profileRes, ordersRes, billingRes, crmCustRes, crmInvRes, crmPropRes, crmJobRes, secRes, teamRes, analyticsRes] = await Promise.all([
      fetch('/api/customer/me', { headers: authHeaders() }).catch(function() { return { ok: false }; }),
      fetch('/api/customer/orders', { headers: authHeaders() }).catch(function() { return { ok: false }; }),
      fetch('/api/square/billing', { headers: authHeaders() }).catch(function() { return { ok: false }; }),
      fetch('/api/crm/customers', { headers: authHeaders() }).catch(function() { return { ok: false }; }),
      fetch('/api/crm/invoices', { headers: authHeaders() }).catch(function() { return { ok: false }; }),
      fetch('/api/crm/proposals', { headers: authHeaders() }).catch(function() { return { ok: false }; }),
      fetch('/api/crm/jobs', { headers: authHeaders() }).catch(function() { return { ok: false }; }),
      fetch('/api/secretary/status', { headers: authHeaders() }).catch(function() { return { ok: false }; }),
      fetch('/api/team/members', { headers: authHeaders() }).catch(function() { return { ok: false }; }),
      fetch('/api/crm/analytics', { headers: authHeaders() }).catch(function() { return { ok: false }; })
    ]);
    if (profileRes.ok) {
      var pd = await profileRes.json();
      custState.customer = pd.customer;
      custState.showAds = pd.show_ads === true;
      localStorage.setItem('rc_customer', JSON.stringify(pd.customer));
    } else {
      localStorage.removeItem('rc_customer'); localStorage.removeItem('rc_customer_token'); localStorage.removeItem('rc_token');
      window.location.href = '/customer/login'; return;
    }
    if (ordersRes.ok) custState.orders = (await ordersRes.json()).orders || [];
    if (billingRes.ok) custState.billing = (await billingRes.json()).billing || null;

    var stats = { customers: 0, invoices_owing: 0, invoices_paid: 0, proposals_open: 0, proposals_sold: 0, jobs_total: 0, jobs_scheduled: 0, jobs_in_progress: 0 };
    if (crmCustRes.ok) { var d = await crmCustRes.json(); stats.customers = (d.stats && d.stats.total) || 0; }
    if (crmInvRes.ok) { var d2 = await crmInvRes.json(); stats.invoices_owing = (d2.stats && d2.stats.total_owing) || 0; stats.invoices_paid = (d2.stats && d2.stats.total_paid) || 0; }
    if (crmPropRes.ok) { var d3 = await crmPropRes.json(); stats.proposals_open = (d3.stats && d3.stats.open_count) || 0; stats.proposals_sold = (d3.stats && d3.stats.sold_count) || 0; }
    if (crmJobRes.ok) { var d4 = await crmJobRes.json(); stats.jobs_total = (d4.stats && d4.stats.total) || 0; stats.jobs_scheduled = (d4.stats && d4.stats.scheduled) || 0; stats.jobs_in_progress = (d4.stats && d4.stats.in_progress) || 0; }
    custState.crmStats = stats;
    // Analytics data
    custState.analytics = null;
    if (analyticsRes.ok) { custState.analytics = await analyticsRes.json(); }
    // Secretary status
    custState.secretaryActive = false;
    custState.secretaryCalls = 0;
    if (secRes.ok) { var secData = await secRes.json(); custState.secretaryActive = secData.has_active_subscription; custState.secretaryCalls = secData.total_calls || 0; }
    // Team members data
    custState.teamMembers = 0;
    custState.isTeamMember = false;
    custState.teamOwnerName = '';
    custState.teamOwnerCompany = '';
    custState.teamRole = '';
    if (teamRes.ok) { var teamData = await teamRes.json(); custState.teamMembers = (teamData.billing && teamData.billing.active_seats) || (teamData.members || []).length; custState.isTeamMember = teamData.is_team_member || false; }
    // Also pull team info from customer profile
    if (custState.customer) {
      custState.isTeamMember = custState.customer.is_team_member || false;
      custState.teamOwnerName = custState.customer.team_owner_name || '';
      custState.teamOwnerCompany = custState.customer.team_owner_company || '';
      custState.teamRole = custState.customer.team_role || '';
    }
  } catch(e) { console.error('Dashboard load error:', e); }
  custState.loading = false;
}

// Builds just the order-status badge pills shown in the dashboard header.
// Called on initial render and during polling so only this small fragment
// is ever replaced — charts, calendar, and toggles are never touched.
function buildOrderBadgesHTML() {
  var c = custState.customer || {};
  var freeTrialRemaining = c.free_trial_remaining || 0;
  var paidCredits = c.paid_credits_remaining || 0;
  var completedReports = custState.orders.filter(function(o) { return o.status === 'completed'; }).length;
  var processingReports = custState.orders.filter(function(o) { return o.status === 'processing'; }).length;
  return (freeTrialRemaining > 0 ? '<div class="px-3 py-1.5 bg-blue-500/10 border border-blue-200 rounded-full text-xs font-bold text-blue-700"><i class="fas fa-gift mr-1"></i>' + freeTrialRemaining + ' Free Trial</div>' : '') +
    (paidCredits > 0 ? '<div class="px-3 py-1.5 bg-blue-500/10 border border-blue-200 rounded-full text-xs font-bold text-blue-700"><i class="fas fa-coins mr-1"></i>' + paidCredits + ' Credits</div>' : '') +
    '<a href="/customer/reports" class="px-3 py-1.5 rounded-full text-xs font-bold inline-flex items-center hover:opacity-80 transition-opacity" style="background:var(--bg-elevated);border:1px solid var(--border-color);color:var(--text-secondary);text-decoration:none"><i class="fas fa-file-alt mr-1"></i>' + completedReports + ' Reports</a>' +
    (processingReports > 0 ? '<div class="px-3 py-1.5 bg-blue-500/10 border border-blue-200 rounded-full text-xs font-bold text-blue-700 animate-pulse"><i class="fas fa-spinner fa-spin mr-1"></i>' + processingReports + ' Generating</div>' : '');
}

function renderDashboard() {
  var root = document.getElementById('customer-root');
  if (!root) return;
  if (custState.loading) {
    root.innerHTML = '<div class="flex items-center justify-center py-20"><div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-brand-500"></div><span class="ml-4 text-gray-500 text-lg">Loading dashboard...</span></div>';
    return;
  }

  var c = custState.customer || {};

  var isSolar = c.company_type === 'solar';
  var b = custState.billing || {};
  var s = custState.crmStats || {};
  var freeTrialRemaining = c.free_trial_remaining || 0;
  var paidCredits = c.paid_credits_remaining || 0;
  var completedReports = custState.orders.filter(function(o) { return o.status === 'completed'; }).length;
  var processingReports = custState.orders.filter(function(o) { return o.status === 'processing'; }).length;
  var enhancingReports = 0;
  var trialsExhausted = freeTrialRemaining <= 0 && paidCredits <= 0;

  // Helper: nav link
  function navLink(href, icon, label, badge, badgeColor) {
    var bc = badgeColor || 'bg-gray-400';
    return '<a href="' + href + '" class="flex items-center justify-between px-3 py-2 rounded-lg transition-colors group" style="color:var(--text-secondary)">' +
      '<span class="flex items-center gap-2.5">' +
        '<i class="fas ' + icon + ' text-gray-400 group-hover:text-emerald-400 w-4 text-center text-sm transition-colors"></i>' +
        '<span class="text-sm font-medium">' + label + '</span>' +
      '</span>' +
      (badge ? '<span class="px-1.5 py-0.5 ' + bc + ' text-white rounded-full text-[10px] font-bold leading-none">' + badge + '</span>' : '') +
    '</a>';
  }

  // Sidebar nav sections
  var creditBadge = freeTrialRemaining > 0 ? freeTrialRemaining + ' free' : (paidCredits > 0 ? paidCredits : '');
  var creditBadgeColor = 'bg-blue-600';
  var invBadge = s.invoices_owing > 0 ? '$' + Number(s.invoices_owing).toFixed(0) : '';
  var propBadge = s.proposals_open > 0 ? s.proposals_open + '' : '';
  var jobBadge = s.jobs_in_progress > 0 ? s.jobs_in_progress + ' active' : (s.jobs_total > 0 ? s.jobs_total + '' : '');
  var teamBadge = custState.teamMembers > 0 ? custState.teamMembers + '' : '';
  var secBadge = custState.secretaryActive ? (custState.secretaryCalls > 0 ? custState.secretaryCalls + '' : 'Active') : '';
  var secBadgeColor = custState.secretaryActive ? 'bg-blue-600' : '';

  // --- NEW SIMPLIFIED SIDEBAR (6 sections) ---
  var leadsBadge = '<span id="leads-unread-badge"></span>';

  var sidebar =
    '<aside class="hidden lg:flex flex-col w-56 flex-shrink-0 min-h-full" style="position:relative;background:var(--bg-card);border-right:1px solid var(--border-color)">' +
      // Brand
      '<div class="px-4 py-5" style="border-bottom:1px solid var(--border-color)">' +
        '<div class="flex items-center gap-2">' +
          (c.google_avatar
            ? '<img src="' + c.google_avatar + '" class="w-8 h-8 rounded-full border border-white/10" alt="">'
            : '<div class="w-8 h-8 bg-gradient-to-br from-brand-500 to-brand-700 rounded-full flex items-center justify-center"><i class="fas fa-user text-white text-xs"></i></div>') +
          '<div class="min-w-0">' +
            '<p class="text-sm font-bold truncate" style="color:var(--text-primary)">' + (c.name || 'User') + '</p>' +
            '<p class="text-xs truncate" style="color:var(--text-muted)">' + (c.company_name || c.email || '') + '</p>' +
          '</div>' +
        '</div>' +
      '</div>' +
      // Nav
      '<nav class="flex-1 px-3 py-4 space-y-1 overflow-y-auto">' +
        (isSolar ? navLink('/customer/design-builder', 'fa-drafting-compass', 'Design Builder', null, 'bg-amber-600') : '') +
        navLink('/customer/dashboard', 'fa-th-large', 'Home', null, '') +
        // Section 1 — Report Tools
        '<div class="px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-wider" style="color:var(--text-muted)">Report Tools</div>' +
        navLink('/customer/order', 'fa-plus-circle', isSolar ? 'Order Solar Proposal' : 'Order Report', creditBadge || null, creditBadgeColor) +
        navLink('/customer/reports', 'fa-file-alt', 'Report History', null, '') +
        // Section 2 — AI Secretary
        '<div class="px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-wider" style="color:var(--text-muted)">AI Secretary</div>' +
        navLink('/customer/secretary', 'fa-headset', 'Roofer Secretary AI', secBadge || null, secBadgeColor || 'bg-blue-600') +
        // Section 3 — Billing Tools
        '<div class="px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-wider" style="color:var(--text-muted)">Billing Tools</div>' +
        navLink('/customer/proposals', 'fa-file-signature', 'Proposals', propBadge || null, 'bg-blue-600') +
        navLink('/customer/invoices', 'fa-file-invoice-dollar', 'Invoice Builder', invBadge || null, 'bg-blue-600') +
        navLink('/customer/customers', 'fa-users', 'Customers', s.customers > 0 ? s.customers + '' : null, 'bg-gray-800') +
        // Section 3 — Team Management & Business Tools
        '<div class="px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-wider" style="color:var(--text-muted)">Team & Business</div>' +
        // Leads (unified inbox)
        '<a href="/customer/leads" class="flex items-center justify-between px-3 py-2 rounded-lg transition-colors group" style="color:var(--text-secondary);background:linear-gradient(135deg,rgba(16,185,129,0.1),rgba(16,185,129,0.05))">' +
          '<span class="flex items-center gap-2.5">' +
            '<i class="fas fa-inbox text-emerald-400 w-4 text-center text-sm"></i>' +
            '<span class="text-sm font-semibold text-emerald-400">Leads</span>' +
          '</span>' +
          leadsBadge +
        '</a>' +
        navLink('/customer/pipeline', 'fa-funnel-dollar', 'Pipeline', null, 'bg-gray-800') +
        navLink('/customer/jobs', 'fa-hard-hat', 'Jobs & Crew Manager', jobBadge || null, 'bg-gray-800') +
        navLink('/customer/d2d', 'fa-door-open', 'D2D Manager', null, '') +
        navLink('/customer/storm-scout', 'fa-cloud-bolt', 'Storm Alerts', null, '') +
        navLink('/customer/certificate-automations', 'fa-robot', 'Automations', null, 'bg-emerald-600') +
        navLink('/customer/commissions', 'fa-dollar-sign', 'Commissions', null, 'bg-emerald-600') +
        navLink('/customer/suppliers', 'fa-store', 'Suppliers', null, '') +
        navLink('/customer/catalog', 'fa-box-open', 'Catalog', null, '') +
        navLink('/customer/referrals', 'fa-gift', 'Referrals', null, '') +
      '</nav>' +
      // Settings gear button
      '<div class="px-4 py-3 flex items-center" style="border-top:1px solid var(--border-color)">' +
        '<button onclick="window._toggleSettingsPopover(event)" id="settings-gear-btn" class="w-8 h-8 rounded-full flex items-center justify-center transition-colors" style="color:var(--text-muted);background:var(--bg-elevated)" title="Settings">' +
          '<i class="fas fa-cog text-sm"></i>' +
        '</button>' +
      '</div>' +
      // Settings popover (hidden by default)
      '<div id="settings-popover" style="display:none;position:absolute;bottom:60px;left:12px;z-index:9999;width:240px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,0.4);overflow:hidden">' +
        '<div style="padding:6px 0">' +
          '<a href="/customer/profile" class="flex items-center gap-3 px-4 py-2.5 transition-colors" style="color:var(--text-secondary);text-decoration:none" onmouseover="this.style.background=\'var(--bg-elevated)\'" onmouseout="this.style.background=\'transparent\'">' +
            '<i class="fas fa-user-cog w-4 text-center text-sm" style="color:var(--text-muted)"></i>' +
            '<span class="text-sm">Profile & Billing</span>' +
          '</a>' +
          '<a href="/customer/team" class="flex items-center gap-3 px-4 py-2.5 transition-colors" style="color:var(--text-secondary);text-decoration:none" onmouseover="this.style.background=\'var(--bg-elevated)\'" onmouseout="this.style.background=\'transparent\'">' +
            '<i class="fas fa-users-cog w-4 text-center text-sm" style="color:var(--text-muted)"></i>' +
            '<span class="text-sm">Team</span>' +
            (teamBadge ? '<span class="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-gray-800 text-white">' + teamBadge + '</span>' : '') +
          '</a>' +
          '<a href="/customer/integrations" class="flex items-center gap-3 px-4 py-2.5 transition-colors" style="color:var(--text-secondary);text-decoration:none" onmouseover="this.style.background=\'var(--bg-elevated)\'" onmouseout="this.style.background=\'transparent\'">' +
            '<i class="fas fa-plug w-4 text-center text-sm" style="color:var(--text-muted)"></i>' +
            '<span class="text-sm">API Connections</span>' +
          '</a>' +
          '<a href="/customer/secretary" class="flex items-center gap-3 px-4 py-2.5 transition-colors" style="color:var(--text-secondary);text-decoration:none" onmouseover="this.style.background=\'var(--bg-elevated)\'" onmouseout="this.style.background=\'transparent\'">' +
            '<i class="fas fa-headset w-4 text-center text-sm" style="color:var(--text-muted)"></i>' +
            '<span class="text-sm">Secretary</span>' +
            (secBadge ? '<span class="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full ' + secBadgeColor + ' text-white">' + secBadge + '</span>' : '') +
          '</a>' +
          '<a href="/customer/d2d" class="flex items-center gap-3 px-4 py-2.5 transition-colors" style="color:var(--text-secondary);text-decoration:none" onmouseover="this.style.background=\'var(--bg-elevated)\'" onmouseout="this.style.background=\'transparent\'">' +
            '<i class="fas fa-door-open w-4 text-center text-sm" style="color:var(--text-muted)"></i>' +
            '<span class="text-sm">D2D Manager</span>' +
          '</a>' +
          '<div style="height:1px;background:var(--border-color);margin:4px 0"></div>' +
          '<button onclick="window._toggleTheme();window._toggleSettingsPopover(event)" class="flex items-center gap-3 px-4 py-2.5 w-full border-0 cursor-pointer transition-colors" style="color:var(--text-secondary);background:transparent" onmouseover="this.style.background=\'var(--bg-elevated)\'" onmouseout="this.style.background=\'transparent\'">' +
            '<i class="fas ' + (localStorage.getItem('rc_dashboard_theme') === 'light' ? 'fa-moon' : 'fa-sun') + ' w-4 text-center text-sm" style="color:var(--text-muted)"></i>' +
            '<span class="text-sm">Theme</span>' +
            '<span class="ml-auto text-xs" style="color:var(--text-muted)">' + (localStorage.getItem('rc_dashboard_theme') === 'light' ? 'Light' : 'Dark') + '</span>' +
          '</button>' +
          '<div style="height:1px;background:var(--border-color);margin:4px 0"></div>' +
          '<a href="javascript:void(0)" onclick="custLogout()" class="flex items-center gap-3 px-4 py-2.5 transition-colors" style="color:var(--text-secondary);text-decoration:none" onmouseover="this.style.background=\'var(--bg-elevated)\'" onmouseout="this.style.background=\'transparent\'">' +
            '<i class="fas fa-sign-out-alt w-4 text-center text-sm" style="color:var(--text-muted)"></i>' +
            '<span class="text-sm">Sign out</span>' +
          '</a>' +
        '</div>' +
      '</div>' +
      // Credits footer
      '<div class="px-4 py-4" style="border-top:1px solid var(--border-color)">' +
        (freeTrialRemaining > 0
          ? '<div class="flex items-center justify-between mb-2"><span class="text-xs" style="color:var(--text-muted)">Free trials left</span><span class="text-xs font-bold text-emerald-400">' + freeTrialRemaining + '</span></div>'
          : '') +
        (paidCredits > 0
          ? '<div class="flex items-center justify-between mb-2"><span class="text-xs" style="color:var(--text-muted)">Report credits</span><span class="text-xs font-bold text-blue-400">' + paidCredits + '</span></div>'
          : '') +
        '<a href="/customer/buy-reports" class="block w-full text-center py-2 bg-emerald-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-lg transition-colors">Buy Reports</a>' +
        // Sidebar ad unit — shown only to non-subscribers
        '<div class="rra-ad-container" data-ad-slot="" data-ad-format="auto" style="display:none; margin-top:12px; min-height:120px; background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; padding:4px;"></div>' +
      '</div>' +
    '</aside>';

  // Mobile horizontal nav — matches desktop sidebar feature set so mobile users
  // can reach AI Secretary, D2D Manager, Storm Alerts, Automations, Commissions,
  // Suppliers, Catalog, Referrals (previously hidden in the lg:flex sidebar)
  // AND a prominent Buy Reports CTA (previously only in the desktop credits footer).
  var mobileNav =
    '<div class="lg:hidden overflow-x-auto" style="background:var(--bg-card);border-bottom:1px solid var(--border-color)">' +
      '<div class="flex gap-1 px-3 py-2 whitespace-nowrap">' +
        '<a href="/customer/dashboard" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0" style="background:var(--bg-elevated);color:var(--text-secondary)"><i class="fas fa-th-large"></i>Home</a>' +
        // Buy Reports — prominent CTA (mirrors the desktop sidebar credits-footer button)
        '<a href="/customer/buy-reports" class="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-xs font-extrabold flex-shrink-0 shadow-md"><i class="fas fa-tag"></i>Buy Reports</a>' +
        '<a href="/customer/order" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0" style="background:var(--bg-elevated);color:var(--text-secondary)"><i class="fas fa-plus-circle"></i>Order</a>' +
        '<a href="/customer/reports" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0" style="background:var(--bg-elevated);color:var(--text-secondary)"><i class="fas fa-file-alt"></i>Reports</a>' +
        '<a href="/customer/leads" class="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-semibold flex-shrink-0"><i class="fas fa-inbox"></i>Leads<span id="mobile-leads-badge" class="ml-1"></span></a>' +
        '<a href="/customer/jobs" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0" style="background:var(--bg-elevated);color:var(--text-secondary)"><i class="fas fa-hard-hat"></i>Jobs</a>' +
        '<a href="/customer/secretary" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0" style="background:var(--bg-elevated);color:var(--text-secondary)"><i class="fas fa-headset"></i>AI Secretary</a>' +
        '<a href="/customer/d2d" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0" style="background:var(--bg-elevated);color:var(--text-secondary)"><i class="fas fa-door-open"></i>D2D Manager</a>' +
        '<a href="/customer/storm-scout" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0" style="background:var(--bg-elevated);color:var(--text-secondary)"><i class="fas fa-cloud-bolt"></i>Storm Alerts</a>' +
        '<a href="/customer/customers" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0" style="background:var(--bg-elevated);color:var(--text-secondary)"><i class="fas fa-users"></i>Customers</a>' +
        '<a href="/customer/invoices" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0" style="background:var(--bg-elevated);color:var(--text-secondary)"><i class="fas fa-file-invoice-dollar"></i>Invoices</a>' +
        '<a href="/customer/proposals" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0" style="background:var(--bg-elevated);color:var(--text-secondary)"><i class="fas fa-file-signature"></i>Proposals</a>' +
        '<a href="/customer/pipeline" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0" style="background:var(--bg-elevated);color:var(--text-secondary)"><i class="fas fa-funnel-dollar"></i>Pipeline</a>' +
        '<a href="/customer/certificate-automations" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0" style="background:var(--bg-elevated);color:var(--text-secondary)"><i class="fas fa-robot"></i>Automations</a>' +
        '<a href="/customer/commissions" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0" style="background:var(--bg-elevated);color:var(--text-secondary)"><i class="fas fa-dollar-sign"></i>Commissions</a>' +
        '<a href="/customer/suppliers" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0" style="background:var(--bg-elevated);color:var(--text-secondary)"><i class="fas fa-store"></i>Suppliers</a>' +
        '<a href="/customer/catalog" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0" style="background:var(--bg-elevated);color:var(--text-secondary)"><i class="fas fa-box-open"></i>Catalog</a>' +
        '<a href="/customer/referrals" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0" style="background:var(--bg-elevated);color:var(--text-secondary)"><i class="fas fa-gift"></i>Referrals</a>' +
        '<a href="/customer/profile" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0" style="background:var(--bg-elevated);color:var(--text-secondary)"><i class="fas fa-cog"></i>Settings</a>' +
      '</div>' +
    '</div>';

  // Main content area
  var mainContent =
    '<main class="flex-1 min-w-0 p-5 md:p-6 overflow-auto">' +
      // Mobile-only credits + Buy block — desktop has this in the sidebar credits footer;
      // without it, mobile users couldn't see their balance or purchase from the dashboard.
      '<div class="lg:hidden flex items-center gap-3 mb-4 px-4 py-3 rounded-xl" style="background:var(--bg-card);border:1px solid var(--border-color)">' +
        '<div class="flex-1 flex flex-col gap-0.5 min-w-0">' +
          (freeTrialRemaining > 0
            ? '<div class="flex items-center justify-between text-xs"><span style="color:var(--text-muted)">Free trials left</span><span class="font-bold text-emerald-400">' + freeTrialRemaining + '</span></div>'
            : '') +
          (paidCredits > 0
            ? '<div class="flex items-center justify-between text-xs"><span style="color:var(--text-muted)">Report credits</span><span class="font-bold text-blue-400">' + paidCredits + '</span></div>'
            : '') +
          (freeTrialRemaining <= 0 && paidCredits <= 0
            ? '<div class="text-xs" style="color:var(--text-muted)">No credits left &mdash; buy reports to keep generating measurements</div>'
            : '') +
        '</div>' +
        '<a href="/customer/buy-reports" class="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold rounded-lg text-xs shadow-md"><i class="fas fa-tag"></i>Buy Reports</a>' +
      '</div>' +
      // Welcome header
      '<div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-5">' +
        '<div>' +
          '<h2 class="text-xl font-bold" style="color:var(--text-primary)">' + (function() { var h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; })() + ', ' + (c.name || 'User') + '</h2>' +
          '<p class="text-sm mt-0.5" style="color:var(--text-muted)">' + (c.company_name ? c.company_name + ' &middot; ' : '') + (c.email || '') + '</p>' +
        '</div>' +
        '<div class="flex items-center gap-2 flex-wrap">' +
          '<button onclick="window._toggleTheme()" id="theme-toggle-btn" class="px-2 py-1.5 rounded-lg transition-colors" style="color:var(--text-muted)" title="Toggle theme">' +
            '<i class="fas ' + (localStorage.getItem('rc_dashboard_theme') === 'light' ? 'fa-moon' : 'fa-sun') + '"></i>' +
          '</button>' +
          '<span id="dash-order-badges">' + buildOrderBadgesHTML() + '</span>' +
        '</div>' +
      '</div>' +

      // Trial exhausted banner — prompt to buy credits (never shown to team members)
      (!custState.isTeamMember && trialsExhausted && paidCredits <= 0 ?
        '<div class="bg-gradient-to-r from-brand-800 to-brand-900 rounded-2xl p-5 mb-5 shadow-xl border border-brand-700">' +
          '<div class="flex flex-col sm:flex-row items-center gap-4">' +
            '<div class="w-12 h-12 bg-blue-500/15 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0"><i class="fas fa-tag text-white text-xl"></i></div>' +
            '<div class="flex-1 text-center sm:text-left">' +
              '<h3 class="text-white font-black text-base">Your Free Trial Reports Are Used Up!</h3>' +
              '<p class="text-brand-200 text-xs mt-1">Buy reports to keep generating measurements — from <strong class="text-white">$5.95/report</strong> in volume packs.</p>' +
            '</div>' +
            '<div class="flex gap-2 flex-shrink-0">' +
              '<a href="/customer/buy-reports" class="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-black rounded-xl shadow text-sm transition-colors"><i class="fas fa-tag mr-1.5"></i>Buy Reports</a>' +
            '</div>' +
          '</div>' +
        '</div>' : '') +

      // Team context banner
      (custState.isTeamMember ?
        '<div class="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-4 mb-5 shadow-lg border border-blue-500/30">' +
          '<div class="flex items-center gap-3">' +
            '<div class="w-10 h-10 bg-[#111111]/20 rounded-xl flex items-center justify-center flex-shrink-0 backdrop-blur"><i class="fas fa-users text-white"></i></div>' +
            '<div class="flex-1 min-w-0">' +
              '<div class="flex items-center gap-2">' +
                '<h3 class="text-white font-bold text-sm">Team Account Access</h3>' +
                '<span class="px-2 py-0.5 bg-[#111111]/20 rounded-full text-[10px] font-bold text-blue-100 uppercase">' + (custState.teamRole || 'member') + '</span>' +
              '</div>' +
              '<p class="text-blue-200 text-xs mt-0.5 truncate">Accessing <strong class="text-white">' + (custState.teamOwnerCompany || custState.teamOwnerName || 'Team') + '</strong>\u2019s account.</p>' +
            '</div>' +
            '<a href="/customer/team" class="px-3 py-1.5 bg-[#111111]/10 hover:bg-[#111111]/20 text-white rounded-lg text-xs font-semibold border border-white/20 flex-shrink-0"><i class="fas fa-users-cog mr-1"></i>Team</a>' +
          '</div>' +
        '</div>' : '') +

      // Material setup nudge (dismissed daily via localStorage)
      '<div id="material-setup-banner"></div>' +

      // Calendar + Quick Actions
      '<div class="grid grid-cols-1 lg:grid-cols-5 gap-5 mb-5">' +
        // Calendar (wider)
        '<div class="lg:col-span-3 rounded-2xl shadow-sm overflow-hidden flex flex-col" style="background:var(--bg-card);border:1px solid var(--border-color)" style="min-height:280px">' +
          '<div class="px-5 py-3 flex items-center justify-between" style="border-bottom:1px solid var(--border-color);background:var(--bg-elevated)">' +
            '<div class="flex items-center gap-2">' +
              '<i class="fas fa-calendar-alt text-blue-400"></i>' +
              '<h3 class="font-bold text-sm" style="color:var(--text-primary)">Calendar</h3>' +
            '</div>' +
            '<div class="flex items-center gap-3">' +
              '<div class="flex items-center gap-2">' +
                '<img src="https://www.gstatic.com/images/branding/product/1x/calendar_48dp.png" alt="" class="w-4 h-4">' +
                '<span class="text-xs" style="color:var(--text-muted)">Google Sync</span>' +
                '<label style="position:relative;display:inline-flex;align-items:center;cursor:pointer">' +
                  '<input type="checkbox" id="gcal-sync-toggle" style="opacity:0;position:absolute;width:0;height:0" onchange="setToggle(\'gcal-sync-toggle\',this.checked);window._toggleGcalSync(this.checked)">' +
                  '<span style="position:relative;display:inline-block;width:44px;height:24px;border-radius:12px;background:transparent">' +
                    '<span data-toggle-track style="position:absolute;inset:0;background:#374151;border-radius:12px;transition:background 0.22s;box-shadow:inset 0 1px 4px rgba(0,0,0,0.35)"></span>' +
                    '<span data-toggle-knob style="position:absolute;top:3px;left:3px;width:18px;height:18px;background:#ffffff;border-radius:50%;box-shadow:0 1px 5px rgba(0,0,0,0.35);transition:transform 0.22s cubic-bezier(.4,0,.2,1)"></span>' +
                  '</span>' +
                '</label>' +
              '</div>' +
              '<div class="flex items-center gap-1">' +
                '<button onclick="window._calNav(-1)" class="w-7 h-7 flex items-center justify-center rounded-lg text-xs" style="color:var(--text-muted)"><i class="fas fa-chevron-left"></i></button>' +
                '<button onclick="window._calNav(0)" class="px-2 py-1 rounded-lg text-xs font-medium" style="color:var(--text-secondary)">Today</button>' +
                '<button onclick="window._calNav(1)" class="w-7 h-7 flex items-center justify-center rounded-lg text-xs" style="color:var(--text-muted)"><i class="fas fa-chevron-right"></i></button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div id="dashboard-calendar" class="flex-1 p-4 overflow-y-auto"></div>' +
        '</div>' +
        // Quick Actions (narrower)
        '<div class="lg:col-span-2 rounded-2xl shadow-sm overflow-hidden" style="background:var(--bg-card);border:1px solid var(--border-color)">' +
          '<div class="px-5 py-4" style="border-bottom:1px solid var(--border-color)">' +
            '<h3 class="font-bold text-sm" style="color:var(--text-primary)"><i class="fas fa-bolt text-blue-400 mr-2"></i>Quick Actions</h3>' +
          '</div>' +
          '<div class="p-4 space-y-2.5">' +
            '<a href="/customer/order" class="flex items-center gap-3 p-3 bg-blue-500/10 hover:bg-blue-100 rounded-xl transition-colors">' +
              '<div class="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0"><i class="fas fa-plus text-white text-sm"></i></div>' +
              '<div><p class="font-semibold text-sm" style="color:var(--text-primary)">Order Roof Report</p><p class="text-xs" style="color:var(--text-muted)">' + (freeTrialRemaining > 0 ? freeTrialRemaining + ' free remaining' : (paidCredits > 0 ? paidCredits + ' credits' : 'Pay per report')) + '</p></div>' +
            '</a>' +
            (isSolar ? ('<a href="/customer/design-builder" class="flex items-center gap-3 p-3 bg-amber-500/10 hover:bg-amber-100 rounded-xl transition-colors">' +
              '<div class="w-9 h-9 bg-amber-500 rounded-lg flex items-center justify-center flex-shrink-0"><i class="fas fa-drafting-compass text-white text-sm"></i></div>' +
              '<div><p class="font-semibold text-sm" style="color:var(--text-primary)">Launch Design Builder</p><p class="text-xs" style="color:var(--text-muted)">Pick a report, design panels, export proposal</p></div>' +
            '</a>') : '') +
            '<a href="/customer/customers" class="flex items-center gap-3 p-3 rounded-xl transition-colors" style="background:var(--bg-elevated)">' +
              '<div class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style="background:var(--bg-card);border:1px solid var(--border-color)"><i class="fas fa-user-plus text-white text-sm"></i></div>' +
              '<div><p class="font-semibold text-sm" style="color:var(--text-primary)">Add Customer</p><p class="text-xs" style="color:var(--text-muted)">Build your CRM database</p></div>' +
            '</a>' +
            '<a href="/customer/invoices" class="flex items-center gap-3 p-3 rounded-xl transition-colors" style="background:var(--bg-elevated)">' +
              '<div class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style="background:var(--bg-card);border:1px solid var(--border-color)"><i class="fas fa-file-invoice-dollar text-white text-sm"></i></div>' +
              '<div><p class="font-semibold text-sm" style="color:var(--text-primary)">Create Invoice</p><p class="text-xs" style="color:var(--text-muted)">' + (s.invoices_owing > 0 ? '$' + Number(s.invoices_owing).toFixed(2) + ' outstanding' : 'Bill your customers') + '</p></div>' +
            '</a>' +
            '<a href="/customer/proposals" class="flex items-center gap-3 p-3 rounded-xl transition-colors" style="background:var(--bg-elevated)">' +
              '<div class="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0"><i class="fas fa-file-signature text-white text-sm"></i></div>' +
              '<div><p class="font-semibold text-sm" style="color:var(--text-primary)">New Proposal</p><p class="text-xs" style="color:var(--text-muted)">Professional roofing proposals</p></div>' +
            '</a>' +
            '<a href="/customer/buy-reports" class="flex items-center gap-3 p-3 rounded-xl transition-colors" style="background:var(--bg-elevated)">' +
              '<div class="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style="background:var(--bg-card);border:1px solid var(--border-color)"><i class="fas fa-coins text-white text-sm"></i></div>' +
              '<div><p class="font-semibold text-sm" style="color:var(--text-primary)">Buy Reports</p><p class="text-xs" style="color:var(--text-muted)">From $5.95/report CAD</p></div>' +
            '</a>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Analytics Charts
      '<div class="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5" id="analytics-section">' +
        // Jobs Completed Chart
        '<div class="rounded-2xl shadow-sm overflow-hidden" style="background:var(--bg-card);border:1px solid var(--border-color)">' +
          '<div class="px-5 py-3" style="border-bottom:1px solid var(--border-color)">' +
            '<h3 class="font-bold text-sm" style="color:var(--text-primary)"><i class="fas fa-briefcase text-emerald-400 mr-2"></i>Jobs Completed</h3>' +
          '</div>' +
          '<div class="p-4"><canvas id="chartJobs" height="180"></canvas></div>' +
          '<div id="jobsStats" class="px-4 pb-4 flex gap-2 flex-wrap"></div>' +
        '</div>' +
        // Revenue Chart
        '<div class="rounded-2xl shadow-sm overflow-hidden" style="background:var(--bg-card);border:1px solid var(--border-color)">' +
          '<div class="px-5 py-3" style="border-bottom:1px solid var(--border-color)">' +
            '<h3 class="font-bold text-sm" style="color:var(--text-primary)"><i class="fas fa-dollar-sign text-blue-400 mr-2"></i>Revenue</h3>' +
          '</div>' +
          '<div class="p-4"><canvas id="chartRevenue" height="180"></canvas></div>' +
          '<div id="revenueStats" class="px-4 pb-4 flex gap-2 flex-wrap"></div>' +
        '</div>' +
        // Crew Utilization Chart
        '<div class="rounded-2xl shadow-sm overflow-hidden" style="background:var(--bg-card);border:1px solid var(--border-color)">' +
          '<div class="px-5 py-3" style="border-bottom:1px solid var(--border-color)">' +
            '<h3 class="font-bold text-sm" style="color:var(--text-primary)"><i class="fas fa-users text-orange-400 mr-2"></i>Crew Hours <span class="text-[10px] text-gray-500 font-normal">(30 days)</span></h3>' +
          '</div>' +
          '<div class="p-4"><canvas id="chartCrew" height="180"></canvas></div>' +
          '<div id="crewStats" class="px-4 pb-4 flex gap-2 flex-wrap"></div>' +
        '</div>' +
      '</div>' +

      // Ad unit — shown only to non-subscribers via RRAds.init()
      '<div class="rra-ad-container" data-ad-slot="" data-ad-format="horizontal" style="display:none; margin-bottom:20px; text-align:center; min-height:90px; background:#f1f5f9; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; padding:4px;"></div>' +

      // Auto-Email Settings
      '<div class="rounded-2xl shadow-sm overflow-hidden mb-5" style="background:var(--bg-card);border:1px solid var(--border-color)">' +
        '<div class="px-5 py-4 flex items-center justify-between">' +
          '<div>' +
            '<p class="font-medium text-gray-100 text-sm"><i class="fas fa-envelope text-blue-400 mr-2"></i>Auto-email reports when ready</p>' +
            '<p class="text-xs text-gray-500 mt-0.5">Send completed reports automatically to ' + (c.email || '') + '</p>' +
          '</div>' +
          '<label style="position:relative;display:inline-flex;align-items:center;cursor:pointer">' +
            '<input type="checkbox" id="auto-email-toggle" style="opacity:0;position:absolute;width:0;height:0" onchange="setToggle(\'auto-email-toggle\',this.checked);toggleAutoEmail(this.checked)">' +
            '<span style="position:relative;display:inline-block;width:44px;height:24px;border-radius:12px;background:transparent">' +
              '<span data-toggle-track style="position:absolute;inset:0;background:#374151;border-radius:12px;transition:background 0.22s;box-shadow:inset 0 1px 4px rgba(0,0,0,0.35)"></span>' +
              '<span data-toggle-knob style="position:absolute;top:3px;left:3px;width:18px;height:18px;background:#ffffff;border-radius:50%;box-shadow:0 1px 5px rgba(0,0,0,0.35);transition:transform 0.22s cubic-bezier(.4,0,.2,1)"></span>' +
            '</span>' +
          '</label>' +
        '</div>' +
      '</div>' +

      '<div class="text-center py-4 text-xs" style="color:var(--text-muted)"><p>Powered by <strong>Roof Manager</strong> &middot; Antigravity Gemini Roof Measurement Suite</p></div>' +
    '</main>';

  root.innerHTML =
    mobileNav +
    '<div class="flex" style="min-height:calc(100vh - 53px)">' +
      sidebar +
      mainContent +
    '</div>';

  // Initialize analytics charts and calendar after DOM render
  setTimeout(function() { initAnalyticsCharts(); _calRender(); _calLoadEvents(); }, 150);
}

function initAnalyticsCharts() {
  var a = custState.analytics;
  if (!a || typeof Chart === 'undefined') return;

  var chartDefaults = {
    color: '#9ca3af',
    borderColor: 'rgba(255,255,255,0.05)',
    font: { family: 'system-ui, sans-serif', size: 11 }
  };

  // Month label formatter
  function fmtMonth(m) {
    if (!m) return '';
    var parts = m.split('-');
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[parseInt(parts[1]) - 1] || m;
  }

  // ── JOBS COMPLETED CHART ──
  var jobsCanvas = document.getElementById('chartJobs');
  if (jobsCanvas && a.jobs) {
    var jm = a.jobs.by_month || [];
    if (jm.length === 0) {
      jobsCanvas.parentElement.innerHTML = '<div class="text-center py-8"><i class="fas fa-briefcase text-2xl text-gray-400 mb-2 block"></i><p class="text-xs" style="color:var(--text-muted)">No completed jobs yet</p><p class="text-[10px] mt-1" style="color:var(--text-muted)">Jobs will appear here as you complete them</p></div>';
    } else {
      var jobsCtx = jobsCanvas.getContext('2d');
      var jobsGradient = jobsCtx.createLinearGradient(0, 0, 0, 180);
      jobsGradient.addColorStop(0, 'rgba(16, 185, 129, 0.7)');
      jobsGradient.addColorStop(1, 'rgba(16, 185, 129, 0.15)');

      if (_chartInstances.jobs) { _chartInstances.jobs.destroy(); _chartInstances.jobs = null; }
      _chartInstances.jobs = new Chart(jobsCanvas, {
        type: 'bar',
        data: {
          labels: jm.map(function(d) { return fmtMonth(d.month); }),
          datasets: [{
            label: 'Completed',
            data: jm.map(function(d) { return d.count; }),
            backgroundColor: jobsGradient,
            borderColor: 'rgba(16, 185, 129, 1)',
            borderWidth: 1,
            borderRadius: 8,
            borderSkipped: false,
            barPercentage: 0.6,
            categoryPercentage: 0.7
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: (function(){var l=document.body.classList.contains('light-theme');return{backgroundColor:l?'#ffffff':'#1f2937',titleColor:l?'#0B0F12':'#e5e7eb',bodyColor:l?'#5a6b74':'#9ca3af',borderColor:l?'#dde3e9':'rgba(255,255,255,0.1)',borderWidth:1,cornerRadius:8,padding:10};}()) },
          scales: {
            x: { ticks: chartDefaults, grid: { display: false }, border: { display: false } },
            y: { ticks: Object.assign({}, chartDefaults, { stepSize: 1 }), grid: { color: document.body.classList.contains('light-theme') ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.04)' }, beginAtZero: true, border: { display: false } }
          }
        }
      });
    }

    // Stats pills
    var jobsStatsEl = document.getElementById('jobsStats');
    if (jobsStatsEl) {
      var statusMap = {};
      (a.jobs.by_status || []).forEach(function(s) { statusMap[s.status] = s.count; });
      var totalJobs = Object.values(statusMap).reduce(function(s, v) { return s + v; }, 0);
      jobsStatsEl.innerHTML =
        '<span class="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 rounded-lg text-[11px] font-bold"><i class="fas fa-check-circle mr-1"></i>' + (statusMap.completed || 0) + ' Done</span>' +
        '<span class="px-2.5 py-1 bg-blue-500/10 text-blue-400 rounded-lg text-[11px] font-bold"><i class="fas fa-spinner mr-1"></i>' + (statusMap.in_progress || 0) + ' Active</span>' +
        '<span class="px-2.5 py-1 bg-cyan-500/10 text-cyan-400 rounded-lg text-[11px] font-bold"><i class="fas fa-clock mr-1"></i>' + (statusMap.scheduled || 0) + ' Upcoming</span>';
    }
  }

  // ── REVENUE CHART ──
  var revCanvas = document.getElementById('chartRevenue');
  if (revCanvas && a.revenue) {
    var rm = a.revenue.by_month || [];
    if (rm.length === 0) {
      revCanvas.parentElement.innerHTML = '<div class="text-center py-8"><i class="fas fa-dollar-sign text-2xl text-gray-400 mb-2 block"></i><p class="text-xs" style="color:var(--text-muted)">No revenue data yet</p><p class="text-[10px] mt-1" style="color:var(--text-muted)">Revenue will appear as invoices are paid</p></div>';
    } else {
      var ctx = revCanvas.getContext('2d');
      var gradient = ctx.createLinearGradient(0, 0, 0, 180);
      gradient.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
      gradient.addColorStop(1, 'rgba(59, 130, 246, 0.02)');

      if (_chartInstances.revenue) { _chartInstances.revenue.destroy(); _chartInstances.revenue = null; }
      _chartInstances.revenue = new Chart(revCanvas, {
        type: 'line',
        data: {
          labels: rm.map(function(d) { return fmtMonth(d.month); }),
          datasets: [{
            label: 'Revenue',
            data: rm.map(function(d) { return d.revenue || 0; }),
            borderColor: 'rgba(59, 130, 246, 1)',
            backgroundColor: gradient,
            fill: true,
            tension: 0.4,
            borderWidth: 2,
            pointRadius: 4,
            pointBackgroundColor: 'rgba(59, 130, 246, 1)',
            pointHoverRadius: 6,
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: 'rgba(59, 130, 246, 1)',
            pointHoverBorderWidth: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: (function(){var l=document.body.classList.contains('light-theme');return{backgroundColor:l?'#ffffff':'#1f2937',titleColor:l?'#0B0F12':'#e5e7eb',bodyColor:l?'#5a6b74':'#9ca3af',borderColor:l?'#dde3e9':'rgba(255,255,255,0.1)',borderWidth:1,cornerRadius:8,padding:10,callbacks:{label:function(ctx){return'$'+(ctx.parsed.y||0).toLocaleString();}}};}()) },
          scales: {
            x: { ticks: chartDefaults, grid: { display: false }, border: { display: false } },
            y: { ticks: Object.assign({}, chartDefaults, { callback: function(v) { return '$' + v.toLocaleString(); } }), grid: { color: document.body.classList.contains('light-theme') ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.04)' }, beginAtZero: true, border: { display: false } }
          }
        }
      });
    }

    // Stats pills
    var revStatsEl = document.getElementById('revenueStats');
    if (revStatsEl) {
      revStatsEl.innerHTML =
        '<span class="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 rounded-lg text-[11px] font-bold">$' + Number(a.revenue.total_paid || 0).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0}) + ' Paid</span>' +
        '<span class="px-2.5 py-1 bg-yellow-500/10 text-yellow-400 rounded-lg text-[11px] font-bold">$' + Number(a.revenue.total_owing || 0).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0}) + ' Owing</span>' +
        (a.revenue.total_overdue > 0 ? '<span class="px-2.5 py-1 bg-red-500/10 text-red-400 rounded-lg text-[11px] font-bold">$' + Number(a.revenue.total_overdue || 0).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 0}) + ' Overdue</span>' : '');
    }
  }

  // ── CREW UTILIZATION CHART ──
  var crewCanvas = document.getElementById('chartCrew');
  if (crewCanvas && a.crew) {
    var ch = a.crew.hours || [];
    if (ch.length === 0) {
      crewCanvas.parentElement.innerHTML = '<div class="text-center py-8"><i class="fas fa-users text-2xl text-gray-400 mb-2 block"></i><p class="text-xs" style="color:var(--text-muted)">No crew time logged yet</p></div>';
    } else {
      if (_chartInstances.crew) { _chartInstances.crew.destroy(); _chartInstances.crew = null; }
      _chartInstances.crew = new Chart(crewCanvas, {
        type: 'bar',
        data: {
          labels: ch.map(function(c) { return (c.name || 'Crew').split(' ')[0]; }),
          datasets: [{
            label: 'Hours',
            data: ch.map(function(c) { return Math.round((c.total_minutes || 0) / 60 * 10) / 10; }),
            backgroundColor: 'rgba(251, 146, 60, 0.6)',
            borderColor: 'rgba(251, 146, 60, 1)',
            borderWidth: 1,
            borderRadius: 6
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: Object.assign({}, chartDefaults, { callback: function(v) { return v + 'h'; } }), grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true },
            y: { ticks: chartDefaults, grid: { display: false } }
          }
        }
      });

      // Stats
      var crewStatsEl = document.getElementById('crewStats');
      if (crewStatsEl) {
        var totalMins = ch.reduce(function(s, c) { return s + (c.total_minutes || 0); }, 0);
        var totalJobs = ch.reduce(function(s, c) { return s + (c.jobs_worked || 0); }, 0);
        crewStatsEl.innerHTML =
          '<span class="px-2.5 py-1 bg-orange-500/10 text-orange-400 rounded-lg text-[11px] font-bold">' + Math.round(totalMins / 60) + 'h Total</span>' +
          '<span class="px-2.5 py-1 bg-orange-500/10 text-orange-400 rounded-lg text-[11px] font-bold">' + ch.length + ' Crew</span>' +
          '<span class="px-2.5 py-1 bg-orange-500/10 text-orange-400 rounded-lg text-[11px] font-bold">' + totalJobs + ' Jobs</span>';
      }
    }
  }
}

function renderRecentOrders() {
  var orders = custState.orders.slice(0, 5);
  var _custRaw = localStorage.getItem('rc_customer');
  var _isSolarCust = false;
  try { _isSolarCust = (_custRaw && JSON.parse(_custRaw).company_type === 'solar') || false; } catch(e) {}
  if (orders.length === 0) {
    return '<div class="text-center py-8">' +
      '<div class="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-3"><i class="fas fa-clipboard-list text-gray-400 text-lg"></i></div>' +
      '<p class="text-sm text-gray-500 mb-3">No reports yet</p>' +
      '<a href="/customer/order" class="text-sm font-semibold text-brand-600 hover:text-brand-700"><i class="fas fa-plus mr-1"></i>Order your first report</a></div>';
  }

  var html = '<div class="space-y-2">';
  for (var i = 0; i < orders.length; i++) {
    var o = orders[i];
    var isProcessing = o.status === 'processing' || o.report_status === 'generating' || o.report_status === 'pending';
    var statusClass = o.status === 'completed' ? 'bg-emerald-500/15 text-emerald-400' : (isProcessing ? 'bg-blue-500/15 text-blue-400' : 'bg-white/5 text-gray-400');
    var reportReady = (o.report_status === 'completed' || o.status === 'completed') && !isProcessing;
    html += '<div class="flex items-center justify-between p-3 bg-[#0A0A0A] rounded-xl hover:bg-[#111111]/10 transition-colors">' +
      '<div class="flex-1 min-w-0">' +
        '<p class="text-sm font-medium text-gray-100 truncate"><i class="fas fa-map-marker-alt text-red-400 mr-1.5 text-xs"></i>' + (o.property_address || 'Unknown') + '</p>' +
        '<p class="text-xs text-gray-500 mt-0.5">' + new Date(o.created_at).toLocaleDateString() + (o.roof_area_sqft ? ' &middot; ' + Math.round(o.roof_area_sqft) + ' sq ft' : '') + '</p>' +
      '</div>' +
      '<div class="flex items-center gap-2 ml-3">' +
        '<span class="px-2 py-0.5 ' + statusClass + ' rounded-full text-[10px] font-bold capitalize">' + (isProcessing ? '<i class="fas fa-spinner fa-spin mr-1"></i>' : '') + (isProcessing ? 'generating' : o.status) + '</span>' +
        (reportReady ? '<a href="/api/reports/' + o.id + '/html" target="_blank" class="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-brand-700"><i class="fas fa-eye mr-1"></i>View</a>' : '') +
        (reportReady ? '<a href="/customer/material-calculator?order_id=' + o.id + '" class="px-2.5 py-1 bg-sky-100 text-sky-700 rounded-lg text-xs font-medium hover:bg-sky-200"><i class="fas fa-calculator mr-1"></i>Materials</a>' : '') +
        (reportReady && _isSolarCust ? '<a href="/customer/solar-design?report_id=' + o.id + '" class="px-2.5 py-1 bg-amber-500 text-white rounded-lg text-xs font-medium hover:bg-amber-400"><i class="fas fa-solar-panel mr-1"></i>Design Panels</a>' : '') +
        (reportReady && _isSolarCust ? '<a href="/api/reports/' + o.id + '/proposal" target="_blank" class="px-2.5 py-1 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-lg text-xs font-medium hover:from-orange-400"><i class="fas fa-file-pdf mr-1"></i>Proposal</a>' : '') +
        (o.status === 'failed' ? '<button onclick="retryReport(' + o.id + ', this)" class="px-2.5 py-1 bg-red-500/15 text-red-400 rounded-lg text-xs font-medium hover:bg-red-200"><i class="fas fa-redo mr-1"></i>Retry</button>' : '') +
      '</div>' +
    '</div>';
  }
  html += '</div>';
  return html;
}

// Retry failed report generation
window.retryReport = function(orderId, btn) {
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Retrying...'; }
  fetch('/api/reports/' + orderId + '/retry', { method: 'POST', headers: { 'Authorization': 'Bearer ' + (localStorage.getItem('rc_customer_token') || ''), 'Content-Type': 'application/json' } })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        if (btn) { btn.innerHTML = '<i class="fas fa-check mr-1"></i>Regenerating!'; btn.className = 'px-2.5 py-1 bg-emerald-500/15 text-emerald-400 rounded-lg text-xs font-medium'; }
        setTimeout(function() { loadDashData().then(function() { renderDashboard(); startEnhancementPolling(); }).catch(function() { if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-redo mr-1"></i>Retry'; } }); }, 2000);
      } else {
        console.warn('Retry failed:', data.error || data.message || 'Unknown error');
        if (window.rmToast) window.rmToast('Retry failed: ' + (data.error || data.message || 'Unknown error'), 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-redo mr-1"></i>Retry'; }
      }
    })
    .catch(function() {
      console.warn('Retry failed');
      if (window.rmToast) window.rmToast('Retry failed (network error)', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-redo mr-1"></i>Retry'; }
    });
};

// ============================================================
// AUTO-POLLING: Refresh dashboard when reports are generating
// Polls every 3s for fast feedback. When a report completes, 
// shows a celebration toast and re-renders the dashboard.
// ============================================================
var _enhancePollTimer = null;
var _prevProcessingIds = [];
function startEnhancementPolling() {
  if (_enhancePollTimer) clearInterval(_enhancePollTimer);
  var hasActive = custState.orders.some(function(o) {
    return o.status === 'processing' || o.report_status === 'generating' || o.report_status === 'pending' || o.ai_imagery_status === 'generating';
  });
  // Track which orders are processing so we can detect completions
  _prevProcessingIds = custState.orders.filter(function(o) {
    return o.status === 'processing' || o.report_status === 'generating' || o.report_status === 'pending' || o.ai_imagery_status === 'generating';
  }).map(function(o) { return o.id; });

  if (!hasActive) return;
  console.log('[Dashboard] Reports generating — auto-refreshing every 3s');
  _enhancePollTimer = setInterval(async function() {
    try {
      var ordersRes = await fetch('/api/customer/orders', { headers: authHeaders() });
      if (ordersRes.ok) {
        var data = await ordersRes.json();
        custState.orders = data.orders || [];
        
        // Check if any previously-processing order is now complete
        var nowProcessingIds = custState.orders.filter(function(o) {
          return o.status === 'processing' || o.report_status === 'generating' || o.report_status === 'pending' || o.ai_imagery_status === 'generating';
        }).map(function(o) { return o.id; });
        
        var newlyCompleted = _prevProcessingIds.filter(function(id) { return nowProcessingIds.indexOf(id) === -1; });
        _prevProcessingIds = nowProcessingIds;

        // Show celebration toast for each newly completed report
        // AND trigger async enhancement + imagery in separate requests
        if (newlyCompleted.length > 0) {
          newlyCompleted.forEach(function(orderId) {
            var order = custState.orders.find(function(o) { return o.id === orderId; });
            showReportReadyToast(order);
          });
        }
        
        // Update only the status badge pills — never re-render charts/calendar/toggles
        var badgesEl = document.getElementById('dash-order-badges');
        if (badgesEl) badgesEl.innerHTML = buildOrderBadgesHTML();

        // Stop polling when all reports are done
        var stillActive = custState.orders.some(function(o) {
          return o.status === 'processing' || o.report_status === 'generating' || o.report_status === 'pending' || o.ai_imagery_status === 'generating';
        });
        if (!stillActive) {
          console.log('[Dashboard] All reports complete — stopping auto-refresh');
          clearInterval(_enhancePollTimer);
          _enhancePollTimer = null;
        }
      }
    } catch(e) { /* silent */ }
  }, 3000);
}

// ============================================================
// CELEBRATION TOAST — Slides in when a report completes
// ============================================================
function showReportReadyToast(order) {
  var address = (order && order.property_address) || 'Your property';
  var orderId = order ? order.id : '';
  var toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;max-width:380px;animation:slideInRight 0.4s ease-out';
  toast.innerHTML = 
    '<div style="background:linear-gradient(135deg,#059669,#10b981);border-radius:16px;padding:16px 20px;box-shadow:0 10px 30px rgba(5,150,105,0.4);border:1px solid rgba(255,255,255,0.2)">' +
      '<div style="display:flex;align-items:center;gap:12px">' +
        '<div style="width:40px;height:40px;background:rgba(255,255,255,0.2);border-radius:12px;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
          '<i class="fas fa-check-circle" style="color:white;font-size:20px"></i>' +
        '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<p style="color:white;font-weight:700;font-size:14px;margin:0">Report Ready!</p>' +
          '<p style="color:rgba(255,255,255,0.8);font-size:12px;margin:2px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + address + '</p>' +
        '</div>' +
        (orderId ? '<a href="/api/reports/' + orderId + '/html" target="_blank" style="background:#111111;color:#059669;padding:6px 14px;border-radius:10px;font-size:12px;font-weight:700;text-decoration:none;white-space:nowrap">View <i class="fas fa-arrow-right ml-1"></i></a>' : '') +
      '</div>' +
    '</div>';
  
  // Add animation styles if not already present
  if (!document.getElementById('toastAnimStyles')) {
    var s = document.createElement('style');
    s.id = 'toastAnimStyles';
    s.textContent = '@keyframes slideInRight{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}@keyframes slideOutRight{from{transform:translateX(0);opacity:1}to{transform:translateX(120%);opacity:0}}';
    document.head.appendChild(s);
  }
  
  document.body.appendChild(toast);
  
  // Remove after 8 seconds
  setTimeout(function() {
    toast.style.animation = 'slideOutRight 0.4s ease-in forwards';
    setTimeout(function() { toast.remove(); }, 500);
  }, 8000);
}

// ============================================================
// Auto-Email Toggle
// ============================================================
async function loadAutoEmailPref() {
  try {
    var res = await fetch('/api/agents/auto-email', { headers: authHeaders() });
    if (res.ok) {
      var data = await res.json();
      var enabled = !!data.auto_email_reports;
      custState.autoEmailEnabled = enabled;
      applyToggleVisual('auto-email-toggle', enabled);
    }
  } catch(e) {}
}

async function toggleAutoEmail(enabled) {
  try {
    await fetch('/api/agents/auto-email', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ enabled: enabled })
    });
  } catch(e) {}
}

// ============================================================
// ASYNC ENHANCEMENT & IMAGERY — Triggered after base report completes
// Each runs in its own HTTP request to stay within Cloudflare's
// 30-second timeout. Enhancement first, then imagery.
// ============================================================
var _enhancedOrderIds = {};
async function triggerAsyncEnhancement(orderId) {
  if (_enhancedOrderIds[orderId]) return;
  _enhancedOrderIds[orderId] = true;
  try {
    console.log('[Dashboard] Triggering async enhancement for order', orderId);
    var res = await fetch('/api/reports/' + orderId + '/enhance-async', {
      method: 'POST', headers: authHeaders()
    });
    var data = await res.json();
    console.log('[Dashboard] Enhancement result:', data);
    // After enhancement, trigger AI imagery in a separate request
    if (data.success || data.already_enhanced) {
      triggerAsyncImagery(orderId);
    }
  } catch(e) {
    console.warn('[Dashboard] Enhancement trigger failed:', e.message);
  }
}

async function triggerAsyncImagery(orderId) {
  try {
    console.log('[Dashboard] Triggering AI imagery for order', orderId);
    var res = await fetch('/api/reports/' + orderId + '/generate-imagery', {
      method: 'POST', headers: authHeaders()
    });
    var data = await res.json();
    console.log('[Dashboard] Imagery result:', data);
  } catch(e) {
    console.warn('[Dashboard] Imagery trigger failed:', e.message);
  }
}

// Load auto-email preference after dashboard renders
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(loadAutoEmailPref, 500);
});

// ============================================================
// ONBOARDING WIZARD — shown once to new customers
// ============================================================
function showOnboardingModal() {
  var name = (custState.customer && custState.customer.name) ? custState.customer.name.split(' ')[0] : 'there';
  var freeCredits = (custState.customer && custState.customer.free_trial_remaining) || 3;

  var overlay = document.createElement('div');
  overlay.id = 'onboarding-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';

  var steps = [
    {
      icon: 'fa-hand-wave',
      color: 'from-brand-500 to-sky-500',
      title: 'Welcome to Roof Manager, ' + name + '!',
      content: '<div class="space-y-3">' +
        '<div class="bg-emerald-500/10 border border-green-200 rounded-xl p-4 text-center">' +
          '<p class="text-3xl font-black text-green-700 mb-1">' + freeCredits + ' Free Reports</p>' +
          '<p class="text-sm text-emerald-400">No credit card needed — start measuring roofs right now</p>' +
        '</div>' +
        '<div class="grid grid-cols-3 gap-3 text-center text-xs">' +
          '<div class="bg-[#0A0A0A] rounded-xl p-3"><i class="fas fa-satellite text-emerald-400 text-xl mb-1 block"></i><p class="font-semibold text-gray-300">Satellite Measurement</p></div>' +
          '<div class="bg-[#0A0A0A] rounded-xl p-3"><i class="fas fa-boxes-stacked text-emerald-500 text-xl mb-1 block"></i><p class="font-semibold text-gray-300">Full Material BOM</p></div>' +
          '<div class="bg-[#0A0A0A] rounded-xl p-3"><i class="fas fa-file-invoice text-blue-400 text-xl mb-1 block"></i><p class="font-semibold text-gray-300">Instant Proposals</p></div>' +
        '</div>' +
      '</div>'
    },
    {
      icon: 'fa-rocket',
      color: 'from-emerald-500 to-emerald-600',
      title: 'Order Your First Report',
      content: '<div class="space-y-4">' +
        '<div class="bg-sky-50 border border-sky-200 rounded-xl p-4">' +
          '<p class="text-sm text-sky-800 font-medium mb-3">Here\'s how it works:</p>' +
          '<div class="space-y-2 text-sm text-sky-700">' +
            '<div class="flex items-center gap-2"><span class="w-6 h-6 bg-sky-500 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">1</span><span>Enter the property address</span></div>' +
            '<div class="flex items-center gap-2"><span class="w-6 h-6 bg-sky-500 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">2</span><span>AI analyzes satellite imagery</span></div>' +
            '<div class="flex items-center gap-2"><span class="w-6 h-6 bg-sky-500 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">3</span><span>Full report ready in ~60 seconds</span></div>' +
          '</div>' +
        '</div>' +
        '<a href="/customer/order" onclick="dismissOnboarding()" class="block w-full py-3 text-center bg-emerald-600 hover:bg-brand-700 text-white font-bold rounded-xl transition-colors">' +
          '<i class="fas fa-plus mr-2"></i>Order My First Report (Free)' +
        '</a>' +
      '</div>'
    },
    {
      icon: 'fa-toolbox',
      color: 'from-blue-600 to-blue-700',
      title: 'Explore Your Tools',
      content: '<div class="space-y-3">' +
        '<p class="text-sm text-gray-400">Your dashboard has everything you need to run your roofing business:</p>' +
        '<div class="grid grid-cols-2 gap-2">' +
          '<a href="/customer/reports" onclick="dismissOnboarding()" class="bg-brand-50 border border-brand-200 rounded-xl p-3 text-center hover:bg-brand-100 transition-colors"><i class="fas fa-file-alt text-emerald-400 text-lg mb-1 block"></i><p class="text-xs font-semibold text-brand-700">Reports</p></a>' +
          '<a href="/customer/proposals" onclick="dismissOnboarding()" class="bg-blue-500/15/10 border border-white/15 rounded-xl p-3 text-center hover:bg-white/10 transition-colors"><i class="fas fa-file-invoice text-gray-400 text-lg mb-1 block"></i><p class="text-xs font-semibold text-gray-400">Proposals</p></a>' +
          '<a href="/customer/customers" onclick="dismissOnboarding()" class="bg-blue-500/15 border border-blue-500/20 rounded-xl p-3 text-center hover:bg-blue-500/15 transition-colors"><i class="fas fa-users text-blue-400 text-lg mb-1 block"></i><p class="text-xs font-semibold text-blue-400">Customers</p></a>' +
          '<a href="/customer/material-calculator" onclick="dismissOnboarding()" class="bg-sky-50 border border-sky-200 rounded-xl p-3 text-center hover:bg-sky-100 transition-colors"><i class="fas fa-calculator text-sky-500 text-lg mb-1 block"></i><p class="text-xs font-semibold text-sky-700">Material Calc</p></a>' +
        '</div>' +
      '</div>'
    }
  ];

  var currentStep = 0;

  function renderStep() {
    var s = steps[currentStep];
    var isLast = currentStep === steps.length - 1;
    overlay.innerHTML = '<div style="background:#fff;border-radius:20px;width:100%;max-width:460px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.3)">' +
      '<div style="background:linear-gradient(135deg,#0369a1,#0ea5e9);padding:24px;text-align:center;color:#fff">' +
        '<i class="fas ' + s.icon + '" style="font-size:28px;margin-bottom:8px;display:block"></i>' +
        '<h2 style="font-size:18px;font-weight:700;margin:0">' + s.title + '</h2>' +
        '<div style="display:flex;justify-content:center;gap:6px;margin-top:12px">' +
          steps.map(function(_, i) {
            return '<div style="width:8px;height:8px;border-radius:50%;background:' + (i === currentStep ? '#fff' : 'rgba(255,255,255,0.4)') + '"></div>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div style="padding:20px">' + s.content + '</div>' +
      '<div style="padding:16px;border-top:1px solid #e5e7eb;display:flex;gap:10px;justify-content:' + (currentStep === 0 ? 'flex-end' : 'space-between') + '">' +
        (currentStep > 0 ? '<button onclick="window._onboardingPrev()" style="padding:10px 20px;background:#f3f4f6;color:#374151;border:none;border-radius:10px;font-weight:600;cursor:pointer;font-size:13px">Back</button>' : '') +
        '<div style="display:flex;gap:8px">' +
          '<button onclick="dismissOnboarding()" style="padding:10px 16px;background:transparent;color:#9ca3af;border:none;cursor:pointer;font-size:13px">Skip</button>' +
          (isLast
            ? '<button onclick="dismissOnboarding()" style="padding:10px 20px;background:#0369a1;color:#fff;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-size:13px"><i class="fas fa-check mr-1"></i>Get Started!</button>'
            : '<button onclick="window._onboardingNext()" style="padding:10px 20px;background:#0369a1;color:#fff;border:none;border-radius:10px;font-weight:700;cursor:pointer;font-size:13px">Next <i class="fas fa-arrow-right ml-1"></i></button>') +
        '</div>' +
      '</div>' +
    '</div>';
  }

  window._onboardingNext = function() {
    if (currentStep < steps.length - 1) { currentStep++; renderStep(); }
  };
  window._onboardingPrev = function() {
    if (currentStep > 0) { currentStep--; renderStep(); }
  };

  renderStep();
  document.body.appendChild(overlay);
}

function dismissOnboarding() {
  var overlay = document.getElementById('onboarding-overlay');
  if (overlay) overlay.remove();
  // Mark complete in DB
  fetch('/api/customer/onboarding/complete', { method: 'POST', headers: authHeaders() }).catch(function() {});
  // Update localStorage
  var cust = JSON.parse(localStorage.getItem('rc_customer') || '{}');
  cust.onboarding_completed = 1;
  localStorage.setItem('rc_customer', JSON.stringify(cust));
}

// ---- Dashboard Calendar ----
var _calCurrentDate = new Date();
var _calViewMonth = new Date(_calCurrentDate.getFullYear(), _calCurrentDate.getMonth(), 1);
var _calEvents = []; // { date: 'YYYY-MM-DD', title: string, color: string }

// Load events from jobs/orders + CRM jobs
function _calLoadEvents() {
  _calEvents = [];
  var orders = (custState && custState.orders) || [];
  orders.forEach(function(o) {
    if (o.created_at) {
      var d = o.created_at.substring(0, 10);
      _calEvents.push({ date: d, title: 'Report: ' + (o.property_address || o.address || 'Order').substring(0, 25), color: 'blue' });
    }
  });
  // Load CRM jobs into calendar
  var token = localStorage.getItem('rc_customer_token') || '';
  fetch('/api/crm/jobs', { headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } })
    .then(function(r) { return r.ok ? r.json() : { jobs: [] }; })
    .then(function(data) {
      var jobs = data.jobs || [];
      jobs.forEach(function(j) {
        var d = (j.scheduled_date || j.created_at || '').substring(0, 10);
        if (!d) return;
        var colorMap = { scheduled: 'cyan', in_progress: 'yellow', completed: 'emerald', cancelled: 'red' };
        _calEvents.push({
          date: d,
          title: (j.title || 'Job ' + (j.job_number || '')).substring(0, 30),
          color: colorMap[j.status] || 'gray'
        });
      });
      _calRender();
    })
    .catch(function() {});
  // Check Google Calendar connection status from server
  _gcalCheckStatus();
}

function _calRender() {
  var container = document.getElementById('dashboard-calendar');
  if (!container) return;

  var year = _calViewMonth.getFullYear();
  var month = _calViewMonth.getMonth();
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var today = new Date();
  var todayStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');

  var firstDay = new Date(year, month, 1).getDay();
  var daysInMonth = new Date(year, month + 1, 0).getDate();

  var html = '<div class="flex items-center justify-center mb-3">' +
    '<h4 class="text-sm font-semibold text-white">' + months[month] + ' ' + year + '</h4>' +
  '</div>';

  html += '<div class="grid grid-cols-7 gap-px mb-1">';
  for (var di = 0; di < 7; di++) {
    html += '<div class="text-center text-[10px] text-gray-500 font-medium py-1">' + days[di] + '</div>';
  }
  html += '</div>';

  html += '<div class="grid grid-cols-7 gap-px">';
  // Empty cells before first day
  for (var e = 0; e < firstDay; e++) {
    html += '<div class="h-9"></div>';
  }
  for (var d = 1; d <= daysInMonth; d++) {
    var dateStr = year + '-' + String(month+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    var isToday = dateStr === todayStr;
    var dayEvents = _calEvents.filter(function(ev) { return ev.date === dateStr; });
    var hasEvents = dayEvents.length > 0;

    html += '<div class="h-9 flex flex-col items-center justify-center rounded-lg cursor-default relative ' +
      (isToday ? 'bg-blue-600 text-white' : 'hover:bg-white/5 text-gray-300') + '"' +
      (hasEvents ? ' title="' + dayEvents.map(function(ev){ return ev.title; }).join(', ').replace(/"/g, '&quot;') + '"' : '') + '>' +
      '<span class="text-xs font-medium">' + d + '</span>' +
      (hasEvents ? '<div class="flex gap-0.5 absolute bottom-0.5">' + dayEvents.slice(0,3).map(function(ev) {
        var dotColors = { blue: '#60a5fa', emerald: '#34d399', cyan: '#22d3ee', yellow: '#facc15', red: '#f87171', green: '#4ade80', gray: '#9ca3af' };
        return '<div class="w-1.5 h-1.5 rounded-full" style="background:' + (dotColors[ev.color] || '#60a5fa') + '"></div>';
      }).join('') + '</div>' : '') +
    '</div>';
  }
  html += '</div>';

  // Upcoming events list
  var upcoming = _calEvents.filter(function(ev) { return ev.date >= todayStr; }).sort(function(a,b) { return a.date.localeCompare(b.date); }).slice(0, 4);
  if (upcoming.length > 0) {
    html += '<div class="mt-3 pt-3 border-t border-white/5">' +
      '<p class="text-[10px] text-gray-500 font-medium uppercase tracking-wide mb-2">Upcoming</p>';
    upcoming.forEach(function(ev) {
      var dotColors = { blue: '#60a5fa', emerald: '#34d399', cyan: '#22d3ee', yellow: '#facc15', red: '#f87171', green: '#4ade80', gray: '#9ca3af' };
      html += '<div class="flex items-center gap-2 py-1">' +
        '<div class="w-1.5 h-1.5 rounded-full flex-shrink-0" style="background:' + (dotColors[ev.color] || '#60a5fa') + '"></div>' +
        '<span class="text-xs" style="color:var(--text-muted)">' + ev.date + '</span>' +
        '<span class="text-xs text-gray-300 truncate">' + ev.title + '</span>' +
      '</div>';
    });
    html += '</div>';
  }

  container.innerHTML = html;
}

window._calNav = function(dir) {
  if (dir === 0) {
    _calViewMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  } else {
    _calViewMonth.setMonth(_calViewMonth.getMonth() + dir);
  }
  _calRender();
};

window._toggleGcalSync = async function(enabled) {
  var token = localStorage.getItem('rc_customer_token') || '';
  if (enabled) {
    // Open popup immediately (synchronously) to avoid browser popup blockers
    var popup = window.open('about:blank', 'gcal_auth', 'width=500,height=600,scrollbars=yes');
    // Fetch the auth URL and navigate the popup to it
    fetch('/api/customer/gcal/auth-url', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + token }
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.url) {
        if (popup && !popup.closed) {
          popup.location.href = data.url;
        } else {
          // Popup was blocked or closed — fall back to redirect
          window.location.href = data.url;
        }
        // Poll for popup close as fallback
        var pollTimer = setInterval(function() {
          if (!popup || popup.closed) {
            clearInterval(pollTimer);
            _gcalCheckStatus();
          }
        }, 1000);
      } else {
        if (popup) popup.close();
        setToggle('gcal-sync-toggle', false);
        window.rmToast(data.error || 'Could not start Google Calendar connection.', 'info');
      }
    })
    .catch(function() {
      if (popup) popup.close();
      setToggle('gcal-sync-toggle', false);
    });
  } else {
    // Disconnect Google Calendar
    if (await window.rmConfirm('Disconnect Google Calendar?')) {
      fetch('/api/customer/gcal/disconnect', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }
      }).then(function(r) {
        if (!r.ok) throw new Error('disconnect failed');
        localStorage.setItem('rc_gcal_sync', '0');
        setToggle('gcal-sync-toggle', false);
        _calLoadEvents();
        _calRender();
      }).catch(function() {
        if (window.rmToast) window.rmToast('Disconnect failed — please try again', 'error');
        setToggle('gcal-sync-toggle', true);
      });
    } else {
      // User cancelled — re-check the toggle
      setToggle('gcal-sync-toggle', true);
    }
  }
};

// Listen for OAuth popup callback message
window.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'gcal_connected') {
    localStorage.setItem('rc_gcal_sync', '1');
    setToggle('gcal-sync-toggle', true);
    _gcalFetchEvents();
  }
});

// Check Google Calendar connection status
function _gcalCheckStatus() {
  var token = localStorage.getItem('rc_customer_token') || '';
  console.log('[GCAL DEBUG] _gcalCheckStatus called, token present:', !!token, 'token length:', token.length);
  fetch('/api/customer/gcal/status', {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  .then(function(r) {
    console.log('[GCAL DEBUG] /gcal/status response status:', r.status);
    return r.json();
  })
  .then(function(data) {
    console.log('[GCAL DEBUG] /gcal/status response data:', JSON.stringify(data));
    if (data.connected) {
      localStorage.setItem('rc_gcal_sync', '1');
      setToggle('gcal-sync-toggle', true);
      _gcalFetchEvents();
    } else {
      localStorage.setItem('rc_gcal_sync', '0');
      setToggle('gcal-sync-toggle', false);
    }
  })
  .catch(function(err) { console.log('[GCAL DEBUG] /gcal/status error:', err); });
}

// Fetch Google Calendar events and merge into dashboard calendar
function _gcalFetchEvents() {
  var token = localStorage.getItem('rc_customer_token') || '';
  fetch('/api/calendar/events', {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    var events = data.events || data.google_events || [];
    if (Array.isArray(events)) {
      events.forEach(function(ev) {
        var d = (ev.start_time || ev.start || '').substring(0, 10);
        if (d) {
          _calEvents.push({ date: d, title: ev.title || ev.summary || 'Calendar Event', color: 'green' });
        }
      });
      _calRender();
    }
  })
  .catch(function() {});
}

// Calendar is initialized inside renderDashboard() after the DOM is ready

window._toggleTheme = function() {
  var current = localStorage.getItem('rc_dashboard_theme') || 'dark';
  var next = current === 'dark' ? 'light' : current === 'light' ? 'auto' : 'dark';
  localStorage.setItem('rc_dashboard_theme', next);

  var html = document.documentElement;
  html.classList.remove('light-theme');
  document.body.classList.remove('light-theme');

  if (next === 'light') {
    html.classList.add('light-theme');
    document.body.classList.add('light-theme');
  } else if (next === 'auto' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    html.classList.add('light-theme');
    document.body.classList.add('light-theme');
  }

  // Update button icon
  var btn = document.getElementById('theme-toggle-btn');
  if (btn) {
    var icon = next === 'light' ? 'fa-moon' : next === 'auto' ? 'fa-adjust' : 'fa-sun';
    btn.innerHTML = '<i class="fas ' + icon + '"></i>';
    btn.title = 'Theme: ' + next.charAt(0).toUpperCase() + next.slice(1);
  }
};

// Settings popover toggle
window._toggleSettingsPopover = function(e) {
  e && e.stopPropagation();
  var pop = document.getElementById('settings-popover');
  if (!pop) return;
  pop.style.display = pop.style.display === 'none' ? 'block' : 'none';
};
// Close popover on outside click
document.addEventListener('click', function(e) {
  var pop = document.getElementById('settings-popover');
  var btn = document.getElementById('settings-gear-btn');
  if (pop && pop.style.display !== 'none' && !pop.contains(e.target) && (!btn || !btn.contains(e.target))) {
    pop.style.display = 'none';
  }
});

// ============================================================
// MATERIAL SETUP NUDGE — Shows banner if preferences not configured
// Dismissed for 24 hours when user clicks dismiss
// ============================================================
async function checkMaterialSetup() {
  // Don't show for team members — only the account owner sets this up
  if (custState.isTeamMember) return;

  // Check if dismissed today
  var dismissKey = 'material_setup_dismissed';
  var dismissed = localStorage.getItem(dismissKey);
  if (dismissed) {
    var dismissedAt = parseInt(dismissed, 10);
    if (Date.now() - dismissedAt < 24 * 60 * 60 * 1000) return;  // 24 hours
  }

  try {
    var res = await fetch('/api/customer/material-preferences', { headers: authHeaders() });
    if (!res.ok) return;
    var data = await res.json();
    // If preferences exist and have been saved (non-default), don't show
    if (data.preferences && data.preferences._saved) return;
  } catch (e) { return; }

  // Show the banner
  var banner = document.getElementById('material-setup-banner');
  if (!banner) return;
  banner.innerHTML =
    '<div class="bg-gradient-to-r from-amber-500 to-orange-500 rounded-2xl p-4 mb-5 shadow-lg border border-amber-400/30">' +
      '<div class="flex flex-col sm:flex-row items-center gap-3">' +
        '<div class="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0 backdrop-blur"><i class="fas fa-layer-group text-white text-lg"></i></div>' +
        '<div class="flex-1 text-center sm:text-left">' +
          '<h3 class="text-white font-bold text-sm">Set Up Your Material Preferences</h3>' +
          '<p class="text-amber-100 text-xs mt-0.5">Choose your preferred shingle type, waste factor, and tax rate so every report automatically includes an accurate material take-off.</p>' +
        '</div>' +
        '<div class="flex gap-2 flex-shrink-0">' +
          '<a href="/customer/profile" class="px-4 py-2 bg-white hover:bg-amber-50 text-amber-700 font-bold rounded-xl shadow text-sm transition-colors"><i class="fas fa-cog mr-1.5"></i>Set Up Now</a>' +
          '<button onclick="dismissMaterialSetup()" class="px-3 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-medium transition-colors border border-white/20">Dismiss</button>' +
        '</div>' +
      '</div>' +
    '</div>';
}

function dismissMaterialSetup() {
  localStorage.setItem('material_setup_dismissed', Date.now().toString());
  var banner = document.getElementById('material-setup-banner');
  if (banner) banner.innerHTML = '';
}

// ============================================================
// LEADS UNREAD BADGE — Fetch unread count and update sidebar + mobile nav
// ============================================================
function fetchLeadsUnreadBadge() {
  var token = localStorage.getItem('rc_customer_token');
  if (!token) return;
  fetch('/api/customer-leads/unread-count', { headers: { 'Authorization': 'Bearer ' + token } })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var count = data.unread_count || 0;
      var badgeEl = document.getElementById('leads-unread-badge');
      var mobileBadgeEl = document.getElementById('mobile-leads-badge');
      if (badgeEl) {
        badgeEl.innerHTML = count > 0
          ? '<span class="px-1.5 py-0.5 bg-emerald-500 text-white rounded-full text-[10px] font-bold leading-none animate-pulse">' + count + '</span>'
          : '';
      }
      if (mobileBadgeEl) {
        mobileBadgeEl.textContent = count > 0 ? count : '';
      }
    })
    .catch(function() {});
}

// Fetch badge on load and every 60 seconds — pause when tab is hidden to avoid wasted requests
setTimeout(fetchLeadsUnreadBadge, 1000);
var _leadsBadgeInterval = setInterval(function() { if (!document.hidden) fetchLeadsUnreadBadge(); }, 60000);
document.addEventListener('visibilitychange', function() { if (!document.hidden) fetchLeadsUnreadBadge(); });

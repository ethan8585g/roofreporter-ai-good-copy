// ============================================================
// Customer Dashboard — 8-Module Navigation Hub
// Central hub after login: quick access to all BMS modules
// ============================================================

var custState = { loading: true, orders: [], billing: null, customer: null, crmStats: null, showAds: false };

function getToken() { return localStorage.getItem('rc_customer_token') || ''; }
function authHeaders() { return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }; }

document.addEventListener('DOMContentLoaded', async function() {
  var params = new URLSearchParams(window.location.search);
  if (params.get('payment') === 'success') {
    var sid = params.get('session_id');
    if (sid) { try { await fetch('/api/square/verify-payment', { headers: authHeaders() }); } catch(e) {} }
    window.history.replaceState({}, '', '/customer/dashboard');
  }
  await loadDashData();
  renderDashboard();
  // Show onboarding wizard for new customers
  if (custState.customer && !custState.customer.onboarding_completed) showOnboardingModal();
  // Initialize ads for non-subscribers after data is loaded
  if (window.RRAds) window.RRAds.init(custState.showAds, window.__rraPublisherId);
  // Auto-refresh when reports are generating
  startEnhancementPolling();
});

async function loadDashData() {
  custState.loading = true;
  try {
    var [profileRes, ordersRes, billingRes, crmCustRes, crmInvRes, crmPropRes, crmJobRes, secRes, teamRes] = await Promise.all([
      fetch('/api/customer/me', { headers: authHeaders() }),
      fetch('/api/customer/orders', { headers: authHeaders() }),
      fetch('/api/square/billing', { headers: authHeaders() }),
      fetch('/api/crm/customers', { headers: authHeaders() }).catch(function() { return { ok: false }; }),
      fetch('/api/crm/invoices', { headers: authHeaders() }).catch(function() { return { ok: false }; }),
      fetch('/api/crm/proposals', { headers: authHeaders() }).catch(function() { return { ok: false }; }),
      fetch('/api/crm/jobs', { headers: authHeaders() }).catch(function() { return { ok: false }; }),
      fetch('/api/secretary/status', { headers: authHeaders() }).catch(function() { return { ok: false }; }),
      fetch('/api/team/members', { headers: authHeaders() }).catch(function() { return { ok: false }; })
    ]);
    if (profileRes.ok) {
      var pd = await profileRes.json();
      custState.customer = pd.customer;
      custState.showAds = pd.show_ads === true;
      localStorage.setItem('rc_customer', JSON.stringify(pd.customer));
    } else {
      localStorage.removeItem('rc_customer'); localStorage.removeItem('rc_customer_token');
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

function renderDashboard() {
  var root = document.getElementById('customer-root');
  if (!root) return;
  if (custState.loading) {
    root.innerHTML = '<div class="flex items-center justify-center py-20"><div class="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-brand-500"></div><span class="ml-4 text-gray-500 text-lg">Loading dashboard...</span></div>';
    return;
  }

  var c = custState.customer || {};

  // Redirect to company type selection if not yet chosen
  if (custState.customer && !c.company_type) {
    window.location.href = '/customer/select-type';
    return;
  }

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
    return '<a href="' + href + '" class="flex items-center justify-between px-3 py-2 rounded-lg text-gray-700 hover:bg-gray-100 hover:text-brand-700 transition-colors group">' +
      '<span class="flex items-center gap-2.5">' +
        '<i class="fas ' + icon + ' text-gray-400 group-hover:text-brand-500 w-4 text-center text-sm transition-colors"></i>' +
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

  var sidebar =
    '<aside class="hidden md:flex flex-col w-56 flex-shrink-0 bg-white border-r border-gray-200 min-h-full">' +
      // Brand
      '<div class="px-4 py-5 border-b border-gray-100">' +
        '<div class="flex items-center gap-2">' +
          (c.google_avatar
            ? '<img src="' + c.google_avatar + '" class="w-8 h-8 rounded-full border border-gray-200" alt="">'
            : '<div class="w-8 h-8 bg-gradient-to-br from-brand-500 to-brand-700 rounded-full flex items-center justify-center"><i class="fas fa-user text-white text-xs"></i></div>') +
          '<div class="min-w-0">' +
            '<p class="text-sm font-bold text-gray-900 truncate">' + (c.name || 'User') + '</p>' +
            '<p class="text-xs text-gray-400 truncate">' + (c.company_name || c.email || '') + '</p>' +
          '</div>' +
        '</div>' +
      '</div>' +
      // Nav
      '<nav class="flex-1 px-3 py-4 space-y-5 overflow-y-auto">' +
        // Reports
        '<div>' +
          '<p class="px-3 mb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Reports</p>' +
          navLink('/customer/order', 'fa-plus-circle', isSolar ? 'Order New Solar Proposal' : 'Order New Report', creditBadge || null, creditBadgeColor) +
          navLink('/customer/reports', 'fa-file-alt', 'Report History', completedReports > 0 ? completedReports + '' : null, 'bg-gray-800') +
        '</div>' +
        // CRM
        '<div>' +
          '<p class="px-3 mb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">CRM</p>' +
          navLink('/customer/customers', 'fa-users', 'Customers', s.customers > 0 ? s.customers + '' : null, 'bg-gray-800') +
          navLink('/customer/invoices', 'fa-file-invoice-dollar', 'Invoices', invBadge || null, 'bg-blue-600') +
          navLink('/customer/proposals', 'fa-file-signature', 'Proposals', propBadge || null, 'bg-blue-600') +
          navLink('/customer/jobs', 'fa-hard-hat', 'Jobs', jobBadge || null, 'bg-gray-800') +
          navLink('/customer/pipeline', 'fa-funnel-dollar', 'Pipeline', 'Soon', 'bg-gray-300') +
        '</div>' +
        // Team
        '<div>' +
          '<p class="px-3 mb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Team</p>' +
          navLink('/customer/team', 'fa-users-cog', 'Sales Team', teamBadge || null, 'bg-gray-800') +
          navLink('/customer/d2d', 'fa-door-open', 'D2D Manager', null, '') +
        '</div>' +
        // Services
        '<div>' +
          '<p class="px-3 mb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Services</p>' +
          navLink('/customer/secretary', 'fa-headset', isSolar ? 'Solar Sales Secretary' : 'Roofer Secretary', secBadge || null, secBadgeColor) +
        '</div>' +
        // Tools
        '<div>' +
          '<p class="px-3 mb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Tools</p>' +
          navLink('/customer/material-calculator', 'fa-calculator', 'Material Calculator', null, '') +
          navLink('/customer/catalog', 'fa-box-open', 'Catalog', null, '') +
          navLink('/customer/email-outreach', 'fa-envelope-open-text', 'Email Outreach', null, '') +
        '</div>' +
        (c.is_dev ? '<div><p class="px-3 mb-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Dev</p>' + navLink('/customer/property-imagery', 'fa-satellite', 'Property Imagery', 'Dev', 'bg-gray-800') + '</div>' : '') +
      '</nav>' +
      // Credits footer
      '<div class="px-4 py-4 border-t border-gray-100">' +
        (freeTrialRemaining > 0
          ? '<div class="flex items-center justify-between mb-2"><span class="text-xs text-gray-500">Free trials left</span><span class="text-xs font-bold text-green-600">' + freeTrialRemaining + '</span></div>'
          : '') +
        (paidCredits > 0
          ? '<div class="flex items-center justify-between mb-2"><span class="text-xs text-gray-500">Report credits</span><span class="text-xs font-bold text-blue-600">' + paidCredits + '</span></div>'
          : '') +
        '<a href="/pricing" class="block w-full text-center py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-lg transition-colors">Buy Credits</a>' +
        '<a href="/customer/profile" class="block w-full text-center py-1.5 mt-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors">Account Settings</a>' +
        // Sidebar ad unit — shown only to non-subscribers
        '<div class="rra-ad-container" data-ad-slot="" data-ad-format="auto" style="display:none; margin-top:12px; min-height:120px; background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; overflow:hidden; padding:4px;"></div>' +
      '</div>' +
    '</aside>';

  // Mobile horizontal nav (shown below md)
  var mobileNav =
    '<div class="md:hidden bg-white border-b border-gray-200 overflow-x-auto">' +
      '<div class="flex gap-1 px-3 py-2 whitespace-nowrap">' +
        '<a href="/customer/order" class="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs font-semibold flex-shrink-0"><i class="fas fa-plus-circle"></i>Order</a>' +
        '<a href="/customer/reports" class="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium flex-shrink-0"><i class="fas fa-file-alt"></i>Reports</a>' +
        '<a href="/customer/customers" class="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium flex-shrink-0"><i class="fas fa-users"></i>Customers</a>' +
        '<a href="/customer/invoices" class="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium flex-shrink-0"><i class="fas fa-file-invoice-dollar"></i>Invoices</a>' +
        '<a href="/customer/proposals" class="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium flex-shrink-0"><i class="fas fa-file-signature"></i>Proposals</a>' +
        '<a href="/customer/jobs" class="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium flex-shrink-0"><i class="fas fa-hard-hat"></i>Jobs</a>' +
        '<a href="/customer/team" class="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium flex-shrink-0"><i class="fas fa-users-cog"></i>Team</a>' +
        '<a href="/customer/d2d" class="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium flex-shrink-0"><i class="fas fa-door-open"></i>D2D</a>' +
        '<a href="/customer/secretary" class="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium flex-shrink-0"><i class="fas fa-headset"></i>Secretary</a>' +
        '<a href="/customer/material-calculator" class="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium flex-shrink-0"><i class="fas fa-calculator"></i>Materials</a>' +
        '<a href="/customer/virtual-tryon" class="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium flex-shrink-0"><i class="fas fa-magic"></i>Visualizer</a>' +
      '</div>' +
    '</div>';

  // Main content area
  var mainContent =
    '<main class="flex-1 min-w-0 p-5 md:p-6 overflow-auto">' +
      // Welcome header
      '<div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-5">' +
        '<div>' +
          '<h2 class="text-xl font-bold text-gray-900">' + (function() { var h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; })() + ', ' + (c.name || 'User') + '</h2>' +
          '<p class="text-sm text-gray-500 mt-0.5">' + (c.company_name ? c.company_name + ' &middot; ' : '') + (c.email || '') + '</p>' +
        '</div>' +
        '<div class="flex items-center gap-2 flex-wrap">' +
          (freeTrialRemaining > 0 ? '<div class="px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-full text-xs font-bold text-blue-700"><i class="fas fa-gift mr-1"></i>' + freeTrialRemaining + ' Free Trial</div>' : '') +
          (paidCredits > 0 ? '<div class="px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-full text-xs font-bold text-blue-700"><i class="fas fa-coins mr-1"></i>' + paidCredits + ' Credits</div>' : '') +
          '<div class="px-3 py-1.5 bg-gray-100 border border-gray-200 rounded-full text-xs font-bold text-gray-700"><i class="fas fa-file-alt mr-1"></i>' + completedReports + ' Reports</div>' +
          (processingReports > 0 ? '<div class="px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-full text-xs font-bold text-blue-700 animate-pulse"><i class="fas fa-spinner fa-spin mr-1"></i>' + processingReports + ' Generating</div>' : '') +
        '</div>' +
      '</div>' +

      // Trial exhausted banner
      (trialsExhausted ?
        '<div class="bg-gradient-to-r from-brand-800 to-brand-900 rounded-2xl p-5 mb-5 shadow-xl border border-brand-700">' +
          '<div class="flex flex-col sm:flex-row items-center gap-4">' +
            '<div class="w-12 h-12 bg-amber-500 rounded-xl flex items-center justify-center shadow-lg flex-shrink-0"><i class="fas fa-crown text-white text-xl"></i></div>' +
            '<div class="flex-1 text-center sm:text-left">' +
              '<h3 class="text-white font-black text-base">Your 3 Free Trial Reports Are Used Up!</h3>' +
              '<p class="text-brand-200 text-xs mt-1">Upgrade to a credit pack — packs from <strong class="text-amber-400">$5.00/report</strong>, save up to 38%.</p>' +
            '</div>' +
            '<div class="flex gap-2 flex-shrink-0">' +
              '<a href="/pricing" class="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-gray-900 font-black rounded-xl shadow text-xs"><i class="fas fa-tags mr-1"></i>View Packs</a>' +
              '<a href="/customer/order" class="px-4 py-2 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl text-xs border border-white/20"><i class="fas fa-credit-card mr-1"></i>Pay Per Report</a>' +
            '</div>' +
          '</div>' +
        '</div>' : '') +

      // Team context banner
      (custState.isTeamMember ?
        '<div class="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-2xl p-4 mb-5 shadow-lg border border-blue-500/30">' +
          '<div class="flex items-center gap-3">' +
            '<div class="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0 backdrop-blur"><i class="fas fa-users text-white"></i></div>' +
            '<div class="flex-1 min-w-0">' +
              '<div class="flex items-center gap-2">' +
                '<h3 class="text-white font-bold text-sm">Team Account Access</h3>' +
                '<span class="px-2 py-0.5 bg-white/20 rounded-full text-[10px] font-bold text-blue-100 uppercase">' + (custState.teamRole || 'member') + '</span>' +
              '</div>' +
              '<p class="text-blue-200 text-xs mt-0.5 truncate">Accessing <strong class="text-white">' + (custState.teamOwnerCompany || custState.teamOwnerName || 'Team') + '</strong>\u2019s account.</p>' +
            '</div>' +
            '<a href="/customer/team" class="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-semibold border border-white/20 flex-shrink-0"><i class="fas fa-users-cog mr-1"></i>Team</a>' +
          '</div>' +
        '</div>' : '') +

      // Rover AI Assistant + Quick Actions
      '<div class="grid grid-cols-1 lg:grid-cols-5 gap-5 mb-5">' +
        // Rover AI Chat (wider)
        '<div class="lg:col-span-3 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col" style="min-height:420px">' +
          '<div class="px-5 py-3 border-b border-gray-100 flex items-center justify-between bg-gradient-to-r from-gray-900 to-gray-800">' +
            '<div class="flex items-center gap-2">' +
              '<span class="text-lg">&#128054;</span>' +
              '<h3 class="font-bold text-white text-sm">Rover AI Assistant</h3>' +
              '<span class="px-2 py-0.5 bg-blue-600 text-white rounded-full text-[9px] font-bold">AI</span>' +
            '</div>' +
            '<p class="text-xs text-gray-400">Ask me anything about your account</p>' +
          '</div>' +
          '<div id="rover-dash-messages" class="flex-1 overflow-y-auto p-4 space-y-3" style="max-height:320px">' +
            '<div class="flex gap-2"><div class="w-7 h-7 bg-gray-900 rounded-full flex items-center justify-center flex-shrink-0 text-xs">&#128054;</div><div class="bg-gray-100 rounded-xl rounded-tl-sm px-3 py-2 text-sm text-gray-700 max-w-[85%]">Hey ' + (c.name || 'there').split(' ')[0] + '! I\'m Rover, your AI assistant. Ask me anything — I can help with reports, proposals, invoices, material calculations, and more.</div></div>' +
          '</div>' +
          '<div class="px-4 py-3 border-t border-gray-100 bg-gray-50">' +
            '<div class="flex gap-2 mb-2 overflow-x-auto pb-1">' +
              '<button onclick="window._roverDashSend(\'What can you help me with?\')" class="px-2.5 py-1 bg-white border border-gray-200 rounded-lg text-[11px] text-gray-600 hover:bg-blue-50 hover:border-blue-200 whitespace-nowrap flex-shrink-0">What can you do?</button>' +
              '<button onclick="window._roverDashSend(\'Give me a summary of my account\')" class="px-2.5 py-1 bg-white border border-gray-200 rounded-lg text-[11px] text-gray-600 hover:bg-blue-50 hover:border-blue-200 whitespace-nowrap flex-shrink-0">Account Summary</button>' +
              '<button onclick="window._roverDashSend(\'How do I order a roof report?\')" class="px-2.5 py-1 bg-white border border-gray-200 rounded-lg text-[11px] text-gray-600 hover:bg-blue-50 hover:border-blue-200 whitespace-nowrap flex-shrink-0">How to Order</button>' +
              '<button onclick="window._roverDashSend(\'Help me create a proposal\')" class="px-2.5 py-1 bg-white border border-gray-200 rounded-lg text-[11px] text-gray-600 hover:bg-blue-50 hover:border-blue-200 whitespace-nowrap flex-shrink-0">Draft Proposal</button>' +
            '</div>' +
            '<div class="flex gap-2">' +
              '<input type="text" id="rover-dash-input" placeholder="Ask Rover anything..." class="flex-1 px-3 py-2 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-400 focus:border-blue-400" onkeydown="if(event.key===\'Enter\')window._roverDashSend()">' +
              '<button onclick="window._roverDashSend()" class="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white rounded-xl text-sm font-semibold flex-shrink-0"><i class="fas fa-paper-plane"></i></button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        // Quick Actions (narrower)
        '<div class="lg:col-span-2 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">' +
          '<div class="px-5 py-4 border-b border-gray-100">' +
            '<h3 class="font-bold text-gray-800 text-sm"><i class="fas fa-bolt text-blue-600 mr-2"></i>Quick Actions</h3>' +
          '</div>' +
          '<div class="p-4 space-y-2.5">' +
            '<a href="/customer/order" class="flex items-center gap-3 p-3 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors">' +
              '<div class="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0"><i class="fas fa-plus text-white text-sm"></i></div>' +
              '<div><p class="font-semibold text-gray-800 text-sm">Order Roof Report</p><p class="text-xs text-gray-500">' + (freeTrialRemaining > 0 ? freeTrialRemaining + ' free remaining' : (paidCredits > 0 ? paidCredits + ' credits' : 'Pay per report')) + '</p></div>' +
            '</a>' +
            '<a href="/customer/customers" class="flex items-center gap-3 p-3 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors">' +
              '<div class="w-9 h-9 bg-gray-800 rounded-lg flex items-center justify-center flex-shrink-0"><i class="fas fa-user-plus text-white text-sm"></i></div>' +
              '<div><p class="font-semibold text-gray-800 text-sm">Add Customer</p><p class="text-xs text-gray-500">Build your CRM database</p></div>' +
            '</a>' +
            '<a href="/customer/invoices" class="flex items-center gap-3 p-3 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors">' +
              '<div class="w-9 h-9 bg-gray-800 rounded-lg flex items-center justify-center flex-shrink-0"><i class="fas fa-file-invoice-dollar text-white text-sm"></i></div>' +
              '<div><p class="font-semibold text-gray-800 text-sm">Create Invoice</p><p class="text-xs text-gray-500">' + (s.invoices_owing > 0 ? '$' + Number(s.invoices_owing).toFixed(2) + ' outstanding' : 'Bill your customers') + '</p></div>' +
            '</a>' +
            '<a href="/customer/proposals" class="flex items-center gap-3 p-3 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors">' +
              '<div class="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0"><i class="fas fa-file-signature text-white text-sm"></i></div>' +
              '<div><p class="font-semibold text-gray-800 text-sm">New Proposal</p><p class="text-xs text-gray-500">Professional roofing proposals</p></div>' +
            '</a>' +
            '<a href="/pricing" class="flex items-center gap-3 p-3 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors">' +
              '<div class="w-9 h-9 bg-gray-800 rounded-lg flex items-center justify-center flex-shrink-0"><i class="fas fa-coins text-white text-sm"></i></div>' +
              '<div><p class="font-semibold text-gray-800 text-sm">Buy Credits</p><p class="text-xs text-gray-500">From $2.99/report USD</p></div>' +
            '</a>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Ad unit — shown only to non-subscribers via RRAds.init()
      '<div class="rra-ad-container" data-ad-slot="" data-ad-format="horizontal" style="display:none; margin-bottom:20px; text-align:center; min-height:90px; background:#f1f5f9; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; padding:4px;"></div>' +

      // Auto-Email Settings
      '<div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-5">' +
        '<div class="px-5 py-4 flex items-center justify-between">' +
          '<div>' +
            '<p class="font-medium text-gray-800 text-sm"><i class="fas fa-envelope text-cyan-500 mr-2"></i>Auto-email reports when ready</p>' +
            '<p class="text-xs text-gray-500 mt-0.5">Send completed reports automatically to ' + (c.email || '') + '</p>' +
          '</div>' +
          '<label class="relative inline-flex items-center cursor-pointer">' +
            '<input type="checkbox" id="auto-email-toggle" class="sr-only peer" onchange="toggleAutoEmail(this.checked)">' +
            '<div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-cyan-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[&quot;&quot;] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>' +
          '</label>' +
        '</div>' +
      '</div>' +

      '<div class="text-center py-4 text-xs text-gray-400"><p>Powered by <strong>RoofReporterAI</strong> &middot; Antigravity Gemini Roof Measurement Suite</p></div>' +
    '</main>';

  root.innerHTML =
    mobileNav +
    '<div class="flex" style="min-height:calc(100vh - 53px)">' +
      sidebar +
      mainContent +
    '</div>';
}

function renderRecentOrders() {
  var orders = custState.orders.slice(0, 5);
  if (orders.length === 0) {
    return '<div class="text-center py-8">' +
      '<div class="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3"><i class="fas fa-clipboard-list text-gray-400 text-lg"></i></div>' +
      '<p class="text-sm text-gray-500 mb-3">No reports yet</p>' +
      '<a href="/customer/order" class="text-sm font-semibold text-brand-600 hover:text-brand-700"><i class="fas fa-plus mr-1"></i>Order your first report</a></div>';
  }

  var html = '<div class="space-y-2">';
  for (var i = 0; i < orders.length; i++) {
    var o = orders[i];
    var isProcessing = o.status === 'processing' || o.report_status === 'generating' || o.report_status === 'pending';
    var statusClass = o.status === 'completed' ? 'bg-green-100 text-green-700' : (isProcessing ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600');
    var reportReady = (o.report_status === 'completed' || o.status === 'completed') && !isProcessing;
    html += '<div class="flex items-center justify-between p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">' +
      '<div class="flex-1 min-w-0">' +
        '<p class="text-sm font-medium text-gray-800 truncate"><i class="fas fa-map-marker-alt text-red-400 mr-1.5 text-xs"></i>' + (o.property_address || 'Unknown') + '</p>' +
        '<p class="text-xs text-gray-500 mt-0.5">' + new Date(o.created_at).toLocaleDateString() + (o.roof_area_sqft ? ' &middot; ' + Math.round(o.roof_area_sqft) + ' sq ft' : '') + '</p>' +
      '</div>' +
      '<div class="flex items-center gap-2 ml-3">' +
        '<span class="px-2 py-0.5 ' + statusClass + ' rounded-full text-[10px] font-bold capitalize">' + (isProcessing ? '<i class="fas fa-spinner fa-spin mr-1"></i>' : '') + (isProcessing ? 'generating' : o.status) + '</span>' +
        (reportReady ? '<a href="/api/reports/' + o.id + '/html" target="_blank" class="px-2.5 py-1 bg-brand-600 text-white rounded-lg text-xs font-medium hover:bg-brand-700"><i class="fas fa-eye mr-1"></i>View</a>' : '') +
        (reportReady ? '<a href="/customer/material-calculator?order_id=' + o.id + '" class="px-2.5 py-1 bg-sky-100 text-sky-700 rounded-lg text-xs font-medium hover:bg-sky-200"><i class="fas fa-calculator mr-1"></i>Materials</a>' : '') +
      '</div>' +
    '</div>';
  }
  html += '</div>';
  return html;
}

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
        
        renderDashboard();
        
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
        (orderId ? '<a href="/api/reports/' + orderId + '/html" target="_blank" style="background:white;color:#059669;padding:6px 14px;border-radius:10px;font-size:12px;font-weight:700;text-decoration:none;white-space:nowrap">View <i class="fas fa-arrow-right ml-1"></i></a>' : '') +
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
      var toggle = document.getElementById('auto-email-toggle');
      if (toggle) toggle.checked = !!data.auto_email_reports;
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
      title: 'Welcome to RoofReporterAI, ' + name + '!',
      content: '<div class="space-y-3">' +
        '<div class="bg-green-50 border border-green-200 rounded-xl p-4 text-center">' +
          '<p class="text-3xl font-black text-green-700 mb-1">' + freeCredits + ' Free Reports</p>' +
          '<p class="text-sm text-green-600">No credit card needed — start measuring roofs right now</p>' +
        '</div>' +
        '<div class="grid grid-cols-3 gap-3 text-center text-xs">' +
          '<div class="bg-gray-50 rounded-xl p-3"><i class="fas fa-satellite text-brand-500 text-xl mb-1 block"></i><p class="font-semibold text-gray-700">Satellite Measurement</p></div>' +
          '<div class="bg-gray-50 rounded-xl p-3"><i class="fas fa-boxes-stacked text-emerald-500 text-xl mb-1 block"></i><p class="font-semibold text-gray-700">Full Material BOM</p></div>' +
          '<div class="bg-gray-50 rounded-xl p-3"><i class="fas fa-file-invoice text-purple-500 text-xl mb-1 block"></i><p class="font-semibold text-gray-700">Instant Proposals</p></div>' +
        '</div>' +
      '</div>'
    },
    {
      icon: 'fa-rocket',
      color: 'from-emerald-500 to-teal-500',
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
        '<a href="/customer/order" onclick="dismissOnboarding()" class="block w-full py-3 text-center bg-brand-600 hover:bg-brand-700 text-white font-bold rounded-xl transition-colors">' +
          '<i class="fas fa-plus mr-2"></i>Order My First Report (Free)' +
        '</a>' +
      '</div>'
    },
    {
      icon: 'fa-toolbox',
      color: 'from-purple-500 to-violet-500',
      title: 'Explore Your Tools',
      content: '<div class="space-y-3">' +
        '<p class="text-sm text-gray-600">Your dashboard has everything you need to run your roofing business:</p>' +
        '<div class="grid grid-cols-2 gap-2">' +
          '<a href="/customer/crm/reports" onclick="dismissOnboarding()" class="bg-brand-50 border border-brand-200 rounded-xl p-3 text-center hover:bg-brand-100 transition-colors"><i class="fas fa-file-alt text-brand-500 text-lg mb-1 block"></i><p class="text-xs font-semibold text-brand-700">Reports</p></a>' +
          '<a href="/customer/proposals" onclick="dismissOnboarding()" class="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center hover:bg-amber-100 transition-colors"><i class="fas fa-file-invoice text-amber-500 text-lg mb-1 block"></i><p class="text-xs font-semibold text-amber-700">Proposals</p></a>' +
          '<a href="/customer/customers" onclick="dismissOnboarding()" class="bg-violet-50 border border-violet-200 rounded-xl p-3 text-center hover:bg-violet-100 transition-colors"><i class="fas fa-users text-violet-500 text-lg mb-1 block"></i><p class="text-xs font-semibold text-violet-700">Customers</p></a>' +
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

// ---- Rover Dashboard Chat ----
var _roverDashSessionId = sessionStorage.getItem('rover_dash_sid') || ('rd_' + Math.random().toString(36).substring(2, 10));
sessionStorage.setItem('rover_dash_sid', _roverDashSessionId);

window._roverDashSend = function(text) {
  var input = document.getElementById('rover-dash-input');
  var msg = text || (input ? input.value.trim() : '');
  if (!msg) return;
  if (input) input.value = '';

  var container = document.getElementById('rover-dash-messages');
  if (!container) return;

  // Add user message
  container.insertAdjacentHTML('beforeend',
    '<div class="flex gap-2 justify-end"><div class="bg-blue-600 text-white rounded-xl rounded-tr-sm px-3 py-2 text-sm max-w-[85%]">' + msg.replace(/</g, '&lt;') + '</div></div>'
  );
  // Add typing indicator
  container.insertAdjacentHTML('beforeend',
    '<div id="rover-dash-typing" class="flex gap-2"><div class="w-7 h-7 bg-gray-900 rounded-full flex items-center justify-center flex-shrink-0 text-xs">&#128054;</div><div class="bg-gray-100 rounded-xl rounded-tl-sm px-3 py-2 text-sm text-gray-400"><i class="fas fa-circle text-[6px] animate-pulse mr-1"></i><i class="fas fa-circle text-[6px] animate-pulse mr-1" style="animation-delay:0.2s"></i><i class="fas fa-circle text-[6px] animate-pulse" style="animation-delay:0.4s"></i></div></div>'
  );
  container.scrollTop = container.scrollHeight;

  var token = localStorage.getItem('rc_customer_token') || '';
  fetch('/api/rover/assistant', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: msg, session_id: _roverDashSessionId })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    var typing = document.getElementById('rover-dash-typing');
    if (typing) typing.remove();
    var reply = (data.reply || data.message || 'Sorry, I had trouble responding.').replace(/</g, '&lt;').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    container.insertAdjacentHTML('beforeend',
      '<div class="flex gap-2"><div class="w-7 h-7 bg-gray-900 rounded-full flex items-center justify-center flex-shrink-0 text-xs">&#128054;</div><div class="bg-gray-100 rounded-xl rounded-tl-sm px-3 py-2 text-sm text-gray-700 max-w-[85%]">' + reply + '</div></div>'
    );
    container.scrollTop = container.scrollHeight;
  })
  .catch(function() {
    var typing = document.getElementById('rover-dash-typing');
    if (typing) typing.remove();
    container.insertAdjacentHTML('beforeend',
      '<div class="flex gap-2"><div class="w-7 h-7 bg-gray-900 rounded-full flex items-center justify-center flex-shrink-0 text-xs">&#128054;</div><div class="bg-red-50 rounded-xl rounded-tl-sm px-3 py-2 text-sm text-red-600 max-w-[85%]">Sorry, I had trouble connecting. Please try again.</div></div>'
    );
    container.scrollTop = container.scrollHeight;
  });
};
